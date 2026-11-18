import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";

export default b.module({ rustPath: "crate::api::events", feature: "Desktop" });

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const flag = b.bool.loose.default(false);
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const pure = <T>(getter: T) => ({ getter, pure: true }) as const;

export const DesktopEventInit = b.dictionary({ bubbles: flag, cancelable: flag, composed: flag }, { webidl: true });

export const DesktopEvent = b.interface("DesktopEvent", {
  name: "Event",
  rustPath: "crate::api::events::Event",
  size: 40,
  inlineCapacity: 2,
  internalFields: ["target", "currentTarget", "relatedTarget", "pseudoTarget", "native"],
  constants: { NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 },
  construct: { args: { type: atom, init: DesktopEventInit.default({}) } },
  proto: {
    type: { getter: atom, ...heap },
    target: { getter: b.object.nullable, field: "target" },
    srcElement: { getter: b.object.nullable, field: "target" },
    currentTarget: { getter: b.object.nullable, field: "currentTarget" },
    eventPhase: pure(b.u16),
    bubbles: pure(b.bool),
    cancelable: pure(b.bool),
    composed: pure(b.bool),
    isTrusted: { getter: b.bool, unforgeable: true, rustName: "trusted" },
    defaultPrevented: pure(b.bool),
    timeStamp: { getter: b.f64, ...heap },
    cancelBubble: { getter: b.bool.loose, setter: true },
    returnValue: { getter: b.bool.loose, setter: true },
    composedPath: { returns: b.any.returning("Array"), capability: "heap", throws: true },
    stopPropagation: {},
    stopImmediatePropagation: {},
    preventDefault: { rustName: "cancel" },
    initEvent: { args: { type: atom, bubbles: flag, cancelable: flag } },
  },
});

const init = (members: Record<string, any>) => b.dictionary(members, { webidl: true, extends: DesktopEventInit });
const construct = (init: any) =>
  ({ args: { type: atom, init: init.default({}) }, passStructure: true, ...heap }) as const;

export const DesktopCustomEventInit = init({ detail: b.any.omittable });
export const DesktopCustomEvent = b.interface("DesktopCustomEvent", {
  name: "CustomEvent",
  extends: DesktopEvent,
  internalFields: ["detail"],
  rustPath: "crate::api::events::CustomEvent",
  construct: construct(DesktopCustomEventInit),
  proto: {
    detail: { getter: b.any },
    initCustomEvent: { args: { type: atom, bubbles: flag, cancelable: flag, detail: b.any.omittable } },
  },
});

export const DesktopErrorEventInit = init({
  colno: b.u32.wrap.default(0),
  error: b.any.omittable,
  filename: usv.default(""),
  lineno: b.u32.wrap.default(0),
  message: string.default(""),
});
export const DesktopErrorEvent = b.interface("DesktopErrorEvent", {
  membersInTable: false,
  name: "ErrorEvent",
  extends: DesktopEvent,
  internalFields: ["error"],
  rustPath: "crate::api::events::ErrorEvent",
  construct: construct(DesktopErrorEventInit),
  proto: {
    message: { getter: string, ...heap },
    filename: { getter: string, ...heap },
    lineno: pure(b.u32),
    colno: pure(b.u32),
    error: { getter: b.any },
  },
});

export const BeforeUnloadEvent = b.interface("BeforeUnloadEvent", {
  membersInTable: false,
  extends: DesktopEvent,
  rustPath: "crate::api::events::BeforeUnloadEvent",
  proto: { returnValue: { getter: string, setter: true, rustName: "message", ...heap } },
});

/** What has the listeners of a global object. */
export const WindowTarget = b.interface("WindowTarget", {
  extends: DesktopEventTarget,
  rustPath: "crate::api::events::WindowTarget",
  size: 56,
  abstract: true,
  internalFields: { window: b.any, document: b.ref("Doc"), host: b.any, event: b.any },
});

export const Listeners = b.interface("Listeners", {
  rustPath: "crate::api::events::listeners::Listeners",
  noInterfaceObject: true,
  internalFields: ["first", "second", "rest"],
});

export const OnEvent = b.family("OnEvent", {
  on: DesktopEventTarget,
  key: "crate::api::core::Known",
  getter: b.any,
  setter: true,
  ...runs,
});
