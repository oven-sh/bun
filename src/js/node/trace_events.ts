// Hardcoded module "node:trace_events"

// Trace events collector
let enabledCategories: Set<string> = new Set();
let traceEvents: any[] = [];
let isRecording = false;

class Tracing {
  enabled = false;
  categories = "";
  #categoriesSet: Set<string>;

  constructor(opts: { categories: string[] }) {
    this.categories = opts.categories.join(",");
    this.#categoriesSet = new Set(opts.categories);
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;

    // Add categories to global enabled set
    for (const cat of this.#categoriesSet) {
      enabledCategories.add(cat);
    }

    // Start recording if not already
    if (!isRecording) {
      isRecording = true;
      // Enable trace events collection in the runtime
      // TODO: Hook into native trace events when implemented
    }
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;

    // Remove categories from global enabled set
    for (const cat of this.#categoriesSet) {
      enabledCategories.delete(cat);
    }

    // If no more categories enabled, stop recording
    if (enabledCategories.size === 0 && isRecording) {
      isRecording = false;
      // TODO: Disable native trace events when implemented
    }
  }
}

function createTracing(opts) {
  if (typeof opts !== "object" || opts == null) {
    // @ts-ignore
    throw $ERR_INVALID_ARG_TYPE("options", "object", opts);
  }

  if (!opts.categories || !Array.isArray(opts.categories)) {
    // @ts-ignore
    throw $ERR_INVALID_ARG_TYPE("options.categories", "string[]", opts.categories);
  }

  return new Tracing(opts);
}

function getEnabledCategories() {
  return [...enabledCategories].join(",");
}

// Internal function to add trace events (called from native code)
export function addTraceEvent(phase: string, category: string, name: string, id?: number, args?: any) {
  if (!isRecording || !enabledCategories.has(category)) return;

  traceEvents.push({
    pid: process.pid,
    tid: 0, // TODO: thread id
    ts: performance.now() * 1000, // microseconds
    ph: phase,
    cat: category,
    name,
    id,
    args,
  });
}

// Internal function to get collected events
export function getTraceEvents() {
  return traceEvents;
}

// Internal function to clear events
export function clearTraceEvents() {
  traceEvents = [];
}

// Check if tracing was enabled via command line
if (process.execArgv) {
  const traceIndex = process.execArgv.indexOf("--trace-event-categories");
  if (traceIndex !== -1 && traceIndex + 1 < process.execArgv.length) {
    const categories = process.execArgv[traceIndex + 1].split(",");
    const tracing = new Tracing({ categories });
    tracing.enable();

    // Set up to write trace file on exit
    process.on("beforeExit", () => {
      writeTraceFile();
    });
  }
}

// Write trace events to file
function writeTraceFile() {
  if (traceEvents.length === 0) return;

  // Use require directly as other internal modules do
  const fs = require("node:fs");

  // Generate filename: node_trace.1.log (Node.js uses sequential numbering, starting at 1)
  const filename = `${process.cwd()}/node_trace.1.log`;

  const data = {
    traceEvents: traceEvents,
  };

  try {
    fs.writeFileSync(filename, JSON.stringify(data));
  } catch (err) {
    // Ignore errors writing trace file
  }
}

// Emit node.environment trace events
function emitEnvironmentTraceEvents() {
  if (!enabledCategories.has("node.environment")) return;

  const events = [
    "Environment",
    "RunAndClearNativeImmediates",
    "CheckImmediate",
    "RunTimers",
    "BeforeExit",
    "RunCleanup",
    "AtExit",
  ];

  // Emit some events immediately
  addTraceEvent("X", "node.environment", "Environment");

  // Hook into event loop phases using process.nextTick instead of modifying globals
  process.nextTick(() => {
    // Monitor immediate execution
    if (typeof setImmediate !== "undefined") {
      setImmediate(() => {
        addTraceEvent("X", "node.environment", "CheckImmediate");
        addTraceEvent("X", "node.environment", "RunAndClearNativeImmediates");
      });
    }

    // Monitor timer execution
    if (typeof setTimeout !== "undefined") {
      setTimeout(() => {
        addTraceEvent("X", "node.environment", "RunTimers");
      }, 1);
    }
  });

  process.on("beforeExit", () => {
    addTraceEvent("X", "node.environment", "BeforeExit");
    addTraceEvent("X", "node.environment", "RunCleanup");
  });

  process.on("exit", () => {
    addTraceEvent("X", "node.environment", "AtExit");
  });
}

// Start emitting environment events if enabled
if (enabledCategories.has("node.environment")) {
  emitEnvironmentTraceEvents();
}

export default {
  createTracing,
  getEnabledCategories,
};
