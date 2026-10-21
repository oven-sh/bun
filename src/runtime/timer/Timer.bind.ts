import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::timer::timer::internal_bindings" });

export const monotonicNowMs = b.fn({ returns: b.f64 });

const chainable = { returns: b.self, passThis: true, invalidThis: "undefined" } as const;
const destroyed = { getter: b.bool } as const;
const hasRef = { returns: b.bool, invalidThis: "undefined" } as const;
const ref = { ...chainable, rustName: "do_ref" } as const;
const unref = { ...chainable, rustName: "do_unref" } as const;
const dispose = { capability: "js", invalidThis: "undefined", name: "" } as const;
const toPrimitive = { returns: b.u64, throws: true, invalidThis: "undefined", name: "" } as const;

export const Timeout = b.class({
  rustPath: "crate::timer::TimeoutObject",
  refCounted: true,
  finalize: true,
  configurable: false,
  construct: "illegal",
  internalFields: ["arguments", "callback", "idleTimeout", "repeat", "idleStart"],
  proto: {
    _destroyed: destroyed,
    _idleStart: { getter: b.any, setter: { capability: "js" }, passThis: true },
    _idleTimeout: { internalField: "idleTimeout", setter: true },
    _onTimeout: { internalField: "callback", setter: true },
    _repeat: { internalField: "repeat", setter: true },
    close: { ...chainable, capability: "js" },
    hasRef,
    ref,
    refresh: { ...chainable, capability: "js", rustName: "do_refresh" },
    unref,
    "@@dispose": dispose,
    "@@toPrimitive": toPrimitive,
  },
});

export const Immediate = b.class({
  rustPath: "crate::timer::ImmediateObject",
  refCounted: true,
  finalize: true,
  configurable: false,
  construct: "illegal",
  internalFields: ["arguments", "callback"],
  proto: {
    _destroyed: destroyed,
    hasRef,
    ref,
    unref,
    "@@dispose": dispose,
    "@@toPrimitive": toPrimitive,
  },
});
