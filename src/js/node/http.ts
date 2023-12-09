// Hardcoded module "node:http"
const EventEmitter = require("node:events");
const { isTypedArray } = require("node:util/types");
const { Duplex, Readable, Writable } = require("node:stream");
const { getHeader, setHeader, assignHeaders: assignHeadersFast } = $lazy("http");

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
const ArrayIsArray = Array.isArray;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

var _defaultHTTPSAgent;
var kInternalRequest = Symbol("kInternalRequest");
const kInternalSocketData = Symbol.for("::bunternal::");

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
  [kInternalSocketData]!: [import("bun").Server, OutgoingMessage, Request];
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

  ref() {}

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

  unref() {}

  _write(chunk, encoding, callback) {}
};

function createServer(options, callback) {
  return new Server(options, callback);
}

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
    return Infinity;
  }

  constructor(options = kEmptyObject) {
    super();
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

  createConnection() {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
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
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
  }

  createSocket(req, options, cb) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
    cb(null, (this.#fakeSocket ??= new FakeSocket()));
  }

  removeSocket() {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.removeSocket is a no-op");
  }

  keepSocketAlive() {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.keepSocketAlive is a no-op");

    return true;
  }

  reuseSocket() {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.reuseSocket is a no-op");
  }

  destroy() {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.destroy is a no-op");
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

  close(optionalCallback?) {
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
    let isHTTPS = false;

    try {
      const tls = this.#tls;
      if (tls) {
        this.serverName = tls.serverName || host || "localhost";
      }
      this.#server = Bun.serve<any>({
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
        },
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
      isHTTPS = this.#server.protocol === "https";
      setTimeout(emitListeningNextTick, 1, this, onListen, null, this.#server.hostname, this.#server.port);
    } catch (err) {
      server.emit("error", err);
    }

    return this;
  }
  setTimeout(msecs, callback) {}
}

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
function destroyBodyStreamNT(bodyStream) {
  bodyStream.destroy();
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

class IncomingMessage extends Readable {
  method: string | null = null;
  complete: boolean;

  constructor(req, defaultIncomingOpts) {
    super();

    var { type = "request", [kInternalRequest]: nodeReq } = defaultIncomingOpts || {};

    this.#req = req;
    this.#type = type;

    this.#bodyStream = undefined;

    this.req = nodeReq;

    if (!assignHeaders(this, req)) {
      this.#fakeSocket = req;
      const reqUrl = String(req?.url || "");
      this.url = reqUrl;
    }

    if (isNextIncomingMessageHTTPS) {
      // Creating a new Duplex is expensive.
      // We can skip it if the request is not HTTPS.
      const socket = new FakeSocket();
      this.#fakeSocket = socket;
      socket.encrypted = true;
      isNextIncomingMessageHTTPS = false;
    }

    this.#noBody =
      type === "request" // TODO: Add logic for checking for body on response
        ? requestHasNoBody(this.method, this)
        : false;

    this.complete = !!this.#noBody;
  }

  headers;
  rawHeaders;
  _consuming = false;
  _dumped = false;
  #bodyStream: ReadableStreamDefaultReader | undefined;
  #fakeSocket: FakeSocket | undefined = undefined;
  #noBody = false;
  #aborted = false;
  #req;
  url;
  #type;

  _construct(callback) {
    // TODO: streaming
    if (this.#type === "response" || this.#noBody) {
      callback();
      return;
    }

    const contentLength = this.headers["content-length"];
    const length = contentLength ? parseInt(contentLength, 10) : 0;
    if (length === 0) {
      this.#noBody = true;
      callback();
      return;
    }

    callback();
  }

  async #consumeStream(reader: ReadableStreamDefaultReader) {
    while (true) {
      var { done, value } = await reader.readMany();
      if (this.#aborted) return;
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
      const reader = this.#req.body?.getReader() as ReadableStreamDefaultReader;
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
    if (this.#aborted) return;
    this.#aborted = true;
    var bodyStream = this.#bodyStream;
    if (!bodyStream) return;
    bodyStream.cancel();
    this.complete = true;
    this.#bodyStream = undefined;
    this.push(null);
  }

  get connection() {
    return (this.#fakeSocket ??= new FakeSocket());
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
    $debug("This type of response MUST NOT have a body. " + "Ignoring write() calls.");
    process.nextTick(callback);
    return true;
  }

  // if (!fromEnd && msg.socket && !msg.socket.writableCorked) {
  //   msg.socket.cork();
  //   process.nextTick(connectionCorkNT, msg.socket);
  // }

  return true;
}

class OutgoingMessage extends Writable {
  #headers;
  headersSent = false;
  sendDate = true;
  req;
  timeout;

  #finished = false;
  [kEndCalled] = false;

  #fakeSocket;
  #timeoutTimer?: Timer;
  [kAbortController]: AbortController | null = null;

  // Express "compress" package uses this
  _implicitHeader() {}

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
      this.removeAllListeners("timeout");
      this.#timeoutTimer = undefined;
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

function emitCloseNT(self) {
  if (!self._closed) {
    self.destroyed = true;
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
class ServerResponse extends OutgoingMessage {
  declare _writableState: any;

  constructor(req, reply) {
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

    // this is matching node's behaviour
    // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
    if (req.method === "HEAD") this._hasBody = false;
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
  #deferred: (() => void) | undefined = undefined;
  #finished = false;
  // Express "compress" package uses this
  _implicitHeader() {
    // @ts-ignore
    this.writeHead(this.statusCode);
  }

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

  #drainHeadersIfObservable() {
    if (this._implicitHeader === OriginalImplicitHeadFn && this.writeHead === OriginalWriteHeadFn) {
      return;
    }

    this._implicitHeader();
  }

  _final(callback) {
    if (!this.headersSent) {
      var data = this.#firstWrite || "";
      this.#firstWrite = undefined;
      this.#finished = true;
      this.#drainHeadersIfObservable();
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
    if (socket._httpMessage) {
      throw new ERR_HTTP_SOCKET_ASSIGNED();
    }
    socket._httpMessage = this;
    socket.on("close", onServerResponseClose);
    this.socket = socket;
    this.emit("socket", socket);
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
    setHeader(headers, name, value);
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
    this[kAbortController] = new AbortController();
    this[kAbortController].signal.addEventListener("abort", () => {
      this[kClearTimeout]();
    });
    if (this.#signal?.aborted) {
      this[kAbortController].abort();
    }

    var method = this.#method,
      body = this.#bodyChunks?.length === 1 ? this.#bodyChunks[0] : Buffer.concat(this.#bodyChunks || []);

    let url: string;
    let proxy: string | undefined;
    if (this.#path.startsWith("http://") || this.#path.startsWith("https://")) {
      url = this.#path;
      proxy = `${this.#protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}`;
    } else {
      url = `${this.#protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${this.#path}`;
    }
    try {
      //@ts-ignore
      this.#fetchRequest = fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body && method !== "GET" && method !== "HEAD" && method !== "OPTIONS" ? body : undefined,
        redirect: "manual",
        verbose: !!$debug,
        signal: this[kAbortController].signal,
        proxy: proxy,

        // Timeouts are handled via this.setTimeout.
        timeout: false,
        // Disable auto gzip/deflate
        decompress: false,
      })
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
      callback();
    }
  }

  get aborted() {
    return this.#signal?.aborted || !!this[kAbortController]?.signal.aborted;
  }

  abort() {
    if (this.aborted) return;
    this[kAbortController]!.abort();
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

    var timeout = options.timeout;
    if (timeout !== undefined && timeout !== 0) {
      this.setTimeout(timeout, undefined);
    }

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

    var { signal: _signal, ...optsWithoutSignal } = options;
    this.#options = optsWithoutSignal;
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
