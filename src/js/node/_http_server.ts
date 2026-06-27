// Hardcoded module "node:_http_server"
const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");
const { Duplex, Stream } = require("node:stream");
const {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression,
  continueExpression,
  validateHeaderName,
  validateHeaderValue,
} = require("node:_http_common");
const {
  validateObject,
  validateLinkHeaderValue,
  validateBoolean,
  validateInteger,
  validateFunction,
  isUint8Array,
} = require("internal/validators");
const { ConnResetException, hasObserver, startPerf, stopPerf } = require("internal/shared");
const kServerResponseStatistics = Symbol("ServerResponseStatistics");

const { isPrimary } = require("internal/cluster/isPrimary");
const { throwOnInvalidTLSArray } = require("internal/tls");
const {
  kInternalSocketData,
  serverSymbol,
  kHandle,
  kRealListen,
  tlsSymbol,
  optionsSymbol,
  kDeferredTimeouts,
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
  setServerIdleTimeout,
  setServerCustomOptions,
  getMaxHTTPHeaderSize,
  fakeSocketSymbol,
  utcDate,
  kOutHeaders,
} = require("internal/http");
const { FakeSocket } = require("internal/http/FakeSocket");
const NumberIsNaN = Number.isNaN;

const { format } = require("internal/util/inspect");

const { IncomingMessage } = require("node:_http_incoming");
const {
  OutgoingMessage,
  kErrored,
  kHighWaterMark,
  kSocket,
  kRejectNonStandardBodyWrites,
} = require("node:_http_outgoing");
const OutgoingMessagePrototype = OutgoingMessage.prototype;
const { kIncomingMessage } = require("node:_http_common");
const kConnectionsCheckingInterval = Symbol("http.server.connectionsCheckingInterval");
const kTrackedConnections = Symbol("http.server.trackedConnections");

const getBunServerAllClosedPromise = $newRustFunction("node_http_binding.rs", "getBunServerAllClosedPromise", 1);
const sendHelper = $newRustFunction("node_cluster_binding.rs", "sendHelperChild", 3);

const kServerResponse = Symbol("ServerResponse");
const kChunkedEncoding = Symbol("kChunkedEncoding");
const kShouldKeepAlive = Symbol("kShouldKeepAlive");
const kOptimizeEmptyRequests = Symbol("kOptimizeEmptyRequests");
const GlobalPromise = globalThis.Promise;
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const MathMin = Math.min;
const MathFloor = Math.floor;

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

// Match Node's write_(): enforce strictContentLength before handle.writeHead()
// flushes the header block. The native write/end check throws only after the
// (unterminated) headers are already corked, so the client gets a partial message.
function checkStrictContentLength(strictCL, handle, chunk, encoding, fromEnd) {
  if (strictCL === undefined) return;
  // Measure only the chunk types Node's write_() accepts; anything else keeps
  // its existing chunk-type error from the native write/end path.
  if (chunk && typeof chunk !== "string" && !isUint8Array(chunk)) return;
  const len = chunk ? (typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.byteLength) : 0;
  // The http2 allowHTTP1 fallback installs a JS shim handle without getBytesWritten.
  const written = (handle.getBytesWritten?.() ?? 0) + len;
  if (fromEnd ? written !== strictCL : written > strictCL) {
    throw $ERR_HTTP_CONTENT_LENGTH_MISMATCH(
      `Response body's content-length of ${written} byte(s) does not match the content-length of ${strictCL} byte(s) set in header`,
    );
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

function onNodeHTTPServerSocketTimeout() {
  const req = this[kRequest];
  const reqTimeout = req && !req.complete && req.emit("timeout", this);
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

  this.listening = false;
  this._unref = false;
  this.maxRequestsPerSocket = 0;
  this.maxHeadersCount = null;
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

    let cert = options.cert;
    if (cert) {
      throwOnInvalidTLSArray("options.cert", cert);
      this[isTlsSymbol] = true;
    }

    let key = options.key;
    if (key) {
      throwOnInvalidTLSArray("options.key", key);
      this[isTlsSymbol] = true;
    }

    let ca = options.ca;
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
      this[tlsSymbol] = normalizeServerTls({
        serverName,
        key,
        cert,
        ca,
        passphrase,
        secureOptions,
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
function noopConnectionsCheck() {}
function setupConnectionsTracking(this: any) {
  if (this[kConnectionsCheckingInterval]) {
    clearInterval(this[kConnectionsCheckingInterval]);
  }
  const delay = this.connectionsCheckingInterval || 30_000;
  this[kConnectionsCheckingInterval] = setInterval(noopConnectionsCheck, delay);
  this[kConnectionsCheckingInterval].unref();
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
  // Connections are tracked from the first parsed request on each socket
  // (the native server does not surface raw accepts to JS yet).
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
    return;
  }
  this[serverSymbol] = undefined;
  if (typeof optionalCallback === "function") setCloseCallback(this, optionalCallback);
  this.listening = false;
  server.closeIdleConnections();
  server.stop();
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

    // TODO: our net.Server and http.Server use different Bun APIs and our IPC doesnt support sending and receiving handles yet. use reusePort instead for now.

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
      const message = {
        act: "listening",
        port: (address && address.port) || port,
        data: null,
        addressType: 4,
      };
      sendHelper(message, null);
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
        headersObject: Record<string, string>,
        headersArray: string[],
        handle,
        hasBody: boolean,
        socketHandle,
        isSocketNew,
        socket,
        isAncientHTTP: boolean,
        connectHead?: Buffer,
      ) {
        const prevIsNextIncomingMessageHTTPS = getIsNextIncomingMessageHTTPS();
        setIsNextIncomingMessageHTTPS(isHTTPS);
        if (!socket) {
          socket = new NodeHTTPServerSocket(server, socketHandle, !!tls);
        }

        const http_req = new RequestClass(kHandle, url, method, headersObject, headersArray, handle, hasBody, socket);
        if (isAncientHTTP) {
          http_req.httpVersion = "1.0";
          http_req.httpVersionMajor = 1;
          http_req.httpVersionMinor = 0;
        }
        if (server.joinDuplicateHeaders) {
          http_req.joinDuplicateHeaders = true;
        }
        if (method === "CONNECT") {
          // Handle CONNECT method for HTTP tunneling/proxy
          if (server.listenerCount("connect") > 0) {
            // For CONNECT, emit the event and let the handler respond
            // Don't assign the socket to a response for CONNECT
            // The handler should write the raw response
            socket[kEnableStreaming](true);
            const { promise, resolve } = $newPromiseCapability(Promise);
            // Pass the pipelined data (head buffer) if any was received with the CONNECT request
            const head = connectHead ? connectHead : kEmptyBuffer;
            // Node.js's parserOnIncoming: req.upgrade is true for CONNECT
            // regardless of shouldUpgradeCallback.
            http_req.upgrade = true;
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

        const http_res = new ResponseClass(http_req, {
          [kHandle]: handle,
          [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
        });
        http_res._keepAliveTimeout = server.keepAliveTimeout;

        // The request itself forbids connection reuse (HTTP/1.0, or the
        // client sent Connection: close): end the server's writable side as
        // soon as the response has been written, like Node.js's resOnFinish.
        // Registered before the 'request' event so the socket is already
        // ended inside user 'finish' listeners. (Not done for the
        // maxRequestsPerSocket limit - pipelined requests past the limit
        // still need to be answered with 503.)
        if (!requestShouldKeepAlive(http_req)) {
          http_res[kMustCloseConnection] = true;
        }
        http_res.once("finish", endSocketOnFinishIfNeeded.bind(undefined, socket, http_res));

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
        handle.onabort = onServerRequestEvent.bind(socket);
        // start buffering data if any, the user will need to resume() or .on("data") to read it
        if (hasBody) {
          handle.pause();
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

        socket[kRequest] = http_req;
        // Node.js (llhttp) only flags a request as an upgrade when it carries
        // both an Upgrade header and a Connection header with the "upgrade"
        // token; the server then consults shouldUpgradeCallback (default: an
        // 'upgrade' listener is installed) and otherwise dispatches the
        // request normally.
        let is_upgrade = false;
        if (http_req.headers.upgrade !== undefined) {
          const connectionHeader = http_req.headers.connection;
          if (typeof connectionHeader === "string" && RE_CONN_UPGRADE.test(connectionHeader)) {
            is_upgrade = !!server.shouldUpgradeCallback(http_req);
          }
        }
        // Like Node.js's parserOnIncoming: req.upgrade is true inside the
        // 'upgrade' listener and false for a declined upgrade that falls
        // through to 'request'.
        http_req.upgrade = is_upgrade;
        if (!is_upgrade) {
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

        setCloseCallback(http_res, onClose);

        // Like Node.js: with the optimizeEmptyRequests server option,
        // requests without body headers skip the Readable life cycle (no
        // 'data'/'end'/'close' events) and arrive pre-dumped.
        if (
          server[kOptimizeEmptyRequests] &&
          !is_upgrade &&
          http_req.headers["content-length"] === undefined &&
          http_req.headers["transfer-encoding"] === undefined
        ) {
          http_req._dumpAndCloseReadable();
        }

        if (reachedRequestsLimit) {
          server.emit("dropRequest", http_req, socket);
          http_res.writeHead(503);
          http_res.end();
          socket.destroy();
        } else if (is_upgrade) {
          // Hand the raw socket over to the 'upgrade' listener with any bytes
          // that arrived after the request head, like Node.js. The connection
          // switches into CONNECT-style tunnel mode so subsequent bytes
          // bypass the HTTP parser and stream to the socket as opaque data.
          socketHandle.upgradeToTunnel();
          socket[kEnableStreaming](true);
          const upgradeHead = connectHead ? connectHead : kEmptyBuffer;
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
          http_req.headers.host === undefined &&
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
          const expectHeader = http_req.headers.expect;
          if (expectHeader !== undefined) {
            // Case-insensitive, token-boundary match like Node's
            // parserOnIncoming (RFC 7231 5.1.1: expectation values compare
            // case-insensitively).
            if (continueExpression.test(expectHeader)) {
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

        if (handle.finished || didFinish) {
          handle = undefined;
          http_res[kCloseCallback] = undefined;
          http_res.detachSocket(socket);
          return;
        }
        if (http_res.socket) {
          http_res.on("finish", http_res.detachSocket.bind(http_res, socket));
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
    // always set strict method validation to true for node.js compatibility
    setServerCustomOptions(
      this[serverSymbol],
      this.requireHostHeader,
      true,
      typeof this.maxHeaderSize !== "undefined" ? this.maxHeaderSize : getMaxHTTPHeaderSize(),
      onServerClientError.bind(this),
    );

    if (this?._unref) {
      this[serverSymbol]?.unref?.();
    }

    if ($isCallable(onListen)) {
      this.once("listening", onListen);
    }

    if (this[kDeferredTimeouts]) {
      for (const { msecs, callback } of this[kDeferredTimeouts]) {
        this.setTimeout(msecs, callback);
      }
      delete this[kDeferredTimeouts];
    }

    setTimeout(emitListeningNextTick, 1, this, this[serverSymbol]?.hostname, this[serverSymbol]?.port);
  }
};

Server.prototype.setTimeout = function (msecs, callback) {
  const server = this[serverSymbol];
  if (server) {
    setServerIdleTimeout(server, Math.ceil(msecs / 1000));
    if (typeof callback === "function") this.once("timeout", callback);
  } else {
    (this[kDeferredTimeouts] ??= []).push({ msecs, callback });
  }
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
}
function onServerClientError(ssl: boolean, socket: unknown, errorCode: number, rawPacket: ArrayBuffer) {
  const self = this as Server;
  let err;
  switch (errorCode) {
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH:
      err = $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING:
      err = $HPE_INVALID_TRANSFER_ENCODING("Parse Error");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_EOF:
      err = $HPE_INVALID_EOF_STATE("Parse Error");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_METHOD:
      err = $HPE_INVALID_METHOD("Parse Error: Invalid method encountered");
      err.bytesParsed = 1; // always 1 for now because is the first byte of the request line
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN:
      err = $HPE_INVALID_HEADER_TOKEN("Parse Error: Invalid header token encountered");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE:
      err = $HPE_HEADER_OVERFLOW("Parse Error: Header overflow");
      err.bytesParsed = rawPacket.byteLength;
      break;
    default:
      err = $HPE_INTERNAL("Parse Error");
      break;
  }
  err.rawPacket = rawPacket;
  // A prior request on this keep-alive connection may already have wrapped
  // the native handle (the native side returns the existing handle); a second
  // wrapper would overwrite its onclose/duplex and strand the first one in
  // kTrackedConnections. Reuse it, and only announce genuinely new
  // connections - the existing duplex already had its 'connection' event.
  const existingDuplex = (socket as any).duplex;
  const nodeSocket = existingDuplex ?? new NodeHTTPServerSocket(self, socket, ssl);
  if (!existingDuplex) {
    self.emit("connection", nodeSocket);
  }
  self.emit("clientError", err, nodeSocket);
  if (nodeSocket.listenerCount("error") > 0) {
    nodeSocket.emit("error", err);
  }
}

const kBytesWritten = Symbol("kBytesWritten");
const kEnableStreaming = Symbol("kEnableStreaming");
function onServerSocketError(this: any, _err) {
  // Default 'error' listener so socket-level errors (e.g. res.destroy(err)
  // forwarding the error to the socket) do not crash the process as
  // unhandled 'error' events; user listeners added on the socket still
  // observe the error. Parser errors are routed to the server's
  // 'clientError' event by the native error path, so this listener must NOT
  // emit 'clientError' itself or those tests would see it twice.
  this.removeListener("error", onServerSocketError);
  this.on("error", noopOnError);
}
function noopOnError() {}

const NodeHTTPServerSocket = class Socket extends Duplex {
  bytesRead = 0;
  connecting = false;
  timeout = 0;
  [kBytesWritten] = 0;
  [kHandle];
  server: Server;
  _httpMessage;
  _secureEstablished = false;
  #pendingCallback = null;
  constructor(server: Server, handle, encrypted) {
    super();
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
    this.on("error", onServerSocketError);
    server[kTrackedConnections]?.add(this);
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
    const handle = this[kHandle];
    if (handle) {
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
    if (chunk) {
      this.push(chunk);
    }
    if (last) {
      const handle = this[kHandle];
      if (handle) {
        handle.ondata = undefined;
      }

      this.push(null);
    }
  }
  #closeHandle(handle, callback, err?: Error) {
    this[kHandle] = undefined;
    handle.onclose = this.#onCloseForDestroy.bind(this, callback, err);
    handle.close();
    // lets sync check and destroy the request if it's not complete
    const message = this._httpMessage;
    const req = message?.req;
    if (req && !req.complete) {
      // at this point the handle is not destroyed yet, lets destroy the request
      req.destroy();
    }
  }
  #onClose() {
    this[kHandle] = null;
    this.server?.[kTrackedConnections]?.delete(this);

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
    const message = this._httpMessage;
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
      return;
    }
    this.emit("timeout");
  }
  _unrefTimer() {
    // for compatibility
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

  setTimeout(_timeout, _callback) {
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

function _writeHead(statusCode, reason, obj, response) {
  const originalStatusCode = statusCode;
  let hasContentLength = response.hasHeader("content-length");
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
        if (
          (response.chunkedEncoding !== true || response.hasHeader("content-length")) &&
          (response._trailer || response.hasHeader("trailer"))
        ) {
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
    if (
      (response.chunkedEncoding !== true || response.hasHeader("content-length")) &&
      (response._trailer || response.hasHeader("trailer"))
    ) {
      // remove the invalid content-length or trailer header
      if (hasContentLength) {
        response.removeHeader("trailer");
      } else {
        response.removeHeader("content-length");
      }
      throw $ERR_HTTP_TRAILER_INVALID("Trailers are invalid with this transfer encoding");
    }
  }

  updateHasBody(response, statusCode);
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
    if (options[kRejectNonStandardBodyWrites] !== undefined) {
      this[kRejectNonStandardBodyWrites] = options[kRejectNonStandardBodyWrites];
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
function renderNativeHeaders(res) {
  const headersMap = res[kOutHeaders];
  const flat: string[] = [];
  let hasDate = false;
  let hasConnection = false;
  let hasKeepAlive = false;
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
        if (valueLength < 2 || key !== "cookie") {
          for (let i = 0; i < valueLength; i++) {
            flat.push(name, String(value[i]));
          }
        } else {
          flat.push(name, value.join("; "));
        }
      } else {
        flat.push(name, String(value));
      }
    }
  }

  if (res.sendDate && !hasDate) {
    flat.push("Date", utcDate());
  }

  // RFC 2616 mandates that 204 and 304 responses MUST NOT have a body. A
  // chunked Transfer-Encoding on such a response could confuse reverse
  // proxies, so like Node.js the body framing is suppressed and the
  // connection is forcibly closed after the response.
  let defectiveNoBodyResponse = false;
  if (res[kOutHeaders]?.["transfer-encoding"] !== undefined) {
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
  if (res[kOutHeaders]?.["content-length"] === undefined && res[kOutHeaders]?.["transfer-encoding"] === undefined) {
    if (res._hasBody === false) {
      // HEAD / 204 / 304 / 1xx: there is no body to delimit, so removing the
      // framing headers must not close the connection (Node's _storeHeader
      // checks !_hasBody before its close-delimited else-branch).
    } else if (res._removedTE) {
      closeDelimited = true;
      res[kMustCloseConnection] = true;
    } else if (res._removedContLen) {
      forceChunked = true;
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
      flat.push("Connection", "keep-alive");
      const keepAliveTimeout = res._keepAliveTimeout;
      if (keepAliveTimeout && !hasKeepAlive) {
        let max = "";
        const maxRequestsPerSocket = res._maxRequestsPerSocket;
        if (~~maxRequestsPerSocket > 0) {
          max = `, max=${maxRequestsPerSocket}`;
        }
        flat.push("Keep-Alive", `timeout=${MathFloor(keepAliveTimeout / 1000)}${max}`);
      }
    } else {
      // Like Node's shouldSendKeepAlive/_last handling: a user-cleared
      // shouldKeepAlive (graceful-shutdown helpers set it on in-flight
      // responses) must also end the socket after 'finish'.
      if (res.shouldKeepAlive === false) {
        res[kMustCloseConnection] = true;
      }
      flat.push("Connection", "close");
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

function endSocketOnFinishIfNeeded(socket, res) {
  if (res[kMustCloseConnection]) {
    socket?.end();
  }
}

const RE_CONN_CLOSE = /(?:^|\W)close(?:$|\W)/i;
const RE_CONN_UPGRADE = /(?:^|\W)upgrade(?:$|\W)/i;
// Whether the response should advertise a persistent connection.
function requestShouldKeepAlive(req) {
  if (!req) return true;
  const connection = req.headers.connection;
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
    return this.socket.writableCorked;
  },
  set(_value) {},
});

ServerResponse.prototype.cork = function cork() {
  this.socket.cork();
};

ServerResponse.prototype.uncork = function uncork() {
  this.socket.uncork();
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
  return this.socket.write(chunk, encoding, callback);
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
    // Standalone path: route through writeInformation like Node.js v26.3.0
    // (and like the writeProcessing/writeEarlyHints siblings) so the 100
    // Continue line reaches the assigned socket.
    this.writeInformation(100, null, cb);
    this._sent100 = true;
    return;
  }
  this.socket[kHandle]?.response?.writeContinue();
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

  const headerState = this[headerStateSymbol];
  callWriteHeadIfObservable(this, headerState);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // node.js will return true if the handle is closed but the internal state is not
    // and will not throw or emit an error
    return true;
  }
  const strictCL = strictContentLength(this);
  if (headerState !== NodeHTTPHeaderState.sent) {
    checkStrictContentLength(strictCL, handle, chunk, encoding, true);
    handle.cork(() => {
      handle.writeHead(
        this[kSnapshotStatusCode] ?? this.statusCode,
        this[kSnapshotStatusMessage] ?? this.statusMessage,
        renderNativeHeaders(this),
      );

      // If handle.writeHead throws, we don't want headersSent to be set to true.
      // So we set it here.
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;

      // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/_http_outgoing.js#L987
      this._contentLength = handle.end(chunk, encoding, undefined, strictCL);
    });
  } else {
    // If there's no data but you already called end, then you're done.
    // We can ignore it in that case.
    if (!(!chunk && handle.ended) && !handle.aborted) {
      handle.end(chunk, encoding, undefined, strictCL);
    }
  }
  this._header = " ";
  const req = this.req;
  // Detach the socket that was assigned to this response. Do not read it from
  // req.socket: the stream machinery nulls req.socket when the request body
  // stream is destroyed (e.g. after the handler consumed it through an async
  // iterator), and the connection must still be released for the next
  // keep-alive request.
  const socket = this[fakeSocketSymbol] ?? req.socket;
  if (!req._consuming && !req?._readableState?.resumeScheduled) {
    req._dump();
  }
  this.detachSocket(socket);
  this.finished = true;
  process.nextTick(self => {
    self._ended = true;
  }, this);
  this.emit("prefinish");
  this._callPendingCallbacks();

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

  const strictCL = strictContentLength(this);
  if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
    checkStrictContentLength(strictCL, handle, chunk, encoding, false);
    handle.cork(() => {
      handle.writeHead(
        this[kSnapshotStatusCode] ?? this.statusCode,
        this[kSnapshotStatusMessage] ?? this.statusMessage,
        renderNativeHeaders(this),
      );

      // If handle.writeHead throws, we don't want headersSent to be set to true.
      // So we set it here.
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;
      result = handle.write(chunk, encoding, allowWritesToContinue.bind(this), strictCL);
    });
  } else {
    result = handle.write(chunk, encoding, allowWritesToContinue.bind(this), strictCL);
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
  if (written > 0) {
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
      ((this[kHandle]?.bufferedAmount ?? 0) !== 0 || (this[kBytesBuffered] ?? 0) >= this.writableHighWaterMark)
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
    // has buffered.
    return (this[kBytesBuffered] ?? 0) + (this[kHandle]?.bufferedAmount ?? 0);
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

  const strictCL = strictContentLength(this);
  if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
    checkStrictContentLength(strictCL, handle, data, encoding, false);
    handle.cork(() => {
      handle.writeHead(
        this[kSnapshotStatusCode] ?? this.statusCode,
        this[kSnapshotStatusMessage] ?? this.statusMessage,
        renderNativeHeaders(this),
      );
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;
      handle.write(data, encoding, callback, strictCL);
    });
  } else {
    handle.write(data, encoding, callback, strictCL);
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
  if (handle) {
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

  const handle = this[kHandle];
  if (handle) {
    if (this[headerStateSymbol] === NodeHTTPHeaderState.assigned) {
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;

      handle.writeHead(
        this[kSnapshotStatusCode] ?? this.statusCode,
        this[kSnapshotStatusMessage] ?? this.statusMessage,
        renderNativeHeaders(this),
      );
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
