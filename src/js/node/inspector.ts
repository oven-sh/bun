// Hardcoded module "node:inspector" and "node:inspector/promises"
// Profiler APIs are implemented; other inspector APIs are stubs.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const EventEmitter = require("node:events");
const { pathToFileURL } = require("node:url");
const { isAbsolute } = require("node:path");

// Native profiler functions exposed via $newCppFunction
const startCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startCPUProfiler", 0);
const stopCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopCPUProfiler", 0);
const setCPUSamplingInterval = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_setCPUSamplingInterval", 1);
const isCPUProfilerRunning = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_isCPUProfilerRunning", 0);
const startPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startPreciseCoverage", 0);
const stopPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopPreciseCoverage", 0);
const collectPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_collectPreciseCoverage", 0);

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
        // Node's Session#onMessage emits the method-specific event first,
        // then the generic "inspectorNotification".
        session.emit("Runtime.consoleAPICalled", message);
        session.emit("inspectorNotification", message);
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

// Reshapes the raw control-flow-profiler data from jsFunction_collectPreciseCoverage
// ([{ url, scriptId, sourceLength, blocks: [[start, end, count]], functions: [[start, end, executed]] }])
// into the V8 ScriptCoverage list returned by Profiler.takePreciseCoverage:
// each function gets an entry whose first range spans the whole function with its
// call count, followed by the basic-block ranges inside it; blocks outside any
// function go on a synthetic whole-script entry.
function buildScriptCoverageList(
  rawScripts: Array<{
    url: string;
    scriptId: number;
    sourceLength: number;
    blocks: Array<[number, number, number]>;
    functions: Array<[number, number, boolean]>;
  }>,
  callCount: boolean,
  detailed: boolean,
): object[] {
  const result: object[] = [];

  for (const script of rawScripts) {
    const { scriptId, sourceLength } = script;
    let { url } = script;
    // V8 coverage reports file-backed scripts with file:// URLs even when the
    // script name is a plain filesystem path (e.g. a vm script filename or a
    // require()d module), so convert absolute paths the same way.
    if (url && isAbsolute(url)) {
      url = pathToFileURL(url).href;
    }

    // Outer functions before nested ones, so a stack-based sweep below sees
    // enclosing ranges first.
    const functions = script.functions
      .filter(([start, end]) => start >= 0 && end >= start)
      .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const blocks = script.blocks.filter(([start, end]) => start >= 0 && end >= start).sort((a, b) => a[0] - b[0]);

    // Assign each basic block to the innermost function range containing it.
    const blocksPerFunction: Array<Array<[number, number, number]>> = functions.map(() => []);
    const topLevelBlocks: Array<[number, number, number]> = [];
    const stack: number[] = [];
    let nextFunction = 0;
    for (const block of blocks) {
      while (nextFunction < functions.length && functions[nextFunction][0] <= block[0]) {
        stack.push(nextFunction);
        nextFunction++;
      }
      // Functions that ended before this block started can no longer contain
      // this block or any later one (blocks are sorted by start).
      while (stack.length > 0 && functions[stack[stack.length - 1]][1] < block[0]) {
        stack.pop();
      }
      // The stack is a nesting chain (siblings get popped above), so ends
      // decrease towards the top; the first entry from the top that still
      // covers the block's end is the innermost containing function.
      let owner = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (functions[stack[i]][1] >= block[1]) {
          owner = stack[i];
          break;
        }
      }
      if (owner === -1) {
        topLevelBlocks.push(block);
      } else {
        blocksPerFunction[owner].push(block);
      }
    }

    const scriptExecuted =
      blocks.some(([, , count]) => count > 0) || functions.some(([, , executed]) => executed) ? 1 : 0;
    const entries: object[] = [];

    const toRange = ([startOffset, endOffset, count]: [number, number, number]) => ({
      startOffset,
      endOffset,
      count: callCount ? count : count > 0 ? 1 : 0,
    });

    // Whole-script entry. V8 always reports one covering the entire source.
    entries.push({
      functionName: "",
      ranges: [
        { startOffset: 0, endOffset: sourceLength, count: scriptExecuted },
        ...(detailed ? topLevelBlocks.map(toRange) : []),
      ],
      isBlockCoverage: detailed,
    });

    for (let i = 0; i < functions.length; i++) {
      const [startOffset, endOffset, executed] = functions[i];
      if (!executed) {
        entries.push({
          functionName: "",
          ranges: [{ startOffset, endOffset, count: 0 }],
          isBlockCoverage: false,
        });
        continue;
      }

      const ownBlocks = blocksPerFunction[i];
      // The block with the smallest start offset is the function's entry
      // block; it runs exactly once per invocation, so its execution count is
      // the call count.
      let count = 1;
      if (ownBlocks.length > 0) {
        let entryBlock = ownBlocks[0];
        for (const block of ownBlocks) {
          if (block[0] < entryBlock[0]) entryBlock = block;
        }
        count = entryBlock[2];
      }
      entries.push({
        functionName: "",
        ranges: [
          { startOffset, endOffset, count: callCount ? count : count > 0 ? 1 : 0 },
          ...(detailed ? ownBlocks.map(toRange) : []),
        ],
        isBlockCoverage: detailed,
      });
    }

    result.push({ scriptId: String(scriptId), url, functions: entries });
  }

  return result;
}

function collectCoverageScripts(): any[] | Error {
  const raw = collectPreciseCoverage();
  if (raw === null) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return new Error(`Failed to parse coverage JSON: ${e}`);
  }
}

class Session extends EventEmitter {
  #connected = false;
  #profilerEnabled = false;
  #preciseCoverageEnabled = false;
  #preciseCoverageCallCount = false;
  #preciseCoverageDetailed = false;

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
    if (this.#preciseCoverageEnabled) {
      stopPreciseCoverage();
      this.#preciseCoverageEnabled = false;
    }
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

      case "Profiler.startPreciseCoverage": {
        if (!this.#profilerEnabled) return new Error("Profiler is not enabled");
        if (!this.#preciseCoverageEnabled) {
          startPreciseCoverage();
          this.#preciseCoverageEnabled = true;
        }
        this.#preciseCoverageCallCount = !!(params as any)?.callCount;
        this.#preciseCoverageDetailed = !!(params as any)?.detailed;
        return { timestamp: Date.now() / 1000 };
      }

      case "Profiler.stopPreciseCoverage": {
        if (!this.#profilerEnabled) return new Error("Profiler is not enabled");
        if (this.#preciseCoverageEnabled) {
          stopPreciseCoverage();
          this.#preciseCoverageEnabled = false;
        }
        return {};
      }

      case "Profiler.takePreciseCoverage": {
        if (!this.#preciseCoverageEnabled) return new Error("Precise coverage has not been started.");
        const scripts = collectCoverageScripts();
        if (scripts instanceof Error) return scripts;
        return {
          result: buildScriptCoverageList(scripts, this.#preciseCoverageCallCount, this.#preciseCoverageDetailed),
          timestamp: Date.now() / 1000,
        };
      }

      case "Profiler.getBestEffortCoverage": {
        // Best-effort coverage reports whatever execution data already exists,
        // at function granularity with 0/1 counts, like V8 does.
        const scripts = collectCoverageScripts();
        if (scripts instanceof Error) return scripts;
        return { result: buildScriptCoverageList(scripts, false, false) };
      }

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
