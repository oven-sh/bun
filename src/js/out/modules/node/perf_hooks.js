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
var performance = globalThis.performance;

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
  PerformanceEntry,
  PerformanceNodeTiming,
  [Symbol.for("CommonJS")]: 0
};
export {
  performance,
  perf_hooks_default as default,
  PerformanceObserver,
  PerformanceNodeTiming,
  PerformanceEntry
};
