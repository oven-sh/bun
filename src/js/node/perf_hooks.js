// @module "node:perf_hooks"
export var performance = globalThis.performance;

export class PerformanceObserver {
  constructor() {
    throw new Error("PerformanceEntry is not implemented yet");
  }
}

export class PerformanceEntry {
  constructor() {
    throw new Error("PerformanceEntry is not implemented yet");
  }
}
export class PerformanceNodeTiming {
  constructor() {
    throw new Error("PerformanceNodeTiming is not supported in this environment.");
  }
}

export default {
  performance,
  PerformanceEntry,
  PerformanceNodeTiming,
  [Symbol.for("CommonJS")]: 0,
};
