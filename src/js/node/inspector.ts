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
