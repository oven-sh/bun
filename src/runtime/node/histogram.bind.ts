import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::histogram" });

/** What the members of a class that Node.js writes in JavaScript are. */
const nodeClass = { construct: "illegal", configurable: true, enumerable: false, invalidThis: "node" } as const;
const bigInt = { getter: b.u64.asBigInt } as const;
const percentile = {
  args: { percentile: b.f64 },
  expected: { percentile: ["number"] },
  capability: "heap",
  throws: true,
} as const;
/** It can make the counts grow, which it tells the GC of the object. */
const grows = { passThis: true, capability: "heap" } as const;

/** Another histogram to compare this one to. */
const comparison = { args: { other: b.self }, expected: { other: ["Histogram"] } } as const;
const value = { args: { value: b.f64 }, expected: { value: ["number"] } } as const;
const maxSafeInteger = Number.MAX_SAFE_INTEGER;

export const HistogramJSON = b.dictionary({
  count: b.u64,
  min: b.u64,
  max: b.u64,
  mean: b.f64,
  exceeds: b.u64,
  stddev: b.f64,
  skewness: b.f64,
  kurtosis: b.f64,
  ewmaMean: b.f64,
  ewmaStddev: b.f64,
  ewmaErrorRate: b.f64,
  percentiles: b.any,
});

export const ConfidenceOptions = b.dictionary(
  { confidence: { type: b.f64.default(0.95), expected: ["number"] } },
  { reportedAs: "options", validateObject: true },
);
export const MeanCI = b.dictionary({ mean: b.f64, lower: b.f64, upper: b.f64 }, { nullPrototype: true });
export const PercentileCI = b.dictionary({ value: b.u64, lower: b.u64, upper: b.u64 }, { nullPrototype: true });
export const ConfidenceInterval = b.dictionary({ lower: b.f64, upper: b.f64 }, { nullPrototype: true });
export const WelchTest = b.dictionary(
  { tStatistic: b.f64, degreesOfFreedom: b.f64, pValue: b.f64, confidenceInterval: ConfidenceInterval },
  { nullPrototype: true },
);
export const MannWhitneyTest = b.dictionary(
  { uStatistic: b.f64, zScore: b.f64, pValue: b.f64 },
  { nullPrototype: true },
);

/** https://github.com/nodejs/node/blob/v26.12.1/lib/internal/histogram.js */
export const Histogram = b.class({
  ...nodeClass,
  rustPath: "crate::node::histogram::Histogram",
  final: false,
  estimatedSize: true,
  proto: {
    "@@inspectCustom": { builtin: true, length: 2 },
    count: { getter: b.u64 },
    countBigInt: { ...bigInt, rustName: "count" },
    ccdf: { ...value, returns: b.f64 },
    cdf: { ...value, returns: b.f64 },
    countAt: { ...value, returns: b.u64 },
    min: { getter: b.u64 },
    minBigInt: { ...bigInt, rustName: "min" },
    max: { getter: b.u64 },
    maxBigInt: { ...bigInt, rustName: "max" },
    mean: { getter: b.f64 },
    meanCI: {
      args: { options: ConfidenceOptions.default({}) },
      length: 0,
      returns: MeanCI,
      capability: "heap",
      throws: true,
    },
    exceeds: { getter: b.u64 },
    exceedsBigInt: { ...bigInt, rustName: "exceeds" },
    export: { returns: b.bufferSource, capability: "heap", throws: true },
    ewmaMean: { getter: b.f64 },
    ewmaStddev: { getter: b.f64 },
    ewmaErrorRate: { getter: b.f64 },
    burnRate: {
      args: { sloTarget: b.f64 },
      expected: { sloTarget: ["number"] },
      returns: b.f64,
      capability: "heap",
      throws: true,
    },
    ksTest: { ...comparison, returns: b.f64 },
    welchTest: {
      args: { other: b.self, options: ConfidenceOptions.default({}) },
      expected: comparison.expected,
      length: 1,
      returns: WelchTest,
      capability: "heap",
      throws: true,
    },
    mannWhitneyTest: { ...comparison, returns: MannWhitneyTest },
    cohensD: { ...comparison, returns: b.f64 },
    cliffsD: { ...comparison, returns: b.f64 },
    kurtosis: { getter: b.f64 },
    /** A `Map`. */
    linearBuckets: {
      args: { stepSize: b.u64.validateInteger(1, maxSafeInteger) },
      returns: b.any,
      capability: "js",
      throws: true,
    },
    logBuckets: {
      args: { firstBucket: b.u64.validateInteger(1, maxSafeInteger), base: b.f64 },
      expected: { base: ["number"] },
      returns: b.any,
      capability: "js",
      throws: true,
    },
    skewness: { getter: b.f64 },
    stddev: { getter: b.f64 },
    percentile: { ...percentile, returns: b.u64 },
    percentileBigInt: { ...percentile, returns: b.u64.asBigInt, rustName: "percentile" },
    percentileCI: {
      args: { percentile: b.f64, options: ConfidenceOptions.default({}) },
      expected: percentile.expected,
      length: 1,
      returns: PercentileCI,
      capability: "heap",
      throws: true,
    },
    percentiles: { getter: b.any, capability: "js", throws: true },
    percentilesBigInt: { getter: b.any, capability: "js", throws: true },
    percentilesAt: { builtin: true, length: 1 },
    qrde: { builtin: true, length: 0 },
    reset: {},
    resetCount: { getter: b.u64 },
    snapshot: { returns: b.self, capability: "heap" },
    diff: { ...comparison, returns: b.self, capability: "heap", throws: true },
    toJSON: { returns: HistogramJSON, capability: "heap", throws: true },
  },
});

export const RecordableHistogram = b.class({
  ...nodeClass,
  extends: Histogram,
  proto: {
    record: { args: { val: b.any }, length: 1, passThis: true, capability: "js", throws: true },
    recordDelta: grows,
    recordCorrected: {
      args: { val: b.any, expectedInterval: b.any },
      length: 2,
      passThis: true,
      capability: "js",
      throws: true,
    },
    subtract: { args: { other: b.self }, expected: { other: ["RecordableHistogram"] } },
    add: { ...grows, args: { other: b.self }, expected: { other: ["RecordableHistogram"] } },
  },
});

/** https://github.com/nodejs/node/blob/v26.12.1/lib/internal/perf/event_loop_delay.js */
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

export const SlidingWindowHistogram = b.class({
  ...nodeClass,
  rustPath: "crate::node::histogram::SlidingWindowHistogram",
  estimatedSize: true,
  proto: {
    record: { args: { val: b.any }, length: 1, passThis: true, capability: "js", throws: true },
    snapshot: { returns: Histogram, capability: "heap" },
    reset: {},
  },
});

const range = { lowest: b.u64.allowBigInt, highest: b.u64.allowBigInt, figures: b.u32 } as const;

/** Each throws if no histogram has this range and precision. */
export const createRecordable = b.fn({
  args: { ...range, halfLife: b.f64, threshold: b.f64 },
  returns: RecordableHistogram,
  capability: "heap",
  throws: true,
});
export const createInterval = b.fn({
  args: { ...range, resolution: b.f64, samplePerIteration: b.bool },
  returns: ELDHistogram,
  capability: "heap",
  throws: true,
});
export const createSlidingWindow = b.fn({
  /** `rotateAt` is in nanoseconds if `timeBased`, and in records if not. */
  args: { ...range, chunks: b.u32, timeBased: b.bool, rotateAt: b.u64.allowBigInt },
  returns: SlidingWindowHistogram,
  capability: "heap",
  throws: true,
});
export const importHistogram = b.fn({
  args: { data: b.bytes({ from: ["buffer"] }) },
  returns: RecordableHistogram,
  capability: "heap",
  throws: true,
});
export const isHistogram = b.fn({ args: { value: b.any }, returns: b.bool });
/** A `Map` of `percentiles`, in ascending order. */
export const percentilesAt = b.fn({
  args: { histogram: Histogram, percentiles: b.array(b.f64) },
  returns: b.any,
  capability: "js",
  throws: true,
});
/** A promise. `dequantize` is the index of the mode. */
export const qrde = b.fn({
  args: { histogram: Histogram, probabilities: b.array(b.f64), dequantize: b.u32 },
  returns: b.any,
  capability: "js",
});
