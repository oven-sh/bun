import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::timer::timer::internal_bindings" });

export const timerClockMs = b.fn({ returns: b.f64 });
export const monotonicNowMs = b.fn({ returns: b.f64 });
export const setNextTimerId = b.fn({ args: { id: b.u64.optional }, length: 1, capability: "heap", throws: true });

// These change flags of the native timer and its place among the timers that wait. None of them keeps the wrapper or hands it to anybody but the caller.
const inspectsTimer = { this: table.inspected };
const answersTimer = { this: [table.returned] };
// The handle of the native timer holds the wrapper again. Only the firing takes it out, as `this` of the callback of that timer, which the entry that stored the callback says.
const keepsTimer = { this: [table.returned, table.storedIn(table.nativeCell("Timeout.wrapper"))] };

// As a method of Node's class: https://github.com/nodejs/node/blob/v26.12.1/lib/internal/timers.js#L215 (Timeout), #L746 (Immediate)
const classMethod = { configurable: true, enumerable: false } as const;

const chainable = {
  returns: b.self,
  passThis: true,
  answersThis: true,
  invalidThis: "undefined",
  uses: answersTimer,
} as const;
const ref = { ...chainable, ...classMethod, rustName: "do_ref" } as const;
const unref = { ...chainable, ...classMethod, rustName: "do_unref" } as const;
const destroyed = { getter: b.bool, pure: true } as const;
const hasRef = { ...classMethod, returns: b.bool, invalidThis: "undefined", uses: inspectsTimer } as const;
const dispose = { capability: "js", invalidThis: "undefined", name: "", uses: inspectsTimer } as const;
const toPrimitive = { returns: b.u64, throws: true, invalidThis: "undefined", name: "", uses: inspectsTimer } as const;

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
    _onTimeout: { getter: b.any, setter: { capability: "js" }, passThis: true },
    _repeat: { setter: true, internalField: "repeat" },
    // Node assigns it to the prototype, which leaves it enumerable: https://github.com/nodejs/node/blob/v26.12.1/lib/timers.js#L186
    close: { ...chainable, capability: "js", configurable: true },
    hasRef,
    ref,
    refresh: { ...chainable, ...classMethod, capability: "js", uses: keepsTimer },
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
