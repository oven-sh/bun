// Hardcoded module "node:perf_hooks"
const {
  throwNotImplemented,
  kNodeEntryTypes,
  NodeEntryObserver,
  enqueueNodeEntry,
  hasObserver,
  PerformanceNodeEntry,
  kEmptyObject,
} = require("internal/shared");
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
  PerformanceObserver: NodePerformanceObserver,
  PerformanceObserverEntryList,
} = globalThis;

// `extends PerformanceEntry` can't work (WebCore ctor throws); link here via
// the captured global. Construction is gated by hasObserver() so this module
// has loaded first. Guarded so a pre-require delete degrades, not throws.
if (PerformanceEntry) {
  Object.setPrototypeOf(PerformanceNodeEntry.prototype, PerformanceEntry.prototype);
  Object.setPrototypeOf(PerformanceNodeEntry, PerformanceEntry);
}

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

const kNodeObserver = Symbol("kNodeObserver");
const kObserverCallback = Symbol("kObserverCallback");

/**
 * The native (WebCore) observer only understands mark/measure/resource.
 * Node-only entry types ('net', 'dns', ...) are routed to the JS-side
 * registry in internal/shared; everything else is delegated to the native
 * observer unchanged. (`NodePerformanceObserver` is the existing alias for
 * the native class destructured from globalThis above.)
 */
class PerformanceObserverForNodeTypes extends NodePerformanceObserver {
  constructor(callback) {
    super(callback);
    this[kObserverCallback] = callback;
  }

  /** The native list plus the Node-only types routed through the JS registry. */
  static get supportedEntryTypes() {
    return [...new Set([...(NodePerformanceObserver.supportedEntryTypes ?? []), ...kNodeEntryTypes])].sort();
  }

  observe(options) {
    let requested;
    let isTypeMode = false;
    if (options != null && typeof options === "object") {
      const entryTypes = options.entryTypes;
      let type;
      if (entryTypes !== undefined && Array.isArray(entryTypes)) {
        requested = entryTypes;
      } else if ((type = options.type) !== undefined) {
        requested = [type];
        isTypeMode = true;
      }
    }
    if (requested) {
      const nodeTypes = requested.filter(type => kNodeEntryTypes.has(type));
      let registration = this[kNodeObserver];
      if (nodeTypes.length > 0 && !registration) {
        registration = this[kNodeObserver] = new NodeEntryObserver(this[kObserverCallback], this);
      }
      if (registration) {
        if (isTypeMode) {
          // observe({type}) appends to the observed set per the spec.
          registration.observe([...registration.types, ...nodeTypes]);
        } else {
          // observe({entryTypes}) replaces the observed set, including
          // dropping a previously-observed node type when the new set has
          // none.
          registration.observe(nodeTypes);
        }
      }
      if (nodeTypes.length > 0) {
        const webTypes = requested.filter(type => !kNodeEntryTypes.has(type));
        if (webTypes.length === 0) {
          // observe({entryTypes}) replaces the whole observed set: a
          // previously-subscribed web type must stop firing when the new set
          // is node-only. The native impl rejects an empty entryTypes array,
          // so drop the subscription instead of re-observing with [].
          if (!isTypeMode) {
            try {
              super.disconnect();
            } catch {}
          }
          return;
        }
        // A non-empty webTypes set alongside a node type is only possible in
        // entryTypes mode (observe({type}) requests exactly one type), so the
        // forwarded subscription is always an entryTypes one.
        return super.observe({ ...options, entryTypes: webTypes });
      }
    }
    return super.observe(options);
  }

  disconnect() {
    this[kNodeObserver]?.disconnect();
    this[kNodeObserver] = undefined;
    return super.disconnect();
  }
}
// Not $toClass: that resets the prototype object and would drop the
// observe/disconnect overrides above. Only the public name needs fixing.
Object.defineProperty(PerformanceObserverForNodeTypes, "name", {
  value: "PerformanceObserver",
  configurable: true,
});

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
  if (hasObserver("function")) {
    const entry = new PerformanceNodeEntry(name, "function", start, duration, args);
    for (let n = 0; n < args.length; n++) entry[n] = args[n];
    enqueueNodeEntry(entry);
  }
}

export default {
  timerify,
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
  PerformanceObserver: PerformanceObserverForNodeTypes,
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
