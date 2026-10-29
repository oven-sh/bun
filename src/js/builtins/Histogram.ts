type Histogram = import("node:perf_hooks").Histogram;

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/histogram.js#L65
$overriddenName = "[nodejs.util.inspect.custom]";
export function inspectCustom(this: Histogram, depth: number, options) {
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
    count: this.count,
    percentiles: this.percentiles,
  };
  const opts = { ...options, depth: options.depth == null ? null : options.depth - 1 };
  return `Histogram ${inspect(fields, opts)}`;
}
