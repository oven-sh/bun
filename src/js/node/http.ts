const enum ClientRequestEmitState {
  socket = 1,
  prefinish = 2,
  finish = 3,
  response = 4,
}

const enum NodeHTTPResponseAbortEvent {
  none = 0,
  abort = 1,
  timeout = 2,
}
const enum NodeHTTPIncomingRequestType {
  FetchRequest,
  FetchResponse,
  NodeHTTPResponse,
}
const enum NodeHTTPHeaderState {
  none,
  assigned,
  sent,
}
const enum NodeHTTPBodyReadState {
  none,
  pending = 1 << 1,
  done = 1 << 2,
  hasBufferedDataDuringPause = 1 << 3,
}

const headerStateSymbol = Symbol("headerState");
// used for pretending to emit events in the right order
const kEmitState = Symbol("emitState");

const abortedSymbol = Symbol("aborted");
const bodyStreamSymbol = Symbol("bodyStream");
const closedSymbol = Symbol("closed");
const controllerSymbol = Symbol("controller");
const runSymbol = Symbol("run");
const deferredSymbol = Symbol("deferred");
const eofInProgress = Symbol("eofInProgress");
const fakeSocketSymbol = Symbol("fakeSocket");
const finishedSymbol = "finished";
const firstWriteSymbol = Symbol("firstWrite");
const headersSymbol = Symbol("headers");
const isTlsSymbol = Symbol("is_tls");
const kClearTimeout = Symbol("kClearTimeout");
const kfakeSocket = Symbol("kfakeSocket");
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
const kEndCalled = Symbol.for("kEndCalled");
const kAbortController = Symbol.for("kAbortController");
const statusMessageSymbol = Symbol("statusMessage");
const kInternalSocketData = Symbol.for("::bunternal::");
const serverSymbol = Symbol.for("::bunternal::");

const kRequest = Symbol("request");

const kEmptyObject = Object.freeze(Object.create(null));

const { kDeprecatedReplySymbol } = require("internal/http");
const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");
const { isTypedArray } = require("node:util/types");
const { Duplex, Readable, Stream } = require("node:stream");
const { ERR_INVALID_ARG_TYPE, ERR_INVALID_PROTOCOL } = require("internal/errors");
const { isPrimary } = require("internal/cluster/isPrimary");
const { kAutoDestroyed } = require("internal/shared");
const { urlToHttpOptions } = require("internal/url");
const { validateFunction, checkIsHttpToken } = require("internal/validators");

const {
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
  webRequestOrResponseHasBodyValue,
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer,
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
  webRequestOrResponseHasBodyValue: (arg: any) => boolean;
  getCompleteWebRequestOrResponseBodyValueAsArrayBuffer: (arg: any) => ArrayBuffer | undefined;
};

let cluster;
const sendHelper = $newZigFunction("node_cluster_binding.zig", "sendHelperChild", 3);
const getBunServerAllClosedPromise = $newZigFunction("node_http_binding.zig", "getBunServerAllClosedPromise", 1);

// TODO: make this more robust.
function isAbortError(err) {
  return err?.name === "AbortError";
}

const ObjectDefineProperty = Object.defineProperty;

const GlobalPromise = globalThis.Promise;
const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
/**
 * True if val contains an invalid field-vchar
 *  field-value    = *( field-content / obs-fold )
 *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 *  field-vchar    = VCHAR / obs-text
 */
function checkInvalidHeaderChar(val: string) {
  return RegExpPrototypeExec.$call(headerCharRegex, val) !== null;
}

const validateHeaderName = (name, label) => {
  if (typeof name !== "string" || !name || !checkIsHttpToken(name)) {
    throw $ERR_INVALID_HTTP_TOKEN(`The arguments Header name is invalid. Received ${name}`);
  }
};

const validateHeaderValue = (name, value) => {
  if (value === undefined) {
    // throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
    throw $ERR_HTTP_INVALID_HEADER_VALUE(`Invalid header value: ${value} for ${name}`);
  }
  if (checkInvalidHeaderChar(value)) {
    // throw new ERR_INVALID_CHAR("header content", name);
    throw $ERR_INVALID_CHAR(`Invalid header value: ${value} for ${name}`);
  }
};

function ERR_HTTP_SOCKET_ASSIGNED() {
  return new Error(`ServerResponse has an already assigned socket`);
}

// TODO: add primordial for URL
// Importing from node:url is unnecessary
const { URL } = globalThis;

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const fetch = Bun.fetch;
const nop = () => {};

// Primordials
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

const kEmptyBuffer = Buffer.alloc(0);

function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof ArrayBuffer || obj instanceof Blob) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item !== "string" && !isTypedArray(item) && !(item instanceof ArrayBuffer) && !(item instanceof Blob))
        return false;
    }
    return true;
  }
  return false;
}

function validateMsecs(numberlike: any, field: string) {
  if (typeof numberlike !== "number" || numberlike < 0) {
    throw ERR_INVALID_ARG_TYPE(field, "number", numberlike);
  }

  return numberlike;
}

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]!: [typeof Server, typeof OutgoingMessage, typeof Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address;
  address() {
    // Call server.requestIP() without doing any propety getter twice.
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
    return "127.0.0.1";
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

class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
    this.name = "ConnResetException";
  }
}

const NodeHTTPServerSocket = class Socket extends Duplex {
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  [kHandle];
  server: Server;
  _httpMessage;

  constructor(server: Server, handle, encrypted) {
    super();
    this.server = server;
    this[kHandle] = handle;
    handle.onclose = this.#onClose.bind(this);
    handle.duplex = this;
    this.encrypted = encrypted;
    this.on("timeout", onNodeHTTPServerSocketTimeout);
  }

  #onClose() {
    const handle = this[kHandle];
    this[kHandle] = null;
    const message = this._httpMessage;
    const req = message?.req;
    if (req && !req.complete) {
      req.destroy(new ConnResetException("aborted"));
    }
  }
  #onCloseForDestroy(closeCallback) {
    this.#onClose();
    $isCallable(closeCallback) && closeCallback();
  }

  address() {
    return this[kHandle]?.remoteAddress || null;
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(port, host, connectListener) {
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
        onclose.$call(handle);
      }
      $isCallable(callback) && callback(err);
      return;
    }
    this[kHandle] = undefined;
    handle.onclose = this.#onCloseForDestroy.bind(this, callback);
    handle.close();
  }

  _final(callback) {
    const handle = this[kHandle];
    if (!handle) {
      callback();
      return;
    }
    handle.onclose = this.#onCloseForDestroy.bind(this, callback);
    handle.close();
  }

  get localAddress() {
    return "127.0.0.1";
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
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, encoding, callback) {}

  pause() {
    const message = this._httpMessage;
    const handle = this[kHandle];
    const response = handle?.response;
    if (response && message) {
      response.pause();
    }
    return super.pause();
  }

  resume() {
    const message = this._httpMessage;
    const handle = this[kHandle];
    const response = handle?.response;
    if (response && message) {
      response.resume();
    }
    return super.resume();
  }
} as unknown as typeof import("node:net").Socket;

function createServer(options, callback) {
  return new Server(options, callback);
}

function Agent(options = kEmptyObject) {
  if (!(this instanceof Agent)) return new Agent(options);

  EventEmitter.$apply(this, []);

  this.defaultPort = 80;
  this.protocol = "http:";

  this.options = options = { ...options, path: null };
  if (options.noDelay === undefined) options.noDelay = true;

  // Don't confuse net and make it think that we're connecting to a pipe
  this.requests = Object.create(null);
  this.sockets = Object.create(null);
  this.freeSockets = Object.create(null);

  this.keepAliveMsecs = options.keepAliveMsecs || 1000;
  this.keepAlive = options.keepAlive || false;
  this.maxSockets = options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = options.maxFreeSockets || 256;
  this.scheduling = options.scheduling || "lifo";
  this.maxTotalSockets = options.maxTotalSockets;
  this.totalSocketCount = 0;
  this.defaultPort = options.defaultPort || 80;
  this.protocol = options.protocol || "http:";
}
$toClass(Agent, "Agent", EventEmitter);

Object.defineProperty(FakeSocket, "name", { value: "Socket" });
Object.defineProperty(NodeHTTPServerSocket, "name", { value: "Socket" });

ObjectDefineProperty(Agent, "globalAgent", {
  get: function () {
    return globalAgent;
  },
});

ObjectDefineProperty(Agent, "defaultMaxSockets", {
  get: function () {
    return Infinity;
  },
});

Agent.prototype.createConnection = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
  return (this[kfakeSocket] ??= new FakeSocket());
};

Agent.prototype.getName = function (options = kEmptyObject) {
  let name = `http:${options.host || "localhost"}:`;
  if (options.port) name += options.port;
  name += ":";
  if (options.localAddress) name += options.localAddress;
  // Pacify parallel/test-http-agent-getname by only appending
  // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6) name += `:${options.family}`;
  if (options.socketPath) name += `:${options.socketPath}`;
  return name;
};

Agent.prototype.addRequest = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
};

Agent.prototype.createSocket = function (req, options, cb) {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
  cb(null, (this[kfakeSocket] ??= new FakeSocket()));
};

Agent.prototype.removeSocket = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.removeSocket is a no-op");
};

Agent.prototype.keepSocketAlive = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.keepSocketAlive is a no-op");
  return true;
};

Agent.prototype.reuseSocket = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.reuseSocket is a no-op");
};

Agent.prototype.destroy = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.destroy is a no-op");
};

function emitListeningNextTick(self, hostname, port) {
  if ((self.listening = !!self[serverSymbol])) {
    // TODO: remove the arguments
    // Note does not pass any arguments.
    self.emit("listening", null, hostname, port);
  }
}

type Server = InstanceType<typeof Server>;
const Server = function Server(options, callback) {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);

  this.listening = false;
  this._unref = false;
  this[kInternalSocketData] = undefined;

  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null || typeof options === "object") {
    options = { ...options };
    this[tlsSymbol] = null;
    let key = options.key;
    if (key) {
      if (!isValidTLSArray(key)) {
        throw new TypeError(
          "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      }
      this[isTlsSymbol] = true;
    }
    let cert = options.cert;
    if (cert) {
      if (!isValidTLSArray(cert)) {
        throw new TypeError(
          "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      }
      this[isTlsSymbol] = true;
    }

    let ca = options.ca;
    if (ca) {
      if (!isValidTLSArray(ca)) {
        throw new TypeError(
          "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      }
      this[isTlsSymbol] = true;
    }
    let passphrase = options.passphrase;
    if (passphrase && typeof passphrase !== "string") {
      throw new TypeError("passphrase argument must be an string");
    }

    let serverName = options.servername;
    if (serverName && typeof serverName !== "string") {
      throw new TypeError("servername argument must be an string");
    }

    let secureOptions = options.secureOptions || 0;
    if (secureOptions && typeof secureOptions !== "number") {
      throw new TypeError("secureOptions argument must be an number");
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
  } else {
    throw new Error("bun-http-polyfill: invalid arguments");
  }

  this[optionsSymbol] = options;

  if (callback) this.on("request", callback);
  return this;
} as unknown as typeof import("node:http").Server;
Object.defineProperty(Server, "name", { value: "Server" });

function onRequestEvent(event) {
  const [server, http_res, req] = this.socket[kInternalSocketData];

  if (!http_res[finishedSymbol]) {
    switch (event) {
      case NodeHTTPResponseAbortEvent.timeout:
        this.emit("timeout");
        server.emit("timeout", req.socket);
        break;
      case NodeHTTPResponseAbortEvent.abort:
        http_res[finishedSymbol] = true;
        this.destroy();
        break;
    }
  }
}

function onServerRequestEvent(this: NodeHTTPServerSocket, event: NodeHTTPResponseAbortEvent) {
  const server: Server = this?.server;
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

const ServerPrototype = {
  constructor: Server,
  __proto__: EventEmitter.prototype,
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
    // not actually implemented
  },

  close(optionalCallback?) {
    const server = this[serverSymbol];
    if (!server) {
      if (typeof optionalCallback === "function")
        process.nextTick(optionalCallback, new Error("Server is not running"));
      return;
    }
    this[serverSymbol] = undefined;
    if (typeof optionalCallback === "function") this.once("close", optionalCallback);
    server.stop();
  },

  [Symbol.asyncDispose]() {
    const { resolve, reject, promise } = Promise.withResolvers();
    this.close(function (err, ...args) {
      if (err) reject(err);
      else resolve(...args);
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

    // This logic must align with:
    // - https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L274-L307
    if (arguments.length > 0) {
      if (($isObject(arguments[0]) || $isCallable(arguments[0])) && arguments[0] !== null) {
        // (options[...][, cb])
        port = arguments[0].port;
        host = arguments[0].host;
        socketPath = arguments[0].path;

        const otherTLS = arguments[0].tls;
        if (otherTLS && $isObject(otherTLS)) {
          tls = otherTLS;
        }
      } else if (typeof arguments[0] === "string" && !(Number(arguments[0]) >= 0)) {
        // (path[...][, cb])
        socketPath = arguments[0];
      } else {
        // ([port][, host][...][, cb])
        port = arguments[0];
        if (arguments.length > 1 && typeof arguments[1] === "string") {
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

    if ($isCallable(arguments[arguments.length - 1])) {
      onListen = arguments[arguments.length - 1];
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
  },

  [kRealListen](tls, port, host, socketPath, reusePort, onListen) {
    {
      const ResponseClass = this[optionsSymbol].ServerResponse || ServerResponse;
      const RequestClass = this[optionsSymbol].IncomingMessage || IncomingMessage;
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
        ) {
          const prevIsNextIncomingMessageHTTPS = isNextIncomingMessageHTTPS;
          isNextIncomingMessageHTTPS = isHTTPS;
          if (!socket) {
            socket = new NodeHTTPServerSocket(server, socketHandle, !!tls);
          }

          const http_req = new RequestClass(kHandle, url, method, headersObject, headersArray, handle, hasBody, socket);
          const http_res = new ResponseClass(http_req, {
            [kHandle]: handle,
          });
          isNextIncomingMessageHTTPS = prevIsNextIncomingMessageHTTPS;

          let capturedError;
          let rejectFunction;
          let errorCallback = err => {
            if (capturedError) return;
            capturedError = err;
            if (rejectFunction) rejectFunction(err);
            handle && (handle.onabort = undefined);
            handle = undefined;
          };

          let resolveFunction;
          let didFinish = false;

          handle.onabort = onServerRequestEvent.bind(socket);

          if (isSocketNew) {
            server.emit("connection", socket);
          }

          socket[kRequest] = http_req;

          http_res.assignSocket(socket);
          function onClose() {
            didFinish = true;
            resolveFunction && resolveFunction();
          }
          http_res.once("close", onClose);
          const upgrade = http_req.headers.upgrade;
          if (upgrade) {
            server.emit("upgrade", http_req, http_req.socket, kEmptyBuffer);
          } else {
            server.emit("request", http_req, http_res);
          }

          socket.cork(drainMicrotasks);

          if (capturedError) {
            handle = undefined;
            http_res.removeListener("close", onClose);
            if (socket._httpMessage === http_res) {
              socket._httpMessage = null;
            }
            throw capturedError;
          }

          if (handle.finished || didFinish) {
            handle = undefined;
            http_res.removeListener("close", onClose);
            if (socket._httpMessage === http_res) {
              socket._httpMessage = null;
            }
            return;
          }

          const { reject, resolve, promise } = $newPromiseCapability(Promise);
          resolveFunction = resolve;
          rejectFunction = reject;

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

      if (this?._unref) {
        this[serverSymbol]?.unref?.();
      }

      if ($isCallable(onListen)) {
        this.once("listening", onListen);
      }

      setTimeout(emitListeningNextTick, 1, this, this[serverSymbol].hostname, this[serverSymbol].port);
    }
  },

  setTimeout(msecs, callback) {
    const server = this[serverSymbol];
    if (server) {
      setServerIdleTimeout(server, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  },
};
Server.prototype = ServerPrototype;
$setPrototypeDirect.$call(Server, EventEmitter);

function assignHeadersSlow(object, req) {
  const headers = req.headers;
  var outHeaders = Object.create(null);
  const rawHeaders: string[] = [];
  var i = 0;
  for (let key in headers) {
    var originalKey = key;
    var value = headers[originalKey];

    key = key.toLowerCase();

    if (key !== "set-cookie") {
      value = String(value);
      $putByValDirect(rawHeaders, i++, originalKey);
      $putByValDirect(rawHeaders, i++, value);
      outHeaders[key] = value;
    } else {
      if ($isJSArray(value)) {
        outHeaders[key] = value.slice();

        for (let entry of value) {
          $putByValDirect(rawHeaders, i++, originalKey);
          $putByValDirect(rawHeaders, i++, entry);
        }
      } else {
        value = String(value);
        outHeaders[key] = [value];
        $putByValDirect(rawHeaders, i++, originalKey);
        $putByValDirect(rawHeaders, i++, value);
      }
    }
  }
  object.headers = outHeaders;
  object.rawHeaders = rawHeaders;
}

function assignHeaders(object, req) {
  // This fast path is an 8% speedup for a "hello world" node:http server, and a 7% speedup for a "hello world" express server
  if (assignHeadersFast(req, object, headersTuple)) {
    const headers = $getInternalField(headersTuple, 0);
    const rawHeaders = $getInternalField(headersTuple, 1);
    $putInternalField(headersTuple, 0, undefined);
    $putInternalField(headersTuple, 1, undefined);
    object.headers = headers;
    object.rawHeaders = rawHeaders;
    return true;
  } else {
    assignHeadersSlow(object, req);
    return false;
  }
}

var defaultIncomingOpts = { type: "request" };

function requestHasNoBody(method, req) {
  if ("GET" === method || "HEAD" === method || "TRACE" === method || "CONNECT" === method || "OPTIONS" === method)
    return true;
  const headers = req?.headers;
  const contentLength = headers?.["content-length"];
  if (!parseInt(contentLength, 10)) return true;

  return false;
}

// This lets us skip some URL parsing
var isNextIncomingMessageHTTPS = false;

function emitEOFIncomingMessageOuter(self) {
  self.push(null);
  self.complete = true;
}
function emitEOFIncomingMessage(self) {
  self[eofInProgress] = true;
  process.nextTick(emitEOFIncomingMessageOuter, self);
}

function hasServerResponseFinished(self, chunk, callback) {
  const finished = self.finished;

  if (chunk) {
    const destroyed = self.destroyed;

    if (finished || destroyed) {
      let err;
      if (finished) {
        err = $ERR_STREAM_WRITE_AFTER_END("Stream is already finished");
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

function onIncomingMessagePauseNodeHTTPResponse(this: IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) {
    const paused = handle.pause();
  }
}

function onIncomingMessageResumeNodeHTTPResponse(this: IncomingMessage) {
  const handle = this[kHandle];
  if (handle && !this.destroyed) {
    const resumed = handle.resume();
    if (resumed && resumed !== true) {
      const bodyReadState = handle.hasBody;
      if ((bodyReadState & NodeHTTPBodyReadState.done) !== 0) {
        emitEOFIncomingMessage(this);
      }
      this.push(resumed);
    }
  }
}

function IncomingMessage(req, defaultIncomingOpts) {
  this[abortedSymbol] = false;
  this[eofInProgress] = false;
  this._consuming = false;
  this._dumped = false;
  this.complete = false;
  this._closed = false;

  // (url, method, headers, rawHeaders, handle, hasBody)
  if (req === kHandle) {
    this[typeSymbol] = NodeHTTPIncomingRequestType.NodeHTTPResponse;
    this.url = arguments[1];
    this.method = arguments[2];
    this.headers = arguments[3];
    this.rawHeaders = arguments[4];
    this[kHandle] = arguments[5];
    this[noBodySymbol] = !arguments[6];
    this[fakeSocketSymbol] = arguments[7];
    Readable.$call(this);

    // If there's a body, pay attention to pause/resume events
    if (arguments[6]) {
      this.on("pause", onIncomingMessagePauseNodeHTTPResponse);
      this.on("resume", onIncomingMessageResumeNodeHTTPResponse);
    }
  } else {
    this[noBodySymbol] = false;
    Readable.$call(this);
    var { [typeSymbol]: type, [reqSymbol]: nodeReq } = defaultIncomingOpts || {};

    this[webRequestOrResponse] = req;
    this[typeSymbol] = type;
    this[bodyStreamSymbol] = undefined;
    this[statusMessageSymbol] = (req as Response)?.statusText || null;
    this[statusCodeSymbol] = (req as Response)?.status || 200;

    if (type === NodeHTTPIncomingRequestType.FetchRequest || type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!assignHeaders(this, req)) {
        this[fakeSocketSymbol] = req;
      }
    } else {
      // Node defaults url and method to null.
      this.url = "";
      this.method = null;
      this.rawHeaders = [];
    }

    this[noBodySymbol] =
      type === NodeHTTPIncomingRequestType.FetchRequest // TODO: Add logic for checking for body on response
        ? requestHasNoBody(this.method, this)
        : false;

    if (isNextIncomingMessageHTTPS) {
      this.socket.encrypted = true;
      isNextIncomingMessageHTTPS = false;
    }
  }

  this._readableState.readingMore = true;
}

function onDataIncomingMessage(
  this: import("node:http").IncomingMessage,
  chunk,
  isLast,
  aborted: NodeHTTPResponseAbortEvent,
) {
  if (aborted === NodeHTTPResponseAbortEvent.abort) {
    this.destroy();
    return;
  }

  if (chunk && !this._dumped) this.push(chunk);

  if (isLast) {
    emitEOFIncomingMessage(this);
  }
}

const IncomingMessagePrototype = {
  constructor: IncomingMessage,
  __proto__: Readable.prototype,
  _construct(callback) {
    // TODO: streaming
    const type = this[typeSymbol];

    if (type === NodeHTTPIncomingRequestType.FetchResponse) {
      if (!webRequestOrResponseHasBodyValue(this[webRequestOrResponse])) {
        this.complete = true;
        this.push(null);
      }
    }

    callback();
  },
  // Call this instead of resume() if we want to just
  // dump all the data to /dev/null
  _dump() {
    if (!this._dumped) {
      this._dumped = true;
      // If there is buffered data, it may trigger 'data' events.
      // Remove 'data' event listeners explicitly.
      this.removeAllListeners("data");
      const handle = this[kHandle];
      if (handle) {
        handle.ondata = undefined;
      }
      this.resume();
    }
  },
  _read(size) {
    if (!this._consuming) {
      this._readableState.readingMore = false;
      this._consuming = true;
    }

    if (this[eofInProgress]) {
      // There is a nextTick pending that will emit EOF
      return;
    }

    let internalRequest;
    if (this[noBodySymbol]) {
      emitEOFIncomingMessage(this);
      return;
    } else if ((internalRequest = this[kHandle])) {
      const bodyReadState = internalRequest.hasBody;

      if (
        (bodyReadState & NodeHTTPBodyReadState.done) !== 0 ||
        bodyReadState === NodeHTTPBodyReadState.none ||
        this._dumped
      ) {
        emitEOFIncomingMessage(this);
      }

      if ((bodyReadState & NodeHTTPBodyReadState.hasBufferedDataDuringPause) !== 0) {
        const drained = internalRequest.drainRequestBody();
        if (drained && !this._dumped) {
          this.push(drained);
        }
      }

      if (!internalRequest.ondata) {
        internalRequest.ondata = onDataIncomingMessage.bind(this);
      }

      return true;
    } else if (this[bodyStreamSymbol] == null) {
      // If it's all available right now, we skip going through ReadableStream.
      let completeBody = getCompleteWebRequestOrResponseBodyValueAsArrayBuffer(this[webRequestOrResponse]);
      if (completeBody) {
        $assert(completeBody instanceof ArrayBuffer, "completeBody is not an ArrayBuffer");
        $assert(completeBody.byteLength > 0, "completeBody should not be empty");

        // They're ignoring the data. Let's not do anything with it.
        if (!this._dumped) {
          this.push(new Buffer(completeBody));
        }
        emitEOFIncomingMessage(this);
        return;
      }

      const reader = this[webRequestOrResponse].body?.getReader?.() as ReadableStreamDefaultReader;
      if (!reader) {
        emitEOFIncomingMessage(this);
        return;
      }

      this[bodyStreamSymbol] = reader;
      consumeStream(this, reader);
    }

    return;
  },
  _finish() {
    this.emit("prefinish");
  },
  _destroy: function IncomingMessage_destroy(err, cb) {
    const shouldEmitAborted = !this.readableEnded || !this.complete;

    if (shouldEmitAborted) {
      this[abortedSymbol] = true;
      // IncomingMessage emits 'aborted'.
      // Client emits 'abort'.
      this.emit("aborted");
    }

    // Suppress "AbortError" from fetch() because we emit this in the 'aborted' event
    if (isAbortError(err)) {
      err = undefined;
    }

    var nodeHTTPResponse = this[kHandle];
    if (nodeHTTPResponse) {
      this[kHandle] = undefined;
      nodeHTTPResponse.onabort = nodeHTTPResponse.ondata = undefined;
      if (!nodeHTTPResponse.finished && shouldEmitAborted) {
        nodeHTTPResponse.abort();
      }
      const socket = this.socket;
      if (socket && !socket.destroyed && shouldEmitAborted) {
        socket.destroy(err);
      }
    } else {
      const stream = this[bodyStreamSymbol];
      this[bodyStreamSymbol] = undefined;
      const streamState = stream?.$state;

      if (streamState === $streamReadable || streamState === $streamWaiting || streamState === $streamWritable) {
        stream?.cancel?.().catch(nop);
      }

      const socket = this[fakeSocketSymbol];
      if (socket && !socket.destroyed && shouldEmitAborted) {
        socket.destroy(err);
      }
    }

    if ($isCallable(cb)) {
      emitErrorNextTickIfErrorListenerNT(this, err, cb);
    }
  },
  get aborted() {
    return this[abortedSymbol];
  },
  set aborted(value) {
    this[abortedSymbol] = value;
  },
  get connection() {
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  get statusCode() {
    return this[statusCodeSymbol];
  },
  set statusCode(value) {
    if (!(value in STATUS_CODES)) return;
    this[statusCodeSymbol] = value;
  },
  get statusMessage() {
    return this[statusMessageSymbol];
  },
  set statusMessage(value) {
    this[statusMessageSymbol] = value;
  },
  get httpVersion() {
    return "1.1";
  },
  set httpVersion(value) {
    // noop
  },
  get httpVersionMajor() {
    return 1;
  },
  set httpVersionMajor(value) {
    // noop
  },
  get httpVersionMinor() {
    return 1;
  },
  set httpVersionMinor(value) {
    // noop
  },
  get rawTrailers() {
    return [];
  },
  set rawTrailers(value) {
    // noop
  },
  get trailers() {
    return kEmptyObject;
  },
  set trailers(value) {
    // noop
  },
  setTimeout(msecs, callback) {
    this.take;
    const req = this[kHandle] || this[webRequestOrResponse];

    if (req) {
      setRequestTimeout(req, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  },
  get socket() {
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  set socket(value) {
    this[fakeSocketSymbol] = value;
  },
} satisfies typeof import("node:http").IncomingMessage.prototype;
IncomingMessage.prototype = IncomingMessagePrototype;
$setPrototypeDirect.$call(IncomingMessage, Readable);

async function consumeStream(self, reader: ReadableStreamDefaultReader) {
  var done = false,
    value,
    aborted = false;
  try {
    while (true) {
      const result = reader.readMany();
      if ($isPromise(result)) {
        ({ done, value } = await result);
      } else {
        ({ done, value } = result);
      }

      if (self.destroyed || (aborted = self[abortedSymbol])) {
        break;
      }
      if (!self._dumped) {
        for (var v of value) {
          self.push(v);
        }
      }

      if (self.destroyed || (aborted = self[abortedSymbol]) || done) {
        break;
      }
    }
  } catch (err) {
    if (aborted || self.destroyed) return;
    self.destroy(err);
  } finally {
    reader?.cancel?.().catch?.(nop);
  }

  if (!self.complete) {
    emitEOFIncomingMessage(self);
  }
}

function OutgoingMessage(options) {
  if (!new.target) {
    return new OutgoingMessage(options);
  }

  Stream.$call(this, options);

  this.sendDate = true;
  this[finishedSymbol] = false;
  this[headerStateSymbol] = NodeHTTPHeaderState.none;
  this[kAbortController] = null;

  this.writable = true;
  this.destroyed = false;
  this._hasBody = true;
  this._trailer = "";
  this._contentLength = null;
  this._closed = false;
  this._header = null;
  this._headerSent = false;
}
const OutgoingMessagePrototype = {
  constructor: OutgoingMessage,
  __proto__: Stream.prototype,

  // These are fields which we do not use in our implementation, but are observable in Node.js.
  _keepAliveTimeout: 0,
  _defaultKeepAlive: true,
  shouldKeepAlive: true,
  _onPendingData: function nop() {},
  outputSize: 0,
  outputData: [],
  strictContentLength: false,
  _removedTE: false,
  _removedContLen: false,
  _removedConnection: false,
  usesChunkedEncodingByDefault: true,

  appendHeader(name, value) {
    var headers = (this[headersSymbol] ??= new Headers());
    headers.append(name, value);
    return this;
  },

  _implicitHeader() {
    throw $ERR_METHOD_NOT_IMPLEMENTED("The method _implicitHeader() is not implemented");
  },
  flushHeaders() {},
  getHeader(name) {
    return getHeader(this[headersSymbol], name);
  },

  getHeaderNames() {
    var headers = this[headersSymbol];
    if (!headers) return [];
    return Array.from(headers.keys());
  },

  getHeaders() {
    const headers = this[headersSymbol];
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  },

  removeHeader(name) {
    if (this[headerStateSymbol] === NodeHTTPHeaderState.sent) {
      throw $ERR_HTTP_HEADERS_SENT("Cannot remove header after headers have been sent.");
    }
    const headers = this[headersSymbol];
    if (!headers) return;
    headers.delete(name);
  },

  setHeader(name, value) {
    const headers = (this[headersSymbol] ??= new Headers());
    setHeader(headers, name, value);
    return this;
  },

  hasHeader(name) {
    const headers = this[headersSymbol];
    if (!headers) return false;
    return headers.has(name);
  },

  get headers() {
    const headers = this[headersSymbol];
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  },
  set headers(value) {
    this[headersSymbol] = new Headers(value);
  },

  addTrailers(headers) {
    throw new Error("not implemented");
  },

  setTimeout(msecs, callback) {
    if (this.destroyed) return this;

    this.timeout = msecs = validateMsecs(msecs, "msecs");

    // Attempt to clear an existing timer in both cases -
    //  even if it will be rescheduled we don't want to leak an existing timer.
    clearTimeout(this[timeoutTimerSymbol]);

    if (msecs === 0) {
      if (callback != null) {
        if (!$isCallable(callback)) validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }

      this[timeoutTimerSymbol] = undefined;
    } else {
      this[timeoutTimerSymbol] = setTimeout(onTimeout.bind(this), msecs).unref();

      if (callback != null) {
        if (!$isCallable(callback)) validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }

    return this;
  },

  get connection() {
    return this.socket;
  },

  get socket() {
    this[fakeSocketSymbol] = this[fakeSocketSymbol] ?? new FakeSocket();
    return this[fakeSocketSymbol];
  },

  set socket(value) {
    this[fakeSocketSymbol] = value;
  },

  get chunkedEncoding() {
    return false;
  },

  set chunkedEncoding(value) {
    // noop
  },

  get writableObjectMode() {
    return false;
  },

  get writableLength() {
    return 0;
  },

  get writableHighWaterMark() {
    return 16 * 1024;
  },

  get writableNeedDrain() {
    return !this.destroyed && !this[finishedSymbol];
  },

  get writableEnded() {
    return this[finishedSymbol];
  },

  get writableFinished() {
    return this[finishedSymbol];
  },

  _send(data, encoding, callback, byteLength) {
    if (this.destroyed) {
      return false;
    }
    return this.write(data, encoding, callback);
  },
  end(chunk, encoding, callback) {
    return this;
  },
  destroy(err?: Error) {
    if (this.destroyed) return this;
    const handle = this[kHandle];
    this.destroyed = true;
    if (handle) {
      handle.abort();
    }
    return this;
  },
};
OutgoingMessage.prototype = OutgoingMessagePrototype;
$setPrototypeDirect.$call(OutgoingMessage, Stream);

function onNodeHTTPServerSocketTimeout() {
  const req = this[kRequest];
  const reqTimeout = req && !req.complete && req.emit("timeout", this);
  const res = this._httpMessage;
  const resTimeout = res && res.emit("timeout", this);
  const serverTimeout = this.server.emit("timeout", this);

  if (!reqTimeout && !resTimeout && !serverTimeout) this.destroy();
}

function onTimeout() {
  this[timeoutTimerSymbol] = undefined;
  this[kAbortController]?.abort();
  const handle = this[kHandle];

  this.emit("timeout");
  if (handle) {
    handle.abort();
  }
}

function emitContinueAndSocketNT(self) {
  if (self.destroyed) return;
  // Ref: https://github.com/nodejs/node/blob/f63e8b7fa7a4b5e041ddec67307609ec8837154f/lib/_http_client.js#L803-L839
  if (!(self[kEmitState] & (1 << ClientRequestEmitState.socket))) {
    self[kEmitState] |= 1 << ClientRequestEmitState.socket;
    self.emit("socket", self.socket);
  }

  //Emit continue event for the client (internally we auto handle it)
  if (!self._closed && self.getHeader("expect") === "100-continue") {
    self.emit("continue");
  }
}
function emitCloseNT(self) {
  if (!self._closed) {
    self.destroyed = true;
    self._closed = true;

    self.emit("close");
  }
}

function emitCloseNTAndComplete(self) {
  if (!self._closed) {
    self._closed = true;
    self.emit("close");
  }

  self.complete = true;
}

function emitRequestCloseNT(self) {
  self.emit("close");
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

let OriginalWriteHeadFn, OriginalImplicitHeadFn;

function ServerResponse(req, options) {
  if (!new.target) {
    return new ServerResponse(req, options);
  }

  if ((this[kDeprecatedReplySymbol] = options?.[kDeprecatedReplySymbol])) {
    this[controllerSymbol] = undefined;
    this[firstWriteSymbol] = undefined;
    this[deferredSymbol] = undefined;
    this.write = ServerResponse_writeDeprecated;
    this.end = ServerResponse_finalDeprecated;
  }

  OutgoingMessage.$call(this, options);

  this.req = req;
  this.sendDate = true;
  this._sent100 = false;
  this[headerStateSymbol] = NodeHTTPHeaderState.none;

  // this is matching node's behaviour
  // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
  if (req.method === "HEAD") this._hasBody = false;

  const handle = options?.[kHandle];

  if (handle) {
    this[kHandle] = handle;
  }
}

function callWriteHeadIfObservable(self, headerState) {
  if (
    headerState === NodeHTTPHeaderState.none &&
    !(self.writeHead === OriginalWriteHeadFn && self._implicitHeader === OriginalImplicitHeadFn)
  ) {
    self.writeHead(self.statusCode, self.statusMessage, self[headersSymbol]);
  }
}

const ServerResponsePrototype = {
  constructor: ServerResponse,
  __proto__: OutgoingMessage.prototype,

  // Unused but observable fields:
  _removedConnection: false,
  _removedContLen: false,

  get headersSent() {
    return this[headerStateSymbol] === NodeHTTPHeaderState.sent;
  },
  set headersSent(value) {
    this[headerStateSymbol] = value ? NodeHTTPHeaderState.sent : NodeHTTPHeaderState.none;
  },

  // This end method is actually on the OutgoingMessage prototype in Node.js
  // But we don't want it for the fetch() response version.
  end(chunk, encoding, callback) {
    const handle = this[kHandle];
    const isFinished = this.finished || handle?.finished;

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

    if (handle) {
      const headerState = this[headerStateSymbol];
      callWriteHeadIfObservable(this, headerState);

      if (headerState !== NodeHTTPHeaderState.sent) {
        handle.cork(() => {
          handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);

          // If handle.writeHead throws, we don't want headersSent to be set to true.
          // So we set it here.
          this[headerStateSymbol] = NodeHTTPHeaderState.sent;

          // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/_http_outgoing.js#L987
          this._contentLength = handle.end(chunk, encoding);
        });
      } else {
        // If there's no data but you already called end, then you're done.
        // We can ignore it in that case.
        if (!(!chunk && handle.ended)) {
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
      this[finishedSymbol] = this.finished = true;

      this.emit("prefinish");

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
        this.emit("finish");

        process.nextTick(emitCloseNT, this);
      }
    }

    return this;
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

    let result = 0;

    const headerState = this[headerStateSymbol];
    callWriteHeadIfObservable(this, headerState);

    if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
      handle.cork(() => {
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);

        // If handle.writeHead throws, we don't want headersSent to be set to true.
        // So we set it here.
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;

        result = handle.write(chunk, encoding);
      });
    } else {
      result = handle.write(chunk, encoding);
    }

    if (result < 0) {
      handle.onwritable = callback
        ? ServerResponsePrototypeOnWritable.bind(this, callback)
        : ServerResponsePrototypeOnWritable.bind(this);
      return false;
    }

    if (result > 0) {
      if (callback) {
        process.nextTick(callback);
      }
      this.emit("drain");
    }

    return true;
  },

  _finish() {
    this.emit("prefinish");
  },

  detachSocket(socket) {
    if (socket._httpMessage === this) {
      socket.removeListener("close", onServerResponseClose);
      socket._httpMessage = null;
    }

    this.socket = null;
  },

  _implicitHeader() {
    // @ts-ignore
    this.writeHead(this.statusCode);
  },

  get writableNeedDrain() {
    return !this.destroyed && !this[finishedSymbol] && (this[kHandle]?.bufferedAmount ?? 1) !== 0;
  },

  get writableFinished() {
    const isWritableFinished = this[finishedSymbol] && (!this[kHandle] || this[kHandle].finished);
    return isWritableFinished;
  },

  get writableLength() {
    return 16 * 1024;
  },

  get writableHighWaterMark() {
    return 64 * 1024;
  },

  get closed() {
    return this[closedSymbol];
  },

  _send(data, encoding, callback, byteLength) {
    const handle = this[kHandle];
    if (!handle) {
      return OutgoingMessagePrototype._send.$apply(this, arguments);
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
      this[headerStateSymbol] = NodeHTTPHeaderState.assigned;
    }

    return this;
  },

  assignSocket(socket) {
    if (socket._httpMessage) {
      throw ERR_HTTP_SOCKET_ASSIGNED();
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
    // throw new Error('not implemented');
  },

  get chunkedEncoding() {
    return false;
  },
  set chunkedEncoding(value) {
    // throw new Error('not implemented');
  },

  get useChunkedEncodingByDefault() {
    return true;
  },
  set useChunkedEncodingByDefault(value) {
    // throw new Error('not implemented');
  },

  destroy(err?: Error) {
    if (this.destroyed) return this;
    const handle = this[kHandle];
    this.destroyed = true;
    if (handle) {
      handle.abort();
    }
    return this;
  },

  flushHeaders() {
    this._implicitHeader();

    const handle = this[kHandle];
    if (handle && !this.headersSent) {
      this[headerStateSymbol] = NodeHTTPHeaderState.sent;
      handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
    }
  },
} satisfies typeof import("node:http").ServerResponse.prototype;
ServerResponse.prototype = ServerResponsePrototype;
$setPrototypeDirect.$call(ServerResponse, Stream);

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
      emitErrorNextTickIfErrorListenerNT(this, $ERR_STREAM_WRITE_AFTER_END("Cannot write after end"), callback);
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
          if (!this[finishedSymbol]) {
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

function drainHeadersIfObservable() {
  if (this._implicitHeader === OriginalImplicitHeadFn && this.writeHead === OriginalWriteHeadFn) {
    return;
  }

  this._implicitHeader();
}

function ServerResponsePrototypeOnWritable(this: import("node:http").ServerResponse, optionalCallback) {
  if (optionalCallback) {
    optionalCallback();
  }

  if (!this.finished && !this.destroyed) {
    this.emit("drain");
  }
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
      emitErrorNextTickIfErrorListenerNT(this, $ERR_STREAM_WRITE_AFTER_END("Cannot write after end"), callback);
    }
    return false;
  }
  if (encoding && encoding !== "buffer") {
    chunk = Buffer.from(chunk, encoding);
  }
  const req = this.req;
  const shouldEmitClose = req && req.emit && !this[finishedSymbol];
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
    this[finishedSymbol] = true;
    this.headersSent = true; // https://github.com/oven-sh/bun/issues/3458
    drainHeadersIfObservable.$call(this);
    this[kDeprecatedReplySymbol](
      new Response(data, {
        headers: this[headersSymbol],
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      }),
    );
    if (shouldEmitClose) {
      req.complete = true;
      process.nextTick(emitRequestCloseNT, req);
    }
    callback && callback();
    return;
  }

  this[finishedSymbol] = true;
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

ServerResponse.prototype.writeHeader = ServerResponse.prototype.writeHead;

OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = ServerResponse.prototype._implicitHeader;

class ClientRequest extends (OutgoingMessage as unknown as typeof import("node:http").OutgoingMessage) {
  #timeout;
  #res: IncomingMessage | null = null;
  #upgradeOrConnect = false;
  #parser = null;
  #maxHeadersCount = null;
  #reusedSocket = false;
  #host;
  #protocol;
  #method;
  #port;
  #tls = null;
  #useDefaultPort;
  #joinDuplicateHeaders;
  #maxHeaderSize;
  #agent = globalAgent;
  #path;
  #socketPath;

  #bodyChunks: Buffer[] | null = null;
  #fetchRequest;
  #signal: AbortSignal | null = null;
  [kAbortController]: AbortController | null = null;
  #timeoutTimer?: Timer = undefined;
  #options;
  [finishedSymbol] = false;

  _httpMessage;

  get path() {
    return this.#path;
  }

  get port() {
    return this.#port;
  }

  get method() {
    return this.#method;
  }

  get host() {
    return this.#host;
  }

  get protocol() {
    return this.#protocol;
  }

  get agent() {
    return this.#agent;
  }

  write(chunk, encoding, callback) {
    if (this.destroyed) return false;
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

    return this.#write(chunk, encoding, callback);
  }

  #write(chunk, encoding, callback) {
    const MAX_FAKE_BACKPRESSURE_SIZE = 1024 * 1024;
    const canSkipReEncodingData =
      // UTF-8 string:
      (typeof chunk === "string" && (encoding === "utf-8" || encoding === "utf8" || !encoding)) ||
      // Buffer
      ($isTypedArrayView(chunk) && (!encoding || encoding === "buffer" || encoding === "utf-8"));
    let bodySize = 0;
    if (!canSkipReEncodingData) {
      chunk = Buffer.from(chunk, encoding);
      bodySize = chunk.length;
    } else {
      bodySize = chunk.length;
    }

    if (!this.#bodyChunks) {
      this.#bodyChunks = [chunk];

      if (callback) callback();
      return true;
    }

    // Signal fake backpressure if the body size is > 1024 * 1024
    // So that code which loops forever until backpressure is signaled
    // will eventually exit.

    for (let chunk of this.#bodyChunks) {
      bodySize += chunk.length;
      if (bodySize > MAX_FAKE_BACKPRESSURE_SIZE) {
        break;
      }
    }
    this.#bodyChunks.push(chunk);

    if (callback) callback();
    return bodySize < MAX_FAKE_BACKPRESSURE_SIZE;
  }

  end(chunk, encoding, callback) {
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

    if (chunk) {
      if (this[finishedSymbol]) {
        emitErrorNextTickIfErrorListenerNT(this, $ERR_STREAM_WRITE_AFTER_END("Cannot write after end"), callback);
        return this;
      }

      this.#write(chunk, encoding, callback);
    }

    if (callback) {
      this.once("finish", callback);
    }

    this.#send();
    return this;
  }

  destroy(err?: Error) {
    if (this.destroyed) return this;
    this.destroyed = true;

    const res = this.res;

    // If we're aborting, we don't care about any more response data.
    if (res) {
      res._dump();
    }

    this[finishedSymbol] = true;

    // If request is destroyed we abort the current response
    this[kAbortController]?.abort?.();
    this.socket.destroy(err);

    return this;
  }

  _ensureTls() {
    if (this.#tls === null) this.#tls = {};
    return this.#tls;
  }

  #socketCloseListener() {
    this.destroyed = true;

    const res = this.res;
    if (res) {
      // Socket closed before we emitted 'end' below.
      if (!res.complete) {
        res.destroy(new ConnResetException("aborted"));
      }
      if (!this._closed) {
        this._closed = true;
        this.emit("close");
      }
      if (!res.aborted && res.readable) {
        res.push(null);
      }
    } else if (!this._closed) {
      this._closed = true;
      this.emit("close");
    }
  }

  #onAbort(err?: Error) {
    this[kClearTimeout]?.();
    this.#socketCloseListener();
  }

  #send() {
    this[finishedSymbol] = true;
    const controller = new AbortController();
    this[kAbortController] = controller;
    controller.signal.addEventListener("abort", this.#onAbort.bind(this), { once: true });

    var method = this.#method,
      body = this.#bodyChunks && this.#bodyChunks.length > 1 ? new Blob(this.#bodyChunks) : this.#bodyChunks?.[0];
    if (body) {
      this.#bodyChunks = [];
    }

    let url: string;
    let proxy: string | undefined;
    const protocol = this.#protocol;
    const path = this.#path;
    if (path.startsWith("http://") || path.startsWith("https://")) {
      url = path;
      proxy = `${protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}`;
    } else {
      url = `${protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${path}`;
      // support agent proxy url/string for http/https
      try {
        // getters can throw
        const agentProxy = this.#agent?.proxy;
        // this should work for URL like objects and strings
        proxy = agentProxy?.href || agentProxy;
      } catch {}
    }

    let keepalive = true;
    const agentKeepalive = this.#agent?.keepalive;
    if (agentKeepalive !== undefined) {
      keepalive = agentKeepalive;
    }
    const tls = protocol === "https:" && this.#tls ? { ...this.#tls, serverName: this.#tls.servername } : undefined;
    try {
      const fetchOptions: any = {
        method,
        headers: this.getHeaders(),
        redirect: "manual",
        signal: this[kAbortController].signal,
        // Timeouts are handled via this.setTimeout.
        timeout: false,
        // Disable auto gzip/deflate
        decompress: false,
        keepalive,
      };

      if (body && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        fetchOptions.body = body;
      }

      if (tls) {
        fetchOptions.tls = tls;
      }

      if (!!$debug) {
        fetchOptions.verbose = true;
      }

      if (proxy) {
        fetchOptions.proxy = proxy;
      }

      const socketPath = this.#socketPath;

      if (socketPath) {
        fetchOptions.unix = socketPath;
      }

      //@ts-ignore
      this.#fetchRequest = fetch(url, fetchOptions)
        .then(response => {
          if (this.aborted) {
            this.#maybeEmitClose();
            return;
          }

          const prevIsHTTPS = isNextIncomingMessageHTTPS;
          isNextIncomingMessageHTTPS = response.url.startsWith("https:");
          var res = (this.res = new IncomingMessage(response, {
            [typeSymbol]: NodeHTTPIncomingRequestType.FetchResponse,
            [reqSymbol]: this,
          }));
          isNextIncomingMessageHTTPS = prevIsHTTPS;
          res.req = this;
          process.nextTick(
            (self, res) => {
              // If the user did not listen for the 'response' event, then they
              // can't possibly read the data, so we ._dump() it into the void
              // so that the socket doesn't hang there in a paused state.
              if (self.aborted || !self.emit("response", res)) {
                res._dump();
              }
            },
            this,
            res,
          );
          this.#maybeEmitClose();
          if (res.statusCode === 304) {
            res.complete = true;
            this.#maybeEmitClose();
            return;
          }
        })
        .catch(err => {
          // Node treats AbortError separately.
          // The "abort" listener on the abort controller should have called this
          if (isAbortError(err)) {
            return;
          }

          if (!!$debug) globalReportError(err);

          this.emit("error", err);
        })
        .finally(() => {
          this.#fetchRequest = null;
          this[kClearTimeout]();
        });
    } catch (err) {
      if (!!$debug) globalReportError(err);
      this.emit("error", err);
    } finally {
      process.nextTick(this.#maybeEmitFinish.bind(this));
    }
  }

  // --- For faking the events in the right order ---
  #maybeEmitSocket() {
    if (!(this[kEmitState] & (1 << ClientRequestEmitState.socket))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.socket;
      this.emit("socket", this.socket);
    }
  }

  #maybeEmitPrefinish() {
    this.#maybeEmitSocket();

    if (!(this[kEmitState] & (1 << ClientRequestEmitState.prefinish))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.prefinish;
      this.emit("prefinish");
    }
  }

  #maybeEmitFinish() {
    this.#maybeEmitPrefinish();

    if (!(this[kEmitState] & (1 << ClientRequestEmitState.finish))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.finish;
      this.emit("finish");
    }
  }

  #maybeEmitClose() {
    this.#maybeEmitPrefinish();

    if (!this._closed) {
      process.nextTick(emitCloseNTAndComplete, this);
    }
  }

  get aborted() {
    return this[abortedSymbol] || this.#signal?.aborted || !!this[kAbortController]?.signal?.aborted;
  }

  set aborted(value) {
    this[abortedSymbol] = value;
  }

  abort() {
    if (this.aborted) return;
    this[abortedSymbol] = true;
    process.nextTick(emitAbortNextTick, this);
    this[kAbortController]?.abort?.();
    this.destroy();
  }

  constructor(input, options, cb) {
    super();
    if (typeof input === "string") {
      const urlStr = input;
      try {
        var urlObject = new URL(urlStr);
      } catch (e) {
        throw new TypeError(`Invalid URL: ${urlStr}`);
      }
      input = urlToHttpOptions(urlObject);
    } else if (input && typeof input === "object" && input instanceof URL) {
      // url.URL instance
      input = urlToHttpOptions(input);
    } else {
      cb = options;
      options = input;
      input = null;
    }

    if (typeof options === "function") {
      cb = options;
      options = input || kEmptyObject;
    } else {
      options = ObjectAssign(input || {}, options);
    }

    let agent = options.agent;
    const defaultAgent = options._defaultAgent || Agent.globalAgent;
    if (agent === false) {
      agent = new defaultAgent.constructor();
    } else if (agent == null) {
      agent = defaultAgent;
    } else if (typeof agent.addRequest !== "function") {
      throw ERR_INVALID_ARG_TYPE("options.agent", "Agent-like Object, undefined, or false", agent);
    }
    this.#agent = agent;
    this.destroyed = false;

    const protocol = options.protocol || defaultAgent.protocol;
    let expectedProtocol = defaultAgent.protocol;
    if (this.agent.protocol) {
      expectedProtocol = this.agent.protocol;
    }
    if (protocol !== expectedProtocol) {
      throw ERR_INVALID_PROTOCOL(protocol, expectedProtocol);
    }
    this.#protocol = protocol;

    if (options.path) {
      const path = String(options.path);
      if (RegExpPrototypeExec.$call(INVALID_PATH_REGEX, path) !== null) {
        $debug('Path contains unescaped characters: "%s"', path);
        throw new Error("Path contains unescaped characters");
        // throw new ERR_UNESCAPED_CHARACTERS("Request path");
      }
    }

    const defaultPort = options.defaultPort || this.#agent.defaultPort;
    this.#port = options.port || defaultPort || 80;
    this.#useDefaultPort = this.#port === defaultPort;
    const host =
      (this.#host =
      options.host =
        validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost");

    // const setHost = options.setHost === undefined || Boolean(options.setHost);

    this.#socketPath = options.socketPath;

    const signal = options.signal;
    if (signal) {
      //We still want to control abort function and timeout so signal call our AbortController
      signal.addEventListener(
        "abort",
        () => {
          this[kAbortController]?.abort?.();
        },
        { once: true },
      );
      this.#signal = signal;
    }
    let method = options.method;
    const methodIsString = typeof method === "string";
    if (method !== null && method !== undefined && !methodIsString) {
      // throw ERR_INVALID_ARG_TYPE("options.method", "string", method);
      throw new Error("ERR_INVALID_ARG_TYPE: options.method");
    }

    if (methodIsString && method) {
      if (!checkIsHttpToken(method)) {
        throw $ERR_INVALID_HTTP_TOKEN("Method");
      }
      method = this.#method = StringPrototypeToUpperCase.$call(method);
    } else {
      method = this.#method = "GET";
    }

    const _maxHeaderSize = options.maxHeaderSize;
    // TODO: Validators
    // if (maxHeaderSize !== undefined)
    //   validateInteger(maxHeaderSize, "maxHeaderSize", 0);
    this.#maxHeaderSize = _maxHeaderSize;

    // const insecureHTTPParser = options.insecureHTTPParser;
    // if (insecureHTTPParser !== undefined) {
    //   validateBoolean(insecureHTTPParser, 'options.insecureHTTPParser');
    // }

    // this.insecureHTTPParser = insecureHTTPParser;
    var _joinDuplicateHeaders = options.joinDuplicateHeaders;
    if (_joinDuplicateHeaders !== undefined) {
      // TODO: Validators
      // validateBoolean(
      //   options.joinDuplicateHeaders,
      //   "options.joinDuplicateHeaders",
      // );
    }

    this.#joinDuplicateHeaders = _joinDuplicateHeaders;
    if (options.pfx) {
      throw new Error("pfx is not supported");
    }

    if (options.rejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = options.rejectUnauthorized;
    else {
      let agentRejectUnauthorized = agent?.options?.rejectUnauthorized;
      if (agentRejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = agentRejectUnauthorized;
      else {
        // popular https-proxy-agent uses connectOpts
        agentRejectUnauthorized = agent?.connectOpts?.rejectUnauthorized;
        if (agentRejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = agentRejectUnauthorized;
      }
    }
    if (options.ca) {
      if (!isValidTLSArray(options.ca))
        throw new TypeError(
          "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      this._ensureTls().ca = options.ca;
    }
    if (options.cert) {
      if (!isValidTLSArray(options.cert))
        throw new TypeError(
          "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      this._ensureTls().cert = options.cert;
    }
    if (options.key) {
      if (!isValidTLSArray(options.key))
        throw new TypeError(
          "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      this._ensureTls().key = options.key;
    }
    if (options.passphrase) {
      if (typeof options.passphrase !== "string") throw new TypeError("passphrase argument must be a string");
      this._ensureTls().passphrase = options.passphrase;
    }
    if (options.ciphers) {
      if (typeof options.ciphers !== "string") throw new TypeError("ciphers argument must be a string");
      this._ensureTls().ciphers = options.ciphers;
    }
    if (options.servername) {
      if (typeof options.servername !== "string") throw new TypeError("servername argument must be a string");
      this._ensureTls().servername = options.servername;
    }

    if (options.secureOptions) {
      if (typeof options.secureOptions !== "number") throw new TypeError("secureOptions argument must be a string");
      this._ensureTls().secureOptions = options.secureOptions;
    }
    this.#path = options.path || "/";
    if (cb) {
      this.once("response", cb);
    }

    $debug(`new ClientRequest: ${this.#method} ${this.#protocol}//${this.#host}:${this.#port}${this.#path}`);

    // if (
    //   method === "GET" ||
    //   method === "HEAD" ||
    //   method === "DELETE" ||
    //   method === "OPTIONS" ||
    //   method === "TRACE" ||
    //   method === "CONNECT"
    // ) {
    //   this.useChunkedEncodingByDefault = false;
    // } else {
    //   this.useChunkedEncodingByDefault = true;
    // }

    this[finishedSymbol] = false;
    this.#res = null;
    this.#upgradeOrConnect = false;
    this.#parser = null;
    this.#maxHeadersCount = null;
    this.#reusedSocket = false;
    this.#host = host;
    this.#protocol = protocol;

    const timeout = options.timeout;
    if (timeout !== undefined && timeout !== 0) {
      this.setTimeout(timeout, undefined);
    }

    const { headers } = options;
    const headersArray = $isJSArray(headers);
    if (!headersArray) {
      if (headers) {
        for (let key in headers) {
          this.setHeader(key, headers[key]);
        }
      }

      // if (host && !this.getHeader("host") && setHost) {
      //   let hostHeader = host;

      //   // For the Host header, ensure that IPv6 addresses are enclosed
      //   // in square brackets, as defined by URI formatting
      //   // https://tools.ietf.org/html/rfc3986#section-3.2.2
      //   const posColon = StringPrototypeIndexOf.$call(hostHeader, ":");
      //   if (
      //     posColon !== -1 &&
      //     StringPrototypeIncludes(hostHeader, ":", posColon + 1) &&
      //     StringPrototypeCharCodeAt(hostHeader, 0) !== 91 /* '[' */
      //   ) {
      //     hostHeader = `[${hostHeader}]`;
      //   }

      //   if (port && +port !== defaultPort) {
      //     hostHeader += ":" + port;
      //   }
      //   this.setHeader("Host", hostHeader);
      // }

      var auth = options.auth;
      if (auth && !this.getHeader("Authorization")) {
        this.setHeader("Authorization", "Basic " + Buffer.from(auth).toString("base64"));
      }

      //   if (this.getHeader("expect")) {
      //     if (this._header) {
      //       throw new ERR_HTTP_HEADERS_SENT("render");
      //     }

      //     this._storeHeader(
      //       this.method + " " + this.path + " HTTP/1.1\r\n",
      //       this[kOutHeaders],
      //     );
      //   }
      // } else {
      //   this._storeHeader(
      //     this.method + " " + this.path + " HTTP/1.1\r\n",
      //     options.headers,
      //   );
    }

    // this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

    const { signal: _signal, ...optsWithoutSignal } = options;
    this.#options = optsWithoutSignal;

    this._httpMessage = this;

    process.nextTick(emitContinueAndSocketNT, this);
  }

  [kEmitState]: number = 0;

  setSocketKeepAlive(enable = true, initialDelay = 0) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  }

  setNoDelay(noDelay = true) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setNoDelay is a no-op");
  }

  [kClearTimeout]() {
    const timeoutTimer = this.#timeoutTimer;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      this.#timeoutTimer = undefined;
      this.removeAllListeners("timeout");
    }
  }

  #onTimeout() {
    this.#timeoutTimer = undefined;
    this[kAbortController]?.abort?.();
    this.emit("timeout");
  }

  setTimeout(msecs, callback) {
    if (this.destroyed) return this;

    this.timeout = msecs = validateMsecs(msecs, "msecs");

    // Attempt to clear an existing timer in both cases -
    //  even if it will be rescheduled we don't want to leak an existing timer.
    clearTimeout(this.#timeoutTimer!);

    if (msecs === 0) {
      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }

      this.#timeoutTimer = undefined;
    } else {
      this.#timeoutTimer = setTimeout(this.#onTimeout.bind(this), msecs).unref();

      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }

    return this;
  }
}

function validateHost(host, name) {
  if (host !== null && host !== undefined && typeof host !== "string") {
    // throw ERR_INVALID_ARG_TYPE(
    //   `options.${name}`,
    //   ["string", "undefined", "null"],
    //   host,
    // );
    throw new Error("Invalid arg type in options");
  }
  return host;
}

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

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

function _normalizeArgs(args) {
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    // arr[normalizedArgsSymbol] = true;
    return arr;
  }

  const arg0 = args[0];
  let options: any = {};
  if (typeof arg0 === "object" && arg0 !== null) {
    // (options[...][, cb])
    options = arg0;
    // } else if (isPipeName(arg0)) {
    // (path[...][, cb])
    // options.path = arg0;
  } else {
    // ([port][, host][...][, cb])
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === "string") {
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== "function") arr = [options, null];
  else arr = [options, cb];

  // arr[normalizedArgsSymbol] = true;
  return arr;
}

function _writeHead(statusCode, reason, obj, response) {
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(`Invalid status code: ${statusCode}`);
  }

  if (typeof reason === "string") {
    // writeHead(statusCode, reasonPhrase[, headers])
    response.statusMessage = reason;
  } else {
    // writeHead(statusCode[, headers])
    if (!response.statusMessage) response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj ??= reason;
  }
  response.statusCode = statusCode;

  {
    // Slow-case: when progressive API and header fields are passed.
    let k;
    if (Array.isArray(obj)) {
      if (obj.length % 2 !== 0) {
        throw new Error("raw headers must have an even number of elements");
      }

      for (let n = 0; n < obj.length; n += 2) {
        k = obj[n + 0];
        if (k) response.setHeader(k, obj[n + 1]);
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; i++) {
        k = keys[i];
        if (k) response.setHeader(k, obj[k]);
      }
    }
  }

  if (statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode <= 199)) {
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
    response._hasBody = false;
  }
}

function ServerResponse_writevDeprecated(chunks, callback) {
  if (chunks.length === 1 && !this.headersSent && this[firstWriteSymbol] === undefined) {
    this[firstWriteSymbol] = chunks[0].chunk;
    callback();
    return;
  }

  ensureReadableStreamController.$call(this, controller => {
    for (const chunk of chunks) {
      controller.write(chunk.chunk);
    }

    callback();
  });
}

/**
 * Makes an HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

function emitCloseServer(self: Server) {
  self.emit("close");
}
function emitCloseNTServer(this: Server) {
  process.nextTick(emitCloseServer, this);
}

/**
 * Makes a `GET` HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

function onError(self, error, cb) {
  if ($isCallable(cb)) {
    cb(error);
  }
}

function emitErrorNt(msg, err, callback) {
  if ($isCallable(callback)) {
    callback(err);
  }
  if ($isCallable(msg.emit) && !msg._closed) {
    msg.emit("error", err);
  }
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

function emitAbortNextTick(self) {
  self.emit("abort");
}

const setMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "getMaxHTTPHeaderSize", 0);

var globalAgent = new Agent();
const http_exports = {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  get maxHeaderSize() {
    return getMaxHTTPHeaderSize();
  },
  set maxHeaderSize(value) {
    setMaxHTTPHeaderSize(value);
  },
  validateHeaderName,
  validateHeaderValue,
  setMaxIdleHTTPParsers(max) {
    $debug(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  globalAgent,
  ClientRequest,
  OutgoingMessage,
};

export default http_exports;
