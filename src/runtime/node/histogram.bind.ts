import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::histogram" });

/** What the members of a class that Node.js writes in JavaScript are. */
const nodeClass = { construct: "illegal", configurable: true, enumerable: false } as const;
const bigInt = { getter: b.u64.asBigInt } as const;
const percentile = {
  args: { percentile: b.f64 },
  expected: { percentile: ["number"] },
  capability: "heap",
  throws: true,
} as const;
/** It can make the counts grow, which it tells the GC of the object. */
const grows = { passThis: true, capability: "heap" } as const;

export const HistogramJSON = b.dictionary({
  count: b.u64,
  min: b.u64,
  max: b.u64,
  mean: b.f64,
  exceeds: b.u64,
  stddev: b.f64,
  percentiles: b.any,
});

/** https://github.com/nodejs/node/blob/v26.3.0/lib/internal/histogram.js */
export const Histogram = b.class({
  ...nodeClass,
  rustPath: "crate::node::histogram::Histogram",
  final: false,
  estimatedSize: true,
  proto: {
    count: { getter: b.u64 },
    countBigInt: { ...bigInt, rustName: "count" },
    min: { getter: b.u64 },
    minBigInt: { ...bigInt, rustName: "min" },
    max: { getter: b.u64 },
    maxBigInt: { ...bigInt, rustName: "max" },
    mean: { getter: b.f64 },
    exceeds: { getter: b.u64 },
    exceedsBigInt: { ...bigInt, rustName: "exceeds" },
    stddev: { getter: b.f64 },
    percentile: { ...percentile, returns: b.u64 },
    percentileBigInt: { ...percentile, returns: b.u64.asBigInt, rustName: "percentile" },
    /** A `Map`. */
    percentiles: { getter: b.any, capability: "js", throws: true },
    percentilesBigInt: { getter: b.any, capability: "js", throws: true },
    reset: {},
    toJSON: { returns: HistogramJSON, capability: "heap", throws: true },
    "@@inspectCustom": { builtin: true, length: 2 },
  },
});

export const RecordableHistogram = b.class({
  ...nodeClass,
  extends: Histogram,
  proto: {
    record: { args: { val: b.any }, length: 1, passThis: true, capability: "js", throws: true },
    recordDelta: grows,
    add: { ...grows, args: { other: b.self }, expected: { other: ["RecordableHistogram"] } },
  },
});

/** https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/event_loop_delay.js */
export const ELDHistogram = b.class({
  ...nodeClass,
  extends: Histogram,
  proto: {
    /** Whether it was disabled. */
    enable: { returns: b.bool },
    /** Whether it was enabled. */
    disable: { returns: b.bool },
    "@@dispose": { builtin: true, length: 0 },
  },
});

/** `null` if no histogram has this range and precision. */
export const createRecordable = b.fn({
  args: { lowest: b.u64.allowBigInt, highest: b.u64.allowBigInt, figures: b.u32 },
  returns: RecordableHistogram.nullable,
  capability: "heap",
});
export const createInterval = b.fn({ args: { resolution: b.f64 }, returns: ELDHistogram, capability: "heap" });
export const isHistogram = b.fn({ args: { value: b.any }, returns: b.bool });
