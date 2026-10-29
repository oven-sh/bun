// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/histogram.js#L77
$overriddenName = "[nodejs.util.inspect.custom]";
export function inspectCustom(this: $Bindgen.Histogram, depth: number, options) {
  // What inherits from a histogram: `Object.create(histogram)`, or a prototype, which `console.log()` calls this for.
  if (!$bindgen("histogram.bind.ts", "isHistogram")(this)) return this;
  // Node returns `this`, which is then printed like this because it has own properties.
  if (depth < 0) return options.stylize(`[${this.constructor.name}]`, "special");

  const { inspect } = require("node:util");
  const fields = {
    min: this.min,
    max: this.max,
    mean: this.mean,
    exceeds: this.exceeds,
    stddev: this.stddev,
    skewness: this.skewness,
    kurtosis: this.kurtosis,
    count: this.count,
    percentiles: this.percentiles,
  };
  const opts = { ...options, depth: options.depth == null ? null : options.depth - 1 };
  return `Histogram ${inspect(fields, opts)}`;
}

// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/histogram.js#L589
$overriddenName = "percentilesAt";
export function percentilesAt(this: $Bindgen.Histogram, percentiles: number[]) {
  if (!$bindgen("histogram.bind.ts", "isHistogram")(this)) throw $ERR_INVALID_THIS("Histogram");
  const { validateArray, validateNumber } = require("internal/validators");
  validateArray(percentiles, "percentiles");
  const copy: number[] = [];
  for (let i = 0; i < percentiles.length; i++) {
    const percentile = percentiles[i];
    validateNumber(percentile, `percentiles[${i}]`);
    if (!(percentile > 0 && percentile <= 100)) {
      throw $ERR_OUT_OF_RANGE(`percentiles[${i}]`, "> 0 && <= 100", percentile);
    }
    $putByValDirect(copy, i, percentile);
  }
  return $bindgen("histogram.bind.ts", "percentilesAt")(this, copy);
}

// The range of `percentile` is checked before `options` is looked at.
$overriddenName = "percentileCI";
export function percentileCI(this: $Bindgen.Histogram, percentile: number) {
  if (!$bindgen("histogram.bind.ts", "isHistogram")(this)) throw $ERR_INVALID_THIS("Histogram");
  require("internal/validators").validateNumber(percentile, "percentile");
  if (!(percentile > 0 && percentile <= 100)) throw $ERR_OUT_OF_RANGE("percentile", "> 0 && <= 100", percentile);
  return $bindgen("histogram.bind.ts", "percentileCI")(this, percentile, $argument(1));
}

// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/histogram.js#L630
$overriddenName = "qrde";
export function qrde(this: $Bindgen.Histogram) {
  let options: { bins?: number; probabilities?: number[]; dequantize?: string; cache?: boolean } = $argument(0);
  if (!$bindgen("histogram.bind.ts", "isHistogram")(this)) throw $ERR_INVALID_THIS("Histogram");
  const {
    validateArray,
    validateBoolean,
    validateInteger,
    validateNumber,
    validateObject,
    validateOneOf,
  } = require("internal/validators");
  if (options === undefined) options = require("internal/shared").kEmptyObject;
  validateObject(options, "options");
  const { bins, probabilities, dequantize = "hdr", cache = false } = options;
  if (bins !== undefined && probabilities !== undefined) {
    throw $ERR_INVALID_ARG_VALUE("options", options, '"bins" and "probabilities" are mutually exclusive');
  }

  let boundaries;
  if (probabilities === undefined) {
    const binCount = bins ?? 100;
    validateInteger(binCount, "options.bins", 1, 1000);
    boundaries = $newArrayWithSize(binCount + 1);
    for (let i = 0; i <= binCount; i++) $putByValDirect(boundaries, i, i / binCount);
  } else {
    validateArray(probabilities, "options.probabilities");
    const length = probabilities.length;
    if (length < 2) {
      throw $ERR_INVALID_ARG_VALUE("options.probabilities", probabilities, "must have a length of at least 2");
    }
    if (length > 1001) {
      throw $ERR_OUT_OF_RANGE("options.probabilities.length", ">= 2 && <= 1001", length);
    }
    boundaries = $newArrayWithSize(length);
    let previous = -1;
    for (let i = 0; i < length; i++) {
      const probability = probabilities[i];
      validateNumber(probability, `options.probabilities[${i}]`, 0, 1);
      if (probability <= previous) {
        throw $ERR_INVALID_ARG_VALUE("options.probabilities", probabilities, "must be strictly increasing");
      }
      $putByValDirect(boundaries, i, probability);
      previous = probability;
    }
    if (boundaries[0] !== 0 || boundaries[length - 1] !== 1) {
      throw $ERR_INVALID_ARG_VALUE("options.probabilities", probabilities, "must start with 0 and end with 1");
    }
  }

  validateOneOf(dequantize, "options.dequantize", ["none", "hdr", "all"]);
  // In Node.js it keeps the list of the slots in use. Here the counts are sparse, and making that list costs little.
  validateBoolean(cache, "options.cache");
  return $bindgen("histogram.bind.ts", "qrde")(
    this,
    boundaries,
    dequantize === "none" ? 0 : dequantize === "hdr" ? 1 : 2,
  );
}
