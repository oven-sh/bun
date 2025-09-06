// Internal module for monitorEventLoopDelay implementation
const { validateObject, validateInteger, validateNumber } = require("internal/validators");

// Private C++ bindings for event loop delay monitoring
const cppMonitorEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_monitorEventLoopDelay",
  1,
) as (resolution: number) => import("node:perf_hooks").RecordableHistogram;

const cppEnableEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_enableEventLoopDelay",
  2,
) as (histogram: import("node:perf_hooks").RecordableHistogram, resolution: number) => void;

const cppDisableEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_disableEventLoopDelay",
  1,
) as (histogram: import("node:perf_hooks").RecordableHistogram) => void;

// IntervalHistogram wrapper class for event loop delay monitoring
class IntervalHistogram {
  #histogram: import("node:perf_hooks").RecordableHistogram;
  #resolution: number;
  #enabled: boolean = false;

  constructor(resolution: number) {
    this.#resolution = resolution;
    this.#histogram = cppMonitorEventLoopDelay(resolution);
  }

  enable() {
    if (!this.#enabled) {
      cppEnableEventLoopDelay(this.#histogram, this.#resolution);
      this.#enabled = true;
      return true;
    }
    return false;
  }

  disable() {
    if (this.#enabled) {
      cppDisableEventLoopDelay(this.#histogram);
      this.#enabled = false;
      return true;
    }
    return false;
  }

  reset() {
    this.#histogram.reset();
  }

  get min() {
    return this.#histogram.min;
  }

  get max() {
    return this.#histogram.max;
  }

  get mean() {
    return this.#histogram.mean;
  }

  get stddev() {
    return this.#histogram.stddev;
  }

  get exceeds() {
    return this.#histogram.exceeds;
  }

  get percentiles() {
    return this.#histogram.percentiles;
  }

  percentile(p: number) {
    validateNumber(p, "percentile");
    return this.#histogram.percentile(p);
  }
}

function monitorEventLoopDelay(options?: { resolution?: number }) {
  if (options !== undefined) {
    validateObject(options, "options");
  }

  let resolution = 10;
  if (options?.resolution !== undefined) {
    validateInteger(options.resolution, "options.resolution", 1);
    resolution = options.resolution;
  }

  return new IntervalHistogram(resolution);
}

export default monitorEventLoopDelay;