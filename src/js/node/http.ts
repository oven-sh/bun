// Hardcoded module "node:http"
const EventEmitter = require("node:events");
const { isTypedArray } = require("node:util/types");
const { Duplex, Readable, Writable, ERR_STREAM_WRITE_AFTER_END, ERR_STREAM_ALREADY_FINISHED } = require("node:stream");

const {
  getHeader,
  setHeader,
  assignHeaders: assignHeadersFast,
} = $cpp("NodeHTTP.cpp", "createNodeHTTPInternalBinding");

const ObjectDefineProperty = Object.defineProperty;
const ObjectSetPrototypeOf = Object.setPrototypeOf;

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
    // throw new ERR_INVALID_HTTP_TOKEN(label || "Header name", name);
    throw new Error("ERR_INVALID_HTTP_TOKEN");
  }
};

const validateHeaderValue = (name, value) => {
  if (value === undefined) {
    // throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
    throw new Error("ERR_HTTP_INVALID_HEADER_VALUE");
  }
  if (checkInvalidHeaderChar(value)) {
    // throw new ERR_INVALID_CHAR("header content", name);
    throw new Error("ERR_INVALID_CHAR");
  }
};

function ERR_HTTP_SOCKET_ASSIGNED() {
  return new Error(`ServerResponse has an already assigned socket`);
}

// Cheaper to duplicate this than to import it from node:net
function isIPv6(input) {
  const v4Seg = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
  const v4Str = `(${v4Seg}[.]){3}${v4Seg}`;
  const v6Seg = "(?:[0-9a-fA-F]{1,4})";
  const IPv6Reg = new RegExp(
    "^(" +
      `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
      `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
      `(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|` +
      `(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|` +
      `(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|` +
      `(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|` +
      `(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|` +
      `(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
      ")(%[0-9a-zA-Z-.:]{1,})?$",
  );

  return IPv6Reg.test(input);
}

// TODO: add primordial for URL
// Importing from node:url is unnecessary
const { URL } = globalThis;

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const fetch = Bun.fetch;
const nop = () => {};

const kEmptyObject = Object.freeze(Object.create(null));
const kOutHeaders = Symbol.for("kOutHeaders");
const kEndCalled = Symbol.for("kEndCalled");
const kAbortController = Symbol.for("kAbortController");
const kClearTimeout = Symbol("kClearTimeout");

const kCorked = Symbol.for("kCorked");
const searchParamsSymbol = Symbol.for("query"); // This is the symbol used in Node

// Primordials
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

var _defaultHTTPSAgent;
var kInternalRequest = Symbol("kInternalRequest");
const kInternalSocketData = Symbol.for("::bunternal::");
const kfakeSocket = Symbol("kfakeSocket");

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

class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name, expected, actual) {
    super(`The ${name} argument must be of type ${expected}. Received type ${typeof actual}`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}

function validateMsecs(numberlike: any, field: string) {
  if (typeof numberlike !== "number" || numberlike < 0) {
    throw new ERR_INVALID_ARG_TYPE(field, "number", numberlike);
  }

  return numberlike;
}
function validateFunction(callable: any, field: string) {
  if (typeof callable !== "function") {
    throw new ERR_INVALID_ARG_TYPE(field, "Function", callable);
  }

  return callable;
}

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]!: [import("bun").Server, typeof OutgoingMessage, typeof Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address;
  address() {
    // Call server.requestIP() without doing any propety getter twice.
    var internalData;
    return (this.#address ??= (internalData = this[kInternalSocketData])?.[0]?.requestIP(internalData[2]) ?? {});
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(port, host, connectListener) {
    return this;
  }

  _destroy(err, callback) {}

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
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, encoding, callback) {}
};

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
  this.requests = kEmptyObject;
  this.sockets = kEmptyObject;
  this.freeSockets = kEmptyObject;

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
Agent.prototype = {};
ObjectSetPrototypeOf(Agent.prototype, EventEmitter.prototype);

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

function emitListeningNextTick(self, onListen, err, hostname, port) {
  if (typeof onListen === "function") {
    try {
      onListen.$apply(self, [err, hostname, port]);
    } catch (err) {
      self.emit("error", err);
    }
  }

  self.listening = !err;

  if (err) {
    self.emit("error", err);
  } else {
    self.emit("listening", hostname, port);
  }
}

var tlsSymbol = Symbol("tls");
var isTlsSymbol = Symbol("is_tls");
var optionsSymbol = Symbol("options");
var serverSymbol = Symbol("server");
function Server(options, callback) {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);

  this.listening = false;
  this._unref = false;
  this[serverSymbol] = undefined;

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
}
Object.setPrototypeOf((Server.prototype = {}), EventEmitter.prototype);
Server.prototype.constructor = Server; // Re-add constructor which got lost when setting prototype
Object.setPrototypeOf(Server, EventEmitter);

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
  server.stop(true);
  this.emit("close");
};

Server.prototype.closeIdleConnections = function () {
  // not actually implemented
};

Server.prototype.close = function (optionalCallback?) {
  const server = this[serverSymbol];
  if (!server) {
    if (typeof optionalCallback === "function") process.nextTick(optionalCallback, new Error("Server is not running"));
    return;
  }
  this[serverSymbol] = undefined;
  if (typeof optionalCallback === "function") this.once("close", optionalCallback);
  server.stop();
  this.emit("close");
};

Server.prototype[Symbol.asyncDispose] = function () {
  const { resolve, reject, promise } = Promise.withResolvers();
  this.close(function (err, ...args) {
    if (err) reject(err);
    else resolve(...args);
  });
  return promise;
};

Server.prototype.address = function () {
  if (!this[serverSymbol]) return null;
  return this[serverSymbol].address;
};

Server.prototype.listen = function (port, host, backlog, onListen) {
  const server = this;
  let socketPath;
  if (typeof port == "string" && !Number.isSafeInteger(Number(port))) {
    socketPath = port;
  }
  if (typeof host === "function") {
    onListen = host;
    host = undefined;
  }

  if (typeof port === "function") {
    onListen = port;
  } else if (typeof port === "object") {
    port?.signal?.addEventListener("abort", () => {
      this.close();
    });

    host = port?.host;
    port = port?.port;

    if (typeof port?.callback === "function") onListen = port?.callback;
  }

  if (typeof backlog === "function") {
    onListen = backlog;
  }

  const ResponseClass = this[optionsSymbol].ServerResponse || ServerResponse;
  const RequestClass = this[optionsSymbol].IncomingMessage || IncomingMessage;
  let isHTTPS = false;

  try {
    const tls = this[tlsSymbol];
    if (tls) {
      this.serverName = tls.serverName || host || "localhost";
    }
    this[serverSymbol] = Bun.serve<any>({
      tls,
      port,
      hostname: host,
      unix: socketPath,
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
      // Be very careful not to access (web) Request object
      // properties:
      // - request.url
      // - request.headers
      //
      // We want to avoid triggering the getter for these properties because
      // that will cause the data to be cloned twice, which costs memory & performance.
      fetch(req, _server) {
        var pendingResponse;
        var pendingError;
        var reject = err => {
          if (pendingError) return;
          pendingError = err;
          if (rejectFunction) rejectFunction(err);
        };

        var reply = function (resp) {
          if (pendingResponse) return;
          pendingResponse = resp;
          if (resolveFunction) resolveFunction(resp);
        };

        const prevIsNextIncomingMessageHTTPS = isNextIncomingMessageHTTPS;
        isNextIncomingMessageHTTPS = isHTTPS;
        const http_req = new RequestClass(req);
        isNextIncomingMessageHTTPS = prevIsNextIncomingMessageHTTPS;

        const upgrade = http_req.headers.upgrade;

        const http_res = new ResponseClass(http_req, reply);

        http_req.socket[kInternalSocketData] = [_server, http_res, req];
        server.emit("connection", http_req.socket);

        const rejectFn = err => reject(err);
        http_req.once("error", rejectFn);
        http_res.once("error", rejectFn);

        if (upgrade) {
          server.emit("upgrade", http_req, http_req.socket, kEmptyBuffer);
        } else {
          server.emit("request", http_req, http_res);
        }

        if (pendingError) {
          throw pendingError;
        }

        if (pendingResponse) {
          return pendingResponse;
        }

        var { promise, resolve: resolveFunction, reject: rejectFunction } = $newPromiseCapability(GlobalPromise);
        return promise;
      },
    });
    isHTTPS = this[serverSymbol].protocol === "https";

    if (this?._unref) {
      this[serverSymbol]?.unref?.();
    }

    setTimeout(emitListeningNextTick, 1, this, onListen, null, this[serverSymbol].hostname, this[serverSymbol].port);
  } catch (err) {
    server.emit("error", err);
  }

  return this;
};

Server.prototype.setTimeout = function (msecs, callback) {
  // TODO:
  return this;
};

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
  const tuple = assignHeadersFast(req, object);
  if (tuple !== null) {
    object.headers = $getInternalField(tuple, 0);
    object.rawHeaders = $getInternalField(tuple, 1);
    return true;
  } else {
    assignHeadersSlow(object, req);
    return false;
  }
}

var defaultIncomingOpts = { type: "request" };

function getDefaultHTTPSAgent() {
  return (_defaultHTTPSAgent ??= new Agent({ defaultPort: 443, protocol: "https:" }));
}

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

var typeSymbol = Symbol("type");
var reqSymbol = Symbol("req");
var bodyStreamSymbol = Symbol("bodyStream");
var noBodySymbol = Symbol("noBody");
var abortedSymbol = Symbol("aborted");
function IncomingMessage(req, defaultIncomingOpts) {
  this.method = null;
  this._consuming = false;
  this._dumped = false;
  this[noBodySymbol] = false;
  this[abortedSymbol] = false;
  Readable.$call(this);
  var { type = "request", [kInternalRequest]: nodeReq } = defaultIncomingOpts || {};

  this[reqSymbol] = req;
  this[typeSymbol] = type;

  this[bodyStreamSymbol] = undefined;

  this.req = nodeReq;

  if (!assignHeaders(this, req)) {
    this[fakeSocketSymbol] = req;
    const reqUrl = String(req?.url || "");
    this.url = reqUrl;
  }

  if (isNextIncomingMessageHTTPS) {
    // Creating a new Duplex is expensive.
    // We can skip it if the request is not HTTPS.
    const socket = new FakeSocket();
    this[fakeSocketSymbol] = socket;
    socket.encrypted = true;
    isNextIncomingMessageHTTPS = false;
  }

  this[noBodySymbol] =
    type === "request" // TODO: Add logic for checking for body on response
      ? requestHasNoBody(this.method, this)
      : false;

  this.complete = !!this[noBodySymbol];
}

Object.setPrototypeOf((IncomingMessage.prototype = {}), Readable.prototype);
IncomingMessage.prototype.constructor = IncomingMessage; // Re-add constructor which got lost when setting prototype
Object.setPrototypeOf(IncomingMessage, Readable);

IncomingMessage.prototype._construct = function (callback) {
  // TODO: streaming
  if (this[typeSymbol] === "response" || this[noBodySymbol]) {
    callback();
    return;
  }

  const contentLength = this.headers["content-length"];
  const length = contentLength ? parseInt(contentLength, 10) : 0;
  if (length === 0) {
    this[noBodySymbol] = true;
    callback();
    return;
  }

  callback();
};

async function consumeStream(self, reader: ReadableStreamDefaultReader) {
  while (true) {
    var { done, value } = await reader.readMany();
    if (self[abortedSymbol]) return;
    if (done) {
      self.complete = true;
      self.push(null);
      break;
    }
    for (var v of value) {
      self.push(v);
    }
  }
}

IncomingMessage.prototype._read = function (size) {
  if (this[noBodySymbol]) {
    this.complete = true;
    this.push(null);
  } else if (this[bodyStreamSymbol] == null) {
    const reader = this[reqSymbol].body?.getReader() as ReadableStreamDefaultReader;
    if (!reader) {
      this.complete = true;
      this.push(null);
      return;
    }
    this[bodyStreamSymbol] = reader;
    consumeStream(this, reader);
  }
};

Object.defineProperty(IncomingMessage.prototype, "aborted", {
  get() {
    return this[abortedSymbol];
  },
});

Object.defineProperty(IncomingMessage.prototype, "connection", {
  get() {
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
});

Object.defineProperty(IncomingMessage.prototype, "statusCode", {
  get() {
    return this[reqSymbol].status;
  },
  set(v) {
    if (!(v in STATUS_CODES)) return;
    this[reqSymbol].status = v;
  },
});

Object.defineProperty(IncomingMessage.prototype, "statusMessage", {
  get() {
    return STATUS_CODES[this[reqSymbol].status];
  },
  set(v) {
    //noop
  },
});

Object.defineProperty(IncomingMessage.prototype, "httpVersion", {
  get() {
    return "1.1";
  },
});

Object.defineProperty(IncomingMessage.prototype, "rawTrailers", {
  get() {
    return [];
  },
});

Object.defineProperty(IncomingMessage.prototype, "httpVersionMajor", {
  get() {
    return 1;
  },
});

Object.defineProperty(IncomingMessage.prototype, "httpVersionMinor", {
  get() {
    return 1;
  },
});

Object.defineProperty(IncomingMessage.prototype, "trailers", {
  get() {
    return kEmptyObject;
  },
});

Object.defineProperty(IncomingMessage.prototype, "socket", {
  get() {
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  set(val) {
    this[fakeSocketSymbol] = val;
  },
});

IncomingMessage.prototype.setTimeout = function (msecs, callback) {
  // TODO:
  return this;
};

const headersSymbol = Symbol("headers");
const finishedSymbol = Symbol("finished");
const timeoutTimerSymbol = Symbol("timeoutTimer");
const fakeSocketSymbol = Symbol("fakeSocket");
function OutgoingMessage(options) {
  Writable.$call(this, options);
  this.headersSent = false;
  this.sendDate = true;
  this[finishedSymbol] = false;
  this[kEndCalled] = false;
  this[kAbortController] = null;
}

Object.setPrototypeOf((OutgoingMessage.prototype = {}), Writable.prototype);
OutgoingMessage.prototype.constructor = OutgoingMessage; // Re-add constructor which got lost when setting prototype
Object.setPrototypeOf(OutgoingMessage, Writable);

// Express "compress" package uses this
OutgoingMessage.prototype._implicitHeader = function () {};

OutgoingMessage.prototype.appendHeader = function (name, value) {
  var headers = (this[headersSymbol] ??= new Headers());
  headers.append(name, value);
};

OutgoingMessage.prototype.flushHeaders = function () {};

OutgoingMessage.prototype.getHeader = function (name) {
  return getHeader(this[headersSymbol], name);
};

OutgoingMessage.prototype.getHeaders = function () {
  if (!this[headersSymbol]) return kEmptyObject;
  return this[headersSymbol].toJSON();
};

OutgoingMessage.prototype.getHeaderNames = function () {
  var headers = this[headersSymbol];
  if (!headers) return [];
  return Array.from(headers.keys());
};

OutgoingMessage.prototype.removeHeader = function (name) {
  if (!this[headersSymbol]) return;
  this[headersSymbol].delete(name);
};

OutgoingMessage.prototype.setHeader = function (name, value) {
  this[headersSymbol] = this[headersSymbol] ?? new Headers();
  var headers = this[headersSymbol];
  headers.set(name, value);
  return this;
};

OutgoingMessage.prototype.hasHeader = function (name) {
  if (!this[headersSymbol]) return false;
  return this[headersSymbol].has(name);
};

OutgoingMessage.prototype.addTrailers = function (headers) {
  throw new Error("not implemented");
};

function onTimeout() {
  this[timeoutTimerSymbol] = undefined;
  this[kAbortController]?.abort();
  this.emit("timeout");
}

OutgoingMessage.prototype.setTimeout = function (msecs, callback) {
  if (this.destroyed) return this;

  this.timeout = msecs = validateMsecs(msecs, "msecs");

  // Attempt to clear an existing timer in both cases -
  //  even if it will be rescheduled we don't want to leak an existing timer.
  clearTimeout(this[timeoutTimerSymbol]);

  if (msecs === 0) {
    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.removeListener("timeout", callback);
    }

    this[timeoutTimerSymbol] = undefined;
  } else {
    this[timeoutTimerSymbol] = setTimeout(onTimeout.bind(this), msecs).unref();

    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.once("timeout", callback);
    }
  }

  return this;
};

Object.defineProperty(OutgoingMessage.prototype, "headers", {
  // For compat with IncomingRequest
  get: function () {
    if (!this[headersSymbol]) return kEmptyObject;
    return this[headersSymbol].toJSON();
  },
});

Object.defineProperty(OutgoingMessage.prototype, "chunkedEncoding", {
  get: function () {
    return false;
  },

  set: function (value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(OutgoingMessage.prototype, "shouldKeepAlive", {
  get: function () {
    return true;
  },

  set: function (value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(OutgoingMessage.prototype, "useChunkedEncodingByDefault", {
  get: function () {
    return true;
  },

  set: function (value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(OutgoingMessage.prototype, "socket", {
  get: function () {
    this[fakeSocketSymbol] = this[fakeSocketSymbol] ?? new FakeSocket();
    return this[fakeSocketSymbol];
  },

  set: function (val) {
    this[fakeSocketSymbol] = val;
  },
});

Object.defineProperty(OutgoingMessage.prototype, "connection", {
  get: function () {
    return this.socket;
  },
});

Object.defineProperty(OutgoingMessage.prototype, "finished", {
  get: function () {
    return this[finishedSymbol];
  },
});

function emitCloseNT(self) {
  if (!self._closed) {
    self._closed = true;
    self.emit("close");
  }
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
  if (this._httpMessage) {
    emitCloseNT(this._httpMessage);
  }
}

let OriginalWriteHeadFn, OriginalImplicitHeadFn;
const controllerSymbol = Symbol("controller");
const firstWriteSymbol = Symbol("firstWrite");
const deferredSymbol = Symbol("deferred");
function ServerResponse(req, reply) {
  OutgoingMessage.$call(this, reply);
  this.req = req;
  this._reply = reply;
  this.sendDate = true;
  this.statusCode = 200;
  this.headersSent = false;
  this.statusMessage = undefined;
  this[controllerSymbol] = undefined;
  this[firstWriteSymbol] = undefined;
  this._writableState.decodeStrings = false;
  this[deferredSymbol] = undefined;

  this._sent100 = false;
  this._defaultKeepAlive = false;
  this._removedConnection = false;
  this._removedContLen = false;
  this._hasBody = true;
  this[finishedSymbol] = false;

  // this is matching node's behaviour
  // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
  if (req.method === "HEAD") this._hasBody = false;
}
Object.setPrototypeOf((ServerResponse.prototype = {}), OutgoingMessage.prototype);
ServerResponse.prototype.constructor = ServerResponse; // Re-add constructor which got lost when setting prototype
Object.setPrototypeOf(ServerResponse, OutgoingMessage);

// Express "compress" package uses this
ServerResponse.prototype._implicitHeader = function () {
  // @ts-ignore
  this.writeHead(this.statusCode);
};

ServerResponse.prototype._write = function (chunk, encoding, callback) {
  if (this[firstWriteSymbol] === undefined && !this.headersSent) {
    this[firstWriteSymbol] = chunk;
    callback();
    return;
  }

  ensureReadableStreamController.$call(this, controller => {
    controller.write(chunk);
    callback();
  });
};

ServerResponse.prototype._writev = function (chunks, callback) {
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
};

function ensureReadableStreamController(run) {
  const thisController = this[controllerSymbol];
  if (thisController) return run(thisController);
  this.headersSent = true;
  let firstWrite = this[firstWriteSymbol];
  this[controllerSymbol] = undefined;
  this._reply(
    new Response(
      new ReadableStream({
        type: "direct",
        pull: controller => {
          this[controllerSymbol] = controller;
          if (firstWrite) controller.write(firstWrite);
          firstWrite = undefined;
          run(controller);
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

ServerResponse.prototype._final = function (callback) {
  if (!this.headersSent) {
    var data = this[firstWriteSymbol] || "";
    this[firstWriteSymbol] = undefined;
    this[finishedSymbol] = true;
    drainHeadersIfObservable.$call(this);
    this._reply(
      new Response(data, {
        headers: this[headersSymbol],
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      }),
    );
    callback && callback();
    return;
  }

  this[finishedSymbol] = true;
  ensureReadableStreamController.$call(this, controller => {
    controller.end();

    callback();
    const deferred = this[deferredSymbol];
    if (deferred) {
      this[deferredSymbol] = undefined;
      deferred();
    }
  });
};

ServerResponse.prototype.writeProcessing = function () {
  throw new Error("not implemented");
};

ServerResponse.prototype.addTrailers = function (headers) {
  throw new Error("not implemented");
};

ServerResponse.prototype.assignSocket = function (socket) {
  if (socket._httpMessage) {
    throw ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = this;
  socket.on("close", () => onServerResponseClose.$call(socket));
  this.socket = socket;
  this._writableState.autoDestroy = false;
  this.emit("socket", socket);
};

ServerResponse.prototype.detachSocket = function (socket) {
  throw new Error("not implemented");
};

ServerResponse.prototype.writeContinue = function (callback) {
  throw new Error("not implemented");
};

ServerResponse.prototype.setTimeout = function (msecs, callback) {
  // TODO:
  return this;
};

ServerResponse.prototype.appendHeader = function (name, value) {
  this[headersSymbol] = this[headersSymbol] ?? new Headers();
  const headers = this[headersSymbol];
  headers.append(name, value);
};

ServerResponse.prototype.flushHeaders = function () {};

ServerResponse.prototype.getHeader = function (name) {
  return getHeader(this[headersSymbol], name);
};

ServerResponse.prototype.getHeaders = function () {
  const headers = this[headersSymbol];
  if (!headers) return kEmptyObject;
  return headers.toJSON();
};

ServerResponse.prototype.getHeaderNames = function () {
  const headers = this[headersSymbol];
  if (!headers) return [];
  return Array.from(headers.keys());
};

ServerResponse.prototype.removeHeader = function (name) {
  if (!this[headersSymbol]) return;
  this[headersSymbol].delete(name);
};

ServerResponse.prototype.setHeader = function (name, value) {
  this[headersSymbol] = this[headersSymbol] ?? new Headers();
  const headers = this[headersSymbol];
  setHeader(headers, name, value);
  return this;
};

ServerResponse.prototype.hasHeader = function (name) {
  if (!this[headersSymbol]) return false;
  return this[headersSymbol].has(name);
};

ServerResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
  _writeHead(statusCode, statusMessage, headers, this);

  return this;
};

Object.defineProperty(ServerResponse.prototype, "shouldKeepAlive", {
  get() {
    return true;
  },
  set(value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(ServerResponse.prototype, "chunkedEncoding", {
  get() {
    return false;
  },
  set(value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(ServerResponse.prototype, "useChunkedEncodingByDefault", {
  get() {
    return true;
  },
  set(value) {
    // throw new Error('not implemented');
  },
});

OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = ServerResponse.prototype._implicitHeader;

class ClientRequest extends OutgoingMessage {
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
  #finished;

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

  _write(chunk, encoding, callback) {
    if (!this.#bodyChunks) {
      this.#bodyChunks = [chunk];
      callback();
      return;
    }
    this.#bodyChunks.push(chunk);
    callback();
  }

  _writev(chunks, callback) {
    if (!this.#bodyChunks) {
      this.#bodyChunks = chunks;
      callback();
      return;
    }
    this.#bodyChunks.push(...chunks);
    callback();
  }
  _destroy(err, callback) {
    this.destroyed = true;
    // If request is destroyed we abort the current response
    this[kAbortController]?.abort?.();
    if (err) {
      this.emit("error", err);
    }
    callback();
  }

  _ensureTls() {
    if (this.#tls === null) this.#tls = {};
    return this.#tls;
  }

  _final(callback) {
    this.#finished = true;
    this[kAbortController] = new AbortController();
    this[kAbortController].signal.addEventListener("abort", () => {
      this.emit("abort");
      this[kClearTimeout]();
      this.destroy();
    });
    if (this.#signal?.aborted) {
      this[kAbortController].abort();
    }

    var method = this.#method,
      body = this.#bodyChunks?.length === 1 ? this.#bodyChunks[0] : Buffer.concat(this.#bodyChunks || []);

    let url: string;
    let proxy: string | undefined;
    const protocol = this.#protocol;
    const path = this.#path;
    if (path.startsWith("http://") || path.startsWith("https://")) {
      url = path;
      proxy = `${protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}`;
    } else {
      url = `${protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${path}`;
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

      this._writableState.autoDestroy = false;
      //@ts-ignore
      this.#fetchRequest = fetch(url, fetchOptions)
        .then(response => {
          const prevIsHTTPS = isNextIncomingMessageHTTPS;
          isNextIncomingMessageHTTPS = response.url.startsWith("https:");
          var res = (this.#res = new IncomingMessage(response, {
            type: "response",
            [kInternalRequest]: this,
          }));
          isNextIncomingMessageHTTPS = prevIsHTTPS;
          this.emit("response", res);
        })
        .catch(err => {
          // Node treats AbortError separately.
          // The "abort" listener on the abort controller should have called this
          if (err?.name === "AbortError") {
            return;
          }

          if (!!$debug) globalReportError(err);

          this.emit("error", err);
        })
        .finally(() => {
          this.#fetchRequest = null;
          this[kClearTimeout]();
          emitCloseNT(this);
        });
    } catch (err) {
      if (!!$debug) globalReportError(err);
      this.emit("error", err);
    } finally {
      callback();
    }
  }

  get aborted() {
    return this.#signal?.aborted || !!this[kAbortController]?.signal.aborted;
  }

  abort() {
    if (this.aborted) return;
    this[kAbortController]?.abort?.();
    // TODO: Close stream if body streaming
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

    var defaultAgent = options._defaultAgent || Agent.globalAgent;

    let protocol = options.protocol;
    if (!protocol) {
      if (options.port === 443) {
        protocol = "https:";
      } else {
        protocol = defaultAgent.protocol || "http:";
      }
    }
    this.#protocol = protocol;

    switch (this.#agent?.protocol) {
      case undefined: {
        break;
      }
      case "http:": {
        if (protocol === "https:") {
          defaultAgent = this.#agent = getDefaultHTTPSAgent();
          break;
        }
      }
      case "https:": {
        if (protocol === "https") {
          defaultAgent = this.#agent = Agent.globalAgent;
          break;
        }
      }
      default: {
        break;
      }
    }

    if (options.path) {
      const path = String(options.path);
      if (RegExpPrototypeExec.$call(INVALID_PATH_REGEX, path) !== null) {
        $debug('Path contains unescaped characters: "%s"', path);
        throw new Error("Path contains unescaped characters");
        // throw new ERR_UNESCAPED_CHARACTERS("Request path");
      }
    }

    // Since we don't implement Agent, we don't need this
    if (protocol !== "http:" && protocol !== "https:" && protocol) {
      const expectedProtocol = defaultAgent?.protocol ?? "http:";
      throw new Error(`Protocol mismatch. Expected: ${expectedProtocol}. Got: ${protocol}`);
      // throw new ERR_INVALID_PROTOCOL(protocol, expectedProtocol);
    }

    const defaultPort = protocol === "https:" ? 443 : 80;

    this.#port = options.port || options.defaultPort || this.#agent?.defaultPort || defaultPort;
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
      signal.addEventListener("abort", () => {
        this[kAbortController]?.abort();
      });
      this.#signal = signal;
    }
    let method = options.method;
    const methodIsString = typeof method === "string";
    if (method !== null && method !== undefined && !methodIsString) {
      // throw new ERR_INVALID_ARG_TYPE("options.method", "string", method);
      throw new Error("ERR_INVALID_ARG_TYPE: options.method");
    }

    if (methodIsString && method) {
      if (!checkIsHttpToken(method)) {
        // throw new ERR_INVALID_HTTP_TOKEN("Method", method);
        throw new Error("ERR_INVALID_HTTP_TOKEN: Method");
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

    this.#finished = false;
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

    const headersArray = $isJSArray(headers);
    if (!headersArray) {
      var headers = options.headers;
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

    process.nextTick(() => {
      // Ref: https://github.com/nodejs/node/blob/f63e8b7fa7a4b5e041ddec67307609ec8837154f/lib/_http_client.js#L803-L839
      if (this.destroyed) return;
      this.emit("socket", this.socket);
    });
  }

  setSocketKeepAlive(enable = true, initialDelay = 0) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  }

  setNoDelay(noDelay = true) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setNoDelay is a no-op");
  }

  [kClearTimeout]() {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
      this.removeAllListeners("timeout");
    }
  }

  #onTimeout() {
    this.#timeoutTimer = undefined;
    this[kAbortController]?.abort();
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

function urlToHttpOptions(url) {
  var { protocol, hostname, hash, search, pathname, href, port, username, password } = url;
  return {
    protocol,
    hostname:
      typeof hostname === "string" && StringPrototypeStartsWith.$call(hostname, "[")
        ? StringPrototypeSlice.$call(hostname, 1, -1)
        : hostname,
    hash,
    search,
    pathname,
    path: `${pathname || ""}${search || ""}`,
    href,
    port: port ? Number(port) : protocol === "https:" ? 443 : protocol === "http:" ? 80 : undefined,
    auth: username || password ? `${decodeURIComponent(username)}:${decodeURIComponent(password)}` : undefined,
  };
}

function validateHost(host, name) {
  if (host !== null && host !== undefined && typeof host !== "string") {
    // throw new ERR_INVALID_ARG_TYPE(
    //   `options.${name}`,
    //   ["string", "undefined", "null"],
    //   host,
    // );
    throw new Error("Invalid arg type in options");
  }
  return host;
}

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val) {
  return RegExpPrototypeExec.$call(tokenRegExp, val) !== null;
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
    throw new Error("status code must be between 100 and 999");
  }

  if (typeof reason === "string") {
    // writeHead(statusCode, reasonPhrase[, headers])
    response.statusMessage = reason;
  } else {
    // writeHead(statusCode[, headers])
    if (!response.statusMessage) response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj = reason;
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

var globalAgent = new Agent();
export default {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  maxHeaderSize: 16384,
  validateHeaderName,
  validateHeaderValue,
  setMaxIdleHTTPParsers(max) {
    $debug(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  globalAgent,
  ClientRequest,
  OutgoingMessage,
};
