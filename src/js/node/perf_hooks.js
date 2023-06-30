// Hardcoded module "node:perf_hooks"
import { throwNotImplemented } from "../shared";

export var constants = {
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
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64,
};

export var performance = globalThis.performance;

export class PerformanceObserver {
  constructor() {
    throwNotImplemented("PerformanceObserver");
  }
}

export class PerformanceEntry {
  constructor() {
    throwNotImplemented("PerformanceEntry");
  }
}
export class PerformanceNodeTiming {
  constructor() {
    throw new Error("PerformanceNodeTiming is not supported in this environment.");
  }
}

export default {
  performance,
  constants,
  PerformanceEntry,
  PerformanceNodeTiming,
  [Symbol.for("CommonJS")]: 0,
};
