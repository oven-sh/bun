// Hardcoded module "node:inspector" and "node:inspector/promises"
// Implemented: the in-process Session (Profiler CPU profiles and precise
// coverage, Runtime console notifications, forwarded Debugger.* configuration),
// and open()/url()/close()/waitForDebugger() backed by a Chrome DevTools
// Protocol WebSocket server with breakpoint pausing.
const { hideFromStack } = require("internal/shared");
const { validateString, validateFunction } = require("internal/validators");
const { SafeSet, SafeMap } = require("internal/primordials");
const EventEmitter = require("node:events");
const { pathToFileURL } = require("node:url");
const { isAbsolute } = require("node:path");
const types = require("node:util/types");
const DateNow = Date.now;
const PerformanceNow = performance.now.bind(performance);
const ObjectKeys = Object.keys;
const ObjectIs = Object.is;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeToString = Object.prototype.toString;
const ArrayPrototypeSlice = Array.prototype.slice;
const FunctionPrototypeToString = Function.prototype.toString;
const DatePrototypeToString = Date.prototype.toString;
const RegExpPrototypeToString = RegExp.prototype.toString;
const ErrorPrototypeToString = Error.prototype.toString;
const MapPrototypeGetSize = ObjectGetOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const SetPrototypeGetSize = ObjectGetOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const MapPrototypeEntries = Map.prototype.entries;
const SetPrototypeValues = Set.prototype.values;
const TypedArrayPrototype = ObjectGetPrototypeOf(Uint8Array.prototype);
const TypedArrayPrototypeGetLength = ObjectGetOwnPropertyDescriptor(TypedArrayPrototype, "length")!.get!;
const TypedArrayPrototypeGetToStringTag = ObjectGetOwnPropertyDescriptor(TypedArrayPrototype, Symbol.toStringTag)!.get!;
const ErrorCaptureStackTrace = Error.captureStackTrace;

// #handleMethod return marker for inspector-protocol errors: the callback
// receives the plain `{ code, message }` object (Node delivers protocol
// errors as plain objects, not Error instances).
const kProtocolError = Symbol("kProtocolError");

// Native profiler functions exposed via $newCppFunction
const startCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startCPUProfiler", 0);
const stopCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopCPUProfiler", 0);
const setCPUSamplingInterval = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_setCPUSamplingInterval", 1);
const isCPUProfilerRunning = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_isCPUProfilerRunning", 0);
const startPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startPreciseCoverage", 0);
const stopPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopPreciseCoverage", 0);
const collectPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_collectPreciseCoverage", 0);

// Native bindings for inspector.open(): they start Bun's debugger thread with a
// WebSocket server that speaks the V8 Chrome DevTools Protocol (see
// internal/debugger.ts and internal/inspector/cdp.ts).
const openNodeInspector = $newCppFunction("BunDebugger.cpp", "jsFunction_openNodeInspector", 2);
const waitForNodeInspectorConnection = $newCppFunction(
  "BunDebugger.cpp",
  "jsFunction_waitForNodeInspectorConnection",
  0,
);
const postNodeInspectorControl = $newCppFunction("BunDebugger.cpp", "jsFunction_postNodeInspectorControl", 1);
const closeNodeInspector = $newCppFunction("BunDebugger.cpp", "jsFunction_closeNodeInspector", 0);

let activeInspectorUrl: string | undefined;

function open(port?: number, host?: string, wait?: boolean) {
  if (activeInspectorUrl !== undefined) {
    throw $ERR_INSPECTOR_ALREADY_ACTIVATED();
  }
  if (!Bun.isMainThread) {
    // Node supports per-worker inspectors; Bun does not yet.
    throw $ERR_WORKER_UNSUPPORTED_OPERATION("inspector.open() is not supported in workers");
  }

  if (port !== undefined && port !== null) {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
      throw $ERR_OUT_OF_RANGE("port", ">= 0 && <= 65535", port);
    }
  }
  const portNumber = port === undefined || port === null ? process.debugPort : port;
  const hostname = typeof host === "string" && host.length > 0 ? host : "127.0.0.1";
  // Bracket bare IPv6 hosts so they survive URL parsing.
  const hostPart = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  const requestedUrl = `ws://${hostPart}:${portNumber}/${globalThis.crypto.randomUUID()}`;

  const disposable = {
    __proto__: null,
    [Symbol.dispose]() {
      close();
    },
  };

  let resolvedUrl: string | null;
  try {
    resolvedUrl = openNodeInspector(requestedUrl, !!wait);
  } catch (e) {
    // Node prints one diagnostic line and returns instead of throwing when the
    // socket cannot be bound, so a caller can retry with a different port.
    const raw = (e as Error)?.message ?? String(e);
    const prefix = "Failed to start inspector: ";
    const detail = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    process.stderr.write(`Starting inspector on ${hostname}:${portNumber} failed: ${detail}\n`);
    return disposable;
  }
  if (resolvedUrl === null) {
    // A prior inspector.open() success is caught by the top guard above, so
    // null here means the debugger thread was started outside node:inspector
    // (CLI --inspect / BUN_INSPECT). That server speaks the JSC protocol and
    // never registered a controlCallback, so inspector.close() cannot shut it
    // down; the default ERR_INSPECTOR_ALREADY_ACTIVATED message would send the
    // user to a no-op close().
    throw $ERR_INSPECTOR_ALREADY_ACTIVATED(
      "An inspector was already started via --inspect and cannot be reopened from node:inspector",
    );
  }

  activeInspectorUrl = resolvedUrl;
  // Node writes the resolved port back so process.debugPort reflects it after
  // open(0) picks an ephemeral port.
  try {
    process.debugPort = Number(new URL(resolvedUrl).port);
  } catch {}
  process.stderr.write(`Debugger listening on ${resolvedUrl}\n`);

  if (wait) {
    waitForNodeInspectorConnection();
  }

  return disposable;
}

function close() {
  if (activeInspectorUrl === undefined) {
    return;
  }
  // Sends the "close" control message and blocks until the debugger thread has
  // stopped the server, so the port is already refused when close() returns.
  closeNodeInspector();
  activeInspectorUrl = undefined;
}

function url() {
  // https://nodejs.org/api/inspector.html#inspectorurl
  return activeInspectorUrl;
}

function waitForDebugger() {
  if (activeInspectorUrl === undefined) {
    throw $ERR_INSPECTOR_NOT_ACTIVE();
  }
  waitForNodeInspectorConnection();
}

// Sessions with Runtime enabled receive Runtime.consoleAPICalled for console
// calls. This monkey-patches globalThis.console (not JSC's ConsoleClient as
// cdp.ts does), so pre-captured refs bypass it.
// SafeSet iteration is tamper-proof (own frozen Symbol.iterator), so a hostile
// Set.prototype[Symbol.iterator] cannot make console.log itself throw from
// inside the hook's for-of loop head.
const runtimeEnabledSessions: Set<Session> = new SafeSet();
const hookedConsoleMethods: Array<[string, Function, Function]> = [];

// Methods whose arguments are forwarded verbatim as the event args.
const CONSOLE_API_TYPES: Record<string, string> = {
  __proto__: null,
  log: "log",
  info: "info",
  warn: "warning",
  error: "error",
  debug: "debug",
  trace: "trace",
  dir: "dir",
  dirxml: "dirxml",
  table: "table",
  clear: "clear",
  group: "startGroup",
  groupCollapsed: "startGroupCollapsed",
  groupEnd: "endGroup",
};

// Methods whose event args are derived (not the raw JS args) and so need bespoke hooks below.
const CONSOLE_API_SPECIAL = ["assert", "count", "countReset", "time", "timeLog", "timeEnd"];

const PREVIEW_MAX_PROPERTIES = 5;
const MAX_DESCRIPTION_LENGTH = 100;

// Synthetic objectId for shape parity with V8; there is no Runtime.getProperties backend to dereference it.
let nextRemoteObjectId = 1;

function constructorName(value: object): string | undefined {
  try {
    let proto: object | null = value;
    // Bounded: a Proxy getPrototypeOf trap may return itself (legal ES), which would loop forever.
    for (let i = 0; proto !== null && i < 100; i++) {
      const descriptor = ObjectGetOwnPropertyDescriptor(proto, "constructor");
      if (descriptor !== undefined) {
        const ctor = descriptor.value;
        if ($isCallable(ctor)) {
          const name = ctor.name;
          if (typeof name === "string" && name.length > 0) return name;
        }
      }
      proto = ObjectGetPrototypeOf(proto);
    }
  } catch {}
  return undefined;
}

function truncate(text: string): string {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text;
  let end = MAX_DESCRIPTION_LENGTH;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return text.slice(0, end) + "…";
}

function classifyObject(value: object): { subtype?: string; className: string; description: string } {
  if ($isProxyObject(value)) {
    const className = constructorName(value) ?? "Object";
    return { subtype: "proxy", className, description: `Proxy(${className})` };
  }
  if ($isJSArray(value) || $isArray(value)) {
    const className = constructorName(value) ?? "Array";
    return { subtype: "array", className, description: `${className}(${(value as unknown[]).length})` };
  }
  if (types.isNativeError(value)) {
    let description;
    try {
      const stack = (value as Error).stack;
      description = typeof stack === "string" && stack.length > 0 ? stack : ErrorPrototypeToString.$call(value);
    } catch {
      description = "Error";
    }
    return { subtype: "error", className: constructorName(value) ?? "Error", description };
  }
  if ($isRegExpObject(value)) {
    let description;
    try {
      description = RegExpPrototypeToString.$call(value);
    } catch {
      description = "RegExp";
    }
    return { subtype: "regexp", className: constructorName(value) ?? "RegExp", description };
  }
  if (types.isDate(value)) {
    let description;
    try {
      description = DatePrototypeToString.$call(value);
    } catch {
      description = "Date";
    }
    return { subtype: "date", className: constructorName(value) ?? "Date", description };
  }
  if ($isMap(value)) {
    const className = constructorName(value) ?? "Map";
    return { subtype: "map", className, description: `${className}(${MapPrototypeGetSize.$call(value)})` };
  }
  if ($isSet(value)) {
    const className = constructorName(value) ?? "Set";
    return { subtype: "set", className, description: `${className}(${SetPrototypeGetSize.$call(value)})` };
  }
  if (types.isWeakMap(value))
    return { subtype: "weakmap", className: constructorName(value) ?? "WeakMap", description: "WeakMap" };
  if (types.isWeakSet(value))
    return { subtype: "weakset", className: constructorName(value) ?? "WeakSet", description: "WeakSet" };
  if ($isPromise(value))
    return { subtype: "promise", className: constructorName(value) ?? "Promise", description: "Promise" };
  if (types.isTypedArray(value)) {
    const className = TypedArrayPrototypeGetToStringTag.$call(value) ?? constructorName(value) ?? "TypedArray";
    return {
      subtype: "typedarray",
      className,
      description: `${className}(${TypedArrayPrototypeGetLength.$call(value)})`,
    };
  }
  if (types.isDataView(value))
    return {
      subtype: "dataview",
      className: constructorName(value) ?? "DataView",
      description: `DataView(${(value as DataView).byteLength})`,
    };
  if (types.isArrayBuffer(value))
    return {
      subtype: "arraybuffer",
      className: constructorName(value) ?? "ArrayBuffer",
      description: `ArrayBuffer(${(value as ArrayBuffer).byteLength})`,
    };
  if (types.isSharedArrayBuffer(value))
    return {
      subtype: "arraybuffer",
      className: constructorName(value) ?? "SharedArrayBuffer",
      description: `SharedArrayBuffer(${(value as SharedArrayBuffer).byteLength})`,
    };
  if (types.isGeneratorObject(value)) {
    const className = constructorName(value) ?? "Generator";
    return { subtype: "generator", className, description: className };
  }
  if (types.isMapIterator(value) || types.isSetIterator(value)) {
    const className = constructorName(value) ?? "Iterator";
    return { subtype: "iterator", className, description: className };
  }
  const className = constructorName(value) ?? "Object";
  return { className, description: className };
}

function previewValue(value: unknown): { type: string; value: string; subtype?: string } {
  switch (typeof value) {
    case "string":
      return { type: "string", value: truncate(value) };
    case "number":
      return { type: "number", value: ObjectIs(value, -0) ? "-0" : `${value}` };
    case "boolean":
      return { type: "boolean", value: `${value}` };
    case "undefined":
      return { type: "undefined", value: "undefined" };
    case "bigint":
      return { type: "bigint", value: `${value}n` };
    case "symbol":
      return { type: "symbol", value: String(value) };
    case "function":
      return { type: "function", value: "" };
    default: {
      if (value === null) return { type: "object", subtype: "null", value: "null" };
      let info;
      try {
        info = classifyObject(value);
      } catch {
        return { type: "object", value: "Object" };
      }
      const { subtype, description } = info;
      const entry: { type: string; value: string; subtype?: string } = {
        type: "object",
        value: truncate(description),
      };
      if (subtype !== undefined) entry.subtype = subtype;
      return entry;
    }
  }
}

function entryPreview(value: unknown): object {
  const { type, value: description, subtype } = previewValue(value);
  const out: AnyRecord = { type, description, overflow: false, properties: [] };
  if (subtype !== undefined) out.subtype = subtype;
  return out;
}

type AnyRecord = Record<string, any>;

function buildPreview(value: object, subtype: string | undefined, description: string): object {
  const preview: AnyRecord = { type: "object", description, overflow: false, properties: [] };
  if (subtype !== undefined) preview.subtype = subtype;
  const properties: AnyRecord[] = preview.properties;

  try {
    if (subtype === "array" || subtype === "typedarray") {
      const length = subtype === "typedarray" ? TypedArrayPrototypeGetLength.$call(value) : (value as unknown[]).length;
      const shown = length > PREVIEW_MAX_PROPERTIES ? PREVIEW_MAX_PROPERTIES : length;
      for (let i = 0; i < shown; i++) properties.push({ name: `${i}`, ...previewValue((value as any)[i]) });
      if (length > shown) preview.overflow = true;
    } else if (subtype === "map") {
      const entries: AnyRecord[] = [];
      let count = 0;
      for (const [k, v] of MapPrototypeEntries.$call(value)) {
        if (count >= PREVIEW_MAX_PROPERTIES) {
          preview.overflow = true;
          break;
        }
        entries.push({ key: entryPreview(k), value: entryPreview(v) });
        count++;
      }
      preview.entries = entries;
    } else if (subtype === "set") {
      const entries: AnyRecord[] = [];
      let count = 0;
      for (const v of SetPrototypeValues.$call(value)) {
        if (count >= PREVIEW_MAX_PROPERTIES) {
          preview.overflow = true;
          break;
        }
        entries.push({ value: entryPreview(v) });
        count++;
      }
      preview.entries = entries;
    } else if (subtype === "error") {
      const message = (value as Error).message;
      const stack = (value as Error).stack;
      if (typeof stack === "string") properties.push({ name: "stack", type: "string", value: truncate(stack) });
      if (typeof message === "string") properties.push({ name: "message", type: "string", value: truncate(message) });
    } else if (
      subtype === "regexp" ||
      subtype === "date" ||
      subtype === "weakmap" ||
      subtype === "weakset" ||
      subtype === "promise" ||
      subtype === "proxy"
    ) {
      // No property preview for these subtypes.
    } else {
      const keys = ObjectKeys(value);
      const shown = keys.length > PREVIEW_MAX_PROPERTIES ? PREVIEW_MAX_PROPERTIES : keys.length;
      for (let i = 0; i < shown; i++) {
        const name = keys[i];
        properties.push({ name, ...previewValue((value as AnyRecord)[name]) });
      }
      if (keys.length > shown) preview.overflow = true;
    }
  } catch {}
  return preview;
}

function toRemoteObject(arg: unknown): object {
  switch (typeof arg) {
    case "string":
      return { type: "string", value: arg };
    case "number":
      if (ObjectIs(arg, -0)) return { type: "number", unserializableValue: "-0", description: "-0" };
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
    case "function": {
      let description;
      try {
        description = FunctionPrototypeToString.$call(arg);
      } catch {
        description = "function () {}";
      }
      return {
        type: "function",
        className: constructorName(arg as object) ?? "Function",
        description,
        objectId: `bun.1.${nextRemoteObjectId++}`,
      };
    }
    default: {
      if (arg === null) return { type: "object", subtype: "null", value: null };
      let info: { subtype?: string; className: string; description: string };
      try {
        info = classifyObject(arg);
      } catch {
        info = { className: "Object", description: ObjectPrototypeToString.$call(arg) };
      }
      const { subtype, className, description } = info;
      const remote: AnyRecord = {
        type: "object",
        className,
        description,
        objectId: `bun.1.${nextRemoteObjectId++}`,
        preview: buildPreview(arg, subtype, description),
      };
      if (subtype !== undefined) remote.subtype = subtype;
      return remote;
    }
  }
}

function prepareCDPCallFrames(_err: unknown, callSites: any[]): object[] {
  const frames: object[] = [];
  for (let i = 0; i < callSites.length; i++) {
    const site = callSites[i];
    const line = site.getLineNumber();
    const column = site.getColumnNumber();
    const url = site.getFileName() ?? "";
    frames.push({
      functionName: site.getFunctionName() ?? "",
      scriptId: `${site.getScriptId() ?? ""}`,
      url: typeof url === "string" && isAbsolute(url) ? pathToFileURL(url).href : url,
      // CDP positions are 0-based; CallSite line numbers are 1-based.
      lineNumber: typeof line === "number" && line > 0 ? line - 1 : 0,
      columnNumber: typeof column === "number" && column >= 0 ? column : 0,
    });
  }
  return frames;
}

const CONSOLE_STACK_TRACE_LIMIT = 30;

function captureCDPStackTrace(skipAbove: Function): object[] | undefined {
  // Every Error.* touch is guarded so hostile getters/setters/freeze cannot make console.* itself throw.
  const target: { stack?: object[] } = {};
  let savedPrepare: unknown;
  let savedLimit: unknown;
  try {
    savedPrepare = Error.prepareStackTrace;
    savedLimit = Error.stackTraceLimit;
  } catch {
    return undefined;
  }
  try {
    Error.prepareStackTrace = prepareCDPCallFrames;
    try {
      Error.stackTraceLimit = CONSOLE_STACK_TRACE_LIMIT;
    } catch {}
    ErrorCaptureStackTrace(target, skipAbove);
  } catch {
  } finally {
    try {
      Error.prepareStackTrace = savedPrepare as any;
    } catch {}
    try {
      Error.stackTraceLimit = savedLimit as number;
    } catch {}
  }
  const callFrames = target.stack;
  return $isArray(callFrames) ? callFrames : undefined;
}

// Node delivers consoleAPICalled through V8's message pump, so a listener
// that logs cannot re-enter the console hook. We emit synchronously, so a
// guard is needed: console calls made from inside a listener run the
// original method but are not re-emitted.
let emittingConsoleAPI = false;

function emitConsoleAPICalled(type: string, args: unknown[], hook: Function) {
  if (emittingConsoleAPI) return;
  emittingConsoleAPI = true;
  try {
    const timestamp = DateNow();
    const callFrames = captureCDPStackTrace(hook);
    for (const session of runtimeEnabledSessions) {
      // Neither a throwing listener nor a throwing argument serialization
      // (toRemoteObject reads user-controlled getters) may make the console
      // call itself throw, suppress the underlying output, or starve later
      // sessions; Node surfaces listener exceptions as process warnings.
      try {
        // A fresh message per session: a listener that mutates its payload
        // must not contaminate what the next session receives.
        const params: AnyRecord = {
          type,
          args: args.map(toRemoteObject),
          executionContextId: 1,
          timestamp,
        };
        if (callFrames !== undefined) {
          const frames: object[] = [];
          for (let i = 0; i < callFrames.length; i++) frames.push({ ...(callFrames[i] as AnyRecord) });
          params.stackTrace = { callFrames: frames };
        }
        const message = { method: "Runtime.consoleAPICalled", params };
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

// Shadow counters/timers parallel to Bun's native C++ console state, which is not readable from JS.
const consoleCounts: Map<string, number> = new SafeMap();
const consoleTimers: Map<string, number> = new SafeMap();

function toLabel(label: unknown): string {
  return label === undefined ? "default" : `${label}`;
}

function makeConsoleHook(type: string, original: Function): Function {
  const hook = function (this: unknown, ...args: unknown[]) {
    emitConsoleAPICalled(type, args, hook);
    return original.$apply(this, args);
  };
  return hook;
}

function makeSpecialConsoleHook(method: string, original: Function): Function {
  switch (method) {
    case "assert": {
      const hook = function (this: unknown, ...args: unknown[]) {
        if (!args[0]) {
          const rest = ArrayPrototypeSlice.$call(args, 1);
          emitConsoleAPICalled("assert", rest.length > 0 ? rest : ["console.assert"], hook);
        }
        return original.$apply(this, args);
      };
      return hook;
    }
    case "count": {
      const hook = function (this: unknown, label?: unknown) {
        const key = toLabel(label);
        const next = (consoleCounts.get(key) ?? 0) + 1;
        consoleCounts.set(key, next);
        emitConsoleAPICalled("count", [`${key}: ${next}`], hook);
        return original.$call(this, key);
      };
      return hook;
    }
    case "countReset":
      return function (this: unknown, label?: unknown) {
        const key = toLabel(label);
        consoleCounts.delete(key);
        return original.$call(this, key);
      };
    case "time":
      return function (this: unknown, label?: unknown) {
        const key = toLabel(label);
        if (!consoleTimers.has(key)) consoleTimers.set(key, PerformanceNow());
        return original.$call(this, key);
      };
    case "timeLog": {
      const hook = function (this: unknown) {
        const forward = ArrayPrototypeSlice.$call(arguments);
        const key = toLabel(forward[0]);
        forward[0] = key;
        const start = consoleTimers.get(key);
        if (start !== undefined) {
          const emitArgs = ArrayPrototypeSlice.$call(forward);
          emitArgs[0] = `${key}: ${PerformanceNow() - start} ms`;
          emitConsoleAPICalled("log", emitArgs, hook);
        }
        return original.$apply(this, forward);
      };
      return hook;
    }
    case "timeEnd": {
      const hook = function (this: unknown, label?: unknown) {
        const key = toLabel(label);
        const start = consoleTimers.get(key);
        if (start !== undefined) {
          consoleTimers.delete(key);
          emitConsoleAPICalled("timeEnd", [`${key}: ${PerformanceNow() - start} ms`], hook);
        }
        return original.$call(this, key);
      };
      return hook;
    }
    default:
      return original;
  }
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
  for (let i = 0; i < CONSOLE_API_SPECIAL.length; i++) {
    const method = CONSOLE_API_SPECIAL[i];
    const original = consoleObject[method];
    if (typeof original !== "function") continue;
    const hook = makeSpecialConsoleHook(method, original);
    hookedConsoleMethods.push([method, original, hook]);
    consoleObject[method] = hook;
  }
}

function removeConsoleHooks() {
  const consoleObject = globalThis.console;
  for (let i = 0; i < hookedConsoleMethods.length; i++) {
    const entry = hookedConsoleMethods[i];
    // Only restore slots that still hold our hook — user code may have
    // reassigned the method since the Runtime domain was enabled.
    if (consoleObject[entry[0]] === entry[2]) {
      consoleObject[entry[0]] = entry[1];
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
    // V8 does not report empty scripts (the whole-script range would be zero-width).
    if (sourceLength === 0) continue;
    let { url } = script;
    // V8 coverage reports file-backed scripts with file:// URLs even when the
    // script name is a plain filesystem path (e.g. a vm script filename or a
    // require()d module), so convert absolute paths the same way.
    if (url && isAbsolute(url)) {
      url = pathToFileURL(url).href;
    }

    // Outer functions before nested ones, so a stack-based sweep below sees
    // enclosing ranges first. Zero-width entries are dropped: V8 never emits
    // startOffset === endOffset, and @bcoe/v8-coverage recurses forever on one.
    const functions = script.functions
      .filter(([start, end]) => start >= 0 && end > start)
      .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const blocks = script.blocks.filter(([start, end]) => start >= 0 && end > start).sort((a, b) => a[0] - b[0]);

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

    // Derived from the (delta-subtracted) block counts only: the function
    // `executed` flag is cumulative and would make a second takePreciseCoverage
    // report 1 even when nothing ran since the first.
    const scriptExecuted = blocks.some(([, , count]) => count > 0) ? 1 : 0;
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
      // Approximate the call count from the entry block (the one with the
      // smallest start offset). Diverges from V8 for generators/async
      // functions, which JSC compiles as two nested CodeBlocks whose body
      // entry counts state-0 resumes rather than user-visible calls.
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
    return $ERR_INSPECTOR_COMMAND(`-32000: Failed to parse coverage JSON: ${e}`);
  }
}

class Session extends EventEmitter {
  #connected = false;
  #profilerEnabled = false;
  #preciseCoverageEnabled = false;
  #preciseCoverageCallCount = false;
  #preciseCoverageDetailed = false;
  #forwardedDebugger = false;
  // Baseline for delta semantics: takePreciseCoverage must reset counters, but
  // JSC has no counter-reset API, so subtract the previous take instead.
  #coverageBaseline: Map<string, number> = new Map();

  // Report each block's count relative to the baseline, and make the raw
  // counts the new baseline.
  #rebaseCoverage(scripts: any[]) {
    const baseline = this.#coverageBaseline;
    for (const script of scripts) {
      for (const block of script.blocks) {
        const key = `${script.scriptId}:${block[0]}:${block[1]}`;
        const raw = block[2];
        block[2] = Math.max(0, raw - (baseline.$get(key) ?? 0));
        baseline.$set(key, raw);
      }
    }
  }

  #snapshotCoverageBaseline() {
    const scripts = collectCoverageScripts();
    if (!(scripts instanceof Error)) this.#rebaseCoverage(scripts);
  }

  connect() {
    if (this.#connected) {
      throw $ERR_INSPECTOR_ALREADY_CONNECTED();
    }
    this.#connected = true;
  }

  connectToMainThread() {
    if (Bun.isMainThread) {
      throw $ERR_INSPECTOR_NOT_WORKER();
    }
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
    this.#coverageBaseline.$clear();
    runtimeEnabledSessions.delete(this);
    if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
    // Forwarded Debugger.* state (breakpoints etc.) lives on a shared backend
    // on the debugger thread; release it so a disconnected session cannot keep
    // pausing the process, matching Node's disconnect() contract.
    if (this.#forwardedDebugger && activeInspectorUrl !== undefined) {
      postNodeInspectorControl(JSON.stringify({ type: "session-disconnect" }));
    }
    this.#forwardedDebugger = false;
  }

  post(
    method: string,
    params?: object | ((err: Error | null, result?: any) => void),
    callback?: (err: Error | null, result?: any) => void,
  ) {
    validateString(method, "method");
    // Handle overloaded signature: post(method, callback)
    if (callback === undefined && typeof params === "function") {
      callback = params;
      params = undefined;
    }
    if (params !== undefined && params !== null && typeof params !== "object") {
      throw $ERR_INVALID_ARG_TYPE("params", "Object", params);
    }
    if (callback !== undefined) validateFunction(callback, "callback");

    if (!this.#connected) {
      const error = $ERR_INSPECTOR_NOT_CONNECTED();
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
        } else if (result !== null && typeof result === "object" && kProtocolError in result) {
          callback(result[kProtocolError], undefined);
        } else {
          callback(null, result);
        }
      });
    } else {
      // Sync throw for errors when no callback
      if (result instanceof Error) {
        throw result;
      }
      if (result !== null && typeof result === "object" && kProtocolError in result) {
        const protocolError = result[kProtocolError];
        const error = new Error(protocolError.message);
        error.code = protocolError.code;
        throw error;
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
        // V8's Profiler agent stops precise coverage on disable; without this
        // the control-flow profiler keeps instrumenting newly-compiled code.
        if (this.#preciseCoverageEnabled) {
          stopPreciseCoverage();
          this.#preciseCoverageEnabled = false;
        }
        this.#profilerEnabled = false;
        return {};

      case "Profiler.start":
        if (!this.#profilerEnabled) return $ERR_INSPECTOR_COMMAND("-32000: Profiler is not enabled");
        if (!isCPUProfilerRunning()) startCPUProfiler();
        return {};

      case "Profiler.stop":
        if (!isCPUProfilerRunning()) return $ERR_INSPECTOR_COMMAND("-32000: Profiler is not started");
        try {
          return { profile: JSON.parse(stopCPUProfiler()) };
        } catch (e) {
          return $ERR_INSPECTOR_COMMAND(`-32000: Failed to parse profile JSON: ${e}`);
        }

      case "Profiler.setSamplingInterval": {
        if (isCPUProfilerRunning())
          return $ERR_INSPECTOR_COMMAND("-32000: Cannot change sampling interval while profiler is running");
        const interval = (params as any)?.interval;
        if (typeof interval !== "number" || interval <= 0)
          return $ERR_INSPECTOR_COMMAND("-32602: interval must be a positive number");
        setCPUSamplingInterval(interval);
        return {};
      }

      case "Profiler.startPreciseCoverage": {
        if (!this.#profilerEnabled) return $ERR_INSPECTOR_COMMAND("-32000: Profiler is not enabled");
        if (!this.#preciseCoverageEnabled) {
          startPreciseCoverage();
          this.#preciseCoverageEnabled = true;
        }
        this.#preciseCoverageCallCount = !!(params as any)?.callCount;
        this.#preciseCoverageDetailed = !!(params as any)?.detailed;
        // Counts start from zero here: the VM's profiler is never torn down once
        // enabled (see JSInspectorProfiler.cpp), so whatever it accumulated
        // before this start — an earlier session, or the window since a
        // stopPreciseCoverage — becomes the baseline the next take subtracts.
        this.#coverageBaseline.$clear();
        this.#snapshotCoverageBaseline();
        // CDP: monotonic seconds since an arbitrary origin (V8 uses TimeTicks).
        return { timestamp: performance.now() / 1000 };
      }

      case "Profiler.stopPreciseCoverage": {
        if (!this.#profilerEnabled) return $ERR_INSPECTOR_COMMAND("-32000: Profiler is not enabled");
        if (this.#preciseCoverageEnabled) {
          stopPreciseCoverage();
          this.#preciseCoverageEnabled = false;
        }
        this.#coverageBaseline.$clear();
        return {};
      }

      case "Profiler.takePreciseCoverage": {
        if (!this.#preciseCoverageEnabled)
          return $ERR_INSPECTOR_COMMAND("-32000: Precise coverage has not been started.");
        const scripts = collectCoverageScripts();
        if (scripts instanceof Error) return scripts;
        // CDP contract: takePreciseCoverage resets execution counters, so a
        // second take reports the delta. JSC has no counter reset, so subtract
        // the previous take's raw block counts (function-level call counts are
        // derived from the entry block, so they follow automatically).
        this.#rebaseCoverage(scripts);
        return {
          result: buildScriptCoverageList(scripts, this.#preciseCoverageCallCount, this.#preciseCoverageDetailed),
          timestamp: performance.now() / 1000,
        };
      }

      case "Profiler.getBestEffortCoverage": {
        // JSC has no always-on invocation counters, so unlike V8 this returns
        // [] unless startPreciseCoverage has run in this VM.
        const scripts = collectCoverageScripts();
        if (scripts instanceof Error) return scripts;
        return { result: buildScriptCoverageList(scripts, false, false) };
      }

      // Configuration-only Debugger commands are forwarded to the inspector
      // server started by inspector.open() (vitest --inspect-brk uses
      // Debugger.enable + Debugger.setBreakpointByUrl to stop at the first
      // test file). The forwarding is fire-and-forget: results such as
      // breakpointId are not available in-process.
      case "Debugger.enable":
      case "Debugger.disable":
      case "Debugger.setBreakpointByUrl":
      case "Debugger.removeBreakpoint":
      case "Debugger.setBreakpointsActive":
      case "Debugger.setPauseOnExceptions":
      case "Debugger.setSkipAllPauses":
      case "Debugger.setAsyncCallStackDepth":
      case "Debugger.setBlackboxPatterns": {
        if (activeInspectorUrl === undefined) {
          return $ERR_INSPECTOR_COMMAND(
            `-32000: Inspector method "${method}" requires an active inspector (call inspector.open() first)`,
          );
        }
        if (!this.#forwardedDebugger) {
          this.#forwardedDebugger = true;
          postNodeInspectorControl(JSON.stringify({ type: "session-connect" }));
        }
        postNodeInspectorControl(JSON.stringify({ type: "command", method, params }));
        return {};
      }

      case "NodeWorker.enable": {
        // Minimal NodeWorker domain stub for test-worker-name only: a session
        // connected from inside a worker reports itself. Main-thread child
        // enumeration is NOT implemented — return an error there instead of
        // silent success so callers know.
        const wt = require("node:worker_threads");
        if (wt.isMainThread) {
          return new Error("Inspector method NodeWorker.enable is not supported on the main thread yet");
        }
        const title = `[worker ${wt.threadId}] ${wt.threadName}`;
        const workerInfo = { workerId: String(wt.threadId), type: "worker", title };
        queueMicrotask(() => {
          this.emit("NodeWorker.attachedToWorker", {
            params: { sessionId: `worker:${wt.threadId}`, workerInfo },
          });
        });
        return {};
      }

      case "NodeWorker.disable":
      case "NodeWorker.detach":
        return {};

      case "NodeTracing.start": {
        if (!Bun.isMainThread) {
          return {
            [kProtocolError]: {
              code: -32000,
              message: "Tracing properties can only be changed through main thread sessions",
            },
          };
        }
        const includedCategories = (params as any)?.traceConfig?.includedCategories;
        const categories = $isArray(includedCategories) ? includedCategories : [];
        const started = require("internal/trace_events").inspectorStart(categories);
        if (!started) {
          return { [kProtocolError]: { code: -32000, message: "Tracing is already started" } };
        }
        return {};
      }

      case "NodeTracing.stop": {
        if (!Bun.isMainThread) {
          return {
            [kProtocolError]: {
              code: -32000,
              message: "Tracing properties can only be changed through main thread sessions",
            },
          };
        }
        const { collected, metadata } = require("internal/trace_events").inspectorStop();
        // Node streams the collected events back over the session in chunks
        // (trace events, then metadata) before signalling completion. Emit
        // synchronously: listeners observe everything before the post()
        // callback (queued as a microtask above) runs.
        this.emit("NodeTracing.dataCollected", {
          method: "NodeTracing.dataCollected",
          params: { value: collected },
        });
        this.emit("NodeTracing.dataCollected", {
          method: "NodeTracing.dataCollected",
          params: { value: metadata },
        });
        this.emit("NodeTracing.tracingComplete", { method: "NodeTracing.tracingComplete", params: {} });
        return {};
      }

      default:
        return $ERR_INSPECTOR_COMMAND(`-32601: '${method}' wasn't found`);
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
