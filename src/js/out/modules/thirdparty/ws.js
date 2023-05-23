// src/js/thirdparty/ws.js
var EventEmitter = import.meta.require("node:events");
var http = import.meta.require("node:http");
var subprotocolParse = function(header) {
  const protocols = new Set;
  let start = -1;
  let end = -1;
  let i = 0;
  for (i;i < header.length; i++) {
    const code = header.charCodeAt(i);
    if (end === -1 && wsTokenChars[code] === 1) {
      if (start === -1)
        start = i;
    } else if (i !== 0 && (code === 32 || code === 9)) {
      if (end === -1 && start !== -1)
        end = i;
    } else if (code === 44) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
      if (end === -1)
        end = i;
      const protocol2 = header.slice(start, end);
      if (protocols.has(protocol2)) {
        throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
      }
      protocols.add(protocol2);
      start = end = -1;
    } else {
      throw new SyntaxError(`Unexpected character at index ${i}`);
    }
  }
  if (start === -1 || end !== -1) {
    throw new SyntaxError("Unexpected end of input");
  }
  const protocol = header.slice(start, i);
  if (protocols.has(protocol)) {
    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
  }
  protocols.add(protocol);
  return protocols;
};
var wsEmitClose = function(server) {
  server._state = CLOSED;
  server.emit("close");
};
var abortHandshake = function(response, code, message, headers) {
  message = message || http.STATUS_CODES[code];
  headers = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(message),
    ...headers
  };
  response.writeHead(code, headers);
  response.write(message);
  response.end();
};
var abortHandshakeOrEmitwsClientError = function(server, req, response, socket, code, message) {
  if (server.listenerCount("wsClientError")) {
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
    server.emit("wsClientError", err, socket, req);
  } else {
    abortHandshake(response, code, message);
  }
};
var kBunInternals = Symbol.for("::bunternal::");
var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
var encoder = new TextEncoder;

class BunWebSocket extends globalThis.WebSocket {
  constructor(url, ...args) {
    super(url, ...args);
    this.#wrappedHandlers = new WeakMap;
  }
  #binaryType;
  #wrappedHandlers = new WeakMap;
  get binaryType() {
    return this.#binaryType;
  }
  set binaryType(type) {
    if (type !== "nodebuffer" && type !== "blob" && type !== "arraybuffer") {
      throw new TypeError("binaryType must be either 'blob', 'arraybuffer' or 'nodebuffer'");
    }
    if (type !== "blob") {
      super.binaryType = type;
    }
    this.#binaryType = type;
  }
  send(data, opts, cb) {
    super.send(data, opts?.compress);
    typeof cb === "function" && cb();
  }
  on(event, callback) {
    if (event === "message") {
      var handler = ({ data }) => {
        try {
          if (this.#binaryType == "blob") {
            data = new Blob([data]);
          }
          callback(data);
        } catch (e) {
          globalThis.reportError(e);
        }
      };
      this.#wrappedHandlers.set(callback, handler);
      this.addEventListener(event, handler);
    } else {
      this.addEventListener(event, callback);
    }
  }
  once(event, callback) {
    if (event === "message") {
      var handler = ({ data }) => {
        try {
          callback(data);
        } catch (e) {
          globalThis.reportError(e);
        }
      };
      this.#wrappedHandlers.set(callback, handler);
      this.addEventListener(event, handler, { once: true });
    } else {
      this.addEventListener(event, callback, { once: true });
    }
  }
  emit(event, data) {
    if (event === "message") {
      this.dispatchEvent(new MessageEvent("message", { data }));
    } else {
      this.dispatchEvent(new CustomEvent(event, { detail: data }));
    }
  }
  off(event, callback) {
    var wrapped = this.#wrappedHandlers.get(callback);
    if (wrapped) {
      this.removeEventListener(event, wrapped);
      this.#wrappedHandlers.delete(callback);
    } else {
      this.removeEventListener(event, callback);
    }
  }
}
BunWebSocket.WebSocket = BunWebSocket;
var wsKeyRegex = /^[+/0-9A-Za-z]{22}==$/;
var wsTokenChars = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  1,
  1,
  0,
  1,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  1,
  0,
  1,
  0
];
var RUNNING = 0;
var CLOSING = 1;
var CLOSED = 2;

class BunWebSocketMocked extends EventEmitter {
  #ws;
  #state;
  #enquedMessages = [];
  #url;
  #protocol;
  #extensions;
  #bufferedAmount = 0;
  #binaryType = "arraybuffer";
  #onclose;
  #onerror;
  #onmessage;
  #onopen;
  constructor(url, protocol, extensions, binaryType) {
    super();
    this.#ws = null;
    this.#state = 0;
    this.#url = url;
    this.#bufferedAmount = 0;
    binaryType = binaryType || "arraybuffer";
    if (binaryType !== "nodebuffer" && binaryType !== "blob" && binaryType !== "arraybuffer") {
      throw new TypeError("binaryType must be either 'blob', 'arraybuffer' or 'nodebuffer'");
    }
    this.#binaryType = binaryType;
    this.#protocol = protocol;
    this.#extensions = extensions;
    const message = this.#message.bind(this);
    const open = this.#open.bind(this);
    const close = this.#close.bind(this);
    const drain = this.#drain.bind(this);
    this[kBunInternals] = {
      message,
      open,
      close,
      drain
    };
  }
  #message(ws, message) {
    this.#ws = ws;
    if (typeof message === "string") {
      if (this.#binaryType === "arraybuffer") {
        message = encoder.encode(message).buffer;
      } else if (this.#binaryType === "blob") {
        message = new Blob([message], { type: "text/plain" });
      } else {
        message = Buffer.from(message);
      }
    } else {
      if (this.#binaryType !== "nodebuffer") {
        if (this.#binaryType === "arraybuffer") {
          message = new Uint8Array(message);
        } else if (this.#binaryType === "blob") {
          message = new Blob([message]);
        }
      }
    }
    this.emit("message", message);
  }
  #open(ws) {
    this.#ws = ws;
    this.#state = 1;
    this.emit("open", this);
    this.#drain(ws);
  }
  #close(ws, code, reason) {
    this.#state = 3;
    this.#ws = null;
    this.emit("close", code, reason);
  }
  #drain(ws) {
    const chunk = this.#enquedMessages[0];
    if (chunk) {
      const [data, compress, cb] = chunk;
      const written = ws.send(data, compress);
      if (written == -1) {
        return;
      }
      typeof cb === "function" && cb();
      this.#bufferedAmount -= chunk.length;
      this.#enquedMessages.shift();
    }
  }
  send(data, opts, cb) {
    if (this.#state === 1) {
      const compress = opts?.compress;
      const written = this.#ws.send(data, compress);
      if (written == -1) {
        this.#enquedMessages.push([data, compress, cb]);
        this.#bufferedAmount += data.length;
        return;
      }
      typeof cb === "function" && cb();
    } else if (this.#state === 0) {
      this.#enquedMessages.push([data, opts?.compress, cb]);
      this.#bufferedAmount += data.length;
    }
  }
  close(code, reason) {
    if (this.#state === 1) {
      this.#state = 2;
      this.#ws.close(code, reason);
    }
  }
  get binaryType() {
    return this.#binaryType;
  }
  set binaryType(type) {
    if (type !== "nodebuffer" && type !== "blob" && type !== "arraybuffer") {
      throw new TypeError("binaryType must be either 'blob', 'arraybuffer' or 'nodebuffer'");
    }
    this.#binaryType = type;
  }
  get readyState() {
    return readyStates[this.#state];
  }
  get url() {
    return this.#url;
  }
  get protocol() {
    return this.#protocol;
  }
  get extensions() {
    return this.#extensions;
  }
  get bufferedAmount() {
    return this.#bufferedAmount ?? 0;
  }
  setSocket(socket, head, options) {
    throw new Error("Not implemented");
  }
  set onclose(cb) {
    if (this.#onclose) {
      this.removeListener("close", this.#onclose);
    }
    this.on("close", cb);
    this.#onclose = cb;
  }
  set onerror(cb) {
    if (this.#onerror) {
      this.removeListener("error", this.#onerror);
    }
    this.on("error", cb);
    this.#onerror = cb;
  }
  set onmessage(cb) {
    if (this.#onmessage) {
      this.removeListener("message", this.#onmessage);
    }
    this.on("message", cb);
    this.#onmessage = cb;
  }
  set onopen(cb) {
    if (this.#onopen) {
      this.removeListener("open", this.#onopen);
    }
    this.on("open", cb);
    this.#onopen = cb;
  }
  get onclose() {
    return this.#onclose;
  }
  get onerror() {
    return this.#onerror;
  }
  get onmessage() {
    return this.#onmessage;
  }
  get onopen() {
    return this.#onopen;
  }
}

class Server extends EventEmitter {
  _server;
  options;
  clients;
  _shouldEmitClose;
  _state;
  _removeListeners;
  constructor(options, callback) {
    super();
    options = {
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: false,
      handleProtocols: null,
      clientTracking: true,
      verifyClient: null,
      noServer: false,
      backlog: null,
      server: null,
      host: null,
      path: null,
      port: null,
      ...options
    };
    if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
      throw new TypeError('One and only one of the "port", "server", or "noServer" options must be specified');
    }
    if (options.port != null) {
      this._server = http.createServer((req, res) => {
        const body = http.STATUS_CODES[426];
        res.writeHead(426, {
          "Content-Length": body.length,
          "Content-Type": "text/plain"
        });
        res.end(body);
      });
      this._server.listen(options.port, options.host, options.backlog, callback);
    } else if (options.server) {
      this._server = options.server;
    }
    if (this._server) {
      const emitConnection = this.emit.bind(this, "connection");
      const emitListening = this.emit.bind(this, "listening");
      const emitError = this.emit.bind(this, "error");
      const doUpgrade = (req, socket, head) => {
        this.handleUpgrade(req, socket, head, emitConnection);
      };
      this._server.on("listening", emitListening);
      this._server.on("error", emitError);
      this._server.on("upgrade", doUpgrade);
      this._removeListeners = () => {
        this._server.removeListener("upgrade", doUpgrade);
        this._server.removeListener("listening", emitListening);
        this._server.removeListener("error", emitError);
      };
    }
    if (options.perMessageDeflate === true)
      options.perMessageDeflate = {};
    if (options.clientTracking) {
      this.clients = new Set;
      this._shouldEmitClose = false;
    }
    this.options = options;
    this._state = RUNNING;
  }
  address() {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }
    if (!this._server)
      return null;
    return this._server.address();
  }
  close(cb) {
    if (this._state === CLOSED) {
      if (cb) {
        this.once("close", () => {
          cb(new Error("The server is not running"));
        });
      }
      process.nextTick((server) => {
        server._state = CLOSED;
        server.emit("close");
      }, this);
      return;
    }
    if (cb)
      this.once("close", cb);
    if (this._state === CLOSING)
      return;
    this._state = CLOSING;
    if (this.options.noServer || this.options.server) {
      if (this._server) {
        this._removeListeners();
        this._removeListeners = this._server = null;
      }
      if (this.clients) {
        if (!this.clients.size) {
          process.nextTick((server) => {
            server._state = CLOSED;
            server.emit("close");
          }, this);
        } else {
          this._shouldEmitClose = true;
        }
      } else {
        process.nextTick((server) => {
          server._state = CLOSED;
          server.emit("close");
        }, this);
      }
    } else {
      const server = this._server;
      this._removeListeners();
      this._removeListeners = this._server = null;
      server.close(() => {
        this._state = CLOSED;
        this.emit("close");
      });
    }
  }
  shouldHandle(req) {
    if (this.options.path) {
      const index = req.url.indexOf("?");
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
      if (pathname !== this.options.path)
        return false;
    }
    return true;
  }
  completeUpgrade(extensions, key, protocols, request, socket, head, cb) {
    const [server, response, req] = socket[kBunInternals];
    if (this._state > RUNNING)
      return abortHandshake(response, 503);
    let protocol = "";
    if (protocols.size) {
      protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, request) : protocols.values().next().value;
    }
    const ws = new BunWebSocketMocked(request.url, protocol, extensions, "nodebuffer");
    const headers = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade"];
    this.emit("headers", headers, request);
    if (server.upgrade(req, {
      data: ws[kBunInternals]
    })) {
      response._reply(undefined);
      if (this.clients) {
        this.clients.add(ws);
        ws.on("close", () => {
          this.clients.delete(ws);
          if (this._shouldEmitClose && !this.clients.size) {
            process.nextTick(wsEmitClose, this);
          }
        });
      }
      cb(ws, request);
    } else {
      abortHandshake(response, 500);
    }
  }
  handleUpgrade(req, socket, head, cb) {
    const [_, response] = socket[kBunInternals];
    const key = req.headers["sec-websocket-key"];
    const version = +req.headers["sec-websocket-version"];
    if (req.method !== "GET") {
      const message = "Invalid HTTP method";
      abortHandshakeOrEmitwsClientError(this, req, response, socket, 405, message);
      return;
    }
    if (req.headers.upgrade.toLowerCase() !== "websocket") {
      const message = "Invalid Upgrade header";
      abortHandshakeOrEmitwsClientError(this, req, response, socket, 400, message);
      return;
    }
    if (!key || !wsKeyRegex.test(key)) {
      const message = "Missing or invalid Sec-WebSocket-Key header";
      abortHandshakeOrEmitwsClientError(this, req, response, socket, 400, message);
      return;
    }
    if (version !== 8 && version !== 13) {
      const message = "Missing or invalid Sec-WebSocket-Version header";
      abortHandshakeOrEmitwsClientError(this, req, response, socket, 400, message);
      return;
    }
    if (!this.shouldHandle(req)) {
      abortHandshake(response, 400);
      return;
    }
    const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
    let protocols = new Set;
    if (secWebSocketProtocol !== undefined) {
      try {
        protocols = subprotocolParse(secWebSocketProtocol);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Protocol header";
        abortHandshakeOrEmitwsClientError(this, req, response, socket, 400, message);
        return;
      }
    }
    const extensions = {};
    if (this.options.verifyClient) {
      const info = {
        origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
        secure: !!(req.socket.authorized || req.socket.encrypted),
        req
      };
      if (this.options.verifyClient.length === 2) {
        this.options.verifyClient(info, (verified, code, message, headers) => {
          if (!verified) {
            return abortHandshake(response, code || 401, message, headers);
          }
          this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
        });
        return;
      }
      if (!this.options.verifyClient(info))
        return abortHandshake(response, 401);
    }
    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
  }
}
BunWebSocket.WebSocketServer = Server;
BunWebSocket.Server = Server;
Object.defineProperty(BunWebSocket, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING")
});
Object.defineProperty(BunWebSocket.prototype, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING")
});
Object.defineProperty(BunWebSocket, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN")
});
Object.defineProperty(BunWebSocket.prototype, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN")
});
Object.defineProperty(BunWebSocket, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING")
});
Object.defineProperty(BunWebSocket.prototype, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING")
});
Object.defineProperty(BunWebSocket, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED")
});
Object.defineProperty(BunWebSocket.prototype, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED")
});

class Sender {
  constructor() {
    throw new Error("Not supported yet in Bun");
  }
}
BunWebSocket.Sender = Sender;

class Receiver {
  constructor() {
    throw new Error("Not supported yet in Bun");
  }
}
BunWebSocket.Receiver = Receiver;
var createWebSocketStream = (ws) => {
  throw new Error("Not supported yet in Bun");
};
BunWebSocket.createWebSocketStream = createWebSocketStream;
BunWebSocket[Symbol.for("CommonJS")] = 0;
var ws_default = BunWebSocket;
export {
  ws_default as default,
  createWebSocketStream,
  Server as WebSocketServer,
  BunWebSocket as WebSocket,
  Server,
  Sender,
  Receiver
};

//# debugId=2C08054B593D287664756e2164756e21
