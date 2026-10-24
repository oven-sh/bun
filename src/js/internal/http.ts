const { isIPv4 } = require("internal/net/isIP");
const { queueTick1, queueTick2 } = require("internal/process/next_tick_queue");

const { setServerCustomOptions, setServerAppFlags, setServerMaxHeadersCount, drainMicrotasks } = $cpp(
  "NodeHTTP.cpp",
  "createNodeHTTPInternalBinding",
) as {
  setServerCustomOptions: (
    server: $Node.NativeHTTPServer,
    requireHostHeader: boolean,
    useStrictMethodValidation: boolean,
    lenientHttpFlags: number,
    maxHeaderSize: number,
    onClientError: (
      ssl: boolean,
      socket: $Node.NodeHTTPServerSocket,
      errorCode: number,
      rawPacket: ArrayBuffer,
    ) => void,
    onConnection: (socketHandle: $Node.NodeHTTPServerSocket) => void,
    httpAllowHalfOpen: boolean,
  ) => void;
  setServerAppFlags: (
    server: $Node.NativeHTTPServer,
    requireHostHeader: boolean,
    useStrictMethodValidation: boolean,
    lenientHttpFlags: number,
    httpAllowHalfOpen: boolean,
  ) => void;
  setServerMaxHeadersCount: (server: $Node.NativeHTTPServer, maxHeadersCount: number) => void;
  drainMicrotasks: () => void;
};

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
const serverSymbol = Symbol.for("::bunternal::");
// One symbol under two names.
const kInternalSocketData: typeof serverSymbol = serverSymbol;
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
const kCorked = Symbol("corked");
const kChunkedBuffer = Symbol("kChunkedBuffer");
const kChunkedLength = Symbol("kChunkedLength");
const kBytesWritten = Symbol("kBytesWritten");
const kLenientValidation = Symbol("kLenientValidation");
const kExchange = Symbol("kExchange");
const requestRoad: {
  endsUnseen?: (request: $Node.IncomingMessage) => boolean;
  endUnseen?: (request: $Node.IncomingMessage) => void;
  beginUnseenDump?: (request: $Node.IncomingMessage) => void;
  staysUnseen?: (request: $Node.IncomingMessage) => boolean;
  continueDump?: (request: $Node.IncomingMessage, state: $Node.ReadableState) => void;
  queueDump?: (request: $Node.IncomingMessage, state: $Node.ReadableState) => void;
  mayDumpInPlace?: (request: $Node.IncomingMessage) => boolean;
  beginDump?: (request: $Node.IncomingMessage) => void;
} = {};
const responseRoad: {
  makeExchange?: (
    response: $Node.ServerResponse,
    connection: $Node.HttpServerSocket | null,
    events: $Node.HttpResponseEvents,
    requestState: $Node.ReadableState | null,
  ) => $Node.HttpExchange;
  storeHeader?: (exchange: $Node.HttpExchange, name: string, value: $Node.HttpHeaderValue) => void;
  spillHeaders?: (exchange: $Node.HttpExchange) => void;
  hasHeaderUnderKey?: (exchange: $Node.HttpExchange, key: string, bit: number) => boolean;
  flatHeadersOf?: (exchange: $Node.HttpExchange) => unknown[];
  headerEntriesOf?: (exchange: $Node.HttpExchange) => unknown[];
  pushRenderedHeader?: (
    flat: unknown[],
    message: $Node.OutgoingMessage,
    key: string,
    name: string,
    value: $Node.HttpHeaderValue,
  ) => void;
  outgoingSetHeader?: $Node.OutgoingMessage["setHeader"];
  sendWhatIsHeld?: (response: $Node.ServerResponse | null | undefined) => void;
} = {};

// node:_http_server registers its pipelined-response machinery here at module
// initialization, letting internal/http1_server_fallback drive the same
// per-connection queue without widening node:_http_server's exports. The
// fallback loads node:http (and with it _http_server) before reading these.
const http1ServerPipeline: {
  queuePipelinedResponse?: (socket: $Node.HttpSocket, res: $Node.ServerResponse, isAncient: boolean) => void;
  advanceResponsePipeline?: (
    server: $Node.HttpSocketServer | null | undefined,
    socket: $Node.HttpSocket | null | undefined,
  ) => void;
  abortQueuedPipelinedResponses?: (socket: $Node.HttpSocket, error?: Error) => void;
  lastPipelinedResponse?: (socket: $Node.HttpSocket) => $Node.PipelinedResponse | undefined;
  maybePauseFallbackReads?: (socket: $Node.HttpSocket) => void;
  resumeFallbackReadsOnDrain?: (socket: $Node.HttpSocket) => void;
  finishDrainedResponse?: (res: $Node.ServerResponse) => void;
  mustCloseConnection?: (res: $Node.ServerResponse) => boolean;
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

function emitErrorNextTickIfErrorListenerNT(
  self: $Node.EventEmitter,
  err: Error | null | undefined,
  cb: $Node.ErrorCallback,
) {
  process.nextTick(emitErrorNextTickIfErrorListener, self, err, cb);
}

function emitErrorNextTickIfErrorListener(
  self: $Node.EventEmitter,
  err: Error | null | undefined,
  cb: $Node.ErrorCallback,
) {
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

function takeRequestTrailers(self: $Node.IncomingMessage, handle: $Node.NodeHTTPResponse) {
  // The lenient value bytes must match what the parser accepted on the wire, or a CTL byte in a trailer value would make the trailers vanish here.
  const server = self.socket?.server;
  const { calculateLenientFlags, HTTPParser } = require("node:_http_common");
  return handle.takeRequestTrailers(
    server != null &&
      calculateLenientFlags(server.httpValidation, server.insecureHTTPParser) !== HTTPParser.kLenientNone,
  );
}

function emitEOFIncomingMessageOuter(self: $Node.IncomingMessage) {
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
    const rawTrailers = takeRequestTrailers(self, self[kHandle]);
    if (rawTrailers !== undefined) {
      ("unlikely");
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
      queueTick2(clearServerParserIncoming, parser, self);
    }
  }
}
function clearServerParserIncoming(parser: $Node.HTTPParser | $Node.HttpServerParserShim, req: $Node.IncomingMessage) {
  if (parser.incoming === req) parser.incoming = null;
}
function emitEOFIncomingMessage(self: $Node.IncomingMessage) {
  self[eofInProgress] = true;
  queueTick1(emitEOFIncomingMessageOuter, self);
}

function onDataIncomingMessage(
  this: $Node.IncomingMessage,
  chunk: Buffer | undefined,
  isLast: boolean,
  aborted: NodeHTTPResponseAbortEvent,
) {
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
      ("unlikely");
      // Like Node's parserOnBody: pause the connection once the buffer fills.
      // Upgrade-with-body routes through its own handle so the socket's flow
      // state stays with the upgrade listener; _read() balances it.
      const finSent = socket?.[kHandle]?.finSent === true;
      if (this.upgrade) this[kHandle]?.pause();
      // Nothing reads this body and a pause would hide the peer's FIN: uWS drops the later reads, so that FIN closes the connection.
      else if (finSent && !this._consuming) socket![kHandle]!.stopParsing();
      else if (socket && (finSent || !socket.writableEnded)) {
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
      else {
        ("unlikely");
        socket.resume();
      }
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

const STATUS_CODES: Record<number, string | undefined> = {
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

function hasServerResponseFinished(
  self: $Node.ServerResponse,
  chunk: $Node.HttpChunk | null | undefined,
  callback: $Node.HttpWriteCallback | undefined,
  fromEnd: boolean,
) {
  const finished = self.finished;

  // Only end() takes "" for no chunk. To Node.js's write_() it is a write: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L943-L957
  if (
    typeof chunk === "string" ? chunk.length !== 0 || !fromEnd : typeof chunk === "object" ? chunk !== null : !!chunk
  ) {
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

function emitErrorNt(msg: $Node.ServerResponse, err: Error, callback: $Node.HttpWriteCallback | undefined) {
  if ($isCallable(callback)) {
    callback(err);
  }
  if ($isCallable(msg.emit) && !msg.destroyed) {
    msg.emit("error", err);
  }
}
const setMaxHTTPHeaderSize: (maxHeaderSize: number) => void = $bindgen(
  "node_http_binding.bind.ts",
  "setMaxHTTPHeaderSize",
);
const getMaxHTTPHeaderSize: () => number = $bindgen("node_http_binding.bind.ts", "getMaxHTTPHeaderSize");
const kOutHeaders = Symbol("kOutHeaders");
const kNeedDrain = Symbol("kNeedDrain");
const kErrored = Symbol("errored");
const kHighWaterMark = Symbol("kHighWaterMark");
const kSocket = Symbol("kSocket");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const kUniqueHeaders = Symbol("kUniqueHeaders");
// Cache slot for the server dispatcher's keep-alive decision (stamped once per request in _http_server.ts); declared in the constructor of IncomingMessage so the stamp never shape-transitions the request.
const kReqShouldKeepAlive = Symbol("kReqShouldKeepAlive");
const kIncomingMessage = Symbol("IncomingMessage");
const kSkipPendingData = Symbol("SkipPendingData");
const kProxyConfig = Symbol("kProxyConfig");
const kWaitForProxyTunnel = Symbol("kWaitForProxyTunnel");
const kPerRequestCheckServerIdentity = Symbol("kPerRequestCheckServerIdentity");

// What the modules of `node:http` share, and the members of their classes whose keys are the symbols above.
declare global {
  namespace $Node {
    /** An object without a prototype that serves as a table. */
    type Dictionary<T> = { [key: string]: T } & { __proto__?: null };
    type HttpHeaderValue = number | string | (number | string)[];
    /** `kOutHeaders`: lowercased name -> the name as it was given, and the value. */
    type OutgoingHttpHeaders = Dictionary<[name: string, value: HttpHeaderValue]>;
    /** The forms in which `writeHead()` and its relatives take headers. */
    type HttpHeadersInit = Record<string, HttpHeaderValue> | string[] | [name: string, value: HttpHeaderValue][];
    type HttpWriteCallback = (error?: Error | null) => void;
    type HttpChunk = string | Buffer | Uint8Array;
    /** What waits for a socket to drain. The native response calls it with the offset it has written up to. */
    type HttpDrainCallback = ((offset: number) => void) | HttpWriteCallback;

    /** `socket.parser` of a connection that the native listener parses. */
    interface HttpServerParserShim {
      incoming: IncomingMessage | null;
      outgoing: null;
      socket: HttpServerSocket | null;
      [callback: number]: (() => void) | null;
      free(): void;
      close(): void;
    }

    /** A stream that carries HTTP messages, with what `node:http` keeps on it: a `net.Socket`, or a `Duplex` that was given to `node:http`. */
    interface HttpSocket extends Duplex {
      _httpMessage?: OutgoingMessage | null;
      parser?: HTTPParser | HttpServerParserShim | null;
      server?: HttpSocketServer | null;
      /** The server stopped reading: the responses that wait for their turn hold too many bytes. */
      _paused?: boolean;
      _hadError?: boolean;
      timeout?: number;
      setTimeout?(msecs: number, callback?: () => void): this | undefined;
      destroySoon?(): void;
      _unrefTimer?(): void;
      [kHandle]?: NodeHTTPServerSocket | null;
      [kOnReadParsed]?: (socket: HttpSocket) => void;
      [kHandoffResponse]?: NodeHTTPResponse;
      [kRequest]?: IncomingMessage;
      [kCloseCallback]?: (this: HttpServerSocket) => void;
      [kResumeUnlessFlowing]?(): void;
    }

    /** The server of a connection, as `node:http` reads it: an `http.Server`, or a `net.Server` (an `Http2SecureServer` that allows HTTP/1, a server whose sockets are handed on) that has some of an `http.Server`'s options or none. */
    interface HttpSocketServer extends EventEmitter {
      timeout?: number;
      maxHeaderSize?: number;
      maxHeadersCount?: number | null;
      maxRequestsPerSocket?: number | null;
      insecureHTTPParser?: boolean;
      httpValidation?: "strict" | "relaxed" | "insecure";
      keepAliveTimeout?: number;
      keepAliveTimeoutBuffer?: number;
      joinDuplicateHeaders?: boolean;
      httpAllowHalfOpen?: boolean;
      shouldUpgradeCallback?: (request: IncomingMessage) => boolean;
      [kIncomingMessage]?: IncomingMessageConstructor;
    }

    interface HttpServerSocket {
      [kHandle]: NodeHTTPServerSocket | null | undefined;
      [kOnReadParsed]: ((socket: HttpSocket) => void) | undefined;
      [kHandoffResponse]: NodeHTTPResponse | undefined;
      [kRequest]?: IncomingMessage;
      [kCloseCallback]?: (this: HttpServerSocket) => void;
      [kClosedWithUnsentData]: boolean | undefined;
      readonly [kInternalSocketData]: NodeHTTPResponse | null | undefined;
      readonly [kHasQueuedReads]: boolean;
      [kResumeUnlessFlowing](): void;
      [kRememberPeer](): void;
    }

    interface IncomingMessage {
      /** The native response of a request of the native listener, until the request is destroyed. */
      [kHandle]?: NodeHTTPResponse;
      [kHeaderSource]: NodeHTTPResponse | null | undefined;
      [abortedSymbol]: boolean;
      [eofInProgress]: boolean;
      [noBodySymbol]: boolean;
      [kReqShouldKeepAlive]: boolean | undefined;
      [kSkipPendingData]?: boolean;
    }

    interface OutgoingMessage {
      [kOutHeaders]: OutgoingHttpHeaders | null;
      [kNeedDrain]: boolean;
      [kErrored]: Error | null | undefined;
      [kHighWaterMark]: number;
      [kSocket]: HttpSocket | null;
      [kRejectNonStandardBodyWrites]: boolean | undefined;
      [kUniqueHeaders]?: Set<string> | null;
      /** Of a `ServerResponse`. */
      [kHandle]?: NodeHTTPResponse | Http1ResponseHandle;
    }

    interface ServerResponse {
      [kHandle]: NodeHTTPResponse | Http1ResponseHandle | undefined;
      [kPendingCallbacks]: HttpWriteCallback[] | undefined;
      [fakeSocketSymbol]: HttpSocket | null | undefined;
    }

    interface HttpServer {
      [serverSymbol]: NativeHTTPServer | undefined;
      [isTlsSymbol]?: boolean;
      [tlsSymbol]: HttpServerTLSOptions | null;
      [optionsSymbol]: HttpServerOptions;
      [kHighWaterMark]: number | undefined;
      [kUniqueHeaders]: Set<string> | null;
      [kIncomingMessage]: IncomingMessageConstructor | undefined;
      [kRealListen](
        tls: HttpServerTLSOptions | null,
        port: number | string | undefined,
        host: string | undefined,
        socketPath: string | undefined,
        reusePort: boolean,
      ): void;
    }

    interface Agent {
      [kProxyConfig]: ProxyConfig | null;
    }
  }
}

// The `date` header, formatted once per second like Node.js does
// (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http.js). Keyed by the second rather than reset by a timer:
// a timer belongs to whoever happened to be running when it was set, and if that was a
// Bun.ModuleGraph disposed within the second, nothing would ever clear the cache again.
let utcCache: string | undefined;
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

function ipToInt(ip: string) {
  const octets = ip.split(".");
  let result = 0;
  for (let i = 0; i < octets.length; i++) result = (result << 8) + Number.parseInt(octets[i]);
  return result >>> 0;
}

// Node prints these raw (nodejs/node@3e9954a88b lib/internal/http.js#L114). An unescaped "/" in a password ends the authority early, so cut at the last "@".
function redactInvalidProxyUrl(proxyUrl: string) {
  proxyUrl = `${proxyUrl}`;
  const userinfoEnd = proxyUrl.lastIndexOf("@");
  if (userinfoEnd === -1) return proxyUrl;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(proxyUrl);
  return (scheme === null ? "" : scheme[0]) + proxyUrl.slice(userinfoEnd + 1);
}

class ProxyConfig {
  href: string;
  protocol: string;
  auth: string | undefined;
  bypassList: string[];
  proxyConnectionOptions: { host: string; port: number };

  constructor(proxyUrl: string, keepAlive: boolean | undefined, noProxyList: string | undefined) {
    let parsedURL: URL;
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
  shouldUseProxy(hostname: string, port: number | string | null | undefined) {
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

function parseProxyUrl(env: Record<string, string | undefined>, protocol: string) {
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

function parseProxyConfigFromEnv(
  env: Record<string, string | undefined>,
  protocol: string,
  keepAlive: boolean | undefined,
) {
  // We only support proxying for HTTP and HTTPS requests.
  if (protocol !== "http:" && protocol !== "https:") return null;
  const proxyUrl = parseProxyUrl(env, protocol);
  if (proxyUrl === null) return null;

  // Only http:// and https:// proxies are supported. Ignore instead of throw, in case other protocols are supposed to be handled by the user land.
  if (!proxyUrl.startsWith("http://") && !proxyUrl.startsWith("https://")) return null;
  return new ProxyConfig(proxyUrl, keepAlive, env.no_proxy || env.NO_PROXY);
}

function checkShouldUseProxy(
  proxyConfig: ProxyConfig | null | undefined,
  reqOptions: { socketPath?: string; host?: string | null; port?: number | string | null },
) {
  if (!proxyConfig) return false;
  if (reqOptions.socketPath) return false; // If socketPath is set, the endpoint is a Unix domain socket, which can't be proxied.
  return proxyConfig.shouldUseProxy(reqOptions.host || "localhost", reqOptions.port);
}

export {
  METHODS,
  STATUS_CODES,
  abortedSymbol,
  checkShouldUseProxy,
  clearServerParserIncoming,
  drainMicrotasks,
  emitEOFIncomingMessage,
  emitEOFIncomingMessageOuter,
  emitErrorNextTickIfErrorListenerNT,
  eofInProgress,
  fakeSocketSymbol,
  getMaxHTTPHeaderSize,
  hasServerResponseFinished,
  headerStateSymbol,
  http1ServerPipeline,
  isTlsSymbol,
  kBytesWritten,
  kChunkedBuffer,
  kChunkedLength,
  kCloseCallback,
  kClosedWithUnsentData,
  kCorked,
  kErrored,
  kExchange,
  kHandle,
  kHandoffResponse,
  kHasQueuedReads,
  kHeaderSource,
  kHighWaterMark,
  kIncomingMessage,
  kInternalSocketData,
  kLenientValidation,
  kNeedDrain,
  kOnReadParsed,
  kOutHeaders,
  kPendingCallbacks,
  kPerRequestCheckServerIdentity,
  kProxyConfig,
  kRealListen,
  kRejectNonStandardBodyWrites,
  kRememberPeer,
  kReqShouldKeepAlive,
  kRequest,
  kResumeUnlessFlowing,
  kSkipPendingData,
  kSocket,
  kUniqueHeaders,
  kWaitForProxyTunnel,
  noBodySymbol,
  onDataIncomingMessage,
  optionsSymbol,
  parseProxyConfigFromEnv,
  parseProxyUrl,
  redactInvalidProxyUrl,
  requestRoad,
  responseRoad,
  serverSymbol,
  setMaxHTTPHeaderSize,
  setServerAppFlags,
  setServerCustomOptions,
  setServerMaxHeadersCount,
  takeRequestTrailers,
  tlsSymbol,
  utcDate,
};
