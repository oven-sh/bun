import type { Server, OutgoingMessage } from "node:http";
// NOTE: This cannot be made private since there are public packages that rely on this.
const kServer = Symbol.for("::bunternal::");
const { Duplex } = require("node:stream");
const { kAutoDestroyed } = require("internal/shared");

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

export const enum NodeHTTPHeaderState {
  none,
  assigned,
  sent,
}

export const enum NodeHTTPBodyReadState {
  none,
  pending = 1 << 1,
  done = 1 << 2,
  hasBufferedDataDuringPause = 1 << 3,
}

/** Must be kept in sync with NodeHTTPResponse.Flags */
export const enum NodeHTTPResponseFlags {
  socket_closed = 1 << 0,
  request_has_completed = 1 << 1,
  closed_or_completed = socket_closed | request_has_completed,
}

export const kEmptyObject = Object.freeze(Object.create(null));

/** used for pretending to emit events in the right order */
export const kEmitState = Symbol("emitState");
export const kHeaderState= Symbol("headerState");
export const abortedSymbol = Symbol("aborted");
export const bodyStreamSymbol = Symbol("bodyStream");
export const closedSymbol = Symbol("closed");
export const controllerSymbol = Symbol("controller");
export const runSymbol = Symbol("run");
export const deferredSymbol = Symbol("deferred");
export const eofInProgress = Symbol("eofInProgress");
export const fakeSocketSymbol = Symbol("fakeSocket");
export const firstWriteSymbol = Symbol("firstWrite");
export const headersSymbol = Symbol("headers");
export const isTlsSymbol = Symbol("is_tls");
export const kClearTimeout = Symbol("kClearTimeout");
export const kfakeSocket = Symbol("kfakeSocket");
export const kHandle = Symbol("handle");
export const kRealListen = Symbol("kRealListen");
export const noBodySymbol = Symbol("noBody");
export const optionsSymbol = Symbol("options");
export const reqSymbol = Symbol("req");
export const timeoutTimerSymbol = Symbol("timeoutTimer");
export const tlsSymbol = Symbol("tls");
export const typeSymbol = Symbol("type");
export const webRequestOrResponse = Symbol("FetchAPI");
export const statusCodeSymbol = Symbol("statusCode");
export const kEndCalled = Symbol.for("kEndCalled");
export const kAbortController = Symbol.for("kAbortController");
export const statusMessageSymbol = Symbol("statusMessage");
export const serverSymbol = Symbol.for("::bunternal::");
export const kPendingCallbacks = Symbol("pendingCallbacks");
export const kRequest = Symbol("request");
export const kCloseCallback = Symbol("closeCallback");
export const kPath = Symbol("path");
export const kPort = Symbol("port");
export const kMethod = Symbol("method");
export const kHost = Symbol("host");
export const kProtocol = Symbol("protocol");
export const kAgent = Symbol("agent");
export const kFetchRequest = Symbol("fetchRequest");
export const kTls = Symbol("tls");
export const kUseDefaultPort = Symbol("useDefaultPort");
export const kBodyChunks = Symbol("bodyChunks");
export const kRes = Symbol("res");
export const kUpgradeOrConnect = Symbol("upgradeOrConnect");
export const kParser = Symbol("parser");
export const kMaxHeadersCount = Symbol("maxHeadersCount");
export const kReusedSocket = Symbol("reusedSocket");
export const kTimeoutTimer = Symbol("timeoutTimer");
export const kOptions = Symbol("options");
export const kSocketPath = Symbol("socketPath");
export const kSignal = Symbol("signal");
export const kMaxHeaderSize = Symbol("maxHeaderSize");
export const kJoinDuplicateHeaders = Symbol("joinDuplicateHeaders");

export const {
  getHeader,
  setHeader,
  assignHeaders: assignHeadersFast,
  assignEventCallback,
  setRequestTimeout,
  setServerIdleTimeout,
  Response,
  Request,
  Headers,
  Blob,
  headersTuple,
  drainMicrotasks,
} = $cpp("NodeHTTP.cpp", "createNodeHTTPInternalBinding") as {
  getHeader: (headers: Headers, name: string) => string | undefined;
  setHeader: (headers: Headers, name: string, value: string) => void;
  assignHeaders: (object: any, req: Request, headersTuple: any) => boolean;
  assignEventCallback: (req: Request, callback: (event: number) => void) => void;
  setRequestTimeout: (req: Request, timeout: number) => void;
  setServerIdleTimeout: (server: any, timeout: number) => void;
  Response: (typeof globalThis)["Response"];
  Request: (typeof globalThis)["Request"];
  Headers: (typeof globalThis)["Headers"];
  Blob: (typeof globalThis)["Blob"];
  headersTuple: any;
  drainMicrotasks: () => void;
};

export const kFakeSocket = Symbol("kFakeSocket");
export const kInternalSocketData = Symbol.for("::bunternal::");

type FakeSocket = InstanceType<typeof FakeSocket>;
export const FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]!: [typeof Server, typeof OutgoingMessage, typeof Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address;
  address() {
    // Call server.requestIP() without doing any property getter twice.
    var internalData;
    return (this.#address ??=
      (internalData = this[kInternalSocketData])?.[0]?.[serverSymbol].requestIP(internalData[2]) ?? {});
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(port, host, connectListener) {
    return this;
  }

  _destroy(err, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket
    if (!socketData[1]["req"][kAutoDestroyed]) socketData[1].end();
  }

  _final(callback) {}

  get localAddress() {
    return this.address() ? "127.0.0.1" : undefined;
  }

  get localFamily() {
    return "IPv4";
  }

  get localPort() {
    return 80;
  }

  get pending() {
    return this.connecting;
  }

  _read(size) {}

  get readyState() {
    if (this.connecting) return "opening";
    if (this.readable) {
      return this.writable ? "open" : "readOnly";
    } else {
      return this.writable ? "writeOnly" : "closed";
    }
  }

  ref() {
    return this;
  }

  get remoteAddress() {
    return this.address()?.address;
  }

  set remoteAddress(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().address = val;
  }

  get remotePort() {
    return this.address()?.port;
  }

  set remotePort(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().port = val;
  }

  get remoteFamily() {
    return this.address()?.family;
  }

  set remoteFamily(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().family = val;
  }

  resetAndDestroy() {}

  setKeepAlive(enable = false, initialDelay = 0) {}

  setNoDelay(noDelay = true) {
    return this;
  }

  setTimeout(timeout, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket

    const [server, http_res, req] = socketData;
    http_res?.req?.setTimeout(timeout, callback);
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, encoding, callback) {}
};

export class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
    this.name = "ConnResetException";
  }
}

function emitErrorNt(msg, err, callback) {
  if ($isCallable(callback)) {
    callback(err);
  }
  if ($isCallable(msg.emit) && !msg.destroyed) {
    msg.emit("error", err);
  }
}

export function hasServerResponseFinished(self, chunk, callback) {
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




let isNextIncomingMessageHTTPSState = false;
export function swapIsNextIncomingMessageHTTPS(newValue) {
  const oldValue = isNextIncomingMessageHTTPSState;
  isNextIncomingMessageHTTPSState = newValue;
  return oldValue;
}

export const STATUS_CODES = {
  100: 'Continue',                   // RFC 7231 6.2.1
  101: 'Switching Protocols',        // RFC 7231 6.2.2
  102: 'Processing',                 // RFC 2518 10.1 (obsoleted by RFC 4918)
  103: 'Early Hints',                // RFC 8297 2
  200: 'OK',                         // RFC 7231 6.3.1
  201: 'Created',                    // RFC 7231 6.3.2
  202: 'Accepted',                   // RFC 7231 6.3.3
  203: 'Non-Authoritative Information', // RFC 7231 6.3.4
  204: 'No Content',                 // RFC 7231 6.3.5
  205: 'Reset Content',              // RFC 7231 6.3.6
  206: 'Partial Content',            // RFC 7233 4.1
  207: 'Multi-Status',               // RFC 4918 11.1
  208: 'Already Reported',           // RFC 5842 7.1
  226: 'IM Used',                    // RFC 3229 10.4.1
  300: 'Multiple Choices',           // RFC 7231 6.4.1
  301: 'Moved Permanently',          // RFC 7231 6.4.2
  302: 'Found',                      // RFC 7231 6.4.3
  303: 'See Other',                  // RFC 7231 6.4.4
  304: 'Not Modified',               // RFC 7232 4.1
  305: 'Use Proxy',                  // RFC 7231 6.4.5
  307: 'Temporary Redirect',         // RFC 7231 6.4.7
  308: 'Permanent Redirect',         // RFC 7238 3
  400: 'Bad Request',                // RFC 7231 6.5.1
  401: 'Unauthorized',               // RFC 7235 3.1
  402: 'Payment Required',           // RFC 7231 6.5.2
  403: 'Forbidden',                  // RFC 7231 6.5.3
  404: 'Not Found',                  // RFC 7231 6.5.4
  405: 'Method Not Allowed',         // RFC 7231 6.5.5
  406: 'Not Acceptable',             // RFC 7231 6.5.6
  407: 'Proxy Authentication Required', // RFC 7235 3.2
  408: 'Request Timeout',            // RFC 7231 6.5.7
  409: 'Conflict',                   // RFC 7231 6.5.8
  410: 'Gone',                       // RFC 7231 6.5.9
  411: 'Length Required',            // RFC 7231 6.5.10
  412: 'Precondition Failed',        // RFC 7232 4.2
  413: 'Payload Too Large',          // RFC 7231 6.5.11
  414: 'URI Too Long',               // RFC 7231 6.5.12
  415: 'Unsupported Media Type',     // RFC 7231 6.5.13
  416: 'Range Not Satisfiable',      // RFC 7233 4.4
  417: 'Expectation Failed',         // RFC 7231 6.5.14
  418: 'I\'m a Teapot',              // RFC 7168 2.3.3
  421: 'Misdirected Request',        // RFC 7540 9.1.2
  422: 'Unprocessable Entity',       // RFC 4918 11.2
  423: 'Locked',                     // RFC 4918 11.3
  424: 'Failed Dependency',          // RFC 4918 11.4
  425: 'Too Early',                  // RFC 8470 5.2
  426: 'Upgrade Required',           // RFC 2817 and RFC 7231 6.5.15
  428: 'Precondition Required',      // RFC 6585 3
  429: 'Too Many Requests',          // RFC 6585 4
  431: 'Request Header Fields Too Large', // RFC 6585 5
  451: 'Unavailable For Legal Reasons', // RFC 7725 3
  500: 'Internal Server Error',      // RFC 7231 6.6.1
  501: 'Not Implemented',            // RFC 7231 6.6.2
  502: 'Bad Gateway',                // RFC 7231 6.6.3
  503: 'Service Unavailable',        // RFC 7231 6.6.4
  504: 'Gateway Timeout',            // RFC 7231 6.6.5
  505: 'HTTP Version Not Supported', // RFC 7231 6.6.6
  506: 'Variant Also Negotiates',    // RFC 2295 8.1
  507: 'Insufficient Storage',       // RFC 4918 11.5
  508: 'Loop Detected',              // RFC 5842 7.2
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',               // RFC 2774 7
  511: 'Network Authentication Required', // RFC 6585 6
};

export function validateMsecs(numberlike: any, field: string) {
  if (typeof numberlike !== "number" || numberlike < 0) {
    throw $ERR_INVALID_ARG_TYPE(field, "number", numberlike);
  }

  return numberlike;
}