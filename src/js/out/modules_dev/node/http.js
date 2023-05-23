var isValidTLSArray = function(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof ArrayBuffer || obj instanceof Blob)
    return !0;
  if (Array.isArray(obj)) {
    for (var i = 0;i < obj.length; i++)
      if (typeof obj !== "string" && !isTypedArray(obj) && !(obj instanceof ArrayBuffer) && !(obj instanceof Blob))
        return !1;
    return !0;
  }
}, getHeader = function(headers, name) {
  if (!headers)
    return;
  const result = headers.get(name);
  return result == null ? void 0 : result;
};
function createServer(options, callback) {
  return new Server(options, callback);
}
var emitListeningNextTick = function(self, onListen, err, hostname, port) {
  if (typeof onListen === "function")
    try {
      onListen(err, hostname, port);
    } catch (err2) {
      self.emit("error", err2);
    }
  if (self.listening = !err, err)
    self.emit("error", err);
  else
    self.emit("listening", hostname, port);
}, assignHeaders = function(object, req) {
  var headers = req.headers.toJSON();
  const rawHeaders = newArrayWithSize(req.headers.count * 2);
  var i = 0;
  for (let key in headers)
    rawHeaders[i++] = key, rawHeaders[i++] = headers[key];
  object.headers = headers, object.rawHeaders = rawHeaders;
};
var getDefaultHTTPSAgent = function() {
  return _defaultHTTPSAgent ??= new Agent({ defaultPort: 443, protocol: "https:" });
};
var urlToHttpOptions = function(url) {
  var { protocol, hostname, hash, search, pathname, href, port, username, password } = url;
  return {
    protocol,
    hostname: typeof hostname === "string" && StringPrototypeStartsWith.call(hostname, "[") ? StringPrototypeSlice.call(hostname, 1, -1) : hostname,
    hash,
    search,
    pathname,
    path: `${pathname || ""}${search || ""}`,
    href,
    port: port ? Number(port) : protocol === "https:" ? 443 : protocol === "http:" ? 80 : void 0,
    auth: username || password ? `${decodeURIComponent(username)}:${decodeURIComponent(password)}` : void 0
  };
}, validateHost = function(host, name) {
  if (host !== null && host !== void 0 && typeof host !== "string")
    throw new Error("Invalid arg type in options");
  return host;
}, checkIsHttpToken = function(val) {
  return RegExpPrototypeExec.call(tokenRegExp, val) !== null;
};
var _writeHead = function(statusCode, reason, obj, response) {
  if (statusCode |= 0, statusCode < 100 || statusCode > 999)
    throw new Error("status code must be between 100 and 999");
  if (typeof reason === "string")
    response.statusMessage = reason;
  else {
    if (!response.statusMessage)
      response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj = reason;
  }
  response.statusCode = statusCode;
  {
    let k;
    if (Array.isArray(obj)) {
      if (obj.length % 2 !== 0)
        throw new Error("raw headers must have an even number of elements");
      for (let n = 0;n < obj.length; n += 2)
        if (k = obj[n + 0], k)
          response.setHeader(k, obj[n + 1]);
    } else if (obj) {
      const keys = Object.keys(obj);
      for (let i = 0;i < keys.length; i++)
        if (k = keys[i], k)
          response.setHeader(k, obj[k]);
    }
  }
};
function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}
function get(url, options, cb) {
  const req = request(url, options, cb);
  return req.end(), req;
}
var { EventEmitter } = import.meta.require("node:events"), { isIPv6 } = import.meta.require("node:net"), { Readable, Writable, Duplex } = import.meta.require("node:stream"), { URL } = import.meta.require("node:url"), { newArrayWithSize, String, Object, Array } = import.meta.primordials, { isTypedArray } = import.meta.require("util/types"), globalReportError = globalThis.reportError, setTimeout = globalThis.setTimeout, fetch = Bun.fetch, nop = () => {
}, __DEBUG__ = process.env.__DEBUG__, debug = __DEBUG__ ? (...args) => console.log("node:http", ...args) : nop, kEmptyObject = Object.freeze(Object.create(null)), kOutHeaders = Symbol.for("kOutHeaders"), kEndCalled = Symbol.for("kEndCalled"), kAbortController = Symbol.for("kAbortController"), kClearTimeout = Symbol("kClearTimeout"), kCorked = Symbol.for("kCorked"), searchParamsSymbol = Symbol.for("query"), StringPrototypeSlice = String.prototype.slice, StringPrototypeStartsWith = String.prototype.startsWith, StringPrototypeToUpperCase = String.prototype.toUpperCase, StringPrototypeIncludes = String.prototype.includes, StringPrototypeCharCodeAt = String.prototype.charCodeAt, StringPrototypeIndexOf = String.prototype.indexOf, ArrayIsArray = Array.isArray, RegExpPrototypeExec = RegExp.prototype.exec, ObjectAssign = Object.assign, ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty, INVALID_PATH_REGEX = /[^\u0021-\u00ff]/, NODE_HTTP_WARNING = "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.", _globalAgent, _defaultHTTPSAgent, kInternalRequest = Symbol("kInternalRequest"), kInternalSocketData = Symbol.for("::bunternal::"), kEmptyBuffer = Buffer.alloc(0), FakeSocket = class Socket extends Duplex {
  bytesRead = 0;
  bytesWritten = 0;
  connecting = !1;
  remoteAddress = null;
  localAddress = "127.0.0.1";
  remotePort;
  timeout = 0;
  isServer = !1;
  address() {
    return {
      address: this.localAddress,
      family: this.localFamily,
      port: this.localPort
    };
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
    if (this.readable)
      return this.writable ? "open" : "readOnly";
    else
      return this.writable ? "writeOnly" : "closed";
  }
  ref() {
  }
  get remoteFamily() {
    return "IPv4";
  }
  resetAndDestroy() {
  }
  setKeepAlive(enable = !1, initialDelay = 0) {
  }
  setNoDelay(noDelay = !0) {
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
  #defaultPort = 80;
  #protocol = "http:";
  #options;
  #requests;
  #sockets;
  #freeSockets;
  #keepAliveMsecs;
  #keepAlive;
  #maxSockets;
  #maxFreeSockets;
  #scheduling;
  #maxTotalSockets;
  #totalSocketCount;
  #fakeSocket;
  static get globalAgent() {
    return _globalAgent ??= new Agent;
  }
  static get defaultMaxSockets() {
    return Infinity;
  }
  constructor(options = kEmptyObject) {
    super();
    if (this.#options = options = { ...options, path: null }, options.noDelay === void 0)
      options.noDelay = !0;
    this.#requests = kEmptyObject, this.#sockets = kEmptyObject, this.#freeSockets = kEmptyObject, this.#keepAliveMsecs = options.keepAliveMsecs || 1000, this.#keepAlive = options.keepAlive || !1, this.#maxSockets = options.maxSockets || Agent.defaultMaxSockets, this.#maxFreeSockets = options.maxFreeSockets || 256, this.#scheduling = options.scheduling || "lifo", this.#maxTotalSockets = options.maxTotalSockets, this.#totalSocketCount = 0, this.#defaultPort = options.defaultPort || 80, this.#protocol = options.protocol || "http:";
  }
  get defaultPort() {
    return this.#defaultPort;
  }
  get protocol() {
    return this.#protocol;
  }
  get requests() {
    return this.#requests;
  }
  get sockets() {
    return this.#sockets;
  }
  get freeSockets() {
    return this.#freeSockets;
  }
  get options() {
    return this.#options;
  }
  get keepAliveMsecs() {
    return this.#keepAliveMsecs;
  }
  get keepAlive() {
    return this.#keepAlive;
  }
  get maxSockets() {
    return this.#maxSockets;
  }
  get maxFreeSockets() {
    return this.#maxFreeSockets;
  }
  get scheduling() {
    return this.#scheduling;
  }
  get maxTotalSockets() {
    return this.#maxTotalSockets;
  }
  get totalSocketCount() {
    return this.#totalSocketCount;
  }
  createConnection() {
    return debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.createConnection is a no-op, returns fake socket"), this.#fakeSocket ??= new FakeSocket;
  }
  getName(options = kEmptyObject) {
    let name = `http:${options.host || "localhost"}:`;
    if (options.port)
      name += options.port;
    if (name += ":", options.localAddress)
      name += options.localAddress;
    if (options.family === 4 || options.family === 6)
      name += `:${options.family}`;
    if (options.socketPath)
      name += `:${options.socketPath}`;
    return name;
  }
  addRequest() {
    debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.addRequest is a no-op");
  }
  createSocket(req, options, cb) {
    debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.createSocket returns fake socket"), cb(null, this.#fakeSocket ??= new FakeSocket);
  }
  removeSocket() {
    debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.removeSocket is a no-op");
  }
  keepSocketAlive() {
    return debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.keepSocketAlive is a no-op"), !0;
  }
  reuseSocket() {
    debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.reuseSocket is a no-op");
  }
  destroy() {
    debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: Agent.destroy is a no-op");
  }
}

class Server extends EventEmitter {
  #server;
  #options;
  #tls;
  #is_tls = !1;
  listening = !1;
  constructor(options, callback) {
    super();
    if (typeof options === "function")
      callback = options, options = {};
    else if (options == null || typeof options === "object") {
      options = { ...options }, this.#tls = null;
      let key = options.key;
      if (key) {
        if (!isValidTLSArray(key))
          throw new TypeError("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.#is_tls = !0;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert))
          throw new TypeError("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.#is_tls = !0;
      }
      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca))
          throw new TypeError("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile");
        this.#is_tls = !0;
      }
      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string")
        throw new TypeError("passphrase argument must be an string");
      let serverName = options.servername;
      if (serverName && typeof serverName !== "string")
        throw new TypeError("servername argument must be an string");
      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number")
        throw new TypeError("secureOptions argument must be an number");
      if (this.#is_tls)
        this.#tls = {
          serverName,
          key,
          cert,
          ca,
          passphrase,
          secureOptions
        };
      else
        this.#tls = null;
    } else
      throw new Error("bun-http-polyfill: invalid arguments");
    if (this.#options = options, callback)
      this.on("request", callback);
  }
  closeAllConnections() {
    const server = this.#server;
    if (!server)
      return;
    this.#server = void 0, server.stop(!0), this.emit("close");
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
    if (this.#server = void 0, typeof optionalCallback === "function")
      this.once("close", optionalCallback);
    server.stop(), this.emit("close");
  }
  address() {
    if (!this.#server)
      return null;
    const address = this.#server.hostname;
    return {
      address,
      family: isIPv6(address) ? "IPv6" : "IPv4",
      port: this.#server.port
    };
  }
  listen(port, host, backlog, onListen) {
    const server = this;
    if (typeof host === "function")
      onListen = host, host = void 0;
    if (typeof port === "function")
      onListen = port;
    else if (typeof port === "object") {
      if (port?.signal?.addEventListener("abort", () => {
        this.close();
      }), host = port?.host, port = port?.port, typeof port?.callback === "function")
        onListen = port?.callback;
    }
    if (typeof backlog === "function")
      onListen = backlog;
    const ResponseClass = this.#options.ServerResponse || ServerResponse, RequestClass = this.#options.IncomingMessage || IncomingMessage;
    try {
      const tls = this.#tls;
      if (tls)
        this.serverName = tls.serverName || host || "localhost";
      this.#server = Bun.serve({
        tls,
        port,
        hostname: host,
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
          var pendingResponse, pendingError, rejectFunction, resolveFunction, reject = (err) => {
            if (pendingError)
              return;
            if (pendingError = err, rejectFunction)
              rejectFunction(err);
          }, reply = function(resp) {
            if (pendingResponse)
              return;
            if (pendingResponse = resp, resolveFunction)
              resolveFunction(resp);
          };
          const http_req = new RequestClass(req), http_res = new ResponseClass({ reply, req: http_req });
          if (http_req.once("error", (err) => reject(err)), http_res.once("error", (err) => reject(err)), req.headers.get("upgrade")) {
            const socket = new FakeSocket;
            socket[kInternalSocketData] = [_server, http_res, req], server.emit("upgrade", http_req, socket, kEmptyBuffer);
          } else
            server.emit("request", http_req, http_res);
          if (pendingError)
            throw pendingError;
          if (pendingResponse)
            return pendingResponse;
          return new Promise((resolve, reject2) => {
            resolveFunction = resolve, rejectFunction = reject2;
          });
        }
      }), setTimeout(emitListeningNextTick, 1, this, onListen, null, this.#server.hostname, this.#server.port);
    } catch (err) {
      setTimeout(emitListeningNextTick, 1, this, onListen, err);
    }
    return this;
  }
  setTimeout(msecs, callback) {
  }
}
class IncomingMessage extends Readable {
  constructor(req, defaultIncomingOpts) {
    const method = req.method;
    super();
    const url = new URL(req.url);
    var { type = "request", [kInternalRequest]: nodeReq } = defaultIncomingOpts || {};
    this.#noBody = type === "request" ? method === "GET" || method === "HEAD" || method === "TRACE" || method === "CONNECT" || method === "OPTIONS" || (parseInt(req.headers.get("Content-Length") || "") || 0) === 0 : !1, this.#req = req, this.method = method, this.#type = type, this.complete = !!this.#noBody, this.#bodyStream = null;
    const socket = new FakeSocket;
    socket.remoteAddress = url.hostname, socket.remotePort = url.port, this.#fakeSocket = socket, this.url = url.pathname + url.search, this.#nodeReq = nodeReq, assignHeaders(this, req);
  }
  headers;
  rawHeaders;
  _consuming = !1;
  _dumped = !1;
  #bodyStream = null;
  #fakeSocket = void 0;
  #noBody = !1;
  #aborted = !1;
  #req;
  url;
  #type;
  #nodeReq;
  get req() {
    return this.#nodeReq;
  }
  _construct(callback) {
    if (this.#type === "response" || this.#noBody) {
      callback();
      return;
    }
    const contentLength = this.#req.headers.get("content-length");
    if ((contentLength ? parseInt(contentLength, 10) : 0) === 0) {
      this.#noBody = !0, callback();
      return;
    }
    callback();
  }
  #closeBodyStream() {
    debug("closeBodyStream()");
    var bodyStream = this.#bodyStream;
    if (bodyStream == null)
      return;
    this.complete = !0, this.#bodyStream = void 0, this.push(null);
  }
  _read(size) {
    if (this.#noBody)
      this.push(null), this.complete = !0;
    else if (this.#bodyStream == null) {
      const contentLength = this.#req.headers.get("content-length");
      let remaining = contentLength ? parseInt(contentLength, 10) : 0;
      if (this.#bodyStream = Readable.fromWeb(this.#req.body, {
        highWaterMark: Number.isFinite(remaining) ? Math.min(remaining, 16384) : 16384
      }), remaining > 0 && Number.isSafeInteger(remaining))
        this.#bodyStream.on("data", (chunk) => {
          if (debug("body size known", remaining), this.push(chunk), remaining -= chunk?.byteLength ?? 0, remaining <= 0)
            this.#closeBodyStream();
        });
      else
        this.#bodyStream.on("data", (chunk) => {
          this.push(chunk);
        });
      this.#bodyStream && this.#bodyStream.on("end", () => {
        this.#closeBodyStream();
      });
    }
  }
  get aborted() {
    return this.#aborted;
  }
  abort() {
    if (this.#aborted)
      return;
    this.#aborted = !0, this.#closeBodyStream();
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
  #headers;
  headersSent = !1;
  sendDate = !0;
  req;
  #finished = !1;
  [kEndCalled] = !1;
  #fakeSocket;
  #timeoutTimer = null;
  [kAbortController] = null;
  get headers() {
    if (!this.#headers)
      return kEmptyObject;
    return this.#headers.toJSON();
  }
  get shouldKeepAlive() {
    return !0;
  }
  get chunkedEncoding() {
    return !1;
  }
  set chunkedEncoding(value) {
  }
  set shouldKeepAlive(value) {
  }
  get useChunkedEncodingByDefault() {
    return !0;
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
    return Array.from(headers.keys());
  }
  removeHeader(name) {
    if (!this.#headers)
      return;
    this.#headers.delete(name);
  }
  setHeader(name, value) {
    var headers = this.#headers ??= new Headers;
    return headers.set(name, value), this;
  }
  hasHeader(name) {
    if (!this.#headers)
      return !1;
    return this.#headers.has(name);
  }
  addTrailers(headers) {
    throw new Error("not implemented");
  }
  [kClearTimeout]() {
    if (this.#timeoutTimer)
      clearTimeout(this.#timeoutTimer), this.#timeoutTimer = null;
  }
  setTimeout(msecs, callback) {
    if (this.#timeoutTimer)
      return this;
    if (callback)
      this.on("timeout", callback);
    return this.#timeoutTimer = setTimeout(async () => {
      this.#timeoutTimer = null, this[kAbortController]?.abort(), this.emit("timeout");
    }, msecs), this;
  }
}

class ServerResponse extends Writable {
  constructor({ req, reply }) {
    super();
    this.req = req, this._reply = reply, this.sendDate = !0, this.statusCode = 200, this.headersSent = !1, this.statusMessage = void 0, this.#controller = void 0, this.#firstWrite = void 0, this._writableState.decodeStrings = !1, this.#deferred = void 0;
  }
  req;
  _reply;
  sendDate;
  statusCode;
  #headers;
  headersSent = !1;
  statusMessage;
  #controller;
  #firstWrite;
  _sent100 = !1;
  _defaultKeepAlive = !1;
  _removedConnection = !1;
  _removedContLen = !1;
  #deferred = void 0;
  #finished = !1;
  _write(chunk, encoding, callback) {
    if (!this.#firstWrite && !this.headersSent) {
      this.#firstWrite = chunk, callback();
      return;
    }
    this.#ensureReadableStreamController((controller) => {
      controller.write(chunk), callback();
    });
  }
  _writev(chunks, callback) {
    if (chunks.length === 1 && !this.headersSent && !this.#firstWrite) {
      this.#firstWrite = chunks[0].chunk, callback();
      return;
    }
    this.#ensureReadableStreamController((controller) => {
      for (let chunk of chunks)
        controller.write(chunk.chunk);
      callback();
    });
  }
  #ensureReadableStreamController(run) {
    var thisController = this.#controller;
    if (thisController)
      return run(thisController);
    this.headersSent = !0;
    var firstWrite = this.#firstWrite;
    this.#firstWrite = void 0, this._reply(new Response(new ReadableStream({
      type: "direct",
      pull: (controller) => {
        if (this.#controller = controller, firstWrite)
          controller.write(firstWrite);
        if (firstWrite = void 0, run(controller), !this.#finished)
          return new Promise((resolve) => {
            this.#deferred = resolve;
          });
      }
    }), {
      headers: this.#headers,
      status: this.statusCode,
      statusText: this.statusMessage ?? STATUS_CODES[this.statusCode]
    }));
  }
  _final(callback) {
    if (!this.headersSent) {
      var data = this.#firstWrite || "";
      this.#firstWrite = void 0, this.#finished = !0, this._reply(new Response(data, {
        headers: this.#headers,
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode]
      })), callback && callback();
      return;
    }
    this.#finished = !0, this.#ensureReadableStreamController((controller) => {
      controller.end(), callback();
      var deferred = this.#deferred;
      if (deferred)
        this.#deferred = void 0, deferred();
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
    return !0;
  }
  get chunkedEncoding() {
    return !1;
  }
  set chunkedEncoding(value) {
  }
  set shouldKeepAlive(value) {
  }
  get useChunkedEncodingByDefault() {
    return !0;
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
    return Array.from(headers.keys());
  }
  removeHeader(name) {
    if (!this.#headers)
      return;
    this.#headers.delete(name);
  }
  setHeader(name, value) {
    var headers = this.#headers ??= new Headers;
    return headers.set(name, value), this;
  }
  hasHeader(name) {
    if (!this.#headers)
      return !1;
    return this.#headers.has(name);
  }
  writeHead(statusCode, statusMessage, headers) {
    return _writeHead(statusCode, statusMessage, headers, this), this;
  }
}

class ClientRequest extends OutgoingMessage {
  #timeout;
  #res = null;
  #upgradeOrConnect = !1;
  #parser = null;
  #maxHeadersCount = null;
  #reusedSocket = !1;
  #host;
  #protocol;
  #method;
  #port;
  #useDefaultPort;
  #joinDuplicateHeaders;
  #maxHeaderSize;
  #agent = _globalAgent;
  #path;
  #socketPath;
  #body = null;
  #fetchRequest;
  #signal = null;
  [kAbortController] = null;
  #timeoutTimer = null;
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
    var body = this.#body;
    if (!body) {
      this.#body = chunk, callback();
      return;
    }
    this.#body = body + chunk, callback();
  }
  _writev(chunks, callback) {
    var body = this.#body;
    if (!body) {
      this.#body = chunks.join(), callback();
      return;
    }
    this.#body = body + chunks.join(), callback();
  }
  _final(callback) {
    if (this.#finished = !0, this[kAbortController] = new AbortController, this[kAbortController].signal.addEventListener("abort", () => {
      this[kClearTimeout]();
    }), this.#signal?.aborted)
      this[kAbortController].abort();
    var method = this.#method, body = this.#body;
    try {
      this.#fetchRequest = fetch(`${this.#protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${this.#path}`, {
        method,
        headers: this.getHeaders(),
        body: body && method !== "GET" && method !== "HEAD" && method !== "OPTIONS" ? body : void 0,
        redirect: "manual",
        verbose: Boolean(__DEBUG__),
        signal: this[kAbortController].signal
      }).then((response) => {
        var res = this.#res = new IncomingMessage(response, {
          type: "response",
          [kInternalRequest]: this
        });
        this.emit("response", res);
      }).catch((err) => {
        if (__DEBUG__)
          globalReportError(err);
        this.emit("error", err);
      }).finally(() => {
        this.#fetchRequest = null, this[kClearTimeout]();
      });
    } catch (err) {
      if (__DEBUG__)
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
        throw new TypeError(`Invalid URL: ${urlStr}`);
      }
      input = urlToHttpOptions(urlObject);
    } else if (input && typeof input === "object" && input instanceof URL)
      input = urlToHttpOptions(input);
    else
      cb = options, options = input, input = null;
    if (typeof options === "function")
      cb = options, options = input || kEmptyObject;
    else
      options = ObjectAssign(input || {}, options);
    var defaultAgent = options._defaultAgent || Agent.globalAgent;
    let protocol = options.protocol;
    if (!protocol) {
      if (options.port === 443)
        protocol = "https:";
      else
        protocol = defaultAgent.protocol || "http:";
      this.#protocol = protocol;
    }
    switch (this.#agent?.protocol) {
      case void 0:
        break;
      case "http:":
        if (protocol === "https:") {
          defaultAgent = this.#agent = getDefaultHTTPSAgent();
          break;
        }
      case "https:":
        if (protocol === "https") {
          defaultAgent = this.#agent = Agent.globalAgent;
          break;
        }
      default:
        break;
    }
    if (options.path) {
      const path = String(options.path);
      if (RegExpPrototypeExec.call(INVALID_PATH_REGEX, path) !== null)
        throw debug('Path contains unescaped characters: "%s"', path), new Error("Path contains unescaped characters");
    }
    if (protocol !== "http:" && protocol !== "https:" && protocol) {
      const expectedProtocol = defaultAgent?.protocol ?? "http:";
      throw new Error(`Protocol mismatch. Expected: ${expectedProtocol}. Got: ${protocol}`);
    }
    const defaultPort = protocol === "https:" ? 443 : 80;
    this.#port = options.port || options.defaultPort || this.#agent?.defaultPort || defaultPort, this.#useDefaultPort = this.#port === defaultPort;
    const host = this.#host = options.host = validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost";
    if (this.#socketPath = options.socketPath, options.timeout !== void 0)
      this.setTimeout(options.timeout, null);
    const signal = options.signal;
    if (signal)
      signal.addEventListener("abort", () => {
        this[kAbortController]?.abort();
      }), this.#signal = signal;
    let method = options.method;
    const methodIsString = typeof method === "string";
    if (method !== null && method !== void 0 && !methodIsString)
      throw new Error("ERR_INVALID_ARG_TYPE: options.method");
    if (methodIsString && method) {
      if (!checkIsHttpToken(method))
        throw new Error("ERR_INVALID_HTTP_TOKEN: Method");
      method = this.#method = StringPrototypeToUpperCase.call(method);
    } else
      method = this.#method = "GET";
    const _maxHeaderSize = options.maxHeaderSize;
    this.#maxHeaderSize = _maxHeaderSize;
    var _joinDuplicateHeaders = options.joinDuplicateHeaders;
    if (this.#joinDuplicateHeaders = _joinDuplicateHeaders, this.#path = options.path || "/", cb)
      this.once("response", cb);
    if (__DEBUG__ && debug(`new ClientRequest: ${this.#method} ${this.#protocol}//${this.#host}:${this.#port}${this.#path}`), this.#finished = !1, this.#res = null, this.#upgradeOrConnect = !1, this.#parser = null, this.#maxHeadersCount = null, this.#reusedSocket = !1, this.#host = host, this.#protocol = protocol, this.#timeoutTimer = null, !ArrayIsArray(headers)) {
      var headers = options.headers;
      if (headers)
        for (let key in headers)
          this.setHeader(key, headers[key]);
      var auth = options.auth;
      if (auth && !this.getHeader("Authorization"))
        this.setHeader("Authorization", "Basic " + Buffer.from(auth).toString("base64"));
    }
    var optsWithoutSignal = options;
    if (optsWithoutSignal.signal)
      optsWithoutSignal = ObjectAssign({}, options), delete optsWithoutSignal.signal;
    this.#options = optsWithoutSignal;
    var timeout = options.timeout;
    if (timeout)
      this.setTimeout(timeout);
  }
  setSocketKeepAlive(enable = !0, initialDelay = 0) {
    __DEBUG__ && debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  }
  setNoDelay(noDelay = !0) {
    __DEBUG__ && debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "WARN: ClientRequest.setNoDelay is a no-op");
  }
  [kClearTimeout]() {
    if (this.#timeoutTimer)
      clearTimeout(this.#timeoutTimer), this.#timeoutTimer = null;
  }
  setTimeout(msecs, callback) {
    if (this.#timeoutTimer)
      return this;
    if (callback)
      this.on("timeout", callback);
    return this.#timeoutTimer = setTimeout(async () => {
      this.#timeoutTimer = null, this[kAbortController]?.abort(), this.emit("timeout");
    }, msecs), this;
  }
}
var tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/, METHODS = [
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
], STATUS_CODES = {
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
}, defaultObject = {
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
  setMaxIdleHTTPParsers(max) {
    debug("WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.\n", "setMaxIdleHTTPParsers() is a no-op");
  },
  get globalAgent() {
    return _globalAgent ??= new Agent;
  },
  set globalAgent(agent) {
  },
  [Symbol.for("CommonJS")]: 0
}, http_default = defaultObject;
export {
  request,
  get,
  http_default as default,
  createServer,
  ServerResponse,
  Server,
  STATUS_CODES,
  OutgoingMessage,
  METHODS,
  IncomingMessage,
  ClientRequest,
  Agent
};

//# debugId=BB02ECF6CBA5ED8A64756e2164756e21
