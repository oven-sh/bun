// Hardcoded module "node:perf_hooks"
const { throwNotImplemented } = require("internal/shared");
const { validateFunction, validateObject } = require("internal/validators");

const cppCreateHistogram = $newCppFunction("JSNodePerformanceHooksHistogram.cpp", "jsFunction_createHistogram", 3) as (
  min: number,
  max: number,
  figures: number,
) => import("node:perf_hooks").RecordableHistogram;

var {
  Performance,
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  PerformanceObserver,
  PerformanceObserverEntryList,
} = globalThis;

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
$toClass(PerformanceNodeTiming, "PerformanceNodeTiming", PerformanceEntry);

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

// PerformanceEntry is not a valid constructor, so we have to fake it.
class PerformanceResourceTiming {
  constructor() {
    throwNotImplemented("PerformanceResourceTiming");
  }
}
$toClass(PerformanceResourceTiming, "PerformanceResourceTiming", PerformanceEntry);

// --- timerify + 'function' entryType support -------------------------------
// The global PerformanceObserver is WebCore's and only knows web entry types,
// so node-only 'function' entries (produced by performance.timerify) are
// tracked and dispatched from JS here.

class PerformanceNodeEntry {
  name;
  entryType;
  startTime;
  duration;
  detail;

  constructor(name, entryType, startTime, duration, detail) {
    this.name = name;
    this.entryType = entryType;
    this.startTime = startTime;
    this.duration = duration;
    this.detail = detail;
  }

  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail,
    };
  }
}
// Link the prototype chain so entries are `instanceof PerformanceEntry` like
// node's PerformanceNodeEntry. `extends PerformanceEntry` can't work (the
// WebCore constructor throws "Illegal constructor"), and $toClass would
// replace the prototype object, losing the class's own toJSON; instances
// carry own data fields, so the inherited brand-checked accessors are
// shadowed and never invoked.
Object.setPrototypeOf(PerformanceNodeEntry.prototype, PerformanceEntry.prototype);
Object.setPrototypeOf(PerformanceNodeEntry, PerformanceEntry);
Object.defineProperty(PerformanceNodeEntry, "name", { value: "PerformanceNodeEntry" });

class PerformanceNodeObserverEntryList {
  #entries;
  constructor(entries) {
    this.#entries = entries;
  }
  getEntries() {
    return this.#entries.slice();
  }
  getEntriesByType(type) {
    return this.#entries.filter(entry => entry.entryType === type);
  }
  getEntriesByName(name, type) {
    return this.#entries.filter(entry => entry.name === name && (type === undefined || entry.entryType === type));
  }
}
Object.defineProperty(PerformanceNodeObserverEntryList, "name", { value: "PerformanceObserverEntryList" });

const functionObservers = new Set();
let pendingFunctionEntries = [];
let functionDispatchPending = false;

function dispatchFunctionEntries() {
  functionDispatchPending = false;
  const entries = pendingFunctionEntries;
  pendingFunctionEntries = [];
  const list = new PerformanceNodeObserverEntryList(entries);
  for (const observer of functionObservers) {
    observer[kDispatchNodeEntries](list);
  }
}

function enqueueFunctionEntry(entry) {
  if (functionObservers.size === 0) return;
  pendingFunctionEntries.push(entry);
  if (!functionDispatchPending) {
    functionDispatchPending = true;
    queueMicrotask(dispatchFunctionEntries);
  }
}

const kDispatchNodeEntries = Symbol("kDispatchNodeEntries");

class NodePerformanceObserver extends PerformanceObserver {
  #callback;

  constructor(callback) {
    super(callback);
    this.#callback = callback;
  }

  static get supportedEntryTypes() {
    return [...super.supportedEntryTypes, "function"].sort();
  }

  observe(options) {
    if (!$isObject(options)) {
      throw $ERR_INVALID_ARG_TYPE("options", "object", options);
    }
    if (options.entryTypes !== undefined) {
      const entryTypes = options.entryTypes;
      if (!$isArray(entryTypes)) {
        throw $ERR_INVALID_ARG_TYPE("options.entryTypes", "string[]", entryTypes);
      }
      if (entryTypes.length === 0) {
        return;
      }
      const webTypes = entryTypes.filter(type => type !== "function");
      const observesFunction = webTypes.length !== entryTypes.length;
      if (webTypes.length !== 0) {
        super.observe({ ...options, entryTypes: webTypes });
      } else {
        // Function-only list: replace semantics also drop any previously
        // observed web entry types (node clears the whole set before
        // re-adding from the new array).
        super.disconnect();
      }
      // The entryTypes form replaces the observed set (unlike the additive
      // type form), so clear any prior "function" registration when the new
      // list doesn't include it. Registration happens after super.observe()
      // so a throw there doesn't leave a stale entry behind.
      if (observesFunction) {
        functionObservers.add(this);
      } else {
        functionObservers.delete(this);
      }
      return;
    }
    if (options.type === "function") {
      functionObservers.add(this);
      return;
    }
    return super.observe(options);
  }

  disconnect() {
    functionObservers.delete(this);
    return super.disconnect();
  }

  [kDispatchNodeEntries](list) {
    this.#callback(list, this);
  }
}
Object.defineProperty(NodePerformanceObserver, "name", { value: "PerformanceObserver" });

function timerify(fn, options = {}) {
  validateFunction(fn, "fn");
  validateObject(options, "options");
  const { histogram } = options;
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
      configurable: false,
      enumerable: true,
      value: fn.length,
    },
    name: {
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
  enqueueFunctionEntry(new PerformanceNodeEntry(name, "function", start, duration, args));
}

export default {
  performance: {
    mark(_) {
      return performance.mark(...arguments);
    },
    measure(_) {
      return performance.measure(...arguments);
    },
    clearMarks(_) {
      return performance.clearMarks(...arguments);
    },
    clearMeasures(_) {
      return performance.clearMeasures(...arguments);
    },
    getEntries(_) {
      return performance.getEntries(...arguments);
    },
    getEntriesByName(_) {
      return performance.getEntriesByName(...arguments);
    },
    getEntriesByType(_) {
      return performance.getEntriesByType(...arguments);
    },
    setResourceTimingBufferSize(_) {
      return performance.setResourceTimingBufferSize(...arguments);
    },
    timeOrigin: performance.timeOrigin,
    toJSON(_) {
      return performance.toJSON(...arguments);
    },
    onresourcetimingbufferfull: performance.onresourcetimingbufferfull,
    nodeTiming: createPerformanceNodeTiming(),
    now: () => performance.now(),
    timerify,
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
  PerformanceObserver: NodePerformanceObserver,
  PerformanceObserverEntryList,
  PerformanceNodeTiming,
  timerify,
  monitorEventLoopDelay: function monitorEventLoopDelay(options?: { resolution?: number }) {
    const impl = require("internal/perf_hooks/monitorEventLoopDelay");
    return impl(options);
  },
  createHistogram: function createHistogram(options?: {
    lowest?: number | bigint;
    highest?: number | bigint;
    figures?: number;
  }): import("node:perf_hooks").RecordableHistogram {
    const opts = options || {};

    let lowest = 1;
    let highest = Number.MAX_SAFE_INTEGER;
    let figures = 3;

    if (opts.lowest !== undefined) {
      if (typeof opts.lowest === "bigint") {
        lowest = Number(opts.lowest);
      } else if (typeof opts.lowest === "number") {
        lowest = opts.lowest;
      } else {
        throw $ERR_INVALID_ARG_TYPE("options.lowest", ["number", "bigint"], opts.lowest);
      }
    }

    if (opts.highest !== undefined) {
      if (typeof opts.highest === "bigint") {
        highest = Number(opts.highest);
      } else if (typeof opts.highest === "number") {
        highest = opts.highest;
      } else {
        throw $ERR_INVALID_ARG_TYPE("options.highest", ["number", "bigint"], opts.highest);
      }
    }

    if (opts.figures !== undefined) {
      if (typeof opts.figures !== "number") {
        throw $ERR_INVALID_ARG_TYPE("options.figures", "number", opts.figures);
      }
      if (opts.figures < 1 || opts.figures > 5) {
        throw $ERR_OUT_OF_RANGE("options.figures", ">= 1 && <= 5", opts.figures);
      }
      figures = opts.figures;
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
