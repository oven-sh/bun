// Hardcoded module "node:inspector" and "node:inspector/promises"
// Profiler APIs are implemented; other inspector APIs are stubs.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const EventEmitter = require("node:events");

// Native profiler functions exposed via $newCppFunction
const startCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startCPUProfiler", 0);
const stopCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopCPUProfiler", 0);
const setCPUSamplingInterval = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_setCPUSamplingInterval", 1);
const isCPUProfilerRunning = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_isCPUProfilerRunning", 0);

function open() {
  throwNotImplemented("node:inspector", 2445);
}

function close() {
  throwNotImplemented("node:inspector", 2445);
}

function url() {
  // Return undefined since that is allowed by the Node.js API
  // https://nodejs.org/api/inspector.html#inspectorurl
  return undefined;
}

function waitForDebugger() {
  throwNotImplemented("node:inspector", 2445);
}

// Sessions with the Runtime domain enabled receive Runtime.consoleAPICalled
// notifications for console calls, like Node's in-process inspector sessions.
const runtimeEnabledSessions = new Set<Session>();
const hookedConsoleMethods: Array<[string, Function, Function]> = [];

const CONSOLE_API_TYPES: Record<string, string> = {
  log: "log",
  info: "info",
  warn: "warning",
  error: "error",
  debug: "debug",
  trace: "trace",
  dir: "dir",
  table: "table",
  group: "startGroup",
  groupCollapsed: "startGroupCollapsed",
  groupEnd: "endGroup",
};

function toRemoteObject(arg: unknown): object {
  switch (typeof arg) {
    case "string":
      return { type: "string", value: arg };
    case "number":
      return Number.isFinite(arg)
        ? { type: "number", value: arg, description: String(arg) }
        : {
            type: "number",
            unserializableValue: String(arg),
            description: String(arg),
          };
    case "boolean":
      return { type: "boolean", value: arg };
    case "undefined":
      return { type: "undefined" };
    case "bigint":
      return {
        type: "bigint",
        unserializableValue: `${arg}n`,
        description: `${arg}n`,
      };
    case "symbol":
      return { type: "symbol", description: String(arg) };
    case "function":
      return {
        type: "function",
        description: Function.prototype.toString.$call(arg),
      };
    default:
      if (arg === null) return { type: "object", subtype: "null", value: null };
      return {
        type: "object",
        description: Object.prototype.toString.$call(arg),
      };
  }
}

// Node delivers consoleAPICalled through V8's message pump, so a listener
// that logs cannot re-enter the console hook. We emit synchronously, so a
// guard is needed: console calls made from inside a listener run the
// original method but are not re-emitted.
let emittingConsoleAPI = false;

function emitConsoleAPICalled(type: string, args: unknown[]) {
  if (emittingConsoleAPI) return;
  emittingConsoleAPI = true;
  try {
    const timestamp = Date.now();
    for (const session of runtimeEnabledSessions) {
      // Neither a throwing listener nor a throwing argument serialization
      // (toRemoteObject reads user-controlled toString) may make the console
      // call itself throw, suppress the underlying output, or starve later
      // sessions; Node surfaces listener exceptions as process warnings.
      try {
        // A fresh message per session: a listener that mutates its payload
        // must not contaminate what the next session receives.
        const message = {
          method: "Runtime.consoleAPICalled",
          params: {
            type,
            args: args.map(toRemoteObject),
            executionContextId: 1,
            timestamp,
          },
        };
        session.emit("inspectorNotification", message);
        session.emit("Runtime.consoleAPICalled", message);
      } catch (e) {
        let warning: Error;
        // Both `instanceof` (prototype walk) and String(e) can themselves
        // throw on hostile values like a thrown revoked Proxy, which would
        // defeat this guard.
        try {
          warning = e instanceof Error ? e : new Error(String(e));
        } catch {
          warning = new Error("Runtime.consoleAPICalled handler threw a value that could not be stringified");
        }
        process.emitWarning(warning);
      }
    }
  } finally {
    emittingConsoleAPI = false;
  }
}

function makeConsoleHook(type: string, original: Function): Function {
  return function (this: unknown, ...args: unknown[]) {
    emitConsoleAPICalled(type, args);
    return original.$apply(this, args);
  };
}

function installConsoleHooks() {
  if (hookedConsoleMethods.length > 0) return;
  const consoleObject = globalThis.console;
  for (const method in CONSOLE_API_TYPES) {
    const original = consoleObject[method];
    if (typeof original !== "function") continue;
    const hook = makeConsoleHook(CONSOLE_API_TYPES[method], original);
    hookedConsoleMethods.push([method, original, hook]);
    consoleObject[method] = hook;
  }
}

function removeConsoleHooks() {
  const consoleObject = globalThis.console;
  for (const [method, original, hook] of hookedConsoleMethods) {
    // Only restore slots that still hold our hook — user code may have
    // reassigned the method since the Runtime domain was enabled.
    if (consoleObject[method] === hook) {
      consoleObject[method] = original;
    }
  }
  hookedConsoleMethods.length = 0;
}

class Session extends EventEmitter {
  #connected = false;
  #profilerEnabled = false;

  connect() {
    if (this.#connected) {
      throw new Error("Session is already connected");
    }
    this.#connected = true;
  }

  connectToMainThread() {
    this.connect();
  }

  disconnect() {
    if (!this.#connected) return;
    if (isCPUProfilerRunning()) stopCPUProfiler();
    this.#profilerEnabled = false;
    this.#connected = false;
    runtimeEnabledSessions.delete(this);
    if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
  }

  post(
    method: string,
    params?: object | ((err: Error | null, result?: any) => void),
    callback?: (err: Error | null, result?: any) => void,
  ) {
    // Handle overloaded signature: post(method, callback)
    if (typeof params === "function") {
      callback = params;
      params = undefined;
    }

    if (!this.#connected) {
      const error = new Error("Session is not connected");
      if (callback) {
        queueMicrotask(() => callback(error));
        return;
      }
      throw error;
    }

    const result = this.#handleMethod(method, params as object | undefined);

    if (callback) {
      // Callback API - async
      queueMicrotask(() => {
        if (result instanceof Error) {
          callback(result, undefined);
        } else {
          callback(null, result);
        }
      });
    } else {
      // Sync throw for errors when no callback
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }
  }

  #handleMethod(method: string, params?: object): any {
    switch (method) {
      case "Runtime.enable":
        runtimeEnabledSessions.add(this);
        installConsoleHooks();
        return {};

      case "Runtime.disable":
        runtimeEnabledSessions.delete(this);
        if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
        return {};

      case "Profiler.enable":
        this.#profilerEnabled = true;
        return {};

      case "Profiler.disable":
        if (isCPUProfilerRunning()) {
          stopCPUProfiler();
        }
        this.#profilerEnabled = false;
        return {};

      case "Profiler.start":
        if (!this.#profilerEnabled) return new Error("Profiler is not enabled. Call Profiler.enable first.");
        if (!isCPUProfilerRunning()) startCPUProfiler();
        return {};

      case "Profiler.stop":
        if (!isCPUProfilerRunning()) return new Error("Profiler is not started. Call Profiler.start first.");
        try {
          return { profile: JSON.parse(stopCPUProfiler()) };
        } catch (e) {
          return new Error(`Failed to parse profile JSON: ${e}`);
        }

      case "Profiler.setSamplingInterval": {
        if (isCPUProfilerRunning()) return new Error("Cannot change sampling interval while profiler is running");
        const interval = (params as any)?.interval;
        if (typeof interval !== "number" || interval <= 0) return new Error("interval must be a positive number");
        setCPUSamplingInterval(interval);
        return {};
      }

      case "Profiler.getBestEffortCoverage":
      case "Profiler.startPreciseCoverage":
      case "Profiler.stopPreciseCoverage":
      case "Profiler.takePreciseCoverage":
        return new Error("Coverage APIs are not supported");

      default:
        return new Error(`Inspector method "${method}" is not supported`);
    }
  }
}

const console = {
  ...globalThis.console,
  context: {
    console: globalThis.console,
  },
};

export default {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
};

hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
