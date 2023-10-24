(function (){"use strict";// build2/tmp/node/perf_hooks.ts
var $;
var { throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
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
  constants,
  PerformanceEntry,
  PerformanceObserver
};
return $})
