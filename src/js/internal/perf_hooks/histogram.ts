// The histogram classes of node:perf_hooks.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/histogram.js
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/event_loop_delay.js
//
// An instance is a native object that was given the prototype of its class. The native functions take it as their first
// argument and throw ERR_INVALID_THIS for anything else.
const { validateInteger, validateNumber, validateObject } = require("internal/validators");
const { kEmptyObject } = require("internal/shared");

const createRecordable = $bindgen("histogram.bind.ts", "createRecordable");
const createInterval = $bindgen("histogram.bind.ts", "createInterval");
const isHistogram = $bindgen("histogram.bind.ts", "isHistogram");
const isRecordable = $bindgen("histogram.bind.ts", "isRecordable");
const count = $bindgen("histogram.bind.ts", "count");
const countBigInt = $bindgen("histogram.bind.ts", "countBigInt");
const min = $bindgen("histogram.bind.ts", "min");
const minBigInt = $bindgen("histogram.bind.ts", "minBigInt");
const max = $bindgen("histogram.bind.ts", "max");
const maxBigInt = $bindgen("histogram.bind.ts", "maxBigInt");
const mean = $bindgen("histogram.bind.ts", "mean");
const exceeds = $bindgen("histogram.bind.ts", "exceeds");
const exceedsBigInt = $bindgen("histogram.bind.ts", "exceedsBigInt");
const stddev = $bindgen("histogram.bind.ts", "stddev");
const percentile = $bindgen("histogram.bind.ts", "percentile");
const percentileBigInt = $bindgen("histogram.bind.ts", "percentileBigInt");
const percentiles = $bindgen("histogram.bind.ts", "percentiles");
const percentilesBigInt = $bindgen("histogram.bind.ts", "percentilesBigInt");
const reset = $bindgen("histogram.bind.ts", "reset");
const record = $bindgen("histogram.bind.ts", "record");
const recordDelta = $bindgen("histogram.bind.ts", "recordDelta");
const add = $bindgen("histogram.bind.ts", "add");
const enable = $bindgen("histogram.bind.ts", "enable");
const disable = $bindgen("histogram.bind.ts", "disable");

const ObjectFromEntries = Object.fromEntries;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const NumberMAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const kInt64Max = 2n ** 63n - 1n;

function throwInvalidPercentile(percentile): never {
  validateNumber(percentile, "percentile");
  throw $ERR_OUT_OF_RANGE("percentile", "> 0 && <= 100", percentile);
}

class Histogram {
  constructor() {
    throw $ERR_ILLEGAL_CONSTRUCTOR();
  }

  [Symbol.for("nodejs.util.inspect.custom")](depth: number, options) {
    // A prototype: `console.log()` calls this for one, `util.inspect()` does not.
    if (!isHistogram(this)) return this;
    // Node returns `this`, which is then printed like this because it has own properties.
    if (depth < 0) return options.stylize(`[${this.constructor.name}]`, "special");

    const opts = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const { inspect } = require("node:util");
    const fields = {
      min: this.min,
      max: this.max,
      mean: this.mean,
      exceeds: this.exceeds,
      stddev: this.stddev,
      count: this.count,
      percentiles: this.percentiles,
    };
    return `Histogram ${inspect(fields, opts)}`;
  }

  get count(): number {
    return count(this);
  }

  get countBigInt(): bigint {
    return countBigInt(this);
  }

  get min(): number {
    return min(this);
  }

  get minBigInt(): bigint {
    return minBigInt(this);
  }

  get max(): number {
    return max(this);
  }

  get maxBigInt(): bigint {
    return maxBigInt(this);
  }

  get mean(): number {
    return mean(this);
  }

  get exceeds(): number {
    return exceeds(this);
  }

  get exceedsBigInt(): bigint {
    return exceedsBigInt(this);
  }

  get stddev(): number {
    return stddev(this);
  }

  percentile(value: number): number {
    return percentile(this, value) ?? throwInvalidPercentile(value);
  }

  percentileBigInt(value: number): bigint {
    return percentileBigInt(this, value) ?? throwInvalidPercentile(value);
  }

  get percentiles(): Map<number, number> {
    return percentiles(this);
  }

  get percentilesBigInt(): Map<number, bigint> {
    return percentilesBigInt(this);
  }

  reset(): void {
    reset(this);
  }

  toJSON() {
    return {
      count: this.count,
      min: this.min,
      max: this.max,
      mean: this.mean,
      exceeds: this.exceeds,
      stddev: this.stddev,
      percentiles: ObjectFromEntries(this.percentiles),
    };
  }
}

class RecordableHistogram extends Histogram {
  record(val: number | bigint): void {
    if (!record(this, val)) validateInteger(val, "val", 1);
  }

  recordDelta(): void {
    recordDelta(this);
  }

  add(other: RecordableHistogram): void {
    if (!add(this, other)) throw $ERR_INVALID_ARG_TYPE("other", ["RecordableHistogram"], other);
  }
}

class ELDHistogram extends Histogram {
  enable(): boolean {
    return enable(this);
  }

  disable(): boolean {
    return disable(this);
  }

  [Symbol.dispose](): void {
    this.disable();
  }
}

function createHistogram(
  options: { lowest?: number | bigint; highest?: number | bigint; figures?: number } = kEmptyObject,
) {
  validateObject(options, "options");
  const { lowest = 1, highest = NumberMAX_SAFE_INTEGER, figures = 3 } = options;
  if (typeof lowest !== "bigint") {
    validateInteger(lowest, "options.lowest", 1, NumberMAX_SAFE_INTEGER);
  } else if (lowest < 1n || lowest > kInt64Max) {
    throw $ERR_OUT_OF_RANGE("options.lowest", `>= 1n && <= ${kInt64Max}n`, lowest);
  }
  if (typeof highest !== "bigint") {
    validateInteger(highest, "options.highest", 2 * Number(lowest), NumberMAX_SAFE_INTEGER);
  } else if (highest < 2n * BigInt(lowest)) {
    throw $ERR_INVALID_ARG_VALUE_RangeError("options.highest", highest);
  } else if (highest > kInt64Max) {
    throw $ERR_OUT_OF_RANGE("options.highest", `<= ${kInt64Max}n`, highest);
  }
  validateInteger(figures, "options.figures", 1, 5);

  const histogram = createRecordable(lowest, highest, figures);
  if (histogram === null) {
    throw $ERR_INVALID_ARG_VALUE("options.lowest", lowest, `is too large for ${figures} significant figures`);
  }
  return ObjectSetPrototypeOf(histogram, RecordableHistogram.prototype);
}

function monitorEventLoopDelay(options: { resolution?: number } = kEmptyObject) {
  validateObject(options, "options");

  const { resolution = 10 } = options;
  validateInteger(resolution, "options.resolution", 1);

  return ObjectSetPrototypeOf(createInterval(resolution), ELDHistogram.prototype);
}

/** Gives the native object that a structured clone made its prototype. A clone of an `ELDHistogram` is a `Histogram`. */
function adopt(histogram) {
  ObjectSetPrototypeOf(histogram, isRecordable(histogram) ? RecordableHistogram.prototype : Histogram.prototype);
}

export default {
  adopt,
  createHistogram,
  isHistogram,
  monitorEventLoopDelay,
};
