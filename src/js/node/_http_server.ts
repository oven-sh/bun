// Hardcoded module "node:_http_server"
const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");
const { Stream, Duplex } = require("node:stream");
const { isIP } = require("internal/net/isIP");
const {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression,
  continueExpression,
  validateHeaderName,
  validateHeaderValue,
  HTTPParser,
  calculateLenientFlags,
  parsers,
  freeParser,
  prepareError,
  kIncomingMessage,
} = require("node:_http_common");
const { ConnectionsList } = process.binding("http_parser") as any;
const AsyncContextFrame = require("internal/async_context_frame");
const {
  validateObject,
  validateLinkHeaderValue,
  validateBoolean,
  validateInteger,
  validateNumber,
  validateFunction,
  validateOneOf,
  validatePort,
} = require("internal/validators");
const {
  ConnResetException,
  ErrnoException,
  ExceptionWithHostPort,
  listenException,
  hasObserver,
  startPerf,
  stopPerf,
  kClusterOwner,
  kInternalSendOptions,
  isStoppedModuleGraphRunning,
} = require("internal/shared");
const kServerResponseStatistics = Symbol("ServerResponseStatistics");

const { isPrimary } = require("internal/cluster/isPrimary");
const { addServerAbortSignalOption } = require("internal/net/server_abort_signal");
const { kForeignListener, kHandleClosed, kSNIContexts } = require("internal/net/symbols");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const {
  kInternalSocketData,
  serverSymbol,
  kHandle,
  kLeaveHttp,
  kRealListen,
  kUpgradeStream,
  tlsSymbol,
  kPendingCallbacks,
  kCloseCallback,
  NodeHTTPResponseFlags,
  callCloseCallback,
  emitCloseNT,
  NodeHTTPResponseAbortEvent,
  STATUS_CODES,
  isTlsSymbol,
  drainMicrotasks,
  getMaxHTTPHeaderSize,
  fakeSocketSymbol,
  kOutHeaders,
  kNeedDrain,
  kFailHeldWrites,
  kFinishesWithoutLastWrite,
  onDataIncomingMessage,
  RE_CONN_CLOSE,
} = require("internal/http");
const { FakeSocket } = require("internal/http/FakeSocket");
const NumberIsNaN = Number.isNaN;

const { IncomingMessage, kReqShouldKeepAlive, readStart } = require("node:_http_incoming");
const {
  OutgoingMessage,
  kErrored,
  kHighWaterMark,
  kSocket,
  kRejectNonStandardBodyWrites,
  kUniqueHeaders,
  parseUniqueHeadersOption,
} = require("node:_http_outgoing");
const OutgoingMessagePrototype = OutgoingMessage.prototype;
const outgoingSocketSetter = Object.getOwnPropertyDescriptor(OutgoingMessagePrototype, "socket")!.set!;
const kConnections = Symbol("http.server.connections");
const kConnectionsCheckingInterval = Symbol("http.server.connectionsCheckingInterval");
const kTrackedConnections = Symbol("http.server.trackedConnections");
const kPendingDrainClose = Symbol("http.server.pendingDrainClose");
const kPendingCloseGenerations = Symbol("http.server.pendingCloseGenerations");
const kListenerGeneration = Symbol("http.server.listenerGeneration");
const kClusterHandle = Symbol("http.server.clusterHandle");
// listen() and close() bump it, so a reply from the cluster primary to an earlier listen() is dropped.
const kClusterListeningId = Symbol("http.server.clusterListeningId");
// Under `bun --hot`, maps a reused native server to the http.Server it dispatches to, or to null once another http.Server stopped it.
let nativeServerOwners: WeakMap<WeakKey, Server | null> | undefined;
// Set on the 'connect'/'upgrade' handoff; closeAll/closeIdleConnections() skip these, as in Node.
const kHandedOff = Symbol("http.server.socketHandedOff");
// True on a TLS connection from accept until 'secureConnection', when Node's connectionListener takes it.
function closeHandle(handle) {
  if (!handle.closed) handle.close();
}
const kHttpAllowHalfOpen = Symbol("http.server.httpAllowHalfOpen");
const kMaxHeadersCount = Symbol("http.server.maxHeadersCount");

// node.http trace events ('http.server.request' b/e). The agent module is
// created when a server listens, and emission is gated per-request on the
// category, so this is near-zero cost when tracing is off.
const kHttpTraceCat = "node,node.http";
let traceEvents: typeof import("internal/trace_events").default;
// What Node's ServerResponse constructor starts. Node makes no response for an 'upgrade' or a 'connect'.
function observeRequest(req, res) {
  if (hasObserver("http")) {
    startPerf(res, kServerResponseStatistics, {
      type: "http",
      name: "HttpRequest",
      detail: { req: { method: req.method, url: req.url, headers: req.headers } },
    });
    res.once("finish", stopServerResponsePerf);
  }
  traceEvents ??= require("internal/trace_events");
  if (!traceEvents.isCategoryGroupEnabled(kHttpTraceCat)) return;
  traceEvents.emitEvent("b", kHttpTraceCat, "http.server.request");
  res.once("finish", traceServerRequestEnd);
}
function traceServerRequestEnd() {
  traceEvents.emitEvent("e", kHttpTraceCat, "http.server.request");
}

const addServerName = $bindgen("Listener.bind.ts", "addServerName");
const setServerAppFlags = $bindgen("node_http_binding.bind.ts", "setServerAppFlags");
const setServerCustomOptions = $bindgen("node_http_binding.bind.ts", "setServerCustomOptions");
const setServerMaxHeadersCount = $bindgen("node_http_binding.bind.ts", "setServerMaxHeadersCount");
const setBunServerSocketHandlers = $bindgen("node_http_binding.bind.ts", "setBunServerSocketHandlers");
const httpConnectionOf = $bindgen("node_http_binding.bind.ts", "httpConnectionOf");

const kServerResponse = Symbol("ServerResponse");
const kOptimizeEmptyRequests = Symbol("kOptimizeEmptyRequests");
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const ArrayBufferIsView = ArrayBuffer.isView;
const MathMin = Math.min;
const MathFloor = Math.floor;
const timerClockMs = $bindgen("Timer.bind.ts", "timerClockMs");

let cluster;

function emitCloseServer(self: Server) {
  // A native close promise belongs to one listener; Node's Server 'close' spans overlapping listeners and handed-off sockets (net.js _emitCloseIfDrained).
  if (!self[kPendingDrainClose]) return;
  const pendingGenerations = self[kPendingCloseGenerations];
  let drainedAtClose = true;
  for (const generation of pendingGenerations) {
    if (!generation.nativeClosed) return;
    drainedAtClose &&= generation.drainedAtClose;
  }
  const relistened = !!self[serverSymbol];
  // Node queues 'close' inside a close() that leaves no connection open. A listen() after it, or a connection to that listener, cannot hold the event back.
  // Without one, the event waits for the 'close' of the sockets that close() swept.
  if (relistened ? !drainedAtClose : self._connections > 0) return;
  self[kPendingDrainClose] = false;
  pendingGenerations.clear();
  if (!relistened) self[kListenerGeneration] = undefined;
  self.emit("close");
}
function emitCloseNotRunning(self: Server) {
  self.emit("close");
}
function markListenerGenerationClosed(self: Server, generation) {
  generation.nativeClosed = true;
  emitCloseServerInImmediate(self);
}
function emitCloseNTServer(this: Server, generation) {
  process.nextTick(markListenerGenerationClosed, this, generation);
}
// 'close' runs in listen()'s async context. Node uses close()'s: https://github.com/oven-sh/bun/pull/33719
function queueCloseNTServer(self: Server, stopped, generation) {
  const frame = generation.frame;
  generation.frame = undefined;
  const current = $getInternalField($asyncContext, 0);
  if (frame !== current) $putInternalField($asyncContext, 0, frame);
  try {
    // A server whose Bun.ModuleGraph was disposed emits nothing.
    if (frame === undefined || !isStoppedModuleGraphRunning()) {
      stopped.$then(emitCloseNTServer.bind(self, generation));
    }
  } finally {
    if (frame !== current) $putInternalField($asyncContext, 0, current);
  }
}

function setCloseCallback(self, callback) {
  if (callback === self[kCloseCallback]) {
    return;
  }
  if (self[kCloseCallback]) {
    throw new Error("Close callback already set");
  }
  self[kCloseCallback] = callback;
}

function assignSocketInternal(self, socket) {
  if (socket._httpMessage) {
    throw $ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = self;
  setCloseCallback(socket, onServerResponseClose);
  self.socket = socket;
  self.emit("socket", socket);
}

function onServerResponseClose() {
  // EventEmitter.emit makes a copy of the 'close' listeners array before
  // calling the listeners. detachSocket() unregisters onServerResponseClose
  // but if detachSocket() is called, directly or indirectly, by a 'close'
  // listener, onServerResponseClose is still in that copy of the listeners
  // array. That is, in the example below, b still gets called even though
  // it's been removed by a:
  //
  //   const EventEmitter = require('events');
  //   const obj = new EventEmitter();
  //   obj.on('event', a);
  //   obj.on('event', b);
  //   function a() { obj.removeListener('event', b) }
  //   function b() { throw "BAM!" }
  //   obj.emit('event');  // throws
  //
  // Ergo, we need to deal with stale 'close' events and handle the case
  // where the ServerResponse object has already been deconstructed.
  // Fortunately, that requires only a single if check. :-)
  const httpMessage = this._httpMessage;
  if (httpMessage) {
    emitCloseNT(httpMessage);
  }
}

// Node's write_() checks before _implicitHeader(): the write that renders the headers is counted but not checked. end() is always checked.
function strictContentLength(response, hadHeader, fromEnd) {
  if (!response.strictContentLength) return;
  if (!fromEnd && !hadHeader) return;
  let contentLength = response._contentLength ?? response.getHeader("content-length");
  if (
    contentLength != null &&
    response._hasBody &&
    !response.chunkedEncoding &&
    !response.hasHeader("transfer-encoding")
  ) {
    if (typeof contentLength !== "number") {
      contentLength = +contentLength;
      if (NumberIsNaN(contentLength)) {
        return;
      }
    }
    return contentLength;
  }
}

const kParserOnTimeout = HTTPParser.kOnTimeout | 0;

// Node attaches the llhttp HTTPParser to every server connection as
// `socket.parser`. Parsing happens natively here (uWS), so this stand-in only
// mirrors the surface userland observes on it: `incoming`, `free()`, `close()`
// and the kOnTimeout slot, released with freeParser-equivalent bookkeeping when
// the connection closes or is handed over to 'upgrade'/'connect'.
function serverParserShimFree() {}
function serverParserShimClose() {}
function serverParserShimOnTimeout() {}

function createServerParserShim(socket) {
  return {
    incoming: null,
    outgoing: null,
    socket,
    _consumed: true,
    free: serverParserShimFree,
    close: serverParserShimClose,
    resume: serverParserShimClose,
    [kParserOnTimeout]: serverParserShimOnTimeout,
  };
}

function releaseServerParserShim(socket, req?) {
  const parser = socket.parser;
  // A socket that was handed off and came back through emit('connection') has Node's parser, which socketOnClose frees.
  if (parser == null || parser instanceof HTTPParser) return;
  socket.parser = null;
  parser.incoming = null;
  parser.socket = null;
  parser[kParserOnTimeout] = null;
  parser.free();
  if (req != null && req.parser != null) req.parser = null;
}

function socketOnTimeout() {
  // A keep-alive timer that fired is dead: the next response finish arms a new one.
  if (this[kKeepAliveTimeoutSet]) this[kTimeout] = null;
  const req = this.parser?.incoming;
  const reqTimeout = req && !req.complete && req.emit("timeout", this);
  const res = this._httpMessage;
  const resTimeout = res && res.emit("timeout", this);
  const serverTimeout = this.server.emit("timeout", this);

  if (!reqTimeout && !resTimeout && !serverTimeout) this.destroy();
}

function emitListeningNextTick(self, hostname, port) {
  // Nothing to announce if close() ran in the same tick as listen(), or the Bun.ModuleGraph
  // whose script listened has been disposed (its listener was closed with it).
  if (!self[serverSymbol] || isStoppedModuleGraphRunning()) return;
  // Node passes no arguments. The extra ones are a Bun extension.
  self.emit("listening", null, hostname, port);
}

function emitListenErrorNextTick(self, err) {
  self.emit("error", err);
}

function emitListenError(server, err, port, host, socketPath, fd) {
  if (fd !== undefined) err = listenException(err, null);
  else err = socketPath ? listenException(err, socketPath, -1) : listenException(err, host ?? "::", port);
  process.nextTick(emitListenErrorNextTick, server, err);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1367-L1368
function normalizeServerTls(tls) {
  tls.requestCert = tls.requestCert === true;
  tls.rejectUnauthorized = tls.rejectUnauthorized !== false;
  return tls;
}

// uWS parses the connections it accepts. Every other Duplex gets Node's connection listener.
function connectionListener(this: Server, socket) {
  // A socket that 'connect' or 'upgrade' got is a connection like any other when it's emitted again.
  if (!socket[kHandedOff]) {
    if (socket[kHandle] !== undefined) return;
    const http = httpConnectionOf(socket._handle);
    if (http !== undefined) {
      attachConnection(this, socket, http);
      return;
    }
  }
  const tlsServer = this[tlsSymbol];
  // Its 'connection' listener wraps the socket in a TLSSocket, which comes back as 'secureConnection'.
  if (tlsServer) tlsServer.emit("connection", socket);
  else connectionListenerInternal(this, socket);
}

function secureConnectionListener(this: Server, socket) {
  if (socket[kHandle] !== undefined && !socket[kHandedOff]) nativeConnectionListener(this, socket);
  else connectionListenerInternal(this, socket);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/https.js#L103-L106
function onTLSClientError(this: Server, err, socket) {
  if (!this.emit("clientError", err, socket)) socket.destroy(err);
  else if (err?.code === "ERR_TLS_HANDSHAKE_TIMEOUT") process.nextTick(destroyUnlessSecure, socket);
}

// handshakeTimeout closes the socket whatever the 'clientError' listener did with it. Node leaves that to the listener.
function destroyUnlessSecure(socket) {
  if (!socket._secureEstablished) socket.destroy();
}

type NodeHTTPServer = import("node:http").Server;
interface Server extends NodeHTTPServer {
  maxHeaderSize: number | undefined;
  insecureHTTPParser: boolean | undefined;
  httpValidation?: "strict" | "relaxed" | "insecure";
  requireHostHeader: boolean;
  httpAllowHalfOpen: boolean;
  allowHalfOpen: boolean;
  blockList?: import("node:net").BlockList;
  keepAlive: boolean;
  keepAliveInitialDelay: number;
}
const kConstructed = Symbol("kConstructed");

// Bun only: http.createServer() with one of these serves TLS. Own enumerable ones count, which are what tls.Server gets.
function hasOwnTLSIdentity(options) {
  const isOwn = Object.prototype.propertyIsEnumerable;
  return !!(
    (isOwn.$call(options, "pfx") && options.pfx) ||
    (isOwn.$call(options, "cert") && options.cert) ||
    (isOwn.$call(options, "key") && options.key) ||
    (isOwn.$call(options, "ca") && options.ca)
  );
}

function Server(options, callback): void {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);
  this.on("listening", setupConnectionsTracking);
  this.on("connection", connectionListener);

  this._handle = null;
  this._unref = false;
  this.timeout = 0;
  this.maxRequestsPerSocket = 0;
  defineMaxHeadersCount(this);
  defineHttpAllowHalfOpen(this);
  this[kInternalSocketData] = undefined;
  this[kTrackedConnections] = new Set();
  this[kHandedOffSockets] = new Set();
  this._connections = 0;
  this[kPendingDrainClose] = false;
  this[kPendingCloseGenerations] = new Set();
  this[kListenerGeneration] = undefined;
  // http.Server.call() on an existing https.Server keeps its TLS configuration, like Node.
  this[tlsSymbol] ??= null;
  this.noDelay = true;
  let isTLS = false;
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null) {
    options = {};
  } else {
    validateObject(options, "options");
    isTLS = (this[isTlsSymbol] && !this[tlsSymbol]) || hasOwnTLSIdentity(options);
  }

  storeHTTPOptions.$call(this, options);
  // Node's https.Server gives tls.Server, and so net.Server, a spread of the caller's object. Its http.Server reads net.Server's options by name.
  const transportOptions = this[isTlsSymbol] ? { ...options } : options;
  // Node's http.Server always allows half-open sockets. https.Server takes the option, like tls.Server.
  this.allowHalfOpen = this[isTlsSymbol] ? !!transportOptions.allowHalfOpen : true;
  // This tls.Server never listens. It validates the TLS options and owns the SecureContext, like the one Node's https.Server extends.
  if (isTLS) {
    const { ignoredByHttpsServer } = require("internal/tls");
    const tlsServer = (this[tlsSymbol] = new (require("node:tls").Server)({
      ...transportOptions,
      ...ignoredByHttpsServer,
    }));
    tlsServer.on("secureConnection", socket => this.emit("secureConnection", socket));
    tlsServer.on("tlsClientError", (err, socket) => this.emit("tlsClientError", err, socket));
    this.on("secureConnection", secureConnectionListener);
    this.on("tlsClientError", onTLSClientError);
  }
  // listen() asks for it, so a server whose TLS options threw can't listen in cleartext.
  this[kConstructed] = true;

  // Node passes it to net.Server, which applies it to every accepted socket, and from there to req and res.
  this[kHighWaterMark] = transportOptions.highWaterMark;
  this.highWaterMark = transportOptions.highWaterMark ?? getDefaultHighWaterMark();

  this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

  // Like Node's net.Server, which stores the delay in seconds: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L1850-L1882
  let keepAliveInitialDelay = transportOptions.keepAliveInitialDelay;
  if (keepAliveInitialDelay !== undefined) {
    validateNumber(keepAliveInitialDelay, "options.keepAliveInitialDelay");
    if (keepAliveInitialDelay < 0) keepAliveInitialDelay = 0;
  }
  this.keepAlive = Boolean(transportOptions.keepAlive);
  this.keepAliveInitialDelay = ~~(keepAliveInitialDelay / 1000);

  if (callback) this.on("request", callback);
  return this;
}
$toClass(Server, "Server", EventEmitter);

// What net.ts's accept path and handshake handler read of a tls.Server. listen({ tls }) has the two certificate options only.
Object.defineProperties(Server.prototype, {
  _requestCert: {
    configurable: true,
    get() {
      const tlsServer = this[tlsSymbol];
      return tlsServer ? tlsServer._requestCert : this[kListenerGeneration]?.tls?.requestCert;
    },
  },
  _rejectUnauthorized: {
    configurable: true,
    get() {
      const tlsServer = this[tlsSymbol];
      return tlsServer ? tlsServer._rejectUnauthorized : this[kListenerGeneration]?.tls?.rejectUnauthorized;
    },
  },
  _handshakeTimeout: {
    configurable: true,
    get() {
      return this[tlsSymbol]?._handshakeTimeout ?? 120_000;
    },
  },
  _ALPNCallback: {
    configurable: true,
    get() {
      return this[tlsSymbol]?._ALPNCallback;
    },
  },
  _SNICallback: {
    configurable: true,
    get() {
      return this[tlsSymbol]?._SNICallback;
    },
  },
});

Object.defineProperty(Server.prototype, "listening", {
  __proto__: null,
  get() {
    return !!this[serverSymbol];
  },
  configurable: true,
  enumerable: true,
});

Server.prototype[kIncomingMessage] = undefined;

Server.prototype[kServerResponse] = undefined;

Server.prototype[kConnectionsCheckingInterval] = undefined;

Server.prototype[kClusterHandle] = undefined;

Server.prototype[kClusterListeningId] = 0;

function rethrowUncaught(err) {
  throw err;
}

// Like Node.js's setupConnectionsTracking: each 'listening' event replaces
// the connections-checking interval timer (used by the headers/request
// timeout machinery) and destroys the previous one.
function setupConnectionsTracking(this: any) {
  if (this[kConnectionsCheckingInterval]) {
    clearInterval(this[kConnectionsCheckingInterval]);
  }
  const delay = this.connectionsCheckingInterval ?? 30_000;
  this[kConnectionsCheckingInterval] = setInterval(checkConnections.bind(this), delay);
  this[kConnectionsCheckingInterval].unref();
  // Under `bun --hot`, a newer http.Server can take the native server before this 'listening' fires.
  if (lostListener(this)) releaseListener(this);
}

// Node.js's checkConnections sweep: every connectionsCheckingInterval, expire
// connections whose in-flight request exceeded headersTimeout/requestTimeout.
// The per-connection timing lives on the native socket handle (the parser is
// native), so each tracked connection is asked whether it expired.
function checkConnections(this: Server) {
  const headersTimeout = this.headersTimeout;
  const requestTimeout = this.requestTimeout;
  const sweep = headersTimeout !== 0 || requestTimeout !== 0;

  // llhttp keeps the times of the connections it parses, uWS those of its own.
  const parsed = this[kConnections];
  if (sweep && parsed !== undefined) {
    const expired = parsed.expired(headersTimeout, requestTimeout);
    for (let i = 0; i < expired.length; i++) {
      const socket = expired[i].socket;
      if (socket) onRequestTimeout(socket);
    }
  }

  const connections = this[kTrackedConnections];
  if (!connections || connections.size === 0) {
    // Under `bun --hot`, a replaced server with no connections left has nothing to check.
    if (lostListener(this)) clearInterval(this[kConnectionsCheckingInterval]);
    return;
  }

  if (!sweep) {
    return;
  }

  for (const socket of connections) {
    const handle = socket[kHandle];
    if (handle?.isRequestTimedOut?.(headersTimeout, requestTimeout)) {
      onRequestTimeout(socket);
    }
  }
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js (onRequestTimeout)
function onRequestTimeout(socket) {
  socketOnError.$call(socket, $ERR_HTTP_REQUEST_TIMEOUT("Request timeout"));
}

Server.prototype.ref = function () {
  // Only what unref() let go of: a socket can have an unref() of the program's own.
  if (this._unref) for (const socket of this[kHandedOffSockets]) socket.ref();
  this._unref = false;
  this[serverSymbol]?.ref?.();
  return this;
};

Server.prototype.unref = function () {
  this._unref = true;
  this[serverSymbol]?.unref?.();
  for (const socket of this[kHandedOffSockets]) socket.unref();
  return this;
};

Server.prototype.closeAllConnections = function () {
  const parsed = this[kConnections];
  if (parsed !== undefined) {
    const connections = parsed.all();
    for (let i = 0, l = connections.length; i < l; i++) {
      connections[i].socket.destroy();
    }
  }
  // Like Node, this skips the listener, sockets handed to 'connect' / 'upgrade' listeners, and TLS connections still in their handshake.
  const tracked = this[kTrackedConnections];
  if (tracked && tracked.size > 0) {
    for (const socket of $Array.from(tracked) as any[]) {
      destroyNow(socket);
    }
  }
};

// net.Socket's _destroy() calls this after it queued the socket's own 'close', so the immediate set here runs behind that. The one that stop()'s promise sets can run ahead: an idle connection that its peer or closeIdleConnections() closes emits 'close' after the server, as in Node.
Server.prototype._emitCloseIfDrained = function () {
  // This server has no 'close' listener on them, as in Node, so it forgets the closed ones now and then.
  const handedOff = this[kHandedOffSockets];
  if (handedOff.size > 2 * this._connections + 16) {
    for (const socket of handedOff) if (socket.destroyed) handedOff.delete(socket);
  }
  if (this._connections === 0 && this[kPendingDrainClose])
    queueMicrotask(emitCloseServerInImmediate.bind(undefined, this));
};
function emitCloseServerInImmediate(self: Server) {
  setImmediate(emitCloseServer, self);
}

Server.prototype.getConnections = function (callback) {
  // Connections are tracked from the moment they are accepted (the native
  // server surfaces accepts through the onConnection callback).
  const count = this._connections;
  if (typeof callback === "function") {
    process.nextTick(callback, null, count);
  }
  return this;
};

function closeIdleParsedConnections(server) {
  const parsed = server[kConnections];
  if (parsed === undefined) return;
  const connections = parsed.idle();
  for (let i = 0, l = connections.length; i < l; i++) {
    const socket = connections[i].socket;
    if (socket._httpMessage && !socket._httpMessage.finished) continue;
    socket.destroy();
  }
}

function httpServerPreClose(server) {
  server.closeIdleConnections();
  clearInterval(server[kConnectionsCheckingInterval]);
}

Server.prototype.closeIdleConnections = function () {
  closeIdleParsedConnections(this);
  const server = this[serverSymbol];
  if (server) {
    server.closeIdleConnections();
    return;
  }
  const tracked = this[kTrackedConnections];
  if (tracked && tracked.size > 0) {
    for (const socket of $Array.from(tracked) as any[]) {
      // uWS knows whether a request is arriving on the connection. A missing _httpMessage does not tell.
      socket[kHandle]?.closeIfIdle();
    }
  }
};

Server.prototype.close = function (optionalCallback?) {
  const server = this[serverSymbol];
  // Node.js's httpServerPreClose clears the connections-checking interval
  // even when the server was never listening.
  clearInterval(this[kConnectionsCheckingInterval]);
  closeIdleParsedConnections(this);
  if (!isPrimary) {
    this[kClusterListeningId]++;
    const clusterHandle = this[kClusterHandle];
    if (clusterHandle) {
      this[kClusterHandle] = undefined;
      clusterHandle[kClusterOwner] = null;
      clusterHandle.close();
    }
  }
  if (!server) {
    // https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2596-L2647
    if (typeof optionalCallback === "function") this.once("close", () => optionalCallback($ERR_SERVER_NOT_RUNNING()));
    if (this._connections === 0) process.nextTick(emitCloseNotRunning, this);
    return this;
  }
  if (typeof optionalCallback === "function") this.once("close", optionalCallback);
  const generation = this[kListenerGeneration];
  if (generation) this[kPendingCloseGenerations].add(generation);
  this[serverSymbol] = undefined;
  this._handle = null;
  this[kPendingDrainClose] = true;
  // Like Node, a connection that this sweep closes counts as gone, also a TLS one whose close ends later with the peer's close_notify.
  const swept = server.closeIdleConnections();
  if (generation) generation.drainedAtClose = this._connections === swept;
  if (nativeServerOwners !== undefined) {
    // Under `bun --hot`, stopping a shared native server also takes the listener away from its current http.Server.
    const owner = nativeServerOwners.get(server);
    if (owner != null && owner !== this) nativeServerOwners.set(server, null);
  }
  // stop() queues the task that emits 'close', which holds the loop one more turn, as node's uv_close() does.
  queueCloseNTServer(this, server.stop(), generation);
  return this;
};

Server.prototype[EventEmitter.captureRejectionSymbol] = function (err, event, ...args) {
  switch (event) {
    case "request": {
      const { 1: res } = args;
      if (!res.headersSent && !res.writableEnded) {
        // Don't leak headers.
        const names = res.getHeaderNames();
        for (let i = 0; i < names.length; i++) {
          res.removeHeader(names[i]);
        }
        res.statusCode = 500;
        res.end(STATUS_CODES[500]);
      } else {
        res.destroy();
      }
      break;
    }
    default:
      require("node:net").Server.prototype[EventEmitter.captureRejectionSymbol]!.$apply(this, arguments);
  }
};

Server.prototype[Symbol.asyncDispose] = function () {
  const { resolve, reject, promise } = Promise.withResolvers();
  this.close(function (err, ...args) {
    if (err) {
      reject(err);
    } else resolve(...args);
  });
  return promise;
};

Server.prototype.address = function () {
  if (!this[serverSymbol]) return null;
  return this[serverSymbol].address;
};

Server.prototype.listen = function () {
  // Before anything is registered, like net.Server: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2270-L2272
  if (this[serverSymbol]) throw $ERR_SERVER_ALREADY_LISTEN();
  const server = this;
  let port, host;
  let socketPath;
  let fd: number | undefined;
  let reusePort = false;
  let ipv6Only = false;
  let exclusive = false;
  const tlsServer = this[tlsSymbol];
  // The context already has the verify mode. socket.authorized reads requestCert.
  let tls = tlsServer && {
    __proto__: null,
    secureContext: tlsServer._sharedCreds.context,
    requestCert: tlsServer._requestCert === true,
    serverName: tlsServer.servername,
  };

  // This logic must align with:
  // - https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L274-L307
  const argc = arguments.length;
  if (argc > 0) {
    const arg0 = arguments[0];
    if ($isObject(arg0)) {
      // (options[...][, cb])
      addServerAbortSignalOption(this, arg0);
      // `fd` wins over the rest: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2314-L2317
      const { fd: fdOption } = arg0;
      if (typeof fdOption === "number" && fdOption >= 0) {
        fd = fdOption;
      } else {
        if ("fd" in arg0 && !("port" in arg0 || "path" in arg0)) {
          throw $ERR_INVALID_ARG_VALUE("options", arg0, 'must have the property "port" or "path"');
        }
        port = arg0.port;
        host = arg0.host;
        socketPath = arg0.path;
        reusePort = arg0.reusePort === true;
        ipv6Only = arg0.ipv6Only === true;
        exclusive = reusePort || !!arg0.exclusive;
        // Like net.Server.listen(), an explicit `port: undefined` or `port: null` binds any free port.
        if ((port === undefined && "port" in arg0) || port === null) port = 0;
      }

      const otherTLS = arg0.tls;
      if ($isObject(otherTLS)) {
        tls = normalizeServerTls({ __proto__: null, ...otherTLS, secureContext: undefined });
      }
    } else if (typeof arg0 === "string" && !(Number(arg0) >= 0)) {
      // (path[...][, cb])
      socketPath = arg0;
    } else {
      // ([port][, host][...][, cb])
      port = arg0;
      if (argc > 1 && typeof arguments[1] === "string") {
        host = arguments[1];
      }
    }
  }

  // Bun defaults to port 3000.
  // Node defaults to port 0.
  if (port == null && !socketPath) {
    port = 0;
  }

  // A bad port throws and a valid one overrides `path`: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2332-L2334
  if (typeof port === "number" || typeof port === "string") {
    validatePort(port, "options.port");
    port = +port | 0;
    socketPath = undefined;
  } else if (socketPath) {
    // Like net.Server.listen(), listening on a `path` ignores `host`.
    host = undefined;
  }

  const lastArg = arguments[argc - 1];
  if ($isCallable(lastArg)) {
    // Before the bind, as in node, so a listen() retried from the 'error' handler still calls it.
    this.once("listening", lastArg);
  }

  try {
    // Windows has no descriptor to listen on. Node reports EINVAL there too.
    if (fd !== undefined && (fd !== (fd | 0) || process.platform === "win32")) {
      throw new ErrnoException(process.binding("uv").UV_EINVAL, "listen");
    }

    // listenInCluster

    if (isPrimary) {
      server[kRealListen](tls, port, host, socketPath, reusePort, ipv6Only, fd);
      return this;
    }

    if (cluster === undefined) cluster = require("node:cluster");

    // SO_REUSEPORT can't share a unix socket or port 0, and a worker's `fd` names a descriptor of the primary.
    if (
      process.connected &&
      process.platform !== "win32" &&
      (fd !== undefined || (!exclusive && (socketPath || port === 0)))
    ) {
      listenInCluster(server, tls, port, host, socketPath, ipv6Only, fd);
      return this;
    }

    server[kClusterListeningId]++;
    server.once("listening", () => {
      // No channel (NODE_UNIQUE_ID inherited by a plain child, or already disconnected): nothing to notify.
      if (!process.connected) return;
      cluster.worker.state = "listening";
      const address = server.address();
      const isObjectAddress = address !== null && typeof address === "object";
      const boundHost = host && isObjectAddress ? address : null;
      const message = {
        cmd: "NODE_CLUSTER",
        act: "listening",
        port: socketPath ? -1 : (isObjectAddress && address.port) || port,
        data: null,
        address: socketPath ?? (boundHost && boundHost.address) ?? null,
        addressType: socketPath ? -1 : boundHost && boundHost.family === "IPv6" ? 6 : 4,
      };
      process.send!(message, undefined, kInternalSendOptions);
    });

    server[kRealListen](tls, port, host, socketPath, true, ipv6Only, fd);
    if (!exclusive) cluster._trackServer(server);
  } catch (err) {
    emitListenError(server, err, port, host, socketPath, fd);
  }

  return this;
};

// net.Server's listenInCluster, always `sharedOnly` like its TLS servers: Bun.serve can't take connections the primary accepted.
function listenInCluster(server, tls, port, host, socketPath, ipv6Only, fd) {
  const listeningId = ++server[kClusterListeningId];
  function query(address, queryPort, addressType) {
    const serverQuery = { address, port: queryPort, addressType, fd, flags: ipv6Only ? 1 : 0, sharedOnly: true };
    cluster._getServer(server, serverQuery, (errno, handle, reply) => {
      if (listeningId !== server[kClusterListeningId] || cluster.worker.exitedAfterDisconnect) {
        handle?.close();
        return;
      }
      if (errno) {
        const ex = new ExceptionWithHostPort(errno, "bind", address, queryPort);
        if (typeof reply?.bunHint === "string") ex.message += `\n  note: ${reply.bunHint}`;
        server.emit("error", ex);
        return;
      }
      server[kClusterHandle] = handle;
      handle[kClusterOwner] = server;
      try {
        server[kRealListen](tls, port, host, socketPath, false, false, handle.sharedFd);
        handle.adopted = true;
      } catch (err) {
        // Once Bun.serve() returned, the listener owns the descriptor and handle.close() must not close it again.
        handle.adopted = !!server[serverSymbol];
        server.close();
        emitListenError(server, err, port, host, socketPath, fd);
      }
    });
  }

  // The (address, port, addressType, fd) tuple keys the primary's handles, so it matches net.Server's.
  if (fd !== undefined) return query(null, null, null);
  if (socketPath) return query(socketPath, -1, -1);
  if (!host) return query(null, port, 4);
  // Bun.serve() takes "[::1]". The primary's bind() wants it bare.
  const address = host[0] === "[" ? host.slice(1, -1) : host;
  const addressType = isIP(address);
  if (addressType !== 0) return query(address, port, addressType);
  // https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2434-L2452
  require("node:dns").lookup(address, (err, ip, family) => {
    if (listeningId !== server[kClusterListeningId]) return;
    if (err) server.emit("error", err);
    else query(ip, port, family === 6 ? 6 : 4);
  });
}

Server.prototype[kRealListen] = function (tls, port, host, socketPath, reusePort, ipv6Only, fd?: number) {
  {
    // What the first connection and the first request need, so that neither waits for it.
    loadNet(tls);
    // The constructor adds them for TLS options of its own. listen({ tls }) comes without.
    if (tls && this.listenerCount("secureConnection", secureConnectionListener) === 0) {
      this.prependListener("secureConnection", secureConnectionListener);
      this.prependListener("tlsClientError", onTLSClientError);
    }
    traceEvents ??= require("internal/trace_events");

    if (!this[kConstructed]) throw $ERR_INVALID_STATE("The server's constructor threw");
    const ResponseClass = this[kServerResponse];
    const RequestClass = this[kIncomingMessage];
    const canUseInternalAssignSocket = ResponseClass?.prototype.assignSocket === ServerResponse.prototype.assignSocket;
    let server = this;
    let listenerGeneration;

    if (tls) {
      this.serverName = tls.serverName || host || "localhost";
    }
    this[serverSymbol] = Bun.serve<any>({
      idleTimeout: 0, // nodejs dont have a idleTimeout by default
      tls,
      port,
      hostname: host,
      unix: socketPath,
      fd,
      reusePort,
      ipv6Only,
      maxRequestBodySize: Number.MAX_SAFE_INTEGER,

      onNodeHTTPRequest(
        url: string,
        method: string,
        // Native dispatch bitfield (kDispatch* in NodeHTTP.cpp): presence and
        // token bits for the headers the dispatcher consults, so no header
        // object or array is materialized unless user code reads them.
        dispatchBits: number,
        handle,
        hasBody: boolean,
        socketHandle,
        isSocketNew,
        socket,
        isAncientHTTP: boolean,
        connectHead?: Buffer,
        isPipelinedDispatch?: boolean,
      ) {
        if (isPipelinedDispatch) {
          // Holds this request's turn until its response exists, also when a throw prevents that.
          connectionState(socket).outgoing.push(kNoResponse);
          // For such a throw when no response is in flight whose 'finish' would come back to the queue.
          if (socket._httpMessage == null) process.nextTick(sendNextResponseIfIdle, socket);
        }

        // Like Node.js's resetSocketTimeout (parserOnIncoming): a new request
        // arriving on a kept-alive connection replaces the keep-alive idle
        // timeout with the server's regular per-socket timeout.
        if (socket[kKeepAliveTimeoutSet]) {
          socket[kKeepAliveTimeoutSet] = false;
          const serverTimeout = server.timeout;
          if (serverTimeout) {
            socket.setTimeout(serverTimeout);
          } else {
            // No regular per-socket timeout: leave the existing keep-alive
            // timer armed (instead of clear + re-allocate next finish).
            // onSocketTimeoutTimerExpired ignores it while kKeepAliveTimeoutSet
            // is false; the next response-finish refreshes it in place.
            socket.timeout = 0;
          }
        } else {
          // Request bytes are socket activity for the inactivity timeout.
          socket._unrefTimer();
        }

        const http_req = new RequestClass(kHandle, url, method, undefined, undefined, handle, hasBody, socket);
        if (isAncientHTTP) {
          http_req.httpVersion = "1.0";
          http_req.httpVersionMajor = 1;
          http_req.httpVersionMinor = 0;
        }
        // Pull the handful of headers the dispatcher consults out of
        // rawHeaders in one pass, instead of reading req.headers (each read
        // of which would force the lazy header-object build even when user
        // code never touches headers). Copy to locals before any callback
        // can re-enter the dispatcher.
        // HTTP/1.0 (ancient) responses never advertise keep-alive on this
        // server; otherwise honor a Connection: close token from the request.
        http_req[kReqShouldKeepAlive] = isAncientHTTP ? false : (dispatchBits & DISPATCH_CONN_CLOSE) === 0;
        if (server.joinDuplicateHeaders) {
          http_req.joinDuplicateHeaders = true;
        }
        let socketParser = socket.parser;
        if (socketParser == null) {
          socketParser = socket.parser = createServerParserShim(socket);
        }
        socketParser.incoming = http_req;
        socketParser[kParserOnTimeout] = serverParserShimOnTimeout;

        const isPipelined = !!isPipelinedDispatch;
        // Pipelined or not, like Node.js: nothing behind this request is parsed.
        if (method === "CONNECT") {
          if (server.listenerCount("connect") > 0) {
            // For CONNECT, emit the event and let the handler respond
            // Don't assign the socket to a response for CONNECT
            // The handler should write the raw response
            const head = connectHead ? connectHead : kEmptyBuffer;
            // Node.js's parserOnIncoming: req.upgrade is true for CONNECT regardless of shouldUpgradeCallback.
            http_req.upgrade = true;
            // llhttp completes a CONNECT request at the end of its head, before Node emits 'connect'.
            http_req.complete = true;
            handOffSocket(socket, http_req, isPipelined);
            if (isPipelined) {
              const { outgoing } = connectionState(socket);
              outgoing[outgoing.length - 1] = { handedOff: handle, destroyed: false, destroy() {} };
            }
            try {
              server.emit("connect", http_req, socket, head);
            } catch (err) {
              // Like 'upgrade' below. Native would end the pending response, here the one ahead.
              process.nextTick(rethrowUncaught, err);
            }
            return;
          } else {
            // Node.js will close the socket and will NOT respond with 400 Bad Request
            socketHandle.close();
          }
          return;
        }

        if (isPipelined) {
          // A response is still owed on this connection. This one waits for its turn on Node's path, which can hold what it writes.
          handle.onabort = socket[kBoundOnAbort] ??= onServerRequestEvent.bind(socket);
          if (hasBody) handle.ondata = onDataIncomingMessage.bind(http_req);
          const state = connectionState(socket);
          state.outgoing.pop(); // the turn held above
          drainMicrotasks();
          const waiting = state.outgoing.length;
          let completed = false;
          try {
            parserOnIncoming(server, socket, state, http_req, http_req[kReqShouldKeepAlive], dispatchBits);
            completed = true;
          } finally {
            const res = socket._httpMessage?.req === http_req ? socket._httpMessage : state.outgoing[waiting];
            if (completed) {
              // As for a request that didn't have to wait, the connection closes behind the 503.
              const limit = server.maxRequestsPerSocket;
              if (limit > 0 && socket.requestsCount > limit) res._last = true;
            } else if (res === undefined) {
              state.outgoing.push(kNoResponse);
              if (socket._httpMessage == null) process.nextTick(sendNextResponseIfIdle, socket);
            } else if (res !== socket._httpMessage) {
              // It threw. Bun answers that with a close, at the response's turn unless it's complete by then.
              res[kDispatchThrew] = true;
            } else if (!res.finished) {
              closeBehindLastWrite(socket);
            }
          }
          if (!hasBody) completeWithoutBody(http_req, socket);
          return;
        }

        // The builtin ServerResponse consumes its options synchronously, so a
        // reusable scratch object avoids one allocation per request. User
        // subclasses (options.ServerResponse) might retain options, so they
        // keep getting a fresh object.
        let http_res;
        if (ResponseClass === ServerResponse) {
          scratchResponseOptions[kHandle] = handle;
          scratchResponseOptions.highWaterMark = socket.writableHighWaterMark;
          scratchResponseOptions.rejectNonStandardBodyWrites = server.rejectNonStandardBodyWrites;
          http_res = new ResponseClass(http_req, scratchResponseOptions);
          scratchResponseOptions[kHandle] = undefined;
        } else {
          http_res = new ResponseClass(http_req, {
            [kHandle]: handle,
            highWaterMark: socket.writableHighWaterMark,
            rejectNonStandardBodyWrites: server.rejectNonStandardBodyWrites,
          });
        }
        http_res._keepAliveTimeout = server.keepAliveTimeout;
        // Only stamp the symbol when the server actually set `uniqueHeaders`:
        // unconditionally adding it (even as undefined) forced a hidden-class
        // transition on every ServerResponse, which measurably slowed every
        // later property access on it (renderNativeHeaders in particular).
        // parseUniqueHeadersOption yields null when the option is unset, so
        // test != null: stamping null would still shape-transition every
        // response for a value renderNativeHeaders treats as absent anyway.
        const uniqueHeaders = server[kUniqueHeaders];
        if (uniqueHeaders != null) http_res[kUniqueHeaders] = uniqueHeaders;

        // The request itself forbids connection reuse (HTTP/1.0, or the
        // client sent Connection: close): end the server's writable side as
        // soon as the response has been written, like Node.js's resOnFinish.
        // Registered before the 'request' event so the socket is already
        // ended inside user 'finish' listeners. (Not done for the
        // maxRequestsPerSocket limit - pipelined requests past the limit
        // still need to be answered with 503.)
        if (!http_req[kReqShouldKeepAlive]) {
          http_res._last = true;
        }
        // One plain on() listener (once() allocates a wrapper, a second listener
        // deoptimizes every 'finish' emit), registered before the 'request' event
        // like Node's resOnFinish so res.on-replacing middleware cannot swallow it.
        http_res.on("finish", emitResponseFinish);

        handle.onabort = socket[kBoundOnAbort] ??= onServerRequestEvent.bind(socket);
        // Like Node's connectionListener -> parserOnBody: body bytes flow into
        // the IncomingMessage as they arrive, and the push callback readStop()s
        // the socket (which emits 'pause' on it) once the buffer fills.
        if (hasBody) {
          handle.ondata = onDataIncomingMessage.bind(http_req);
        }
        drainMicrotasks();

        let pendingPromise: Promise<void> | undefined;
        let didFinish = false;

        // Node.js (llhttp) only flags a request as an upgrade when it carries
        // both an Upgrade header and a Connection header with the "upgrade"
        // token; the server then consults shouldUpgradeCallback (default: an
        // 'upgrade' listener is installed) and otherwise dispatches the
        // request normally.
        let is_upgrade = false;
        if ((dispatchBits & DISPATCH_HAS_UPGRADE) !== 0 && (dispatchBits & DISPATCH_CONN_UPGRADE) !== 0) {
          // Like Node.js, shouldUpgradeCallback sees req.upgrade === true.
          http_req.upgrade = true;
          is_upgrade = !!server.shouldUpgradeCallback(http_req);
        }
        // Like Node.js's parserOnIncoming: req.upgrade is true inside the
        // 'upgrade' listener and false for a declined upgrade that falls
        // through to 'request'.
        http_req.upgrade = is_upgrade;
        if (!is_upgrade) {
          // Node.js's connectionListener registers socketOnClose, which frees
          // the parser - even a manually emitted 'close' stops parsing of any
          // pipelined requests still in the buffer.
          if (!socket[kStopParsingOnCloseListener]) {
            socket[kStopParsingOnCloseListener] = true;
            socket.on("close", onSocketCloseStopParsing);
          }
          if (canUseInternalAssignSocket) {
            // ~10% performance improvement in JavaScriptCore due to avoiding .once("close", ...) and removing a listener
            assignSocketInternal(http_res, socket);
          } else {
            http_res.assignSocket(socket);
          }
        }
        function onClose() {
          didFinish = true;
          if (pendingPromise) $resolvePromiseWithFirstResolvingFunctionCallCheck(pendingPromise, undefined);
        }

        setCloseCallback(http_res, onClose);
        if (!is_upgrade) observeRequest(http_req, http_res);

        // Like Node.js: with the optimizeEmptyRequests server option,
        // requests without body headers skip the Readable life cycle (no
        // 'data'/'end'/'close' events) and arrive pre-dumped.
        if (
          server[kOptimizeEmptyRequests] &&
          !is_upgrade &&
          (dispatchBits & (DISPATCH_HAS_CONTENT_LENGTH | DISPATCH_HAS_TRANSFER_ENCODING)) === 0
        ) {
          http_req._dumpAndCloseReadable();
        }

        // Node's parserOnIncoming never counts an accepted upgrade or a missing-Host 400 against maxRequestsPerSocket, and routes HTTP/1.1 only.
        const expectation =
          is_upgrade || isAncientHTTP ? kNoExpectation : expectationFromBits(server, http_res, socket, dispatchBits);

        if (expectation === kOverRequestsLimit) {
          emitRequest(server, socket, http_req, http_res, expectation);
          socket.destroy();
        } else if (is_upgrade) {
          // Like Node 26, a body is parsed and delivered through req. The connection leaves HTTP behind it, so the head is empty.
          if (hasBody) {
            socketHandle.leaveHttpAfterBody();
            handle.ondata = onUpgradeBodyData.bind(http_req);
            handle.notifyWhenReadParsed();
            return;
          }
          http_req.complete = true;
          handOffSocket(socket, http_req, false);
          const upgradeHead = !hasBody && connectHead ? connectHead : kEmptyBuffer;
          let upgradeHandled;
          try {
            upgradeHandled = server.emit("upgrade", http_req, socket, upgradeHead);
          } catch (err) {
            // A throwing 'upgrade' listener surfaces as an uncaught
            // exception, like Node.js (the emit happens outside any JS try
            // frame there).
            process.nextTick(rethrowUncaught, err);
            upgradeHandled = true;
          }
          if (!upgradeHandled) {
            // shouldUpgradeCallback accepted the upgrade but no 'upgrade'
            // listener is installed: Node.js destroys the socket.
            socket.destroy();
            return;
          }
          return;
        } else {
          emitRequest(server, socket, http_req, http_res, expectation);
        }

        if (!hasBody) completeWithoutBody(http_req, socket);

        if (handle.finished || didFinish) {
          handle = undefined;
          http_res[kCloseCallback] = undefined;
          // Set in time only because end() defers the 'finish' emit to a
          // process.nextTick (see ServerResponse.prototype.end) and nothing
          // between the 'request' emit and here drains the tick queue.
          http_res[kDetachedFrom] = socket;
          http_res.detachSocket(socket);
          sendNextResponseIfAny(socket);
          return;
        }

        pendingPromise = $newPromise();

        return pendingPromise;
      },
    });

    const handle = this[serverSymbol];
    // supertest only closes its server when `_handle` is set.
    this._handle = handle;
    listenerGeneration = {
      server: this,
      isUnix: !!socketPath || (fd !== undefined && handle.address === null),
      tls,
      nativeClosed: false,
      drainedAtClose: false,
      // The async context of listen(), until close().
      frame: $getInternalField($asyncContext, 0),
    };
    this[kListenerGeneration] = listenerGeneration;
    applyServerCustomOptions(this);
    // Only `bun --hot` sets an id. The next listen() on this address reuses this native server.
    if (handle.id !== "") {
      const owners = (nativeServerOwners ??= new (require("internal/primordials").SafeWeakMap)());
      const previous = owners.get(handle);
      owners.set(handle, this);
      if (previous != null) releaseListener(previous);
    }
    const tlsServer = this[tlsSymbol];
    if (tlsServer) {
      for (const { 0: hostname, 1: context } of tlsServer[kSNIContexts]) {
        addServerName(handle, hostname, context.context);
      }
    }

    if (this._unref) handle.unref();

    // A tick, not a timer, as in node: a timer never fires on its own under jest.useFakeTimers().
    process.nextTick(emitListeningNextTick, this, handle.hostname, handle.port);
  }
};

// Pushes the per-server parser/handler options down to the native listener.
function applyServerCustomOptions(server: Server) {
  const handle = server[serverSymbol];
  if (!handle) return;
  setServerCustomOptions(
    handle,
    serverLenientFlags(server),
    !!server.httpAllowHalfOpen,
    typeof server.maxHeaderSize !== "undefined" ? server.maxHeaderSize : getMaxHTTPHeaderSize(),
    onServerClientError.bind(server, server[kListenerGeneration]),
  );
  setServerMaxHeadersCount(handle, nativeMaxHeadersCount(server.maxHeadersCount));
  const SocketClass = server[kListenerGeneration].tls ? TLSSocket : NetSocket;
  const { 0: handlers, 1: data } = require("node:net").Server.prototype[kForeignListener].$call(server, SocketClass);
  // The native side keeps the async context it's called in for every handler. What a socket emits runs in nobody's AsyncLocalStorage store, as in Node.
  const frame = AsyncContextFrame.current();
  const socketFrame = AsyncContextFrame.currentGraphFrame();
  AsyncContextFrame.run(
    socketFrame,
    setBunServerSocketHandlers,
    undefined,
    handle,
    frame === socketFrame ? handlers : withServerEventsIn(frame, handlers),
    server[tlsSymbol]?.ALPNProtocols ?? kEmptyBuffer,
    data,
  );
}

// 'connection', 'secureConnection', 'keylog' and the TLS callbacks are the server's: they run in the context of listen().
function withServerEventsIn(frame, handlers) {
  const table = { ...handlers };
  for (const name of ["open", "handshake", "keylog", "serverName", "alpnCallback"]) {
    const handler = handlers[name];
    if (handler) table[name] = (...args) => AsyncContextFrame.run(frame, handler, undefined, ...args);
  }
  return table;
}

// Returns true if, under `bun --hot`, the native server now dispatches to another http.Server or was stopped by one.
function lostListener(server: Server) {
  if (nativeServerOwners === undefined) return false;
  const owner = nativeServerOwners.get(server[serverSymbol]);
  return owner !== undefined && owner !== server;
}

// A replaced server keeps its timeout sweep only while it still has connections.
function releaseListener(server: Server) {
  if (server[kTrackedConnections].size === 0) clearInterval(server[kConnectionsCheckingInterval]);
}

// Resolution: httpValidation > explicit insecureHTTPParser > --insecure-http-parser. Native
// implements two llhttp lenient bits: bit 0 = LENIENT_HEADERS ("relaxed" gets this only),
// bit 1 = LENIENT_TRANSFER_ENCODING (kLenientAll / "insecure" gets both).
function serverLenientFlags(server: Server) {
  const lenient = calculateLenientFlags(server.httpValidation, server.insecureHTTPParser);
  if (lenient === HTTPParser.kLenientNone) return 0;
  return lenient === HTTPParser.kLenientAll ? 0b11 : 0b01;
}

function httpAllowHalfOpenGet(this: Server) {
  return this[kHttpAllowHalfOpen];
}

// Node reads server.httpAllowHalfOpen at the peer's FIN, so an assignment after listen() must reach the native listener: push the flags alone, not the callbacks.
function httpAllowHalfOpenSet(this: Server, value) {
  const previous = !!this[kHttpAllowHalfOpen];
  this[kHttpAllowHalfOpen] = value;
  const next = !!value;
  if (previous === next) return;
  const handle = this[serverSymbol];
  if (handle) setServerAppFlags(handle, serverLenientFlags(this), next);
}

// Node.js keeps httpAllowHalfOpen as an own enumerable property of the server.
function defineHttpAllowHalfOpen(server: Server) {
  server[kHttpAllowHalfOpen] = false;
  Object.defineProperty(server, "httpAllowHalfOpen", {
    configurable: true,
    enumerable: true,
    get: httpAllowHalfOpenGet,
    set: httpAllowHalfOpenSet,
  });
}

// Node's int32 `maxHeadersCount << 1`, as a field count; 0 is no limit: https://github.com/nodejs/node/blob/v26.5.1/lib/_http_server.js#L795-L797
function nativeMaxHeadersCount(maxHeadersCount) {
  if (typeof maxHeadersCount !== "number") return 0;
  const maxHeaderPairs = maxHeadersCount << 1;
  return maxHeaderPairs > 0 ? maxHeaderPairs >>> 1 : 0;
}

function maxHeadersCountGet(this: Server) {
  return this[kMaxHeadersCount];
}

// Node reads `server.maxHeadersCount` for every new connection, so a value assigned after listen() goes to the native parser.
function maxHeadersCountSet(this: Server, value) {
  this[kMaxHeadersCount] = value;
  const handle = this[serverSymbol];
  if (handle) setServerMaxHeadersCount(handle, nativeMaxHeadersCount(value));
}

// Node.js keeps maxHeadersCount as an own enumerable property of the server.
function defineMaxHeadersCount(server: Server) {
  server[kMaxHeadersCount] = null;
  Object.defineProperty(server, "maxHeadersCount", {
    configurable: true,
    enumerable: true,
    get: maxHeadersCountGet,
    set: maxHeadersCountSet,
  });
}

// Like Node.js: server.setTimeout only records the per-socket inactivity
// timeout (and an optional 'timeout' listener); it is applied to each
// connection when it is established, via socket.setTimeout.
Server.prototype.setTimeout = function (msecs, callback) {
  this.timeout = msecs;
  if (typeof callback === "function") this.on("timeout", callback);
  return this;
};

type NodeHTTPResponseAbortEvent = import("internal/http").NodeHTTPResponseAbortEvent;
function onServerRequestEvent(this: any, event: NodeHTTPResponseAbortEvent) {
  const socket = this;
  switch (event) {
    case NodeHTTPResponseAbortEvent.abort:
      // The socket's own handle hears the close right behind this, with how it closed.
      break;
    case NodeHTTPResponseAbortEvent.timeout: {
      socket.emit("timeout");
      break;
    }
  }
}
// uWS::HttpParserError
enum HttpParserError {
  HTTP_PARSER_ERROR_NONE = 0,
  HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING = 1,
  HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH = 2,
  HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING = 3,
  HTTP_PARSER_ERROR_INVALID_REQUEST = 5,
  HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE = 6,
  HTTP_PARSER_ERROR_INVALID_HTTP_VERSION = 7,
  HTTP_PARSER_ERROR_INVALID_EOF = 8,
  HTTP_PARSER_ERROR_INVALID_METHOD = 9,
  HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN = 10,
  HTTP_PARSER_ERROR_LF_EXPECTED = 11,
  HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW = 12,
  HTTP_PARSER_ERROR_PAUSED_H2_UPGRADE = 13,
  HTTP_PARSER_ERROR_CLOSED_CONNECTION = 14,
  HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE = 15,
  HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED = 16,
  HTTP_PARSER_ERROR_TRAILER_CONTENT_LENGTH = 17,
  HTTP_PARSER_ERROR_INVALID_URL = 18,
  HTTP_PARSER_ERROR_EMPTY_CONTENT_LENGTH = 19,
  HTTP_PARSER_ERROR_CONTENT_LENGTH_OVERFLOW = 20,
  HTTP_PARSER_ERROR_DUPLICATE_CONTENT_LENGTH = 21,
}
// Native callback fired when the HTTP parser rejects incoming bytes. Builds
// the same error object Node's parser produces and routes it through
// socketOnError, exactly like Node's onParserExecuteCommon: the server's
// 'clientError' listener (or the default handler) decides what to write back
// and when to destroy the connection.
function onServerClientError(listenerGeneration, socket: unknown, errorCode: number, rawPacket: ArrayBuffer) {
  const nodeSocket = (socket as any).duplex;

  let err;
  switch (errorCode) {
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING:
      err = $HPE_INVALID_CHUNK_SIZE("Parse Error: Invalid character in chunk size");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Invalid character in Content-Length");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_EMPTY_CONTENT_LENGTH:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Empty Content-Length");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CONTENT_LENGTH_OVERFLOW:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Content-Length overflow");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_DUPLICATE_CONTENT_LENGTH:
      err = $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error: Duplicate Content-Length");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING:
      err = $HPE_INVALID_TRANSFER_ENCODING("Parse Error: Request has invalid `Transfer-Encoding`");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_TRAILER_CONTENT_LENGTH:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Content-Length can't be present with Transfer-Encoding");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_REQUEST:
      err = $HPE_INVALID_CONSTANT("Parse Error: Expected HTTP/");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_EOF:
      err = $HPE_INVALID_EOF_STATE("Parse Error: Invalid EOF state");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_METHOD:
      err = $HPE_INVALID_METHOD("Parse Error: Invalid method encountered");
      err.bytesParsed = 1; // always 1 for now because is the first byte of the request line
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN:
      err = $HPE_INVALID_HEADER_TOKEN("Parse Error: Invalid header token encountered");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE:
    case HttpParserError.HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE:
      err = $HPE_HEADER_OVERFLOW("Parse Error: Header overflow");
      err.bytesParsed = rawPacket.byteLength;
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_HTTP_VERSION:
      err = $HPE_INVALID_VERSION("Parse Error: Invalid HTTP version");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_LF_EXPECTED:
      err = $HPE_LF_EXPECTED("Parse Error: Missing expected LF after header value");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW:
      err = $HPE_CHUNK_EXTENSIONS_OVERFLOW("Parse Error: Chunk extensions overflow");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_PAUSED_H2_UPGRADE:
      err = $HPE_PAUSED_H2_UPGRADE("Parse Error: Pause on PRI/Upgrade");
      err.bytesParsed = 24;
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CLOSED_CONNECTION:
      err = $HPE_CLOSED_CONNECTION("Parse Error: Data after `Connection: close`");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED:
      err = $HPE_STRICT("Parse Error: Expected LF after chunk data");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_URL:
      err = $HPE_INVALID_URL("Parse Error: Invalid characters in url");
      break;
    default:
      err = $HPE_INTERNAL("Parse Error");
      break;
  }
  // Node builds the message as `Parse Error: ${reason}`.
  err.reason = err.message.slice("Parse Error: ".length);
  err.rawPacket = Buffer.from(rawPacket);
  socketOnError.$call(nodeSocket, err);
}

// Node.js hands the connection over to 'connect'/'upgrade' listeners with the
// connection-listener set removed (onParserExecuteCommon removes its data/end/
// close/drain/error/timeout listeners) and only net.Socket's own 'end' listener
// left in place.
const kHandedOffSockets = Symbol("kHandedOffSockets");
function detachFromHttp(socket, req) {
  socket[kHandedOff] = true;
  socket.removeListener("error", socketOnError);
  socket.removeListener("timeout", socketOnTimeout);
  socket.removeListener("close", nativeSocketOnClose);
  socket.removeListener("close", onSocketCloseStopParsing);
  socket.removeListener("end", nativeSocketOnEnd);
  socket.removeListener("pause", onSocketPause);
  socket.removeListener("resume", nativeSocketOnResume);
  socket.removeListener("data", noopOnData);
  delete socket._onTimeout;
  // Only that function ignores the keep-alive timer, which stays armed while a request is in flight.
  if (socket.timeout === 0) socket.setTimeout(0);
  delete socket._final;
  delete socket._destroy;
  const server = socket.server;
  server[kTrackedConnections].delete(socket);
  // In Node each socket holds the process itself. Here unref() on the server has always let go of these sockets too.
  server[kHandedOffSockets].add(socket);
  if (server._unref) socket.unref();
  socket[kHandleClosed] = destroyUnreadSocket;
  // Like Node's onParserExecuteCommon: a flowing socket would drop bytes that arrive before the listener attaches a reader.
  socket.readableFlowing = null;
  // A pause of the HTTP phase ends with it. net.Socket has had a read pending since the accept, so no _read() would lift it.
  socket._handle?.resume();
  // Node frees the parser before it emits 'upgrade' or 'connect'.
  releaseServerParserShim(socket, req);
  // A 'close' listener of a WebSocket logs the peer's address, and net.Socket only keeps one that was read while the socket was open.
  socket._getpeername();
}
// A socket whose connection has closed closes too, also with bytes that nobody reads. Node keeps those for a reader.
function destroyUnreadSocket(this: any) {
  if (this.readableLength > 0 && !this.readableFlowing) this.destroy();
}
function handOffSocket(socket, req, isPipelined) {
  detachFromHttp(socket, req);
  const http = socket[kHandle];
  if (isPipelined) {
    // Responses ahead of this request are still owed. Until its turn the socket reads and writes through uWS.
    http.detachParser();
  } else if (http.leaveHttp(true)) {
    socket[kHandle] = undefined;
  }
}
// ws.handleUpgrade() while uWS still owns the connection: from a 'request' listener, or before the body of the Upgrade request has ended.
Server.prototype[kLeaveHttp] = function (socket, req) {
  const http = socket[kHandle];
  if (http === undefined) return;
  // A framework's own request object stands for the request that is being answered.
  if (req[kHandle] === undefined) req = socket.parser?.incoming ?? socket[kUpgradeStream]?.[kIncomingMessage];
  // A request that waits behind other responses doesn't own the connection.
  if (req == null || http.response !== req[kHandle]) return;
  const res = socket._httpMessage;
  // What a paused request left in native code is its body, not the WebSocket's frames.
  req[kHandle].resume();
  if (socket[kHandle] === undefined) return;
  if (!socket[kHandedOff]) detachFromHttp(socket, req);
  if (!http.leaveHttp(false)) return;
  socket[kHandle] = undefined;
  socket[kUpgradeStream] = undefined;
  res?.detachSocket(socket);
  // A reader that waits for the rest of the body gets 'end', like in Node 25 and older.
  if (!req.complete) onDataIncomingMessage.$call(req, undefined, true, NodeHTTPResponseAbortEvent.none);
};
// The body of an accepted Upgrade request. Node parses the whole read before it emits 'upgrade': onConnectionClosed() emits it for a body that came with its head.
function onUpgradeBodyData(this: any, chunk, isLast, event) {
  const socket = this.socket;
  if (event === NodeHTTPResponseAbortEvent.readParsed) {
    if (!socket[kHandedOff]) emitUpgrade(socket, this, false);
    return;
  }
  if (isLast && !socket[kHandedOff]) socket[kUpgradeRequest] = this;
  onDataIncomingMessage.$call(this, chunk, isLast, event);
}
// On a socket: the Upgrade request whose body ended in the read that brought its head, until 'upgrade' is emitted.
const kUpgradeRequest = Symbol("kUpgradeRequest");
function emitUpgrade(socket, req, complete) {
  if (socket.destroyed) return;
  const server = socket.server;
  detachFromHttp(socket, req);
  let stream = socket;
  if (!complete) {
    // Node's socketOnEnd stays on the socket until the body has ended.
    socket.on("end", socket.end);
    stream = socket[kUpgradeStream] = new UpgradeStream(socket, req);
    // The stream destroyer (a `for await` that is left early) clears req.socket.
    req.once("close", onUpgradeRequestClose.bind(socket));
  }
  try {
    if (!server.emit("upgrade", req, stream, kEmptyBuffer)) socket.destroy();
  } catch (err) {
    process.nextTick(rethrowUncaught, err);
  }
}
function onUpgradeRequestClose(this: any) {
  this[kUpgradeStream]?.requestBodyCompleted();
}
const { kTimeout } = require("internal/timers");
// Scratch options object for the builtin ServerResponse (see the dispatcher).
const scratchResponseOptions = {
  [kHandle]: undefined,
  highWaterMark: 0,
  rejectNonStandardBodyWrites: false,
};
// Per-socket cached bound abort handler (the socket outlives its requests).
const kBoundOnAbort = Symbol("kBoundOnAbort");
const kKeepAliveTimeoutSet = Symbol("keepAliveTimeoutSet");
// The timers' clock at the last response write or finish. Rescheduling the socket timer each time is slow, so onSocketTimeoutTimerExpired moves the deadline instead.
const kLastResponseWrite = Symbol("lastResponseWrite");
const kStopParsingOnCloseListener = Symbol("kStopParsingOnCloseListener");
// The socket the dispatcher already detached a synchronously-finished response from,
// so the 'finish' listener does not detach it or send the next response a second time.
const kDetachedFrom = Symbol("kDetachedFrom");

// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js (socketOnError)
const badRequestResponse = Buffer.from(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n`, "latin1");
const requestTimeoutResponse = Buffer.from(`HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n`, "latin1");
const requestHeaderFieldsTooLargeResponse = Buffer.from(
  `HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n`,
  "latin1",
);
const requestChunkExtensionsTooLargeResponse = Buffer.from(
  `HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n`,
  "latin1",
);

// Default 'error' listener installed on every server connection, like
// Node.js's socketOnError: route the error to the server's 'clientError'
// event and, when nothing handles it, answer with a raw error response (only
// if nothing has been written for the in-flight response yet) and destroy the
// connection.
function socketOnError(this: any, err) {
  // Ignore further errors
  this.removeListener("error", socketOnError);
  // A 'clientError' listener can keep the connection open, and a later parse error calls this again.
  if (this.listenerCount("error", noopOnError) === 0) this.on("error", noopOnError);

  const server = this.server;
  if (!server || !server.emit("clientError", err, this)) {
    // Caution must be taken to avoid corrupting the remote peer.
    // Reply an error segment if there is no in-flight `ServerResponse`,
    // or no data of the in-flight one has been written yet to this socket.
    const message = this._httpMessage;
    // Node checks _headerSent (bytes reached the socket), not headersSent
    // (writeHead called): after res.writeHead() but before write/end/flush,
    // no bytes are on the wire yet so the raw error response is still safe.
    if (this.writable && (!message || !message._headerSent)) {
      let response;
      switch (err?.code) {
        case "HPE_HEADER_OVERFLOW":
          response = requestHeaderFieldsTooLargeResponse;
          break;
        case "HPE_CHUNK_EXTENSIONS_OVERFLOW":
          response = requestChunkExtensionsTooLargeResponse;
          break;
        case "ERR_HTTP_REQUEST_TIMEOUT":
          response = requestTimeoutResponse;
          break;
        default:
          response = badRequestResponse;
          break;
      }
      this.write(response);
    }
    this.destroy(err);
  }
}
function noopOnError() {}

// From here to onSocketResume(), Node's connection listener over any Duplex: https://github.com/nodejs/node/blob/v26.5.0/lib/_http_server.js#L763-L1413
function connectionListenerInternal(server, socket) {
  socket.server = server;

  const { timeout } = server;
  if (timeout && typeof socket.setTimeout === "function") socket.setTimeout(timeout);
  socket.on("timeout", socketOnTimeout);

  const parser = parsers.alloc();

  const lenientFlags = calculateLenientFlags(server.httpValidation, server.insecureHTTPParser);

  // Node makes the list at 'listening'. A server that never listens tracks its connections too.
  const connections = (server[kConnections] ??= new ConnectionsList());
  parser.initialize(HTTPParser.REQUEST, {}, server.maxHeaderSize || 0, lenientFlags, connections);
  parser.socket = socket;
  socket.parser = parser;

  // Propagate headers limit from server instance to parser
  const { maxHeadersCount } = server;
  if (typeof maxHeadersCount === "number") {
    parser.maxHeaderPairs = maxHeadersCount << 1;
  }

  const state: any = {
    onData: null,
    onEnd: null,
    onClose: null,
    onDrain: null,
    outgoing: [],
    incoming: [],
    // About how many bytes the responses in `outgoing` hold. Above the high water mark, the socket and the parser pause.
    outgoingData: 0,
    onPendingData: undefined,
    // Node's parser is an AsyncResource made here, so its callbacks run in this context whatever delivers the bytes.
    frame: AsyncContextFrame.current(),
  };
  state.onData = socketOnData.bind(undefined, server, socket, parser, state);
  state.onEnd = socketOnEnd.bind(undefined, server, socket, parser, state);
  state.onClose = socketOnClose.bind(undefined, socket, state);
  state.onDrain = socketOnDrain.bind(undefined, socket, state);
  socket.on("data", state.onData);
  socket.on("error", socketOnError);
  socket.on("end", state.onEnd);
  socket.on("close", state.onClose);
  socket.on("drain", state.onDrain);
  parser.onIncoming = parserOnIncoming.bind(undefined, server, socket, state);

  socket.on("resume", onSocketResume);
  socket.setEncoding = socketSetEncoding;

  socket._paused = false;
  // Only the event loop feeds a socket that reads a descriptor, so no tick can hand the parser more bytes in the middle of a read.
  parser._consumed = socket._handle?.fd >= 0;
  // Node's parser reads from the handle, so a pause() by the socket's previous owner doesn't stop it.
  socket.resume();
  process.nextTick(readStartAfterAttach, socket);
}

// Nor does a pause() by a 'connection' listener behind ours: in Node the 'resume' event of that call starts the handle's reads. Bytes that were put back may have reached a listener by now, whose pause() stays: 'request' (incoming is set), 'upgrade' or 'connect' (no parser).
function readStartAfterAttach(socket) {
  if (socket.parser?.incoming === null) readStart(socket);
}

function socketSetEncoding(): never {
  throw $ERR_HTTP_SOCKET_ENCODING();
}

function updateOutgoingData(socket, state, delta) {
  state.outgoingData += delta;
  socketOnDrain(socket, state);
}

function socketOnDrain(socket, state) {
  const needPause = state.outgoingData > socket.writableHighWaterMark;

  // If we previously paused, then start reading again.
  if (socket._paused && !needPause) {
    socket._paused = false;
    socket.parser?.resume();
    socket.resume();
  }

  const msg = socket._httpMessage;
  // _flushOutput() calls this through updateOutgoingData() with its bytes still in the socket. Then 'drain' waits for the socket's own.
  if (msg && !msg.finished && msg[kNeedDrain] && msg.writableLength === 0) {
    msg[kNeedDrain] = false;
    msg.emit("drain");
  }
}

function socketOnClose(socket, state) {
  freeParser(socket.parser, null, socket);
  abortIncoming(state.incoming);
  abortOutgoing(state.outgoing);
}

function abortIncoming(incoming) {
  while (incoming.length) {
    const req = incoming.shift();
    req.destroy(new ConnResetException("aborted"));
  }
}

function abortOutgoing(outgoing) {
  // The responses that waited on one connection share one error.
  let error;
  while (outgoing.length) {
    const res = outgoing.shift();
    res[kFailHeldWrites]?.((error ??= $ERR_STREAM_DESTROYED("write")));
    res.destroy(new ConnResetException("aborted"));
  }
}

function socketOnEnd(server, socket, parser, state) {
  const ret = parser.finish();

  if (ret instanceof Error) {
    // socketOnError has additional logic and will call socket.destroy(err).
    socketOnError.$call(socket, ret);
  } else if (!server.httpAllowHalfOpen) {
    socket.end();
  } else {
    const { outgoing } = state;
    const { length } = outgoing;
    if (length) {
      outgoing[length - 1]._last = true;
    } else {
      const { _httpMessage } = socket;
      if (_httpMessage) _httpMessage._last = true;
      else socket.end();
    }
  }
}

function socketOnData(server, socket, parser, state, d) {
  $assert(!socket._paused);
  AsyncContextFrame.run(state.frame, executeParser, undefined, server, socket, parser, state, d);
}

function executeParser(server, socket, parser, state, d) {
  const ret = parser.execute(d);
  onParserExecuteCommon(server, socket, parser, state, ret, d);
}

class UpgradeStream extends Duplex {
  constructor(socket, req) {
    super({
      allowHalfOpen: socket.allowHalfOpen,
    });

    this[kSocket] = socket;
    this[kIncomingMessage] = req;

    // Proxy error, end & closure events immediately.
    socket.on("error", err => this.destroy(err));

    socket.on("close", () => this.destroy());
    this.on("close", () => socket.destroy());

    socket.on("end", () => {
      this.push(null);

      // Like a socket, which emits 'end' with no 'data' listener if it ends with nothing buffered.
      if (this.readableLength === 0) {
        this.resume();
      }
    });
  }

  requestBodyCompleted(upgradeHead) {
    this[kIncomingMessage] = null;

    if (upgradeHead?.length > 0) {
      if (!this.push(upgradeHead)) {
        this[kSocket].pause();
      }
    }

    this[kSocket].on("data", data => {
      if (!this.push(data)) {
        this[kSocket].pause();
      }
    });
  }

  _read(_size) {
    // Otherwise a listener would have to read the whole request body before it could read this stream.
    this[kIncomingMessage]?.resume();

    this[kSocket].resume();
  }

  _final(callback) {
    const socket = this[kSocket];
    // The listener can have ended `req.socket` itself, and end() on a finished socket calls back with an error.
    if (socket.writableEnded) callback();
    else socket.end(callback);
  }

  _write(chunk, encoding, callback) {
    this[kSocket].write(chunk, encoding, callback);
  }

  _destroy(err, callback) {
    this[kSocket].destroy(err);
    callback(err);
  }
}

function onParserExecuteCommon(server, socket, parser, state, ret, d) {
  const req = parser.incoming;
  if (ret instanceof Error) {
    prepareError(ret, parser, d);
    socketOnError.$call(socket, ret);
  } else if (req?.upgrade) {
    // Upgrade or CONNECT
    const eventName = req.method === "CONNECT" ? "connect" : "upgrade";

    let upgradeStream;
    if (req.complete) {
      socket.removeListener("data", state.onData);
      socket.removeListener("end", state.onEnd);
      // The responses that still wait for their turn learn of the close from it.
      if (state.outgoing.length === 0) socket.removeListener("close", state.onClose);
      socket.removeListener("drain", state.onDrain);
      socket.removeListener("error", socketOnError);
      socket.removeListener("timeout", socketOnTimeout);
      socket.removeListener("resume", onSocketResume);

      parser.finish();
      freeParser(parser, req, socket);
      parser = null;

      upgradeStream = socket;
    } else {
      // Already emitted, with the body still arriving.
      if (socket[kUpgradeStream]) return;

      // The wrapper hides what arrives until the request body has ended.
      d = kEmptyBuffer;
      upgradeStream = new UpgradeStream(socket, req);
      socket[kUpgradeStream] = upgradeStream;
    }

    if (server.listenerCount(eventName) > 0) {
      const bodyHead = d.slice(ret, d.length);

      if (req.complete && socket[kUpgradeStream]) {
        // Previously emitted, now completed - just activate the stream
        socket[kUpgradeStream].requestBodyCompleted(bodyHead);
      } else {
        socket.readableFlowing = null;
        server.emit(eventName, req, upgradeStream, bodyHead);
      }
    } else {
      // Got upgrade or CONNECT method, but have no handler.
      socket.destroy();
    }
  } else if (req && req.method === "PRI") {
    socket.destroy();
  }

  if (socket._paused) {
    // onIncoming paused the socket, we should pause the parser as well
    socket.parser?.pause();
  }
}

function clearIncoming(this: any, req?, socket?) {
  req ||= this;
  // stream.pipeline() takes the socket off a request that it destroys.
  const parser = (socket ?? req.socket)?.parser;
  // Reset the .incoming property so that the request object can be gc'ed.
  if (parser && parser.incoming === req) {
    // A destroyed request gets no 'end'. In Node it stays, and its 'timeout' listeners can keep the idle connection open.
    if (req.readableEnded || req.destroyed) {
      parser.incoming = null;
    } else {
      req.on("end", clearIncoming);
    }
  }
}

function resOnFinish(req, res, socket, state, server) {
  // abortIncoming() may have emptied the array.
  $assert(state.incoming.length === 0 || state.incoming[0] === req);

  state.incoming.shift();

  // Nothing read the body, so pull it off the wire.
  if (!req._consuming && !req._readableState.resumeScheduled) req._dump();

  // uWS learns that the response it counted for this request is out. The handle has nothing of its own to write.
  const request = res[kNativeRequest];
  if (request !== undefined && !request.finished) request.end();
  res.detachSocket(socket);
  clearIncoming(req, socket);
  process.nextTick(emitCloseNT, res);

  if (res._last) {
    closeBehindLastWrite(socket);
  } else if (state.outgoing.length === 0) {
    const idleTimeout = keepAliveIdleTimeout(server);
    if (idleTimeout && typeof socket.setTimeout === "function") {
      socket.setTimeout(idleTimeout);
      socket[kKeepAliveTimeoutSet] = true;
    }
  } else {
    sendNextResponse(socket, state);
  }
}

function closeBehindLastWrite(socket) {
  if (typeof socket.destroySoon === "function") {
    socket.destroySoon();
  } else {
    socket.end();
  }
}

const kDispatchThrew = Symbol("kDispatchThrew");

function sendNextResponse(socket, state) {
  const m = state.outgoing.shift();
  // Nothing can fill a destroyed response's slot, so close (Node assigns it).
  if (m === undefined) return;
  if (m[kDispatchThrew] && !m.finished) m.destroy();
  if (m.destroyed) {
    if (typeof socket.destroySoon === "function") socket.destroySoon();
    else socket.destroy();
  } else if (m.handedOff === undefined) giveSocket(m, socket);
  // The turn of a 'connect' that came behind responses. It got the rest of its read as `head`, and the socket got every later read.
  else if (socket[kHandle].startRawResponse(m.handedOff, false) && socket[kHandle].leaveHttp(true))
    socket[kHandle] = undefined;
}

// The request of a response that waited for its turn on a connection that uWS parses.
const kNativeRequest = Symbol("kNativeRequest");

function giveSocket(res, socket) {
  const request = res[kNativeRequest];
  if (request !== undefined && !socket[kHandle]?.startRawResponse(request, !res.shouldKeepAlive))
    return void res.destroy();
  res.assignSocket(socket);
}

// What Node's connection listener keeps for each connection, made for one that uWS parses when its first request arrives early.
const kConnectionState = Symbol("kConnectionState");
function connectionState(socket) {
  let state = socket[kConnectionState];
  if (state === undefined) {
    state = socket[kConnectionState] = { outgoing: [], incoming: [], outgoingData: 0, onPendingData: undefined };
    socket.on("drain", socketOnDrain.bind(undefined, socket, state));
  }
  return state;
}

// Longer than the timeout the response advertised, so a client that uses all of it sees fewer ECONNRESETs. 0 if there is none.
function keepAliveIdleTimeout(server) {
  const { keepAliveTimeout, keepAliveTimeoutBuffer } = server;
  if (!(Number.isFinite(keepAliveTimeout) && keepAliveTimeout > 0)) return 0;
  return (
    keepAliveTimeout +
    (Number.isFinite(keepAliveTimeoutBuffer) && keepAliveTimeoutBuffer >= 0 ? keepAliveTimeoutBuffer : 1e3)
  );
}

function hasBodyHeaders(headers) {
  return "content-length" in headers || "transfer-encoding" in headers;
}

function parserOnIncoming(server, socket, state, req, keepAlive, dispatchBits?) {
  resetSocketTimeout(server, socket);

  if (req.upgrade) {
    req.upgrade = req.method === "CONNECT" || !!server.shouldUpgradeCallback(req);
    if (req.upgrade) {
      return 0;
    }
  }

  state.incoming.push(req);

  // Stop reading while the client doesn't take the responses, or pipelined requests could flood the connection.
  if (!socket._paused) {
    const ws = socket._writableState;
    if (ws.needDrain || state.outgoingData >= socket.writableHighWaterMark) {
      socket._paused = true;
      // onParserExecuteCommon() pauses the parser, once execute() is done with this chunk.
      socket.pause();
    }
  }

  const res = new server[kServerResponse](req, {
    [kHandle]: null,
    highWaterMark: socket.writableHighWaterMark,
    rejectNonStandardBodyWrites: server.rejectNonStandardBodyWrites,
  });
  if (req[kHandle] !== undefined) res[kNativeRequest] = req[kHandle];
  res._keepAliveTimeout = server.keepAliveTimeout;
  res._maxRequestsPerSocket = server.maxRequestsPerSocket;
  res._onPendingData = state.onPendingData ??= updateOutgoingData.bind(undefined, socket, state);

  res.shouldKeepAlive = keepAlive;
  res[kUniqueHeaders] = server[kUniqueHeaders];
  observeRequest(req, res);

  if (server[kOptimizeEmptyRequests] === true && !hasBodyHeaders(req.headers)) {
    req._dumpAndCloseReadable();
    req._read();
  }

  if (socket._httpMessage) {
    // There are already pending outgoing res, append.
    state.outgoing.push(res);
    res[fakeSocketSymbol] = null;
  } else {
    giveSocket(res, socket);
  }

  res.on("finish", resOnFinish.bind(undefined, req, res, socket, state, server));

  let expectation = kNoExpectation;
  if (req.httpVersionMajor === 1 && req.httpVersionMinor === 1) {
    // uWS reported what its request has, so req.headers stays unbuilt until the program reads it.
    if (dispatchBits === undefined) {
      const { host, expect } = req.headers;
      dispatchBits = host === undefined ? 0 : DISPATCH_HAS_HOST;
      if (expect !== undefined) {
        dispatchBits |= continueExpression.test(expect)
          ? DISPATCH_HAS_EXPECT | DISPATCH_EXPECT_CONTINUE
          : DISPATCH_HAS_EXPECT;
      }
    }
    expectation = expectationFromBits(server, res, socket, dispatchBits);
  }
  emitRequest(server, socket, req, res, expectation);

  return 0; // No special treatment.
}

const kNoExpectation = 0;
const kMissingHost = 1;
const kOverRequestsLimit = 2;
const kExpectContinue = 3;
const kExpectOther = 4;

function expectationFromBits(server, res, socket, dispatchBits) {
  if (server.requireHostHeader && (dispatchBits & DISPATCH_HAS_HOST) === 0) return kMissingHost;
  if (isOverRequestsLimit(server, res, socket)) return kOverRequestsLimit;
  if ((dispatchBits & DISPATCH_HAS_EXPECT) === 0) return kNoExpectation;
  return (dispatchBits & DISPATCH_EXPECT_CONTINUE) !== 0 ? kExpectContinue : kExpectOther;
}

// Counts an HTTP/1.1 request against server.maxRequestsPerSocket.
function isOverRequestsLimit(server, res, socket) {
  const { maxRequestsPerSocket } = server;
  if (typeof maxRequestsPerSocket !== "number" || maxRequestsPerSocket <= 0) return false;
  const requestsCount = (socket.requestsCount = (socket.requestsCount | 0) + 1);
  res._maxRequestsPerSocket = maxRequestsPerSocket;
  res.maxRequestsOnConnectionReached = maxRequestsPerSocket <= requestsCount;
  return maxRequestsPerSocket < requestsCount;
}

// How Node's parserOnIncoming answers or announces a request, for both parsers.
function emitRequest(server, socket, req, res, expectation) {
  switch (expectation) {
    case kNoExpectation:
      server.emit("request", req, res);
      break;
    case kMissingHost:
      res.writeHead(400, ["Connection", "close"]);
      res.end();
      break;
    case kOverRequestsLimit:
      server.emit("dropRequest", req, socket);
      res.writeHead(503);
      res.end();
      break;
    case kExpectContinue:
      res._expect_continue = true;
      if (server.listenerCount("checkContinue") > 0) {
        server.emit("checkContinue", req, res);
      } else {
        res.writeContinue();
        server.emit("request", req, res);
      }
      break;
    default:
      if (server.listenerCount("checkExpectation") > 0) {
        server.emit("checkExpectation", req, res);
      } else {
        res.writeHead(417);
        res.end();
      }
  }
}

// Node's parserOnMessageComplete: a message without a body is complete once the listener returns, and the reads go on unless http paused them. EOF stays lazy (_read).
function completeWithoutBody(req, socket) {
  req.complete = true;
  if (!socket._paused && socket.readable && socket.isPaused()) socket.resume();
}

function resetSocketTimeout(server, socket) {
  if (!socket[kKeepAliveTimeoutSet]) return;

  socket.setTimeout(server.timeout || 0);
  socket[kKeepAliveTimeoutSet] = false;
}

function onSocketResume(this: any) {
  // 'resume' is emitted a tick after the call, and parserOnIncoming() may have paused the socket since.
  if (this._paused) this.pause();
}

function onSocketTimeoutTimerExpired(this: any) {
  const socket = this;
  // The keep-alive idle timer stays armed across requests. A fire while a request is in flight is stale: re-arm and bail.
  if (socket.timeout === 0 && !socket[kKeepAliveTimeoutSet]) {
    socket[kTimeout]?.refresh();
    return;
  }
  // Like Node, the deadline is one full timeout after the last write, which can be later than this timer was armed for.
  const lastWrite = socket[kLastResponseWrite];
  if (lastWrite !== undefined) {
    socket[kLastResponseWrite] = undefined;
    const timer = socket[kTimeout];
    if (timer != null && lastWrite > timer._idleStart) {
      timer.refresh();
      timer._idleStart = lastWrite;
      return;
    }
  }
  NetSocket.prototype._onTimeout.$call(socket);
}

let NetSocket;
let TLSSocket;
let assignablePeerAddress;
function loadNet(tls) {
  if (NetSocket === undefined) {
    NetSocket = require("node:net").Socket;
    assignablePeerAddress = {};
    for (const name of ["remoteAddress", "remotePort", "remoteFamily"]) {
      assignablePeerAddress[name] = {
        configurable: true,
        get: Object.getOwnPropertyDescriptor(NetSocket.prototype, name)!.get,
        set(value) {
          Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: true });
        },
      };
    }
  }
  if (tls) TLSSocket ??= require("node:tls").TLSSocket;
}

function attachConnection(server: Server, socket, http) {
  socket[kHandle] = http;
  http.duplex = socket;
  http.onclose = onConnectionClosed;
  if (socket.encrypted) {
    // The native SNI dispatch asks the object in the handle's `data`, which is this socket.
    socket._SNICallback = server[tlsSymbol]?._SNICallback;
    socket.resetAndDestroy = resetAndDestroyNotTCP;
  } else {
    if (server[kListenerGeneration]?.isUnix) socket.resetAndDestroy = resetAndDestroyNotTCP;
    nativeConnectionListener(server, socket);
  }
}

// https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L826-L829
function resetAndDestroyNotTCP(): never {
  throw $ERR_INVALID_HANDLE_TYPE();
}

// Node's connectionListenerInternal, for a connection that uWS parses.
function nativeConnectionListener(server: Server, socket) {
  server[kTrackedConnections].add(socket);
  // Keep a shorter timeout that a 'connection' listener armed. It may have fired during the handshake, so restart it.
  const serverTimeout = server.timeout;
  if (serverTimeout && !(socket.timeout > 0 && socket.timeout < serverTimeout)) socket.setTimeout(serverTimeout);
  else socket._unrefTimer();
  socket.on("timeout", socketOnTimeout);
  socket.parser = createServerParserShim(socket);
  socket.on("error", socketOnError);
  socket.on("close", nativeSocketOnClose);
  socket.on("end", nativeSocketOnEnd);
  // uWS reads for the parser. The listener keeps the socket flowing like Node's, so that 'end' comes at the peer's FIN.
  socket.on("data", noopOnData);
  socket.on("resume", nativeSocketOnResume);
  socket.on("pause", onSocketPause);
  socket.on = socketOn;
  socket.addListener = socketOn;
  socket.prependListener = socketPrependListener;
  socket.setEncoding = socketSetEncoding;
  socket._onTimeout = onSocketTimeoutTimerExpired;
  socket._final = nativeSocketFinal;
  socket._destroy = nativeSocketDestroy;
  socket._paused = false;
  // In Node an assignment to one of these throws in strict mode. Here a server's socket has always kept the value.
  Object.defineProperties(socket, assignablePeerAddress);
}

// https://github.com/nodejs/node/blob/v26.5.0/lib/_http_server.js#L1432-L1448
function socketOn(this: any, event, listener) {
  const result = NetSocket.prototype.on.$call(this, event, listener);
  if (event === "data" || event === "readable") unconsume(this);
  return result;
}
function socketPrependListener(this: any, event, listener) {
  const result = NetSocket.prototype.prependListener.$call(this, event, listener);
  if (event === "data" || event === "readable") unconsume(this);
  return result;
}
function noopOnData() {}
// From here on the socket gets every read before the HTTP parser does, like Node's parser.unconsume().
function unconsume(socket) {
  const parser = socket.parser;
  if (parser == null || !parser._consumed) return;
  parser._consumed = false;
  socket.removeListener("pause", onSocketPause);
  socket.removeListener("resume", nativeSocketOnResume);
  // Gone once uWS has closed the connection, which is before the socket's 'close'.
  socket[kHandle]?.setRawReads(true);
}

function nativeSocketOnResume(this: any) {
  if (this._paused) {
    this.pause();
    return;
  }
  this._handle?.resume();
}
function onSocketPause(this: any) {
  this._handle?.pause();
}

// Without net.Socket's tick: what the response writes after socket.end() is dropped, as in Node, where both share the socket's Writable.
function nativeSocketFinal(this: any, callback) {
  this._handle?.shutdown();
  callback();
}

// net.Socket queues 'close' from here. Node's comes from the handle, so it doesn't run in the AsyncLocalStorage store of the request whose end closes the connection.
function nativeSocketDestroy(this: any, err, callback) {
  AsyncContextFrame.run(AsyncContextFrame.currentGraphFrame(), NetSocket.prototype._destroy, this, err, callback);
}

// Node's socketOnEnd. What becomes of the connection after a clean end is uWS's decision, right behind this.
function nativeSocketOnEnd(this: any) {
  if (!this[kHandle]?.finishParsing()) return;
  const err: any = $HPE_INVALID_EOF_STATE("Parse Error: Invalid EOF state");
  err.reason = "Invalid EOF state";
  err.rawPacket = kEmptyBuffer;
  socketOnError.$call(this, err);
}

// uWS closed the connection. A response's writes don't pass through the socket's Writable, so they fail here, where Node's destroy() fails them.
function onConnectionClosed(this: any, left) {
  const http = this;
  const socket = left ?? http.duplex;
  if (socket[kHandle] !== http) return;
  socket[kHandle] = undefined;
  if (left !== undefined) {
    // Not closed: the body of an accepted Upgrade request has ended, and the connection is the socket's from here on.
    socket.removeListener("end", socket.end);
    const req = socket[kUpgradeRequest];
    if (req !== undefined) {
      socket[kUpgradeRequest] = undefined;
      emitUpgrade(socket, req, true);
    }
    return;
  }
  socket.server[kTrackedConnections].delete(socket);
  const pending = socket[kDetachedWhileClosing];
  const message = socket._httpMessage ?? (pending?.destroyed ? pending : undefined);
  if (message) {
    failPendingWriteCallbacks(message, socket.errored ?? $ERR_STREAM_DESTROYED("write"));
    // An ended response that was still draining finishes first, like Node.js's failed last write: its request is not aborted.
    if (message[kPendingFinish] !== undefined) {
      flushPendingFinish.$call(message);
      socket[kFinishedAtClose] = message;
    }
  }
  if (socket.destroyed || http.closeError) {
    // The handle's own close, right behind this, reports the error.
  } else if (!http.peerEnded) {
    // This side closed it, so there's no EOF to report.
    socket.destroy();
  } else if (socket.readableEnded) {
    // Node's socketOnEnd. net.Socket leaves a half-open socket whose peer is gone to its owner.
    socket.end();
  } else if (socket.readableFlowing) {
    socket.once("end", socket.end);
  } else {
    // Nobody reads the EOF, and the connection is gone.
    socket.destroy();
  }
  // Handed to 'connect' behind responses that were still owed: its 'close' listener went with the hand-off.
  if (socket[kHandedOff]) nativeSocketOnClose.$call(socket);
}
const kFinishedAtClose = Symbol("kFinishedAtClose");

// Node's socketOnClose: free the parser, abort what is in flight and what is queued.
function nativeSocketOnClose(this: any) {
  const socket = this;
  releaseServerParserShim(socket);
  const pending = socket[kDetachedWhileClosing];
  socket[kDetachedWhileClosing] = undefined;
  const message = socket._httpMessage ?? (pending?.destroyed ? pending : undefined);
  const req = message != null && socket[kFinishedAtClose] !== message ? message.req : undefined;
  if (req && !req.destroyed) {
    req[kHandle] = undefined;
    if (req.listenerCount("error") > 0) {
      req.destroy(new ConnResetException("aborted"));
    } else {
      req.destroy();
    }
  }
  if (message && !message._closed) emitCloseNT(message);
  const state = socket[kConnectionState];
  if (state !== undefined) {
    abortIncoming(state.incoming);
    abortOutgoing(state.outgoing);
  }
}
const kDetachedWhileClosing = Symbol("kDetachedWhileClosing");

// The close of a TLS handle waits for ciphertext that write() reported and a stalled peer does not take, but only once.
function destroyNow(socket) {
  const http = socket[kHandle];
  socket.destroy();
  if (!http || http.closed) return;
  http.close();
  // In the middle of its own request a handle only takes note, and closes behind it, for the first time.
  if (!http.closed) setImmediate(closeHandle, http);
}

// Node validates the `Trailer` header inside _storeHeader, after the body framing has
// been decided, so `this.chunkedEncoding` is already set. Bun frames the body in uWS
// and never sets `response.chunkedEncoding`, so reproduce Node's decision here.
function willBeChunked(response) {
  // kOutHeaders is a null-proto map of lowercased name -> [name, value];
  // index it directly instead of paying hasHeader/getHeader (each of which
  // re-reads the symbol and lowercases its argument) per check.
  const outHeaders = response[kOutHeaders];
  const te = outHeaders !== null ? outHeaders["transfer-encoding"] : undefined;
  if (te !== undefined) {
    return chunkExpression.test(String(te[1]));
  }
  if (outHeaders !== null && outHeaders["content-length"] !== undefined) return false;
  if (response._hasBody === false) return false;
  if (response._removedTE) return false;
  return response.useChunkedEncodingByDefault === true;
}

// Returns true if _storeHeader() will frame the body with neither a length nor chunks, so that it ends where the connection does (RFC 9112 6.3).
function bodyEndsAtClose(response) {
  if (response._hasBody === false) return false;
  const outHeaders = response[kOutHeaders];
  if (outHeaders !== null) {
    if (outHeaders["content-length"] !== undefined) return false;
    const te = outHeaders["transfer-encoding"];
    if (te !== undefined) return !chunkExpression.test(String(te[1]));
    if (outHeaders["trailer"] !== undefined) return response._removedTE;
  }
  return response._removedTE && (response._removedContLen || typeof response._contentLength !== "number");
}

// A non-chunked message is terminated by the first empty line after the header
// fields, so it can carry neither a body nor trailers.
function hasInvalidTrailer(response) {
  if (willBeChunked(response)) return false;
  const outHeaders = response[kOutHeaders];
  return outHeaders !== null && outHeaders["trailer"] !== undefined;
}

function validateStatusCode(statusCode) {
  const originalStatusCode = statusCode;
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(require("internal/util/inspect").format("%s", originalStatusCode));
  }
  return statusCode;
}

// What Node's _implicitHeader() checks and derives. write() and end() send the head without a writeHead() call.
function validateImplicitHead(response) {
  const statusCode = (response.statusCode = validateStatusCode(response.statusCode));
  const statusMessage = response.statusMessage;
  if (statusMessage !== undefined && checkInvalidHeaderChar(statusMessage)) throw $ERR_INVALID_CHAR("statusMessage");
  updateHasBody(response, statusCode);
}

// Node renders the head inside writeHead(). Copy the caller's array so later changes to it, and appendHeader()'s push, never reach the wire.
function snapshotHeaderValue(value) {
  if (!$isArray(value)) return value;
  const length = value.length;
  const copy = $newArrayWithSize(length);
  for (let i = 0; i < length; i++) $putByValDirect(copy, i, value[i]);
  return copy;
}

// `explicit`: the program called writeHead(). write() and end() send a `Trailer` header as it is, whatever the request's method or version.
function _writeHead(statusCode, reason, obj, response, explicit) {
  statusCode = validateStatusCode(statusCode);

  if (typeof reason === "string") {
    // writeHead(statusCode, reasonPhrase[, headers])
    response.statusMessage = reason;
  } else {
    // writeHead(statusCode[, headers])
    if (!response.statusMessage) response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj ??= reason;
  }
  if (checkInvalidHeaderChar(response.statusMessage)) throw $ERR_INVALID_CHAR("statusMessage");

  response.statusCode = statusCode;
  // Before the Trailer checks below, like Node's writeHead: a 204/304/1xx status
  // clears _hasBody, and a body-less message can never carry trailers.
  updateHasBody(response, statusCode);

  {
    // Slow-case: when progressive API and header fields are passed.
    let k;

    if ($isArray(obj)) {
      const length = obj.length;
      // Append all the headers provided in the array:
      if (length && $isArray(obj[0])) {
        for (let i = 0; i < length; i++) {
          const k = obj[i];
          if (k) response.appendHeader(k[0], snapshotHeaderValue(k[1]));
        }
      } else {
        if (length % 2 !== 0) {
          throw $ERR_INVALID_ARG_VALUE("headers", obj);
        }
        // Test non-chunked message does not have trailer header set,
        // message will be terminated by the first empty line after the
        // header fields, regardless of the header fields present in the
        // message, and thus cannot contain a message body or 'trailers'.
        if (hasInvalidTrailer(response)) {
          throw $ERR_HTTP_TRAILER_INVALID();
        }
        // Headers in obj should override previous headers but still
        // allow explicit duplicates. To do so, we first remove any
        // existing conflicts, then use appendHeader.

        for (let n = 0; n < length; n += 2) {
          k = obj[n + 0];
          response.removeHeader(k);
        }

        for (let n = 0; n < length; n += 2) {
          k = obj[n];
          if (k) response.appendHeader(k, snapshotHeaderValue(obj[n + 1]));
        }
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      const length = keys.length;
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < length; i++) {
        k = keys[i];
        if (k) response.setHeader(k, snapshotHeaderValue(obj[k]));
      }
    }
    if (explicit && hasInvalidTrailer(response)) {
      // The message is not chunk-framed, so `Trailer` is the offending header; drop it
      // so a caller that swallows the throw cannot put it on the wire.
      response.removeHeader("trailer");
      throw $ERR_HTTP_TRAILER_INVALID();
    }
  }
}

function ServerResponse(req, options): void {
  if (!(this instanceof ServerResponse)) return new ServerResponse(req, options);
  OutgoingMessage.$call(this, options);

  this.req = req;
  this.sendDate = true;
  this._sent100 = false;
  this[kPendingCallbacks] = [];

  // this is matching node's behaviour
  // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
  if (req.method === "HEAD") this._hasBody = false;

  if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
    this.useChunkedEncodingByDefault = chunkExpression.test(req.headers?.te ?? "");
    this.shouldKeepAlive = false;
  }

  // The native response of a request that 'upgrade' or 'connect' handed over is done. This one writes to the socket it's assigned, like in Node.
  let handle = options?.[kHandle];
  if (handle === undefined && (handle = req[kHandle]) && handle.flags & NodeHTTPResponseFlags.closed_or_completed) {
    handle = undefined;
  }
  this[kHandle] = handle;

  this.statusCode = 200;
  this.statusMessage = undefined;
}
$toClass(ServerResponse, "ServerResponse", OutgoingMessage);
// A response whose own statusCode was deleted sends 200, as in Node.js.
ServerResponse.prototype.statusCode = 200;
// A connection that closes under the ended response it carries completes it. Node 26.12 emits no 'finish' and fails the end() callback.
ServerResponse.prototype[kFinishesWithoutLastWrite] = true;

// ServerResponse stores its outgoing headers the same way Node.js does (the
// kOutHeaders map inherited from OutgoingMessage). Right before the headers
// are handed to the native response handle they are rendered into a flat
// [name, value, name, value, ...] array so that array values / repeated
// header names become separate header lines on the wire, exactly like
// Node.js's _storeHeader().
//
// Node.js's server also adds Date, Connection and Keep-Alive response headers
// by default (unless the user set/removed them, or res.sendDate is false);
// the native handle does not, so they are appended to the rendered array.
// Like Node.js's _storeHeader(), the defaults never touch kOutHeaders, so
// getHeaders()/getHeaderNames()/hasHeader() keep reporting only the headers
// the user actually set, even after the headers have been flushed.
// Reusable backing array for renderNativeHeaders. The native writeHead
// consumes the array synchronously, so it can be reused across requests;
// the busy flag covers re-entrancy (a user toString() on a header value
// dispatching another response) and exception paths by degrading to a
// fresh array, which is exactly the previous behavior.
const scratchFlatHeaders: string[] = [];
let scratchFlatHeadersBusy = false;

function releaseRenderedHeaders(flat) {
  if (flat === scratchFlatHeaders) scratchFlatHeadersBusy = false;
}

// Auto-header bits (kAutoHeader* in src/jsc/bindings/NodeHTTP.cpp - keep in
// sync): renderNativeHeaders reports the framework headers (Date, Connection,
// Keep-Alive) through these instead of pushing strings into the flat array;
// the native side writes them from cached byte blobs.
const AUTO_HEADER_DATE = 1 << 0;
const AUTO_HEADER_CONN_KEEP_ALIVE = 1 << 1;
const AUTO_HEADER_CONN_CLOSE = 1 << 2;
const AUTO_HEADER_KEEP_ALIVE_TIMEOUT = 1 << 3;
// Node's _storeHeader writes the chunked Transfer-Encoding after the Connection
// line, so it is rendered natively with the other auto headers rather than being
// pushed into the flat array (which goes out first).
const AUTO_HEADER_TRANSFER_ENCODING_CHUNKED = 1 << 4;
// Bits 5 and 6, no header line: how the body is framed. 0 leaves it to the native side (Content-Length, or end() against write()).
const AUTO_HEADER_BODY_CHUNKED = 1 << 5;
const AUTO_HEADER_BODY_UNTIL_CLOSE = 2 << 5;
const AUTO_HEADER_BODY_NONE = 3 << 5;
// The largest Keep-Alive timeout, in seconds, handed to the native writeHead (it takes a uint32).
const kMaxNativeKeepAliveSecs = 0x7fffffff;
// Out-parameters of renderNativeHeaders, read by its callers in the same
// tick (no JS can run in between).
let renderedAutoHeaders = 0;
let renderedKeepAliveSecs = 0;

function renderNativeHeaders(res) {
  // Computed in locals and published to the module out-params only at
  // return: String(value) below can run user toString() code that
  // re-enters this function, and |= on the shared slots would merge the
  // nested render's bits into ours.
  let autoHeaders = 0;
  let keepAliveSecs = 0;
  const headersMap = res[kOutHeaders];
  let flat: string[];
  if (scratchFlatHeadersBusy) {
    flat = [];
  } else {
    scratchFlatHeadersBusy = true;
    scratchFlatHeaders.length = 0;
    flat = scratchFlatHeaders;
  }
  let hasDate = false;
  let hasConnection = false;
  let hasKeepAlive = false;
  try {
    if (headersMap !== null && headersMap !== undefined) {
      for (const key in headersMap) {
        const entry = headersMap[key];
        const name = entry[0];
        const value = entry[1];
        if (key === "date") hasDate = true;
        else if (key === "connection") {
          hasConnection = true;
          // An explicit `Connection: close` response header must also close the
          // transport after 'finish' (Node.js's matchHeader sets _last, then
          // resOnFinish destroys the socket).
          if (RE_CONN_CLOSE.test($isArray(value) ? value.join(", ") : String(value))) {
            res._last = true;
          }
        } else if (key === "keep-alive") hasKeepAlive = true;
        if ($isArray(value)) {
          const valueLength = value.length;
          // Like Node's _storeHeader: array values become one line each, except
          // "cookie" and headers listed in the uniqueHeaders option, which are
          // sent as a single line joined with "; ".
          // res[kUniqueHeaders] is only consulted for multi-valued headers, so
          // read it here rather than once per render: it is a prototype-chain
          // miss for every response whose server did not set `uniqueHeaders`.
          if (
            valueLength >= 2 &&
            (key === "cookie" || (res[kUniqueHeaders] != null && res[kUniqueHeaders].$has(key)))
          ) {
            flat.push(name, value.join("; "));
          } else {
            for (let i = 0; i < valueLength; i++) {
              flat.push(name, String(value[i]));
            }
          }
        } else {
          flat.push(name, String(value));
        }
      }
    }

    if (res.sendDate && !hasDate) {
      autoHeaders |= AUTO_HEADER_DATE;
    }

    // RFC 2616 mandates that 204 and 304 responses MUST NOT have a body. A
    // chunked Transfer-Encoding on such a response could confuse reverse
    // proxies, so like Node.js the body framing is suppressed and the
    // connection is forcibly closed after the response.
    // headersMap already holds res[kOutHeaders]; index the two framing headers
    // once instead of re-reading the symbol per check below.
    const storedTransferEncoding = headersMap === null ? undefined : headersMap["transfer-encoding"];
    const storedContentLength = headersMap === null ? undefined : headersMap["content-length"];
    let defectiveNoBodyResponse = false;
    if (storedTransferEncoding !== undefined) {
      const statusCode = res[kSnapshotStatusCode] ?? res.statusCode;
      if (statusCode === 204 || statusCode === 304) {
        defectiveNoBodyResponse = true;
        res._last = true;
      }
    }

    // Like Node.js's _storeHeader: with no framing headers on the wire, removing
    // Transfer-Encoding makes the response close-delimited (the "both removed"
    // _last branch), while removing only Content-Length falls through to chunked
    // encoding and keeps the connection alive. Decide before the Connection
    // header is rendered so the advertised value matches the transport.
    let closeDelimited = false;
    let forceChunked = false;
    // False for HTTP/1.0 (set by the constructor) or when the user cleared it.
    const chunkedByDefault = !!res.useChunkedEncodingByDefault;
    // Node's shouldSendKeepAlive: without chunked encoding only an explicit Content-Length lets the connection persist.
    const canPersist = chunkedByDefault || storedContentLength !== undefined;
    if (storedContentLength === undefined && storedTransferEncoding === undefined) {
      if (res._hasBody === false) {
        // HEAD / 204 / 304 / 1xx: there is no body to delimit, so removing the
        // framing headers must not close the connection (Node's _storeHeader
        // checks !_hasBody before its close-delimited else-branch).
      } else if (!chunkedByDefault) {
        // Node's _storeHeader sets _last when useChunkedEncodingByDefault is false: no framing header, the body runs until the connection closes.
        closeDelimited = true;
        res._last = true;
      } else if (res._removedTE) {
        closeDelimited = true;
        res._last = true;
      } else if (res._removedContLen || res[kFramingFrozenChunked]) {
        // Node's _storeHeader falls through to chunked here. The native writer never chunk-frames HTTP/1.0, so that stays close-delimited.
        const req = res.req;
        if (req.httpVersionMajor >= 1 && req.httpVersionMinor >= 1) {
          forceChunked = true;
        } else {
          closeDelimited = true;
          res._last = true;
        }
      }
    } else if (storedTransferEncoding !== undefined && res._hasBody !== false) {
      // Node's matchHeader frames the body by the Transfer-Encoding value.
      if (chunkExpression.test(String(storedTransferEncoding[1]))) {
        autoHeaders |= AUTO_HEADER_BODY_CHUNKED;
      } else if (storedContentLength === undefined) {
        // Node sends this body raw on a keep-alive connection, so the client can't tell where it ends. Close instead (RFC 9112 6.3).
        closeDelimited = true;
        res._last = true;
      }
    }

    // Node's writeHead(): the client may never send the body, so a final response with no 100 Continue closes the connection.
    if (res._expect_continue && !res._sent100 && !hasConnection) res.shouldKeepAlive = false;

    if (res._removedConnection) {
      // Node's _storeHeader: `this._last = !this.shouldKeepAlive` - no
      // Connection header is written (the user removed it), but the socket
      // still closes after 'finish' when shouldKeepAlive was cleared.
      if (res.shouldKeepAlive === false) {
        res._last = true;
      }
    } else if (!hasConnection) {
      if (
        !defectiveNoBodyResponse &&
        !closeDelimited &&
        canPersist &&
        !res.maxRequestsOnConnectionReached &&
        res.shouldKeepAlive !== false &&
        requestShouldKeepAlive(res.req)
      ) {
        const keepAliveTimeout = res._keepAliveTimeout;
        const maxRequestsPerSocket = res._maxRequestsPerSocket;
        if (keepAliveTimeout && !hasKeepAlive) {
          const timeoutSecs = MathFloor(keepAliveTimeout / 1000);
          const hasMax = ~~maxRequestsPerSocket > 0;
          if (!hasMax && timeoutSecs >= 0 && timeoutSecs <= kMaxNativeKeepAliveSecs) {
            autoHeaders |= AUTO_HEADER_CONN_KEEP_ALIVE | AUTO_HEADER_KEEP_ALIVE_TIMEOUT;
            keepAliveSecs = timeoutSecs;
          } else {
            // Rare path (maxRequestsPerSocket set, or seconds the native side cannot take): render both lines in JS, as Node prints them.
            flat.push("Connection", "keep-alive");
            flat.push(
              "Keep-Alive",
              hasMax ? `timeout=${timeoutSecs}, max=${maxRequestsPerSocket}` : `timeout=${timeoutSecs}`,
            );
          }
        } else {
          autoHeaders |= AUTO_HEADER_CONN_KEEP_ALIVE;
        }
      } else {
        // Like Node's shouldSendKeepAlive/_last handling: a user-cleared
        // shouldKeepAlive (graceful-shutdown helpers set it on in-flight
        // responses) must also end the socket after 'finish'.
        if (res.shouldKeepAlive === false || !canPersist) {
          res._last = true;
        }
        autoHeaders |= AUTO_HEADER_CONN_CLOSE;
      }
    }

    if (res._hasBody === false) {
      // HEAD, 204, 304, 1xx. The framing headers the user set are still sent, but the response ends at the first empty line (RFC 9112 6.3).
      autoHeaders |= AUTO_HEADER_BODY_NONE;
    } else if (closeDelimited) {
      autoHeaders |= AUTO_HEADER_BODY_UNTIL_CLOSE;
    } else if (forceChunked) {
      autoHeaders |= AUTO_HEADER_TRANSFER_ENCODING_CHUNKED | AUTO_HEADER_BODY_CHUNKED;
    }
  } catch (e) {
    // String(value) above can run user toString() that throws; release the
    // scratch array so the next render is not forced onto fresh arrays for
    // the process lifetime.
    if (flat === scratchFlatHeaders) scratchFlatHeadersBusy = false;
    throw e;
  }
  renderedAutoHeaders = autoHeaders;
  renderedKeepAliveSecs = keepAliveSecs;
  return flat;
}

function stopServerResponsePerf(this: any) {
  if (this[kServerResponseStatistics] && hasObserver("http")) {
    stopPerf(this, kServerResponseStatistics, {
      detail: {
        res: {
          statusCode: this.statusCode,
          statusMessage: this.statusMessage,
          headers: typeof this.getHeaders === "function" ? this.getHeaders() : {},
        },
      },
    });
  }
}

// Node.js's resOnFinish as one shared listener: connection handling (close or
// arm keep-alive) runs first because onResponseFinishHandleSocket's guards
// read pre-detach state, then detach the socket and advance the pipeline.
function emitResponseFinish() {
  const req = this.req;
  // Node's resOnFinish: dump a body that nobody consumed or resumed.
  if (req && !req._consuming && !req._readableState?.resumeScheduled) {
    req._dump();
  }
  // req.socket is nulled by the stream destroyer (pipeline/compose cleanup);
  // the response's own socket (set by assignSocket, cleared only by
  // detachSocket) still references the connection then.
  const detachedFrom = this[kDetachedFrom];
  const socket = detachedFrom ?? this.req?.socket ?? this.socket;
  // Node's clearIncoming: a request that ended before its response did, or that gets no EOF. Any other one is cleared at its EOF.
  const parser = socket?.parser;
  if (parser != null && parser.incoming === req && (req.readableEnded || req.destroyed)) parser.incoming = null;
  onResponseFinishHandleSocket(socket?.server, socket, this);
  // The dispatcher detached a synchronously-finished response itself;
  // sending the next response again here would skip one.
  if (detachedFrom !== undefined) return;
  if (socket != null) this.detachSocket(socket);
  sendNextResponseIfAny(socket);
}

// After a response that the native handle wrote.
function sendNextResponseIfAny(socket) {
  const state = socket?.[kConnectionState];
  if (state !== undefined && !socket.writableEnded && !socket.destroyed) sendNextResponse(socket, state);
}

function sendNextResponseIfIdle(socket) {
  if (socket._httpMessage == null) sendNextResponseIfAny(socket);
}

// Holds the turn of a request that has no response. If none comes, nothing can be sent in its place.
const kNoResponse = { destroyed: true, destroy() {} };

// Runs when a response has finished, like the transport-related half of
// Node.js's resOnFinish: either end the connection (responses that must
// close) or arm the keep-alive idle timeout so an idle kept-alive connection
// is eventually closed.
function onResponseFinishHandleSocket(server, socket, res) {
  if (res._last) {
    socket?.destroySoon();
    return;
  }
  if (!socket || socket.destroyed) {
    return;
  }
  // Another response is already in flight on this connection (pipelining):
  // it is not idle, so leave its timeout alone.
  if (socket._httpMessage && socket._httpMessage !== res) {
    return;
  }
  // Pipelined responses are still queued behind this one: the connection is
  // not idle, so do not arm the keep-alive idle timeout yet.
  if (socket[kConnectionState]?.outgoing.length) {
    return;
  }
  const total = keepAliveIdleTimeout(server);
  if (total) {
    // Rescheduling the socket timer on every response finish was the single
    // largest per-request cost of the keep-alive path. Once the timer is
    // armed with this exact interval (every response after the first on a
    // kept-alive connection), leave it in place and only record when this
    // idle period started; onSocketTimeoutTimerExpired grants the remaining
    // budget if the timer fires early, so the socket still closes after
    // exactly `total` ms of idle.
    socket[kLastResponseWrite] = timerClockMs();
    const timer = socket[kTimeout];
    if (timer != null && !timer._destroyed && timer._idleTimeout === total) {
      socket.timeout = total;
    } else {
      socket.setTimeout(total);
    }
    socket[kKeepAliveTimeoutSet] = true;
  }
}

// Node.js's socketOnClose frees the parser, which aborts parsing of any
// pipelined requests still sitting in the current buffer - even when 'close'
// was emitted manually by user code.
function onSocketCloseStopParsing(this: any) {
  this[kHandle]?.stopParsing?.();
}

function markResponseEndedNT(res) {
  res._ended = true;
}

// Native dispatch bitfield: presence/token bits for the request headers the
// dispatcher consults, computed in one native pass over the raw headers
// (kDispatch* in src/jsc/bindings/NodeHTTP.cpp - keep in sync). This is what
// lets the framework never materialize req.headers/req.rawHeaders unless
// user code reads them.
const DISPATCH_CONN_CLOSE = 1 << 0;
const DISPATCH_CONN_UPGRADE = 1 << 1;
const DISPATCH_HAS_UPGRADE = 1 << 2;
const DISPATCH_HAS_HOST = 1 << 3;
const DISPATCH_HAS_EXPECT = 1 << 4;
const DISPATCH_EXPECT_CONTINUE = 1 << 5;
const DISPATCH_HAS_CONTENT_LENGTH = 1 << 6;
const DISPATCH_HAS_TRANSFER_ENCODING = 1 << 7;

// Whether the response should advertise a persistent connection.
// `connection` is the request's Connection header value (or undefined).
function shouldKeepAliveForConnection(req, connection) {
  if (!req) return true;
  if (req.httpVersionMajor === 1 && req.httpVersionMinor === 0) {
    // The native server always closes HTTP/1.0 connections after the
    // response, even when the request asked for keep-alive, so the response
    // must advertise Connection: close to stay consistent with the transport.
    // (Node.js answers Connection: close here too whenever it cannot frame
    // the response without closing, which is the common case for HTTP/1.0.)
    return false;
  }
  return !(typeof connection === "string" && RE_CONN_CLOSE.test(connection));
}

// shouldKeepAliveForConnection(), computed once at dispatch: reading req.headers again would materialize the lazy header object.

function requestShouldKeepAlive(req) {
  if (!req) return true;
  const cached = req[kReqShouldKeepAlive];
  if (cached !== undefined) return cached;
  return (req[kReqShouldKeepAlive] = shouldKeepAliveForConnection(req, req.headers.connection));
}

// res.headers / res.headers= are Bun-specific conveniences kept for backwards
// compatibility; they are views over the Node.js-style header storage.
Object.defineProperty(ServerResponse.prototype, "headers", {
  get() {
    return this.getHeaders();
  },
  set(value) {
    if (this._header) throw $ERR_HTTP_HEADERS_SENT("set");
    this[kOutHeaders] = null;
    if (!value) return;
    if ($isArray(value)) {
      // Array of [name, value] pairs, like the WHATWG Headers sequence init.
      for (const { 0: key, 1: val } of value) {
        this.appendHeader(key, snapshotHeaderValue(val));
      }
    } else if (typeof value.entries === "function") {
      for (const { 0: key, 1: val } of value.entries()) {
        this.appendHeader(key, snapshotHeaderValue(val));
      }
    } else {
      const keys = ObjectKeys(value);
      for (let i = 0; i < keys.length; i++) {
        this.setHeader(keys[i], value[keys[i]]);
      }
    }
  },
});

Object.defineProperty(ServerResponse.prototype, "socket", {
  get() {
    // null while the response is queued behind a pipelined one, like Node.js.
    const socket = this[fakeSocketSymbol];
    return socket !== undefined ? socket : (this[fakeSocketSymbol] = new FakeSocket(this));
  },
  set(value) {
    this[fakeSocketSymbol] = value ?? undefined;
    outgoingSocketSetter.$call(this, value);
  },
});

Object.defineProperty(ServerResponse.prototype, "connection", {
  get() {
    return this.socket;
  },
  set(value) {
    this.socket = value;
  },
});

Object.defineProperty(ServerResponse.prototype, "writableCorked", {
  get() {
    if (!this[kHandle]) return outgoingWritableCorked!.$call(this);
    return this.socket?.writableCorked ?? 0;
  },
  set(_value) {},
});

ServerResponse.prototype.cork = function cork() {
  if (!this[kHandle]) return OutgoingMessagePrototype.cork.$call(this);
  this.socket?.cork();
};

ServerResponse.prototype.uncork = function uncork() {
  if (!this[kHandle]) return OutgoingMessagePrototype.uncork.$call(this);
  this.socket?.uncork();
};

ServerResponse.prototype._ended = false;

// The end() callback (or null) while the body end() buffered is still draining.
const kPendingFinish = Symbol("kPendingFinish");
ServerResponse.prototype[kPendingFinish] = undefined;

ServerResponse.prototype._writeRaw = function (chunk, encoding, callback) {
  if (!this[kHandle]) {
    // Standalone path: OutgoingMessage._writeRaw buffers to outputData while
    // no socket is assigned yet (kSocket is null) and flushes the buffer
    // ahead of the chunk once one is - writing through the auto-creating
    // `socket` getter here would drop the bytes into a FakeSocket.
    return OutgoingMessagePrototype._writeRaw.$apply(this, arguments);
  }
  // Write through the response handle's AsyncSocket buffer (same path as
  // writeHead/end) so 1xx lines share ordering with the final response bytes;
  // socket.write() would land in the socket handle's separate stream buffer.
  this[kHandle].writeInformational(chunk, encoding);
  noteResponseWrite(this);
  if (typeof callback === "function") process.nextTick(callback);
  return true;
};

ServerResponse.prototype.writeEarlyHints = function (hints, cb) {
  validateObject(hints, "hints");

  if (hints.link === null || hints.link === undefined) {
    return;
  }

  const link = validateLinkHeaderValue(hints.link);

  if (link.length === 0) {
    return;
  }

  if (checkInvalidHeaderChar(link)) {
    throw $ERR_INVALID_CHAR("header content", "Link");
  }

  const headers = { __proto__: null, Link: link };
  const keys = ObjectKeys(hints);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== "link") {
      headers[key] = hints[key];
    }
  }

  this.writeInformation(103, headers, cb);
};

function processInformationHeader(name, value) {
  validateHeaderName(name);
  validateHeaderValue(name, value);
  return `${name}: ${value}\r\n`;
}

ServerResponse.prototype.writeInformation = function writeInformation(statusCode, headers, cb) {
  if (this.headersSent) {
    throw $ERR_HTTP_HEADERS_SENT("write");
  }

  validateInteger(statusCode, "statusCode", 100, 199);
  if (statusCode === 101) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(statusCode);
  }

  const statusMessage = STATUS_CODES[statusCode] || "unknown";
  let head = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;

  if (headers !== undefined && headers !== null) {
    if ($isArray(headers)) {
      const headersLength = headers.length;
      if (headersLength && $isArray(headers[0])) {
        for (let i = 0; i < headersLength; i++) {
          const entry = headers[i];
          head += processInformationHeader(entry[0], entry[1]);
        }
      } else {
        if (headersLength % 2 !== 0) {
          throw $ERR_INVALID_ARG_VALUE("headers", headers);
        }
        for (let i = 0; i < headersLength; i += 2) {
          head += processInformationHeader(headers[i], headers[i + 1]);
        }
      }
    } else {
      validateObject(headers, "headers");
      const keys = ObjectKeys(headers);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        head += processInformationHeader(key, headers[key]);
      }
    }
  }

  head += "\r\n";

  return this._writeRaw(head, "ascii", cb);
};

ServerResponse.prototype.writeProcessing = function (cb) {
  return this.writeInformation(102, null, cb);
};

ServerResponse.prototype.writeContinue = function (cb) {
  if (this.headersSent) {
    throw $ERR_HTTP_HEADERS_SENT("write");
  }
  if (!this[kHandle]) {
    // Through writeInformation() like Node.js v26.3.0, so the line waits in outputData until a socket is assigned.
    this.writeInformation(100, null, cb);
    this._sent100 = true;
    return;
  }
  this[kHandle].writeContinue();
  noteResponseWrite(this);
  this._sent100 = true;
  if (typeof cb === "function") process.nextTick(cb);
};

// A response takes what its native handle takes, whatever carries it. OutgoingMessage takes a string or a Uint8Array.
function toOutgoingChunk(res, chunk) {
  if (typeof chunk === "string" || typeof chunk === "function" || chunk == null) return chunk;
  if (!res._header) updateHasBody(res, res.statusCode);
  if (!res._hasBody) return "";
  if (ArrayBufferIsView(chunk)) {
    return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  const { isAnyArrayBuffer, isStringObject } = require("node:util/types");
  if (isAnyArrayBuffer(chunk)) return new Uint8Array(chunk);
  return isStringObject(chunk) ? `${chunk}` : chunk;
}

ServerResponse.prototype.end = function (chunk, encoding, callback) {
  const handle = this[kHandle];
  // A late end() gets the same answer whatever carries the response.
  if (!handle || this.finished) {
    return OutgoingMessagePrototype.end.$call(this, toOutgoingChunk(this, chunk), encoding, callback);
  }

  if ($isCallable(chunk)) {
    callback = chunk;
    chunk = undefined;
    encoding = undefined;
  } else if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  } else if (!$isCallable(callback)) {
    callback = undefined;
  }

  // Node's write_() drops the chunk of a destroyed response before _implicitHeader(), and end() goes on: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L951-L964
  const droppedChunk = !!chunk && this.destroyed;
  if (droppedChunk) chunk = undefined;

  if (!this._header) validateImplicitHead(this);
  if (chunk && !this._hasBody) {
    if (this[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      // node.js just ignores the write in this case
      chunk = undefined;
    }
  }

  // Trailer fields added via res.addTrailers() are sent after the terminating
  // 0 chunk of a chunked response body (RFC 9112 7.1.2). They force chunked
  // framing, so they only apply when nothing pinned the framing to
  // Content-Length and the response can carry a body - Node.js drops them in
  // every other case (explicit Content-Length, HTTP/1.0, body-less statuses).
  const trailer = this._trailer;
  if (trailer && this._hasBody && willBeChunked(this)) {
    this.socket?.[kHandle]?.setResponseTrailers(trailer);
  }

  if (!droppedChunk) callWriteHeadIfObservable(this, true);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // Socket already gone: like Node, 'prefinish' fires but 'finish' never does, and the close of the socket aborts the request.
    // Node's _implicitHeader() ran unless the chunk was dropped above, so the head counts as sent like on the normal path below.
    if (!droppedChunk || this._header) {
      this._header = " ";
      this._headerSent = true;
    }
    this.finished = true;
    process.nextTick(markResponseEndedNT, this);
    this.emit("prefinish");
    return this;
  }
  // Native end() returns -(length + 1) while part of the body is still draining; 'finish' waits for it.
  let draining = false;
  // A replaced writeHead() can have sent the head itself, with write().
  if (!this._headerSent) {
    {
      const renderedHeaders = renderNativeHeaders(this);
      let contentLength;
      try {
        // It throws before it sends anything.
        contentLength = handle.writeHeadAndEnd(
          this[kSnapshotStatusCode] ?? this.statusCode,
          this[kSnapshotStatusMessage] ?? this.statusMessage,
          renderedHeaders,
          chunk,
          encoding,
          strictContentLength(this, true, true),
          renderedAutoHeaders,
          renderedKeepAliveSecs,
        );
      } finally {
        releaseRenderedHeaders(renderedHeaders);
      }
      this._headerSent = true;
      if (contentLength < 0) {
        draining = true;
        contentLength = -contentLength - 1;
      }
      this._contentLength = contentLength;
    }
  } else {
    // If there's no data but you already called end, then you're done.
    // We can ignore it in that case. `flags` was read above in the same tick
    // (no native call in between can change it), so reuse its bits instead of
    // paying two more native getter crossings.
    if (!(!chunk && flags & NodeHTTPResponseFlags.ended) && !(flags & NodeHTTPResponseFlags.socket_closed)) {
      draining = handle.end(chunk, encoding, undefined, strictContentLength(this, true, true)) < 0;
    }
  }
  this._header = " ";
  noteResponseWrite(this);
  // Like Node's end(), fully uncork the socket. A leftover cork would buffer a later 'connect' or 'upgrade' listener's writes forever.
  const socket = this[kSocket];
  const socketWritableState = socket?._writableState;
  if (socketWritableState?.corked) {
    socketWritableState.corked = 1;
    socket.uncork();
  }
  // The socket is NOT detached here: like Node.js, res.socket stays assigned
  // until the response 'finish' machinery runs (the dispatcher detaches it
  // right after a synchronously-finished handler returns, or via its 'finish'
  // listener otherwise), so handlers can still reach res.socket after end().
  this.finished = true;
  process.nextTick(markResponseEndedNT, this);
  this.emit("prefinish");

  if (draining) {
    // Native calls back once the body is out; a dying connection finishes from emit("close").
    this[kPendingFinish] = callback ?? null;
    handle.onwritable = flushPendingFinish.bind(this);
  } else {
    queueResponseFinished(this, callback);
  }

  return this;
};

// 'finish' waits a tick: the dispatcher sets kDetachedFrom after a sync handler returns, and 'finish' reads it.
function queueResponseFinished(res, callback) {
  res._callPendingCallbacks();
  process.nextTick(emitResponseFinished, res, callback);
}

// 'close' is queued before the 'finish' listeners run, like Node.js's resOnFinish does.
function emitResponseFinished(res, callback) {
  process.nextTick(emitCloseNT, res);
  res.emit("finish");
  if (callback) {
    try {
      callback();
    } catch (err) {
      res.emit("error", err);
    }
  }
}

function flushPendingFinish(this: any) {
  const callback = this[kPendingFinish];
  if (callback === undefined) return;
  this[kPendingFinish] = undefined;
  noteResponseWrite(this);
  queueResponseFinished(this, callback);
}

ServerResponse.prototype.write = function (chunk, encoding, callback) {
  const handle = this[kHandle];
  // So does a late write().
  if (!handle || this.finished || this.destroyed) {
    return OutgoingMessagePrototype.write.$call(this, toOutgoingChunk(this, chunk) ?? "", encoding, callback);
  }

  if ($isCallable(chunk)) {
    callback = chunk;
    chunk = undefined;
    encoding = undefined;
  } else if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  } else if (!$isCallable(callback)) {
    callback = undefined;
  }

  const hadHeader = !!this._header;
  callWriteHeadIfObservable(this);

  if (!this._header) validateImplicitHead(this);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // Socket already gone, and 'close' is still to come.
    if (callback) {
      this[kPendingCallbacks].push(callback);
      failPendingWriteCallbacks(this, this[kSocket]?.errored);
    }
    return false;
  }

  if (!this._hasBody) {
    if ((chunk || chunk === "") && this[kRejectNonStandardBodyWrites]) throw $ERR_HTTP_BODY_NOT_ALLOWED();
    // Node's write_(): the chunk is dropped, and the head waits for end() or flushHeaders().
    this._implicitHeader();
    if (callback) process.nextTick(callback);
    return true;
  }

  const result = writeToHandle(
    this,
    handle,
    chunk,
    encoding,
    allowWritesToContinue.bind(this),
    strictContentLength(this, hadHeader, false),
  );

  if (result < 0) {
    if (callback) {
      // The write was buffered due to backpressure.
      // We need to defer the callback until the write actually goes through.
      this[kPendingCallbacks].push(callback);
    }
    return false;
  }

  noteResponseWrite(this);
  this._callPendingCallbacks();
  if (callback) {
    // A write callback reports that its bytes reached the socket: uncork them before the callback can destroy the response.
    handle.flushHeaders();
    if (handle.bufferedAmount > 0) {
      this[kPendingCallbacks].push(callback);
      handle.onwritable = allowWritesToContinue.bind(this);
      return false;
    }
    process.nextTick(callback);
  }

  // Like Node.js, writes are accounted against the high water mark even when
  // the transport accepted them synchronously: once the bytes handed off in
  // this event-loop turn (including chunked framing overhead) reach the high
  // water mark, write() reports backpressure and 'drain' fires asynchronously
  // once the data has been flushed. Writes below the mark return true and
  // emit no 'drain' (Node only emits 'drain' after a write that returned
  // false).
  let written = 0;
  if (chunk) {
    written = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    if (written > 0 && this.getHeader("content-length") === undefined) {
      // Chunked framing overhead: <hex length>\r\n<chunk>\r\n
      written += written.toString(16).length + 4;
    }
  }
  if (written > 0) {
    this[kBytesBuffered] = (this[kBytesBuffered] ?? 0) + written;
    scheduleWriteAccountingFlush(this);
  }

  // An empty chunk reports the count too: Node returns state.length < highWaterMark for every write.
  const buffered = this[kBytesBuffered];
  return !buffered || buffered < this.writableHighWaterMark;
};

const kBytesBuffered = Symbol("kBytesBuffered");
const kAccountingFlushScheduled = Symbol("kAccountingFlushScheduled");
function flushWriteAccountingNT(res) {
  res[kAccountingFlushScheduled] = false;
  const needsDrain = (res[kBytesBuffered] ?? 0) >= res.writableHighWaterMark;
  res[kBytesBuffered] = 0;
  if (!needsDrain || res.destroyed || res.finished) return;
  const handle = res[kHandle];
  if (handle?.bufferedAmount > 0) {
    // The handle may still reference the caller's buffer for an unsent tail, so 'drain' waits for its drain callback.
    handle.onwritable ??= allowWritesToContinue.bind(res);
    return;
  }
  res.emit("drain");
}
function scheduleWriteAccountingFlush(res) {
  if (res[kAccountingFlushScheduled]) return;
  res[kAccountingFlushScheduled] = true;
  process.nextTick(flushWriteAccountingNT, res);
}

ServerResponse.prototype._callPendingCallbacks = function () {
  const originalLength = this[kPendingCallbacks].length;

  for (let i = 0; i < originalLength; ++i) {
    process.nextTick(this[kPendingCallbacks][i]);
  }

  if (this[kPendingCallbacks].length == originalLength) {
    // If the array wasn't somehow appended to, just set it to an empty array
    this[kPendingCallbacks] = [];
  } else {
    // Otherwise, splice it.
    this[kPendingCallbacks].splice(0, originalLength);
  }
};

ServerResponse.prototype.detachSocket = function (socket) {
  // socket can be null when the stream destroyer detached the request's
  // socket (req.socket = null) before the response finished.
  if (socket && socket._httpMessage === this) {
    if (socket[kCloseCallback]) socket[kCloseCallback] = undefined;
    socket.removeListener("close", onServerResponseClose);
    socket._httpMessage = null;
    if (socket.destroyed && this.destroyed) socket[kDetachedWhileClosing] = this;
  }

  this.socket = null;
};

ServerResponse.prototype._implicitHeader = function () {
  if (this._header) return;
  if (this.writeHead === OriginalWriteHeadFn) writeHead(this, this.statusCode, undefined, undefined, false);
  else this.writeHead(this.statusCode);
};

// A response without a native handle (new ServerResponse(req) and assignSocket()) writes through OutgoingMessage, which keeps its own accounting.
const {
  writableCorked: { get: outgoingWritableCorked },
  writableNeedDrain: { get: outgoingWritableNeedDrain },
  writableFinished: { get: outgoingWritableFinished },
  writableLength: { get: outgoingWritableLength },
} = Object.getOwnPropertyDescriptors(OutgoingMessagePrototype);

Object.defineProperty(ServerResponse.prototype, "writableNeedDrain", {
  get() {
    // True between a write() that returned false and the next 'drain'. An armed native drain callback means a later write flushed the bytes.
    const handle = this[kHandle];
    if (!handle) return outgoingWritableNeedDrain!.$call(this);
    if (this.destroyed || this.finished) return false;
    return (
      handle.bufferedAmount !== 0 ||
      handle.onwritable !== undefined ||
      (this[kBytesBuffered] ?? 0) >= this.writableHighWaterMark
    );
  },
});

Object.defineProperty(ServerResponse.prototype, "writableFinished", {
  get() {
    const handle = this[kHandle];
    if (!handle) return outgoingWritableFinished!.$call(this);
    // Like Node, nothing is left to write once the socket is gone.
    return !!(this.finished && (handle.finished || handle.flags & NodeHTTPResponseFlags.closed_or_completed));
  },
});

Object.defineProperty(ServerResponse.prototype, "writableLength", {
  get() {
    const handle = this[kHandle];
    if (!handle) return outgoingWritableLength!.$call(this);
    if (this.writableFinished) return 0;
    // Bytes handed off this event-loop turn (including chunked framing, like
    // Node.js's outputData accounting) plus whatever the native handle still
    // has buffered.
    return (this[kBytesBuffered] ?? 0) + handle.bufferedAmount;
  },
});

ServerResponse.prototype._send = function (data, encoding, callback, _byteLength) {
  const handle = this[kHandle];
  if (!handle) {
    return OutgoingMessagePrototype._send.$apply(this, arguments);
  }

  if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }
  const hadHeader = !!this._header;
  if (!hadHeader) validateImplicitHead(this);
  writeToHandle(this, handle, data, encoding, callback, strictContentLength(this, hadHeader, false));
};

// The first write takes the head with it, in one native call that throws before it sends anything.
function writeToHandle(res, handle, chunk, encoding, onWritable, strict) {
  if (res._headerSent) return handle.write(chunk, encoding, onWritable, strict);
  const renderedHeaders = renderNativeHeaders(res);
  let result;
  try {
    result = handle.writeHeadAndWrite(
      res[kSnapshotStatusCode] ?? res.statusCode,
      res[kSnapshotStatusMessage] ?? res.statusMessage,
      renderedHeaders,
      chunk,
      encoding,
      onWritable,
      strict,
      renderedAutoHeaders,
      renderedKeepAliveSecs,
    );
  } finally {
    releaseRenderedHeaders(renderedHeaders);
  }
  res._header = " ";
  res._headerSent = true;
  return result;
}

const kSnapshotStatusCode = Symbol("kSnapshotStatusCode");
const kSnapshotStatusMessage = Symbol("kSnapshotStatusMessage");
// Set by writeHead() when it froze the framing with no length/encoding of its
// own — the state Node's _storeHeader resolves to chunked.
const kFramingFrozenChunked = Symbol("kFramingFrozenChunked");
// Set while end() drives an observable writeHead: Node already knows the body
// length there, so that call must not freeze the framing.
const kImplicitHeaderFromEnd = Symbol("kImplicitHeaderFromEnd");
ServerResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
  return writeHead(this, statusCode, statusMessage, headers, true);
};

function writeHead(self, statusCode, statusMessage, headers, explicit) {
  if (self._header) {
    throw $ERR_HTTP_HEADERS_SENT("writeHead");
  }
  _writeHead(statusCode, statusMessage, headers, self, explicit);

  // Node.js renders the header block immediately in writeHead(), so mutating
  // res.statusCode/statusMessage afterwards has no effect on the wire.
  // Headers are flushed lazily here, so snapshot the status line now.
  self[kSnapshotStatusCode] = self.statusCode;
  self[kSnapshotStatusMessage] = self.statusMessage;

  // Node's writeHead() freezes body framing: _storeHeader runs with _contentLength null and
  // a later end(chunk) cannot add Content-Length once _header exists. Headers render lazily
  // here, so record the frozen choice for renderNativeHeaders.
  if (!self[kImplicitHeaderFromEnd] && !self.hasHeader("content-length") && !self.hasHeader("transfer-encoding")) {
    self[kFramingFrozenChunked] = true;
  }

  if (self[kHandle]) {
    // The handle renders the head when it sends it.
    self._header = " ";
  } else {
    if (self._expect_continue && !self._sent100) self.shouldKeepAlive = false;
    // Node says keep-alive here, and after a Transfer-Encoding without "chunked" it keeps the connection too.
    const endsAtClose = bodyEndsAtClose(self);
    if (endsAtClose) self.shouldKeepAlive = false;
    self._storeHeader(`HTTP/1.1 ${self.statusCode} ${self.statusMessage}\r\n`, self[kOutHeaders], true);
    if (endsAtClose) self._last = true;
  }

  return self;
}

ServerResponse.prototype.assignSocket = function (socket) {
  if (socket._httpMessage) {
    throw $ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = this;
  socket.on("close", onServerResponseClose);
  this.socket = socket;
  this.emit("socket", socket);
  // Like Node.js: drain anything written before the socket was assigned.
  this._flush();
};

ServerResponse.prototype.destroy = function (err?: Error) {
  if (this.destroyed) return this;
  const handle = this[kHandle];
  this.destroyed = true;
  // Like Node.js's OutgoingMessage#destroy: remember the error (even when it
  // is undefined) so `res.errored` reports it, and forward it to the socket.
  this[kErrored] = err;
  if (handle) {
    handle.abort();
  }
  const socket = this[kSocket];
  if (socket) {
    socket.destroy(err);
  } else {
    process.nextTick(emitCloseNT, this);
  }
  return this;
};

ServerResponse.prototype.emit = function (event) {
  if (event === "close") {
    const callback = this[kPendingFinish];
    if (callback !== undefined) {
      // The connection died mid-drain: like Node.js, the response still finishes, then closes.
      this[kPendingFinish] = undefined;
      this._closed = true;
      this._callPendingCallbacks();
      process.nextTick(emitResponseFinishedThenClose, this, callback);
      return false;
    }
    // The callbacks of what it couldn't send run ahead of 'close'.
    const pending = this[kPendingCallbacks].length !== 0;
    if (pending) failPendingWriteCallbacks(this, undefined);
    if (this[kFailHeldWrites]() || pending) {
      process.nextTick(emitClose, this);
      return false;
    }
    callCloseCallback(this);
  }
  return Stream.prototype.emit.$apply(this, arguments);
};

function emitClose(res) {
  res.emit("close");
}

function emitResponseFinishedThenClose(res, callback) {
  emitResponseFinished(res, callback);
  res.emit("close");
}

ServerResponse.prototype.flushHeaders = function () {
  const handle = this[kHandle];
  if (!this._header) this.writeHead(this.statusCode);
  if (!handle) return OutgoingMessagePrototype.flushHeaders.$call(this);
  // Should be idempotent.
  if (this._headerSent) return;

  // Called from a replaced writeHead() that end() is driving. end() sends the head with the body, like Node's corked end().
  if (this[kImplicitHeaderFromEnd]) return;

  this._headerSent = true;
  const renderedHeaders = renderNativeHeaders(this);
  try {
    handle.writeHead(
      this[kSnapshotStatusCode] ?? this.statusCode,
      this[kSnapshotStatusMessage] ?? this.statusMessage,
      renderedHeaders,
      renderedAutoHeaders,
      renderedKeepAliveSecs,
    );
  } finally {
    releaseRenderedHeaders(renderedHeaders);
  }
  handle.flushHeaders();
  noteResponseWrite(this);
};

function updateHasBody(response, statusCode) {
  // RFC 2616, 10.2.5:
  // The 204 response MUST NOT include a message-body, and thus is always
  // terminated by the first empty line after the header fields.
  // RFC 2616, 10.3.5:
  // The 304 response MUST NOT contain a message-body, and thus is always
  // terminated by the first empty line after the header fields.
  // RFC 2616, 10.1 Informational 1xx:
  // This class of status code indicates a provisional response,
  // consisting only of the Status-Line and optional headers, and is
  // terminated by an empty line.
  if (statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode <= 199)) {
    response._hasBody = false;
  }
  // No else: Node.js never sets _hasBody back to true here, so a HEAD
  // request's response (set in the constructor) stays body-less whatever
  // status writeHead() picks.
}

let OriginalWriteHeadFn, OriginalImplicitHeadFn;

function callWriteHeadIfObservable(self, fromEnd?) {
  if (!self._header && !(self.writeHead === OriginalWriteHeadFn && self._implicitHeader === OriginalImplicitHeadFn)) {
    // Node's end(chunk) assigns _contentLength before _implicitHeader reaches
    // _storeHeader, so this implicit call must not freeze the framing to chunked
    // the way an explicit writeHead() does — the body is already in hand.
    if (fromEnd) self[kImplicitHeaderFromEnd] = true;
    try {
      self.writeHead(self.statusCode, self.statusMessage);
    } finally {
      if (fromEnd) self[kImplicitHeaderFromEnd] = false;
    }
  }
}

// A write that only reached the backpressure buffer doesn't count, so a peer that stopped reading still times out.
function noteResponseWrite(res) {
  const socket = res[kSocket];
  if (!socket?.timeout) return;
  // The timer may have fired and a 'timeout' listener kept the socket. refresh() arms it again, like in Node.
  if (socket[kLastResponseWrite] === undefined) socket._unrefTimer();
  socket[kLastResponseWrite] = timerClockMs();
}

function allowWritesToContinue() {
  noteResponseWrite(this);
  this._callPendingCallbacks();
  this.emit("drain");
}

function failPendingWriteCallbacks(res, error) {
  const callbacks = res[kPendingCallbacks];
  const length = callbacks?.length ?? 0;
  if (length === 0) return;
  res[kPendingCallbacks] = [];
  const failure = error ?? $ERR_STREAM_DESTROYED("write");
  for (let i = 0; i < length; i++) {
    process.nextTick(callbacks[i], failure);
  }
}

ServerResponse.prototype._expect_continue = false;
OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = ServerResponse.prototype._implicitHeader;

function defaultShouldUpgradeCallback(this: any) {
  return this.listenerCount("upgrade") > 0;
}

function storeHTTPOptions(options) {
  this[kIncomingMessage] = options.IncomingMessage || IncomingMessage;
  this[kServerResponse] = options.ServerResponse || ServerResponse;

  const maxHeaderSize = options.maxHeaderSize;
  if (maxHeaderSize !== undefined) validateInteger(maxHeaderSize, "maxHeaderSize", 0);
  this.maxHeaderSize = maxHeaderSize;

  const insecureHTTPParser = options.insecureHTTPParser;
  if (insecureHTTPParser !== undefined) validateBoolean(insecureHTTPParser, "options.insecureHTTPParser");
  this.insecureHTTPParser = insecureHTTPParser;

  const httpValidation = options.httpValidation;
  if (httpValidation !== undefined) {
    validateOneOf(httpValidation, "options.httpValidation", ["strict", "relaxed", "insecure"]);
    if (insecureHTTPParser !== undefined) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.httpValidation",
        httpValidation,
        "cannot be used with options.insecureHTTPParser",
      );
    }
    this.httpValidation = httpValidation;
  }

  const requestTimeout = options.requestTimeout;
  if (requestTimeout !== undefined) {
    validateInteger(requestTimeout, "requestTimeout", 0);
    this.requestTimeout = requestTimeout;
  } else {
    this.requestTimeout = 300_000; // 5 minutes
  }

  const headersTimeout = options.headersTimeout;
  if (headersTimeout !== undefined) {
    validateInteger(headersTimeout, "headersTimeout", 0);
    this.headersTimeout = headersTimeout;
  } else {
    this.headersTimeout = MathMin(60_000, this.requestTimeout); // Minimum between 60 seconds or requestTimeout
  }

  if (this.requestTimeout > 0 && this.headersTimeout > 0 && this.headersTimeout > this.requestTimeout) {
    throw $ERR_OUT_OF_RANGE("headersTimeout", "<= requestTimeout", headersTimeout);
  }

  const keepAliveTimeout = options.keepAliveTimeout;
  if (keepAliveTimeout !== undefined) {
    validateInteger(keepAliveTimeout, "keepAliveTimeout", 0);
    this.keepAliveTimeout = keepAliveTimeout;
  } else {
    this.keepAliveTimeout = 5_000; // 5 seconds
  }

  const keepAliveTimeoutBuffer = options.keepAliveTimeoutBuffer;
  if (keepAliveTimeoutBuffer !== undefined) {
    validateInteger(keepAliveTimeoutBuffer, "keepAliveTimeoutBuffer", 0);
    this.keepAliveTimeoutBuffer = keepAliveTimeoutBuffer;
  } else {
    this.keepAliveTimeoutBuffer = 1000;
  }

  const connectionsCheckingInterval = options.connectionsCheckingInterval;
  if (connectionsCheckingInterval !== undefined) {
    validateInteger(connectionsCheckingInterval, "connectionsCheckingInterval", 0);
    this.connectionsCheckingInterval = connectionsCheckingInterval;
  } else {
    this.connectionsCheckingInterval = 30_000; // 30 seconds
  }

  const requireHostHeader = options.requireHostHeader;
  if (requireHostHeader !== undefined) {
    validateBoolean(requireHostHeader, "options.requireHostHeader");
    this.requireHostHeader = requireHostHeader;
  } else {
    this.requireHostHeader = true;
  }

  const joinDuplicateHeaders = options.joinDuplicateHeaders;
  if (joinDuplicateHeaders !== undefined) {
    validateBoolean(joinDuplicateHeaders, "options.joinDuplicateHeaders");
  }
  this.joinDuplicateHeaders = joinDuplicateHeaders;

  const shouldUpgradeCallback = options.shouldUpgradeCallback;
  if (shouldUpgradeCallback !== undefined) {
    validateFunction(shouldUpgradeCallback, "options.shouldUpgradeCallback");
    this.shouldUpgradeCallback = shouldUpgradeCallback;
  } else {
    this.shouldUpgradeCallback = defaultShouldUpgradeCallback;
  }

  const rejectNonStandardBodyWrites = options.rejectNonStandardBodyWrites;
  if (rejectNonStandardBodyWrites !== undefined) {
    validateBoolean(rejectNonStandardBodyWrites, "options.rejectNonStandardBodyWrites");
    this.rejectNonStandardBodyWrites = rejectNonStandardBodyWrites;
  } else {
    this.rejectNonStandardBodyWrites = false;
  }

  const optimizeEmptyRequests = options.optimizeEmptyRequests;
  if (optimizeEmptyRequests !== undefined) {
    validateBoolean(optimizeEmptyRequests, "options.optimizeEmptyRequests");
  }
  this[kOptimizeEmptyRequests] = optimizeEmptyRequests || false;
}

export default {
  Server,
  ServerResponse,
  setupConnectionsTracking,
  storeHTTPOptions,
  _connectionListener: connectionListener,
  httpServerPreClose,
  kConnectionsCheckingInterval,
};
