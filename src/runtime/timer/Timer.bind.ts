import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::timer::timer::internal_bindings" });

export const monotonicNowMs = b.fn({ returns: b.f64 });

const invalidThis = "undefined";
const chained = { returns: b.self, passThis: true, capability: "heap", invalidThis } as const;
const construct = { capability: "heap", throws: true } as const;
const destroyed = { getter: b.bool, rustName: "get_destroyed" } as const;
const hasRef = { returns: b.bool, invalidThis } as const;
const ref = { ...chained, rustName: "do_ref" } as const;
const unref = { ...chained, rustName: "do_unref" } as const;
const dispose = { invalidThis, name: "" } as const;
const toPrimitive = { returns: b.i32, throws: true, invalidThis, name: "" } as const;

export const Timeout = b.class({
  rustPath: "crate::timer::TimeoutObject",
  refCounted: true,
  finalize: true,
  fromJS: true,
  configurable: false,
  construct,
  internalFields: ["arguments", "callback", "idleTimeout", "repeat", "idleStart"],
  proto: {
    _destroyed: destroyed,
    _idleStart: { getter: b.any, setter: true, passThis: true, capability: "heap" },
    _idleTimeout: { internalField: "idleTimeout", setter: true },
    _onTimeout: { internalField: "callback", setter: true },
    _repeat: { internalField: "repeat", setter: true },
    close: chained,
    hasRef,
    ref,
    refresh: { ...chained, rustName: "do_refresh" },
    unref,
    "@@dispose": dispose,
    "@@toPrimitive": toPrimitive,
  },
});

export const Immediate = b.class({
  rustPath: "crate::timer::ImmediateObject",
  refCounted: true,
  finalize: true,
  fromJS: true,
  configurable: false,
  construct,
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
