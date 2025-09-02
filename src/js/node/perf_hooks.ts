// Hardcoded module "node:perf_hooks"
const { throwNotImplemented } = require("internal/shared");

const createFunctionThatMasqueradesAsUndefined = $newCppFunction(
  "ZigGlobalObject.cpp",
  "jsFunctionCreateFunctionThatMasqueradesAsUndefined",
  2,
);

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

// Store active function observers
const functionObservers = new Set();

function processComplete(name: string, start: number, args: any[], histogram?: any) {
  const duration = performance.now() - start;
  
  // Create performance entry matching Node.js structure
  const entry = {
    name,
    entryType: "function",
    startTime: start,
    duration,
    detail: args,
    toJSON() {
      return {
        name: this.name,
        entryType: this.entryType,
        startTime: this.startTime,
        duration: this.duration,
        detail: this.detail,
      };
    },
  };
  
  // Add function arguments as indexed properties
  for (let n = 0; n < args.length; n++) {
    entry[n] = args[n];
  }
  
  // Notify observers manually since we're creating entries from JS
  if (functionObservers.size > 0) {
    queueMicrotask(() => {
      for (const observer of functionObservers) {
        if (observer && observer._callback) {
          try {
            const list = {
              getEntries() { return [entry]; },
              getEntriesByType(type: string) { return type === "function" ? [entry] : []; },
              getEntriesByName(name: string) { return entry.name === name ? [entry] : []; },
            };
            observer._callback(list, observer);
          } catch (err) {
            // Ignore errors in observer callbacks
          }
        }
      }
    });
  }
}

function timerify(fn: Function, options: { histogram?: any } = {}) {
  // Validate that fn is a function
  if (typeof fn !== "function") {
    throw $ERR_INVALID_ARG_TYPE("fn", "Function", fn);
  }
  
  // Validate options
  if (options !== null && typeof options !== "object") {
    throw $ERR_INVALID_ARG_TYPE("options", "Object", options);
  }
  
  const { histogram } = options;
  
  // We're skipping histogram validation since we're not implementing that part
  // But keep the structure for compatibility
  if (histogram !== undefined) {
    // Just validate it exists and has a record method for now
    if (typeof histogram?.record !== "function") {
      throw $ERR_INVALID_ARG_TYPE("options.histogram", "RecordableHistogram", histogram);
    }
  }
  
  // Create the timerified function
  function timerified(this: any, ...args: any[]) {
    const isConstructorCall = new.target !== undefined;
    const start = performance.now();
    
    let result;
    if (isConstructorCall) {
      // Use Reflect.construct for constructor calls
      // Pass the timerified function as new.target to maintain instanceof
      result = Reflect.construct(fn, args, timerified);
    } else {
      // Use $apply for regular function calls (Bun's internal apply)
      result = fn.$apply(this, args);
    }
    
    // Handle async functions (promises)
    if (!isConstructorCall && result && typeof result.finally === "function") {
      // For promises, attach the processComplete to finally
      return result.finally(() => {
        processComplete(fn.name || "anonymous", start, args, histogram);
      });
    }
    
    // For sync functions, process immediately
    processComplete(fn.name || "anonymous", start, args, histogram);
    return result;
  }
  
  // Define properties on the timerified function to match the original
  Object.defineProperties(timerified, {
    length: {
      configurable: false,
      enumerable: true,
      value: fn.length,
    },
    name: {
      configurable: false,
      enumerable: true,
      value: `timerified ${fn.name || "anonymous"}`,
    },
  });
  
  // Copy prototype for constructor functions
  if (fn.prototype) {
    timerified.prototype = fn.prototype;
  }
  
  return timerified;
}

// Minimal wrapper to track function observers
const OriginalPerformanceObserver = PerformanceObserver;
class WrappedPerformanceObserver extends OriginalPerformanceObserver {
  _callback: Function;
  
  constructor(callback: Function) {
    super(callback);
    this._callback = callback;
  }
  
  observe(options: any) {
    if ((options.entryTypes && options.entryTypes.includes("function")) || options.type === "function") {
      functionObservers.add(this);
    }
    super.observe(options);
  }
  
  disconnect() {
    functionObservers.delete(this);
    super.disconnect();
  }
}

PerformanceObserver = WrappedPerformanceObserver as any;

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
    eventLoopUtilization: eventLoopUtilization,
    clearResourceTimings: function () {},
    timerify,
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
  // TODO: node:perf_hooks.monitorEventLoopDelay -- https://github.com/oven-sh/bun/issues/17650
  monitorEventLoopDelay: createFunctionThatMasqueradesAsUndefined("", 0),
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
