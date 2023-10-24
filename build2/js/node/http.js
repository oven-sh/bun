(function (){"use strict";
let $debug_log_enabled = ((env) => (
  // The rationale for checking all these variables is just so you don't have to exactly remember which one you set.
  (env.BUN_DEBUG_ALL && env.BUN_DEBUG_ALL !== '0')
  || (env.BUN_DEBUG_JS && env.BUN_DEBUG_JS !== '0')
  || (env.BUN_DEBUG_NODE_HTTP)
  || (env.DEBUG_NODE_HTTP)
))(Bun.env);
let $debug_pid_prefix = Bun.env.SHOW_PID === '1';
let $debug_log = $debug_log_enabled ? (...args) => {
  // warn goes to stderr without colorizing
  console.warn(($debug_pid_prefix ? `[${process.pid}] ` : '') + (Bun.enableANSIColors ? '\x1b[90m[http]\x1b[0m' : '[http]'), ...args);
} : () => {};
// build2/tmp/node/http.ts
var checkInvalidHeaderChar = function(val) {
  return RegExpPrototypeExec.@call(headerCharRegex, val) !== null;
};
var isValidTLSArray = function(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof @ArrayBuffer || obj instanceof Blob)
    return true;
  if (@Array.isArray(obj)) {
    for (var i = 0;i < obj.length; i++) {
      if (typeof obj !== "string" && !isTypedArray(obj) && !(obj instanceof @ArrayBuffer) && !(obj instanceof Blob))
        return false;
    }
    return true;
  }
};
var validateMsecs = function(numberlike, field) {
  if (typeof numberlike !== "number" || numberlike < 0) {
    throw new ERR_INVALID_ARG_TYPE(field, "number", numberlike);
  }
  return numberlike;
};
var validateFunction = function(callable, field) {
  if (typeof callable !== "function") {
    throw new ERR_INVALID_ARG_TYPE(field, "Function", callable);
  }
  return callable;
};
var createServer = function(options, callback) {
  return new Server(options, callback);
};
var emitListeningNextTick = function(self, onListen, err, hostname, port) {
  if (typeof onListen === "function") {
    try {
      onListen(err, hostname, port);
    } catch (err2) {
      self.emit("error", err2);
    }
  }
  self.listening = !err;
  if (err) {
    self.emit("error", err);
  } else {
    self.emit("listening", hostname, port);
  }
};
var assignHeaders = function(object, req) {
  var headers = req.headers.toJSON();
  const rawHeaders = @newArrayWithSize(req.headers.count * 2);
  var i = 0;
  for (const key in headers) {
    rawHeaders[i++] = key;
    rawHeaders[i++] = headers[key];
  }
  object.headers = headers;
  object.rawHeaders = rawHeaders;
};
var destroyBodyStreamNT = function(bodyStream) {
  bodyStream.destroy();
};
var getDefaultHTTPSAgent = function() {
  return _defaultHTTPSAgent ??= new Agent({ defaultPort: 443, protocol: "https:" });
};
var urlToHttpOptions = function(url) {
  var { protocol, hostname, hash, search, pathname, href, port, username, password } = url;
  return {
    protocol,
    hostname: typeof hostname === "string" && StringPrototypeStartsWith.@call(hostname, "[") ? StringPrototypeSlice.@call(hostname, 1, -1) : hostname,
    hash,
    search,
    pathname,
    path: `${pathname || ""}${search || ""}`,
    href,
    port: port ? Number(port) : protocol === "https:" ? 443 : protocol === "http:" ? 80 : @undefined,
    auth: username || password ? `${decodeURIComponent(username)}:${decodeURIComponent(password)}` : @undefined
  };
};
var validateHost = function(host, name) {
  if (host !== null && host !== @undefined && typeof host !== "string") {
    throw new Error("Invalid arg type in options");
  }
  return host;
};
var checkIsHttpToken = function(val) {
  return RegExpPrototypeExec.@call(tokenRegExp, val) !== null;
};
var _writeHead = function(statusCode, reason, obj, response) {
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw new Error("status code must be between 100 and 999");
  }
  if (typeof reason === "string") {
    response.statusMessage = reason;
  } else {
    if (!response.statusMessage)
      response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj = reason;
  }
  response.statusCode = statusCode;
  {
    let k;
    if (@Array.isArray(obj)) {
      if (obj.length % 2 !== 0) {
        throw new Error("raw headers must have an even number of elements");
      }
      for (let n = 0;n < obj.length; n += 2) {
        k = obj[n + 0];
        if (k)
          response.setHeader(k, obj[n + 1]);
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      for (let i = 0;i < keys.length; i++) {
        k = keys[i];
        if (k)
          response.setHeader(k, obj[k]);
      }
    }
  }
  if (statusCode === 204 || statusCode === 304 || statusCode >= 100 && statusCode <= 199) {
    response._hasBody = false;
  }
};
var request = function(url, options, cb) {
  return new ClientRequest(url, options, cb);
};
var get = function(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
};
var $;
var EventEmitter = @getInternalField(@internalModuleRegistry, 20) || @createInternalModuleById(20);
var { isTypedArray } = @requireNativeModule("util/types");
var { Duplex, Readable, Writable } = @getInternalField(@internalModuleRegistry, 39) || @createInternalModuleById(39);
var { getHeader, setHeader } = @lazy("http");
var headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
var validateHeaderName = (name, label) => {
  if (typeof name !== "string" || !name || !checkIsHttpToken(name)) {
    throw new Error("ERR_INVALID_HTTP_TOKEN");
  }
};
var validateHeaderValue = (name, value) => {
  if (value === @undefined) {
    throw new Error("ERR_HTTP_INVALID_HEADER_VALUE");
  }
  if (checkInvalidHeaderChar(value)) {
    throw new Error("ERR_INVALID_CHAR");
  }
};
var { URL } = globalThis;
var globalReportError = globalThis.reportError;
var setTimeout = globalThis.setTimeout;
var fetch = Bun.fetch;
var kEmptyObject = Object.freeze(Object.create(null));
var kOutHeaders = Symbol.for("kOutHeaders");
var kEndCalled = Symbol.for("kEndCalled");
var kAbortController = Symbol.for("kAbortController");
var kClearTimeout = Symbol("kClearTimeout");
var kCorked = Symbol.for("kCorked");
var searchParamsSymbol = Symbol.for("query");
var StringPrototypeSlice = @String.prototype.slice;
var StringPrototypeStartsWith = @String.prototype.startsWith;
var StringPrototypeToUpperCase = @String.prototype.toUpperCase;
var ArrayIsArray = @Array.isArray;
var RegExpPrototypeExec = @RegExp.prototype.exec;
var ObjectAssign = Object.assign;
var INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
var NODE_HTTP_WARNING = "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";
var _defaultHTTPSAgent;
var kInternalRequest = Symbol("kInternalRequest");
var kInternalSocketData = Symbol.for("::bunternal::");
var kEmptyBuffer = @Buffer.alloc(0);

class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name, expected, actual) {
    super(`The ${name} argument must be of type ${expected}. Received type ${typeof actual}`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;
  #address;
  address() {
    var internalData;
    return this.#address ??= (internalData = this[kInternalSocketData])?.[0]?.requestIP(internalData[2]) ?? {};
  }
  get bufferSize() {
    return this.writableLength;
  }
  connect(port, host, connectListener) {
    return this;
  }
  _destroy(err, callback) {
  }
  _final(callback) {
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
  _read(size) {
  }
  get readyState() {
    if (this.connecting)
      return "opening";
    if (this.readable) {
      return this.writable ? "open" : "readOnly";
    } else {
      return this.writable ? "writeOnly" : "closed";
    }
  }
  ref() {
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
  resetAndDestroy() {
  }
  setKeepAlive(enable = false, initialDelay = 0) {
  }
  setNoDelay(noDelay = true) {
    return this;
  }
  setTimeout(timeout, callback) {
    return this;
  }
  unref() {
  }
  _write(chunk, encoding, callback) {
  }
};

class Agent extends EventEmitter {
  defaultPort = 80;
  protocol = "http:";
  options;
  requests;
  sockets;
  freeSockets;
  keepAliveMsecs;
  keepAlive;
  maxSockets;
  maxFreeSockets;
  scheduling;
  maxTotalSockets;
  totalSocketCount;
  #fakeSocket;
  static get globalAgent() {
    return globalAgent;
  }
  static get defaultMaxSockets() {
    return @Infinity;
  }
  constructor(options = kEmptyObject) {
    super();
    this.options = options = { ...options, path: null };
    if (options.noDelay === @undefined)
      options.noDelay = true;
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
  createConnection() {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
    return this.#fakeSocket ??= new FakeSocket;
  }
  getName(options = kEmptyObject) {
    let name = `http:${options.host || "localhost"}:`;
    if (options.port)
      name += options.port;
    name += ":";
    if (options.localAddress)
      name += options.localAddress;
    if (options.family === 4 || options.family === 6)
      name += `:${options.family}`;
    if (options.socketPath)
      name += `:${options.socketPath}`;
    return name;
  }
  addRequest() {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
  }
  createSocket(req, options, cb) {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
    cb(null, this.#fakeSocket ??= new FakeSocket);
  }
  removeSocket() {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.removeSocket is a no-op");
  }
  keepSocketAlive() {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.keepSocketAlive is a no-op");
    return true;
  }
  reuseSocket() {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.reuseSocket is a no-op");
  }
  destroy() {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.destroy is a no-op");
  }
}

class Server extends EventEmitter {
  #server;
  #options;
  #tls;
  #is_tls = false;
  listening = false;
  serverName;
  constructor(options, callback) {
    super();
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if (options == null || typeof options === "object") {
      options = { ...options };
      this.#tls = null;
      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key)) {
          @throwTypeError("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.#is_tls = true;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          @throwTypeError("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.#is_tls = true;
      }
      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          @throwTypeError("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        }
        this.#is_tls = true;
      }
      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        @throwTypeError("passphrase argument must be an string");
      }
      let serverName = options.servername;
      if (serverName && typeof serverName !== "string") {
        @throwTypeError("servername argument must be an string");
      }
      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        @throwTypeError("secureOptions argument must be an number");
      }
      if (this.#is_tls) {
        this.#tls = {
          serverName,
          key,
          cert,
          ca,
          passphrase,
          secureOptions
        };
      } else {
        this.#tls = null;
      }
    } else {
      throw new Error("bun-http-polyfill: invalid arguments");
    }
    this.#options = options;
    if (callback)
      this.on("request", callback);
  }
  closeAllConnections() {
    const server = this.#server;
    if (!server) {
      return;
    }
    this.#server = @undefined;
    server.stop(true);
    this.emit("close");
  }
  closeIdleConnections() {
  }
  close(optionalCallback) {
    const server = this.#server;
    if (!server) {
      if (typeof optionalCallback === "function")
        process.nextTick(optionalCallback, new Error("Server is not running"));
      return;
    }
    this.#server = @undefined;
    if (typeof optionalCallback === "function")
      this.once("close", optionalCallback);
    server.stop();
    this.emit("close");
  }
  address() {
    if (!this.#server)
      return null;
    return this.#server.address;
  }
  listen(port, host, backlog, onListen) {
    const server = this;
    let socketPath;
    if (typeof port == "string" && !Number.isSafeInteger(Number(port))) {
      socketPath = port;
    }
    if (typeof host === "function") {
      onListen = host;
      host = @undefined;
    }
    if (typeof port === "function") {
      onListen = port;
    } else if (typeof port === "object") {
      port?.signal?.addEventListener("abort", () => {
        this.close();
      });
      host = port?.host;
      port = port?.port;
      if (typeof port?.callback === "function")
        onListen = port?.callback;
    }
    if (typeof backlog === "function") {
      onListen = backlog;
    }
    const ResponseClass = this.#options.ServerResponse || ServerResponse;
    const RequestClass = this.#options.IncomingMessage || IncomingMessage;
    try {
      const tls = this.#tls;
      if (tls) {
        this.serverName = tls.serverName || host || "localhost";
      }
      this.#server = Bun.serve({
        tls,
        port,
        hostname: host,
        unix: socketPath,
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
          }
        },
        fetch(req, _server) {
          var pendingResponse;
          var pendingError;
          var rejectFunction, resolveFunction;
          var reject = (err) => {
            if (pendingError)
              return;
            pendingError = err;
            if (rejectFunction)
              rejectFunction(err);
          };
          var reply = function(resp) {
            if (pendingResponse)
              return;
            pendingResponse = resp;
            if (resolveFunction)
              resolveFunction(resp);
          };
          const http_req = new RequestClass(req);
          const http_res = new ResponseClass({ reply, req: http_req });
          http_req.socket[kInternalSocketData] = [_server, http_res, req];
          http_req.once("error", (err) => reject(err));
          http_res.once("error", (err) => reject(err));
          const upgrade = req.headers.get("upgrade");
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
          return new @Promise((resolve, reject2) => {
            resolveFunction = resolve;
            rejectFunction = reject2;
          });
        }
      });
      setTimeout(emitListeningNextTick, 1, this, onListen, null, this.#server.hostname, this.#server.port);
    } catch (err) {
      server.emit("error", err);
    }
    return this;
  }
  setTimeout(msecs, callback) {
  }
}
class IncomingMessage extends Readable {
  method;
  complete;
  constructor(req, defaultIncomingOpts) {
    const method = req.method;
    super();
    const url = new URL(req.url);
    var { type = "request", [kInternalRequest]: nodeReq } = defaultIncomingOpts || {};
    this.#noBody = type === "request" ? method === "GET" || method === "HEAD" || method === "TRACE" || method === "CONNECT" || method === "OPTIONS" || (parseInt(req.headers.get("Content-Length") || "") || 0) === 0 : false;
    this.#req = req;
    this.method = method;
    this.#type = type;
    this.complete = !!this.#noBody;
    this.#bodyStream = @undefined;
    const socket = new FakeSocket;
    if (url.protocol === "https:")
      socket.encrypted = true;
    this.#fakeSocket = socket;
    this.url = url.pathname + url.search;
    this.req = nodeReq;
    assignHeaders(this, req);
  }
  headers;
  rawHeaders;
  _consuming = false;
  _dumped = false;
  #bodyStream;
  #fakeSocket;
  #noBody = false;
  #aborted = false;
  #req;
  url;
  #type;
  _construct(callback) {
    if (this.#type === "response" || this.#noBody) {
      callback();
      return;
    }
    const contentLength = this.#req.headers.get("content-length");
    const length = contentLength ? parseInt(contentLength, 10) : 0;
    if (length === 0) {
      this.#noBody = true;
      callback();
      return;
    }
    callback();
  }
  async#consumeStream(reader) {
    while (true) {
      var { done, value } = await reader.readMany();
      if (this.#aborted)
        return;
      if (done) {
        this.push(null);
        process.nextTick(destroyBodyStreamNT, this);
        break;
      }
      for (var v of value) {
        this.push(v);
      }
    }
  }
  _read(size) {
    if (this.#noBody) {
      this.push(null);
      this.complete = true;
    } else if (this.#bodyStream == null) {
      const reader = this.#req.body?.getReader();
      if (!reader) {
        this.push(null);
        return;
      }
      this.#bodyStream = reader;
      this.#consumeStream(reader);
    }
  }
  get aborted() {
    return this.#aborted;
  }
  #abort() {
    if (this.#aborted)
      return;
    this.#aborted = true;
    var bodyStream = this.#bodyStream;
    if (!bodyStream)
      return;
    bodyStream.cancel();
    this.complete = true;
    this.#bodyStream = @undefined;
    this.push(null);
  }
  get connection() {
    return this.#fakeSocket;
  }
  get statusCode() {
    return this.#req.status;
  }
  get statusMessage() {
    return STATUS_CODES[this.#req.status];
  }
  get httpVersion() {
    return "1.1";
  }
  get rawTrailers() {
    return [];
  }
  get httpVersionMajor() {
    return 1;
  }
  get httpVersionMinor() {
    return 1;
  }
  get trailers() {
    return kEmptyObject;
  }
  get socket() {
    return this.#fakeSocket ??= new FakeSocket;
  }
  set socket(val) {
    this.#fakeSocket = val;
  }
  setTimeout(msecs, callback) {
    throw new Error("not implemented");
  }
}

class OutgoingMessage extends Writable {
  constructor() {
    super(...arguments);
  }
  #headers;
  headersSent = false;
  sendDate = true;
  req;
  timeout;
  #finished = false;
  [kEndCalled] = false;
  #fakeSocket;
  #timeoutTimer;
  [kAbortController] = null;
  _implicitHeader() {
  }
  get headers() {
    if (!this.#headers)
      return kEmptyObject;
    return this.#headers.toJSON();
  }
  get shouldKeepAlive() {
    return true;
  }
  get chunkedEncoding() {
    return false;
  }
  set chunkedEncoding(value) {
  }
  set shouldKeepAlive(value) {
  }
  get useChunkedEncodingByDefault() {
    return true;
  }
  set useChunkedEncodingByDefault(value) {
  }
  get socket() {
    return this.#fakeSocket ??= new FakeSocket;
  }
  set socket(val) {
    this.#fakeSocket = val;
  }
  get connection() {
    return this.socket;
  }
  get finished() {
    return this.#finished;
  }
  appendHeader(name, value) {
    var headers = this.#headers ??= new Headers;
    headers.append(name, value);
  }
  flushHeaders() {
  }
  getHeader(name) {
    return getHeader(this.#headers, name);
  }
  getHeaders() {
    if (!this.#headers)
      return kEmptyObject;
    return this.#headers.toJSON();
  }
  getHeaderNames() {
    var headers = this.#headers;
    if (!headers)
      return [];
    return @Array.from(headers.keys());
  }
  removeHeader(name) {
    if (!this.#headers)
      return;
    this.#headers.delete(name);
  }
  setHeader(name, value) {
    var headers = this.#headers ??= new Headers;
    headers.set(name, value);
    return this;
  }
  hasHeader(name) {
    if (!this.#headers)
      return false;
    return this.#headers.has(name);
  }
  addTrailers(headers) {
    throw new Error("not implemented");
  }
  [kClearTimeout]() {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.removeAllListeners("timeout");
      this.#timeoutTimer = @undefined;
    }
  }
  #onTimeout() {
    this.#timeoutTimer = @undefined;
    this[kAbortController]?.abort();
    this.emit("timeout");
  }
  setTimeout(msecs, callback) {
    if (this.destroyed)
      return this;
    this.timeout = msecs = validateMsecs(msecs, "msecs");
    clearTimeout(this.#timeoutTimer);
    if (msecs === 0) {
      if (callback !== @undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }
      this.#timeoutTimer = @undefined;
    } else {
      this.#timeoutTimer = setTimeout(this.#onTimeout.bind(this), msecs).unref();
      if (callback !== @undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }
    return this;
  }
}
var OriginalWriteHeadFn;
var OriginalImplicitHeadFn;

class ServerResponse extends Writable {
  constructor(c) {
    super();
    if (!c)
      c = {};
    var req = c.req || {};
    var reply = c.reply;
    this.req = req;
    this._reply = reply;
    this.sendDate = true;
    this.statusCode = 200;
    this.headersSent = false;
    this.statusMessage = @undefined;
    this.#controller = @undefined;
    this.#firstWrite = @undefined;
    this._writableState.decodeStrings = false;
    this.#deferred = @undefined;
    if (req.method === "HEAD")
      this._hasBody = false;
  }
  req;
  _reply;
  sendDate;
  statusCode;
  #headers;
  headersSent = false;
  statusMessage;
  #controller;
  #firstWrite;
  _sent100 = false;
  _defaultKeepAlive = false;
  _removedConnection = false;
  _removedContLen = false;
  _hasBody = true;
  #deferred = @undefined;
  #finished = false;
  _implicitHeader() {
    this.writeHead(this.statusCode);
  }
  _write(chunk, encoding, callback) {
    if (!this.#firstWrite && !this.headersSent) {
      this.#firstWrite = chunk;
      callback();
      return;
    }
    this.#ensureReadableStreamController((controller) => {
      controller.write(chunk);
      callback();
    });
  }
  _writev(chunks, callback) {
    if (chunks.length === 1 && !this.headersSent && !this.#firstWrite) {
      this.#firstWrite = chunks[0].chunk;
      callback();
      return;
    }
    this.#ensureReadableStreamController((controller) => {
      for (const chunk of chunks) {
        controller.write(chunk.chunk);
      }
      callback();
    });
  }
  #ensureReadableStreamController(run) {
    var thisController = this.#controller;
    if (thisController)
      return run(thisController);
    this.headersSent = true;
    var firstWrite = this.#firstWrite;
    this.#firstWrite = @undefined;
    this._reply(new Response(new @ReadableStream({
      type: "direct",
      pull: (controller) => {
        this.#controller = controller;
        if (firstWrite)
          controller.write(firstWrite);
        firstWrite = @undefined;
        run(controller);
        if (!this.#finished) {
          return new @Promise((resolve) => {
            this.#deferred = resolve;
          });
        }
      }
    }), {
      headers: this.#headers,
      status: this.statusCode,
      statusText: this.statusMessage ?? STATUS_CODES[this.statusCode]
    }));
  }
  #drainHeadersIfObservable() {
    if (this._implicitHeader === OriginalImplicitHeadFn && this.writeHead === OriginalWriteHeadFn) {
      return;
    }
    this._implicitHeader();
  }
  _final(callback) {
    if (!this.headersSent) {
      var data = this.#firstWrite || "";
      this.#firstWrite = @undefined;
      this.#finished = true;
      this.#drainHeadersIfObservable();
      this._reply(new Response(data, {
        headers: this.#headers,
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode]
      }));
      callback && callback();
      return;
    }
    this.#finished = true;
    this.#ensureReadableStreamController((controller) => {
      controller.end();
      callback();
      var deferred = this.#deferred;
      if (deferred) {
        this.#deferred = @undefined;
        deferred();
      }
    });
  }
  writeProcessing() {
    throw new Error("not implemented");
  }
  addTrailers(headers) {
    throw new Error("not implemented");
  }
  assignSocket(socket) {
    throw new Error("not implemented");
  }
  detachSocket(socket) {
    throw new Error("not implemented");
  }
  writeContinue(callback) {
    throw new Error("not implemented");
  }
  setTimeout(msecs, callback) {
    throw new Error("not implemented");
  }
  get shouldKeepAlive() {
    return true;
  }
  get chunkedEncoding() {
    return false;
  }
  set chunkedEncoding(value) {
  }
  set shouldKeepAlive(value) {
  }
  get useChunkedEncodingByDefault() {
    return true;
  }
  set useChunkedEncodingByDefault(value) {
  }
  appendHeader(name, value) {
    var headers = this.#headers ??= new Headers;
    headers.append(name, value);
  }
  flushHeaders() {
  }
  getHeader(name) {
    return getHeader(this.#headers, name);
  }
  getHeaders() {
    var headers = this.#headers;
    if (!headers)
      return kEmptyObject;
    return headers.toJSON();
  }
  getHeaderNames() {
    var headers = this.#headers;
    if (!headers)
      return [];
    return @Array.from(headers.keys());
  }
  removeHeader(name) {
    if (!this.#headers)
      return;
    this.#headers.delete(name);
  }
  setHeader(name, value) {
    var headers = this.#headers ??= new Headers;
    setHeader(headers, name, value);
    return this;
  }
  hasHeader(name) {
    if (!this.#headers)
      return false;
    return this.#headers.has(name);
  }
  writeHead(statusCode, statusMessage, headers) {
    _writeHead(statusCode, statusMessage, headers, this);
    return this;
  }
}
OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = ServerResponse.prototype._implicitHeader;

class ClientRequest extends OutgoingMessage {
  #timeout;
  #res = null;
  #upgradeOrConnect = false;
  #parser = null;
  #maxHeadersCount = null;
  #reusedSocket = false;
  #host;
  #protocol;
  #method;
  #port;
  #useDefaultPort;
  #joinDuplicateHeaders;
  #maxHeaderSize;
  #agent = globalAgent;
  #path;
  #socketPath;
  #bodyChunks = null;
  #fetchRequest;
  #signal = null;
  [kAbortController] = null;
  #timeoutTimer = @undefined;
  #options;
  #finished;
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
  _final(callback) {
    this.#finished = true;
    this[kAbortController] = new AbortController;
    this[kAbortController].signal.addEventListener("abort", () => {
      this[kClearTimeout]();
    });
    if (this.#signal?.aborted) {
      this[kAbortController].abort();
    }
    var method = this.#method, body = this.#bodyChunks?.length === 1 ? this.#bodyChunks[0] : @Buffer.concat(this.#bodyChunks || []);
    let url;
    let proxy;
    if (this.#path.startsWith("http://") || this.#path.startsWith("https://")) {
      url = this.#path;
      proxy = `${this.#protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}`;
    } else {
      url = `${this.#protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${this.#path}`;
    }
    try {
      this.#fetchRequest = fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body && method !== "GET" && method !== "HEAD" && method !== "OPTIONS" ? body : @undefined,
        redirect: "manual",
        verbose: !!$debug_log_enabled,
        signal: this[kAbortController].signal,
        proxy,
        timeout: false,
        decompress: false
      }).then((response) => {
        var res = this.#res = new IncomingMessage(response, {
          type: "response",
          [kInternalRequest]: this
        });
        this.emit("response", res);
      }).catch((err) => {
        if (!!$debug_log_enabled)
          globalReportError(err);
        this.emit("error", err);
      }).finally(() => {
        this.#fetchRequest = null;
        this[kClearTimeout]();
      });
    } catch (err) {
      if (!!$debug_log_enabled)
        globalReportError(err);
      this.emit("error", err);
    } finally {
      callback();
    }
  }
  get aborted() {
    return this.#signal?.aborted || !!this[kAbortController]?.signal.aborted;
  }
  abort() {
    if (this.aborted)
      return;
    this[kAbortController].abort();
  }
  constructor(input, options, cb) {
    super();
    if (typeof input === "string") {
      const urlStr = input;
      try {
        var urlObject = new URL(urlStr);
      } catch (e) {
        @throwTypeError(`Invalid URL: ${urlStr}`);
      }
      input = urlToHttpOptions(urlObject);
    } else if (input && typeof input === "object" && input instanceof URL) {
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
      case @undefined: {
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
      const path = @String(options.path);
      if (RegExpPrototypeExec.@call(INVALID_PATH_REGEX, path) !== null) {
        $debug_log('Path contains unescaped characters: "%s"', path);
        throw new Error("Path contains unescaped characters");
      }
    }
    if (protocol !== "http:" && protocol !== "https:" && protocol) {
      const expectedProtocol = defaultAgent?.protocol ?? "http:";
      throw new Error(`Protocol mismatch. Expected: ${expectedProtocol}. Got: ${protocol}`);
    }
    const defaultPort = protocol === "https:" ? 443 : 80;
    this.#port = options.port || options.defaultPort || this.#agent?.defaultPort || defaultPort;
    this.#useDefaultPort = this.#port === defaultPort;
    const host = this.#host = options.host = validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost";
    this.#socketPath = options.socketPath;
    const signal = options.signal;
    if (signal) {
      signal.addEventListener("abort", () => {
        this[kAbortController]?.abort();
      });
      this.#signal = signal;
    }
    let method = options.method;
    const methodIsString = typeof method === "string";
    if (method !== null && method !== @undefined && !methodIsString) {
      throw new Error("ERR_INVALID_ARG_TYPE: options.method");
    }
    if (methodIsString && method) {
      if (!checkIsHttpToken(method)) {
        throw new Error("ERR_INVALID_HTTP_TOKEN: Method");
      }
      method = this.#method = StringPrototypeToUpperCase.@call(method);
    } else {
      method = this.#method = "GET";
    }
    const _maxHeaderSize = options.maxHeaderSize;
    this.#maxHeaderSize = _maxHeaderSize;
    var _joinDuplicateHeaders = options.joinDuplicateHeaders;
    if (_joinDuplicateHeaders !== @undefined) {
    }
    this.#joinDuplicateHeaders = _joinDuplicateHeaders;
    this.#path = options.path || "/";
    if (cb) {
      this.once("response", cb);
    }
    $debug_log(`new ClientRequest: ${this.#method} ${this.#protocol}//${this.#host}:${this.#port}${this.#path}`);
    this.#finished = false;
    this.#res = null;
    this.#upgradeOrConnect = false;
    this.#parser = null;
    this.#maxHeadersCount = null;
    this.#reusedSocket = false;
    this.#host = host;
    this.#protocol = protocol;
    var timeout = options.timeout;
    if (timeout !== @undefined && timeout !== 0) {
      this.setTimeout(timeout, @undefined);
    }
    const headersArray = ArrayIsArray(headers);
    if (!headersArray) {
      var headers = options.headers;
      if (headers) {
        for (let key in headers) {
          this.setHeader(key, headers[key]);
        }
      }
      var auth = options.auth;
      if (auth && !this.getHeader("Authorization")) {
        this.setHeader("Authorization", "Basic " + @Buffer.from(auth).toString("base64"));
      }
    }
    var { signal: _signal, ...optsWithoutSignal } = options;
    this.#options = optsWithoutSignal;
  }
  setSocketKeepAlive(enable = true, initialDelay = 0) {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  }
  setNoDelay(noDelay = true) {
    $debug_log(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setNoDelay is a no-op");
  }
  [kClearTimeout]() {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = @undefined;
      this.removeAllListeners("timeout");
    }
  }
  #onTimeout() {
    this.#timeoutTimer = @undefined;
    this[kAbortController]?.abort();
    this.emit("timeout");
  }
  setTimeout(msecs, callback) {
    if (this.destroyed)
      return this;
    this.timeout = msecs = validateMsecs(msecs, "msecs");
    clearTimeout(this.#timeoutTimer);
    if (msecs === 0) {
      if (callback !== @undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }
      this.#timeoutTimer = @undefined;
    } else {
      this.#timeoutTimer = setTimeout(this.#onTimeout.bind(this), msecs).unref();
      if (callback !== @undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }
    return this;
  }
}
var tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
var METHODS = [
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
  "UNSUBSCRIBE"
];
var STATUS_CODES = {
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
  511: "Network Authentication Required"
};
var globalAgent = new Agent;
$ = {
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
    $debug_log(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  globalAgent,
  ClientRequest,
  OutgoingMessage
};
return $})
