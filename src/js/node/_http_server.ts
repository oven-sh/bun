// Hardcoded module "node:_http_server"
const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");
const { Stream } = require("node:stream");
const { Socket: NetSocket } = require("node:net");
const {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression,
  validateHeaderName,
  validateHeaderValue,
  HTTPParser,
} = require("node:_http_common");
const {
  validateObject,
  validateLinkHeaderValue,
  validateBoolean,
  validateInteger,
  validateFunction,
  validateOneOf,
} = require("internal/validators");
const { ConnResetException, hasObserver, startPerf, stopPerf } = require("internal/shared");
const kServerResponseStatistics = Symbol("ServerResponseStatistics");

const { isPrimary } = require("internal/cluster/isPrimary");
const {
  throwOnInvalidTLSArray,
  tlsStringToProtocolVersion,
  secureProtocolToVersionRange,
  processPfxOptions,
  validateSecureProtocol,
} = require("internal/tls");
const {
  kInternalSocketData,
  serverSymbol,
  kHandle,
  kRealListen,
  tlsSymbol,
  optionsSymbol,
  kDeprecatedReplySymbol,
  headerStateSymbol,
  NodeHTTPHeaderState,
  kPendingCallbacks,
  kRequest,
  kCloseCallback,
  NodeHTTPResponseFlags,
  emitErrorNextTickIfErrorListenerNT,
  getIsNextIncomingMessageHTTPS,
  setIsNextIncomingMessageHTTPS,
  callCloseCallback,
  emitCloseNT,
  NodeHTTPResponseAbortEvent,
  STATUS_CODES,
  isTlsSymbol,
  hasServerResponseFinished,
  NodeHTTPBodyReadState,
  controllerSymbol,
  firstWriteSymbol,
  deferredSymbol,
  eofInProgress,
  runSymbol,
  drainMicrotasks,
  setServerCustomOptions,
  setServerAppFlags,
  getMaxHTTPHeaderSize,
  fakeSocketSymbol,
  noBodySymbol,
  kOutHeaders,
  onDataIncomingMessage,
  validateMsecs,
} = require("internal/http");
const { FakeSocket } = require("internal/http/FakeSocket");
const NumberIsNaN = Number.isNaN;

const { format } = require("internal/util/inspect");

const { IncomingMessage, kReqShouldKeepAlive } = require("node:_http_incoming");
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
const { kIncomingMessage } = require("node:_http_common");
const kConnectionsCheckingInterval = Symbol("http.server.connectionsCheckingInterval");
const kTrackedConnections = Symbol("http.server.trackedConnections");
const kHttpAllowHalfOpen = Symbol("http.server.httpAllowHalfOpen");

// node.http trace events ('http.server.request' b/e). The agent module is
// only created on the first request, and emission is gated per-request on the
// category, so this is near-zero cost when tracing is off.
const kHttpTraceCat = "node,node.http";
let traceEvents = null;
function traceServerRequestStart(http_res) {
  traceEvents ??= require("internal/trace_events");
  if (!traceEvents.isCategoryGroupEnabled(kHttpTraceCat)) return;
  traceEvents.emitEvent("b", kHttpTraceCat, "http.server.request");
  http_res.once("finish", traceServerRequestEnd);
}
function traceServerRequestEnd() {
  traceEvents.emitEvent("e", kHttpTraceCat, "http.server.request");
}

const getBunServerAllClosedPromise = $newRustFunction("node_http_binding.rs", "getBunServerAllClosedPromise", 1);
const kClusterSendOptions = { __proto__: null, "$internal": true };

const kServerResponse = Symbol("ServerResponse");
const kChunkedEncoding = Symbol("kChunkedEncoding");
const kShouldKeepAlive = Symbol("kShouldKeepAlive");
const kOptimizeEmptyRequests = Symbol("kOptimizeEmptyRequests");
const GlobalPromise = globalThis.Promise;
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const MathMin = Math.min;
const MathFloor = Math.floor;
const DateNow = Date.now;

let cluster;

function emitCloseServer(self: Server) {
  callCloseCallback(self);
  self.emit("close");
}
function emitCloseNTServer(this: Server) {
  process.nextTick(emitCloseServer, this);
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
    throw $ERR_HTTP_SOCKET_ASSIGNED("Socket already assigned");
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

function strictContentLength(response) {
  if (response.strictContentLength) {
    let contentLength = response._contentLength ?? response.getHeader("content-length");
    if (
      contentLength &&
      response._hasBody &&
      !response._removedContLen &&
      !response.chunkedEncoding &&
      !response.hasHeader("transfer-encoding")
    ) {
      if (typeof contentLength === "number") {
        return contentLength;
      } else if (typeof contentLength === "string") {
        contentLength = parseInt(contentLength, 10);
        if (NumberIsNaN(contentLength)) {
          return;
        }
        return contentLength;
      }
    }
  }
}

const ServerResponse_writeDeprecated = function _write(chunk, encoding, callback) {
  if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  }
  if (!$isCallable(callback)) {
    callback = undefined;
  }
  if (encoding && encoding !== "buffer") {
    chunk = Buffer.from(chunk, encoding);
  }
  if (this.destroyed || this.finished) {
    if (chunk) {
      emitErrorNextTickIfErrorListenerNT(this, $ERR_STREAM_WRITE_AFTER_END(), callback);
    }
    return false;
  }
  if (this[firstWriteSymbol] === undefined && !this.headersSent) {
    this[firstWriteSymbol] = chunk;
    if (callback) callback();
    return;
  }

  ensureReadableStreamController.$call(this, controller => {
    controller.write(chunk);
    if (callback) callback();
  });
};

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
    free: serverParserShimFree,
    close: serverParserShimClose,
    [kParserOnTimeout]: serverParserShimOnTimeout,
  };
}

function releaseServerParserShim(socket, req?) {
  const parser = socket.parser;
  if (parser == null) return;
  socket.parser = null;
  parser.incoming = null;
  parser.socket = null;
  parser[kParserOnTimeout] = null;
  parser.free();
  if (req != null && req.parser != null) req.parser = null;
}

function onNodeHTTPServerSocketTimeout() {
  const req = this[kRequest];
  // Like Node.js's socketOnTimeout: the request only sees 'timeout' while its
  // message is still being received. A body-less request was fully received
  // when it was dispatched, even if its (empty) stream was never consumed.
  const reqTimeout = req && !req.complete && !req[noBodySymbol] && req.emit("timeout", this);
  const res = this._httpMessage;
  const resTimeout = res && res.emit("timeout", this);
  const serverTimeout = this.server.emit("timeout", this);

  if (!reqTimeout && !resTimeout && !serverTimeout) this.destroy();
}

function emitRequestCloseNT(self) {
  callCloseCallback(self);
  self.emit("close");
}

function emitListeningNextTick(self, hostname, port) {
  if ((self.listening = !!self[serverSymbol])) {
    // TODO: remove the arguments
    // Note does not pass any arguments.
    self.emit("listening", null, hostname, port);
  }
}

// Node.js only requests a client certificate when `requestCert: true`.
// The uSockets SSL context treats `ca` alone as "verify peer", so without
// these two flags an `https.Server({ ca })` would reject every client that
// doesn't present a cert. Mirror tls.Server (net.ts): default `requestCert`
// to false and, when not requesting, force `rejectUnauthorized` to false so
// the CA is loaded into the trust store without requiring a client cert.
function normalizeServerTls(tls) {
  const requestCert = !!tls.requestCert;
  tls.requestCert = requestCert;
  tls.rejectUnauthorized = requestCert ? tls.rejectUnauthorized !== false : false;
  return tls;
}

function Server(options, callback): void {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);
  this.on("listening", setupConnectionsTracking);

  this.prependListener("connection", socket => {
    if (socket != null && typeof socket === "object") socket.server = this;
  });

  this.listening = false;
  this._unref = false;
  this.timeout = 0;
  this.maxRequestsPerSocket = 0;
  this.maxHeadersCount = null;
  defineHttpAllowHalfOpen(this);
  this[kInternalSocketData] = undefined;
  this[kTrackedConnections] = new Set();
  this[tlsSymbol] = null;
  this.noDelay = true;
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null) {
    options = {};
  } else {
    validateObject(options, "options");
    options = { ...options };

    // Node's https.Server accepts PKCS#12 bundles (pfx [+ passphrase]); fold
    // them into plain key/cert/ca so the native TLS config sees PEM material.
    let tlsOptions = options;
    if (options.pfx) {
      tlsOptions = processPfxOptions(options);
      this[isTlsSymbol] = true;
    }

    let cert = tlsOptions.cert;
    if (cert) {
      throwOnInvalidTLSArray("options.cert", cert);
      this[isTlsSymbol] = true;
    }

    let key = tlsOptions.key;
    if (key) {
      throwOnInvalidTLSArray("options.key", key);
      this[isTlsSymbol] = true;
    }

    let ca = tlsOptions.ca;
    // PKCS#12-embedded CAs extend the trust set; the server path hands raw
    // {key, cert, ca} to the native config and has no addCACert hook, so fold
    // them into `ca` (mirrors tls.Server.setSecureContext).
    const pfxExtraCAs = tlsOptions._pfxExtraCACerts;
    if (pfxExtraCAs?.length) {
      ca = ca == null ? pfxExtraCAs : $isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
    }
    if (ca) {
      throwOnInvalidTLSArray("options.ca", ca);
      this[isTlsSymbol] = true;
    }

    let passphrase = options.passphrase;
    if (passphrase && typeof passphrase !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
    }

    let serverName = options.servername;
    if (serverName && typeof serverName !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.servername", "string", serverName);
    }

    let secureOptions = options.secureOptions || 0;
    if (secureOptions && typeof secureOptions !== "number") {
      throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
    }

    if (this[isTlsSymbol]) {
      // Translate minVersion/maxVersion/secureProtocol into the integer
      // protocol range the native layer applies (secureProtocol wins, like
      // Node's SecureContext::Init); 0 keeps the native defaults.
      validateSecureProtocol(options.secureProtocol);
      let minVersion, maxVersion;
      const range = secureProtocolToVersionRange(options.secureProtocol);
      if (range) {
        minVersion = range[0];
        maxVersion = range[1];
      } else {
        minVersion = tlsStringToProtocolVersion(options.minVersion);
        maxVersion = tlsStringToProtocolVersion(options.maxVersion);
      }
      this[tlsSymbol] = normalizeServerTls({
        serverName,
        key,
        cert,
        ca,
        passphrase,
        secureOptions,
        minVersion,
        maxVersion,
        ciphers: typeof options.ciphers === "string" && options.ciphers ? options.ciphers : undefined,
        requestCert: options.requestCert,
        rejectUnauthorized: options.rejectUnauthorized,
      });
    } else {
      this[tlsSymbol] = null;
    }
  }

  this[optionsSymbol] = options;
  storeHTTPOptions.$call(this, options);

  if (callback) this.on("request", callback);
  return this;
}
$toClass(Server, "Server", EventEmitter);

Server.prototype[kIncomingMessage] = undefined;

Server.prototype[kServerResponse] = undefined;

Server.prototype[kConnectionsCheckingInterval] = undefined;

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
}

// Node.js's checkConnections sweep: every connectionsCheckingInterval, expire
// connections whose in-flight request exceeded headersTimeout/requestTimeout.
// The per-connection timing lives on the native socket handle (the parser is
// native), so each tracked connection is asked whether it expired.
function checkConnections(this: Server) {
  const headersTimeout = this.headersTimeout;
  const requestTimeout = this.requestTimeout;
  if (headersTimeout === 0 && requestTimeout === 0) {
    return;
  }

  const connections = this[kTrackedConnections];
  if (!connections || connections.size === 0) {
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
  this._unref = false;
  this[serverSymbol]?.ref?.();
  return this;
};

Server.prototype.unref = function () {
  this._unref = true;
  this[serverSymbol]?.unref?.();
  return this;
};

Server.prototype.closeAllConnections = function () {
  const server = this[serverSymbol];
  if (!server) {
    return;
  }
  this[serverSymbol] = undefined;
  clearInterval(this[kConnectionsCheckingInterval]);
  this.listening = false;

  server.stop(true);
};

Server.prototype.getConnections = function (callback) {
  // Connections are tracked from the moment they are accepted (the native
  // server surfaces accepts through the onConnection callback).
  const count = this[kTrackedConnections]?.size ?? 0;
  if (typeof callback === "function") {
    process.nextTick(callback, null, count);
  }
  return this;
};

Server.prototype.closeIdleConnections = function () {
  const server = this[serverSymbol];
  server?.closeIdleConnections();
};

Server.prototype.close = function (optionalCallback?) {
  const server = this[serverSymbol];
  // Node.js's httpServerPreClose clears the connections-checking interval
  // even when the server was never listening.
  clearInterval(this[kConnectionsCheckingInterval]);
  if (!server) {
    if (typeof optionalCallback === "function") process.nextTick(optionalCallback, $ERR_SERVER_NOT_RUNNING());
    // Like Node.js's net.Server#close, close() returns the server.
    return this;
  }
  this[serverSymbol] = undefined;
  if (typeof optionalCallback === "function") setCloseCallback(this, optionalCallback);
  this.listening = false;
  server.closeIdleConnections();
  server.stop();
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
      // net.Server.prototype[EventEmitter.captureRejectionSymbol].apply(this, arguments);
      //   .apply(this, arguments);
      const { 1: res } = args;
      res?.socket?.destroy();
      break;
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
  const server = this;
  let port, host, onListen;
  let socketPath;
  let tls = this[tlsSymbol];

  // This logic must align with:
  // - https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L274-L307
  const argc = arguments.length;
  if (argc > 0) {
    const arg0 = arguments[0];
    if (($isObject(arg0) || $isCallable(arg0)) && arg0 !== null) {
      // (options[...][, cb])
      port = arg0.port;
      host = arg0.host;
      socketPath = arg0.path;

      const otherTLS = arg0.tls;
      if (otherTLS && $isObject(otherTLS)) {
        tls = normalizeServerTls({ ...otherTLS });
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
  if (port === undefined && !socketPath) {
    port = 0;
  }

  if (typeof port === "string") {
    const portNumber = parseInt(port);
    if (!Number.isNaN(portNumber)) {
      port = portNumber;
    }
  }

  const lastArg = arguments[argc - 1];
  if ($isCallable(lastArg)) {
    onListen = lastArg;
  }

  try {
    // listenInCluster

    if (isPrimary) {
      server[kRealListen](tls, port, host, socketPath, false, onListen);
      return this;
    }

    if (cluster === undefined) cluster = require("node:cluster");

    // const serverQuery = {
    //   // address: address,
    //   port: port,
    //   addressType: 4,
    //   // fd: fd,
    //   // flags,
    //   // backlog,
    //   // ...options,
    // };
    // cluster._getServer(server, serverQuery, function listenOnPrimaryHandle(err, handle) {
    //   // err = checkBindError(err, port, handle);
    //   // if (err) {
    //   //   throw new ExceptionWithHostPort(err, "bind", address, port);
    //   // }
    //   if (err) {
    //     throw err;
    //   }
    //   server[kRealListen](port, host, socketPath, onListen);
    // });

    server.once("listening", () => {
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
      process.send(message, undefined, kClusterSendOptions);
    });

    server[kRealListen](tls, port, host, socketPath, true, onListen);
  } catch (err) {
    setTimeout(() => server.emit("error", err), 1);
  }

  return this;
};

Server.prototype[kRealListen] = function (tls, port, host, socketPath, reusePort, onListen) {
  {
    const ResponseClass = this[optionsSymbol].ServerResponse || ServerResponse;
    const RequestClass = this[optionsSymbol].IncomingMessage || IncomingMessage;
    const canUseInternalAssignSocket = ResponseClass?.prototype.assignSocket === ServerResponse.prototype.assignSocket;
    let isHTTPS = false;
    let server = this;

    if (tls) {
      this.serverName = tls.serverName || host || "localhost";
    }
    this[serverSymbol] = Bun.serve<any>({
      idleTimeout: 0, // nodejs dont have a idleTimeout by default
      tls,
      port,
      hostname: host,
      unix: socketPath,
      reusePort,
      // Bindings to be used for WS Server
      websocket: {
        open(ws) {
          ws.data.open(ws);
        },
        message(ws, message) {
          ws.data.message(ws, message);
        },
        close(ws, code, reason) {
          ws.data.close(ws, code, reason);
        },
        drain(ws) {
          ws.data.drain(ws);
        },
        ping(ws, data) {
          ws.data.ping(ws, data);
        },
        pong(ws, data) {
          ws.data.pong(ws, data);
        },
      },
      maxRequestBodySize: Number.MAX_SAFE_INTEGER,

      onNodeHTTPRequest(
        bunServer,
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
        const prevIsNextIncomingMessageHTTPS = getIsNextIncomingMessageHTTPS();
        setIsNextIncomingMessageHTTPS(isHTTPS);
        if (!socket) {
          socket = new NodeHTTPServerSocket(server, socketHandle, !!tls);
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
        if (method === "CONNECT" && !isPipelined) {
          // Handle CONNECT method for HTTP tunneling/proxy
          if (server.listenerCount("connect") > 0) {
            // For CONNECT, emit the event and let the handler respond
            // Don't assign the socket to a response for CONNECT
            // The handler should write the raw response
            socket[kEnableStreaming](true);
            // The connection already parses as a CONNECT tunnel natively; this
            // additionally marks it half-open-capable so a client FIN ends the
            // readable side without tearing the tunnel down (allowHalfOpen).
            socketHandle.upgradeToTunnel();
            // The parser is detached: the socket is handed over with only
            // net.Socket's 'end' listener left, like Node.js.
            detachSocketListenersForHandoff(socket);
            const { promise, resolve } = $newPromiseCapability(Promise);
            // Pass the pipelined data (head buffer) if any was received with the CONNECT request
            const head = connectHead ? connectHead : kEmptyBuffer;
            // Node.js's parserOnIncoming: req.upgrade is true for CONNECT
            // regardless of shouldUpgradeCallback.
            http_req.upgrade = true;
            // Node frees the parser before handing the raw socket to 'connect'.
            releaseServerParserShim(socket, http_req);
            server.emit("connect", http_req, socket, head);
            // Attach the internal close listener after the user's "connect"
            // handler ran: Node.js hands the socket over with no listeners and
            // tests assert socket.listenerCount("close") === 0 there.
            socket.once("close", resolve);
            return promise;
          } else {
            // Node.js will close the socket and will NOT respond with 400 Bad Request
            socketHandle.close();
          }
          return;
        }
        socket[kEnableStreaming](false);

        // The builtin ServerResponse consumes its options synchronously, so a
        // reusable scratch object avoids one allocation per request. User
        // subclasses (options.ServerResponse) might retain options, so they
        // keep getting a fresh object.
        let http_res;
        if (ResponseClass === ServerResponse) {
          scratchResponseOptions[kHandle] = handle;
          scratchResponseOptions.highWaterMark = socket.writableHighWaterMark;
          scratchResponseOptions[kRejectNonStandardBodyWrites] = server.rejectNonStandardBodyWrites;
          http_res = new ResponseClass(http_req, scratchResponseOptions);
          scratchResponseOptions[kHandle] = undefined;
        } else {
          http_res = new ResponseClass(http_req, {
            [kHandle]: handle,
            highWaterMark: socket.writableHighWaterMark,
            [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
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
          http_res[kMustCloseConnection] = true;
        }
        // One plain on() listener (once() allocates a wrapper, a second listener
        // deoptimizes every 'finish' emit), registered before the 'request' event
        // like Node's resOnFinish so res.on-replacing middleware cannot swallow it.
        http_res.on("finish", emitResponseFinish);

        if (hasObserver("http")) {
          startPerf(http_res, kServerResponseStatistics, {
            type: "http",
            name: "HttpRequest",
            detail: {
              req: {
                method: http_req.method,
                url: http_req.url,
                headers: http_req.headers,
              },
            },
          });
          http_res.once("finish", stopServerResponsePerf);
        }

        setIsNextIncomingMessageHTTPS(prevIsNextIncomingMessageHTTPS);
        handle.onabort = socket[kBoundOnAbort] ??= onServerRequestEvent.bind(socket);
        // Like Node's connectionListener -> parserOnBody: body bytes flow into
        // the IncomingMessage as they arrive, and the push callback readStop()s
        // the socket (which emits 'pause' on it) once the buffer fills.
        if (hasBody) {
          handle.ondata = onDataIncomingMessage.bind(http_req);
          handle.hasCustomOnData = false;
        }
        drainMicrotasks();

        let resolveFunction;
        let didFinish = false;

        const isRequestsLimitSet = typeof server.maxRequestsPerSocket === "number" && server.maxRequestsPerSocket > 0;
        let reachedRequestsLimit = false;
        if (isRequestsLimitSet) {
          const requestCount = (socket._requestCount || 0) + 1;
          socket._requestCount = requestCount;
          http_res._maxRequestsPerSocket = server.maxRequestsPerSocket;
          // At (or beyond) the limit the response advertises Connection:
          // close, like Node.js - including the over-limit 503 dropRequest
          // answer, which would otherwise claim keep-alive right before the
          // socket is destroyed. Closing the socket here instead would race
          // already-pipelined requests, which still need to be dispatched so
          // they can be answered with 503 via dropRequest.
          http_res.maxRequestsOnConnectionReached = server.maxRequestsPerSocket <= requestCount;
          if (server.maxRequestsPerSocket < requestCount) {
            reachedRequestsLimit = true;
          }
        }

        if (isSocketNew && !reachedRequestsLimit) {
          server.emit("connection", socket);
        }

        if (!isPipelined) {
          socket[kRequest] = http_req;
        }
        // Node.js (llhttp) only flags a request as an upgrade when it carries
        // both an Upgrade header and a Connection header with the "upgrade"
        // token; the server then consults shouldUpgradeCallback (default: an
        // 'upgrade' listener is installed) and otherwise dispatches the
        // request normally.
        let is_upgrade = false;
        if (
          !isPipelined &&
          (dispatchBits & DISPATCH_HAS_UPGRADE) !== 0 &&
          (dispatchBits & DISPATCH_CONN_UPGRADE) !== 0
        ) {
          is_upgrade = !!server.shouldUpgradeCallback(http_req);
        }
        // Like Node.js's parserOnIncoming: req.upgrade is true inside the
        // 'upgrade' listener and false for a declined upgrade that falls
        // through to 'request'.
        http_req.upgrade = is_upgrade;
        if (isPipelined) {
          // A previous response on this connection has not finished yet: like
          // Node.js, this response is queued (res.socket === null) and its
          // writes are buffered until the in-flight response finishes and the
          // pipeline assigns it the socket (advanceResponsePipeline).
          http_res[kPipelinedQueuedState] = {
            ops: [],
            bytes: 0,
            headerBytes: 0,
            needDrain: false,
            ended: false,
            isAncient: !!isAncientHTTP,
            socket,
          };
          (socket[kPipelinedResponses] ??= []).push(http_res);
          // Node's parserOnIncoming stops reading the connection once the bytes
          // queued on responses that do not own the socket yet reach the
          // socket's high water mark, so pipelined requests cannot flood it.
          if (!socket._paused && (socket[kOutgoingData] ?? 0) >= socket.writableHighWaterMark) {
            pausePipelineReads(socket);
          }
        } else if (!is_upgrade) {
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
          if (resolveFunction) resolveFunction();
        }

        if (!isPipelined) {
          setCloseCallback(http_res, onClose);
        }
        // Node traces every parsed request before Expect/limit routing
        // (parserOnIncoming); upgrades never reach that path.
        if (!is_upgrade) traceServerRequestStart(http_res);

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

        if (reachedRequestsLimit) {
          server.emit("dropRequest", http_req, socket);
          http_res.writeHead(503);
          http_res.end();
          if (isPipelined) {
            // The 503 is queued behind the in-flight responses; the connection
            // closes once it has been written, like Node.js (Connection: close).
            http_res[kMustCloseConnection] = true;
          } else {
            socket.destroy();
          }
        } else if (is_upgrade) {
          // Hand the raw socket over to the 'upgrade' listener, like Node.js.
          // Without a body the message is already complete: bytes that arrived
          // after the request head become the upgradeHead and the connection
          // switches into CONNECT-style tunnel mode immediately. With a body
          // (Node 26 semantics) the body keeps being parsed and delivered
          // through req; the connection only switches to tunnel mode once the
          // message completes, so the upgradeHead is empty and everything after
          // the end of the message reaches the socket as raw data.
          socketHandle.upgradeToTunnel(hasBody);
          socket[kEnableStreaming](true);
          detachSocketListenersForHandoff(socket);
          // Node frees the parser before emitting 'upgrade' (socket.parser === null there).
          releaseServerParserShim(socket, http_req);
          if (hasBody) {
            socket[kUpgradeIncoming] = http_req;
            http_req.once("end", clearUpgradeIncoming.bind(undefined, socket));
          }
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
          // Like CONNECT: the connection is detached from the HTTP request
          // machinery; hold the native callback open until the raw socket
          // closes.
          const { promise: upgradePromise, resolve: resolveUpgrade } = $newPromiseCapability(Promise);
          socket.once("close", resolveUpgrade);
          return upgradePromise;
        } else if (
          server.requireHostHeader &&
          (dispatchBits & DISPATCH_HAS_HOST) === 0 &&
          http_req.httpVersionMajor === 1 &&
          http_req.httpVersionMinor >= 1
        ) {
          // The native parser exempts Upgrade/CONNECT requests from its Host
          // check so they can dispatch through the 'upgrade'/'connect' events;
          // a request that fell through to normal dispatch instead must still
          // honor requireHostHeader, like Node.js.
          http_res.writeHead(400, { Connection: "close" });
          http_res.end();
        } else {
          if ((dispatchBits & DISPATCH_HAS_EXPECT) !== 0) {
            // Case-insensitive, token-boundary match like Node's
            // parserOnIncoming (RFC 7231 5.1.1: expectation values compare
            // case-insensitively); computed natively into the bitfield.
            if ((dispatchBits & DISPATCH_EXPECT_CONTINUE) !== 0) {
              if (server.listenerCount("checkContinue") > 0) {
                server.emit("checkContinue", http_req, http_res);
              } else {
                http_res.writeContinue();
                server.emit("request", http_req, http_res);
              }
            } else if (server.listenerCount("checkExpectation") > 0) {
              server.emit("checkExpectation", http_req, http_res);
            } else {
              http_res.writeHead(417);
              http_res.end();
            }
          } else {
            server.emit("request", http_req, http_res);
          }
        }

        socket.cork();

        if (isPipelined) {
          // Completion of a queued response is tracked through the pipeline
          // (advanceResponsePipeline) and its native handle, not this dispatch.
          return;
        }

        if (handle.finished || didFinish) {
          handle = undefined;
          http_res[kCloseCallback] = undefined;
          // Set in time only because end() defers the 'finish' emit to a
          // process.nextTick (see ServerResponse.prototype.end) and nothing
          // between the 'request' emit and here drains the tick queue.
          http_res[kDispatcherDetached] = true;
          http_res.detachSocket(socket);
          if (socket[kPipelinedResponses] !== undefined) {
            advanceResponsePipeline(server, socket);
          }
          return;
        }

        const { resolve, promise } = $newPromiseCapability(Promise);
        resolveFunction = resolve;

        return promise;
      },

      // Be very careful not to access (web) Request object
      // properties:
      // - request.url
      // - request.headers
      //
      // We want to avoid triggering the getter for these properties because
      // that will cause the data to be cloned twice, which costs memory & performance.
      // fetch(req, _server) {
      //   var pendingResponse;
      //   var pendingError;
      //   var reject = err => {
      //     if (pendingError) return;
      //     pendingError = err;
      //     if (rejectFunction) rejectFunction(err);
      //   };
      //   var reply = function (resp) {
      //     if (pendingResponse) return;
      //     pendingResponse = resp;
      //     if (resolveFunction) resolveFunction(resp);
      //   };
      //   const prevIsNextIncomingMessageHTTPS = isNextIncomingMessageHTTPS;
      //   isNextIncomingMessageHTTPS = isHTTPS;
      //   const http_req = new RequestClass(req, {
      //     [typeSymbol]: NodeHTTPIncomingRequestType.FetchRequest,
      //   });
      //   assignEventCallback(req, onRequestEvent.bind(http_req));
      //   isNextIncomingMessageHTTPS = prevIsNextIncomingMessageHTTPS;

      //   const upgrade = http_req.headers.upgrade;
      //   const http_res = new ResponseClass(http_req, { [kDeprecatedReplySymbol]: reply });
      //   http_req.socket[kInternalSocketData] = [server, http_res, req];
      //   server.emit("connection", http_req.socket);
      //   const rejectFn = err => reject(err);
      //   http_req.once("error", rejectFn);
      //   http_res.once("error", rejectFn);
      //   if (upgrade) {
      //     server.emit("upgrade", http_req, http_req.socket, kEmptyBuffer);
      //   } else {
      //     server.emit("request", http_req, http_res);
      //   }

      //   if (pendingError) {
      //     throw pendingError;
      //   }

      //   if (pendingResponse) {
      //     return pendingResponse;
      //   }

      //   var { promise, resolve: resolveFunction, reject: rejectFunction } = $newPromiseCapability(GlobalPromise);
      //   return promise;
      // },
    });

    getBunServerAllClosedPromise(this[serverSymbol]).$then(emitCloseNTServer.bind(this));
    isHTTPS = this[serverSymbol].protocol === "https";
    applyServerCustomOptions(this);

    if (this?._unref) {
      this[serverSymbol]?.unref?.();
    }

    if ($isCallable(onListen)) {
      this.once("listening", onListen);
    }

    setTimeout(emitListeningNextTick, 1, this, this[serverSymbol]?.hostname, this[serverSymbol]?.port);
  }
};

// Pushes the per-server parser/handler options down to the native listener.
// Always sets strict method validation, for node.js compatibility.
function applyServerCustomOptions(server: Server) {
  const handle = server[serverSymbol];
  if (!handle) return;
  setServerCustomOptions(
    handle,
    server.requireHostHeader,
    true,
    !!server.insecureHTTPParser,
    typeof server.maxHeaderSize !== "undefined" ? server.maxHeaderSize : getMaxHTTPHeaderSize(),
    onServerClientError.bind(server),
    onServerConnection.bind(server),
    !!server.httpAllowHalfOpen,
  );
}

function httpAllowHalfOpenGet(this: Server) {
  return this[kHttpAllowHalfOpen];
}

// Node reads `server.httpAllowHalfOpen` when the peer's FIN arrives (socketOnEnd), so
// assigning it after listen() has to reach the native listener too. Push the flags
// alone: setServerCustomOptions() would also re-register the connection filter, which
// appends rather than replaces and can reallocate the vector uWS is iterating.
function httpAllowHalfOpenSet(this: Server, value) {
  const previous = !!this[kHttpAllowHalfOpen];
  this[kHttpAllowHalfOpen] = value;
  const next = !!value;
  if (previous === next) return;
  const handle = this[serverSymbol];
  if (handle) setServerAppFlags(handle, this.requireHostHeader, true, !!this.insecureHTTPParser, next);
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

// Native callback fired when the server accepts a connection (for TLS, when
// its handshake completes), before any request bytes - like Node.js's
// net.Server 'connection' / tls.Server 'secureConnection' events.
function onServerConnection(this: Server, socketHandle) {
  if (socketHandle.duplex) {
    // Already wrapped (shouldn't happen for a brand-new connection).
    return;
  }
  const isTLS = !!this[tlsSymbol];
  const socket = new NodeHTTPServerSocket(this, socketHandle, isTLS);
  // Node's connectionListener attaches the HTTPParser (socket.parser) before
  // emitting 'connection'; expose the shim here so listeners see it populated.
  socket.parser = createServerParserShim(socket);
  this.emit("connection", socket);
  if (isTLS && socketHandle.secureEstablished) {
    this.emit("secureConnection", socket);
  }
}

// Like Node.js: server.setTimeout only records the per-socket inactivity
// timeout (and an optional 'timeout' listener); it is applied to each
// connection when it is established, via socket.setTimeout.
Server.prototype.setTimeout = function (msecs, callback) {
  this.timeout = msecs;
  if (typeof callback === "function") this.on("timeout", callback);
  return this;
};

function onServerRequestEvent(this: NodeHTTPServerSocket, event: NodeHTTPResponseAbortEvent) {
  const socket: NodeHTTPServerSocket = this;
  switch (event) {
    case NodeHTTPResponseAbortEvent.abort: {
      if (!socket.destroyed) {
        socket.destroy();
      }
      break;
    }
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
  HTTP_PARSER_ERROR_MISSING_HOST_HEADER = 4,
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
}
// Native callback fired when the HTTP parser rejects incoming bytes. Builds
// the same error object Node's parser produces and routes it through
// socketOnError, exactly like Node's onParserExecuteCommon: the server's
// 'clientError' listener (or the default handler) decides what to write back
// and when to destroy the connection.
function onServerClientError(ssl: boolean, socket: unknown, errorCode: number, rawPacket: ArrayBuffer) {
  const self = this as Server;
  // A prior request on this keep-alive connection may already have wrapped
  // the native handle (the native side returns the existing handle); a second
  // wrapper would overwrite its onclose/duplex and strand the first one in
  // kTrackedConnections. Reuse it, and only announce genuinely new
  // connections - the existing duplex already had its 'connection' event.
  const existingDuplex = (socket as any).duplex;
  const nodeSocket = existingDuplex ?? new NodeHTTPServerSocket(self, socket, ssl);
  if (!existingDuplex) {
    nodeSocket.parser = createServerParserShim(nodeSocket);
    self.emit("connection", nodeSocket);
  }

  if (errorCode === HttpParserError.HTTP_PARSER_ERROR_MISSING_HOST_HEADER) {
    replyMissingHostHeader(nodeSocket);
    return;
  }

  let err;
  switch (errorCode) {
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING:
      err = $HPE_INVALID_CHUNK_SIZE("Parse Error: Invalid character in chunk size");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH:
      err = $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error");
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
    default:
      err = $HPE_INTERNAL("Parse Error");
      break;
  }
  err.rawPacket = Buffer.from(rawPacket);
  socketOnError.$call(nodeSocket, err);
}

// Node answers an HTTP/1.1 request with no Host header from parserOnIncoming
// (res.writeHead(400, ['Connection', 'close']); res.end()), so no parse error
// reaches socketOnError and 'clientError' never fires for it.
function replyMissingHostHeader(socket) {
  if (!socket.writable) return;
  socket.end(
    `HTTP/1.1 400 Bad Request\r\nConnection: close\r\nDate: ${new Date().toUTCString()}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
  );
}

const kBytesWritten = Symbol("kBytesWritten");
const kEnableStreaming = Symbol("kEnableStreaming");
// Upgrade request whose body is still being parsed: reading the raw socket also
// resumes this request, like Node.js's UpgradeStream._read, so an unread body
// can never stall the upgrade data behind it.
const kUpgradeIncoming = Symbol("kUpgradeIncoming");

// Like Node.js's net.Socket onReadableStreamEnd: every socket carries one 'end'
// listener. http server connections have allowHalfOpen: true, so it is a no-op,
// but its presence is part of the listener set handed to 'connect'/'upgrade'.
function onReadableStreamEnd() {}

function clearUpgradeIncoming(socket) {
  socket[kUpgradeIncoming] = undefined;
}

// Node.js hands the connection over to 'connect'/'upgrade' listeners with the
// connection-listener set removed (onParserExecuteCommon removes its data/end/
// close/drain/error/timeout listeners) and only net.Socket's own 'end' listener
// left in place.
function detachSocketListenersForHandoff(socket) {
  socket.removeListener("error", socketOnError);
  socket.removeListener("timeout", onNodeHTTPServerSocketTimeout);
  socket.on("end", onReadableStreamEnd);
}
const kSocketTimeoutTimer = Symbol("socketTimeoutTimer");
const kStreamingEnabled = Symbol("kStreamingEnabled");
// Scratch options object for the builtin ServerResponse (see the dispatcher).
const scratchResponseOptions = {
  [kHandle]: undefined,
  highWaterMark: 0,
  [kRejectNonStandardBodyWrites]: false,
};
// Per-socket cached bound abort handler (the socket outlives its requests).
const kBoundOnAbort = Symbol("kBoundOnAbort");
const kKeepAliveTimeoutSet = Symbol("keepAliveTimeoutSet");
// When the keep-alive idle period on a connection started (the last response
// finish). onResponseFinishHandleSocket records this instead of rescheduling
// the socket timer on every response; onSocketTimeoutTimerExpired reads it to
// grant the remaining idle budget when the timer actually fires.
const kKeepAliveIdleStart = Symbol("keepAliveIdleStart");
// HTTP/1.1 pipelining (responses queued behind an in-flight response):
// - on the socket: array of queued ServerResponses, in arrival order
// - on a queued response: { ops, bytes, needDrain, ended, isAncient } while it
//   is queued (undefined once it owns the socket)
const kPipelinedResponses = Symbol("kPipelinedResponses");
const kPipelinedQueuedState = Symbol("kPipelinedQueuedState");
// Node's `state.outgoingData`: bytes buffered across this connection's queued
// responses. Reads are paused while it is at or above the high water mark.
const kOutgoingData = Symbol("kOutgoingData");
const kReplayingPipelinedOps = Symbol("kReplayingPipelinedOps");
const kStopParsingOnCloseListener = Symbol("kStopParsingOnCloseListener");
// Set when the dispatcher already detached a synchronously-finished response,
// so the 'finish' listener does not detach/advance the pipeline a second time.
const kDispatcherDetached = Symbol("kDispatcherDetached");

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
  this.on("error", noopOnError);

  const server = this.server;
  if (!server || !server.emit("clientError", err, this)) {
    // Caution must be taken to avoid corrupting the remote peer.
    // Reply an error segment if there is no in-flight `ServerResponse`,
    // or no data of the in-flight one has been written yet to this socket.
    const message = this._httpMessage;
    // Node checks _headerSent (bytes reached the socket), not headersSent
    // (writeHead called): after res.writeHead() but before write/end/flush,
    // no bytes are on the wire yet so the raw error response is still safe.
    if (this.writable && (!message || message[headerStateSymbol] !== NodeHTTPHeaderState.sent)) {
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
      // Write through the native handle so the raw error response reaches the
      // wire before the destroy below, regardless of the duplex's cork state.
      const handle = this[kHandle];
      if (handle && !handle.closed) {
        handle.write(response);
      } else {
        this.write(response);
      }
    }
    this.destroy(err);
  }
}
function noopOnError() {}

function onSocketTimeoutTimerExpired(socket) {
  // The keep-alive idle timer is left armed across the request to avoid a
  // clear + setTimeout cycle per request. A fire while a request is in
  // flight (kKeepAliveTimeoutSet was cleared on request arrival) is stale;
  // re-arm the timer so the response-finish fast path, which relies on it
  // staying live, keeps working, and bail. This runs at most once per idle
  // interval per busy connection, not once per request.
  if (socket.timeout === 0 && !socket[kKeepAliveTimeoutSet]) {
    socket[kSocketTimeoutTimer]?.refresh();
    return;
  }
  // onResponseFinishHandleSocket records when the last response finished
  // instead of rescheduling the timer on every response, so the timer's
  // deadline may predate the start of the real idle period. Grant the
  // remaining budget once, measured from that last finish. Gated on
  // kKeepAliveTimeoutSet so a fire of the server's regular per-socket
  // timeout (socket.timeout !== 0 with no response outstanding) never
  // consumes a stale keep-alive idle mark.
  const idleStart = socket[kKeepAliveIdleStart];
  if (idleStart !== undefined && socket[kKeepAliveTimeoutSet]) {
    socket[kKeepAliveIdleStart] = undefined;
    const remaining = socket.timeout - (DateNow() - idleStart);
    if (remaining > 0) {
      const existingTimer = socket[kSocketTimeoutTimer];
      if (existingTimer !== undefined) clearTimeout(existingTimer);
      const timer = setTimeout(onSocketTimeoutTimerExpired, remaining, socket);
      timer.unref();
      socket[kSocketTimeoutTimer] = timer;
      return;
    }
  }
  // A fired keep-alive idle timer is dead; drop the reference so the next
  // response-finish re-arms via setTimeout instead of trusting a fired
  // timer whose _idleTimeout still matches (a 'timeout' listener may keep
  // the socket alive). Only for the keep-alive case: the server.timeout
  // path relies on _unrefTimer() refreshing the fired timer in the slot,
  // like net.Socket.
  if (socket[kKeepAliveTimeoutSet]) {
    socket[kSocketTimeoutTimer] = undefined;
  }
  socket._onTimeout();
}

// Extends net.Socket so server connection sockets satisfy Node's class
// contract (`req.socket instanceof net.Socket`); all I/O still goes through
// the native NodeHTTP handle, not a net handle.
const NodeHTTPServerSocket = class Socket extends NetSocket {
  bytesRead = 0;
  connecting = false;
  timeout = 0;
  parser = null;
  [kStreamingEnabled] = false;
  [kBoundOnAbort] = null;
  [kKeepAliveIdleStart] = undefined;
  [kBytesWritten] = 0;
  [kHandle];
  [kUpgradeIncoming] = undefined;
  server: Server;
  _httpMessage;
  _secureEstablished = false;
  // Node's connectionListener sets socket._paused when it stops reading a
  // connection whose pipelined responses have buffered past the high water mark.
  _paused = false;
  #pendingCallback = null;
  #pendingAbortMessage;
  constructor(server: Server, handle, encrypted) {
    // allowHalfOpen: node's connectionListener sockets never auto-end the
    // writable side on the peer's FIN (CONNECT/Upgrade tunnels stay writable);
    // net.Socket would otherwise default it to false.
    super(
      server[kHighWaterMark] !== undefined
        ? { highWaterMark: server[kHighWaterMark], allowHalfOpen: true }
        : { allowHalfOpen: true },
    );
    // net.Socket's constructor wires net-handle machinery this class replaces:
    // its 'end' listener installs writeAfterFIN (breaks half-open tunnels), and
    // it forces emitClose/decodeStrings off while this class relies on the
    // Duplex defaults (destroy() emits 'close'; _write receives decoded chunks).
    this.removeAllListeners("end");
    this._writableState.emitClose = true;
    this._readableState.emitClose = true;
    this._writableState.decodeStrings = true;
    this.server = server;
    this[kHandle] = handle;
    this._secureEstablished = !!handle?.secureEstablished;
    handle.onclose = this.#onClose.bind(this);
    handle.duplex = this;

    this.encrypted = encrypted;
    this.on("timeout", onNodeHTTPServerSocketTimeout);
    // Like Node.js's socketOnError: connection errors are routed to the
    // server's 'clientError' event instead of crashing as unhandled 'error'
    // events on the socket.
    this.on("error", socketOnError);
    server[kTrackedConnections]?.add(this);
    // Like Node.js's connectionListener: server.setTimeout's per-socket
    // inactivity timeout is armed when the connection is established.
    const serverTimeout = server.timeout;
    if (serverTimeout) {
      this.setTimeout(serverTimeout);
    }
  }

  get bytesWritten() {
    const handle = this[kHandle];
    return handle
      ? (handle.response?.getBytesWritten?.() ?? handle.bytesWritten ?? this[kBytesWritten] ?? 0)
      : (this[kBytesWritten] ?? 0);
  }
  set bytesWritten(value) {
    this[kBytesWritten] = value;
  }

  [kEnableStreaming](enable: boolean) {
    // The common keep-alive request never streams: the dispatcher disables
    // streaming on every request, so track the state and skip the two native
    // setter crossings (writing undefined over undefined) when unchanged.
    if (this[kStreamingEnabled] === enable) {
      return;
    }
    const handle = this[kHandle];
    if (handle) {
      this[kStreamingEnabled] = enable;
      if (enable) {
        handle.ondata = this.#onData.bind(this);
        handle.ondrain = this.#onDrain.bind(this);
      } else {
        handle.ondata = undefined;
        handle.ondrain = undefined;
      }
    }
  }
  #onDrain() {
    const handle = this[kHandle];
    this[kBytesWritten] = handle ? (handle.response?.getBytesWritten?.() ?? handle.bytesWritten ?? 0) : 0;
    const callback = this.#pendingCallback;
    if (callback) {
      this.#pendingCallback = null;
      (callback as Function)();
    }
    this.emit("drain");
  }
  #onData(chunk, last) {
    this._unrefTimer();
    if (chunk) {
      this.push(chunk);
    }
    if (last) {
      const handle = this[kHandle];
      if (handle) {
        handle.ondata = undefined;
        this[kStreamingEnabled] = false;
        // The peer finished its writable side of a CONNECT/Upgrade tunnel. The
        // connection stays writable (allowHalfOpen), but - like Node, where the
        // detached socket stops reading and no longer keeps the process alive -
        // the never-used response for this request must not keep the event loop
        // alive either.
        handle.response?.unref();
      }

      this.push(null);
      // Like Node's net.Socket (and its UpgradeStream): EOF on a socket with no
      // pending data emits 'end' even when nothing is reading the socket.
      if (this.readableLength === 0) {
        this.resume();
      }
    }
  }
  #closeHandle(handle, callback, err?: Error) {
    this[kHandle] = undefined;
    // Capture the in-flight response before detachSocket() can clear it: a
    // synchronous res.destroy() inside the request handler runs detachSocket()
    // between here and the native close delivering #onClose. The abort itself
    // is deferred to #onClose so the dispatch promise resolves only after the
    // native on_abort has released the pending-request ref.
    this.#pendingAbortMessage = this._httpMessage;
    handle.onclose = this.#onCloseForDestroy.bind(this, callback, err);
    handle.close();
  }
  #onClose() {
    // freeParser equivalent: runs before 'close' listeners so they observe the
    // released parser (free() invoked, kOnTimeout nulled).
    releaseServerParserShim(this);
    this[kHandle] = null;
    this.server?.[kTrackedConnections]?.delete(this);
    const timer = this[kSocketTimeoutTimer];
    if (timer) {
      clearTimeout(timer);
      this[kSocketTimeoutTimer] = undefined;
    }

    // Node.js's `socketOnClose` → `abortIncoming()` only destroys requests
    // that are still in `state.incoming` — i.e. requests whose response has
    // not yet finished (`resOnFinish` does `incoming.shift()`). Our
    // equivalent of "still in the queue" is `_httpMessage` being non-null:
    // `detachSocket()` (called from `res.end()` / on `"finish"`) clears it.
    // Do NOT fall back to `this[kRequest]` here — `_httpMessage` is the
    // canonical "response still attached" indicator. (`detachSocket()` now
    // clears `kRequest` alongside `_httpMessage`, so the two agree after a
    // finished response; historically `kRequest` was never cleared and the
    // fallback aborted the request on every keep-alive close even after a
    // fully successful response, racing `req._dump()`'s nextTick into a
    // spurious `"aborted"` — seen as flakes in the express `res.sendFile`
    // suite where supertest closes the socket right after reading the body.)
    //
    // Gate on `!req.destroyed` rather than `!req.complete`: a body-less GET
    // flips `complete` before the response is written, so an aborted
    // connection would otherwise never reach `req.destroy()` →
    // `emit("close")` (test-http-should-emit-close-when-connection-is-aborted).
    //
    // `#pendingAbortMessage` is the `_httpMessage` captured when the destroy
    // was initiated from JS (`#closeHandle`). It is only honoured when the
    // captured response was itself destroy()ed: a `res.end()` followed by a
    // JS-initiated socket.destroy() also reaches detachSocket() via the
    // dispatcher's finished branch, and Node.js does not abort the request
    // once the response has finished (resOnFinish shifts state.incoming).
    const pending = this.#pendingAbortMessage;
    this.#pendingAbortMessage = undefined;
    const message = this._httpMessage ?? (pending?.destroyed ? pending : undefined);
    const req = message?.req;

    if (req && !req.destroyed && !req[kHandle]?.upgraded) {
      // At this point the socket is already destroyed; let's avoid UAF
      req[kHandle] = undefined;
      if (req.listenerCount("error") > 0) {
        req.destroy(new ConnResetException("aborted"));
      } else {
        req.destroy();
      }
    }

    // A response that was still attached to this socket (it had not finished
    // when the connection died) must emit 'close' too, exactly like Node.js's
    // onServerResponseClose socket listener does.
    if (message && !message._closed) {
      process.nextTick(emitCloseNT, message);
    }

    // Pipelined responses (and their requests) that were still queued behind
    // the in-flight response are aborted, like Node.js's socketOnClose
    // (abortIncoming + abortOutgoing).
    const pipelined = this[kPipelinedResponses];
    const pipelinedLength = pipelined ? pipelined.length : 0;
    if (pipelinedLength) {
      this[kPipelinedResponses] = undefined;
      for (let i = 0; i < pipelinedLength; i++) {
        const queuedRes = pipelined[i];
        const queuedReq = queuedRes.req;
        if (queuedReq && !queuedReq.destroyed) {
          queuedReq[kHandle] = undefined;
          if (queuedReq.listenerCount("error") > 0) {
            queuedReq.destroy(new ConnResetException("aborted"));
          } else {
            queuedReq.destroy();
          }
        }
        if (!queuedRes.destroyed) {
          queuedRes.destroy();
        } else if (!queuedRes._closed) {
          process.nextTick(emitCloseNT, queuedRes);
        }
      }
    }

    // Node's server connection socket emits 'close' whenever the TCP
    // connection closes, even with no request in flight (this also covers
    // tunneled/upgraded sockets, main's kIsTunnel case); reaching here from a
    // native close without a JS-initiated destroy must still surface it.
    if (!this.destroyed) {
      this.destroy();
    }
  }
  #onCloseForDestroy(closeCallback, err?: Error) {
    this.#onClose();
    // Thread the destroy error through to the streams machinery (like
    // Node.js's net.Socket._destroy passing the exception to its callback),
    // so socket.destroy(err) emits 'error' before 'close'.
    if ($isCallable(closeCallback)) closeCallback(err);
  }

  _onTimeout() {
    const handle = this[kHandle];
    const response = handle?.response;
    // If there is a response, and it has pending data,
    // we suppress the timeout because a write is in progress.
    if (response && response.writableLength > 0) {
      // Re-arm so the timeout still fires once the write actually stalls.
      this._unrefTimer();
      return;
    }
    this.emit("timeout");
  }
  _unrefTimer() {
    // Socket activity: push the inactivity timeout (socket.setTimeout /
    // server.timeout / keepAliveTimeout) further out, like Node.js's
    // net.Socket._unrefTimer.
    this[kSocketTimeoutTimer]?.refresh();
  }

  address() {
    return this[kHandle]?.remoteAddress || null;
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(_port, _host, _connectListener) {
    return this;
  }

  _destroy(err, callback) {
    const handle = this[kHandle];
    if (!handle) {
      if ($isCallable(callback)) callback(err);
      return;
    }
    handle.ondata = undefined;
    if (handle.closed) {
      const onclose = handle.onclose;
      handle.onclose = undefined;
      if ($isCallable(onclose)) {
        onclose.$call(handle);
      }
      if ($isCallable(callback)) callback(err);
      return;
    }

    this.#closeHandle(handle, callback, err);
  }

  _final(callback) {
    const handle = this[kHandle];
    if (!handle) {
      callback();
      return;
    }
    handle.end();
    callback();
  }

  get localAddress() {
    return this[kHandle]?.localAddress?.address;
  }

  get localFamily() {
    return this[kHandle]?.localAddress?.family;
  }

  get localPort() {
    return this[kHandle]?.localAddress?.port;
  }

  get pending() {
    return this.connecting;
  }

  #resumeSocket() {
    const handle = this[kHandle];
    const response = handle?.response;
    const upgradeIncoming = this[kUpgradeIncoming];
    if (upgradeIncoming) {
      // Upgrade with a body: reading the raw socket resumes the request so its
      // body keeps draining (Node's UpgradeStream._read). Request-body bytes
      // belong to the request stream, never to the raw upgrade stream, and the
      // socket does not end when the request body does.
      if (response) {
        const resumed = response.resume();
        if (resumed && resumed !== true) {
          upgradeIncoming.push(resumed);
        }
      }
      upgradeIncoming.resume();
      return;
    }
    if (response) {
      const resumed = response.resume();
      if (resumed && resumed !== true) {
        const bodyReadState = handle.hasBody;

        const message = this._httpMessage;
        const req = message?.req;

        if ((bodyReadState & NodeHTTPBodyReadState.done) !== 0) {
          emitServerSocketEOFNT(this, req);
        }
        if (req) {
          req.push(resumed);
        }
        this.push(resumed);
      }
    }
  }

  _read(_size) {
    // https://github.com/nodejs/node/blob/13e3aef053776be9be262f210dc438ecec4a3c8d/lib/net.js#L725-L737
    this.#resumeSocket();
  }

  get readyState() {
    if (this.connecting) return "opening";
    if (this.readable) {
      return this.writable ? "open" : "readOnly";
    } else {
      return this.writable ? "writeOnly" : "closed";
    }
  }

  // SNI hostname the client sent in its ClientHello, or false when the TLS
  // client sent none (matches Node's server-side TLSSocket.servername).
  get servername() {
    if (!this.encrypted) return undefined;
    const name = this[kHandle]?.servername;
    return typeof name === "string" && name.length > 0 ? name : false;
  }

  // Like Node's server-side TLSSocket: `authorized` is only ever true when the
  // server requested a client certificate and its verification succeeded;
  // `authorizationError` carries the X.509 verification error code otherwise.
  get authorized() {
    if (!this.encrypted) return undefined;
    if (!this.server?.[tlsSymbol]?.requestCert) return false;
    return this[kHandle]?.authorizationError === null;
  }

  get authorizationError() {
    if (!this.encrypted) return undefined;
    if (!this.server?.[tlsSymbol]?.requestCert) return null;
    return this[kHandle]?.authorizationError ?? null;
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

  setKeepAlive(_enable = false, _initialDelay = 0) {}

  setNoDelay(_noDelay = true) {
    return this;
  }

  // Like Node.js's net.Socket#setTimeout (setStreamTimeout): an unref'd
  // inactivity timer that emits 'timeout' on this socket. server.setTimeout,
  // server.keepAliveTimeout, req.setTimeout and res.setTimeout all funnel here.
  setTimeout(msecs, callback) {
    if (this.destroyed) {
      return this;
    }

    msecs = validateMsecs(msecs, "msecs");
    this.timeout = msecs;

    const existingTimer = this[kSocketTimeoutTimer];
    if (msecs === 0) {
      if (existingTimer) {
        clearTimeout(existingTimer);
        this[kSocketTimeoutTimer] = undefined;
      }
      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }
    } else {
      // The keep-alive cycle re-arms the same idle interval after every
      // response: refresh the existing timer instead of clear+allocate.
      if (existingTimer && existingTimer._idleTimeout === msecs) {
        existingTimer.refresh();
      } else {
        if (existingTimer) clearTimeout(existingTimer);
        const timer = setTimeout(onSocketTimeoutTimerExpired, msecs, this);
        timer.unref();
        this[kSocketTimeoutTimer] = timer;
      }
      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }
    return this;
  }

  setEncoding(_encoding) {
    const err = new Error("Changing the socket encoding is not allowed per RFC7230 Section 3.");
    err.code = "ERR_HTTP_SOCKET_ENCODING";
    throw err;
  }

  unref() {
    return this;
  }

  _write(_chunk, _encoding, _callback) {
    const handle = this[kHandle];
    let err;
    this._unrefTimer();
    try {
      if (handle) {
        const flushed = handle.write(_chunk, _encoding);
        if (!flushed && handle.ondrain) {
          // Streaming mode (CONNECT tunnels): wait for the native drain
          // callback before completing the write.
          this.#pendingCallback = _callback;
          return false;
        }
      }
    } catch (e) {
      err = e;
    }
    if (err) _callback(err);
    else _callback();
  }

  pause() {
    const handle = this[kHandle];
    const response = handle?.response;
    if (response) {
      response.pause();
    }

    return super.pause();
  }

  resume() {
    this.#resumeSocket();
    return super.resume();
  }

  get [kInternalSocketData]() {
    return this[kHandle]?.response;
  }
} as unknown as typeof import("node:net").Socket;

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

// A non-chunked message is terminated by the first empty line after the header
// fields, so it can carry neither a body nor trailers.
function hasInvalidTrailer(response) {
  if (willBeChunked(response)) return false;
  if (response._trailer) return true;
  const outHeaders = response[kOutHeaders];
  return outHeaders !== null && outHeaders["trailer"] !== undefined;
}

function _writeHead(statusCode, reason, obj, response) {
  const originalStatusCode = statusCode;
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(format("%s", originalStatusCode));
  }

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
          if (k) response.appendHeader(k[0], k[1]);
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
          throw $ERR_HTTP_TRAILER_INVALID("Trailers are invalid with this transfer encoding");
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
          if (k) response.appendHeader(k, obj[n + 1]);
        }
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      const length = keys.length;
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < length; i++) {
        k = keys[i];
        if (k) response.setHeader(k, obj[k]);
      }
    }
    if (hasInvalidTrailer(response)) {
      // The message is not chunk-framed, so `Trailer` is the offending header; drop it
      // so a caller that swallows the throw cannot put it on the wire.
      response.removeHeader("trailer");
      throw $ERR_HTTP_TRAILER_INVALID("Trailers are invalid with this transfer encoding");
    }
  }
}

Object.defineProperty(NodeHTTPServerSocket, "name", { value: "Socket" });

function ServerResponse(req, options): void {
  if (!(this instanceof ServerResponse)) return new ServerResponse(req, options);
  OutgoingMessage.$call(this, options);

  this.useChunkedEncodingByDefault = true;

  if ((this[kDeprecatedReplySymbol] = options?.[kDeprecatedReplySymbol])) {
    this[controllerSymbol] = undefined;
    this[firstWriteSymbol] = undefined;
    this[deferredSymbol] = undefined;
    this.write = ServerResponse_writeDeprecated;
    this.end = ServerResponse_finalDeprecated;
  }

  this.req = req;
  this.sendDate = true;
  this._sent100 = false;
  this[headerStateSymbol] = NodeHTTPHeaderState.none;
  this[kPendingCallbacks] = [];
  this.finished = false;

  // this is matching node's behaviour
  // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
  if (req.method === "HEAD") this._hasBody = false;

  if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
    this.useChunkedEncodingByDefault = chunkExpression.test(req.headers?.te ?? "");
    this.shouldKeepAlive = false;
  }

  if (options) {
    const handle = options[kHandle];

    if (handle) {
      this[kHandle] = handle;
    } else {
      this[kHandle] = req[kHandle];
    }
    // The in-server path passes this via the symbol key (see emitRequestEvent);
    // a user calling `new ServerResponse(req, { rejectNonStandardBodyWrites: true })`
    // passes the string key — which the OutgoingMessage constructor already
    // applied to the same shared symbol — so don't clobber it.
    const rejectNonStandardBodyWrites = options[kRejectNonStandardBodyWrites];
    if (rejectNonStandardBodyWrites !== undefined) {
      this[kRejectNonStandardBodyWrites] = rejectNonStandardBodyWrites;
    }
  } else {
    this[kHandle] = req[kHandle];
  }

  this.statusCode = 200;
  this.statusMessage = undefined;
  this.chunkedEncoding = false;
}
$toClass(ServerResponse, "ServerResponse", OutgoingMessage);

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
            res[kMustCloseConnection] = true;
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
        res[kMustCloseConnection] = true;
      }
    }

    // Like Node.js's _storeHeader: with no framing headers on the wire, removing
    // Transfer-Encoding makes the response close-delimited (the "both removed"
    // _last branch), while removing only Content-Length falls through to chunked
    // encoding and keeps the connection alive. Decide before the Connection
    // header is rendered so the advertised value matches the transport.
    let closeDelimited = false;
    let forceChunked = false;
    if (storedContentLength === undefined && storedTransferEncoding === undefined) {
      if (res._hasBody === false) {
        // HEAD / 204 / 304 / 1xx: there is no body to delimit, so removing the
        // framing headers must not close the connection (Node's _storeHeader
        // checks !_hasBody before its close-delimited else-branch).
      } else if (res._removedTE) {
        closeDelimited = true;
        res[kMustCloseConnection] = true;
      } else if (res._removedContLen) {
        // Node's _storeHeader only falls through to chunked when
        // useChunkedEncodingByDefault is set (false for HTTP/1.0 requests),
        // and the native writer never chunk-frames an HTTP/1.0 response, so
        // everything else is close-delimited like the _removedTE case.
        const req = res.req;
        if (res.useChunkedEncodingByDefault && req.httpVersionMajor >= 1 && req.httpVersionMinor >= 1) {
          forceChunked = true;
        } else {
          closeDelimited = true;
          res[kMustCloseConnection] = true;
        }
      }
    }

    if (res._removedConnection) {
      // Node's _storeHeader: `this._last = !this.shouldKeepAlive` - no
      // Connection header is written (the user removed it), but the socket
      // still closes after 'finish' when shouldKeepAlive was cleared.
      if (res.shouldKeepAlive === false) {
        res[kMustCloseConnection] = true;
      }
    } else if (!hasConnection) {
      if (
        !defectiveNoBodyResponse &&
        !closeDelimited &&
        !res.maxRequestsOnConnectionReached &&
        res.shouldKeepAlive !== false &&
        requestShouldKeepAlive(res.req)
      ) {
        const keepAliveTimeout = res._keepAliveTimeout;
        const maxRequestsPerSocket = res._maxRequestsPerSocket;
        if (keepAliveTimeout && !hasKeepAlive && ~~maxRequestsPerSocket > 0) {
          // Rare path (maxRequestsPerSocket set): render both lines in JS.
          flat.push("Connection", "keep-alive");
          flat.push("Keep-Alive", `timeout=${MathFloor(keepAliveTimeout / 1000)}, max=${maxRequestsPerSocket}`);
        } else {
          autoHeaders |= AUTO_HEADER_CONN_KEEP_ALIVE;
          if (keepAliveTimeout && !hasKeepAlive) {
            autoHeaders |= AUTO_HEADER_KEEP_ALIVE_TIMEOUT;
            keepAliveSecs = MathFloor(keepAliveTimeout / 1000);
          }
        }
      } else {
        // Like Node's shouldSendKeepAlive/_last handling: a user-cleared
        // shouldKeepAlive (graceful-shutdown helpers set it on in-flight
        // responses) must also end the socket after 'finish'.
        if (res.shouldKeepAlive === false) {
          res[kMustCloseConnection] = true;
        }
        autoHeaders |= AUTO_HEADER_CONN_CLOSE;
      }
    }

    if (res._hasBody === false) {
      // A method-based no-body response (HEAD): the native side only knows
      // 204/304 from the status line, so signal no-body explicitly. Any
      // user-set framing headers are still advertised, but the body framing
      // itself (auto Content-Length/Transfer-Encoding and the terminating
      // chunk) is suppressed, like Node.js's `_hasBody && chunkedEncoding`
      // gate - a HEAD response ends at the first empty line whatever headers
      // it carries (RFC 9112 6.3).
      flat.push("\u0000", "2");
    }

    if (closeDelimited) {
      // The NUL-named sentinel pair tells the native writeHead the body is
      // close-delimited: written raw, with the connection closed after the
      // response (it is not a real header).
      flat.push("\u0000", "1");
    } else if (forceChunked) {
      // The user removed Content-Length (only): advertise chunked so the native
      // side frames the body instead of auto-writing the removed header back.
      flat.push("Transfer-Encoding", "chunked");
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

const kMustCloseConnection = Symbol("kMustCloseConnection");
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
  // req.socket is nulled by the stream destroyer (pipeline/compose cleanup);
  // the response's own socket (set by assignSocket, cleared only by
  // detachSocket) still references the connection then.
  const socket = this.req?.socket ?? this.socket;
  onResponseFinishHandleSocket(socket?.server, socket, this);
  // The dispatcher detached a synchronously-finished response itself;
  // advancing the pipeline again here would skip a queued response.
  if (this[kDispatcherDetached]) return;
  if (socket != null) this.detachSocket(socket);
  advanceResponsePipeline(socket?.server, socket);
}

// Runs when a response has finished, like the transport-related half of
// Node.js's resOnFinish: either end the connection (responses that must
// close) or arm the keep-alive idle timeout so an idle kept-alive connection
// is eventually closed.
function onResponseFinishHandleSocket(server, socket, res) {
  if (res[kMustCloseConnection]) {
    socket?.end();
    return;
  }
  if (!socket || socket.destroyed || typeof socket.setTimeout !== "function") {
    return;
  }
  // Another response is already in flight on this connection (pipelining):
  // it is not idle, so leave its timeout alone.
  if (socket._httpMessage && socket._httpMessage !== res) {
    return;
  }
  // Pipelined responses are still queued behind this one: the connection is
  // not idle, so do not arm the keep-alive idle timeout yet.
  if (socket[kPipelinedResponses]?.length) {
    return;
  }
  const rawKeepAliveTimeout = server.keepAliveTimeout;
  const keepAliveTimeout = Number.isFinite(rawKeepAliveTimeout) && rawKeepAliveTimeout >= 0 ? rawKeepAliveTimeout : 0;
  const rawKeepAliveBuffer = server.keepAliveTimeoutBuffer;
  const keepAliveTimeoutBuffer =
    Number.isFinite(rawKeepAliveBuffer) && rawKeepAliveBuffer >= 0 ? rawKeepAliveBuffer : 1000;
  if (keepAliveTimeout) {
    // Extend the internal timeout by the configured buffer to reduce
    // the likelihood of ECONNRESET errors, like Node.js's resOnFinish.
    const total = keepAliveTimeout + keepAliveTimeoutBuffer;
    // Rescheduling the socket timer on every response finish was the single
    // largest per-request cost of the keep-alive path. Once the timer is
    // armed with this exact interval (every response after the first on a
    // kept-alive connection), leave it in place and only record when this
    // idle period started; onSocketTimeoutTimerExpired grants the remaining
    // budget if the timer fires early, so the socket still closes after
    // exactly `total` ms of idle.
    const timer = socket[kSocketTimeoutTimer];
    if (timer !== undefined && timer._idleTimeout === total) {
      socket.timeout = total;
    } else {
      socket.setTimeout(total);
    }
    socket[kKeepAliveIdleStart] = DateNow();
    socket[kKeepAliveTimeoutSet] = true;
  }
}

// Node.js's socketOnClose frees the parser, which aborts parsing of any
// pipelined requests still sitting in the current buffer - even when 'close'
// was emitted manually by user code.
function onSocketCloseStopParsing(this: NodeHTTPServerSocket) {
  this[kHandle]?.stopParsing?.();
}

// The second half of Node's read gate (lib/_http_server.js): uWS already pauses
// reads when the transport has unsent bytes (Node's `ws.needDrain`); these bytes
// sit in the JS queue and never reach the socket while the response is queued.
function pausePipelineReads(socket) {
  const response = socket[kHandle]?.response;
  if (!response) return;
  socket._paused = true;
  response.pause();
}

function addPipelineOutgoingData(queued, bytes) {
  const socket = queued.socket;
  socket[kOutgoingData] = (socket[kOutgoingData] ?? 0) + bytes;
}

// Like Node's socketOnDrain: the buffered bytes are handed to the transport when
// the response is flushed, so they stop gating reads (_flushOutput calls
// `_onPendingData(-outputSize)`).
function releasePipelineOutgoingData(socket, bytes) {
  const outgoing = (socket[kOutgoingData] ?? 0) - bytes;
  socket[kOutgoingData] = outgoing > 0 ? outgoing : 0;
  if (socket._paused && outgoing <= socket.writableHighWaterMark) {
    socket._paused = false;
    socket[kHandle]?.response?.resume();
  }
}

// Like the tail of Node.js's resOnFinish: when a response finishes and
// pipelined responses are queued behind it, the next one becomes the
// connection's current response, is assigned the socket, and its buffered
// output is flushed.
function advanceResponsePipeline(server, socket) {
  // The previous response on this connection closed it (Connection: close,
  // HTTP/1.0, maxRequestsPerSocket): like Node.js's resOnFinish, advancing
  // the pipeline is mutually exclusive with closing the socket - the queued
  // responses are aborted by the socket close path instead of being replayed
  // onto a half-closed connection.
  if (!socket || socket.writableEnded || socket.destroyed) {
    return;
  }
  const queue = socket[kPipelinedResponses];
  if (!queue || queue.length === 0) {
    return;
  }
  const res = queue.shift();
  const queued = res[kPipelinedQueuedState];
  res[kPipelinedQueuedState] = undefined;
  releasePipelineOutgoingData(socket, queued.bytes);
  const handle = res[kHandle];
  const socketHandle = socket[kHandle];

  if (res.destroyed || !handle) {
    // The queued response was destroyed before it could be sent; the
    // connection cannot produce a response for this slot, so it is unusable.
    if (!socket.destroyed) {
      socket.destroy();
    }
    return;
  }

  if (
    !socketHandle ||
    socket.destroyed ||
    !socketHandle.startPipelinedResponse(handle, !!queued.isAncient, !requestShouldKeepAlive(res.req))
  ) {
    // The connection is already gone; the socket close path destroys queued
    // responses, but make sure this (already dequeued) one is not skipped.
    if (!res.destroyed) {
      res.destroy();
    }
    return;
  }

  if (res.assignSocket === ServerResponse.prototype.assignSocket) {
    assignSocketInternal(res, socket);
  } else {
    res.assignSocket(socket);
  }
  socket[kRequest] = res.req;

  // Replay the writes buffered while the response was queued.
  // The buffered bytes are handed to the native handle below, so they no
  // longer count as pending output (Node's _flush does the same).
  res.outputSize = 0;
  const ops = queued.ops;
  const opsLength = ops.length;
  let lastWriteResult = true;
  if (opsLength) {
    // `finished` was set when the user called end() on the queued response;
    // clear it for the replay so the real write()/end() (end re-sets it) do
    // not treat the buffered calls as write-after-end.
    if (queued.ended) {
      res.finished = false;
    }
    res[kReplayingPipelinedOps] = true;
    try {
      for (let i = 0; i < opsLength; i++) {
        const op = ops[i];
        const kind = op[0];
        if (kind === "raw") {
          // Buffered 1xx bytes: route through the same AsyncSocket buffer the
          // response's own writeHead/end use so they precede the final response.
          handle.writeInformational(op[1], op[2]);
          if (typeof op[3] === "function") process.nextTick(op[3]);
        } else if (kind === "write") {
          lastWriteResult = res.write(op[1], op[2], op[3]);
        } else {
          res.end(op[1], op[2], op[3]);
        }
      }
    } finally {
      res[kReplayingPipelinedOps] = false;
    }
  }
  if (queued.needDrain && !queued.ended) {
    // write() reported backpressure to the user while the response was queued.
    // If the flush itself hit transport backpressure the native drain callback
    // registered by write() emits 'drain'; otherwise emit it now that the
    // buffered bytes have been handed to the transport.
    if (lastWriteResult !== false) {
      process.nextTick(emitPipelinedDrainNT, res);
    }
  }
}

function markResponseEndedNT(res) {
  res._ended = true;
}

function emitPipelinedDrainNT(res) {
  if (!res.destroyed && !res.finished) {
    res.emit("drain");
  }
}

// write()/end() on a response that is still queued behind an in-flight
// pipelined response: buffer the call (Node.js buffers through outputData
// while no socket is assigned) and report backpressure against the high water
// mark so 'drain' semantics match.
// Node's _storeHeader pushes the serialized header block through outputData, so a
// queued response's outputSize - and the connection's outgoingData that gates
// pipelined reads - counts header bytes, not just body chunks. Bun renders the
// block natively at replay, so account its size when the first buffered op fixes
// the headers. Without it every queued response contributes only its chunk
// length; power-of-two chunks can then land outgoingData exactly on
// writableHighWaterMark and pause reads one request earlier than Node would,
// deadlocking clients that pipeline the unblocking request behind the crossing
// one (test-http-pipeline-socket-parser-typeerror).
function accountQueuedHeaderBytes(res, queued) {
  if (queued.headerBytes !== 0) {
    return;
  }
  // Status line: "HTTP/1.1 NNN <message>\r\n".
  let bytes = 15 + String(res.statusMessage ?? STATUS_CODES[res.statusCode] ?? "unknown").length;
  const outHeaders = res[kOutHeaders];
  if (outHeaders !== null && outHeaders !== undefined) {
    for (const key in outHeaders) {
      const entry = outHeaders[key];
      if (!entry) continue;
      const value = entry[1];
      if ($isJSArray(value)) {
        for (let i = 0; i < value.length; i++) {
          bytes += entry[0].length + 4 + String(value[i]).length;
        }
      } else {
        bytes += entry[0].length + 4 + String(value).length;
      }
    }
  }
  // Headers the native writer adds when absent, with their literal serialized
  // lengths: "Date: <29-byte IMF-fixdate>\r\n" (37), "Connection: keep-alive\r\n"
  // (24), "Transfer-Encoding: chunked\r\n" (28), plus the terminating "\r\n".
  if (!res.hasHeader("date")) bytes += 37;
  if (!res.hasHeader("connection")) bytes += 24;
  if (!res.hasHeader("content-length") && !res.hasHeader("transfer-encoding")) bytes += 28;
  bytes += 2;
  queued.headerBytes = bytes;
  queued.bytes += bytes;
  res.outputSize += bytes;
  addPipelineOutgoingData(queued, bytes);
}

function bufferPipelinedWrite(res, queued, chunk, encoding, callback) {
  callWriteHeadIfObservable(res, res[headerStateSymbol]);
  if (res[headerStateSymbol] === NodeHTTPHeaderState.none) {
    updateHasBody(res, res.statusCode);
  }
  accountQueuedHeaderBytes(res, queued);
  if (chunk && !res._hasBody) {
    if (res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    }
    // node.js just ignores the write in this case
    chunk = undefined;
  }
  queued.ops.push(["write", chunk, encoding, callback]);
  if (chunk) {
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    queued.bytes += bytes;
    // Node buffers these writes through outputData while no socket is
    // assigned, so outputSize reflects them until the response is flushed.
    res.outputSize += bytes;
    addPipelineOutgoingData(queued, bytes);
  }
  if (queued.bytes >= res.writableHighWaterMark) {
    queued.needDrain = true;
    return false;
  }
  return true;
}

function bufferPipelinedEnd(res, queued, chunk, encoding, callback) {
  callWriteHeadIfObservable(res, res[headerStateSymbol]);
  if (res[headerStateSymbol] === NodeHTTPHeaderState.none) {
    updateHasBody(res, res.statusCode);
  }
  accountQueuedHeaderBytes(res, queued);
  if (chunk && !res._hasBody) {
    if (res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    }
    chunk = undefined;
  }
  queued.ops.push(["end", chunk, encoding, callback]);
  if (chunk) {
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    queued.bytes += bytes;
    // Node buffers these writes through outputData while no socket is
    // assigned, so outputSize reflects them until the response is flushed.
    res.outputSize += bytes;
    addPipelineOutgoingData(queued, bytes);
  }
  queued.ended = true;
  res.finished = true;
  return res;
}

const RE_CONN_CLOSE = /(?:^|\W)close(?:$|\W)/i;

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

// Result of shouldKeepAliveForConnection, computed once at dispatch and
// reused by renderNativeHeaders / the pipelined-response path so neither has
// to re-read req.headers (which would materialize the lazy header object).

function requestShouldKeepAlive(req) {
  if (!req) return true;
  const cached = req[kReqShouldKeepAlive];
  if (cached !== undefined) return cached;
  return (req[kReqShouldKeepAlive] = shouldKeepAliveForConnection(req, req.headers.connection));
}

function isHTTPServerHeaderStateSentOrAssigned(state) {
  return state === NodeHTTPHeaderState.sent || state === NodeHTTPHeaderState.assigned;
}

// In Node.js writeHead() renders the header block immediately, so mutating
// headers afterwards throws ERR_HTTP_HEADERS_SENT. Our headers are rendered
// lazily right before the native writeHead, so mirror the throwing behavior
// by also checking the header state, then defer to the OutgoingMessage
// implementations.
function throwIfServerHeadersSent(self, action) {
  if (isHTTPServerHeaderStateSentOrAssigned(self[headerStateSymbol])) {
    throw $ERR_HTTP_HEADERS_SENT(action);
  }
}

ServerResponse.prototype.setHeader = function setHeader(name, value) {
  throwIfServerHeadersSent(this, "set");
  return OutgoingMessagePrototype.setHeader.$call(this, name, value);
};

ServerResponse.prototype.appendHeader = function appendHeader(name, value) {
  throwIfServerHeadersSent(this, "append");
  return OutgoingMessagePrototype.appendHeader.$call(this, name, value);
};

ServerResponse.prototype.setHeaders = function setHeaders(headers) {
  throwIfServerHeadersSent(this, "set");
  return OutgoingMessagePrototype.setHeaders.$call(this, headers);
};

ServerResponse.prototype.removeHeader = function removeHeader(name) {
  throwIfServerHeadersSent(this, "remove");
  return OutgoingMessagePrototype.removeHeader.$call(this, name);
};

// res.headers / res.headers= are Bun-specific conveniences kept for backwards
// compatibility; they are views over the Node.js-style header storage.
Object.defineProperty(ServerResponse.prototype, "headers", {
  get() {
    return this.getHeaders();
  },
  set(value) {
    throwIfServerHeadersSent(this, "set");
    this[kOutHeaders] = null;
    if (!value) return;
    if ($isArray(value)) {
      // Array of [name, value] pairs, like the WHATWG Headers sequence init.
      for (const { 0: key, 1: val } of value) {
        this.appendHeader(key, val);
      }
    } else if (typeof value.entries === "function") {
      for (const { 0: key, 1: val } of value.entries()) {
        this.appendHeader(key, val);
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
    if (this[kPipelinedQueuedState] !== undefined) {
      // Queued pipelined response: like Node.js, res.socket is null until the
      // response is assigned the socket.
      return null;
    }
    return (this[fakeSocketSymbol] ??= new FakeSocket(this));
  },
  set(value) {
    this[fakeSocketSymbol] = value;
    // Keep the OutgoingMessage storage in sync: the standalone no-handle path
    // routes through OutgoingMessage.write/end, whose kSocket-gated checks
    // (_finish()/'prefinish', _flushOutput) must see the assigned socket.
    this[kSocket] = value;
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

// The native-handle path ignores this flag (uWS does the chunk framing), but
// the standalone path (no kHandle, assignSocket()) goes through the upstream
// _storeHeader/write_/end machinery, which sets and reads it to frame the
// body - so it needs real storage.
Object.defineProperty(ServerResponse.prototype, "chunkedEncoding", {
  get() {
    return this[kChunkedEncoding] ?? false;
  },
  set(value) {
    this[kChunkedEncoding] = value;
  },
});

Object.defineProperty(ServerResponse.prototype, "writableCorked", {
  get() {
    return this.socket?.writableCorked ?? 0;
  },
  set(_value) {},
});

ServerResponse.prototype.cork = function cork() {
  // socket is null while this response is queued behind a pipelined response.
  this.socket?.cork();
};

ServerResponse.prototype.uncork = function uncork() {
  this.socket?.uncork();
};

ServerResponse.prototype.setTimeout = function setTimeout(msecs, callback) {
  // Like OutgoingMessage.prototype.setTimeout: the callback listens on the
  // response's 'timeout' event (emitted by onNodeHTTPServerSocketTimeout);
  // only msecs is delegated to the socket.
  if (callback) this.on("timeout", callback);
  if (!this[fakeSocketSymbol]) {
    this.once("socket", function socketSetTimeoutOnConnect(socket) {
      socket.setTimeout(msecs);
    });
  } else {
    this.socket.setTimeout(msecs);
  }

  return this;
};

ServerResponse.prototype._removedConnection = false;

ServerResponse.prototype._removedContLen = false;

ServerResponse.prototype._hasBody = true;

ServerResponse.prototype._ended = false;

ServerResponse.prototype[kRejectNonStandardBodyWrites] = undefined;

Object.defineProperty(ServerResponse.prototype, "headersSent", {
  get() {
    return (
      this[headerStateSymbol] === NodeHTTPHeaderState.sent || this[headerStateSymbol] === NodeHTTPHeaderState.assigned
    );
  },
  set(value) {
    this[headerStateSymbol] = value ? NodeHTTPHeaderState.sent : NodeHTTPHeaderState.none;
  },
});

ServerResponse.prototype._writeRaw = function (chunk, encoding, callback) {
  if (!this[kHandle]) {
    // Standalone path: OutgoingMessage._writeRaw buffers to outputData while
    // no socket is assigned yet (kSocket is null) and flushes the buffer
    // ahead of the chunk once one is - writing through the auto-creating
    // `socket` getter here would drop the bytes into a FakeSocket.
    return OutgoingMessagePrototype._writeRaw.$apply(this, arguments);
  }
  const queued = this[kPipelinedQueuedState];
  if (queued !== undefined) {
    // Queued pipelined response: like Node.js (which buffers to outputData
    // while no socket is assigned and flushes on assignSocket), buffer the
    // raw 1xx bytes and write them ahead of the buffered body once this
    // response reaches the head of the pipeline.
    queued.ops.push(["raw", chunk, encoding, callback]);
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    queued.bytes += bytes;
    this.outputSize += bytes;
    addPipelineOutgoingData(queued, bytes);
    return queued.bytes < this.writableHighWaterMark;
  }
  // Write through the response handle's AsyncSocket buffer (same path as
  // writeHead/end) so 1xx lines share ordering with the final response bytes;
  // socket.write() would land in the socket handle's separate stream buffer.
  this[kHandle].writeInformational(chunk, encoding);
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
  if (!this[kHandle] || this[kPipelinedQueuedState] !== undefined) {
    // Standalone path (no native handle) or queued pipelined response (no
    // socket yet): route through writeInformation like Node.js v26.3.0 so the
    // 100 Continue line is buffered and written once a socket is assigned.
    this.writeInformation(100, null, cb);
    this._sent100 = true;
    return;
  }
  this.socket?.[kHandle]?.response?.writeContinue();
  this._sent100 = true;
  cb?.();
};

// This end method is actually on the OutgoingMessage prototype in Node.js
// But we don't want it for the fetch() response version.
ServerResponse.prototype.end = function (chunk, encoding, callback) {
  const handle = this[kHandle];
  if (handle?.aborted) {
    return this;
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

  if (hasServerResponseFinished(this, chunk, callback)) {
    return this;
  }

  {
    // HTTP/1.1 pipelining: this response is queued behind an in-flight
    // response - buffer the end() until it is assigned the socket.
    const queuedState = this[kPipelinedQueuedState];
    if (queuedState !== undefined) {
      return bufferPipelinedEnd(this, queuedState, chunk, encoding, callback);
    }
  }

  if (!handle) {
    // Read the storage directly - the `socket` getter auto-creates a
    // FakeSocket and would make this condition always true.
    if (this[fakeSocketSymbol] || this.outputData?.length || !this._header) {
      // Standalone response writing through an assigned socket (or buffering
      // until one is assigned): use the OutgoingMessage machinery. The
      // original chunk passes through (mirroring write()): write_() has its
      // own !_hasBody handling, including the rejectNonStandardBodyWrites
      // throw, which the clearing below would bypass.
      return OutgoingMessagePrototype.end.$call(this, chunk, encoding, callback);
    }
    if ($isCallable(callback)) {
      process.nextTick(callback);
    }
    return this;
  }

  if (this[headerStateSymbol] === NodeHTTPHeaderState.none) {
    // Implicit header: Node's write_() runs _implicitHeader() (which derives
    // _hasBody from the status code) unconditionally before its !_hasBody
    // discard - not gated on the chunk, or an empty first write would flip
    // the header state without deriving _hasBody and a later body write to
    // a 204/304 would reach the wire chunk-framed with no terminator.
    // updateHasBody only ever clears _hasBody, so this is idempotent.
    updateHasBody(this, this.statusCode);
  }
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
  if (
    trailer &&
    this._hasBody &&
    !this.hasHeader("content-length") &&
    this.req?.httpVersionMajor === 1 &&
    this.req?.httpVersionMinor >= 1
  ) {
    this.socket?.[kHandle]?.setResponseTrailers(trailer);
  }

  const headerState = this[headerStateSymbol];
  callWriteHeadIfObservable(this, headerState);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // node.js will return true if the handle is closed but the internal state is not
    // and will not throw or emit an error
    return true;
  }
  const sentState = NodeHTTPHeaderState.sent;
  if (headerState !== sentState) {
    {
      const renderedHeaders = renderNativeHeaders(this);
      try {
        // One native crossing for cork + writeHead + end (writeHeadAndEnd
        // corks natively around both phases).
        this._contentLength = handle.writeHeadAndEnd(
          this[kSnapshotStatusCode] ?? this.statusCode,
          this[kSnapshotStatusMessage] ?? this.statusMessage,
          renderedHeaders,
          chunk,
          encoding,
          strictContentLength(this),
          renderedAutoHeaders,
          renderedKeepAliveSecs,
        );
      } catch (e) {
        releaseRenderedHeaders(renderedHeaders);
        // Mirror the old two-call flow's headersSent semantics: errors from
        // the write-head phase (the batch's upfront gate, status validation,
        // headers-already-sent) leave the state unset; anything after that
        // point threw with headers already on the wire, exactly like
        // handle.end throwing after handle.writeHead succeeded.
        const code = e?.code;
        if (
          code !== "ERR_STREAM_ALREADY_FINISHED" &&
          code !== "ERR_HTTP_HEADERS_SENT" &&
          code !== "ERR_INVALID_CHAR" &&
          !(e instanceof RangeError)
        ) {
          this[headerStateSymbol] = sentState;
        }
        throw e;
      }
      releaseRenderedHeaders(renderedHeaders);
      this[headerStateSymbol] = sentState;
    }
  } else {
    // If there's no data but you already called end, then you're done.
    // We can ignore it in that case. `flags` was read above in the same tick
    // (no native call in between can change it), so reuse its bits instead of
    // paying two more native getter crossings.
    if (!(!chunk && flags & NodeHTTPResponseFlags.ended) && !(flags & NodeHTTPResponseFlags.socket_closed)) {
      handle.end(chunk, encoding, undefined, strictContentLength(this));
    }
  }
  this._header = " ";
  const req = this.req;
  if (!req._consuming && !req?._readableState?.resumeScheduled) {
    req._dump();
  }
  // The socket is NOT detached here: like Node.js, res.socket stays assigned
  // until the response 'finish' machinery runs (the dispatcher detaches it
  // right after a synchronously-finished handler returns, or via its 'finish'
  // listener otherwise), so handlers can still reach res.socket after end().
  this.finished = true;
  process.nextTick(markResponseEndedNT, this);
  this.emit("prefinish");
  this._callPendingCallbacks();

  // Deferring the 'finish' emit to nextTick is load-bearing: the dispatcher
  // sets kDispatcherDetached only after a sync-finished handler returns, so
  // an emit before that would detach and advance the pipeline twice.
  if (callback) {
    process.nextTick(
      function (callback, self) {
        // In Node.js, the "finish" event triggers the "close" event.
        // So it shouldn't become closed === true until after "finish" is emitted and the callback is called.
        self.emit("finish");
        try {
          callback();
        } catch (err) {
          self.emit("error", err);
        }

        process.nextTick(emitCloseNT, self);
      },
      callback,
      this,
    );
  } else {
    process.nextTick(function (self) {
      self.emit("finish");
      process.nextTick(emitCloseNT, self);
    }, this);
  }

  return this;
};

Object.defineProperty(ServerResponse.prototype, "writable", {
  // Node.js's OutgoingMessage assigns `this.writable = true` in the
  // constructor and never flips it back to false - not on end(), not on
  // destroy(), not when the peer aborts (see upstream
  // test-http-writable-true-after-close).
  get() {
    return true;
  },
  set(_value) {},
});

ServerResponse.prototype.write = function (chunk, encoding, callback) {
  const handle = this[kHandle];

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

  if (hasServerResponseFinished(this, chunk, callback)) {
    return false;
  }

  {
    // HTTP/1.1 pipelining: this response is queued behind an in-flight
    // response - buffer the write until it is assigned the socket.
    const queuedState = this[kPipelinedQueuedState];
    if (queuedState !== undefined) {
      return bufferPipelinedWrite(this, queuedState, chunk, encoding, callback);
    }
  }

  let result = 0;

  const headerState = this[headerStateSymbol];
  callWriteHeadIfObservable(this, headerState);

  if (!handle) {
    // Route through the OutgoingMessage machinery (mirroring end()'s
    // standalone fallback) so headers are rendered and chunk framing applied
    // before anything reaches the assigned socket. Writing to `this.socket`
    // directly would emit the raw body bytes ahead of the header block.
    // The original chunk passes through untouched: write_() has its own
    // !_hasBody discard, and clearing it to undefined here would trip
    // write_()'s chunk-type validation instead.
    return OutgoingMessagePrototype.write.$call(this, chunk, encoding, callback);
  }

  if (this[headerStateSymbol] === NodeHTTPHeaderState.none) {
    // Implicit header: Node's write_() runs _implicitHeader() (which derives
    // _hasBody from the status code) unconditionally before its !_hasBody
    // discard - not gated on the chunk, or an empty first write would flip
    // the header state without deriving _hasBody and a later body write to
    // a 204/304 would reach the wire chunk-framed with no terminator.
    // updateHasBody only ever clears _hasBody, so this is idempotent.
    updateHasBody(this, this.statusCode);
  }
  if (chunk && !this._hasBody) {
    if (this[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      // node.js just ignores the write in this case
      chunk = undefined;
    }
  }

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // node.js will return true if the handle is closed but the internal state is not
    // and will not throw or emit an error
    return true;
  }

  if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
    handle.cork(() => {
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
        // A throwing writeHead (status validation) must not leave the shared
        // scratch array marked busy for the rest of the process.
        releaseRenderedHeaders(renderedHeaders);
      }

      // If handle.writeHead throws, we don't want headersSent to be set to true.
      // So we set it here.
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;
      result = handle.write(chunk, encoding, allowWritesToContinue.bind(this), strictContentLength(this));
    });
  } else {
    result = handle.write(chunk, encoding, allowWritesToContinue.bind(this), strictContentLength(this));
  }

  if (result < 0) {
    if (callback) {
      // The write was buffered due to backpressure.
      // We need to defer the callback until the write actually goes through.
      this[kPendingCallbacks].push(callback);
    }
    return false;
  }

  this._callPendingCallbacks();
  if (callback) {
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
  // While replaying the writes a pipelined response buffered before it was
  // assigned the socket, skip the per-turn accounting: 'drain' for those
  // writes is handled by advanceResponsePipeline / the native drain callback.
  if (written > 0 && !this[kReplayingPipelinedOps]) {
    this[kBytesBuffered] = (this[kBytesBuffered] ?? 0) + written;
    scheduleWriteAccountingFlush(this);
    if (this[kBytesBuffered] >= this.writableHighWaterMark) {
      return false;
    }
  }

  return true;
};

const kBytesBuffered = Symbol("kBytesBuffered");
const kAccountingFlushScheduled = Symbol("kAccountingFlushScheduled");
function flushWriteAccountingNT(res) {
  res[kAccountingFlushScheduled] = false;
  const needsDrain = (res[kBytesBuffered] ?? 0) >= res.writableHighWaterMark;
  res[kBytesBuffered] = 0;
  if (needsDrain && !res.destroyed && !res.finished) {
    res.emit("drain");
  }
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

ServerResponse.prototype._finish = function () {
  this.emit("prefinish");
};

ServerResponse.prototype.detachSocket = function (socket) {
  // socket can be null when the stream destroyer detached the request's
  // socket (req.socket = null) before the response finished.
  if (socket && socket._httpMessage === this) {
    if (socket[kCloseCallback]) socket[kCloseCallback] = undefined;
    socket.removeListener("close", onServerResponseClose);
    socket._httpMessage = null;
    // Drop the request reference so a kept-alive idle connection does not
    // pin the last request in memory (Node.js frees the parser's incoming
    // reference when the response finishes).
    if (socket[kRequest] === this.req) {
      socket[kRequest] = undefined;
    }
  }

  this.socket = null;
};

ServerResponse.prototype._implicitHeader = function () {
  if (this.headersSent) return;
  // @ts-ignore
  this.writeHead(this.statusCode);
};

Object.defineProperty(ServerResponse.prototype, "writableNeedDrain", {
  get() {
    // True between a write() that returned false and the next 'drain': either
    // the native handle still has buffered bytes, or this turn's accounting
    // (kBytesBuffered) crossed the high-water mark and a 'drain' is pending.
    return (
      !this.destroyed &&
      !this.finished &&
      ((this[kHandle]?.bufferedAmount ?? 0) !== 0 ||
        (this[kBytesBuffered] ?? 0) >= this.writableHighWaterMark ||
        (this[kPipelinedQueuedState]?.needDrain ?? false))
    );
  },
});

Object.defineProperty(ServerResponse.prototype, "writableFinished", {
  get() {
    return !!(this.finished && (!this[kHandle] || this[kHandle].finished));
  },
});

Object.defineProperty(ServerResponse.prototype, "writableLength", {
  get() {
    if (this.writableFinished) return 0;
    // Bytes handed off this event-loop turn (including chunked framing, like
    // Node.js's outputData accounting) plus whatever the native handle still
    // has buffered, plus anything buffered while queued behind a pipelined
    // response.
    return (
      (this[kBytesBuffered] ?? 0) + (this[kHandle]?.bufferedAmount ?? 0) + (this[kPipelinedQueuedState]?.bytes ?? 0)
    );
  },
});

Object.defineProperty(ServerResponse.prototype, "writableHighWaterMark", {
  get() {
    // Like Node.js's OutgoingMessage: the socket's high water mark when one
    // is assigned (the stream default differs by platform), otherwise the
    // OutgoingMessage default set by the constructor.
    return this.socket?.writableHighWaterMark ?? this[kHighWaterMark] ?? 64 * 1024;
  },
});

Object.defineProperty(ServerResponse.prototype, "closed", {
  get() {
    return this._closed;
  },
});

ServerResponse.prototype._send = function (data, encoding, callback, _byteLength) {
  const handle = this[kHandle];
  if (!handle) {
    return OutgoingMessagePrototype._send.$apply(this, arguments);
  }

  if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
    handle.cork(() => {
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
        // A throwing writeHead (status validation) must not leave the shared
        // scratch array marked busy for the rest of the process.
        releaseRenderedHeaders(renderedHeaders);
      }
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;
      handle.write(data, encoding, callback, strictContentLength(this));
    });
  } else {
    handle.write(data, encoding, callback, strictContentLength(this));
  }
};

const kSnapshotStatusCode = Symbol("kSnapshotStatusCode");
const kSnapshotStatusMessage = Symbol("kSnapshotStatusMessage");
ServerResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
  if (this.headersSent) {
    throw $ERR_HTTP_HEADERS_SENT("writeHead");
  }
  _writeHead(statusCode, statusMessage, headers, this);

  // Node.js renders the header block immediately in writeHead(), so mutating
  // res.statusCode/statusMessage afterwards has no effect on the wire.
  // Headers are flushed lazily here, so snapshot the status line now.
  this[kSnapshotStatusCode] = this.statusCode;
  this[kSnapshotStatusMessage] = this.statusMessage;

  this[headerStateSymbol] = NodeHTTPHeaderState.assigned;

  // Standalone responses (no native handle, e.g. new ServerResponse(req) +
  // assignSocket(writable)) write through the OutgoingMessage machinery, so
  // render the header block immediately like Node.js does.
  if (!this[kHandle] && !this._header) {
    const statusLine = `HTTP/1.1 ${this.statusCode} ${this.statusMessage}\r\n`;
    this._storeHeader(statusLine, this[kOutHeaders]);
  }

  return this;
};

ServerResponse.prototype.assignSocket = function (socket) {
  if (socket._httpMessage) {
    throw $ERR_HTTP_SOCKET_ASSIGNED("Socket already assigned");
  }
  socket._httpMessage = this;
  socket.once("close", onServerResponseClose);
  this.socket = socket;
  this.emit("socket", socket);
  // Like Node.js: drain anything written before the socket was assigned.
  this._flush();
};

// Backed by real storage (the native response handle exposes no such flag):
// the standalone _storeHeader path's 204/304 handling assigns it, graceful
// shutdown helpers clear it on in-flight responses, and renderNativeHeaders
// consults it for the Connection header and close-on-finish.
Object.defineProperty(ServerResponse.prototype, "shouldKeepAlive", {
  get() {
    return this[kShouldKeepAlive] ?? true;
  },
  set(value) {
    this[kShouldKeepAlive] = value;
  },
});

ServerResponse.prototype.destroy = function (err?: Error) {
  if (this.destroyed) return this;
  const handle = this[kHandle];
  this.destroyed = true;
  // Like Node.js's OutgoingMessage#destroy: remember the error (even when it
  // is undefined) so `res.errored` reports it, and forward it to the socket.
  this[kErrored] = err;
  // A response that is still queued behind an in-flight pipelined response
  // does not own the connection: destroying it must not touch the socket
  // (Node.js destroys a socket-less OutgoingMessage without side effects).
  if (handle && this[kPipelinedQueuedState] === undefined) {
    handle.abort();
  }
  this?.socket?.destroy(err);
  if (!this._closed) {
    // res.closed must already be true inside the 'close' listeners.
    this._closed = true;
    this.emit("close");
  }
  return this;
};

ServerResponse.prototype.emit = function (event) {
  if (event === "close") {
    callCloseCallback(this);
  }
  return Stream.prototype.emit.$apply(this, arguments);
};

ServerResponse.prototype.flushHeaders = function () {
  if (this[headerStateSymbol] === NodeHTTPHeaderState.sent) return; // Should be idempotent.
  if (this[headerStateSymbol] !== NodeHTTPHeaderState.assigned) this._implicitHeader();

  if (this[kPipelinedQueuedState] !== undefined) {
    // Queued pipelined response: its headers go out when it is assigned the
    // socket (advanceResponsePipeline) - nothing can be flushed before then.
    return;
  }

  const handle = this[kHandle];
  if (handle) {
    if (this[headerStateSymbol] === NodeHTTPHeaderState.assigned) {
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;

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
        // A throwing writeHead (status validation) must not leave the shared
        // scratch array marked busy for the rest of the process.
        releaseRenderedHeaders(renderedHeaders);
      }
    }
    handle.flushHeaders();
  } else {
    // Standalone path: _storeHeader rendered this._header; _send('') pushes
    // it to the assigned socket like OutgoingMessage.flushHeaders does.
    this._send("");
  }
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

function emitServerSocketEOF(self, req) {
  self.push(null);
  if (req) {
    req.push(null);
    req.complete = true;
  }
}

function emitServerSocketEOFNT(self, req) {
  if (req) {
    req[eofInProgress] = true;
  }
  process.nextTick(emitServerSocketEOF, self);
}

let OriginalWriteHeadFn, OriginalImplicitHeadFn;

function callWriteHeadIfObservable(self, headerState) {
  if (
    headerState === NodeHTTPHeaderState.none &&
    !(self.writeHead === OriginalWriteHeadFn && self._implicitHeader === OriginalImplicitHeadFn)
  ) {
    self.writeHead(self.statusCode, self.statusMessage);
  }
}

function allowWritesToContinue() {
  this._callPendingCallbacks();
  this.emit("drain");
}

function drainHeadersIfObservable() {
  if (this._implicitHeader === OriginalImplicitHeadFn && this.writeHead === OriginalWriteHeadFn) {
    return;
  }

  this._implicitHeader();
}

function ServerResponse_finalDeprecated(chunk, encoding, callback) {
  if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  }
  if (!$isCallable(callback)) {
    callback = undefined;
  }

  if (this.destroyed || this.finished) {
    if (chunk) {
      emitErrorNextTickIfErrorListenerNT(this, $ERR_STREAM_WRITE_AFTER_END(), callback);
    }
    return false;
  }
  if (encoding && encoding !== "buffer") {
    chunk = Buffer.from(chunk, encoding);
  }
  const req = this.req;

  const shouldEmitClose = req && req.emit && !this.finished;
  if (!this.headersSent) {
    let data = this[firstWriteSymbol];
    if (chunk) {
      if (data) {
        if (encoding) {
          data = Buffer.from(data, encoding);
        }

        data = new Blob([data, chunk]);
      } else {
        data = chunk;
      }
    } else if (!data) {
      data = undefined;
    } else {
      data = new Blob([data]);
    }

    this[firstWriteSymbol] = undefined;
    this.finished = true;
    this.headersSent = true; // https://github.com/oven-sh/bun/issues/3458
    drainHeadersIfObservable.$call(this);
    this[kDeprecatedReplySymbol](
      new Response(data, {
        headers: this.getHeaders(),
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      }),
    );
    if (shouldEmitClose) {
      req.complete = true;
      process.nextTick(emitRequestCloseNT, req);
    }
    callback?.();
    return;
  }

  this.finished = true;
  ensureReadableStreamController.$call(this, controller => {
    if (chunk && encoding) {
      chunk = Buffer.from(chunk, encoding);
    }

    let prom;
    if (chunk) {
      controller.write(chunk);
      prom = controller.end();
    } else {
      prom = controller.end();
    }

    const handler = () => {
      callback();
      const deferred = this[deferredSymbol];
      if (deferred) {
        this[deferredSymbol] = undefined;
        deferred();
      }
    };
    if ($isPromise(prom)) prom.then(handler, handler);
    else handler();
  });
}

// ServerResponse.prototype._final = ServerResponse_finalDeprecated;

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
    validateOneOf(httpValidation, "options.httpValidation", ["default", "insecure", "relaxed"]);
    if (insecureHTTPParser !== undefined) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.httpValidation",
        httpValidation,
        "cannot be used with options.insecureHTTPParser",
      );
    }
    this.httpValidation = httpValidation;
  }

  // Node passes options.highWaterMark through to net.Server, which applies it
  // to every accepted connection socket (and from there to req/res streams).
  this[kHighWaterMark] = options.highWaterMark;

  this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

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

function ensureReadableStreamController(run) {
  const thisController = this[controllerSymbol];
  if (thisController) return run(thisController);
  this.headersSent = true;
  let firstWrite = this[firstWriteSymbol];
  const old_run = this[runSymbol];
  if (old_run) {
    old_run.push(run);
    return;
  }
  this[runSymbol] = [run];
  this[kDeprecatedReplySymbol](
    new Response(
      new ReadableStream({
        type: "direct",
        pull: controller => {
          this[controllerSymbol] = controller;
          if (firstWrite) controller.write(firstWrite);
          firstWrite = undefined;
          for (let run of this[runSymbol]) {
            run(controller);
          }
          if (!this.finished) {
            const { promise, resolve } = $newPromiseCapability(GlobalPromise);
            this[deferredSymbol] = resolve;
            return promise;
          }
        },
      }),
      {
        headers: this.getHeaders(),
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      },
    ),
  );
}

export default {
  Server,
  ServerResponse,
  kConnectionsCheckingInterval,
};
