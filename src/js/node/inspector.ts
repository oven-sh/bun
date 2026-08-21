// Hardcoded module "node:inspector" and "node:inspector/promises"
// In-process CDP Session + open()/url()/close()/waitForDebugger() over a CDP WebSocket server.
// Spec: https://chromedevtools.github.io/devtools-protocol/  Node: https://github.com/nodejs/node/blob/main/lib/inspector.js
const { hideFromStack } = require("internal/shared");
const { validateString, validateFunction } = require("internal/validators");
const { SafeSet, SafeMap } = require("internal/primordials");
const EventEmitter = require("node:events");
const { Buffer } = require("node:buffer");
const { pathToFileURL } = require("node:url");
const { isAbsolute } = require("node:path");
const DateNow = Date.now;

// #handleMethod marker: protocol error delivered as plain `{code,message}` (Node's onMessage contract).
const kProtocolError = Symbol("kProtocolError");
const kInProcess = Symbol("kInProcess");

// Node wraps backend protocol errors as ERR_INSPECTOR_COMMAND: https://github.com/nodejs/node/blob/main/lib/inspector.js
function makeProtocolError(error: { code?: number; message?: string }) {
  return $ERR_INSPECTOR_COMMAND(`${error.code ?? -32000}: ${error.message ?? "Unknown error"}`);
}

const startCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startCPUProfiler", 0);
const stopCPUProfiler = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopCPUProfiler", 0);
const setCPUSamplingInterval = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_setCPUSamplingInterval", 1);
const isCPUProfilerRunning = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_isCPUProfilerRunning", 0);
const startPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_startPreciseCoverage", 0);
const stopPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_stopPreciseCoverage", 0);
const collectPreciseCoverage = $newCppFunction("JSInspectorProfiler.cpp", "jsFunction_collectPreciseCoverage", 0);

// inspector.open() bindings: start the debugger-thread CDP WebSocket server (internal/debugger.ts, internal/inspector/cdp.ts).
const openNodeInspector = $newCppFunction("BunDebugger.cpp", "jsFunction_openNodeInspector", 2);
const waitForNodeInspectorConnection = $newCppFunction(
  "BunDebugger.cpp",
  "jsFunction_waitForNodeInspectorConnection",
  0,
);
const postNodeInspectorControl = $newCppFunction("BunDebugger.cpp", "jsFunction_postNodeInspectorControl", 1);
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

const ErrorObject = globalThis.Error;
const errorCaptureStackTrace = ErrorObject.captureStackTrace;

let activeInspectorUrl: string | undefined;

function isLoopbackHost(host: string) {
  // Called with the raw open() host, before the URL bracketing below; Node's
  // IsLoopback in inspector_socket.cc checks the unbracketed forms.
  const hostLower = host.toLowerCase();
  return (
    hostLower === "localhost" ||
    hostLower.startsWith("127.") ||
    hostLower === "::1" ||
    hostLower === "0:0:0:0:0:0:0:1" ||
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
    // Node prints a diagnostic and returns (no throw) on bind failure: https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
    const raw = (e as Error)?.message ?? String(e);
    const prefix = "Failed to start inspector: ";
    const detail = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    process.stderr.write(`Starting inspector on ${hostname}:${portNumber} failed: ${detail}\n`);
    return disposable;
  }
  if (resolvedUrl === null) {
    // null = debugger thread already started via CLI --inspect / BUN_INSPECT (JSC protocol, no
    // controlCallback); inspector.close() cannot shut that down, so flag it explicitly.
    throw $ERR_INSPECTOR_ALREADY_ACTIVATED(
      "An inspector was already started via --inspect and cannot be reopened from node:inspector",
    );
  }

  activeInspectorUrl = resolvedUrl;
  // Node writes the resolved port back so process.debugPort reflects open(0)'s ephemeral port.
  try {
    process.debugPort = Number(new URL(resolvedUrl).port);
  } catch {}
  process.stderr.write(
    `Debugger listening on ${resolvedUrl}\nFor help, see: https://nodejs.org/learn/getting-started/debugging\n`,
  );

  if (wait) {
    waitForNodeInspectorConnection();
  }

  return disposable;
}

function close() {
  if (activeInspectorUrl === undefined) {
    return;
  }
  // Blocks until the debugger thread has stopped the server, so the port is refused on return.
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
let InspectorCDPAdapter: any;
const inProcessAdapters: Set<any> = new SafeSet();
let drainScheduled = false;
// JSC broadcasts replies to every frontend, so backend ids must be unique across adapters
// and above the range remote WebSocket clients count from (they start at 1).
const kFirstInProcessBackendId = 100_000_000;
const kLastInProcessBackendId = 2_000_000_000;
let nextInProcessBackendId = kFirstInProcessBackendId;
function allocateInProcessBackendId() {
  const id = nextInProcessBackendId++;
  if (nextInProcessBackendId > kLastInProcessBackendId) nextInProcessBackendId = kFirstInProcessBackendId;
  return id;
}

function deliverBackendMessages(messages: string[]) {
  for (const message of messages) {
    for (const adapter of inProcessAdapters) adapter.handleBackendMessage(message);
  }
}

function drainInProcessBackend() {
  drainScheduled = false;
  if (inProcessAdapters.size === 0) {
    // No one to deliver to, but take the batch anyway so an orphaned channel's
    // C++ buffer cannot grow while a deferred detach waits on a remote frontend.
    drainInProcessInspectorMessages();
    return;
  }
  const messages = drainInProcessInspectorMessages();
  if (messages.length) deliverBackendMessages(messages);
}

function scheduleBackendDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  queueMicrotask(drainInProcessBackend);
}

// Runtime.consoleAPICalled via monkey-patched globalThis.console: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-consoleAPICalled
// SafeSet iteration is tamper-proof, so a hostile Set.prototype[Symbol.iterator] cannot make console.log throw.
const runtimeEnabledSessions: Set<Session> = new SafeSet();
const hookedConsoleMethods: Array<[string, Function, Function]> = [];

const CONSOLE_API_TYPES: Record<string, string> = {
  __proto__: null,
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

// V8 pumps consoleAPICalled asynchronously so listeners can't re-enter; we emit synchronously,
// so guard: console calls from inside a listener run the original method but are not re-emitted.
let emittingConsoleAPI = false;

function emitConsoleAPICalled(type: string, args: unknown[], stackTrace?: object) {
  if (emittingConsoleAPI) return;
  emittingConsoleAPI = true;
  try {
    const timestamp = DateNow();
    for (const session of runtimeEnabledSessions) {
      // A throwing listener or toRemoteObject (user toString) must not break console.log or
      // starve later sessions; Node surfaces listener exceptions as process warnings.
      try {
        // Fresh message per session so listener mutations don't leak across sessions.
        const params: any = {
          type,
          args: args.map(toRemoteObject),
          executionContextId: 1,
          timestamp,
        };
        if (stackTrace !== undefined) params.stackTrace = stackTrace;
        const message = { method: "Runtime.consoleAPICalled", params };
        // Node emits method-specific then "inspectorNotification": https://github.com/nodejs/node/blob/main/lib/inspector.js
        session.emit("Runtime.consoleAPICalled", message);
        session.emit("inspectorNotification", message);
      } catch (e) {
        process.emitWarning(toWarning(e));
      }
    }
  } finally {
    emittingConsoleAPI = false;
  }
}

// V8 attaches a stackTrace to consoleAPICalled: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-StackTrace
function returnCallSites(_error, sites) {
  return sites;
}

function dispatchInProcessBackendMessage(backendMessage: string) {
  // An adapter can disconnect between two backend commands of one client
  // command; its remaining posts must not reach C++, where the dispatch
  // re-arms the channel and would cancel a deferred detach. A live session's
  // adapter is always added to the set before its first post.
  if (inProcessAdapters.size === 0) return;
  deliverBackendMessages(dispatchInProcessInspectorMessage(backendMessage, drainInProcessBackend));
  scheduleBackendDrain();
}

function settleInProcessPost(callback, error, value) {
  if (!callback) return;
  if (error === null || error === undefined) callback(null, value);
  else callback(makeProtocolError(error), undefined);
}

function settleLocalPost(callback, result) {
  if (result instanceof ErrorObject) {
    callback(result, undefined);
  } else if (result !== null && typeof result === "object" && kProtocolError in result) {
    callback(result[kProtocolError], undefined);
  } else {
    callback(null, result);
  }
}

function captureCDPStackTrace(hide: Function) {
  const holder: { stack?: any } = {};
  const previousPrepare = ErrorObject.prepareStackTrace;
  const previousLimit = ErrorObject.stackTraceLimit;
  try {
    ErrorObject.prepareStackTrace = returnCallSites;
    ErrorObject.stackTraceLimit = 30;
    errorCaptureStackTrace.$call(ErrorObject, holder, hide);
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

function tryCaptureCDPStackTrace(hide: Function) {
  try {
    return captureCDPStackTrace(hide);
  } catch {
    return undefined;
  }
}

function makeConsoleHook(type: string, original: Function): Function {
  const hook = function (this: unknown, ...args: unknown[]) {
    if (!emittingConsoleAPI && runtimeEnabledSessions.size > 0) {
      emitConsoleAPICalled(type, args, tryCaptureCDPStackTrace(hook));
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
  for (let i = 0; i < hookedConsoleMethods.length; i++) {
    const entry = hookedConsoleMethods[i];
    // Only restore slots that still hold our hook (user code may have reassigned).
    if (consoleObject[entry[0]] === entry[2]) {
      consoleObject[entry[0]] = entry[1];
    }
  }
  hookedConsoleMethods.length = 0;
}

// --- Network domain -------------------------------------------------------
// Mirrors https://github.com/nodejs/node/blob/main/src/inspector/network_agent.cc

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
    this.isRequestFinished = !hasPostData;
    this.requestIsUTF8 = requestIsUTF8;
    this.maxResourceBufferSize = maxResourceBufferSize;
  }
}

class NetworkState {
  requests: Map<string, NetworkRequestEntry> = new SafeMap();
  maxResourceBufferSize = kDefaultMaxResourceBufferSize;
  maxTotalBufferSize = kDefaultMaxTotalBufferSize;
  totalBufferSize = 0;
}

const networkEnabledSessions: Map<Session, NetworkState> = new SafeMap();

function pushNetworkBlob(state: NetworkState, entry: NetworkRequestEntry, blobs: Uint8Array[], blob: Uint8Array) {
  if (entry.bufferSize + blob.byteLength > entry.maxResourceBufferSize) return;
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
    state.requests.delete(oldest);
  }
}

function dropNetworkEntry(state: NetworkState, requestId: string, entry: NetworkRequestEntry) {
  state.totalBufferSize -= entry.bufferSize;
  state.requests.delete(requestId);
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

function requireEventString(params: any, key: string, label: string = key) {
  const value = params[key];
  if (typeof value !== "string") throw new TypeError(`Missing ${label} in event`);
  return value;
}

function requireEventNumber(params: any, key: string, label: string = key) {
  const value = params[key];
  if (typeof value !== "number") throw new TypeError(`Missing ${label} in event`);
  return value;
}

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

function emitToSession(session: Session, method: string, params: object) {
  const message = { method, params };
  try {
    session.emit(method, message);
    session.emit("inspectorNotification", message);
  } catch (error) {
    process.emitWarning(toWarning(error));
  }
}

function toWarning(e: unknown): Error {
  try {
    return e instanceof ErrorObject ? e : new ErrorObject(String(e));
  } catch {
    return new ErrorObject("inspector listener threw a value that could not be stringified");
  }
}

// Validation runs once per event and the handlers below fan the result out. Like
// emitConsoleAPICalled, each session gets its own params and first-level objects,
// so a listener that mutates its event cannot leak into the next session (or into
// the bookkeeping, which reads ctx); the captured stack is shared, as there.
function forEachNetworkSession<C>(fn: (session: Session, state: NetworkState, ctx: C) => void, ctx: C) {
  for (const { 0: session, 1: state } of networkEnabledSessions) fn(session, state, ctx);
}

function copyHeaders(headers: Record<string, string>) {
  return { __proto__: null, ...headers } as Record<string, string>;
}

function captureNetworkInitiator() {
  const stack = tryCaptureCDPStackTrace(captureNetworkInitiator);
  return stack !== undefined ? { type: "script", stack } : { type: "script" };
}

const Network = {
  requestWillBeSent(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const wallTime = requireEventNumber(params, "wallTime");
    const request = requestFromObject(params);
    const requestIsUTF8 = params.charset === "utf-8";
    const initiator = captureNetworkInitiator();
    forEachNetworkSession(sessionRequestWillBeSent, {
      requestId,
      request,
      requestIsUTF8,
      timestamp,
      wallTime,
      initiator,
    });
  },

  responseReceived(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const type = requireEventString(params, "type");
    const response = responseFromObject(params, "response", true);
    forEachNetworkSession(sessionResponseReceived, { requestId, timestamp, type, response });
  },

  loadingFinished(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    forEachNetworkSession(sessionLoadingFinished, { requestId, timestamp });
  },

  loadingFailed(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const type = requireEventString(params, "type");
    const errorText = requireEventString(params, "errorText");
    forEachNetworkSession(sessionLoadingFailed, { requestId, timestamp, type, errorText });
  },

  dataSent(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const finished = params.finished === true;
    let data: Uint8Array | undefined;
    if (!finished) {
      requireEventNumber(params, "timestamp");
      requireEventInt(params, "dataLength");
      data = requireEventUint8Array(params, "data");
    }
    forEachNetworkSession(sessionDataSent, { requestId, finished, data });
  },

  dataReceived(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const dataLength = requireEventInt(params, "dataLength");
    const encodedDataLength = requireEventInt(params, "encodedDataLength");
    const data = requireEventUint8Array(params, "data");
    forEachNetworkSession(sessionDataReceived, { requestId, timestamp, dataLength, encodedDataLength, data });
  },

  webSocketCreated(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const url = requireEventString(params, "url");
    const initiator = captureNetworkInitiator();
    forEachNetworkSession(sessionWebSocketCreated, { requestId, url, initiator });
  },

  webSocketClosed(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    forEachNetworkSession(sessionWebSocketClosed, { requestId, timestamp });
  },

  webSocketHandshakeResponseReceived(params: any) {
    if (networkEnabledSessions.size === 0) return;
    const requestId = requireEventString(params, "requestId");
    const timestamp = requireEventNumber(params, "timestamp");
    const response = responseFromObject(params, "response", false);
    forEachNetworkSession(sessionWebSocketHandshakeResponseReceived, { requestId, timestamp, response });
  },
};

function sessionRequestWillBeSent(session, state, ctx) {
  const { requestId, request } = ctx;
  if (state.requests.has(requestId)) return;
  state.requests.set(
    requestId,
    new NetworkRequestEntry(request.hasPostData, ctx.requestIsUTF8, state.maxResourceBufferSize),
  );
  emitToSession(session, "Network.requestWillBeSent", {
    requestId,
    request: { ...request, headers: copyHeaders(request.headers) },
    timestamp: ctx.timestamp,
    wallTime: ctx.wallTime,
    initiator: { ...ctx.initiator },
  });
}

function sessionResponseReceived(session, state, ctx) {
  const { requestId, response } = ctx;
  // Emit before the entry lookup like the loadingFinished/loadingFailed
  // siblings: eviction can drop an in-flight entry, and the lifecycle event
  // must still reach the client. Only the buffer bookkeeping needs the entry.
  emitToSession(session, "Network.responseReceived", {
    requestId,
    timestamp: ctx.timestamp,
    type: ctx.type,
    response: { ...response, headers: copyHeaders(response.headers) },
  });
  const entry = state.requests.get(requestId);
  if (entry !== undefined) entry.responseIsUTF8 = response.charset === "utf-8";
}

function sessionLoadingFinished(session, state, ctx) {
  const { requestId } = ctx;
  emitToSession(session, "Network.loadingFinished", { requestId, timestamp: ctx.timestamp });
  const entry = state.requests.get(requestId);
  if (entry === undefined) return;
  if (entry.isStreaming) dropNetworkEntry(state, requestId, entry);
  else entry.isResponseFinished = true;
}

function sessionLoadingFailed(session, state, ctx) {
  const { requestId } = ctx;
  emitToSession(session, "Network.loadingFailed", {
    requestId,
    timestamp: ctx.timestamp,
    type: ctx.type,
    errorText: ctx.errorText,
  });
  const entry = state.requests.get(requestId);
  if (entry !== undefined) dropNetworkEntry(state, requestId, entry);
}

function sessionDataSent(_session, state, ctx) {
  const entry = state.requests.get(ctx.requestId);
  if (entry === undefined) return;
  if (ctx.finished) {
    entry.isRequestFinished = true;
    return;
  }
  pushNetworkBlob(state, entry, entry.requestDataBlobs, ctx.data);
}

function sessionDataReceived(session, state, ctx) {
  const { requestId, data } = ctx;
  const entry = state.requests.get(requestId);
  if (entry === undefined) return;
  if (entry.isStreaming) {
    emitToSession(session, "Network.dataReceived", {
      requestId,
      timestamp: ctx.timestamp,
      dataLength: ctx.dataLength,
      encodedDataLength: ctx.encodedDataLength,
      data: Buffer.from(data).toString("base64"),
    });
  } else {
    pushNetworkBlob(state, entry, entry.responseDataBlobs, data);
  }
}

function sessionWebSocketCreated(session, _state, ctx) {
  emitToSession(session, "Network.webSocketCreated", {
    requestId: ctx.requestId,
    url: ctx.url,
    initiator: { ...ctx.initiator },
  });
}

function sessionWebSocketClosed(session, _state, ctx) {
  emitToSession(session, "Network.webSocketClosed", { requestId: ctx.requestId, timestamp: ctx.timestamp });
}

function sessionWebSocketHandshakeResponseReceived(session, _state, ctx) {
  const { response } = ctx;
  emitToSession(session, "Network.webSocketHandshakeResponseReceived", {
    requestId: ctx.requestId,
    timestamp: ctx.timestamp,
    response: { ...response, headers: copyHeaders(response.headers) },
  });
}

// Node's broadcastToFrontend defaults params to {} then validateObject()s: https://github.com/nodejs/node/blob/main/lib/inspector.js
function guardEventParams(domain: Record<string, Function>) {
  for (const name of Object.keys(domain)) {
    const original = domain[name];
    domain[name] = function (params = {}) {
      if (typeof params !== "object" || params === null || $isArray(params)) {
        throw $ERR_INVALID_ARG_TYPE("params", "object", params);
      }
      return original.$call(this, params);
    };
  }
}
guardEventParams(Network);

// --- DOMStorage domain ------------------------------------------------------
// Mirrors https://github.com/nodejs/node/blob/main/src/inspector/dom_storage_agent.cc (event surface only).
const domStorageEnabledSessions: Set<Session> = new SafeSet();

// Same per-session copy discipline as the Network handlers; storageId is the only nested object.
function emitDOMStorageEvent(method: string, params: { storageId: object }) {
  for (const session of domStorageEnabledSessions) {
    emitToSession(session, method, { ...params, storageId: { ...params.storageId } });
  }
}

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

// Reshapes JSC control-flow-profiler data into V8 ScriptCoverage[]:
// https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-ScriptCoverage
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
    // V8 reports file-backed scripts with file:// URLs even for plain paths: https://source.chromium.org/chromium/chromium/src/+/main:v8/src/inspector/
    if (url && isAbsolute(url)) {
      url = pathToFileURL(url).href;
    }

    // Outer functions before nested ones so the stack sweep sees enclosing ranges first.
    // Zero-width entries are dropped: V8 never emits startOffset === endOffset, and
    // @bcoe/v8-coverage recurses forever on one.
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
      // Functions that ended before this block's start cannot contain it or any later block.
      while (stack.length > 0 && functions[stack[stack.length - 1]][1] < block[0]) {
        stack.pop();
      }
      // Stack is a nesting chain (ends decrease toward top); first from top covering block's end is innermost owner.
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

    // From delta-subtracted block counts only: the function `executed` flag is cumulative
    // and would make a second takePreciseCoverage report 1 with no new execution.
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
      // Call count ≈ entry-block count. Diverges from V8 for generators/async: JSC compiles them
      // as two nested CodeBlocks whose body entry counts state-0 resumes, not user-visible calls.
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

// Mirrors Node's Session (https://github.com/nodejs/node/blob/main/lib/inspector.js),
// with dispatch translated onto JSC's protocol via the in-process CDP adapter.
class Session extends EventEmitter {
  #connected = false;
  #profilerEnabled = false;
  #preciseCoverageEnabled = false;
  #preciseCoverageCallCount = false;
  #preciseCoverageDetailed = false;
  #forwardedDebugger = false;
  // takePreciseCoverage resets counters per CDP; JSC has no reset API, so subtract the previous take.
  #coverageBaseline: Map<string, number> = new Map();
  #adapter: any = undefined;
  #pendingResults: Map<number, (err: any, result?: any) => void> = new SafeMap();
  #nextCommandId = 1;
  #dispatchingClientCommand = false;

  #inProcessAdapter() {
    if (this.#adapter !== undefined) return this.#adapter;
    InspectorCDPAdapter ??= require("internal/inspector/cdp").InspectorCDPAdapter;
    const adapter = new InspectorCDPAdapter(
      dispatchInProcessBackendMessage,
      this.#deliverClientMessage.bind(this),
      allocateInProcessBackendId,
    );
    inProcessAdapters.add(adapter);
    this.#adapter = adapter;
    return adapter;
  }

  // Node's Session#onMessage contract: reply -> post() callback; event -> emit (method first).
  // User-code throws become process warnings: https://github.com/nodejs/node/blob/main/lib/inspector.js
  #onClientMessage(parsed: any) {
    const { id, error, method } = parsed;
    try {
      if (id !== undefined) {
        const done = this.#pendingResults.get(id);
        if (done === undefined) return;
        this.#pendingResults.delete(id);
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
      process.emitWarning(toWarning(thrown));
    }
  }

  #deliverClientMessage(clientMessage: string) {
    let parsed;
    try {
      parsed = JSON.parse(clientMessage);
    } catch {
      return;
    }
    if (this.#dispatchingClientCommand && parsed?.id !== undefined) {
      queueMicrotask(this.#onClientMessage.bind(this, parsed));
    } else {
      this.#onClientMessage(parsed);
    }
  }

  // HeapProfiler.addHeapSnapshotChunk chunked delivery: https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#event-addHeapSnapshotChunk
  #emitHeapSnapshot() {
    const snapshot = Bun.generateHeapSnapshot("v8");
    const chunkSize = 100 * 1024;
    for (let offset = 0; offset < snapshot.length; offset += chunkSize) {
      emitToSession(this, "HeapProfiler.addHeapSnapshotChunk", { chunk: snapshot.slice(offset, offset + chunkSize) });
    }
  }

  #postInProcess(method: string, params: object | undefined, done: (err: any, result?: any) => void) {
    const adapter = this.#inProcessAdapter();
    const id = this.#nextCommandId++;
    this.#pendingResults.set(id, done);
    const message = JSON.stringify(params === undefined ? { id, method } : { id, method, params });
    const wasDispatching = this.#dispatchingClientCommand;
    this.#dispatchingClientCommand = true;
    try {
      adapter.handleClientMessage(message);
    } finally {
      this.#dispatchingClientCommand = wasDispatching;
    }
  }

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
    if (!(scripts instanceof ErrorObject)) this.#rebaseCoverage(scripts);
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
    networkEnabledSessions.delete(this);
    domStorageEnabledSessions.delete(this);
    if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
    if (this.#adapter !== undefined) {
      inProcessAdapters.delete(this.#adapter);
      this.#adapter = undefined;
      const pending = this.#pendingResults;
      this.#pendingResults = new SafeMap();
      for (const done of pending.values()) {
        process.nextTick(done, { code: -32000, message: "Execution context was destroyed." });
      }
      if (inProcessAdapters.size === 0) disconnectInProcessInspector();
    }
    // Forwarded Debugger.* state lives on the debugger-thread backend; release it so a
    // disconnected session cannot keep pausing the process (Node's disconnect() contract).
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
    if (callback === undefined && typeof params === "function") {
      callback = params;
      params = undefined;
    }
    if (params !== undefined && params !== null && typeof params !== "object") {
      throw $ERR_INVALID_ARG_TYPE("params", "object", params);
    }
    if (callback !== undefined) validateFunction(callback, "callback");

    if (!this.#connected) {
      // Node throws synchronously regardless of callback: https://github.com/nodejs/node/blob/main/lib/inspector.js
      throw $ERR_INSPECTOR_NOT_CONNECTED();
    }

    let result = this.#handleMethod(method, params as object | undefined);

    if (result === kInProcess) {
      if (!Bun.isMainThread) {
        result = $ERR_INSPECTOR_COMMAND(`-32601: '${method}' wasn't found`);
      } else {
        this.#postInProcess(method, params as object | undefined, settleInProcessPost.bind(undefined, callback));
        return;
      }
    }

    if (callback) {
      queueMicrotask(settleLocalPost.bind(undefined, callback, result));
    }
  }

  #handleMethod(method: string, params?: object): any {
    switch (method) {
      case "Runtime.enable":
        runtimeEnabledSessions.add(this);
        installConsoleHooks();
        // CDP requires executionContextCreated after enable: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-executionContextCreated
        queueMicrotask(() =>
          emitToSession(this, "Runtime.executionContextCreated", {
            context: { id: 1, origin: "", name: "Bun", uniqueId: "1", auxData: { isDefault: true } },
          }),
        );
        return {};

      case "Runtime.disable":
        runtimeEnabledSessions.delete(this);
        if (runtimeEnabledSessions.size === 0) removeConsoleHooks();
        return {};

      case "Network.enable": {
        const state = new NetworkState();
        const maxTotal = (params as any)?.maxTotalBufferSize;
        const maxResource = (params as any)?.maxResourceBufferSize;
        if (typeof maxTotal === "number" && Number.isFinite(maxTotal)) {
          const v = maxTotal | 0;
          if (v >= 0) state.maxTotalBufferSize = v;
        }
        if (typeof maxResource === "number" && Number.isFinite(maxResource)) {
          const v = maxResource | 0;
          if (v >= 0) state.maxResourceBufferSize = v;
        }
        networkEnabledSessions.set(this, state);
        return {};
      }

      case "Network.disable":
        networkEnabledSessions.delete(this);
        return {};

      case "DOMStorage.enable":
        domStorageEnabledSessions.add(this);
        return {};

      case "DOMStorage.disable":
        domStorageEnabledSessions.delete(this);
        return {};

      case "Network.streamResourceContent": {
        const state = networkEnabledSessions.get(this);
        const requestId = (params as any)?.requestId;
        const entry = state?.requests.get(requestId);
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
        const state = networkEnabledSessions.get(this);
        const requestId = (params as any)?.requestId;
        const entry = state?.requests.get(requestId);
        if (state === undefined || entry === undefined) return $ERR_INSPECTOR_COMMAND("-32602: Request not found");
        if (entry.isStreaming) return $ERR_INSPECTOR_COMMAND("-32602: Response body of the request is been streamed");
        if (!entry.isResponseFinished) return $ERR_INSPECTOR_COMMAND("-32602: Response data is not finished yet");
        const body = concatBlobs(entry.responseDataBlobs);
        dropNetworkEntry(state, requestId, entry);
        if (entry.responseIsUTF8) return { body: Buffer.from(body).toString("utf8"), base64Encoded: false };
        return { body: Buffer.from(body).toString("base64"), base64Encoded: true };
      }

      case "Network.getRequestPostData": {
        const state = networkEnabledSessions.get(this);
        const requestId = (params as any)?.requestId;
        const entry = state?.requests.get(requestId);
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
        // V8's Profiler agent stops precise coverage on disable: https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#method-disable
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
        if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0)
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
        if (scripts instanceof ErrorObject) return scripts;
        // takePreciseCoverage resets counters per https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#method-takePreciseCoverage
        // JSC has no reset, so subtract the previous take's raw block counts.
        this.#rebaseCoverage(scripts);
        return {
          result: buildScriptCoverageList(scripts, this.#preciseCoverageCallCount, this.#preciseCoverageDetailed),
          timestamp: performance.now() / 1000,
        };
      }

      case "Profiler.getBestEffortCoverage": {
        // JSC has no always-on invocation counters, so unlike V8 this returns [] unless startPreciseCoverage ran.
        const scripts = collectCoverageScripts();
        if (scripts instanceof ErrorObject) return scripts;
        return { result: buildScriptCoverageList(scripts, false, false) };
      }

      // HeapProfiler: https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/
      case "HeapProfiler.enable":
      case "HeapProfiler.disable":
      case "HeapProfiler.startTrackingHeapObjects":
        return {};

      case "HeapProfiler.takeHeapSnapshot":
      case "HeapProfiler.stopTrackingHeapObjects": {
        this.#emitHeapSnapshot();
        return {};
      }

      // With an active server (inspector.open() / --inspect-brk), forward Debugger config to its backend
      // so breakpoints pause where the remote debugger controls resumption. Fire-and-forget; else kInProcess.
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
        // Forwarding alone delivers no events (the in-process channel only connects on a
        // kInProcess post, e.g. Runtime.evaluate). Once it has, JSC broadcasts the pauses
        // here too, and the adapter gates them on this flag, so record the enable for that case.
        if (method === "Debugger.enable" || method === "Debugger.disable") {
          this.#inProcessAdapter().noteDebuggerEnabled(method === "Debugger.enable");
        }
        return {};
      }

      case "NodeWorker.enable": {
        // Minimal stub for test-worker-name: worker session reports itself. Main-thread child enumeration
        // is NOT implemented — error via callback so callers aren't left waiting on attachedToWorker.
        const wt = require("node:worker_threads");
        if (wt.isMainThread) {
          return $ERR_INSPECTOR_COMMAND("-32000: NodeWorker.enable is not supported on the main thread yet");
        }
        const title = `[worker ${wt.threadId}] ${wt.threadName}`;
        // AttachedToWorkerEvent shape: https://github.com/nodejs/node/blob/main/src/inspector/node_protocol.pdl
        const workerInfo = { workerId: String(wt.threadId), type: "worker", title, url: "" };
        queueMicrotask(() =>
          emitToSession(this, "NodeWorker.attachedToWorker", {
            sessionId: `worker:${wt.threadId}`,
            workerInfo,
            waitingForDebugger: false,
          }),
        );
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
        // Node streams dataCollected (events, then metadata) then tracingComplete: https://github.com/nodejs/node/tree/main/src/inspector
        emitToSession(this, "NodeTracing.dataCollected", { value: collected });
        emitToSession(this, "NodeTracing.dataCollected", { value: metadata });
        emitToSession(this, "NodeTracing.tracingComplete", {});
        return {};
      }

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
