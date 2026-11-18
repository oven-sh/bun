// https://html.spec.whatwg.org/#event-handlers-on-elements,-document-objects,-and-window-objects
import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, Doc, DomElement, ShadowRoot } from "../core/core.bind.ts";
import { HTMLBodyElement, HTMLElement, HTMLFrameSetElement, MathMLElement } from "../core/html.bind.ts";
import { SVGAnimationElement, SVGElement, SVGSVGElement } from "../svg/svg.bind.ts";

export default b.module({ rustPath: "crate::api::events::attributes", feature: "Desktop", isCold: true });

const accessor = { getter: b.any, setter: true, capability: "js" } as const;
export const Handler = b.family("Handler", { on: DesktopEventTarget, ...accessor });
export const HandlerOfWindow = b.family("HandlerOfWindow", { on: DomElement, ...accessor });

const isLenient = /^(?:mouseenter|mouseleave|readystatechange)$/;
const on = (names: string, family = Handler) =>
  Object.fromEntries(
    names.split(/\s+/).map(it => ["on" + it, family.of(undefined, isLenient.test(it) ? { lenientThis: true } : {})]),
  );

export const GlobalEventHandlers = b.mixin("GlobalEventHandlers", {
  on: DesktopEventTarget,
  proto: on(`abort animationcancel animationend animationiteration animationstart auxclick beforeinput beforematch
    beforetoggle beforexrselect blur cancel canplay canplaythrough change click close command
    contentvisibilityautostatechange contextlost contextmenu contextrestored cuechange dblclick drag dragend dragenter
    dragleave dragover dragstart drop durationchange emptied ended error focus formdata gotpointercapture input invalid
    keydown keypress keyup load loadeddata loadedmetadata loadstart lostpointercapture mousedown mouseenter mouseleave
    mousemove mouseout mouseover mouseup mousewheel pause play playing pointercancel pointerdown pointerenter
    pointerleave pointermove pointerout pointerover pointerrawupdate pointerup progress ratechange reset resize scroll
    scrollend scrollsnapchange scrollsnapchanging securitypolicyviolation seeked seeking select selectionchange
    selectstart slotchange stalled submit suspend timeupdate toggle transitioncancel transitionend transitionrun
    transitionstart volumechange waiting webkitanimationend webkitanimationiteration webkitanimationstart
    webkittransitionend wheel`),
});
export const DocumentAndElementEventHandlers = b.mixin("DocumentAndElementEventHandlers", {
  on: DesktopEventTarget,
  proto: on("copy cut paste"),
});
for (const it of [HTMLElement, SVGElement, MathMLElement, Doc])
  for (const mixin of [GlobalEventHandlers, DocumentAndElementEventHandlers]) b.include(it, mixin);

export const ClipboardHandlers = b.mixin("ClipboardHandlers", {
  on: DesktopEventTarget,
  proto: on("beforecopy beforecut beforepaste"),
});
export const FullscreenHandlers = b.mixin("FullscreenHandlers", {
  on: DesktopEventTarget,
  proto: on("fullscreenchange fullscreenerror webkitfullscreenchange webkitfullscreenerror"),
});
for (const it of [DomElement, Doc]) for (const mixin of [ClipboardHandlers, FullscreenHandlers]) b.include(it, mixin);

export const WindowEventHandlers = b.mixin("WindowEventHandlers", {
  on: DomElement,
  proto: on(
    `afterprint beforeprint beforeunload hashchange languagechange message messageerror offline online pagehide
    pagereveal pageshow pageswap popstate rejectionhandled storage unhandledrejection unload`,
    HandlerOfWindow,
  ),
});
for (const it of [HTMLBodyElement, HTMLFrameSetElement, SVGSVGElement]) b.include(it, WindowEventHandlers);

export const WindowReflectingHandlers = b.mixin("WindowReflectingHandlers", {
  on: DomElement,
  proto: on("blur error focus load resize scroll", HandlerOfWindow),
});
for (const it of [HTMLBodyElement, HTMLFrameSetElement]) b.include(it, WindowReflectingHandlers);

export const ElementHandlers = b.partial("ElementHandlers", { on: DomElement, proto: on("search") });
export const ShadowRootHandlers = b.partial("ShadowRootHandlers", { on: ShadowRoot, proto: on("slotchange") });
export const TimeHandlers = b.partial("TimeHandlers", { on: SVGAnimationElement, proto: on("begin end repeat") });
export const DocumentHandlers = b.partial("DocumentHandlers", {
  on: Doc,
  proto: on("freeze pointerlockchange pointerlockerror readystatechange resume visibilitychange"),
});
