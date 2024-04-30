// Hardcoded module "node:perf_hooks"
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");

var {
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
} = globalThis;

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

// PerformanceEntry is not a valid constructor, so we have to fake it.
class PerformanceNodeTiming {
  bootstrapComplete: number = 0;
  environment: number = 0;
  idleTime: number = 0;
  loopExit: number = 0;
  loopStart: number = 0;
  nodeStart: number = 0;
  v8Start: number = 0;

  // we have to fake the properties since it's not real
  get name() {
    return "node";
  }

  get entryType() {
    return "node";
  }

  get startTime() {
    return this.nodeStart;
  }

  get duration() {
    return performance.now();
  }

  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      bootstrapComplete: this.bootstrapComplete,
      environment: this.environment,
      idleTime: this.idleTime,
      loopExit: this.loopExit,
      loopStart: this.loopStart,
      nodeStart: this.nodeStart,
      v8Start: this.v8Start,
    };
  }
}
Object.setPrototypeOf(PerformanceNodeTiming.prototype, PerformanceEntry.prototype);
Object.setPrototypeOf(PerformanceNodeTiming, PerformanceEntry);

function createPerformanceNodeTiming() {
  const object = Object.create(PerformanceNodeTiming.prototype);

  object.bootstrapComplete = object.environment = object.nodeStart = object.v8Start = performance.timeOrigin;
  object.loopStart = object.idleTime = 1;
  object.loopExit = -1;
  return object;
}

function eventLoopUtilization(utilization1, utilization2) {
  warnNotImplementedOnce("perf_hooks.eventLoopUtilization");
  return {
    idle: 0,
    active: 0,
    utilization: 0,
  };
}

// https://nodejs.org/api/perf_hooks.html#class-histogram
// https://github.com/nodejs/node/blob/5976985a58a8635b8f1272519020c817f4ccdd1b/src/histogram.h#L25
class Histogram {
  count: number;
  countBigInt: bigint;
  exceeds: number;
  exceedsBigInt: bigint;
  max: number;
  maxBigInt: bigint;
  mean: number;
  min: number;
  minBigInt: bigint;
  percentiles: Map<number, number>;
  percentilesBigInt: Map<number, bigint>;
  stddev: number;

  constructor() {
    this.count = 0;
    this.countBigInt = 0n;
    this.exceeds = 0;
    this.exceedsBigInt = 0n;
    this.max = 0;
    this.maxBigInt = 0n;
    this.mean = 0;
    this.min = 0;
    this.minBigInt = 0n;
    this.percentiles = new Map();
    this.percentilesBigInt = new Map();
    this.stddev = 0;
  }

  percentile(p: number) {
    return 0;
  }

  percentileBigInt(p: number) {
    return 0n;
  }

  reset() {
    this.percentiles.clear();
    this.percentilesBigInt.clear();
  }
}

class IntervalHistogram extends Histogram {
  #enabled: boolean = false;

  enable() {
    const wasEnabled = this.#enabled;
    if (!wasEnabled) {
      this.#enabled = true;
    }
    return wasEnabled;
  }

  disable() {
    const wasEnabled = this.#enabled;
    if (wasEnabled) {
      this.#enabled = false;
    }
    return wasEnabled;
  }
}

class RecordableHistogram extends Histogram {
  constructor(options?: unknown) {
    super();
  }

  add(other: RecordableHistogram) {
    // TODO
  }

  record(value: number | bigint) {
    // TODO
  }

  recordDelta() {
    // TODO
  }
}

function createHistogram(options) {
  warnNotImplementedOnce("perf_hooks.createHistogram");
  return new RecordableHistogram(options);
}

function monitorEventLoopDelay() {
  warnNotImplementedOnce("perf_hooks.monitorEventLoopDelay");
  return new IntervalHistogram();
}

// PerformanceEntry is not a valid constructor, so we have to fake it.
class PerformanceResourceTiming {
  constructor() {
    throwNotImplemented("PerformanceResourceTiming");
  }
}
Object.setPrototypeOf(PerformanceResourceTiming.prototype, PerformanceEntry.prototype);
Object.setPrototypeOf(PerformanceResourceTiming, PerformanceEntry);

export default {
  performance: {
    mark(f) {
      return performance.mark(...arguments);
    },
    measure(f) {
      return performance.measure(...arguments);
    },
    clearMarks(f) {
      return performance.clearMarks(...arguments);
    },
    clearMeasures(f) {
      return performance.clearMeasures(...arguments);
    },
    getEntries(f) {
      return performance.getEntries(...arguments);
    },
    getEntriesByName(f) {
      return performance.getEntriesByName(...arguments);
    },
    getEntriesByType(f) {
      return performance.getEntriesByType(...arguments);
    },
    setResourceTimingBufferSize(f) {
      return performance.setResourceTimingBufferSize(...arguments);
    },
    timeOrigin: performance.timeOrigin,
    toJSON(f) {
      return performance.toJSON(...arguments);
    },
    onresourcetimingbufferfull: performance.onresourcetimingbufferfull,
    nodeTiming: createPerformanceNodeTiming(),
    now: () => performance.now(),
    eventLoopUtilization: eventLoopUtilization,
    clearResourceTimings: function () {},
  },
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
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceNodeTiming,
  PerformanceResourceTiming,
  monitorEventLoopDelay,
  createHistogram,
};
