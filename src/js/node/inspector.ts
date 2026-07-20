// Hardcoded module "node:inspector" and "node:inspector/promises"
// Implemented: the in-process Session (Profiler CPU profiles and precise
// coverage, Runtime console notifications, forwarded Debugger.* configuration),
// and open()/url()/close()/waitForDebugger() backed by a Chrome DevTools
// Protocol WebSocket server with breakpoint pausing.
const { hideFromStack } = require("internal/shared");
const { validateString, validateFunction } = require("internal/validators");
const EventEmitter = require("node:events");
const { pathToFileURL } = require("node:url");
const { isAbsolute } = require("node:path");

// #handleMethod return marker for inspector-protocol errors: the callback
// receives the plain `{ code, message }` object (Node delivers protocol
// errors as plain objects, not Error instances).
const kProtocolError = Symbol("kProtocolError");
// #handleMethod return marker: the method is not handled locally and must be
// dispatched through the in-process CDP backend by post().
const kInProcess = Symbol("kInProcess");

// Node surfaces a backend protocol error to the callback as an Error whose
// message is "Inspector error <code>: <message>" and code ERR_INSPECTOR_COMMAND.
function makeProtocolError(error: { code?: number; message?: string }) {
  return $ERR_INSPECTOR_COMMAND(`${error.code ?? -32000}: ${error.message ?? "Unknown error"}`);
}

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
// In-process CDP: dispatch translated JSC-protocol messages against this
// realm's inspector controller synchronously on the calling thread, and get
// back every message the backend produced (see BunDebugger.cpp).
const dispatchInProcessInspectorMessage = $newCppFunction(
  "BunDebugger.cpp",
  "jsFunction_dispatchInProcessInspectorMessage",
  2,
);
const drainInProcessInspectorMessages = $newCppFunction(
  "BunDebugger.cpp",
  "jsFunction_drainInProcessInspectorMessages",
  0,
);
const disconnectInProcessInspector = $newCppFunction("BunDebugger.cpp", "jsFunction_disconnectInProcessInspector", 0);
const closeNodeInspector = $newCppFunction("BunDebugger.cpp", "jsFunction_closeNodeInspector", 0);

// Captured at module load so the console-hook stack capture keeps working
// (and stays safe) after user code replaces or freezes globalThis.Error.
const ErrorObject = globalThis.Error;
const errorCaptureStackTrace = ErrorObject.captureStackTrace;

let activeInspectorUrl: string | undefined;

// Same check as Node's internal/net.js isLoopback().
function isLoopbackHost(host: string) {
  const hostLower = host.toLowerCase();
  return (
    hostLower === "localhost" ||
    hostLower.startsWith("127.") ||
    hostLower === "[::1]" ||
    hostLower === "[0:0:0:0:0:0:0:1]"
  );
}

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
  // Node warns whenever a non-loopback host is passed, before binding.
  if (typeof host === "string" && host && !isLoopbackHost(host)) {
    process.emitWarning(
      "Binding the inspector to a public IP with an open port is insecure, " +
        "as it allows external hosts to connect to the inspector " +
        "and perform a remote code execution attack. " +
        "Documentation can be found at " +
        "https://nodejs.org/api/cli.html#--inspecthostport",
      "SecurityWarning",
    );
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
    throw $ERR_INSPECTOR_ALREADY_ACTIVATED();
  }

  activeInspectorUrl = resolvedUrl;
  // Node writes the resolved port back so process.debugPort reflects it after
  // open(0) picks an ephemeral port.
  try {
    process.debugPort = Number(new URL(resolvedUrl).port);
  } catch {}
  process.stderr.write(`Debugger listening on ${resolvedUrl}\nFor help, see: https://nodejs.org/en/docs/inspector\n`);

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

// --- In-process CDP backend --------------------------------------------------
// Methods the hand-written Session switch does not cover are translated by the
// same CDP<->JSC adapter the WebSocket server uses (internal/inspector/cdp),
// and dispatched synchronously against this realm's inspector controller on
// the calling thread. All in-process sessions share the one native channel;
// each session owns an adapter and matches replies by command id.
let InspectorCDPAdapter: any;
const inProcessAdapters = new Set<any>();
let drainScheduled = false;
// JSC broadcasts every backend reply to every attached frontend, so backend
// command ids must be unique across all in-process adapters and above the
// range remote WebSocket clients count from (they start at 1).
const kFirstInProcessBackendId = 100_000_000;
const kLastInProcessBackendId = 2_000_000_000;
let nextInProcessBackendId = kFirstInProcessBackendId;
function allocateInProcessBackendId() {
  const id = nextInProcessBackendId++;
  if (nextInProcessBackendId > kLastInProcessBackendId) nextInProcessBackendId = kFirstInProcessBackendId;
  return id;
}

// Fans a backend message out to every session adapter; each ignores ids it
// did not issue. Delivery to user code is deferred by the adapter's
// writeToClient, so nothing here re-enters user JS.
function deliverBackendMessages(messages: string[]) {
  for (const message of messages) {
    for (const adapter of inProcessAdapters) adapter.handleBackendMessage(message);
  }
}

// Delivers whatever the native channel buffered outside a synchronous
// dispatch (Debugger.scriptParsed raised while user code compiles, deferred
// Runtime.awaitPromise replies, ...). Registered natively as the channel's
// wake callback and also scheduled after each dispatch.
function drainInProcessBackend() {
  drainScheduled = false;
  if (inProcessAdapters.size === 0) return;
  const messages = drainInProcessInspectorMessages();
  if (messages.length) deliverBackendMessages(messages);
}

function scheduleBackendDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  queueMicrotask(drainInProcessBackend);
}

// Sessions with Runtime enabled receive Runtime.consoleAPICalled for console
// calls. This monkey-patches globalThis.console (not JSC's ConsoleClient as
// cdp.ts does), so pre-captured refs bypass it and no stackTrace is emitted.
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
      if (Object.is(arg, -0)) return { type: "number", unserializableValue: "-0", description: "-0" };
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

function emitConsoleAPICalled(type: string, args: unknown[], stackTrace?: object) {
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
        const params: any = {
          type,
          args: args.map(toRemoteObject),
          executionContextId: 1,
          timestamp,
        };
        if (stackTrace !== undefined) params.stackTrace = stackTrace;
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

// V8 attaches the JS call stack to Runtime.consoleAPICalled; clients (and
// Node's tests) navigate from the top frame to the console call site. The
// CallSite objects Bun's captureStackTrace produces already carry
// source-mapped (original) positions, unlike raw JSC frames.
function captureConsoleStackTrace(hook: Function) {
  const holder: { stack?: any } = {};
  const previousPrepare = ErrorObject.prepareStackTrace;
  const previousLimit = ErrorObject.stackTraceLimit;
  try {
    ErrorObject.prepareStackTrace = (_error, sites) => sites;
    ErrorObject.stackTraceLimit = 30;
    errorCaptureStackTrace.$call(ErrorObject, holder, hook);
    const sites = holder.stack;
    if (!$isJSArray(sites)) return undefined;
    const callFrames: object[] = [];
    for (const site of sites) {
      let fileName: string | undefined;
      let functionName: string | undefined;
      let line = 0;
      let column = 0;
      try {
        fileName = site.getFileName();
        functionName = site.getFunctionName();
        line = site.getLineNumber() | 0;
        column = site.getColumnNumber() | 0;
      } catch {
        continue;
      }
      if (!fileName) continue;
      let url = fileName;
      if (isAbsolute(fileName)) {
        try {
          url = pathToFileURL(fileName).href;
        } catch {}
      }
      $arrayPush(callFrames, {
        functionName: functionName ?? "",
        scriptId: "",
        url,
        lineNumber: line > 0 ? line - 1 : 0,
        columnNumber: column > 0 ? column - 1 : 0,
      });
    }
    return { callFrames };
  } finally {
    ErrorObject.prepareStackTrace = previousPrepare;
    ErrorObject.stackTraceLimit = previousLimit;
  }
}

// The stack capture writes Error's statics; if user code froze them or
// swapped Error, degrade to no stackTrace — a console call must never throw.
function tryCaptureConsoleStackTrace(hook: Function) {
  try {
    return captureConsoleStackTrace(hook);
  } catch {
    return undefined;
  }
}

function makeConsoleHook(type: string, original: Function): Function {
  const hook = function (this: unknown, ...args: unknown[]) {
    // Skip the stack capture entirely when the emit is guarded out.
    if (!emittingConsoleAPI && runtimeEnabledSessions.size > 0) {
      emitConsoleAPICalled(type, args, tryCaptureConsoleStackTrace(hook));
    }
    return original.$apply(this, args);
  };
  return hook;
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

// --- Network domain -------------------------------------------------------
// Mirrors src/inspector/network_agent.cc from Node: the public inspector.Network
// entry points validate and buffer here, and only the commands below hand data
// back to a frontend.

// Node caps a single resource at 5MB and the whole buffer at 100MB, silently
// dropping a blob that would exceed either.
const kDefaultMaxResourceBufferSize = 5 * 1024 * 1024;
const kDefaultMaxTotalBufferSize = 100 * 1024 * 1024;

class NetworkRequestEntry {
  isStreaming = false;
  isRequestFinished: boolean;
  isResponseFinished = false;
  requestIsUTF8: boolean;
  responseIsUTF8 = false;
  requestDataBlobs: Uint8Array[] = [];
  responseDataBlobs: Uint8Array[] = [];
  bufferSize = 0;
  maxResourceBufferSize: number;

  constructor(hasPostData: boolean, requestIsUTF8: boolean, maxResourceBufferSize: number) {
    // A request with no body is born finished; only hasPostData obliges the
    // caller to send dataSent({ finished: true }).
    this.isRequestFinished = !hasPostData;
    this.requestIsUTF8 = requestIsUTF8;
    // Captured per entry: a later enable() must not retroactively shrink it.
    this.maxResourceBufferSize = maxResourceBufferSize;
  }
}

// Node keeps the buffer on the per-session NetworkAgent, so one session's
// enable()/disable() cannot disturb another's buffered requests.
class NetworkState {
  // Insertion-ordered: the oldest entry is evicted first once the total cap is hit.
  requests = new Map<string, NetworkRequestEntry>();
  maxResourceBufferSize = kDefaultMaxResourceBufferSize;
  maxTotalBufferSize = kDefaultMaxTotalBufferSize;
  totalBufferSize = 0;
}

const networkEnabledSessions = new Map<Session, NetworkState>();

function pushNetworkBlob(state: NetworkState, entry: NetworkRequestEntry, blobs: Uint8Array[], blob: Uint8Array) {
  if (entry.bufferSize + blob.byteLength > entry.maxResourceBufferSize) return;
  // Copy: Node's Binary::fromUint8Array eagerly copies, so a caller that
  // recycles its chunk buffer must not corrupt what we buffered.
  blobs.push(new Uint8Array(blob));
  entry.bufferSize += blob.byteLength;
  state.totalBufferSize += blob.byteLength;
  while (state.totalBufferSize > state.maxTotalBufferSize) {
    let oldest: string | undefined;
    let oldestEntry: NetworkRequestEntry | undefined;
    for (const { 0: key, 1: value } of state.requests) {
      oldest = key;
      oldestEntry = value;
      break;
    }
    if (oldest === undefined) break;
    state.totalBufferSize -= oldestEntry!.bufferSize;
    state.requests.$delete(oldest);
  }
}

function dropNetworkEntry(state: NetworkState, requestId: string, entry: NetworkRequestEntry) {
  state.totalBufferSize -= entry.bufferSize;
  state.requests.$delete(requestId);
}

function concatBlobs(blobs: Uint8Array[]) {
  let total = 0;
  for (const blob of blobs) total += blob.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const blob of blobs) {
    out.set(blob, offset);
    offset += blob.byteLength;
  }
  return out;
}

// Node reports a missing property and a wrong-typed one identically; `label`
// carries the dotted path it uses for nested fields ("request.url").
function requireEventString(params: any, key: string, label: string = key) {
  const value = params[key];
  if (typeof value !== "string") throw new TypeError(`Missing ${label} in event`);
  return value;
}

// ObjectGetDouble: any JS number.
function requireEventNumber(params: any, key: string, label: string = key) {
  const value = params[key];
  if (typeof value !== "number") throw new TypeError(`Missing ${label} in event`);
  return value;
}

// ObjectGetInt: Node requires a real Int32 here, not just a number.
function requireEventInt(params: any, key: string, label: string = key) {
  const value = params[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new TypeError(`Missing ${label} in event`);
  }
  return value;
}

function requireEventObject(params: any, key: string, label: string = key) {
  const value = params[key];
  if (typeof value !== "object" || value === null) throw new TypeError(`Missing ${label} in event`);
  return value;
}

function requireEventUint8Array(params: any, key: string) {
  requireEventObject(params, key);
  const value = params[key];
  if (!(value instanceof Uint8Array)) throw new TypeError("Expected data to be Uint8Array in event");
  return value as Uint8Array;
}

// Header values must be protocol strings; Node rejects anything else outright.
function headersFromObject(source: any, key: string, label: string) {
  const raw = requireEventObject(source, key, label);
  const headers: Record<string, string> = { __proto__: null } as any;
  for (const name of Object.keys(raw)) {
    const value = raw[name];
    if (typeof value !== "string") throw new TypeError("Invalid header value in event");
    headers[name] = value;
  }
  return headers;
}

function requestFromObject(params: any) {
  const request = requireEventObject(params, "request");
  const url = requireEventString(request, "url", "request.url");
  const method = requireEventString(request, "method", "request.method");
  const headers = headersFromObject(request, "headers", "request.headers");
  // Node's ObjectGetBool yields false for any non-boolean, so `hasPostData: 1`
  // must not arm the dataSent({ finished: true }) handshake.
  // Extra properties are dropped: Node emits exactly this shape.
  return { url, method, hasPostData: request.hasPostData === true, headers };
}

function responseFromObject(params: any, key: string, withUrl: boolean) {
  const response = requireEventObject(params, key);
  const status = requireEventInt(response, "status", "response.status");
  const statusText = requireEventString(response, "statusText", "response.statusText");
  const headers = headersFromObject(response, "headers", "response.headers");
  if (!withUrl) return { status, statusText, headers };
  const url = requireEventString(response, "url", "response.url");
  return {
    url,
    status,
    statusText,
    headers,
    mimeType: typeof response.mimeType === "string" ? response.mimeType : "",
    charset: typeof response.charset === "string" ? response.charset : "",
  };
}

// Each session's delivery is isolated: a throwing listener becomes a
// process warning (Node's contract) and never starves other sessions.
function emitToSession(session: Session, method: string, params: object) {
  const message = { method, params };
  try {
    session.emit(method, message);
    session.emit("inspectorNotification", message);
  } catch (error) {
    process.emitWarning(error);
  }
}

// Each enabled session owns its buffer, so the event is applied once per session.
function forEachNetworkSession(fn: (session: Session, state: NetworkState) => void) {
  for (const { 0: session, 1: state } of networkEnabledSessions) fn(session, state);
}

const Network = {
  requestWillBeSent(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const wallTime = requireEventNumber(params, "wallTime");
    const request = requestFromObject(params);
    // The request charset sits at the top level, not inside `request`.
    const requestIsUTF8 = params.charset === "utf-8";
    forEachNetworkSession((session, state) => {
      // A duplicate requestId drops the whole event for that session.
      if (state.requests.$has(requestId)) return;
      state.requests.$set(
        requestId,
        new NetworkRequestEntry(request.hasPostData, requestIsUTF8, state.maxResourceBufferSize),
      );
      emitToSession(session, "Network.requestWillBeSent", {
        requestId,
        request,
        timestamp,
        wallTime,
        initiator: { type: "script" },
      });
    });
  },

  responseReceived(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const type = requireEventString(params, "type");
    const response = responseFromObject(params, "response", true);
    forEachNetworkSession((session, state) => {
      const entry = state.requests.$get(requestId);
      if (entry === undefined) return;
      entry.responseIsUTF8 = response.charset === "utf-8";
      emitToSession(session, "Network.responseReceived", { requestId, timestamp, type, response });
    });
  },

  loadingFinished(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    forEachNetworkSession((session, state) => {
      // Node emits before the lookup, so an unknown requestId still reaches the frontend.
      emitToSession(session, "Network.loadingFinished", { requestId, timestamp });
      const entry = state.requests.$get(requestId);
      if (entry === undefined) return;
      if (entry.isStreaming) dropNetworkEntry(state, requestId, entry);
      else entry.isResponseFinished = true;
    });
  },

  loadingFailed(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const type = requireEventString(params, "type");
    const errorText = requireEventString(params, "errorText");
    forEachNetworkSession((session, state) => {
      emitToSession(session, "Network.loadingFailed", { requestId, timestamp, type, errorText });
      const entry = state.requests.$get(requestId);
      if (entry !== undefined) dropNetworkEntry(state, requestId, entry);
    });
  },

  // dataSent is never emitted; it only feeds Network.getRequestPostData.
  dataSent(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    // `finished` short-circuits before any other field is read.
    const finished = params.finished === true;
    if (!finished) {
      requireEventNumber(params, "timestamp");
      requireEventInt(params, "dataLength");
      requireEventUint8Array(params, "data");
    }
    forEachNetworkSession((_session, state) => {
      const entry = state.requests.$get(requestId);
      if (entry === undefined) return;
      if (finished) {
        entry.isRequestFinished = true;
        return;
      }
      pushNetworkBlob(state, entry, entry.requestDataBlobs, params.data);
    });
  },

  dataReceived(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const dataLength = requireEventInt(params, "dataLength");
    const encodedDataLength = requireEventInt(params, "encodedDataLength");
    const data = requireEventUint8Array(params, "data");
    forEachNetworkSession((session, state) => {
      const entry = state.requests.$get(requestId);
      if (entry === undefined) return;
      // Buffer until a frontend asks to stream, then emit live.
      if (entry.isStreaming) {
        emitToSession(session, "Network.dataReceived", {
          requestId,
          timestamp,
          dataLength,
          encodedDataLength,
          data: Buffer.from(data).toString("base64"),
        });
      } else {
        pushNetworkBlob(state, entry, entry.responseDataBlobs, data);
      }
    });
  },

  webSocketCreated(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const url = requireEventString(params, "url");
    forEachNetworkSession(session => {
      emitToSession(session, "Network.webSocketCreated", { requestId, url, initiator: { type: "script" } });
    });
  },

  webSocketClosed(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    forEachNetworkSession(session => {
      emitToSession(session, "Network.webSocketClosed", { requestId, timestamp });
    });
  },

  webSocketHandshakeResponseReceived(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const response = responseFromObject(params, "response", false);
    forEachNetworkSession(session => {
      emitToSession(session, "Network.webSocketHandshakeResponseReceived", { requestId, timestamp, response });
    });
  },
};

// Node routes every entry point through broadcastToFrontend, which defaults a
// missing params to {} and then validateObject()s it.
function guardEventParams(domain: Record<string, Function>) {
  for (const name of Object.keys(domain)) {
    const original = domain[name];
    domain[name] = function (params = {}) {
      if (typeof params !== "object" || params === null || $isArray(params)) {
        // Node's validateObject renders this type name lowercase.
        throw $ERR_INVALID_ARG_TYPE("params", "object", params);
      }
      return original.$call(this, params);
    };
  }
}
guardEventParams(Network);

// --- DOMStorage domain ------------------------------------------------------
// Mirrors src/inspector/dom_storage_agent.cc: validate then emit. Only the
// event surface exists; there is no storage backend to inspect.
const domStorageEnabledSessions = new Set<Session>();

function emitDOMStorageEvent(method: string, params: object) {
  for (const session of domStorageEnabledSessions) emitToSession(session, method, params);
}

// storageId sub-fields carry their own error wording ("... in storageId").
function storageIdFromObject(params: any) {
  const raw = requireEventObject(params, "storageId");
  const securityOrigin = raw.securityOrigin;
  if (typeof securityOrigin !== "string") throw new TypeError("Missing securityOrigin in storageId");
  const storageKey = raw.storageKey;
  if (typeof storageKey !== "string") throw new TypeError("Missing storageKey in storageId");
  return { securityOrigin, isLocalStorage: raw.isLocalStorage === true, storageKey };
}

const DOMStorage = {
  domStorageItemAdded(params: any) {
    if (domStorageEnabledSessions.size === 0) return;
    const storageId = storageIdFromObject(params);
    const key = requireEventString(params, "key");
    const newValue = requireEventString(params, "newValue");
    emitDOMStorageEvent("DOMStorage.domStorageItemAdded", { storageId, key, newValue });
  },

  domStorageItemRemoved(params: any) {
    if (domStorageEnabledSessions.size === 0) return;
    const storageId = storageIdFromObject(params);
    const key = requireEventString(params, "key");
    emitDOMStorageEvent("DOMStorage.domStorageItemRemoved", { storageId, key });
  },

  domStorageItemUpdated(params: any) {
    if (domStorageEnabledSessions.size === 0) return;
    const storageId = storageIdFromObject(params);
    const key = requireEventString(params, "key");
    const oldValue = requireEventString(params, "oldValue");
    const newValue = requireEventString(params, "newValue");
    emitDOMStorageEvent("DOMStorage.domStorageItemUpdated", { storageId, key, oldValue, newValue });
  },

  domStorageItemsCleared(params: any) {
    if (domStorageEnabledSessions.size === 0) return;
    const storageId = storageIdFromObject(params);
    emitDOMStorageEvent("DOMStorage.domStorageItemsCleared", { storageId });
  },

  // Pseudo-event (not part of CDP): seeds the agent's storage map. There
  // is no backing storage here, but the payload is still validated the way
  // Node does, including hostile Proxy storage maps.
  registerStorage(params: any) {
    if (domStorageEnabledSessions.size === 0) return;
    if (typeof params.isLocalStorage !== "boolean") throw new TypeError("Missing isLocalStorage in event");
    const storageMap = requireEventObject(params, "storageMap");
    let keys: string[];
    try {
      keys = Object.getOwnPropertyNames(storageMap);
    } catch {
      throw new TypeError("Failed to get property names from storageMap");
    }
    for (const key of keys) {
      try {
        String(storageMap[key]);
      } catch {
        throw new TypeError("Failed to get value from storageMap");
      }
    }
  },
};
guardEventParams(DOMStorage);

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
  #adapter: any = undefined;
  // Resolvers for in-flight in-process commands, keyed by client command id.
  #pendingResults: Map<number, (err: any, result?: any) => void> = new Map();
  #nextCommandId = 1;
  #dispatchingClientCommand = false;

  // Lazily route this session's untranslated commands through the CDP<->JSC
  // adapter and the in-process native channel; replies land in
  // #pendingResults keyed by command id, events go to session listeners.
  #inProcessAdapter() {
    if (this.#adapter !== undefined) return this.#adapter;
    InspectorCDPAdapter ??= require("internal/inspector/cdp").InspectorCDPAdapter;
    const adapter = new InspectorCDPAdapter(
      (backendMessage: string) => {
        // The command executes here, on this thread; hand every message it
        // produced (response + events) back through the adapters.
        deliverBackendMessages(dispatchInProcessInspectorMessage(backendMessage, drainInProcessBackend));
        scheduleBackendDrain();
      },
      (clientMessage: string) => this.#deliverClientMessage(clientMessage),
      // No wait-for-debugger or exit-handshake state: an in-process Session
      // never retains the context, matching Node's non-preventShutdown path.
      undefined,
      undefined,
      allocateInProcessBackendId,
    );
    inProcessAdapters.add(adapter);
    this.#adapter = adapter;
    return adapter;
  }

  // Runs Node's Session#onMessage contract for one adapter message: a reply
  // completes its post() callback, an event is emitted (method-specific first).
  // A throw from user code becomes a process warning, never a swallowed error.
  #onClientMessage(parsed: any) {
    const { id, error, method } = parsed;
    try {
      if (id !== undefined) {
        const done = this.#pendingResults.$get(id);
        if (done === undefined) return;
        this.#pendingResults.$delete(id);
        if (error) done({ code: error.code, message: error.message });
        else done(null, parsed.result ?? {});
        return;
      }
      if (typeof method === "string") {
        const message = { method, params: parsed.params ?? {} };
        this.emit(method, message);
        this.emit("inspectorNotification", message);
      }
    } catch (thrown) {
      process.emitWarning(thrown);
    }
  }

  // Client messages produced during a post() dispatch are delivered after
  // the dispatch unwinds, so a throwing callback can neither be misread by
  // the adapter as a command failure nor run before post() returns. Messages
  // produced by the backend on its own (Debugger.paused inside the pause
  // loop, drained events) are delivered immediately: pause listeners must
  // observe the pause before execution continues.
  #deliverClientMessage(clientMessage: string) {
    let parsed;
    try {
      parsed = JSON.parse(clientMessage);
    } catch {
      return;
    }
    if (this.#dispatchingClientCommand) {
      queueMicrotask(() => this.#onClientMessage(parsed));
    } else {
      this.#onClientMessage(parsed);
    }
  }

  // Streams a V8-format heap snapshot to this session as
  // HeapProfiler.addHeapSnapshotChunk events, matching V8's chunked delivery.
  #emitHeapSnapshot() {
    const snapshot = Bun.generateHeapSnapshot("v8");
    const chunkSize = 100 * 1024;
    for (let offset = 0; offset < snapshot.length; offset += chunkSize) {
      emitToSession(this, "HeapProfiler.addHeapSnapshotChunk", { chunk: snapshot.slice(offset, offset + chunkSize) });
    }
  }

  // Dispatches `method` through the in-process CDP backend. `done` is called
  // exactly once with (protocolError, result).
  #postInProcess(method: string, params: object | undefined, done: (err: any, result?: any) => void) {
    const adapter = this.#inProcessAdapter();
    const id = this.#nextCommandId++;
    this.#pendingResults.$set(id, done);
    const message = JSON.stringify(params === undefined ? { id, method } : { id, method, params });
    const wasDispatching = this.#dispatchingClientCommand;
    this.#dispatchingClientCommand = true;
    try {
      adapter.handleClientMessage(message);
    } finally {
      // Restore rather than clear: a post() re-entered from a listener must not
      // flip the outer dispatch back to synchronous delivery.
      this.#dispatchingClientCommand = wasDispatching;
    }
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
    runtimeEnabledSessions.$delete(this);
    networkEnabledSessions.$delete(this);
    domStorageEnabledSessions.$delete(this);
    if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
    if (this.#adapter !== undefined) {
      inProcessAdapters.$delete(this.#adapter);
      this.#adapter = undefined;
      // Node's contract: every callback still waiting on a reply is failed
      // with ERR_INSPECTOR_CLOSED rather than left dangling.
      const pending = this.#pendingResults;
      this.#pendingResults = new Map();
      for (const done of pending.values()) {
        process.nextTick(done, { code: -32000, closed: true });
      }
      if (inProcessAdapters.size === 0) disconnectInProcessInspector();
    }
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
      throw $ERR_INVALID_ARG_TYPE("params", "object", params);
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

    let result = this.#handleMethod(method, params as object | undefined);

    // Methods without local handling execute on the real inspector backend.
    // The in-process backend is bound to the main realm; worker sessions
    // keep Node's method-not-found protocol error instead.
    if (result === kInProcess) {
      if (!Bun.isMainThread) {
        result = $ERR_INSPECTOR_COMMAND(`-32601: '${method}' wasn't found`);
      } else {
        // Node's post() is asynchronous: with a callback the reply arrives
        // through it; without one nothing is returned and a protocol error
        // is neither thrown nor otherwise observable.
        this.#postInProcess(method, params as object | undefined, (error, value) => {
          if (!callback) return;
          if (error === null || error === undefined) callback(null, value);
          else if (error.closed) callback($ERR_INSPECTOR_CLOSED());
          else callback(makeProtocolError(error), undefined);
        });
        return;
      }
    }

    if (callback) {
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
        runtimeEnabledSessions.$add(this);
        installConsoleHooks();
        return {};

      case "Runtime.disable":
        runtimeEnabledSessions.$delete(this);
        if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
        return {};

      case "Network.enable": {
        // Node rebuilds this session's buffer on every enable, discarding prior state.
        const state = new NetworkState();
        const maxTotal = (params as any)?.maxTotalBufferSize;
        const maxResource = (params as any)?.maxResourceBufferSize;
        if (typeof maxTotal === "number") state.maxTotalBufferSize = maxTotal;
        if (typeof maxResource === "number") state.maxResourceBufferSize = maxResource;
        networkEnabledSessions.$set(this, state);
        return {};
      }

      case "Network.disable":
        networkEnabledSessions.$delete(this);
        return {};

      case "DOMStorage.enable":
        domStorageEnabledSessions.$add(this);
        return {};

      case "DOMStorage.disable":
        domStorageEnabledSessions.$delete(this);
        return {};

      case "Network.streamResourceContent": {
        const state = networkEnabledSessions.$get(this);
        const requestId = (params as any)?.requestId;
        const entry = state?.requests.$get(requestId);
        if (state === undefined || entry === undefined) return $ERR_INSPECTOR_COMMAND("-32602: Request not found");
        entry.isStreaming = true;
        const buffered = concatBlobs(entry.responseDataBlobs);
        entry.bufferSize -= buffered.byteLength;
        state.totalBufferSize -= buffered.byteLength;
        entry.responseDataBlobs = [];
        if (entry.isResponseFinished) dropNetworkEntry(state, requestId, entry);
        return { bufferedData: Buffer.from(buffered).toString("base64") };
      }

      case "Network.getResponseBody": {
        const state = networkEnabledSessions.$get(this);
        const requestId = (params as any)?.requestId;
        const entry = state?.requests.$get(requestId);
        if (state === undefined || entry === undefined) return $ERR_INSPECTOR_COMMAND("-32602: Request not found");
        if (entry.isStreaming) return $ERR_INSPECTOR_COMMAND("-32602: Response body of the request is been streamed");
        if (!entry.isResponseFinished) return $ERR_INSPECTOR_COMMAND("-32602: Response data is not finished yet");
        const body = concatBlobs(entry.responseDataBlobs);
        dropNetworkEntry(state, requestId, entry);
        if (entry.responseIsUTF8) return { body: Buffer.from(body).toString("utf8"), base64Encoded: false };
        return { body: Buffer.from(body).toString("base64"), base64Encoded: true };
      }

      case "Network.getRequestPostData": {
        const state = networkEnabledSessions.$get(this);
        const requestId = (params as any)?.requestId;
        const entry = state?.requests.$get(requestId);
        if (state === undefined || entry === undefined) return $ERR_INSPECTOR_COMMAND("-32602: Request not found");
        if (!entry.isRequestFinished) return $ERR_INSPECTOR_COMMAND("-32602: Request data is not finished yet");
        if (!entry.requestIsUTF8) return $ERR_INSPECTOR_COMMAND("-32000: Unable to serialize binary request body");
        return { postData: Buffer.from(concatBlobs(entry.requestDataBlobs)).toString("utf8") };
      }

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
        this.#coverageBaseline.$clear();
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
        const baseline = this.#coverageBaseline;
        for (const script of scripts) {
          for (const block of script.blocks) {
            const key = `${script.scriptId}:${block[0]}:${block[1]}`;
            const raw = block[2];
            block[2] = Math.max(0, raw - (baseline.$get(key) ?? 0));
            baseline.$set(key, raw);
          }
        }
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

      // HeapProfiler snapshotting: V8 streams the snapshot as
      // addHeapSnapshotChunk events and then answers the command. There is no
      // allocation-tracking timeline to keep, so start/stopTrackingHeapObjects
      // reduce to "no-op" and "emit a snapshot" respectively.
      case "HeapProfiler.enable":
      case "HeapProfiler.disable":
      case "HeapProfiler.startTrackingHeapObjects":
      case "HeapProfiler.collectGarbage":
        return {};

      case "HeapProfiler.takeHeapSnapshot":
      case "HeapProfiler.stopTrackingHeapObjects": {
        this.#emitHeapSnapshot();
        return {};
      }

      // When an inspector server is active (inspector.open() / vitest
      // --inspect-brk), Debugger configuration must reach that server's
      // backend so breakpoints pause where the remote debugger controls
      // resumption. The forwarding is fire-and-forget. Without a server these
      // fall through to the in-process backend below.
      case "Debugger.enable":
      case "Debugger.disable":
      case "Debugger.setBreakpointByUrl":
      case "Debugger.removeBreakpoint":
      case "Debugger.setBreakpointsActive":
      case "Debugger.setPauseOnExceptions":
      case "Debugger.setSkipAllPauses":
      case "Debugger.setAsyncCallStackDepth":
      case "Debugger.setBlackboxPatterns": {
        if (activeInspectorUrl === undefined) return kInProcess;
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

      // Everything else (Runtime.evaluate/getProperties/callFunctionOn,
      // Debugger.getScriptSource/getPossibleBreakpoints, HeapProfiler, ...)
      // is translated and executed by the in-process CDP backend.
      default:
        return kInProcess;
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
  Network,
  DOMStorage,
};

hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
