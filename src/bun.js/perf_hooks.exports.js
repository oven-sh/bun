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
    throw new Error(
      "PerformanceNodeTiming is not supported in this environment.",
    );
  }
}

export default {
  performance,
  PerformanceEntry,
  PerformanceEntry,
  PerformanceNodeTiming,
};
