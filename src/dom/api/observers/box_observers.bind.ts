import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc, DomElement, Node } from "../core/core.bind.ts";
import { DOMRectReadOnly } from "../geometry/geometry.bind.ts";

export default b.module({ rustPath: "crate::api::observers", feature: "Desktop", isCold: true, membersInTable: false });

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const text = b.DOMString.utf8;
const target = { target: DomElement };

export const BoxObserver = b.interface("BoxObserver", {
  abstract: true,
  rustPath: "crate::api::observers::BoxObserver",
  internalFields: { callback: b.any, document: Doc, root: Node, entries: b.any, thresholds: b.any },
});

export const BoxObservation = b.interface("BoxObservation", {
  noInterfaceObject: true,
  rustPath: "crate::api::observers::BoxObservation",
  // `home` is the document that has it in its list.
  internalFields: { observer: BoxObserver, target: DomElement, home: Doc },
});

export const ObservedBoxes = b.interface("ObservedBoxes", {
  noInterfaceObject: true,
  rustPath: "crate::api::observers::ObservedBoxes",
  internalFields: ["sizes", "intersections", "notified"],
});

export const ResizeObserverBoxOptions = b.enumeration(["content-box", "border-box", "device-pixel-content-box"]);
export const ResizeObserverOptions = b.dictionary({ box: ResizeObserverBoxOptions.default("content-box") }, webidl);

export const ResizeObserver = b.interface("ResizeObserver", {
  exposed: ["Window"],
  extends: BoxObserver,
  construct: { args: { callback: b.callable }, passStructure: true, ...js },
  proto: {
    observe: { args: { ...target, options: ResizeObserverOptions.default({}) }, ...runs },
    unobserve: { args: target, ...heap },
    disconnect: heap,
  },
});

export const ResizeObserverSize = b.interface("ResizeObserverSize", {
  exposed: ["Window"],
  rustPath: "crate::api::observers::ResizeObserverSize",
  proto: { inlineSize: { getter: b.f64 }, blockSize: { getter: b.f64 } },
});

const sizes = { getter: b.frozenArray(ResizeObserverSize), cache: true, ...heap } as const;
export const ResizeObserverEntry = b.interface("ResizeObserverEntry", {
  exposed: ["Window"],
  rustPath: "crate::api::observers::ResizeObserverEntry",
  internalFields: target,
  proto: {
    target: { getter: DomElement, field: "target" },
    contentRect: { getter: DOMRectReadOnly, cache: true, ...heap },
    borderBoxSize: sizes,
    contentBoxSize: sizes,
    devicePixelContentBoxSize: sizes,
  },
});

export const Threshold = b.union({ many: b.sequenceVec(b.double), one: b.double }, webidl);
export const ElementOrDocument = b.union({ element: DomElement, document: Doc }, webidl);
export const IntersectionObserverInit = b.dictionary(
  {
    delay: b.i32.wrap.default(0),
    root: ElementOrDocument.nullable.optional,
    rootMargin: text.default("0px"),
    scrollMargin: text.default("0px"),
    threshold: Threshold.optional,
    trackVisibility: b.bool.loose.default(false),
  },
  webidl,
);

export const IntersectionObserver = b.interface("IntersectionObserver", {
  exposed: ["Window"],
  extends: BoxObserver,
  construct: {
    args: { callback: b.callable, options: IntersectionObserverInit.default({}) },
    passStructure: true,
    ...js,
  },
  proto: {
    root: { getter: Node.nullable, field: "root" },
    rootMargin: { getter: text },
    scrollMargin: { getter: text },
    thresholds: { getter: b.frozenArray(b.f64), cache: "thresholds" },
    delay: { getter: b.i32 },
    trackVisibility: { getter: b.bool },
    observe: { args: target, ...runs },
    unobserve: { args: target, ...heap },
    disconnect: heap,
    takeRecords: { returns: b.any, ...heap },
  },
});

const rect = { getter: DOMRectReadOnly, cache: true, ...heap } as const;
export const IntersectionObserverEntry = b.interface("IntersectionObserverEntry", {
  exposed: ["Window"],
  rustPath: "crate::api::observers::IntersectionObserverEntry",
  internalFields: target,
  proto: {
    time: { getter: b.f64 },
    rootBounds: { ...rect, getter: DOMRectReadOnly.nullable },
    boundingClientRect: rect,
    intersectionRect: rect,
    isIntersecting: { getter: b.bool },
    isVisible: { getter: b.bool },
    intersectionRatio: { getter: b.f64 },
    target: { getter: DomElement, field: "target" },
  },
});
