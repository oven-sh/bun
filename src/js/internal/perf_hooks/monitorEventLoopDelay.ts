// Internal module for monitorEventLoopDelay implementation
const { validateObject, validateInteger } = require("internal/validators");

// Creates the ELDHistogram. enable(), disable() and [Symbol.dispose]() are on its prototype.
const cppMonitorEventLoopDelay = $newCppFunction(
  "JSNodePerformanceHooksHistogramPrototype.cpp",
  "jsFunction_monitorEventLoopDelay",
  1,
) as (resolution: number) => import("node:perf_hooks").IntervalHistogram;

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

  return cppMonitorEventLoopDelay(resolution);
}

export default monitorEventLoopDelay;
