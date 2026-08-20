// Internal module for monitorEventLoopDelay implementation
const { validateObject, validateInteger } = require("internal/validators");

const ObjectCreate = Object.create;
const ObjectSetPrototypeOf = Object.setPrototypeOf;

// Private C++ bindings for event loop delay monitoring
const cppMonitorEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_monitorEventLoopDelay",
  1,
) as (resolution: number) => import("node:perf_hooks").IntervalHistogram;

const cppEnableEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_enableEventLoopDelay",
  2,
) as (histogram: import("node:perf_hooks").IntervalHistogram, resolution: number) => void;

const cppDisableEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_disableEventLoopDelay",
  1,
) as (histogram: import("node:perf_hooks").IntervalHistogram) => void;

// IntervalHistogram wrapper class for event loop delay monitoring

let eventLoopDelayHistogram: import("node:perf_hooks").IntervalHistogram | undefined;
let eldPrototype: object | undefined;
let enabled = false;
let resolution = 10;

function enable() {
  if (enabled) {
    return false;
  }

  enabled = true;
  cppEnableEventLoopDelay(eventLoopDelayHistogram!, resolution);
  return true;
}

function disable() {
  if (!enabled) {
    return false;
  }

  enabled = false;
  cppDisableEventLoopDelay(eventLoopDelayHistogram!);
  return true;
}

function ELDHistogram() {
  throw $ERR_ILLEGAL_CONSTRUCTOR();
}

function monitorEventLoopDelay(options?: { resolution?: number }) {
  if (options !== undefined) {
    validateObject(options, "options");
  }

  resolution = 10;
  let resolutionOption = options?.resolution;
  if (typeof resolutionOption !== "undefined") {
    validateInteger(resolutionOption, "options.resolution", 1);
    resolution = resolutionOption;
  }

  if (!eventLoopDelayHistogram) {
    eventLoopDelayHistogram = cppMonitorEventLoopDelay(resolution);
    if (!eldPrototype) {
      // The native object's immediate prototype is the shared read-only
      // Histogram base. Build the ELDHistogram prototype on top of it once.
      const basePrototype = $getPrototypeOf(eventLoopDelayHistogram);
      eldPrototype = ObjectCreate(basePrototype);
      $putByValDirect(eldPrototype, "enable", enable);
      $putByValDirect(eldPrototype, "disable", disable);
      $putByValDirect(eldPrototype, Symbol.dispose, disable);
      $putByValDirect(eldPrototype, "constructor", ELDHistogram);
      ELDHistogram.prototype = eldPrototype;
    }
    ObjectSetPrototypeOf(eventLoopDelayHistogram, eldPrototype);
  }

  return eventLoopDelayHistogram;
}

export default monitorEventLoopDelay;
