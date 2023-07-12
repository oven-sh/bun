function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/perf_hooks.js
var constants = {
  NODE_PERFORMANCE_GC_MAJOR: 4,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_INCREMENTAL: 8,
  NODE_PERFORMANCE_GC_WEAKCB: 16,
  NODE_PERFORMANCE_GC_FLAGS_NO: 0,
  NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED: 2,
  NODE_PERFORMANCE_GC_FLAGS_FORCED: 4,
  NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING: 8,
  NODE_PERFORMANCE_GC_FLAGS_ALL_AVAILABLE_GARBAGE: 16,
  NODE_PERFORMANCE_GC_FLAGS_ALL_EXTERNAL_MEMORY: 32,
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64
}, performance = globalThis.performance;

class PerformanceObserver {
  constructor() {
    throwNotImplemented("PerformanceObserver");
  }
}

class PerformanceEntry {
  constructor() {
    throwNotImplemented("PerformanceEntry");
  }
}

class PerformanceNodeTiming {
  constructor() {
    throw new Error("PerformanceNodeTiming is not supported in this environment.");
  }
}
var perf_hooks_default = {
  performance,
  constants,
  PerformanceEntry,
  PerformanceNodeTiming,
  [Symbol.for("CommonJS")]: 0
};
export {
  performance,
  perf_hooks_default as default,
  constants,
  PerformanceObserver,
  PerformanceNodeTiming,
  PerformanceEntry
};
