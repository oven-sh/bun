// src/js/node/perf_hooks.js
var performance = globalThis.performance;

class PerformanceObserver {
  constructor() {
    throw new Error("PerformanceEntry is not implemented yet");
  }
}

class PerformanceEntry {
  constructor() {
    throw new Error("PerformanceEntry is not implemented yet");
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

//# debugId=F7FD357A9B4AFE0C64756e2164756e21
