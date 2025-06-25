const EventEmitter: typeof import("node:events").EventEmitter = require("node:events");
const { Duplex, Stream } = require("node:stream");
const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
const { validateObject, validateLinkHeaderValue, validateBoolean, validateInteger } = require("internal/validators");

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
  setServerCustomOptions,
  getMaxHTTPHeaderSize,
} = require("internal/http");
const NumberIsNaN = Number.isNaN;

const { format } = require("internal/util/inspect");

const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");
const { kIncomingMessage } = require("node:_http_common");
const kConnectionsCheckingInterval = Symbol("http.server.connectionsCheckingInterval");

const getBunServerAllClosedPromise = $newZigFunction("node_http_binding.zig", "getBunServerAllClosedPromise", 1);
const sendHelper = $newZigFunction("node_cluster_binding.zig", "sendHelperChild", 3);

const kServerResponse = Symbol("ServerResponse");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const GlobalPromise = globalThis.Promise;
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const MathMin = Math.min;

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
const ServerResponsePrototype = {
  constructor: ServerResponse,
  __proto__: OutgoingMessage.prototype,

  // Unused but observable fields:
  _removedConnection: false,
  _removedContLen: false,
  _hasBody: true,
  _ended: false,
  [kRejectNonStandardBodyWrites]: undefined,

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

  // This end method is actually on the OutgoingMessage prototype in Node.js
  // But we don't want it for the fetch() response version.
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
        // node.js just ignores the write in this case
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
      // node.js will return true if the handle is closed but the internal state is not
      // and will not throw or emit an error
      return true;
    }
    if (headerState !== NodeHTTPHeaderState.sent) {
      handle.cork(() => {
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);

        // If handle.writeHead throws, we don't want headersSent to be set to true.
        // So we set it here.
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;

        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/_http_outgoing.js#L987
        this._contentLength = handle.end(chunk, encoding, undefined, strictContentLength(this));
      });
    } else {
      // If there's no data but you already called end, then you're done.
      // We can ignore it in that case.
      if (!(!chunk && handle.ended) && !handle.aborted) {
        handle.end(chunk, encoding, undefined, strictContentLength(this));
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
        // node.js just ignores the write in this case
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
        return OutgoingMessagePrototype.write.$call(this, chunk, encoding, callback);
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
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);

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
    this.emit("drain");

    return true;
  },

  _callPendingCallbacks() {
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
    if (this.headersSent) return;
    // @ts-ignore
    this.writeHead(this.statusCode);
  },

  get writableNeedDrain() {
    return !this.destroyed && !this.finished && (this[kHandle]?.bufferedAmount ?? 1) !== 0;
  },

  get writableFinished() {
    return !!(this.finished && (!this[kHandle] || this[kHandle].finished));
  },

  get writableLength() {
    return this.writableFinished ? 0 : (this[kHandle]?.bufferedAmount ?? 0);
  },

  get writableHighWaterMark() {
    return 64 * 1024;
  },

  get closed() {
    return this._closed;
  },

  _send(data, encoding, callback, _byteLength) {
    const handle = this[kHandle];
    if (!handle) {
      return OutgoingMessagePrototype._send.$apply(this, arguments);
    }

    if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
      handle.cork(() => {
        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;
        handle.write(data, encoding, callback, strictContentLength(this));
      });
    } else {
      handle.write(data, encoding, callback, strictContentLength(this));
    }
  },

  writeHead(statusCode, statusMessage, headers) {
    if (this.headersSent) {
      throw $ERR_HTTP_HEADERS_SENT("writeHead");
    }
    _writeHead(statusCode, statusMessage, headers, this);

    this[headerStateSymbol] = NodeHTTPHeaderState.assigned;

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

  destroy(_err?: Error) {
    if (this.destroyed) return this;
    const handle = this[kHandle];
    this.destroyed = true;
    if (handle) {
      handle.abort();
    }
    this?.socket?.destroy();
    this.emit("close");
    return this;
  },

  emit(event) {
    if (event === "close") {
      callCloseCallback(this);
    }
    return Stream.prototype.emit.$apply(this, arguments);
  },

  flushHeaders() {
    this._implicitHeader();

    const handle = this[kHandle];
    if (handle) {
      if (this[headerStateSymbol] === NodeHTTPHeaderState.assigned) {
        this[headerStateSymbol] = NodeHTTPHeaderState.sent;

        handle.writeHead(this.statusCode, this.statusMessage, this[headersSymbol]);
      }
      handle.flushHeaders();
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

type Server = InstanceType<typeof Server>;
const Server = function Server(options, callback) {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);
  this[kConnectionsCheckingInterval] = { _destroyed: false };

  this.listening = false;
  this._unref = false;
  this.maxRequestsPerSocket = 0;
  this[kInternalSocketData] = undefined;
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
  storeHTTPOptions.$call(this, options);

  if (callback) this.on("request", callback);
  return this;
} as unknown as typeof import("node:http").Server;
Object.defineProperty(Server, "name", { value: "Server" });

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
  const nodeSocket = new NodeHTTPServerSocket(self, socket, ssl);
  self.emit("connection", nodeSocket);
  self.emit("clientError", err, nodeSocket);
  if (nodeSocket.listenerCount("error") > 0) {
    nodeSocket.emit("error", err);
  }
}
const ServerPrototype = {
  constructor: Server,
  __proto__: EventEmitter.prototype,
  [kIncomingMessage]: undefined,
  [kServerResponse]: undefined,
  [kConnectionsCheckingInterval]: undefined,
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
    const connectionsCheckingInterval = this[kConnectionsCheckingInterval];
    if (connectionsCheckingInterval) {
      connectionsCheckingInterval._destroyed = true;
    }
    this.listening = false;

    server.stop(true);
  },

  closeIdleConnections() {
    // not actually implemented
  },

  close(optionalCallback?) {
    const server = this[serverSymbol];
    if (!server) {
      if (typeof optionalCallback === "function") process.nextTick(optionalCallback, $ERR_SERVER_NOT_RUNNING());
      return;
    }
    this[serverSymbol] = undefined;
    const connectionsCheckingInterval = this[kConnectionsCheckingInterval];
    if (connectionsCheckingInterval) {
      connectionsCheckingInterval._destroyed = true;
    }
    if (typeof optionalCallback === "function") setCloseCallback(this, optionalCallback);
    this.listening = false;
    server.stop();
  },
  [EventEmitter.captureRejectionSymbol]: function (err, event, ...args) {
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
      const canUseInternalAssignSocket =
        ResponseClass?.prototype.assignSocket === ServerResponse.prototype.assignSocket;
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
        ) {
          const prevIsNextIncomingMessageHTTPS = getIsNextIncomingMessageHTTPS();
          setIsNextIncomingMessageHTTPS(isHTTPS);
          if (!socket) {
            socket = new NodeHTTPServerSocket(server, socketHandle, !!tls);
          }

          const http_req = new RequestClass(kHandle, url, method, headersObject, headersArray, handle, hasBody, socket);
          if (isAncientHTTP) {
            http_req.httpVersion = "1.0";
          }
          const http_res = new ResponseClass(http_req, {
            [kHandle]: handle,
            [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
          });
          setIsNextIncomingMessageHTTPS(prevIsNextIncomingMessageHTTPS);
          handle.onabort = onServerRequestEvent.bind(socket);
          // start buffering data if any, the user will need to resume() or .on("data") to read it
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
              // ~10% performance improvement in JavaScriptCore due to avoiding .once("close", ...) and removing a listener
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
                // ~10% performance improvement in JavaScriptCore due to avoiding .once("close", ...) and removing a listener
                assignSocketInternal(http_res, socket);
              } else {
                http_res.assignSocket(socket);
              }
            }
          } else if (http_req.headers.expect !== undefined) {
            if (http_req.headers.expect === "100-continue") {
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
Server.prototype = ServerPrototype;
$setPrototypeDirect.$call(Server, EventEmitter);

const NodeHTTPServerSocket = class Socket extends Duplex {
  bytesRead = 0;
  connecting = false;
  timeout = 0;
  [kHandle];
  server: Server;
  _httpMessage;
  _secureEstablished = false;
  constructor(server: Server, handle, encrypted) {
    super();
    this.server = server;
    this[kHandle] = handle;
    this._secureEstablished = !!handle?.secureEstablished;
    handle.onclose = this.#onClose.bind(this);
    handle.duplex = this;
    this.encrypted = encrypted;
    this.on("timeout", onNodeHTTPServerSocketTimeout);
  }

  get bytesWritten() {
    return this[kHandle]?.response?.getBytesWritten?.() ?? 0;
  }
  set bytesWritten(value) {}

  #closeHandle(handle, callback) {
    this[kHandle] = undefined;
    handle.onclose = this.#onCloseForDestroy.bind(this, callback);
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
    const message = this._httpMessage;
    const req = message?.req;
    if (req && !req.complete && !req[kHandle]?.upgraded) {
      // At this point the socket is already destroyed; let's avoid UAF
      req[kHandle] = undefined;
      if (req.listenerCount("error") > 0) {
        req.destroy(new ConnResetException("aborted"));
      } else {
        req.destroy();
      }
    }
  }
  #onCloseForDestroy(closeCallback) {
    this.#onClose();
    $isCallable(closeCallback) && closeCallback();
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

function ServerResponse(req, options) {
  if (!(this instanceof ServerResponse)) {
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
  this[kPendingCallbacks] = [];
  this.finished = false;

  // this is matching node's behaviour
  // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
  if (req.method === "HEAD") this._hasBody = false;

  if (options) {
    const handle = options[kHandle];

    if (handle) {
      this[kHandle] = handle;
    }
    this[kRejectNonStandardBodyWrites] = options[kRejectNonStandardBodyWrites] ?? false;
  }
}

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
  process.nextTick(emitServerSocketEOF, self);
}

let OriginalWriteHeadFn, OriginalImplicitHeadFn;

function callWriteHeadIfObservable(self, headerState) {
  if (
    headerState === NodeHTTPHeaderState.none &&
    !(self.writeHead === OriginalWriteHeadFn && self._implicitHeader === OriginalImplicitHeadFn)
  ) {
    self.writeHead(self.statusCode, self.statusMessage, self[headersSymbol]);
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
        headers: this[headersSymbol],
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

ServerResponse.prototype.writeHeader = ServerResponse.prototype.writeHead;

OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = ServerResponse.prototype._implicitHeader;

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
    this.keepAliveTimeout = 5_000; // 5 seconds;
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

  const rejectNonStandardBodyWrites = options.rejectNonStandardBodyWrites;
  if (rejectNonStandardBodyWrites !== undefined) {
    validateBoolean(rejectNonStandardBodyWrites, "options.rejectNonStandardBodyWrites");
    this.rejectNonStandardBodyWrites = rejectNonStandardBodyWrites;
  } else {
    this.rejectNonStandardBodyWrites = false;
  }
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
  kConnectionsCheckingInterval,
};
