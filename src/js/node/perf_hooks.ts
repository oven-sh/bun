// Hardcoded module "node:perf_hooks"
const {
  enqueueNodeEntry,
  hasObserver,
  kEntryTypeFunction,
  PerformanceNodeEntry,
  kEmptyObject,
} = require("internal/shared");
const { validateFunction, validateObject } = require("internal/validators");

const cppCreateHistogram = $newCppFunction("JSNodePerformanceHooksHistogram.cpp", "jsFunction_createHistogram", 3) as (
  min: number,
  max: number,
  figures: number,
) => import("node:perf_hooks").RecordableHistogram;

// The realm's own classes: script can have replaced the globals of these names.
const {
  0: Performance,
  1: PerformanceEntry,
  2: PerformanceMark,
  3: PerformanceMeasure,
  4: PerformanceObserver,
  5: PerformanceObserverEntryList,
  6: PerformanceResourceTiming,
} = $cpp("Performance.cpp", "createNodePerfHooksBinding") as [
  typeof globalThis.Performance,
  typeof globalThis.PerformanceEntry,
  typeof globalThis.PerformanceMark,
  typeof globalThis.PerformanceMeasure,
  typeof globalThis.PerformanceObserver,
  typeof globalThis.PerformanceObserverEntryList,
  typeof globalThis.PerformanceResourceTiming,
];

var constants = {
  NODE_PERFORMANCE_ENTRY_TYPE_DNS: 4,
  NODE_PERFORMANCE_ENTRY_TYPE_GC: 0,
  NODE_PERFORMANCE_ENTRY_TYPE_HTTP: 1,
  NODE_PERFORMANCE_ENTRY_TYPE_HTTP2: 2,
  NODE_PERFORMANCE_ENTRY_TYPE_NET: 3,
  NODE_PERFORMANCE_GC_FLAGS_ALL_AVAILABLE_GARBAGE: 16,
  NODE_PERFORMANCE_GC_FLAGS_ALL_EXTERNAL_MEMORY: 32,
  NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED: 2,
  NODE_PERFORMANCE_GC_FLAGS_FORCED: 4,
  NODE_PERFORMANCE_GC_FLAGS_NO: 0,
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64,
  NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING: 8,
  NODE_PERFORMANCE_GC_INCREMENTAL: 8,
  NODE_PERFORMANCE_GC_MAJOR: 4,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_WEAKCB: 16,
  NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE: 7,
  NODE_PERFORMANCE_MILESTONE_ENVIRONMENT: 2,
  NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: 6,
  NODE_PERFORMANCE_MILESTONE_LOOP_START: 5,
  NODE_PERFORMANCE_MILESTONE_NODE_START: 3,
  NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP: 0,
  NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN: 1,
  NODE_PERFORMANCE_MILESTONE_V8_START: 4,
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

function eventLoopUtilization(_utilization1, _utilization2) {
  return {
    idle: 0,
    active: 0,
    utilization: 0,
  };
}

// kEmptyObject (frozen, null-prototype) so the histogram read below cannot
// pick up a polluted Object.prototype, matching node's default.
function timerify(fn, options = kEmptyObject) {
  validateFunction(fn, "fn");
  validateObject(options, "options");
  const { histogram } = options;
  // Node brand-checks with isHistogram (kHandle presence); Bun duck-types on
  // .record for now — a native brand-check helper on
  // JSNodePerformanceHooksHistogram would tighten this if it ever matters.
  if (
    histogram !== undefined &&
    (histogram === null || typeof histogram !== "object" || typeof histogram.record !== "function")
  ) {
    throw $ERR_INVALID_ARG_TYPE("options.histogram", "RecordableHistogram", histogram);
  }

  function timerified(...args) {
    const isConstructorCall = new.target !== undefined;
    const start = performance.now();
    const result = isConstructorCall ? Reflect.construct(fn, args, fn) : fn.$apply(this, args);
    if (!isConstructorCall && typeof result?.finally === "function") {
      return result.finally(() => {
        processTimerifyComplete(fn.name, start, args, histogram);
      });
    }
    processTimerifyComplete(fn.name, start, args, histogram);
    return result;
  }

  Object.defineProperties(timerified, {
    length: {
      __proto__: null,
      configurable: false,
      enumerable: true,
      value: fn.length,
    },
    name: {
      __proto__: null,
      configurable: false,
      enumerable: true,
      value: `timerified ${fn.name}`,
    },
  });

  return timerified;
}

function processTimerifyComplete(name, start, args, histogram) {
  const duration = performance.now() - start;
  if (histogram !== undefined) {
    histogram.record(Math.ceil(duration * 1e6));
  }
  if (hasObserver(kEntryTypeFunction)) {
    const entry = new PerformanceNodeEntry(name, "function", start, duration, args);
    for (let n = 0; n < args.length; n++) entry[n] = args[n];
    enqueueNodeEntry(entry, kEntryTypeFunction);
  }
}

const nodeTiming = createPerformanceNodeTiming();

// Node augments the real `performance` object (not a forwarding shim), so
// timerify/eventLoopUtilization/nodeTiming go on Performance.prototype,
// non-enumerable, per lib/internal/perf/performance.js.
Object.defineProperties(Performance.prototype, {
  nodeTiming: {
    __proto__: null,
    configurable: true,
    enumerable: false,
    writable: true,
    value: nodeTiming,
  },
  timerify: {
    __proto__: null,
    configurable: true,
    enumerable: false,
    writable: true,
    value: timerify,
  },
  eventLoopUtilization: {
    __proto__: null,
    configurable: true,
    enumerable: false,
    writable: true,
    value: eventLoopUtilization,
  },
});

export default {
  timerify,
  performance,
  constants,
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceNodeTiming,
  eventLoopUtilization,
  monitorEventLoopDelay: function monitorEventLoopDelay(options?: { resolution?: number }) {
    const impl = require("internal/perf_hooks/monitorEventLoopDelay");
    return impl(options);
  },
  createHistogram: function createHistogram(
    options: {
      lowest?: number | bigint;
      highest?: number | bigint;
      figures?: number;
    } = kEmptyObject,
  ): import("node:perf_hooks").RecordableHistogram {
    // kEmptyObject default, and validate rather than `options || {}`: the reads
    // below must not see a polluted Object.prototype, and node rejects a
    // non-object argument instead of silently ignoring it.
    validateObject(options, "options");

    let lowest = 1;
    let highest = Number.MAX_SAFE_INTEGER;
    let figures = 3;

    const lowestOpt = options.lowest;
    if (lowestOpt !== undefined) {
      if (typeof lowestOpt === "bigint") {
        lowest = Number(lowestOpt);
      } else if (typeof lowestOpt === "number") {
        lowest = lowestOpt;
      } else {
        throw $ERR_INVALID_ARG_TYPE("options.lowest", ["number", "bigint"], lowestOpt);
      }
    }

    const highestOpt = options.highest;
    if (highestOpt !== undefined) {
      if (typeof highestOpt === "bigint") {
        highest = Number(highestOpt);
      } else if (typeof highestOpt === "number") {
        highest = highestOpt;
      } else {
        throw $ERR_INVALID_ARG_TYPE("options.highest", ["number", "bigint"], highestOpt);
      }
    }

    const figuresOpt = options.figures;
    if (figuresOpt !== undefined) {
      if (typeof figuresOpt !== "number") {
        throw $ERR_INVALID_ARG_TYPE("options.figures", "number", figuresOpt);
      }
      if (figuresOpt < 1 || figuresOpt > 5) {
        throw $ERR_OUT_OF_RANGE("options.figures", ">= 1 && <= 5", figuresOpt);
      }
      figures = figuresOpt;
    }

    // Node.js validation - highest must be >= 2 * lowest
    if (lowest < 1) {
      throw $ERR_OUT_OF_RANGE("options.lowest", ">= 1 && <= 9007199254740991", lowest);
    }

    if (highest < 2 * lowest) {
      throw $ERR_OUT_OF_RANGE("options.highest", `>= ${2 * lowest} && <= 9007199254740991`, highest);
    }

    return cppCreateHistogram(lowest, highest, figures);
  },
  PerformanceResourceTiming,
};
