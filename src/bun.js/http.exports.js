const { EventEmitter } = import.meta.require("node:events");
const { Readable, Writable } = import.meta.require("node:stream");
export function createServer(options, callback) {
  return new Server(options, callback);
}

export class Server extends EventEmitter {
  #server;
  #options;

  constructor(options, callback) {
    super();

    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if (options == null || typeof options === "object") {
      options = { ...options };
    } else {
      throw new Error("bun-http-polyfill: invalid arguments");
    }

    this.#options = options;
    if (callback) this.on("request", callback);
  }

  close() {
    if (this.#server) {
      this.emit("close");
      this.#server.stop();
      this.#server = undefined;
    }
  }

  listen(...args) {
    const server = this;
    const [options, listening_cb] = _normalizeArgs(args);
    const ResponseClass = this.#options.ServerResponse || ServerResponse;
    const RequestClass = this.#options.IncomingMessage || IncomingMessage;

    try {
      this.#server = Bun.serve({
        port: options.port,
        hostname: options.host,

        fetch(req) {
          var pendingResponse;
          var pendingError;
          var rejectFunction, resolveFunction;
          var reject = (err) => {
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

          http_req.once("error", (err) => reject(err));
          http_res.once("error", (err) => reject(err));
          server.emit("request", http_req, http_res);

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

      if (listening_cb) listening_cb();
    } catch (err) {
      this.emit(
        "error",
        new Error(`bun-http-polyfill: Bun.serve failed: ${err.message}`)
      );
    }
  }
}

function assignHeaders(object, req) {
  var headers = req.headers.toJSON();
  const rawHeaders = new Array(req.headers.count * 2);
  var i = 0;
  for (const key in headers) {
    rawHeaders[i++] = key;
    rawHeaders[i++] = headers[key];
  }
  object.headers = headers;
  object.rawHeaders = rawHeaders;
}

export class IncomingMessage extends Readable {
  constructor(req) {
    const method = req.method;

    super();

    const url = new URL(req.url);

    this._no_body =
      "GET" === method ||
      "HEAD" === method ||
      "TRACE" === method ||
      "CONNECT" === method ||
      "OPTIONS" === method ||
      (parseInt(req.headers.get("Content-Length") || "") || 0) === 0;

    this._req = req;
    this.method = method;
    this.complete = !!this._no_body;
    this._body_offset = 0;

    this._body = undefined;
    this._socket = undefined;

    this.url = url.pathname;
    assignHeaders(this, req);
  }

  headers;
  rawHeaders;
  _consuming = false;
  _dumped = false;
  _body;
  _body_offset;
  _socket;
  _no_body;
  _req;
  url;

  _construct(callback) {
    // TODO: streaming
    if (this._no_body) {
      callback();
      return;
    }

    (async () => {
      try {
        this._body = Buffer.from(await this._req.arrayBuffer());

        callback();
      } catch (err) {
        callback(err);
      }
    })();
  }

  _read(size) {
    if (this._no_body) {
      this.push(null);
      this.complete = true;
    } else {
      if (this._body_offset >= this._body.length) {
        this.push(null);
        this.complete = true;
      } else {
        this.push(
          this._body.subarray(this._body_offset, (this._body_offset += size))
        );
      }
    }
  }

  get aborted() {
    return false;
  }

  abort() {
    throw new Error("not implemented");
  }

  get connection() {
    throw new Error("not implemented");
  }

  get statusCode() {
    throw new Error("not implemented");
  }

  get statusMessage() {
    throw new Error("not implemented");
  }

  get httpVersion() {
    return 1.1;
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
    return Object.create(null);
  }

  get socket() {
    var _socket = this._socket;
    if (_socket) return _socket;

    this._socket = _socket = new EventEmitter();
    this.on("end", () => _socket.emit("end"));
    this.on("close", () => _socket.emit("close"));

    return _socket;
  }

  setTimeout(msecs, callback) {
    throw new Error("not implemented");
  }
}

export class ServerResponse extends Writable {
  constructor({ req, reply }) {
    super();
    this.req = req;
    this._reply = reply;
    this.sendDate = true;
    this.statusCode = 200;
    this.#headers = new Headers();
    this.headersSent = false;
    this.statusMessage = undefined;
    this.#controller = undefined;
    this.#firstWrite = undefined;
    this._writableState.decodeStrings = false;
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

  #fakeSocket;

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
    if (thisController) return run(thisController);
    this.headersSent = true;
    var firstWrite = this.#firstWrite;
    this.#firstWrite = undefined;
    this._reply(
      new Response(
        new ReadableStream({
          type: "direct",
          pull: (controller) => {
            this.#controller = controller;
            if (firstWrite) controller.write(firstWrite);
            firstWrite = undefined;
            run(controller);
          },
        }),
        {
          headers: this.#headers,
          status: this.statusCode,
          statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
        }
      )
    );
  }

  _final(callback) {
    if (!this.headersSent) {
      var data = this.#firstWrite || "";
      this.#firstWrite = undefined;
      this._reply(
        new Response(data, {
          headers: this.#headers,
          status: this.statusCode,
          statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
        })
      );
      callback && callback();
      return;
    }

    this.#ensureReadableStreamController((controller) => {
      controller.close();
      callback();
    });
  }

  get socket() {
    if (!this.#fakeSocket) {
      this.#fakeSocket = Object.create(this);
    }

    return this.#fakeSocket;
  }

  get connection() {
    throw new Error("not implemented");
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

  flushHeaders() {}

  removeHeader(name) {
    var headers = this.#headers;
    headers.delete(name);
  }

  getHeader(name) {
    var headers = this.#headers;
    return headers.get(name);
  }

  hasHeader(name) {
    var headers = this.#headers;
    return headers.has(name);
  }

  getHeaderNames() {
    var headers = this.#headers;
    return Array.from(headers.keys());
  }

  setHeader(name, value) {
    var headers = this.#headers;

    headers.set(name, value);

    return this;
  }

  writeHead(statusCode, statusMessage, headers) {
    _writeHead(statusCode, statusMessage, headers, this);

    return this;
  }

  getHeaders() {
    if (!this.#headers) return {};
    return this.#headers.toJSON();
  }
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
    if (!response.statusMessage)
      response.statusMessage = STATUS_CODES[statusCode] || "unknown";
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
var defaultObject = {
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
};

var wrapper =
  (0,
  function () {
    return defaultObject;
  });

wrapper[Symbol.for("CommonJS")] = true;
export default wrapper;
