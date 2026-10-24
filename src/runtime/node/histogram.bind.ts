import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::histogram" });

/**
 * What every histogram of `node:perf_hooks` is. The classes are written in JavaScript (`internal/perf_hooks/histogram`),
 * which gives an instance its prototype, and the struct says which of them it belongs to. JavaScript never sees the
 * prototype it is made with.
 */
export const Histogram = b.class({
  rustPath: "crate::node::histogram::Histogram",
  estimatedSize: true,
});

/** A `RecordableHistogram`, or `null` if no histogram has this range and precision. */
export const createRecordable = b.fn({
  args: { lowest: b.u64.allowBigInt, highest: b.u64.allowBigInt, figures: b.u32 },
  returns: Histogram.nullable,
  capability: "heap",
});
/** An `ELDHistogram`. */
export const createInterval = b.fn({ args: { resolution: b.f64 }, returns: Histogram, capability: "heap" });
export const isHistogram = b.fn({ args: { value: b.any }, returns: b.bool });
export const isRecordable = b.fn({ args: { value: b.any }, returns: b.bool });

// `receiver` is the `this` of a member of one of the classes. One that is not an instance throws `ERR_INVALID_THIS`,
// before the arguments are looked at. An argument that Node's validators refuse makes the result `false` or `null`, and
// the method then calls the validator for its error.
const member = { capability: "heap", throws: true } as const;
const receiver = { receiver: b.any };
const getter = (rustName: string, returns: b.Type) =>
  b.fn({ ...member, args: receiver, returns, rustPath: `crate::node::histogram::${rustName}` });

export const count = getter("count", b.u64);
export const countBigInt = getter("count", b.u64.asBigInt);
export const min = getter("min", b.u64);
export const minBigInt = getter("min", b.u64.asBigInt);
export const max = getter("max", b.u64);
export const maxBigInt = getter("max", b.u64.asBigInt);
export const mean = getter("mean", b.f64);
export const exceeds = getter("exceeds", b.u64);
export const exceedsBigInt = getter("exceeds", b.u64.asBigInt);
export const stddev = getter("stddev", b.f64);
/** A `Map`. */
export const percentiles = b.fn({ capability: "js", throws: true, args: receiver, returns: b.any });
export const percentilesBigInt = b.fn({ capability: "js", throws: true, args: receiver, returns: b.any });
export const percentile = b.fn({ ...member, args: { ...receiver, percentile: b.any }, returns: b.u64.nullable });
export const percentileBigInt = b.fn({ ...member, args: { ...receiver, percentile: b.any }, returns: b.any });
export const reset = b.fn({ ...member, args: receiver });

export const record = b.fn({ ...member, args: { ...receiver, value: b.any }, returns: b.bool });
export const recordDelta = b.fn({ ...member, args: receiver });
export const add = b.fn({ ...member, args: { ...receiver, other: b.any }, returns: b.bool });

/** Whether it was disabled. */
export const enable = b.fn({ ...member, args: receiver, returns: b.bool });
/** Whether it was enabled. */
export const disable = b.fn({ ...member, args: receiver, returns: b.bool });
