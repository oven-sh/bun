var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/perf_hooks.ts


// Hardcoded module "node:perf_hooks"
const { throwNotImplemented } = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 6/*internal/shared.ts*/) || __intrinsic__createInternalModuleById(6/*internal/shared.ts*/));

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

$ = {
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
$$EXPORT$$($).$$EXPORT_END$$;
