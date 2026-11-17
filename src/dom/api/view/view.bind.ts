import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc, DomElement } from "../core/core.bind.ts";
import { HTMLElement } from "../core/html.bind.ts";
import { CSSStyleProperties, MediaQueryList } from "../cssom/cssom.bind.ts";
import { DOMRect, DOMRectList } from "../geometry/geometry.bind.ts";
import { DomWindow } from "../window/window.bind.ts";

export default b.module({ rustPath: "crate::api::view", feature: "Desktop", isCold: true });

const runs = { capability: "js" } as const;
const webidl = { webidl: true } as const;
const number = b.f64.loose;
const flag = b.bool.loose.default(false);

export const ScrollBehavior = b.enumeration(["auto", "instant", "smooth"]);
export const ScrollOptions = b.dictionary({ behavior: ScrollBehavior.default("auto") }, webidl);
export const ScrollToOptions = b.dictionary(
  { left: number.optional, top: number.optional },
  { webidl: true, extends: ScrollOptions },
);
export const ScrollLogicalPosition = b.enumeration(["start", "center", "end", "nearest"]);
export const ScrollIntoViewContainer = b.enumeration(["all", "nearest"]);
export const ScrollIntoViewOptions = b.dictionary(
  {
    block: ScrollLogicalPosition.default("start"),
    container: ScrollIntoViewContainer.default("all"),
    inline: { type: ScrollLogicalPosition.default("nearest"), rustName: "inline_position" },
  },
  { webidl: true, extends: ScrollOptions },
);
export const AlignmentOrOptions = b.union({ toTop: b.bool.loose, options: ScrollIntoViewOptions }, webidl);
export const CheckVisibilityOptions = b.dictionary(
  {
    checkOpacity: flag,
    checkVisibilityCSS: flag,
    contentVisibilityAuto: flag,
    opacityProperty: flag,
    visibilityProperty: flag,
  },
  webidl,
);

const scrolls = (name: string) => [
  { args: { options: ScrollToOptions.default({}) }, rustName: name, returns: b.any, rejects: true, ...runs },
  { args: { x: number, y: number }, rustName: name + "_point", returns: b.any, rejects: true, ...runs },
];
const metric = { getter: b.f64, ...runs } as const;
const offset = { getter: number, setter: true, ...runs } as const;

export const ElementView = b.partial("ElementView", {
  on: DomElement,
  proto: {
    getClientRects: { returns: DOMRectList, ...runs },
    getBoundingClientRect: { returns: DOMRect, isCold: false, ...runs },
    checkVisibility: { args: { options: CheckVisibilityOptions.default({}) }, returns: b.bool, ...runs },
    scrollIntoView: { args: { arg: AlignmentOrOptions.optional }, returns: b.any, rejects: true, ...runs },
    scrollIntoViewIfNeeded: { args: { centerIfNeeded: b.bool.loose.default(true) }, ...runs },
    scroll: scrolls("scroll_to"),
    scrollTo: scrolls("scroll_to"),
    scrollBy: scrolls("scroll_by"),
    scrollTop: offset,
    scrollLeft: offset,
    scrollWidth: metric,
    scrollHeight: metric,
    clientTop: metric,
    clientLeft: metric,
    clientWidth: metric,
    clientHeight: metric,
    currentCSSZoom: metric,
  },
});

export const DocumentView = b.partial("DocumentView", {
  on: Doc,
  proto: { scrollingElement: { getter: DomElement.nullable, ...runs } },
});

export const HTMLElementView = b.partial("HTMLElementView", {
  on: HTMLElement,
  proto: {
    scrollParent: { returns: DomElement.nullable, ...runs },
    offsetParent: { getter: DomElement.nullable, ...runs },
    offsetTop: metric,
    offsetLeft: metric,
    offsetWidth: metric,
    offsetHeight: metric,
  },
});

export const WindowView = b.partial("WindowView", {
  on: DomWindow,
  proto: {
    getComputedStyle: {
      args: { elt: DomElement, pseudoElt: b.DOMString.utf8.nullable.optional },
      returns: CSSStyleProperties,
      otherReceivers: "Bun::Bindgen::Generated::Cssom::jsGetComputedStyle",
      capability: "heap",
    },
    matchMedia: { args: { query: b.DOMString.utf8 }, returns: MediaQueryList, ...runs },
    scroll: scrolls("scroll_to"),
    scrollTo: scrolls("scroll_to"),
    scrollBy: scrolls("scroll_by"),
  },
});
