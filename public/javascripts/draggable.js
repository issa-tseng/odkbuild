;(function($) {

var mimeType = 'application/x-odkbuild-control';

// our two shameful global variables. but you can really only drag+drop one thing on your entire
// machine at once anyway. we use these to track whether a successful drop happened here or in
// some other window, and to fix awfulness with Chrome.
var wasDroppedHere = null;
var lastDragStartAt = null;

// you're welcome, chrome:
var scheduleReapCheck = function(at, $artifact)
{
    var timer = null;
    var count = 0;
    var check = function()
    {
        count++;

        var message = window.localStorage.getItem(at);
        if (!$.isBlank(message))
        {
            window.localStorage.removeItem(at);
            window.clearInterval(timer);

            if (message === 'move')
                reap($artifact);
        }
        else if (count > 10)
        {
            // we don't know what happened; either the message is being slow to come or (more likely)
            // the user cancelled the drag operation. either way, do the safe thing, which is nothing.
            window.clearInterval(timer);
        }
    };
    window.setInterval(check, 50); // check every 50ms for up to half a second.
};

var reap = function($artifact)
{
    $artifact.find('.control')
        .trigger('odkControl-removing')
        .remove()
        .trigger('odkControl-removed');

    $artifact
        .trigger('odkControl-removing')
        .remove()
        .trigger('odkControl-removed');

    odkmaker.application.clearProperties();
};

$.fn.draggable = function(passedOptions)
{
    var options = $.extend({}, $.fn.draggable.defaults, passedOptions);

    this.each(function()
    {
        var $this = $(this);

        $this.on('dragstart', function(event)
        {
            // bail if we've already started dragging on a inner element.
            var dataTransfer = event.originalEvent.dataTransfer;
            if (_.isArray(dataTransfer.types) && (dataTransfer.types.indexOf(mimeType) >= 0))
                return;

            // determine what it is that we are dragging:
            if (options.artifact != null)
                // if we are given an explicit artifact to drag, use that.
                var $dragging = options.artifact();
            else if ($this.hasClass('selected'))
                // we are selected; drag everything that is selected that isn't already nested in a selected container.
                var $dragging = $('.control.selected').filter(function() { return $(this).parents('.selected:first').length === 0; });
            else
                // we are being dragged but we are not selected. drag just this thing.
                var $dragging = $this;
            $this.data('draggable-dragging', $dragging);

            // track dragstart millisecond time as a UUID for the sake of chrome.
            lastDragStartAt = (new Date()).getTime();

            // set up the data transfer for the drag.
            var data = {
                ids: $dragging.map(function() { return $(this).data('odkControl-id') }).get(),
                controls: $dragging.map(function() { return odkmaker.data.extractOne($(this)); }).get(),
                at: lastDragStartAt
            };
            dataTransfer.setData(mimeType, JSON.stringify(data));
            dataTransfer.effectAllowed = 'copyMove';
            dataTransfer.dropEffect = 'move';

            // set class.
            if (options.handleAddedClass != null)
                $dragging.addClass(options.handleAddedClass);

            // some housekeeping.
            wasDroppedHere = false;
            kor.events.fire({ subject: $dragging, verb: 'control-drag-start' });
        });
        $this.on('dragend', function(event)
        {
            var $dragging = $this.data('draggable-dragging');

            // n.b. according to spec this fires /after/ drop.
            if (options.handleAddedClass != null)
                $dragging.removeClass(options.handleAddedClass);

            // if we've been moved rather than copied into some other window, remove the original
            // source. but because chrome doesn't appropriately set the dropEffect property, we have
            // to rig up our own IPC.
            if (!wasDroppedHere && options.removeIfMoved)
            {
                if ($.isChrome)
                    scheduleReapCheck(lastDragStartAt, $dragging);
                else if (event.originalEvent.dataTransfer.dropEffect === 'move')
                    reap($dragging);
            }

            // don't bubble.
            event.stopPropagation();
        });

        $this.prop('draggable', true);
    });
};
$.fn.draggable.defaults = {
    artifact: null,
    handleAddedClass: null, // set to attach a class to the original drag source during the drag.
    removeIfMoved: true
};

$.fn.droppable = function(passedOptions)
{
    var options = $.extend({}, $.fn.droppable.defaults, passedOptions);

    this.each(function()
    {
        var $this = $(this);
        var target = null;

        $this.on('dragenter', function(event)
        {
            if ($this[0] !== event.target)
                return; // this is some subelement bubbling. just forget about it.

            if (event.originalEvent.dataTransfer.types.indexOf(mimeType) < 0)
                return; // longer bit of logic to be consistent with dragover.

            // preventing default indicates that we can drop the object here.
            event.preventDefault();
        });

        // we track drag events on contained controls as a really cheap way of
        // determining where the mouse is at.
        var currentOverEvent = null;
        $this.on('dragover', '.control', function(event)
        {
            if (event.originalEvent.dataTransfer.types.indexOf(mimeType) < 0)
                return;

            // have to prevent default here as well to maintain the drag.
            event.preventDefault();

            // no matter anything below, if the eventing element is currently being dragged,
            // use that element instead to prevent groups from being dragged into themselves.
            if (/dragging/i.test(this.className))
                target = this;

            // we've already handled this event at the deepest level and it's now bubbling; ignore.
            if (event.originalEvent === currentOverEvent)
                return;
            currentOverEvent = event.originalEvent;

            // if we drag into the gap between controls nested within a group (ie we drag onto the
            // workspace area of a group but the last thing we dragged onto was a control in that
            // group), we want to ignore the group itself and just go with whatever we had before.
            if (/group/i.test(this.className) && this.contains(target) && $(this).children('.workspaceInnerWrapper')[0].contains(event.target))
                return;

            target = this;
        });

        var $placeholder = $('<div id="placeholder"/>');
        var $scrollParent = $this.closest(options.scrollParent);
        $this.on('dragover', function(event)
        {
            if (event.originalEvent.dataTransfer.types.indexOf(mimeType) < 0)
                return;

            // have to prevent default here as well to maintain the drag.
            event.preventDefault();

            // the above dragover handler for contained controls always fires before this one, so
            // by the time we get here we have up-to-date information on targets.
            if ((target != null) && (document.body.contains(target)))
            {
                var $target = $(target);
                var targetTop = $target.offset().top;
                var targetHeight = $target.outerHeight(true);
                var third = targetHeight / 3;
                var mouseY = event.originalEvent.clientY;

                if ($target.hasClass('group') && !$target.hasClass('dragging'))
                {
                    // groups require special handling.
                    var infoHeight = $target.children('.controlInfo').outerHeight(true);
                    var workspaceWrapperHeight = $target.children('.workspaceInnerWrapper').outerHeight(true);
                    if (mouseY < (targetTop + infoHeight))
                    {
                        // anywhere within the info section we'll hedge to "before".
                        $target.before($placeholder);
                    }
                    else if (mouseY > (targetTop + infoHeight + workspaceWrapperHeight))
                    {
                        // if we're past the subspace area, hedge to "after".
                        $target.after($placeholder);
                    }
                    else
                    {
                        // we're somewhere inside the subspace area, but for whatever reason we don't
                        // have a target within the group to point at. this means the drag is either
                        // off-scale low or off-scale high, or there are no controls in this group.
                        // just split the whole thing in half and use that to determine our path.
                        //
                        // the if clause keeps us from allowing a group to be dragged into itself.
                        var $workspace = $target.find('> .workspaceInnerWrapper > .workspaceInner');
                        if (mouseY < (targetTop + infoHeight + (workspaceWrapperHeight / 2)))
                            $workspace.prepend($placeholder);
                        else
                            $workspace.append($placeholder);
                    }
                }
                else if (mouseY < (targetTop + third))
                {
                    // we're in the top third; we want to place the drop target above this control.
                    $target.before($placeholder);
                }
                else if (mouseY < (targetTop + (2 * third)))
                {
                    // we're in the middle third; leave the placeholder where it was. if it wasn't
                    // anywhere, put it on the closer half.
                    if ($placeholder[0].parentNode == null)
                    {
                        if (mouseY < (targetTop + (targetHeight / 2)))
                            $target.before($placeholder);
                        else
                            $target.after($placeholder);
                    }
                }
                else
                {
                    // we're in the bottom third. the drop target goes after our spot.
                    $target.after($placeholder);
                }
            }
            else
            {
                // if we have no target, we assume we're at the very end of the stack.
                $('.workspace').append($placeholder);
            }

            // now we may have to scroll things about depending on what browser we're in.
            // scroll behaviour adapted from: https://github.com/clint-tseng/awesomereorder
            // (tbh i think this is a nicer scrollspeed calculation than Chrome's)
            if (($.isFirefox || $.isSafari) && ($scrollParent.length !== 0))
            {
                var mouseY = event.originalEvent.clientY;
                var workspaceTop = $scrollParent.offset().top;
                var workspaceHeight = null; // gets calculated only if necessary; expensive.

                // see if we are within the upper scroll margin.
                if (mouseY < (workspaceTop + options.scrollMargin))
                {
                    setScroll();
                    var delta = workspaceTop + options.scrollMargin - mouseY; // distance from initiation point
                    scrollSpeed = -1 * options.scrollSpeed * // base speed
                        Math.min(Math.pow(delta / options.scrollMargin, options.scrollCurve), // power factor
                        1); // minimum factor
                }
                else if (mouseY > (workspaceTop + (workspaceHeight = $scrollParent.outerHeight(false)) - options.scrollMargin))
                {
                    setScroll();
                    var delta = mouseY - (workspaceTop + workspaceHeight - options.scrollMargin); // distance from initiation point
                    scrollSpeed = options.scrollSpeed * // base speed
                        Math.min(Math.pow(delta / options.scrollMargin, options.scrollCurve), // power factor
                        1); // minimum factor
                }
                else
                {
                    clearScroll();
                }
            }
        });

        // these will get lifted, so put them below drag event in their own block for organization.
        var scrollSpeed = 0;
        var scrollTimer = null;
        var setScroll = function() { if (scrollTimer == null) { scrollTimer = setInterval(scroll, 10); } };
        var scroll = function() { $scrollParent.scrollTop($scrollParent.scrollTop() + scrollSpeed); };
        var clearScroll = function()
        {
            clearInterval(scrollTimer);
            scrollTimer = null;
        };

        $this.on('dragleave', function(event)
        {
            clearScroll(); // safe to blithely call.
            $placeholder.detach();
        });

        $this.on('drop', function(event)
        {
            clearScroll(); // safe to blithely call.

            var dataTransfer = event.originalEvent.dataTransfer;
            var data = dataTransfer.getData(mimeType);
            if ($.isBlank(data)) return;

            wasDroppedHere = true;
            var parsed = JSON.parse(data);
            var controlIds = parsed.ids;
            var controlData = parsed.controls;

            var $extant = $(_.compact(_.map(controlIds, function(id) { return document.getElementById('control' + id); })));
            // break this logic out because chrome makes it all terrible (see commit message @c1c897e).
            // don't depend on key detection when we can help it because it's less reliable.
            var isExtant = ($extant.length === controlIds.length);
            var intendsCopy = $.isChrome ? $.isDuplicate(event) : (dataTransfer.dropEffect === 'copy');

            var $added = null;
            if (isExtant && !intendsCopy)
            {
                // if our drag source is in the same document and we're supposed to move it,
                // then do so directly rather than cloning data.
                $extant.each(function()
                {
                    var $moving = $(this);
                    $moving.trigger('odkControl-removing')
                        .find('.control').trigger('odkControl-removing');
                    $moving.detach();
                    $moving.trigger('odkControl-removed')
                        .find('.control').trigger('odkControl-removed');
                    $moving.insertAfter($placeholder);
                });
                $added = $extant;
            }
            else
            {
                // if our drag source is some other document or we're supposed to copy rather
                // than move, then inflate and insert from data.
                $added = $(_.map(controlData, function(data) { return odkmaker.data.loadOne(data)[0]; }));
                $added.insertAfter($placeholder);

                // if we're chrome, write a key to localStorage to inform the original source of the user's
                // intentions.
                if ($.isChrome && !isExtant) window.localStorage.setItem(parsed.at, intendsCopy ? 'copy' : 'move');
            }

            $added
                .bumpClass('dropped')
                .trigger('odkControl-added')
                .find('.control').trigger('odkControl-added');
            $added.eq(0).bumpClass('droppedHead');
            $added.eq($added.length - 1).bumpClass('droppedTail');

            $placeholder.detach();
            event.preventDefault();
        });

    });
};
$.fn.droppable.defaults = {
    scrollCurve: 3,
    scrollMargin: 75,
    scrollSpeed: 25,
    scrollParent: null
}

})(jQuery);

