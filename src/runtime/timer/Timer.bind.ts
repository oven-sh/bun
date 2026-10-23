import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::timer::timer::internal_bindings" });

export const timerClockMs = b.fn({ returns: b.f64 });
export const monotonicNowMs = b.fn({ returns: b.f64 });
export const setNextTimerId = b.fn({ args: { id: b.u64.optional }, length: 1, capability: "heap", throws: true });

const chainable = { returns: b.self, passThis: true, invalidThis: "undefined" } as const;
const ref = { ...chainable, rustName: "do_ref" } as const;
const unref = { ...chainable, rustName: "do_unref" } as const;
const destroyed = { getter: b.bool, pure: true } as const;
const hasRef = { returns: b.bool, invalidThis: "undefined" } as const;
const dispose = { capability: "js", invalidThis: "undefined", name: "" } as const;
const toPrimitive = { returns: b.u64, throws: true, invalidThis: "undefined", name: "" } as const;

export const Timeout = b.class({
  rustPath: "crate::timer::TimeoutObject",
  refCounted: true,
  finalize: true,
  types: [table.exactType("$Node.Timeout"), table.exactType("$Bindgen.Timeout")],
  construct: "illegal",
  internalFields: ["arguments", "callback", "idleTimeout", "repeat", "idleStart"],
  proto: {
    _destroyed: destroyed,
    _idleStart: { getter: b.any, setter: { capability: "js" }, passThis: true },
    _idleTimeout: { setter: true, internalField: "idleTimeout" },
    _onTimeout: { setter: true, internalField: "callback" },
    _repeat: { setter: true, internalField: "repeat" },
    close: { ...chainable, capability: "js" },
    hasRef,
    ref,
    refresh: { ...chainable, capability: "js" },
    unref,
    "@@dispose": dispose,
    "@@toPrimitive": toPrimitive,
  },
});

export const Immediate = b.class({
  rustPath: "crate::timer::ImmediateObject",
  refCounted: true,
  finalize: true,
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
