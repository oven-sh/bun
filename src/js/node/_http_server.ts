const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");
const { Duplex, Stream } = require("node:stream");
const { validateObject, validateLinkHeaderValue, validateBoolean, validateInteger } = require("internal/validators");

const { isPrimary } = require("internal/cluster/isPrimary");
const { throwOnInvalidTLSArray } = require("internal/tls");
const httpInternals = require("internal/http") as any; // Cast to any for internal module
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
  headersSymbol,
  emitErrorNextTickIfErrorListenerNT,
  getIsNextIncomingMessageHTTPS,
  setIsNextIncomingMessageHTTPS,
  callCloseCallback,
  emitCloseNT,
  ConnResetException,
  NodeHTTPResponseAbortEvent,
  STATUS_CODES,
  isTlsSymbol,
  hasServerResponseFinished,
  OutgoingMessagePrototype,
  NodeHTTPBodyReadState,
  controllerSymbol,
  firstWriteSymbol,
  deferredSymbol,
  eofInProgress,
  runSymbol,
  drainMicrotasks,
  setServerIdleTimeout,
  setRequireHostHeader,
} = httpInternals;

const { format } = require("internal/util/inspect");

const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing") as {
  OutgoingMessage: typeof import("node:http").OutgoingMessage;
};
const { kIncomingMessage } = require("node:_http_common");

const getBunServerAllClosedPromise = $newZigFunction("node_http_binding.zig", "getBunServerAllClosedPromise", 1);
const sendHelper = $newZigFunction(
  "node_cluster_binding.zig",
  "sendHelperChild",
  3,
) as (arg1: any, arg2: any, arg3: any) => any; // Adjusted signature based on usage

const kServerResponse = Symbol("ServerResponse");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const GlobalPromise = globalThis.Promise;
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const MathMin = Math.min;

// This is conceptually added to builtins.d.ts or private.d.ts
declare function $setPrototypeDirect(obj: any, proto: any): void;

let cluster;

function emitCloseServer(self: Server) {
  callCloseCallback(self);
  self.emit("close");
}
function emitCloseNTServer(this: Server) {
  process.nextTick(() => emitCloseServer(this));
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
  const httpMessage = this._httpMessage;
  if (httpMessage) {
    process.nextTick(() => emitCloseNT.call(httpMessage));
  }
}

interface ServerResponseConstructor {
  new (req: any, options?: any): import("node:http").ServerResponse;
  prototype: import("node:http").ServerResponse & {
    _hasBody: boolean;
    _sent100: boolean;
    [kRejectNonStandardBodyWrites]?: boolean;
    _callPendingCallbacks(): void;
    _writeRaw(chunk: any, encoding?: BufferEncoding, callback?: (error?: Error | null) => void): boolean;
    detachSocket(socket: any): void;
    _implicitHeader(): void;
    _send(data: any, encoding?: BufferEncoding, callback?: (error?: Error | null) => void): void;
    _finish(): void;
  };
}
var ServerResponse: ServerResponseConstructor;

const ServerResponsePrototype = {
  _removedConnection: false,
  _removedContLen: false,
  _hasBody: true,
  _ended: false,

  get headersSent() {
    return (
      this[headerStateSymbol] === NodeHTTPHeaderState.sent || this[headerStateSymbol] === NodeHTTPHeaderState.assigned
    );
  },
  set headersSent(value) {
    this[headerStateSymbol] = value ? NodeHTTPHeaderState.sent : NodeHTTPHeaderState.none;
  },
  _writeRaw(chunk, encoding, callback) {
    return this.socket.write(chunk, encoding, callback);
  },

  writeEarlyHints(hints, cb) {
    let head = "HTTP/1.1 103 Early Hints\r\n";

    validateObject(hints, "hints");

    if (hints.link === null || hints.link === undefined) {
      return;
    }

    const link = validateLinkHeaderValue(hints.link);

    if (link.length === 0) {
      return;
    }

    head += "Link: " + link + "\r\n";

    for (const key of ObjectKeys(hints)) {
      if (key !== "link") {
        head += key + ": " + hints[key] + "\r\n";
      }
    }

    head += "\r\n";

    this._writeRaw(head, "ascii", cb);
  },

  writeProcessing(cb) {
    this._writeRaw("HTTP/1.1 102 Processing\r\n\r\n", "ascii", cb);
  },
  writeContinue(cb) {
    this.socket[kHandle]?.response?.writeContinue();
    cb?.();
  },

  end(chunk, encoding, callback) {
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

    if (chunk && !this._hasBody) {
      if (this[kRejectNonStandardBodyWrites]) {
        throw $ERR_HTTP_BODY_NOT_ALLOWED();
      } else {
        chunk = undefined;
      }
    }

    if (!handle) {
      if ($isCallable(callback)) {
        process.nextTick(callback);
      }
      return this;
    }

    const headerState = this[headerStateSymbol];
    callWriteHeadIfObservable(this, headerState);

    const flags = handle.flags;
    if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
      return this;
    }
    if (headerState !== NodeHTTPHeaderState.sent) {
      handle.cork(() => {
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;
        this._contentLength = handle.end(chunk, encoding);
      });
    } else {
      if (!(!chunk && handle.ended) && !handle.aborted) {
        handle.end(chunk, encoding);
      }
    }
    this._header = " ";
    const req = this.req;
    const socket = req.socket;
    if (!req._consuming && !req?._readableState?.resumeScheduled) {
      req._dump();
    }
    this.detachSocket(socket);
    this.finished = true;
    process.nextTick(() => {
      this._ended = true;
    });
    this.emit("prefinish");
    this._callPendingCallbacks();

    if (callback) {
      process.nextTick(() => {
        this.emit("finish");
        try {
          callback();
        } catch (err) {
          this.emit("error", err);
        }

        process.nextTick(() => emitCloseNT.call(this));
      });
    } else {
      process.nextTick(() => {
        this.emit("finish");
        process.nextTick(() => emitCloseNT.call(this));
      });
    }

    return this;
  },

  get writable() {
    return !this._ended || !hasServerResponseFinished(this);
  },

  write(chunk, encoding, callback) {
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
    if (chunk && !this._hasBody) {
      if (this[kRejectNonStandardBodyWrites]) {
        throw $ERR_HTTP_BODY_NOT_ALLOWED();
      } else {
        chunk = undefined;
      }
    }
    let result = 0;

    const headerState = this[headerStateSymbol];
    callWriteHeadIfObservable(this, headerState);

    if (!handle) {
      if (this.socket) {
        return this.socket.write(chunk, encoding, callback);
      } else {
        return OutgoingMessage.prototype.write.call(this, chunk, encoding, callback);
      }
    }

    const flags = handle.flags;
    if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
      return true;
    }

    if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
      handle.cork(() => {
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;
        result = handle.write(chunk, encoding, allowWritesToContinue.bind(this));
      });
    } else {
      result = handle.write(chunk, encoding, allowWritesToContinue.bind(this));
    }

    if (result < 0) {
      if (callback) {
        this[kPendingCallbacks].push(callback);
      }
      return false;
    }

    this._callPendingCallbacks();
    if ($isCallable(callback)) {
      process.nextTick(callback);
    }
    this.emit("drain");

    return true;
  },

  _callPendingCallbacks() {
    const originalLength = this[kPendingCallbacks].length;

    for (let i = 0; i < originalLength; ++i) {
      process.nextTick(this[kPendingCallbacks][i]);
    }

    if (this[kPendingCallbacks].length == originalLength) {
      this[kPendingCallbacks] = [];
    } else {
      this[kPendingCallbacks].splice(0, originalLength);
    }
  },

  _finish() {
    this.emit("prefinish");
  },

  detachSocket(socket) {
    if (socket._httpMessage === this) {
      socket[kCloseCallback] && (socket[kCloseCallback] = undefined);
      socket.removeListener("close", onServerResponseClose);
      socket._httpMessage = null;
    }

    this.socket = null;
  },

  _implicitHeader() {
    this.writeHead(this.statusCode);
  },

  get writableNeedDrain() {
    return !this.destroyed && !this.finished && (this[kHandle]?.bufferedAmount ?? 1) !== 0;
  },

  get writableFinished() {
    return !!(this.finished && (!this[kHandle] || this[kHandle].finished));
  },

  get writableLength() {
    return 16 * 1024;
  },

  get writableHighWaterMark() {
    return 64 * 1024;
  },

  get closed() {
    return this._closed;
  },

  _send(data, encoding, callback) {
    const handle = this[kHandle];
    if (!handle) {
      return (OutgoingMessagePrototype._send as any).call(this, data, encoding, callback);
    }

    if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
      handle.cork(() => {
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;
        handle.write(data, encoding, callback);
      });
    } else {
      handle.write(data, encoding, callback);
    }
  },

  writeHead(statusCode, statusMessage, headers) {
    if (this[headerStateSymbol] === NodeHTTPHeaderState.none) {
      _writeHead(statusCode, statusMessage, headers, this);
      updateHasBody(this, statusCode);
      this[headerStateSymbol] = NodeHTTPHeaderState.assigned;
    }

    return this;
  },

  assignSocket(socket) {
    if (socket._httpMessage) {
      throw $ERR_HTTP_SOCKET_ASSIGNED("Socket already assigned");
    }
    socket._httpMessage = this;
    socket.once("close", onServerResponseClose);
    this.socket = socket;
    this.emit("socket", socket);
  },

  statusMessage: undefined,
  statusCode: 200,

  get shouldKeepAlive() {
    return this[kHandle]?.shouldKeepAlive ?? true;
  },
  set shouldKeepAlive(value) {
  },

  get chunkedEncoding() {
    return false;
  },
  set chunkedEncoding(value) {
  },

  get useChunkedEncodingByDefault() {
    return true;
  },
  set useChunkedEncodingByDefault(value) {
  },

  destroy(_err?: Error) {
    if (this.destroyed) return this;
    const handle = this[kHandle];
    this.destroyed = true;
    if (handle) {
      handle.abort();
    }
    return this;
  },

  emit(event) {
    if (event === "close") {
      callCloseCallback(this);
    }
    return Stream.prototype.emit.apply(this, Array.prototype.slice.call(arguments) as [string | symbol, ...any[]]);
  },

  flushHeaders(this: ServerResponse) {
    (this as any)._implicitHeader();

    const handle = this[kHandle];
    if (handle) {
      if (this[headerStateSymbol] === NodeHTTPHeaderState.assigned) {
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
      }
      handle.flushHeaders();
    }
  },
} as unknown as ServerResponseConstructor["prototype"];

ServerResponse = function (this: import("node:http").ServerResponse, req, options): import("node:http").ServerResponse {
  if (!(this instanceof (ServerResponse as any))) {
    return new (ServerResponse as any)(req, options);
  }

  if ((this[kDeprecatedReplySymbol] = options?.[kDeprecatedReplySymbol])) {
    this[controllerSymbol] = undefined;
    this[firstWriteSymbol] = undefined;
    this[deferredSymbol] = undefined;
    this.write = ServerResponse_writeDeprecated as any;
    this.end = ServerResponse_finalDeprecated as any;
  }

  OutgoingMessage.call(this, options);

  (this as any).req = req;
  this.sendDate = true;
  (this as any)._sent100 = false;
  this[headerStateSymbol] = NodeHTTPHeaderState.none;
  this[kPendingCallbacks] = [] as (() => void)[];
  this.finished = false;

  if (req.method === "HEAD") (this as any)._hasBody = false;

  if (options) {
    const handle = options[kHandle];

    if (handle) {
      this[kHandle] = handle;
    }
    this[kRejectNonStandardBodyWrites] = options[kRejectNonStandardBodyWrites] ?? false;
  }
  return this;
} as unknown as ServerResponseConstructor;

ServerResponse.prototype = ServerResponsePrototype;
ServerResponsePrototype.constructor = ServerResponse;
$setPrototypeDirect(ServerResponse, Stream);

const ServerResponse_writeDeprecated = function _write(chunk: any, encoding?: any, callback?: any): boolean {
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
      (emitErrorNextTickIfErrorListenerNT as any)(this, $ERR_STREAM_WRITE_AFTER_END(), callback);
    }
    return false;
  }
  if (this[firstWriteSymbol] === undefined && !this.headersSent) {
    this[firstWriteSymbol] = chunk;
    if (callback) callback();
    return true;
  }

  ensureReadableStreamController.call(this, (controller: any) => {
    controller.write(chunk);
    if (callback) callback();
  });
  return true;
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
    self.emit("listening");
  }
}

type Server = InstanceType<typeof Server>;
const Server = function Server(options, callback) {
  if (!(this instanceof (Server as any))) return new (Server as any)(options, callback);
  EventEmitter.call(this);

  this.listening = false;
  this._unref = false;
  this.maxRequestsPerSocket = 0;
  this[kInternalSocketData] = undefined;
  this[tlsSymbol] = null;

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
      this[tlsSymbol] = {
        serverName,
        key,
        cert,
        ca,
        passphrase,
        secureOptions,
      };
    } else {
      this[tlsSymbol] = null;
    }
  }

  this[optionsSymbol] = options;
  storeHTTPOptions.call(this, options);

  if (callback) this.on("request", callback);
  return this;
} as unknown as typeof import("node:http").Server;
Object.defineProperty(Server, "name", { value: "Server" });

type NodeHTTPServerSocketInstance = InstanceType<typeof NodeHTTPServerSocket>;

function onServerRequestEvent(this: NodeHTTPServerSocketInstance, event: number) {
  const socket: NodeHTTPServerSocketInstance = this;
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

interface ServerPrototypeInterface extends import("node:events").EventEmitter {
  constructor: typeof Server;
  ref(): Server;
  unref(): Server;
  closeAllConnections(): void;
  closeIdleConnections(): void;
  close(optionalCallback?: (err?: Error) => void): void;
  [Symbol.asyncDispose](): Promise<void>;
  address(): ReturnType<$ZigGeneratedClasses.DebugHTTPServer["address"]> | null;
  listen(...args: any[]): Server;
  [kRealListen](tls: any, port: any, host: any, socketPath: any, reusePort: any, onListen: any): void;
  setTimeout(msecs: number, callback?: () => void): Server;
  [kIncomingMessage]?: typeof IncomingMessage;
  [serverSymbol]?: $ZigGeneratedClasses.DebugHTTPServer | $ZigGeneratedClasses.DebugHTTPSServer;
  [kInternalSocketData]: any;
  [tlsSymbol]: any;
  [optionsSymbol]: any;
  [kDeferredTimeouts]?: Array<{ msecs: number; callback: () => void }>;
  [isTlsSymbol]?: boolean;
  [kCloseCallback]?: (err?: Error) => void;
  listening: boolean;
  _unref: boolean;
  maxRequestsPerSocket: number;
  requireHostHeader?: boolean;
  rejectNonStandardBodyWrites?: boolean;
}

const ServerPrototype: Omit<ServerPrototypeInterface, keyof import("node:events").EventEmitter> = {
  constructor: Server,

  ref() {
    this._unref = false;
    this[serverSymbol]?.ref?.();
    return this;
  },

  unref() {
    this._unref = true;
    this[serverSymbol]?.unref?.();
    return this;
  },

  closeAllConnections() {
    const server = this[serverSymbol];
    if (!server) {
      return;
    }
    this[serverSymbol] = undefined;
    server.stop(true);
  },

  closeIdleConnections() {
  },

  close(optionalCallback?: (err?: Error) => void) {
    const server = this[serverSymbol];
    if (!server) {
      if (typeof optionalCallback === "function") {
        process.nextTick(() => optionalCallback($ERR_SERVER_NOT_RUNNING()));
      }
      return;
    }
    this[serverSymbol] = undefined;
    if (typeof optionalCallback === "function") setCloseCallback(this, optionalCallback);
    server.stop();
  },

  [Symbol.asyncDispose]() {
    const { resolve, reject, promise } = $newPromiseCapability(Promise);
    this.close(function (err) {
      if (err) reject(err);
      else resolve(undefined);
    });
    return promise;
  },

  address() {
    if (!this[serverSymbol]) return null;
    return this[serverSymbol].address;
  },

  listen() {
    const server = this;
    let port, host, onListen;
    let socketPath;
    let tls = this[tlsSymbol];

    if (arguments.length > 0) {
      if (($isObject(arguments[0]) || $isCallable(arguments[0])) && arguments[0] !== null) {
        port = (arguments[0] as any).port;
        host = (arguments[0] as any).host;
        socketPath = (arguments[0] as any).path;

        const otherTLS = (arguments[0] as any).tls;
        if (otherTLS && $isObject(otherTLS)) {
          tls = otherTLS;
        }
      } else if (typeof arguments[0] === "string" && !(Number(arguments[0]) >= 0)) {
        socketPath = arguments[0];
      } else {
        port = arguments[0];
        if (arguments.length > 1 && typeof arguments[1] === "string") {
          host = arguments[1];
        }
      }
    }

    if (port === undefined && !socketPath) {
      port = 0;
    }

    if (typeof port === "string") {
      const portNumber = parseInt(port);
      if (!Number.isNaN(portNumber)) {
        port = portNumber;
      }
    }

    if ($isCallable(arguments[arguments.length - 1])) {
      onListen = arguments[arguments.length - 1];
    }

    try {
      if (isPrimary) {
        server[kRealListen](tls, port, host, socketPath, false, onListen);
        return this;
      }

      if (cluster === undefined) cluster = require("node:cluster");

      server.once("listening", () => {
        cluster.worker.state = "listening";
        const address = server.address();
        const message = {
          act: "listening",
          port: (address && address.port) || port,
          data: null,
          addressType: 4,
        };
        sendHelper(message, null, null);
      });

      server[kRealListen](tls, port, host, socketPath, true, onListen);
    } catch (err) {
      setTimeout(() => server.emit("error", err), 1);
    }

    return this;
  },

  [kRealListen](tls, port, host, socketPath, reusePort, onListen) {
    {
      const ResponseClass = (this[optionsSymbol].ServerResponse || ServerResponse) as any as ServerResponseConstructor;
      const RequestClass = (this[optionsSymbol].IncomingMessage ||
        IncomingMessage) as any as typeof import("node:http").IncomingMessage;
      const canUseInternalAssignSocket =
        ResponseClass && ResponseClass.prototype.assignSocket === ServerResponse.prototype.assignSocket;
      let isHTTPS = false;
      let server = this;

      if (tls) {
        this.serverName = tls.serverName || host || "localhost";
      }

      this[serverSymbol] = Bun.serve({
        idleTimeout: 0,
        tls,
        port,
        hostname: host,
        unix: socketPath,
        reusePort,
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

        onNodeHTTPRequest: (
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
        ) => {
          const prevIsNextIncomingMessageHTTPS = getIsNextIncomingMessageHTTPS();
          setIsNextIncomingMessageHTTPS(isHTTPS);
          if (!socket) {
            socket = new NodeHTTPServerSocket(server, socketHandle, !!tls);
          }

          const http_req = new (RequestClass as any)(
            kHandle,
            url,
            method,
            headersObject,
            headersArray,
            handle,
            hasBody,
            socket,
          );
          if (isAncientHTTP) {
            http_req.httpVersion = "1.0";
          }
          const http_res = new ResponseClass(http_req, {
            [kHandle]: handle,
            [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
          });
          setIsNextIncomingMessageHTTPS(prevIsNextIncomingMessageHTTPS);
          handle.onabort = onServerRequestEvent.bind(socket);
          if (hasBody) {
            handle.pause();
          }
          drainMicrotasks();

          let capturedError;
          let resolveFunction;
          let didFinish = false;

          const isRequestsLimitSet = typeof server.maxRequestsPerSocket === "number" && server.maxRequestsPerSocket > 0;
          let reachedRequestsLimit = false;
          if (isRequestsLimitSet) {
            const requestCount = (socket._requestCount || 0) + 1;
            socket._requestCount = requestCount;
            if (server.maxRequestsPerSocket < requestCount) {
              reachedRequestsLimit = true;
            }
          }

          if (isSocketNew && !reachedRequestsLimit) {
            server.emit("connection", socket);
          }

          socket[kRequest] = http_req;
          const is_upgrade = http_req.headers.upgrade;
          if (!is_upgrade) {
            if (canUseInternalAssignSocket) {
              assignSocketInternal(http_res, socket);
            } else {
              http_res.assignSocket(socket);
            }
          }
          function onClose() {
            didFinish = true;
            resolveFunction && resolveFunction();
          }

          setCloseCallback(http_res, onClose);
          if (reachedRequestsLimit) {
            server.emit("dropRequest", http_req, socket);
            http_res.writeHead(503);
            http_res.end();
            socket.destroy();
          } else if (is_upgrade) {
            server.emit("upgrade", http_req, socket, kEmptyBuffer);
            if (!socket._httpMessage) {
              if (canUseInternalAssignSocket) {
                assignSocketInternal(http_res, socket);
              } else {
                http_res.assignSocket(socket);
              }
            }
          } else if (http_req.headers.expect === "100-continue") {
            if (server.listenerCount("checkContinue") > 0) {
              server.emit("checkContinue", http_req, http_res);
            } else {
              http_res.writeContinue();
              server.emit("request", http_req, http_res);
            }
          } else {
            server.emit("request", http_req, http_res);
          }

          socket.cork();

          if (capturedError) {
            handle = undefined;
            http_res[kCloseCallback] = undefined;
            http_res.detachSocket(socket);
            throw capturedError;
          }

          if (handle.finished || didFinish) {
            handle = undefined;
            http_res[kCloseCallback] = undefined;
            http_res.detachSocket(socket);
            return;
          }
          if (http_res.socket) {
            http_res.on("finish", http_res.detachSocket.bind(http_res, socket));
          }

          const { resolve, promise } = $newPromiseCapability(GlobalPromise);
          resolveFunction = resolve;

          return promise;
        },
      } as unknown as Bun.ServeOptions);
      getBunServerAllClosedPromise(this[serverSymbol]).then(() => emitCloseNTServer.call(this), undefined);
      isHTTPS = this[serverSymbol].protocol === "https";
      setRequireHostHeader(this[serverSymbol], this.requireHostHeader);

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

      process.nextTick(() => emitListeningNextTick(this, this[serverSymbol]!.hostname, this[serverSymbol]!.port));
    }
  },

  setTimeout(msecs, callback) {
    const server = this[serverSymbol];
    if (server) {
      setServerIdleTimeout(server, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    } else {
      (this[kDeferredTimeouts] ??= []).push({ msecs, callback });
    }
    return this;
  },
};
Server.prototype = ServerPrototype as any;
$setPrototypeDirect(Server, EventEmitter);

const NodeHTTPServerSocket = class Socket extends Duplex {
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  [kHandle]: any;
  server: Server;
  _httpMessage;
  encrypted: boolean;
  _requestCount: number = 0;

  constructor(server: Server, handle, encrypted) {
    super();
    this.server = server;
    this[kHandle] = handle;
    handle.onclose = this.#onClose.bind(this);
    handle.duplex = this;
    this.encrypted = encrypted;
    this.on("timeout", onNodeHTTPServerSocketTimeout);
  }

  #closeHandle(handle, callback) {
    this[kHandle] = undefined;
    handle.onclose = this.#onCloseForDestroy.bind(this, callback);
    handle.close();
    const message = this._httpMessage;
    const req = message?.req;
    if (req && !req.complete) {
      req.destroy();
    }
  }
  #onClose() {
    this[kHandle] = null;
    const message = this._httpMessage;
    const req = message?.req;
    if (req && !req.complete && !req[kHandle]?.upgraded) {
      req[kHandle] = undefined;
      req.destroy(new ConnResetException("aborted"));
    }
  }
  #onCloseForDestroy(closeCallback) {
    this.#onClose();
    $isCallable(closeCallback) && closeCallback();
  }

  _onTimeout() {
    const handle = this[kHandle];
    const response = handle?.response;
    if (response && response.writableLength > 0) {
      return;
    }
    this.emit("timeout");
  }
  _unrefTimer() {
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
      $isCallable(callback) && callback(err);
      return;
    }
    if (handle.closed) {
      const onclose = handle.onclose;
      handle.onclose = null;
      if ($isCallable(onclose)) {
        onclose.call(handle);
      }
      $isCallable(callback) && callback(err);
      return;
    }

    this.#closeHandle(handle, callback);
  }

  _final(callback) {
    const handle = this[kHandle];
    if (!handle) {
      callback();
      return;
    }
    this.#closeHandle(handle, callback);
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
    this.address().address = val;
  }

  get remotePort() {
    return this.address()?.port;
  }

  set remotePort(val) {
    this.address().port = val;
  }

  get remoteFamily() {
    return this.address()?.family;
  }

  set remoteFamily(val) {
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

  unref() {
    return this;
  }

  _write(_chunk, _encoding, _callback) {}

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

function _normalizeArgs(args) {
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    return arr;
  }

  const arg0 = args[0];
  let options: any = {};
  if (typeof arg0 === "object" && arg0 !== null) {
    options = arg0;
  } else {
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === "string") {
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== "function") arr = [options, null];
  else arr = [options, cb];

  return arr;
}

function _writeHead(statusCode, reason, obj, response) {
  const originalStatusCode = statusCode;
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(format("%s", originalStatusCode));
  }

  if (typeof reason === "string") {
    response.statusMessage = reason;
  } else {
    if (!response.statusMessage) response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj ??= reason;
  }
  response.statusCode = statusCode;

  {
    let k;

    if ($isArray(obj)) {
      const length = obj.length;
      if (length && $isArray(obj[0])) {
        for (let i = 0; i < length; i++) {
          const k = obj[i];
          if (k) response.appendHeader(k[0], k[1]);
        }
      } else {
        if (length % 2 !== 0) {
          throw new Error("raw headers must have an even number of elements");
        }

        for (let n = 0; n < length; n += 2) {
          k = obj[n];
          if (k) response.setHeader(k, obj[n + 1]);
        }
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      const length = keys.length;
      for (let i = 0; i < length; i++) {
        k = keys[i];
        if (k) response.setHeader(k, obj[k]);
      }
    }
  }

  updateHasBody(response, statusCode);
}

Object.defineProperty(NodeHTTPServerSocket, "name", { value: "Socket" });

type ServerResponse = import("node:http").ServerResponse;

function updateHasBody(response, statusCode) {
  if (statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode <= 199)) {
    response._hasBody = false;
  } else {
    response._hasBody = true;
  }
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
  process.nextTick(() => emitServerSocketEOF(self, req));
}

let OriginalWriteHeadFn, OriginalImplicitHeadFn;

function callWriteHeadIfObservable(self, headerState) {
  if (
    headerState === NodeHTTPHeaderState.none &&
    !(self.writeHead === OriginalWriteHeadFn && (self as any)._implicitHeader === OriginalImplicitHeadFn)
  ) {
    self.writeHead(self.statusCode, self.statusMessage, self[headersSymbol]);
  }
}

function allowWritesToContinue() {
  this._callPendingCallbacks();
  this.emit("drain");
}

function drainHeadersIfObservable() {
  if ((this as any)._implicitHeader === OriginalImplicitHeadFn && this.writeHead === OriginalWriteHeadFn) {
    return;
  }

  (this as any)._implicitHeader();
}

function ServerResponse_finalDeprecated(chunk: any, encoding?: any, callback?: any): import("node:http").ServerResponse {
  if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  }
  if (!$isCallable(callback)) {
    callback = undefined;
  }

  if (this.destroyed || this.finished) {
    if (chunk) {
      (emitErrorNextTickIfErrorListenerNT as any)(this, $ERR_STREAM_WRITE_AFTER_END(), callback);
    }
    return this;
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
    this.headersSent = true;
    drainHeadersIfObservable.call(this);
    this[kDeprecatedReplySymbol](
      new Response(data, {
        headers: this[headersSymbol],
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      }),
    );
    if (shouldEmitClose) {
      req.complete = true;
      process.nextTick(() => emitRequestCloseNT(req));
    }
    callback?.();
    return this;
  }

  this.finished = true;
  ensureReadableStreamController.call(this, (controller: any) => {
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
      callback?.();
      const deferred = this[deferredSymbol];
      if (deferred) {
        this[deferredSymbol] = undefined;
        deferred();
      }
    };
    if ($isPromise(prom)) prom.then(handler, handler);
    else handler();
  });
  return this;
}

ServerResponse.prototype.writeHead = ServerResponse.prototype.writeHead;

OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = (ServerResponse.prototype as any)._implicitHeader;

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
    this.requestTimeout = 300_000;
  }

  const headersTimeout = options.headersTimeout;
  if (headersTimeout !== undefined) {
    validateInteger(headersTimeout, "headersTimeout", 0);
    this.headersTimeout = headersTimeout;
  } else {
    this.headersTimeout = MathMin(60_000, this.requestTimeout);
  }

  if (this.requestTimeout > 0 && this.headersTimeout > 0 && this.headersTimeout > this.requestTimeout) {
    throw $ERR_OUT_OF_RANGE("headersTimeout", "<= requestTimeout", headersTimeout);
  }

  const keepAliveTimeout = options.keepAliveTimeout;
  if (keepAliveTimeout !== undefined) {
    validateInteger(keepAliveTimeout, "keepAliveTimeout", 0);
    this.keepAliveTimeout = keepAliveTimeout;
  } else {
    this.keepAliveTimeout = 5_000;
  }

  const connectionsCheckingInterval = options.connectionsCheckingInterval;
  if (connectionsCheckingInterval !== undefined) {
    validateInteger(connectionsCheckingInterval, "connectionsCheckingInterval", 0);
    this.connectionsCheckingInterval = connectionsCheckingInterval;
  } else {
    this.connectionsCheckingInterval = 30_000;
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

  const rejectNonStandardBodyWrites = options.rejectNonStandardBodyWrites;
  if (rejectNonStandardBodyWrites !== undefined) {
    validateBoolean(rejectNonStandardBodyWrites, "options.rejectNonStandardBodyWrites");
    this.rejectNonStandardBodyWrites = rejectNonStandardBodyWrites;
  } else {
    this.rejectNonStandardBodyWrites = false;
  }
}

function ensureReadableStreamController(run: (controller: any) => void) {
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
        pull: (controller: any) => {
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
        headers: this[headersSymbol],
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      },
    ),
  );
}

export default {
  Server,
  ServerResponse,
};