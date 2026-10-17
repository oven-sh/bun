// @ts-check
const { kCapture, kShapeMode } = require("internal/event_emitter_symbols");
const { isIPv4 } = require("internal/net/isIP");

const { setServerCustomOptions, setServerAppFlags, setServerMaxHeadersCount, drainMicrotasks } = $cpp(
  "NodeHTTP.cpp",
  "createNodeHTTPInternalBinding",
) as {
  setServerCustomOptions: (
    server: any,
    requireHostHeader: boolean,
    useStrictMethodValidation: boolean,
    lenientHttpFlags: number,
    maxHeaderSize: number,
    onClientError: (ssl: boolean, socket: any, errorCode: number, rawPacket: ArrayBuffer) => undefined,
    onConnection?: (socketHandle: any) => undefined,
  ) => void;
  setServerAppFlags: (
    server: any,
    requireHostHeader: boolean,
    useStrictMethodValidation: boolean,
    lenientHttpFlags: number,
    httpAllowHalfOpen: boolean,
  ) => void;
  setServerMaxHeadersCount: (server: any, maxHeadersCount: number) => void;
  drainMicrotasks: () => void;
};

const kHeaders = Symbol("kHeaders");
const kHeadersCount = Symbol("kHeadersCount");
const kTrailers = Symbol("kTrailers");
const kTrailersCount = Symbol("kTrailersCount");
const kRawHeaders = Symbol("kRawHeaders");
const kBytesWritten = Symbol("kBytesWritten");
const kCorked = Symbol("corked");
const kChunkedBuffer = Symbol("kChunkedBuffer");
const kChunkedLength = Symbol("kChunkedLength");
const kLenientValidation = Symbol("kLenientValidation");
const kDispatcherDetached = Symbol("kDispatcherDetached");
const kSnapshotStatusCode = Symbol("kSnapshotStatusCode");
const kSnapshotStatusMessage = Symbol("kSnapshotStatusMessage");
const kMustCloseConnection = Symbol("kMustCloseConnection");
const kPendingFinish = Symbol("kPendingFinish");
const kPipelinedQueuedState = Symbol("kPipelinedQueuedState");
const kImplicitHeaderFromEnd = Symbol("kImplicitHeaderFromEnd");
const kBytesBuffered = Symbol("kBytesBuffered");
const kAccountingFlushScheduled = Symbol("kAccountingFlushScheduled");
const kReplayingPipelinedOps = Symbol("kReplayingPipelinedOps");
const kFramingFrozenChunked = Symbol("kFramingFrozenChunked");
const kServerResponseStatistics = Symbol("ServerResponseStatistics");
const abortedSymbol = Symbol("aborted");
const headerStateSymbol = Symbol("headerState");
const eofInProgress = Symbol("eofInProgress");
const fakeSocketSymbol = Symbol("fakeSocket");
const isTlsSymbol = Symbol("is_tls");
const kHandle = Symbol("handle");
const kOnReadParsed = Symbol("kOnReadParsed");
const kRealListen = Symbol("kRealListen");
const noBodySymbol = Symbol("noBody");
const optionsSymbol = Symbol("options");
const tlsSymbol = Symbol("tls");
const kAbortController = Symbol.for("kAbortController");
const kInternalSocketData = Symbol.for("::bunternal::");
const serverSymbol = Symbol.for("::bunternal::");
const kPendingCallbacks = Symbol("pendingCallbacks");
const kRequest = Symbol("request");
// IncomingMessage slot for the request's native response. null if the request was parsed in JS.
const kHeaderSource = Symbol("kHeaderSource");
// Set on a server socket at the 'connect'/'upgrade' handoff: the native response of that request.
const kHandoffResponse = Symbol("kHandoffResponse");
const kResumeUnlessFlowing = Symbol("kResumeUnlessFlowing");
// Method of a server socket. Whoever takes the connection over calls it while the connection is still open.
const kRememberPeer = Symbol("kRememberPeer");
// Getter of a server socket: whether the native side has read bytes or the end of a tunnel's stream that it will push
// into the socket in a task.
const kHasQueuedReads = Symbol("kHasQueuedReads");
// Property of a server socket: whether the connection closed before the kernel had taken everything that was written.
// undefined until it has closed.
const kClosedWithUnsentData = Symbol("kClosedWithUnsentData");
const kCloseCallback = Symbol("closeCallback");

// node:_http_server registers its pipelined-response machinery here at module
// initialization, letting internal/http1_server_fallback drive the same
// per-connection queue without widening node:_http_server's exports. The
// fallback loads node:http (and with it _http_server) before reading these.
const http1ServerPipeline: {
  queuePipelinedResponse?: (socket: unknown, res: unknown, isAncient: boolean) => void;
  advanceResponsePipeline?: (server: unknown, socket: unknown) => void;
  abortQueuedPipelinedResponses?: (socket: unknown) => void;
  lastPipelinedResponse?: (socket: unknown) => { _last: boolean } | undefined;
  maybePauseFallbackReads?: (socket: unknown) => void;
  resumeFallbackReadsOnDrain?: (socket: unknown) => void;
  finishDrainedResponse?: (res: unknown) => void;
  kMustCloseConnection?: symbol;
} = {};

export const enum NodeHTTPResponseAbortEvent {
  none = 0,
  abort = 1,
  timeout = 2,
  readParsed = 3,
}
export const enum NodeHTTPBodyReadState {
  none,
  pending = 1 << 1,
  /** The last chunk arrived, or a WebSocket took the connection. */
  done = 1 << 2,
  /** The connection closed before the last chunk. */
  aborted = 1 << 3,
}

// Must be kept in sync with NodeHTTPResponse.Flags
export const enum NodeHTTPResponseFlags {
  socket_closed = 1 << 0,
  request_has_completed = 1 << 1,
  ended = 1 << 2,
  upgraded = 1 << 3,
  dispatch_threw_while_queued = 1 << 9,

  closed_or_completed = socket_closed | request_has_completed,
}

export const enum NodeHTTPHeaderState {
  none,
  assigned,
  sent,
}

function emitErrorNextTickIfErrorListenerNT(self, err, cb) {
  process.nextTick(emitErrorNextTickIfErrorListener, self, err, cb);
}

function emitErrorNextTickIfErrorListener(self, err, cb) {
  if ($isCallable(cb)) {
    // This is to keep backward compatible behavior.
    // An error is emitted only if there are listeners attached to the event.
    if (self.listenerCount("error") == 0) {
      cb();
    } else {
      cb(err);
    }
  }
}

interface Original {
  holder: object | null;
  start: object | null;
  name: string;
  value: unknown;
  get: unknown;
  set: unknown;
}
function originalOf(holder: object, name: string): Original {
  const found = Object.getOwnPropertyDescriptor(holder, name)!;
  return { holder, start: null, name, value: found.value, get: found.get, set: found.set };
}
function originalAskedOfHolder(holder: object, name: string): Original {
  const original = originalOf(holder, name);
  original.start = holder;
  return original;
}
function originalFoundFrom(start: object, name: string, isAskedOfStart: boolean): Original {
  let holder: any = start;
  while (!Object.prototype.hasOwnProperty.$call(holder, name)) holder = Object.getPrototypeOf(holder);
  const original = originalOf(holder, name);
  if (isAskedOfStart) original.start = start;
  return original;
}
function absentName(name: string): Original {
  return { holder: null, start: null, name, value: undefined, get: undefined, set: undefined };
}
function storesMakeOwnProperties(sample: object): boolean {
  const names = Reflect.ownKeys(sample);
  for (let at: any = Object.getPrototypeOf(sample); at !== null; at = Object.getPrototypeOf(at)) {
    if ($isProxyObject(at)) return false;
    for (let i = 0; i < names.length; i++) {
      const found = Object.getOwnPropertyDescriptor(at, names[i]);
      if (found !== undefined && found.writable !== true) return false;
    }
  }
  return true;
}
function resolvesToOriginals(object: object, originals: Original[]): boolean {
  if (!IS_BUN_AOT) return false;
  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    const name = original.name;
    let at: any = original.start === null ? object : original.start;
    while (at !== original.holder) {
      if (at === null || $isProxyObject(at) || Object.prototype.hasOwnProperty.$call(at, name)) return false;
      at = Object.getPrototypeOf(at);
    }
    if (at === null) continue;
    const found = Object.getOwnPropertyDescriptor(at, name);
    if (
      found === undefined ||
      found.value !== original.value ||
      found.get !== original.get ||
      found.set !== original.set
    )
      return false;
    if (found.get === undefined && found.set === undefined && !$watchProperty(at, name)) return false;
  }
  return true;
}
interface EmitterFields {
  _events: any;
  _eventsCount: any;
  [kShapeMode]: any;
  _maxListeners: any;
  [kCapture]: any;
}
interface IncomingMessageFields extends EmitterFields {
  _readableState: any;
  socket: any;
  complete: any;
  rawTrailers: any;
  upgrade: any;
  url: any;
  method: any;
  client: any;
  [kHandle]: any;
  _consuming: any;
  _dumped: any;
  _closed: any;
  [kHeaders]: any;
  [kHeadersCount]: any;
  [kTrailers]: any;
  [kTrailersCount]: any;
  [abortedSymbol]: any;
  [eofInProgress]: any;
  [kReqShouldKeepAlive]: any;
  [kRawHeaders]: any;
  [kHeaderSource]: any;
  [kAbortController]: any;
  [noBodySymbol]: any;
}
interface ServerResponseFields extends EmitterFields {
  outputData: any;
  outputSize: any;
  writable: any;
  destroyed: any;
  _last: any;
  chunkedEncoding: any;
  shouldKeepAlive: any;
  maxRequestsOnConnectionReached: any;
  _defaultKeepAlive: any;
  useChunkedEncodingByDefault: any;
  sendDate: any;
  _removedConnection: any;
  _removedContLen: any;
  _removedTE: any;
  strictContentLength: any;
  [kBytesWritten]: any;
  _contentLength: any;
  _hasBody: any;
  _trailer: any;
  [kNeedDrain]: any;
  finished: any;
  _headerSent: any;
  [kCorked]: any;
  [kChunkedBuffer]: any;
  [kChunkedLength]: any;
  _closed: any;
  [kSocket]: any;
  _header: any;
  [kOutHeaders]: any;
  _keepAliveTimeout: any;
  _onPendingData: any;
  [kErrored]: any;
  [kHighWaterMark]: any;
  [kRejectNonStandardBodyWrites]: any;
  [kLenientValidation]: any;
  req: any;
  _sent100: any;
  [headerStateSymbol]: any;
  [kPendingCallbacks]: any;
  [kHandle]: any;
  statusCode: any;
  statusMessage: any;
  [fakeSocketSymbol]: any;
  [kCloseCallback]: any;
  [kDispatcherDetached]: any;
  [kSnapshotStatusCode]: any;
  [kSnapshotStatusMessage]: any;
  [kMustCloseConnection]: any;
  [kPendingFinish]: any;
  [kPipelinedQueuedState]: any;
  [kImplicitHeaderFromEnd]: any;
  [kUniqueHeaders]: any;
  _ended: any;
  _maxRequestsPerSocket: any;
  [kBytesBuffered]: any;
  [kAccountingFlushScheduled]: any;
  [kReplayingPipelinedOps]: any;
  [kFramingFrozenChunked]: any;
  [kServerResponseStatistics]: any;
}
const responseOriginals: Original[] = [];
let nextResponseSlot = 0;
let failedResponseChecks = 0;
function checkResponse(res: ServerResponseFields): boolean {
  if (!IS_BUN_AOT) return false;
  if ($isCheckedStructure(res, 2) || failedResponseChecks > 1000) return false;
  if (resolvesToOriginals(res, responseOriginals)) {
    nextResponseSlot ^= 1;
    if (!(nextResponseSlot === 0 ? $setCheckedStructure(res, 0) : $setCheckedStructure(res, 1))) failedResponseChecks++;
    return true;
  }
  failedResponseChecks++;
  $setCheckedStructure(res, 2);
  return false;
}
function isPlainResponse(res: ServerResponseFields): boolean {
  return IS_BUN_AOT && ($isCheckedStructure(res, 0) || $isCheckedStructure(res, 1) || checkResponse(res));
}
function hasOnlyOwnFinishListener(res: ServerResponseFields): boolean {
  return IS_BUN_AOT && $isCheckedStructure(res._events, 3);
}
const requestOriginals: Original[] = [];
let nextRequestSlot = 0;
let failedRequestChecks = 0;
function checkRequest(req: IncomingMessageFields): boolean {
  if (!IS_BUN_AOT) return false;
  if ($isCheckedStructure(req, 10) || failedRequestChecks > 1000) return false;
  if (resolvesToOriginals(req, requestOriginals)) {
    nextRequestSlot ^= 1;
    if (!(nextRequestSlot === 0 ? $setCheckedStructure(req, 8) : $setCheckedStructure(req, 9))) failedRequestChecks++;
    return true;
  }
  failedRequestChecks++;
  $setCheckedStructure(req, 10);
  return false;
}
function isPlainRequest(req: IncomingMessageFields): boolean {
  return IS_BUN_AOT && ($isCheckedStructure(req, 8) || $isCheckedStructure(req, 9) || checkRequest(req));
}
type ReadableState = import("internal/streams/state").ReadableState;
type WritableState = import("internal/streams/state").WritableState;
const kConnection = Symbol("kConnection");
interface Connection {
  request: any;
  keepAliveTimeoutSet: boolean;
  keepAliveIdleStart: number | undefined;
  timer: any;
  pipelinedResponses: any;
  streamingEnabled: boolean;
  boundOnAbort: any;
  stopsParsingOnClose: boolean;
  upgradeIncoming: any;
  readableState: ReadableState;
  writableState: WritableState;
}
function createConnection(readableState: ReadableState, writableState: WritableState): Connection {
  return {
    request: null,
    keepAliveTimeoutSet: false,
    keepAliveIdleStart: undefined,
    timer: undefined,
    pipelinedResponses: undefined,
    streamingEnabled: false,
    boundOnAbort: null,
    stopsParsingOnClose: false,
    upgradeIncoming: undefined,
    readableState,
    writableState,
  };
}
const socketOriginals: Original[] = [];
let nextSocketSlot = 0;
let failedSocketChecks = 0;
function checkSocket(socket: object): boolean {
  if (!IS_BUN_AOT) return false;
  if (socketOriginals.length === 0 || $isCheckedStructure(socket, 18) || failedSocketChecks > 1000) return false;
  if (resolvesToOriginals(socket, socketOriginals)) {
    nextSocketSlot ^= 1;
    if (!(nextSocketSlot === 0 ? $setCheckedStructure(socket, 16) : $setCheckedStructure(socket, 17)))
      failedSocketChecks++;
    return true;
  }
  failedSocketChecks++;
  $setCheckedStructure(socket, 18);
  return false;
}
function isPlainSocket(socket: object): boolean {
  return IS_BUN_AOT && ($isCheckedStructure(socket, 16) || $isCheckedStructure(socket, 17) || checkSocket(socket));
}
const nop = () => {};
function callCloseCallback(self) {
  const callback = self[kCloseCallback];
  if (callback) {
    callback.$call(self);
    self[kCloseCallback] = undefined;
  }
}
function emitCloseNT(self: ServerResponseFields) {
  if (!self._closed) {
    self.destroyed = true;
    self._closed = true;
    callCloseCallback(self);
    self.emit("close");
  }
}

function emitEOFIncomingMessageOuter(self) {
  self.complete = true;
  // node:http server: trailer fields received after a chunked request body
  // populate req.trailers/rawTrailers before 'end' is emitted, like Node's
  // parserOnMessageComplete. Native moved the section onto THIS request's
  // handle at its body fin, so pipelined requests can neither inherit nor
  // overwrite another request's trailers.
  // Trailers can only follow a chunked request body: a no-body request has
  // none, so skip the native call (and the socket/server option walk) for the
  // common GET/HEAD case.
  if (!self[noBodySymbol] && self[kHandle] !== undefined) {
    // The lenient (insecureHTTPParser) value bytes must match what the parser
    // accepted on the wire, or a CTL byte in a trailer value would vanish here.
    const rawTrailers = self[kHandle].takeRequestTrailers(self.socket?.server?.insecureHTTPParser === true);
    if (rawTrailers !== undefined) {
      self._addHeaderLines(rawTrailers, rawTrailers.length);
    }
  }
  // The parser shim must not retain the request once it has ended. Node clears
  // parser.incoming on the tick after 'end' so 'end' listeners still see
  // `parser.incoming === req` (test-http-server-keepalive-end). push(null)
  // schedules 'end' via nextTick (endReadableNT); a second nextTick scheduled
  // here runs after that.
  self.push(null);
  const socket = self.socket;
  if (socket != null) {
    const parser = socket.parser;
    if (parser != null && parser.incoming === self) {
      process.nextTick(clearServerParserIncoming, parser, self);
    }
  }
}
function clearServerParserIncoming(parser, req) {
  if (parser.incoming === req) parser.incoming = null;
}
function emitEOFIncomingMessage(self) {
  self[eofInProgress] = true;
  process.nextTick(emitEOFIncomingMessageOuter, self);
}

function onDataIncomingMessage(this: any, chunk, isLast, aborted: NodeHTTPResponseAbortEvent) {
  if (aborted === NodeHTTPResponseAbortEvent.readParsed) {
    const socket = this.socket;
    const onReadParsed = socket?.[kOnReadParsed];
    if (onReadParsed) {
      socket[kOnReadParsed] = undefined;
      onReadParsed(socket);
    }
    return;
  }
  if (aborted === NodeHTTPResponseAbortEvent.abort) {
    // The request is aborted from the socket's #onClose (like Node.js's
    // socketOnClose → abortIncoming), which the native close path always
    // reaches right after this callback; destroying here would drop the
    // ECONNRESET and emit req 'close' before res 'close'.
    return;
  }

  // Incoming request-body bytes are socket activity: push the connection's
  // inactivity timeout (socket.setTimeout / server.timeout) further out, like
  // Node.js does for reads on the socket.
  const socket = this.socket;
  socket?._unrefTimer?.();

  if (chunk && !this._dumped) {
    if (!this.push(chunk)) {
      // Like Node's parserOnBody: pause the connection once the buffer fills.
      // Upgrade-with-body routes through its own handle so the socket's flow
      // state stays with the upgrade listener; _read() balances it.
      if (this.upgrade) this[kHandle]?.pause();
      else if (socket && !socket.writableEnded) {
        socket.pause();
        // For a pipelined request the socket's current response is an earlier one, and an ended response does not pause.
        this[kHandle]?.pause();
      }
    }
  }

  if (isLast) {
    emitEOFIncomingMessage(this);
    // Like Node's parserOnMessageComplete: any readStop above left the shared
    // socket's flowing=false, which would swallow the next request's 'pause'.
    if (!this.upgrade && socket && !socket._paused && socket.readable) {
      if (socket[kResumeUnlessFlowing] !== undefined) socket[kResumeUnlessFlowing]();
      else socket.resume();
    }
  }
}

const METHODS = [
  "ACL",
  "BIND",
  "CHECKOUT",
  "CONNECT",
  "COPY",
  "DELETE",
  "GET",
  "HEAD",
  "LINK",
  "LOCK",
  "M-SEARCH",
  "MERGE",
  "MKACTIVITY",
  "MKCALENDAR",
  "MKCOL",
  "MOVE",
  "NOTIFY",
  "OPTIONS",
  "PATCH",
  "POST",
  "PROPFIND",
  "PROPPATCH",
  "PURGE",
  "PUT",
  "QUERY",
  "REBIND",
  "REPORT",
  "SEARCH",
  "SOURCE",
  "SUBSCRIBE",
  "TRACE",
  "UNBIND",
  "UNLINK",
  "UNLOCK",
  "UNSUBSCRIBE",
];

const STATUS_CODES = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  509: "Bandwidth Limit Exceeded",
  510: "Not Extended",
  511: "Network Authentication Required",
};

function hasServerResponseFinished(self: ServerResponseFields, chunk, callback, fromEnd) {
  const finished = self.finished;

  // Only end() takes "" for no chunk. To Node.js's write_() it is a write: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L943-L957
  if (chunk || (!fromEnd && chunk === "")) {
    const destroyed = self.destroyed;

    if (finished || destroyed) {
      let err;
      if (finished) {
        err = $ERR_STREAM_WRITE_AFTER_END();
      } else if (destroyed) {
        err = $ERR_STREAM_DESTROYED("write");
      }

      if (!destroyed) {
        process.nextTick(emitErrorNt, self, err, callback);
      } else if (!fromEnd && $isCallable(callback)) {
        // Node.js's end() never gives this error to its callback: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L1086-L1098
        process.nextTick(callback, err);
      }

      return true;
    }
  } else if (finished) {
    if ($isCallable(callback)) {
      if (!self.writableFinished) {
        self.on("finish", callback);
      } else {
        callback($ERR_STREAM_ALREADY_FINISHED("end"));
      }
    }

    return true;
  }

  return false;
}

function emitErrorNt(msg, err, callback) {
  if ($isCallable(callback)) {
    callback(err);
  }
  if ($isCallable(msg.emit) && !msg.destroyed) {
    msg.emit("error", err);
  }
}
const setMaxHTTPHeaderSize = $newRustFunction("node_http_binding.rs", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize = $newRustFunction("node_http_binding.rs", "getMaxHTTPHeaderSize", 0);
const kOutHeaders = Symbol("kOutHeaders");
const kNeedDrain = Symbol("kNeedDrain");
const kErrored = Symbol("errored");
const kHighWaterMark = Symbol("kHighWaterMark");
const kSocket = Symbol("kSocket");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const kUniqueHeaders = Symbol("kUniqueHeaders");
// Cache slot for the server dispatcher's keep-alive decision (stamped once
// per request in _http_server.ts); declared in the constructor of IncomingMessage
// so the stamp never shape-transitions the request.
const kReqShouldKeepAlive = Symbol("kReqShouldKeepAlive");
const kIncomingMessage = Symbol("IncomingMessage");
const kSkipPendingData = Symbol("SkipPendingData");
const kProxyConfig = Symbol("kProxyConfig");
const kWaitForProxyTunnel = Symbol("kWaitForProxyTunnel");
const kPerRequestCheckServerIdentity = Symbol("kPerRequestCheckServerIdentity");

// The `date` header, formatted once per second like Node.js does
// (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http.js). Keyed by the second rather than reset by a timer:
// a timer belongs to whoever happened to be running when it was set, and if that was a
// Bun.ModuleGraph disposed within the second, nothing would ever clear the cache again.
let utcCache;
let utcCacheSecond = -1;
function utcDate() {
  const now = Date.now();
  const second = Math.floor(now / 1000);
  if (second !== utcCacheSecond) {
    utcCacheSecond = second;
    utcCache = new Date(now).toUTCString();
  }
  return utcCache;
}

function ipToInt(ip) {
  const octets = ip.split(".");
  let result = 0;
  for (let i = 0; i < octets.length; i++) result = (result << 8) + Number.parseInt(octets[i]);
  return result >>> 0;
}

// Node prints these raw (nodejs/node@3e9954a88b lib/internal/http.js#L114). An unescaped "/" in a password ends the authority early, so cut at the last "@".
function redactInvalidProxyUrl(proxyUrl) {
  proxyUrl = `${proxyUrl}`;
  const userinfoEnd = proxyUrl.lastIndexOf("@");
  if (userinfoEnd === -1) return proxyUrl;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(proxyUrl);
  return (scheme === null ? "" : scheme[0]) + proxyUrl.slice(userinfoEnd + 1);
}

class ProxyConfig {
  href;
  protocol;
  auth;
  bypassList;
  proxyConnectionOptions;

  constructor(proxyUrl, keepAlive, noProxyList) {
    let parsedURL;
    try {
      parsedURL = new URL(proxyUrl);
    } catch {
      throw $ERR_PROXY_INVALID_CONFIG(`Invalid proxy URL: ${redactInvalidProxyUrl(proxyUrl)}`);
    }
    const { hostname, port, protocol, username, password } = parsedURL;

    // `href` ends up in ERR_PROXY_TUNNEL messages, so it must not carry the credentials.
    if (username || password) {
      parsedURL.username = "";
      parsedURL.password = "";
      this.href = parsedURL.href;
    } else {
      this.href = proxyUrl;
    }
    this.protocol = protocol;

    if (username || password) {
      // If username or password is provided, prepare the proxy-authorization header.
      const auth = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
      this.auth = `Basic ${Buffer.from(auth).toString("base64")}`;
    }
    if (noProxyList) {
      this.bypassList = noProxyList.split(",").map(entry => entry.trim().toLowerCase());
    } else {
      this.bypassList = [];
    }

    this.proxyConnectionOptions = {
      // The host name comes from parsed URL so if it starts with '[' it must be an IPv6 address ending with ']'. Remove the brackets for net.connect().
      host: hostname[0] === "[" ? hostname.slice(1, -1) : hostname,
      // The port comes from parsed URL so it is either '' or a valid number string.
      port: port ? Number(port) : protocol === "https:" ? 443 : 80,
    };
  }

  // See: https://about.gitlab.com/blog/we-need-to-talk-no-proxy
  shouldUseProxy(hostname, port) {
    const bypassList = this.bypassList;
    if (this.bypassList.length === 0) return true; // No bypass list, always use the proxy.
    const host = hostname.toLowerCase();
    const hostWithPort = port ? `${host}:${port}` : host;

    for (let i = 0; i < bypassList.length; i++) {
      const entry = bypassList[i];

      if (entry === "*") return false; // * bypasses all hosts.
      if (entry === host || entry === hostWithPort) return false; // Matching host and host:port

      // Follow curl's behavior: strip leading dot before matching suffixes.
      if (entry.startsWith(".")) {
        const suffix = entry.substring(1);
        if (host === suffix || (host.endsWith(suffix) && host[host.length - suffix.length - 1] === ".")) return false;
      }

      // Handle wildcards like *.example.com
      if (entry.startsWith("*.") && host.endsWith(entry.substring(1))) return false;

      // Handle IP ranges (simple format like 192.168.1.0-192.168.1.255)
      // TODO: support IPv6.
      if (entry.includes("-") && isIPv4(host)) {
        let { 0: startIP, 1: endIP } = entry.split("-");
        startIP = startIP.trim();
        endIP = endIP.trim();
        if (startIP && endIP && isIPv4(startIP) && isIPv4(endIP)) {
          const hostInt = ipToInt(host);
          const startInt = ipToInt(startIP);
          const endInt = ipToInt(endIP);
          if (hostInt >= startInt && hostInt <= endInt) return false;
        }
      }

      // It might be useful to support CIDR notation, but it's not so widely supported
      // in other tools as a de-facto standard to follow, so we don't implement it for now.
    }

    return true;
  }
}

function parseProxyUrl(env, protocol) {
  // Get the proxy url - following the most popular convention, lower case takes precedence.
  // See https://about.gitlab.com/blog/we-need-to-talk-no-proxy/#http_proxy-and-https_proxy
  const proxyUrl = protocol === "https:" ? env.https_proxy || env.HTTPS_PROXY : env.http_proxy || env.HTTP_PROXY;
  // No proxy settings from the environment, ignore.
  if (!proxyUrl) {
    return null;
  }

  if (proxyUrl.includes("\r") || proxyUrl.includes("\n")) {
    throw $ERR_PROXY_INVALID_CONFIG(`Invalid proxy URL: ${redactInvalidProxyUrl(proxyUrl)}`);
  }

  return proxyUrl;
}

function parseProxyConfigFromEnv(env, protocol, keepAlive) {
  // We only support proxying for HTTP and HTTPS requests.
  if (protocol !== "http:" && protocol !== "https:") return null;
  const proxyUrl = parseProxyUrl(env, protocol);
  if (proxyUrl === null) return null;

  // Only http:// and https:// proxies are supported. Ignore instead of throw, in case other protocols are supposed to be handled by the user land.
  if (!proxyUrl.startsWith("http://") && !proxyUrl.startsWith("https://")) return null;
  return new ProxyConfig(proxyUrl, keepAlive, env.no_proxy || env.NO_PROXY);
}

function checkShouldUseProxy(proxyConfig: ProxyConfig, reqOptions: any) {
  if (!proxyConfig) return false;
  if (reqOptions.socketPath) return false; // If socketPath is set, the endpoint is a Unix domain socket, which can't be proxied.
  return proxyConfig.shouldUseProxy(reqOptions.host || "localhost", reqOptions.port);
}

export {
  METHODS,
  STATUS_CODES,
  abortedSymbol,
  absentName,
  callCloseCallback,
  checkShouldUseProxy,
  clearServerParserIncoming,
  createConnection,
  drainMicrotasks,
  emitCloseNT,
  emitEOFIncomingMessage,
  emitEOFIncomingMessageOuter,
  emitErrorNextTickIfErrorListenerNT,
  eofInProgress,
  fakeSocketSymbol,
  getMaxHTTPHeaderSize,
  hasOnlyOwnFinishListener,
  hasServerResponseFinished,
  headerStateSymbol,
  http1ServerPipeline,
  isPlainRequest,
  isPlainResponse,
  isPlainSocket,
  isTlsSymbol,
  kAbortController,
  kAccountingFlushScheduled,
  kBytesBuffered,
  kBytesWritten,
  kChunkedBuffer,
  kChunkedLength,
  kCloseCallback,
  kClosedWithUnsentData,
  kConnection,
  kCorked,
  kDispatcherDetached,
  kErrored,
  kFramingFrozenChunked,
  kHandle,
  kHandoffResponse,
  kHasQueuedReads,
  kHeaderSource,
  kHeaders,
  kHeadersCount,
  kHighWaterMark,
  kImplicitHeaderFromEnd,
  kIncomingMessage,
  kInternalSocketData,
  kLenientValidation,
  kMustCloseConnection,
  kNeedDrain,
  kOnReadParsed,
  kOutHeaders,
  kPendingCallbacks,
  kPendingFinish,
  kPerRequestCheckServerIdentity,
  kPipelinedQueuedState,
  kProxyConfig,
  kRawHeaders,
  kRealListen,
  kRejectNonStandardBodyWrites,
  kRememberPeer,
  kReplayingPipelinedOps,
  kReqShouldKeepAlive,
  kRequest,
  kResumeUnlessFlowing,
  kServerResponseStatistics,
  kSkipPendingData,
  kSnapshotStatusCode,
  kSnapshotStatusMessage,
  kSocket,
  kTrailers,
  kTrailersCount,
  kUniqueHeaders,
  kWaitForProxyTunnel,
  noBodySymbol,
  nop,
  onDataIncomingMessage,
  optionsSymbol,
  originalAskedOfHolder,
  originalFoundFrom,
  originalOf,
  parseProxyConfigFromEnv,
  parseProxyUrl,
  redactInvalidProxyUrl,
  requestOriginals,
  resolvesToOriginals,
  responseOriginals,
  serverSymbol,
  setMaxHTTPHeaderSize,
  setServerAppFlags,
  setServerCustomOptions,
  setServerMaxHeadersCount,
  socketOriginals,
  storesMakeOwnProperties,
  tlsSymbol,
  utcDate,
};
export type { Connection, EmitterFields, IncomingMessageFields, Original, ServerResponseFields };
