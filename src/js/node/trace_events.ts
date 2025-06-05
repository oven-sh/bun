// Node.js-compatible trace_events module implementation

// Declare global function that will be provided by the runtime
declare const $getTraceEventCategories: (() => string) | undefined;

const {
  captureRejectionSymbol,
  EventEmitter,
  EventEmitterInit,
  EventEmitterAsyncResource,
  EventEmitterReferencingAsyncResource,
  kMaxEventTargetListeners,
  kMaxEventTargetListenersWarned,
} = require("node:events");

// Trace event categories that are enabled
let enabledCategories: Set<string> = new Set();

// Trace event collector
let traceEventCollector: TraceEventCollector | null = null;

// Counter for trace event IDs
let traceEventIdCounter = 0;

// Process ID (cached)
const processId = process.pid;

class Tracing {
  #enabled = false;
  #categories = "";
  #categoriesSet: Set<string>;

  constructor(categories: string[]) {
    this.#categories = categories.join(",");
    this.#categoriesSet = new Set(categories);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get categories(): string {
    return this.#categories;
  }

  enable(): void {
    if (this.#enabled) return;
    this.#enabled = true;

    // Add categories to the global enabled set
    for (const category of this.#categoriesSet) {
      enabledCategories.add(category);
    }

    // Start trace event collection if not already started
    if (!traceEventCollector) {
      traceEventCollector = new TraceEventCollector();
    }
  }

  disable(): void {
    if (!this.#enabled) return;
    this.#enabled = false;

    // Remove categories from the global enabled set
    for (const category of this.#categoriesSet) {
      enabledCategories.delete(category);
    }

    // If no categories are enabled, stop collection
    if (enabledCategories.size === 0 && traceEventCollector) {
      traceEventCollector.stop();
      traceEventCollector = null;
    }
  }
}

class TraceEventCollector {
  #events: any[] = [];
  #startTime: number;
  #fileCounter = 1;

  constructor() {
    this.#startTime = performance.now() * 1000; // Convert to microseconds
    this.start();
  }

  start() {
    // Initialize trace event collection
    if ($processBindingConstants?.trace) {
      // Enable native trace event collection
      this.enableNativeTracing();
    }

    // Write initial metadata event
    this.addEvent({
      name: "process_name",
      ph: "M",
      pid: processId,
      tid: 0,
      ts: 0,
      args: {
        name: "node",
      },
    });

    this.addEvent({
      name: "thread_name",
      ph: "M",
      pid: processId,
      tid: 0,
      ts: 0,
      args: {
        name: "main",
      },
    });
  }

  stop() {
    this.writeTraceFile();
  }

  addEvent(event: any) {
    this.#events.push(event);
  }

  emitTraceEvent(name: string, category: string, phase: string, args?: any) {
    if (!enabledCategories.has(category)) return;

    const ts = performance.now() * 1000 - this.#startTime;

    this.addEvent({
      name,
      cat: category,
      ph: phase,
      pid: processId,
      tid: 0,
      ts,
      args: args || {},
    });
  }

  enableNativeTracing() {
    // Hook into process lifecycle events
    const originalExit = process.exit;
    process.exit = ((code?: string | number | null | undefined): never => {
      this.emitTraceEvent("AtExit", "node.environment", "I");
      this.writeTraceFile();
      return originalExit.call(process, code);
    }) as typeof process.exit;

    process.on("beforeExit", () => {
      this.emitTraceEvent("BeforeExit", "node.environment", "I");
    });

    // Emit Environment event
    this.emitTraceEvent("Environment", "node.environment", "I");

    // Hook into timers
    const originalSetImmediate = globalThis.setImmediate;
    globalThis.setImmediate = ((callback: any, ...args: any[]) => {
      this.emitTraceEvent("CheckImmediate", "node.environment", "I");
      return originalSetImmediate(callback, ...args);
    }) as typeof setImmediate;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: any, delay?: number, ...args: any[]) => {
      this.emitTraceEvent("RunTimers", "node.environment", "I");
      return originalSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout;

    // Hook into native immediates
    process.nextTick(() => {
      this.emitTraceEvent("RunAndClearNativeImmediates", "node.environment", "I");
    });

    // Register cleanup
    if (typeof FinalizationRegistry !== "undefined") {
      const registry = new FinalizationRegistry(() => {
        this.emitTraceEvent("RunCleanup", "node.environment", "I");
      });
      registry.register(this, undefined);
    }
  }

  writeTraceFile() {
    if (this.#events.length === 0) return;

    const filename = `node_trace.${this.#fileCounter}.log`;
    const traceData = {
      traceEvents: this.#events,
    };

    try {
      require("fs").writeFileSync(filename, JSON.stringify(traceData));
    } catch (error) {
      // Ignore errors writing trace file
    }
  }
}

function createTracing(options: { categories: string[] }): Tracing {
  if (!options || !Array.isArray(options.categories)) {
    throw new TypeError("options.categories is required");
  }

  return new Tracing(options.categories);
}

function getEnabledCategories(): string {
  // Check if trace events were enabled via command line
  const cliCategories = typeof $getTraceEventCategories !== "undefined" ? $getTraceEventCategories() : "";
  if (cliCategories) {
    const categories = cliCategories.split(",").filter(c => c.length > 0);
    if (categories.length > 0 && !traceEventCollector) {
      // Enable tracing for CLI-specified categories
      const tracing = createTracing({ categories });
      tracing.enable();
    }
  }

  return Array.from(enabledCategories).join(",");
}

export default {
  createTracing,
  getEnabledCategories,
};
