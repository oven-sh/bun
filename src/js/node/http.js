// @module "node:http"
const { EventEmitter } = import.meta.require("node:events");
const { isIPv6 } = import.meta.require("node:net");
const { Readable, Writable, Duplex } = import.meta.require("node:stream");
const { URL } = import.meta.require("node:url");
const { newArrayWithSize, String, Object, Array } = import.meta.primordials;
const { isTypedArray } = import.meta.require("util/types");

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const fetch = Bun.fetch;
const nop = () => {};

const __DEBUG__ = process.env.__DEBUG__;
const debug = __DEBUG__ ? (...args) => console.log("node:http", ...args) : nop;

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
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeIndexOf = String.prototype.indexOf;
const ArrayIsArray = Array.isArray;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

var _globalAgent;
var _defaultHTTPSAgent;
var kInternalRequest = Symbol("kInternalRequest");
var kInternalSocketData = Symbol.for("::bunternal::");

const kEmptyBuffer = Buffer.alloc(0);

function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || obj instanceof ArrayBuffer || obj instanceof Blob) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      if (typeof obj !== "string" && !isTypedArray(obj) && !(obj instanceof ArrayBuffer) && !(obj instanceof Blob))
        return false;
    }
    return true;
  }
}

function getHeader(headers, name) {
  if (!headers) return;
  const result = headers.get(name);
  return result == null ? undefined : result;
}

var FakeSocket = class Socket extends Duplex {
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  remoteAddress = null;
  localAddress = "127.0.0.1";
  remotePort;
  timeout = 0;

  isServer = false;

  address() {
    return {
      address: this.localAddress,
      family: this.localFamily,
      port: this.localPort,
    };
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

  ref() {}

  get remoteFamily() {
    return "IPv4";
  }

  resetAndDestroy() {}

  setKeepAlive(enable = false, initialDelay = 0) {}

  setNoDelay(noDelay = true) {
    return this;
  }

  setTimeout(timeout, callback) {
    return this;
  }

  unref() {}

  _write(chunk, encoding, callback) {}
};

export function createServer(options, callback) {
  return new Server(options, callback);
}

export class Agent extends EventEmitter {
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
    return (_globalAgent ??= new Agent());
  }

  static get defaultMaxSockets() {
    return Infinity;
  }

  constructor(options = kEmptyObject) {
    super();
    this.#options = options = { ...options, path: null };
    if (options.noDelay === undefined) options.noDelay = true;

    // Don't confuse net and make it think that we're connecting to a pipe
    this.#requests = kEmptyObject;
    this.#sockets = kEmptyObject;
    this.#freeSockets = kEmptyObject;

    this.#keepAliveMsecs = options.keepAliveMsecs || 1000;
    this.#keepAlive = options.keepAlive || false;
    this.#maxSockets = options.maxSockets || Agent.defaultMaxSockets;
    this.#maxFreeSockets = options.maxFreeSockets || 256;
    this.#scheduling = options.scheduling || "lifo";
    this.#maxTotalSockets = options.maxTotalSockets;
    this.#totalSocketCount = 0;
    this.#defaultPort = options.defaultPort || 80;
    this.#protocol = options.protocol || "http:";
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
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
    return (this.#fakeSocket ??= new FakeSocket());
  }

  getName(options = kEmptyObject) {
    let name = `http:${options.host || "localhost"}:`;
    if (options.port) name += options.port;
    name += ":";
    if (options.localAddress) name += options.localAddress;
    // Pacify parallel/test-http-agent-getname by only appending
    // the ':' when options.family is set.
    if (options.family === 4 || options.family === 6) name += `:${options.family}`;
    if (options.socketPath) name += `:${options.socketPath}`;
    return name;
  }

  addRequest() {
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
  }

  createSocket(req, options, cb) {
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
    cb(null, (this.#fakeSocket ??= new FakeSocket()));
  }

  removeSocket() {
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.removeSocket is a no-op");
  }

  keepSocketAlive() {
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.keepSocketAlive is a no-op");

    return true;
  }

  reuseSocket() {
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.reuseSocket is a no-op");
  }

  destroy() {
    debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.destroy is a no-op");
  }
}
function emitListeningNextTick(self, onListen, err, hostname, port) {
  if (typeof onListen === "function") {
    try {
      onListen(err, hostname, port);
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

export class Server extends EventEmitter {
  #server;
  #options;
  #tls;
  #is_tls = false;
  listening = false;

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
          throw new TypeError(
            "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.#is_tls = true;
      }
      let cert = options.cert;
      if (cert) {
        if (!isValidTLSArray(cert)) {
          throw new TypeError(
            "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.#is_tls = true;
      }

      let ca = options.ca;
      if (ca) {
        if (!isValidTLSArray(ca)) {
          throw new TypeError(
            "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
          );
        }
        this.#is_tls = true;
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

      if (this.#is_tls) {
        this.#tls = {
          serverName,
          key: key,
          cert: cert,
          ca: ca,
          passphrase: passphrase,
          secureOptions: secureOptions,
        };
      } else {
        this.#tls = null;
      }
    } else {
      throw new Error("bun-http-polyfill: invalid arguments");
    }

    this.#options = options;

    if (callback) this.on("request", callback);
  }

  closeAllConnections() {
    const server = this.#server;
    if (!server) {
      return;
    }
    this.#server = undefined;
    server.stop(true);
    this.emit("close");
  }

  closeIdleConnections() {
    // not actually implemented
  }

  close(optionalCallback) {
    const server = this.#server;
    if (!server) {
      if (typeof optionalCallback === "function")
        process.nextTick(optionalCallback, new Error("Server is not running"));
      return;
    }
    this.#server = undefined;
    if (typeof optionalCallback === "function") this.once("close", optionalCallback);
    server.stop();
    this.emit("close");
  }

  address() {
    if (!this.#server) return null;

    const address = this.#server.hostname;
    return {
      address,
      family: isIPv6(address) ? "IPv6" : "IPv4",
      port: this.#server.port,
    };
  }

  listen(port, host, backlog, onListen) {
    const server = this;
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
        },
        fetch(req, _server) {
          var pendingResponse;
          var pendingError;
          var rejectFunction, resolveFunction;
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

          const http_req = new RequestClass(req);
          const http_res = new ResponseClass({ reply, req: http_req });

          http_req.once("error", err => reject(err));
          http_res.once("error", err => reject(err));

          const upgrade = req.headers.get("upgrade");
          if (upgrade) {
            const socket = new FakeSocket();
            socket[kInternalSocketData] = [_server, http_res, req];
            server.emit("upgrade", http_req, socket, kEmptyBuffer);
          } else {
            server.emit("request", http_req, http_res);
          }

          if (pendingError) {
            throw pendingError;
          }

          if (pendingResponse) {
            return pendingResponse;
          }

          return new Promise((resolve, reject) => {
            resolveFunction = resolve;
            rejectFunction = reject;
          });
        },
      });
      setTimeout(emitListeningNextTick, 1, this, onListen, null, this.#server.hostname, this.#server.port);
    } catch (err) {
      setTimeout(emitListeningNextTick, 1, this, onListen, err);
    }

    return this;
  }
  setTimeout(msecs, callback) {}
}

function assignHeaders(object, req) {
  var headers = req.headers.toJSON();
  const rawHeaders = newArrayWithSize(req.headers.count * 2);
  var i = 0;
  for (const key in headers) {
    rawHeaders[i++] = key;
    rawHeaders[i++] = headers[key];
  }
  object.headers = headers;
  object.rawHeaders = rawHeaders;
}
function destroyBodyStreamNT(bodyStream) {
  bodyStream.destroy();
}

var defaultIncomingOpts = { type: "request" };

function getDefaultHTTPSAgent() {
  return (_defaultHTTPSAgent ??= new Agent({ defaultPort: 443, protocol: "https:" }));
}

export class IncomingMessage extends Readable {
  constructor(req, defaultIncomingOpts) {
    const method = req.method;

    super();

    const url = new URL(req.url);

    var { type = "request", [kInternalRequest]: nodeReq } = defaultIncomingOpts || {};

    this.#noBody =
      type === "request" // TODO: Add logic for checking for body on response
        ? "GET" === method ||
          "HEAD" === method ||
          "TRACE" === method ||
          "CONNECT" === method ||
          "OPTIONS" === method ||
          (parseInt(req.headers.get("Content-Length") || "") || 0) === 0
        : false;

    this.#req = req;
    this.method = method;
    this.#type = type;
    this.complete = !!this.#noBody;

    this.#bodyStream = null;
    const socket = new FakeSocket();
    socket.remoteAddress = url.hostname;
    socket.remotePort = url.port;
    this.#fakeSocket = socket;

    this.url = url.pathname + url.search;
    this.#nodeReq = nodeReq;
    assignHeaders(this, req);
  }

  headers;
  rawHeaders;
  _consuming = false;
  _dumped = false;
  #bodyStream = null;
  #fakeSocket = undefined;
  #noBody = false;
  #aborted = false;
  #req;
  url;
  #type;
  #nodeReq;

  get req() {
    return this.#nodeReq;
  }

  _construct(callback) {
    // TODO: streaming
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

  #closeBodyStream() {
    debug("closeBodyStream()");
    var bodyStream = this.#bodyStream;
    if (bodyStream == null) return;
    this.complete = true;
    this.#bodyStream = undefined;
    this.push(null);
    // process.nextTick(destroyBodyStreamNT, bodyStream);
  }

  _read(size) {
    if (this.#noBody) {
      this.push(null);
      this.complete = true;
    } else if (this.#bodyStream == null) {
      const contentLength = this.#req.headers.get("content-length");
      let remaining = contentLength ? parseInt(contentLength, 10) : 0;
      this.#bodyStream = Readable.fromWeb(this.#req.body, {
        highWaterMark: Number.isFinite(remaining) ? Math.min(remaining, 16384) : 16384,
      });

      const isBodySizeKnown = remaining > 0 && Number.isSafeInteger(remaining);

      if (isBodySizeKnown) {
        this.#bodyStream.on("data", chunk => {
          debug("body size known", remaining);
          this.push(chunk);
          // when we are streaming a known body size, automatically close the stream when we have read enough
          remaining -= chunk?.byteLength ?? 0;
          if (remaining <= 0) {
            this.#closeBodyStream();
          }
        });
      } else {
        this.#bodyStream.on("data", chunk => {
          this.push(chunk);
        });
      }

      // this can be closed by the time we get here if enough data was synchronously available
      this.#bodyStream &&
        this.#bodyStream.on("end", () => {
          this.#closeBodyStream();
        });
    } else {
      // this.#bodyStream.read(size);
    }
  }

  get aborted() {
    return this.#aborted;
  }

  abort() {
    if (this.#aborted) return;
    this.#aborted = true;

    this.#closeBodyStream();
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
    return (this.#fakeSocket ??= new FakeSocket());
  }

  set socket(val) {
    this.#fakeSocket = val;
  }

  setTimeout(msecs, callback) {
    throw new Error("not implemented");
  }
}

function emitErrorNt(msg, err, callback) {
  callback(err);
  if (typeof msg.emit === "function" && !msg._closed) {
    msg.emit("error", err);
  }
}

function onError(self, err, cb) {
  process.nextTick(() => emitErrorNt(self, err, cb));
}

function write_(msg, chunk, encoding, callback, fromEnd) {
  if (typeof callback !== "function") callback = nop;

  let len;
  if (chunk === null) {
    // throw new ERR_STREAM_NULL_VALUES();
    throw new Error("ERR_STREAM_NULL_VALUES");
  } else if (typeof chunk === "string") {
    len = Buffer.byteLength(chunk, encoding);
  } else {
    throw new Error("Invalid arg type for chunk");
    // throw new ERR_INVALID_ARG_TYPE(
    //   "chunk",
    //   ["string", "Buffer", "Uint8Array"],
    //   chunk,
    // );
  }

  let err;
  if (msg.finished) {
    // err = new ERR_STREAM_WRITE_AFTER_END();
    err = new Error("ERR_STREAM_WRITE_AFTER_END");
  } else if (msg.destroyed) {
    // err = new ERR_STREAM_DESTROYED("write");
    err = new Error("ERR_STREAM_DESTROYED");
  }

  if (err) {
    if (!msg.destroyed) {
      onError(msg, err, callback);
    } else {
      process.nextTick(callback, err);
    }
    return false;
  }

  if (!msg._header) {
    if (fromEnd) {
      msg._contentLength = len;
    }
    // msg._implicitHeader();
  }

  if (!msg._hasBody) {
    debug("This type of response MUST NOT have a body. " + "Ignoring write() calls.");
    process.nextTick(callback);
    return true;
  }

  // if (!fromEnd && msg.socket && !msg.socket.writableCorked) {
  //   msg.socket.cork();
  //   process.nextTick(connectionCorkNT, msg.socket);
  // }

  return true;
}

export class OutgoingMessage extends Writable {
  #headers;
  headersSent = false;
  sendDate = true;
  req;

  #finished = false;
  [kEndCalled] = false;

  #fakeSocket;
  #timeoutTimer = null;
  [kAbortController] = null;

  // For compat with IncomingRequest
  get headers() {
    if (!this.#headers) return kEmptyObject;
    return this.#headers.toJSON();
  }

  get shouldKeepAlive() {
    return true;
  }

  get chunkedEncoding() {
    return false;
  }

  set chunkedEncoding(value) {
    // throw new Error('not implemented');
  }

  set shouldKeepAlive(value) {
    // throw new Error('not implemented');
  }

  get useChunkedEncodingByDefault() {
    return true;
  }

  set useChunkedEncodingByDefault(value) {
    // throw new Error('not implemented');
  }

  get socket() {
    return (this.#fakeSocket ??= new FakeSocket());
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
    var headers = (this.#headers ??= new Headers());
    headers.append(name, value);
  }

  flushHeaders() {}

  getHeader(name) {
    return getHeader(this.#headers, name);
  }

  getHeaders() {
    if (!this.#headers) return kEmptyObject;
    return this.#headers.toJSON();
  }

  getHeaderNames() {
    var headers = this.#headers;
    if (!headers) return [];
    return Array.from(headers.keys());
  }

  removeHeader(name) {
    if (!this.#headers) return;
    this.#headers.delete(name);
  }

  setHeader(name, value) {
    var headers = (this.#headers ??= new Headers());
    headers.set(name, value);
    return this;
  }

  hasHeader(name) {
    if (!this.#headers) return false;
    return this.#headers.has(name);
  }

  addTrailers(headers) {
    throw new Error("not implemented");
  }

  [kClearTimeout]() {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = null;
    }
  }

  setTimeout(msecs, callback) {
    if (this.#timeoutTimer) return this;
    if (callback) {
      this.on("timeout", callback);
    }

    this.#timeoutTimer = setTimeout(async () => {
      this.#timeoutTimer = null;
      this[kAbortController]?.abort();
      this.emit("timeout");
    }, msecs);

    return this;
  }
}

export class ServerResponse extends Writable {
  constructor({ req, reply }) {
    super();
    this.req = req;
    this._reply = reply;
    this.sendDate = true;
    this.statusCode = 200;
    this.headersSent = false;
    this.statusMessage = undefined;
    this.#controller = undefined;
    this.#firstWrite = undefined;
    this._writableState.decodeStrings = false;
    this.#deferred = undefined;
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
  #deferred = undefined;
  #finished = false;

  _write(chunk, encoding, callback) {
    if (!this.#firstWrite && !this.headersSent) {
      this.#firstWrite = chunk;
      callback();
      return;
    }

    this.#ensureReadableStreamController(controller => {
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

    this.#ensureReadableStreamController(controller => {
      for (const chunk of chunks) {
        controller.write(chunk.chunk);
      }

      callback();
    });
  }

  #ensureReadableStreamController(run) {
    var thisController = this.#controller;
    if (thisController) return run(thisController);
    this.headersSent = true;
    var firstWrite = this.#firstWrite;
    this.#firstWrite = undefined;
    this._reply(
      new Response(
        new ReadableStream({
          type: "direct",
          pull: controller => {
            this.#controller = controller;
            if (firstWrite) controller.write(firstWrite);
            firstWrite = undefined;
            run(controller);
            if (!this.#finished) {
              return new Promise(resolve => {
                this.#deferred = resolve;
              });
            }
          },
        }),
        {
          headers: this.#headers,
          status: this.statusCode,
          statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
        },
      ),
    );
  }

  _final(callback) {
    if (!this.headersSent) {
      var data = this.#firstWrite || "";
      this.#firstWrite = undefined;
      this.#finished = true;
      this._reply(
        new Response(data, {
          headers: this.#headers,
          status: this.statusCode,
          statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
        }),
      );
      callback && callback();
      return;
    }

    this.#finished = true;
    this.#ensureReadableStreamController(controller => {
      controller.end();

      callback();
      var deferred = this.#deferred;
      if (deferred) {
        this.#deferred = undefined;
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
    // throw new Error('not implemented');
  }

  set shouldKeepAlive(value) {
    // throw new Error('not implemented');
  }

  get useChunkedEncodingByDefault() {
    return true;
  }

  set useChunkedEncodingByDefault(value) {
    // throw new Error('not implemented');
  }

  appendHeader(name, value) {
    var headers = (this.#headers ??= new Headers());
    headers.append(name, value);
  }

  flushHeaders() {}

  getHeader(name) {
    return getHeader(this.#headers, name);
  }

  getHeaders() {
    var headers = this.#headers;
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  }

  getHeaderNames() {
    var headers = this.#headers;
    if (!headers) return [];
    return Array.from(headers.keys());
  }

  removeHeader(name) {
    if (!this.#headers) return;
    this.#headers.delete(name);
  }

  setHeader(name, value) {
    var headers = (this.#headers ??= new Headers());
    headers.set(name, value);
    return this;
  }

  hasHeader(name) {
    if (!this.#headers) return false;
    return this.#headers.has(name);
  }

  writeHead(statusCode, statusMessage, headers) {
    _writeHead(statusCode, statusMessage, headers, this);

    return this;
  }
}

export class ClientRequest extends OutgoingMessage {
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
      this.#body = chunk;
      callback();
      return;
    }
    this.#body = body + chunk;
    callback();
  }

  _writev(chunks, callback) {
    var body = this.#body;
    if (!body) {
      this.#body = chunks.join();
      callback();
      return;
    }
    this.#body = body + chunks.join();
    callback();
  }

  _final(callback) {
    this.#finished = true;
    this[kAbortController] = new AbortController();
    this[kAbortController].signal.addEventListener("abort", () => {
      this[kClearTimeout]();
    });
    if (this.#signal?.aborted) {
      this[kAbortController].abort();
    }

    var method = this.#method,
      body = this.#body;

    try {
      this.#fetchRequest = fetch(
        `${this.#protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${this.#path}`,
        {
          method,
          headers: this.getHeaders(),
          body: body && method !== "GET" && method !== "HEAD" && method !== "OPTIONS" ? body : undefined,
          redirect: "manual",
          verbose: Boolean(__DEBUG__),
          signal: this[kAbortController].signal,
        },
      )
        .then(response => {
          var res = (this.#res = new IncomingMessage(response, {
            type: "response",
            [kInternalRequest]: this,
          }));
          this.emit("response", res);
        })
        .catch(err => {
          if (__DEBUG__) globalReportError(err);
          this.emit("error", err);
        })
        .finally(() => {
          this.#fetchRequest = null;
          this[kClearTimeout]();
        });
    } catch (err) {
      if (__DEBUG__) globalReportError(err);
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
    this[kAbortController].abort();
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
      this.#protocol = protocol;
    }

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
      if (RegExpPrototypeExec.call(INVALID_PATH_REGEX, path) !== null) {
        debug('Path contains unescaped characters: "%s"', path);
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

    if (options.timeout !== undefined) this.setTimeout(options.timeout, null);

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
      method = this.#method = StringPrototypeToUpperCase.call(method);
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

    this.#path = options.path || "/";
    if (cb) {
      this.once("response", cb);
    }

    __DEBUG__ &&
      debug(`new ClientRequest: ${this.#method} ${this.#protocol}//${this.#host}:${this.#port}${this.#path}`);

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
    this.#timeoutTimer = null;
    const headersArray = ArrayIsArray(headers);
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
      //   const posColon = StringPrototypeIndexOf.call(hostHeader, ":");
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

    var optsWithoutSignal = options;
    if (optsWithoutSignal.signal) {
      optsWithoutSignal = ObjectAssign({}, options);
      delete optsWithoutSignal.signal;
    }
    this.#options = optsWithoutSignal;

    var timeout = options.timeout;
    if (timeout) {
      this.setTimeout(timeout);
    }
  }

  setSocketKeepAlive(enable = true, initialDelay = 0) {
    __DEBUG__ && debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  }

  setNoDelay(noDelay = true) {
    __DEBUG__ && debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setNoDelay is a no-op");
  }
  [kClearTimeout]() {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = null;
    }
  }

  setTimeout(msecs, callback) {
    if (this.#timeoutTimer) return this;
    if (callback) {
      this.on("timeout", callback);
    }

    this.#timeoutTimer = setTimeout(async () => {
      this.#timeoutTimer = null;
      this[kAbortController]?.abort();
      this.emit("timeout");
    }, msecs);

    return this;
  }
}

function urlToHttpOptions(url) {
  var { protocol, hostname, hash, search, pathname, href, port, username, password } = url;
  return {
    protocol,
    hostname:
      typeof hostname === "string" && StringPrototypeStartsWith.call(hostname, "[")
        ? StringPrototypeSlice.call(hostname, 1, -1)
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
  return RegExpPrototypeExec.call(tokenRegExp, val) !== null;
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

export const METHODS = [
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

export const STATUS_CODES = {
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
  let options = {};
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
}

/**
 * Makes an HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
export function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

/**
 * Makes a `GET` HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
export function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

var defaultObject = {
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
  // validateHeaderName,
  // validateHeaderValue,
  setMaxIdleHTTPParsers(max) {
    debug(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  get globalAgent() {
    return (_globalAgent ??= new Agent());
  },
  set globalAgent(agent) {},
  [Symbol.for("CommonJS")]: 0,
};

export default defaultObject;
