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
) as (histogram: import("node:perf_hooks").RecordableHistogram, resolution: number) => boolean;

const cppDisableEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_disableEventLoopDelay",
  1,
) as (histogram: import("node:perf_hooks").RecordableHistogram) => boolean;

function monitorEventLoopDelay(options?: { resolution?: number }) {
  if (options !== undefined) {
    validateObject(options, "options");
  }

  let resolution = 10;
  const resolutionOption = options?.resolution;
  if (typeof resolutionOption !== "undefined") {
    validateInteger(resolutionOption, "options.resolution", 1);
    resolution = resolutionOption;
  }

  const histogram = cppMonitorEventLoopDelay(resolution);
  const enable = () => cppEnableEventLoopDelay(histogram, resolution);
  const disable = () => cppDisableEventLoopDelay(histogram);
  $putByValDirect(histogram, "enable", enable);
  $putByValDirect(histogram, "disable", disable);
  $putByValDirect(histogram, Symbol.dispose, disable);

  return histogram;
}

export default monitorEventLoopDelay;
