// Hardcoded module "node:perf_hooks"
const { throwNotImplemented } = require("$shared");

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
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64,
};

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

export default {
  performance,
  // performance: {
  //   clearMarks: [Function: clearMarks],
  //   clearMeasures: [Function: clearMeasures],
  //   clearResourceTimings: [Function: clearResourceTimings],
  //   getEntries: [Function: getEntries],
  //   getEntriesByName: [Function: getEntriesByName],
  //   getEntriesByType: [Function: getEntriesByType],
  //   mark: [Function: mark],
  //   measure: [Function: measure],
  //   now: performance.now,
  //   setResourceTimingBufferSize: [Function: setResourceTimingBufferSize],
  //   timeOrigin: performance.timeOrigin,
  //   toJSON: [Function: toJSON],
  //   onresourcetimingbufferfull: [Getter/Setter]
  // },
  constants,
  // Performance: [class Performance extends EventTarget],
  PerformanceEntry,
  // PerformanceMark: [class PerformanceMark extends PerformanceEntry],
  // PerformanceMeasure: [class PerformanceMeasure extends PerformanceEntry],
  PerformanceObserver,
  // PerformanceObserverEntryList: [class PerformanceObserverEntryList],
  // PerformanceResourceTiming: [class PerformanceResourceTiming extends PerformanceEntry],
  // monitorEventLoopDelay: [Function: monitorEventLoopDelay],
  // createHistogram: [Function: createHistogram],
};
