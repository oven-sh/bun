use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `.addEventListener()` and `.removeEventListener()` over `on`-functions.
pub struct PreferAddEventListener;

const PREFER_ADD_EVENT_LISTENER: Message =
    Message::new("", "Prefer `addEventListener()` over their `on`-function counterparts.");

/// Sorted.
const DOM_EVENT_TYPE_NAMES: [&str; 198] = [
    "AnimationEnd", "AnimationIteration", "AnimationStart", "DOMAttrModified", "DOMCharacterDataModified",
    "DOMContentLoaded", "DOMNodeInserted", "DOMNodeInsertedIntoDocument", "DOMNodeRemoved",
    "DOMNodeRemovedFromDocument", "DOMSubtreeModified", "MSGestureChange", "MSGestureEnd", "MSGestureHold",
    "MSGestureStart", "MSGestureTap", "MSGotPointerCapture", "MSInertiaStart", "MSLostPointerCapture",
    "MSPointerCancel", "MSPointerDown", "MSPointerEnter", "MSPointerHover", "MSPointerLeave", "MSPointerMove",
    "MSPointerOut", "MSPointerOver", "MSPointerUp", "abort", "activate", "afterblur", "afterprint", "animationcancel",
    "animationend", "animationiteration", "animationstart", "appinstalled", "auxclick", "beforeblur", "beforecopy",
    "beforecut", "beforeinput", "beforeinstallprompt", "beforematch", "beforepaste", "beforeprint", "beforetoggle",
    "beforeunload", "blur", "cancel", "canplay", "canplaythrough", "change", "click", "close", "compositionend",
    "compositionstart", "compositionupdate", "connect", "consolemessage", "contextlost", "contextmenu",
    "contextrestored", "controllerchange", "copy", "cuechange", "cut", "dblclick", "deactivate", "devicechange",
    "devicemotion", "deviceorientation", "drag", "dragend", "dragenter", "dragexit", "dragleave", "dragover",
    "dragstart", "drop", "durationchange", "emptied", "encrypted", "ended", "error", "exit", "fetch", "focus",
    "focusin", "focusout", "foreignfetch", "formdata", "fullscreenchange", "gotpointercapture", "hashchange", "help",
    "input", "install", "invalid", "keydown", "keypress", "keyup", "load", "loadabort", "loadcommit", "loadeddata",
    "loadedmetadata", "loadredirect", "loadstart", "loadstop", "losecapture", "lostpointercapture", "message",
    "messageerror", "mousecancel", "mousedown", "mouseenter", "mouseleave", "mousemove", "mouseout", "mouseover",
    "mouseup", "oanimationend", "oanimationiteration", "oanimationstart", "offline", "online", "open",
    "orientationchange", "otransitionend", "pagehide", "pageshow", "paste", "pause", "play", "playing", "pointercancel",
    "pointerdown", "pointerenter", "pointerleave", "pointermove", "pointerout", "pointerover", "pointerrawupdate",
    "pointerup", "popstate", "progress", "propertychange", "ratechange", "readystatechange", "reset", "resize",
    "responsive", "rightclick", "scroll", "scrollend", "search", "securitypolicyviolation", "seeked", "seeking",
    "select", "selectionchange", "selectstart", "show", "sizechanged", "slotchange", "sourceclosed", "sourceended",
    "sourceopen", "stalled", "statechange", "storage", "submit", "suspend", "text", "textInput", "textinput",
    "timeupdate", "toggle", "touchcancel", "touchend", "touchmove", "touchstart", "transitioncancel", "transitionend",
    "transitionrun", "transitionstart", "unload", "unresponsive", "update", "updateend", "updatefound", "updatestart",
    "visibilitychange", "volumechange", "waiting", "webkitTransitionEnd", "wheel",
];

impl Rule for PreferAddEventListener {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-add-event-listener", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferAddEventListener
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Assign], |_, e, cx| {
            let Some(name) = e.left().and_then(Expr::member_name) else {
                return;
            };
            let Some(mut event) = name.bytes().strip_prefix(b"on") else {
                return;
            };
            while let Some(rest) = event.strip_prefix(b"on") {
                event = rest;
            }
            let is_event = DOM_EVENT_TYPE_NAMES.binary_search_by(|it| it.as_bytes().cmp(event)).is_ok();
            // Not the default value in a pattern.
            if is_event && !e.is_assignment_target() {
                cx.report(name, PREFER_ADD_EVENT_LISTENER);
            }
        });
    }
}
