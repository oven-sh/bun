const {
  getHeader,
  setHeader,
  Headers,
  assignHeaders: assignHeadersFast,
  setRequestTimeout,
  headersTuple,
  webRequestOrResponseHasBodyValue,
  setServerCustomOptions,
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer,
  drainMicrotasks,
  setServerIdleTimeout,
} = $cpp("NodeHTTP.cpp", "createNodeHTTPInternalBinding") as {
  getHeader: (headers: Headers, name: string) => string | undefined;
  setHeader: (headers: Headers, name: string, value: string) => void;
  Headers: (typeof globalThis)["Headers"];
  assignHeaders: (object: any, req: Request, headersTuple: any) => boolean;
  setRequestTimeout: (req: Request, timeout: number) => boolean;
  headersTuple: any;
  webRequestOrResponseHasBodyValue: (arg: any) => boolean;
  setServerCustomOptions: (
    server: any,
    requireHostHeader: boolean,
    useStrictMethodValidation: boolean,
    maxHeaderSize: number,
    onClientError: (ssl: boolean, socket: any, errorCode: number, rawPacket: ArrayBuffer) => undefined,
  ) => void;
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer: (arg: any) => ArrayBuffer | undefined;
  drainMicrotasks: () => void;
  setServerIdleTimeout: (server: any, timeout: number) => void;
};

const getRawKeys = $newCppFunction("JSFetchHeaders.cpp", "jsFetchHeaders_getRawKeys", 0);

const kDeprecatedReplySymbol = Symbol("deprecatedReply");
const kBodyChunks = Symbol("bodyChunks");
const kPath = Symbol("path");
const kPort = Symbol("port");
const kMethod = Symbol("method");
const kHost = Symbol("host");
const kProtocol = Symbol("protocol");
const kAgent = Symbol("agent");
const kFetchRequest = Symbol("fetchRequest");
const kTls = Symbol("tls");
const kUseDefaultPort = Symbol("useDefaultPort");
const kRes = Symbol("res");
const kUpgradeOrConnect = Symbol("upgradeOrConnect");
const kParser = Symbol("parser");
const kMaxHeadersCount = Symbol("maxHeadersCount");
const kReusedSocket = Symbol("reusedSocket");
const kTimeoutTimer = Symbol("timeoutTimer");
const kOptions = Symbol("options");
const kSocketPath = Symbol("socketPath");
const kSignal = Symbol("signal");
const kMaxHeaderSize = Symbol("maxHeaderSize");
const abortedSymbol = Symbol("aborted");
const kClearTimeout = Symbol("kClearTimeout");

const headerStateSymbol = Symbol("headerState");
// used for pretending to emit events in the right order
const kEmitState = Symbol("emitState");

const bodyStreamSymbol = Symbol("bodyStream");
const controllerSymbol = Symbol("controller");
const runSymbol = Symbol("run");
const deferredSymbol = Symbol("deferred");
const eofInProgress = Symbol("eofInProgress");
const fakeSocketSymbol = Symbol("fakeSocket");
const firstWriteSymbol = Symbol("firstWrite");
const headersSymbol = Symbol("headers");
const isTlsSymbol = Symbol("is_tls");
const kHandle = Symbol("handle");
const kRealListen = Symbol("kRealListen");
const noBodySymbol = Symbol("noBody");
const optionsSymbol = Symbol("options");
const reqSymbol = Symbol("req");
const timeoutTimerSymbol = Symbol("timeoutTimer");
const tlsSymbol = Symbol("tls");
const typeSymbol = Symbol("type");
const webRequestOrResponse = Symbol("FetchAPI");
const statusCodeSymbol = Symbol("statusCode");
const kAbortController = Symbol.for("kAbortController");
const statusMessageSymbol = Symbol("statusMessage");
const kInternalSocketData = Symbol.for("::bunternal::");
const serverSymbol = Symbol.for("::bunternal::");
const kPendingCallbacks = Symbol("pendingCallbacks");
const kRequest = Symbol("request");
const kCloseCallback = Symbol("closeCallback");
const kDeferredTimeouts = Symbol("deferredTimeouts");

const kEmptyObject = Object.freeze(Object.create(null));

export const enum ClientRequestEmitState {
  socket = 1,
  prefinish = 2,
  finish = 3,
  response = 4,
}

export const enum NodeHTTPResponseAbortEvent {
  none = 0,
  abort = 1,
  timeout = 2,
}
export const enum NodeHTTPIncomingRequestType {
  FetchRequest,
  FetchResponse,
  NodeHTTPResponse,
}
export const enum NodeHTTPBodyReadState {
  none,
  pending = 1 << 1,
  done = 1 << 2,
  hasBufferedDataDuringPause = 1 << 3,
}

// Must be kept in sync with NodeHTTPResponse.Flags
export const enum NodeHTTPResponseFlags {
  socket_closed = 1 << 0,
  request_has_completed = 1 << 1,

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

// TODO: make this more robust.
function isAbortError(err) {
  return err?.name === "AbortError";
}

// This lets us skip some URL parsing
let isNextIncomingMessageHTTPS = false;
function getIsNextIncomingMessageHTTPS() {
  return isNextIncomingMessageHTTPS;
}
function setIsNextIncomingMessageHTTPS(value) {
  isNextIncomingMessageHTTPS = value;
}

function callCloseCallback(self) {
  if (self[kCloseCallback]) {
    self[kCloseCallback]();
    self[kCloseCallback] = undefined;
  }
}
function emitCloseNT(self) {
  if (!self._closed) {
    self.destroyed = true;
    self._closed = true;
    callCloseCallback(self);
    self.emit("close");
  }
}
function emitCloseNTAndComplete(self) {
  if (!self._closed) {
    self._closed = true;
    callCloseCallback(self);
    self.emit("close");
  }

  self.complete = true;
}

function emitEOFIncomingMessageOuter(self) {
  self.push(null);
  self.complete = true;
}
function emitEOFIncomingMessage(self) {
  self[eofInProgress] = true;
  process.nextTick(emitEOFIncomingMessageOuter, self);
}

function validateMsecs(numberlike: any, field: string) {
  if (typeof numberlike !== "number" || numberlike < 0) {
    throw $ERR_INVALID_ARG_TYPE(field, "number", numberlike);
  }

  return numberlike;
}

class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
    this.name = "ConnResetException";
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

function hasServerResponseFinished(self, chunk, callback) {
  const finished = self.finished;

  if (chunk) {
    const destroyed = self.destroyed;

    if (finished || destroyed) {
      let err;
      if (finished) {
        err = $ERR_STREAM_WRITE_AFTER_END();
      } else if (destroyed) {
        err = $ERR_STREAM_DESTROYED("Stream is destroyed");
      }

      if (!destroyed) {
        process.nextTick(emitErrorNt, self, err, callback);
      } else if ($isCallable(callback)) {
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
const setMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "getMaxHTTPHeaderSize", 0);
const kOutHeaders = Symbol("kOutHeaders");

export {
  ConnResetException,
  Headers,
  METHODS,
  STATUS_CODES,
  abortedSymbol,
  assignHeadersFast,
  bodyStreamSymbol,
  callCloseCallback,
  controllerSymbol,
  deferredSymbol,
  drainMicrotasks,
  emitCloseNT,
  emitCloseNTAndComplete,
  emitEOFIncomingMessage,
  emitErrorNextTickIfErrorListenerNT,
  eofInProgress,
  fakeSocketSymbol,
  firstWriteSymbol,
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer,
  getHeader,
  getIsNextIncomingMessageHTTPS,
  getMaxHTTPHeaderSize,
  getRawKeys,
  hasServerResponseFinished,
  headerStateSymbol,
  headersSymbol,
  headersTuple,
  isAbortError,
  isTlsSymbol,
  kAbortController,
  kAgent,
  kBodyChunks,
  kClearTimeout,
  kCloseCallback,
  kDeferredTimeouts,
  kDeprecatedReplySymbol,
  kEmitState,
  kEmptyObject,
  kFetchRequest,
  kHandle,
  kHost,
  kInternalSocketData,
  kMaxHeaderSize,
  kMaxHeadersCount,
  kMethod,
  kOptions,
  kOutHeaders,
  kParser,
  kPath,
  kPendingCallbacks,
  kPort,
  kProtocol,
  kRealListen,
  kRequest,
  kRes,
  kReusedSocket,
  kSignal,
  kSocketPath,
  kTimeoutTimer,
  kTls,
  kUpgradeOrConnect,
  kUseDefaultPort,
  noBodySymbol,
  optionsSymbol,
  reqSymbol,
  runSymbol,
  serverSymbol,
  setHeader,
  setIsNextIncomingMessageHTTPS,
  setMaxHTTPHeaderSize,
  setRequestTimeout,
  setServerCustomOptions,
  setServerIdleTimeout,
  statusCodeSymbol,
  statusMessageSymbol,
  timeoutTimerSymbol,
  tlsSymbol,
  typeSymbol,
  validateMsecs,
  webRequestOrResponse,
  webRequestOrResponseHasBodyValue,
};
