// Internal module for monitorEventLoopDelay implementation
const { validateObject, validateInteger } = require("internal/validators");

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

let eventLoopDelayHistogram: import("node:perf_hooks").RecordableHistogram | undefined;
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
    $putByValDirect(eventLoopDelayHistogram, "enable", enable);
    $putByValDirect(eventLoopDelayHistogram, "disable", disable);
    $putByValDirect(eventLoopDelayHistogram, Symbol.dispose, disable);
  }

  return eventLoopDelayHistogram;
}

export default monitorEventLoopDelay;
