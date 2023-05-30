// Mocking https://github.com/websockets/ws
// this just wraps WebSocket to look like an EventEmitter
// without actually using an EventEmitter polyfill

import EventEmitter from "events";
import http from "http";

const kBunInternals = Symbol.for("::bunternal::");
const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const encoder = new TextEncoder();

const emittedWarnings = new Set();
function emitWarning(type, message) {
  if (emittedWarnings.has(type)) return;
  emittedWarnings.add(type);
  // process.emitWarning(message); // our printing is bad
  console.warn("[bun] Warning:", message);
}

/*
 * deviations: we do not implement these events
 * - "unexpected-response"
 * - "upgrade"
 * - "ping"
 * - "pong"
 * - "redirect"
 */
class BunWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  #ws;
  #paused = false;
  #fragments = false;
  #binaryType = "nodebuffer";
  readyState = BunWebSocket.CONNECTING;

  constructor(url, protocols, options) {
    // deviation: we don't support anything in `options`
    super();
    let ws = (this.#ws = new WebSocket(url, protocols));
    ws.binaryType = "nodebuffer"; // bun's WebSocket supports "nodebuffer"
    ws.addEventListener("open", () => {
      this.readyState = BunWebSocket.OPEN;
      this.emit("open");
    });
    ws.addEventListener("error", err => {
      this.readyState = BunWebSocket.CLOSED;
      this.emit("error", err);
    });
    ws.addEventListener("close", ev => {
      this.readyState = BunWebSocket.CLOSED;
      this.emit("close", ev.code, ev.reason);
    });
    ws.addEventListener("message", ev => {
      const isBinary = typeof ev.data !== "string";
      if (isBinary) {
        this.emit("message", this.#fragments ? [ev.data] : ev.data, isBinary);
      } else {
        var encoded = encoder.encode(ev.data);
        if (this.#binaryType !== "arraybuffer") {
          encoded = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength);
        }
        this.emit("message", this.#fragments ? [encoded] : encoded, isBinary);
      }
    });
  }

  on(event, listener) {
    if (
      event === "unexpected-response" ||
      event === "upgrade" ||
      event === "ping" ||
      event === "pong" ||
      event === "redirect"
    ) {
      emitWarning(event, "ws.WebSocket '" + event + "' event is not implemented in bun");
    }
    return super.on(event, listener);
  }

  send(data, opts, cb) {
    this.#ws.send(data, opts?.compress);
    // deviation: this should be called once the data is written, not immediately
    typeof cb === "function" && cb();
  }

  close(code, reason) {
    this.#ws.close(code, reason);
  }

  get binaryType() {
    return this.#binaryType;
  }

  set binaryType(value) {
    if (value) this.#ws.binaryType = value;
  }

  set binaryType(value) {
    if (value === "nodebuffer" || value === "arraybuffer") {
      this.#ws.binaryType = this.#binaryType = value;
      this.#fragments = false;
    } else if (value === "fragments") {
      this.#ws.binaryType = "nodebuffer";
      this.#binaryType = "fragments";
      this.#fragments = true;
    }
  }

  get protocol() {
    return this.#ws.protocol;
  }

  get extensions() {
    return this.#ws.extensions;
  }

  // deviation: this does not support `message` with `binaryType = "fragments"`
  addEventListener(type, listener, options) {
    this.#ws.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener) {
    this.#ws.removeEventListener(type, listener);
  }

  get onopen() {
    return this.#ws.onopen;
  }

  set onopen(value) {
    this.#ws.onopen = value;
  }

  get onerror() {
    return this.#ws.onerror;
  }

  set onerror(value) {
    this.#ws.onerror = value;
  }

  get onclose() {
    return this.#ws.onclose;
  }

  set onclose(value) {
    this.#ws.onclose = value;
  }

  get onmessage() {
    return this.#ws.onmessage;
  }

  // deviation: this does not support `binaryType = "fragments"`
  set onmessage(value) {
    this.#ws.onmessage = value;
  }

  get bufferedAmount() {
    return this.#ws.bufferedAmount;
  }

  get isPaused() {
    return this.#paused;
  }

  ping(data, mask, cb) {
    if (this.readyState === BunWebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }

    if (typeof data === "function") {
      cb = data;
      data = mask = undefined;
    } else if (typeof mask === "function") {
      cb = mask;
      mask = undefined;
    }

    if (typeof data === "number") data = data.toString();

    // deviation: we don't support ping
    emitWarning("ping()", "ws.WebSocket.ping() is not implemented in bun");
    typeof cb === "function" && cb();
  }

  pong(data, mask, cb) {
    if (this.readyState === BunWebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }

    if (typeof data === "function") {
      cb = data;
      data = mask = undefined;
    } else if (typeof mask === "function") {
      cb = mask;
      mask = undefined;
    }

    if (typeof data === "number") data = data.toString();

    // deviation: we don't support pong
    emitWarning("pong()", "ws.WebSocket.pong() is not implemented in bun");
    typeof cb === "function" && cb();
  }

  pause() {
    if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
      return;
    }

    this.#paused = true;

    // deviation: we dont support pause()
    emitWarning("pause()", "ws.WebSocket.pause() is not implemented in bun");
  }

  resume() {
    if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
      return;
    }

    this.#paused = false;

    // deviation: we dont support resume()
    emitWarning("resume()", "ws.WebSocket.resume() is not implemented in bun");
  }
}

BunWebSocket.WebSocket = BunWebSocket;

const wsKeyRegex = /^[+/0-9A-Za-z]{22}==$/;
const wsTokenChars = [
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
  0, // 0 - 15
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
  0, // 16 - 31
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
  0, // 32 - 47
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
  0, // 48 - 63
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
  1, // 64 - 79
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
  1, // 80 - 95
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
  1, // 96 - 111
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
  0, // 112 - 127
];

/**
 * Parses the `Sec-WebSocket-Protocol` header into a set of subprotocol names.
 *
 * @param {String} header The field value of the header
 * @return {Set} The subprotocol names
 * @public
 */
function subprotocolParse(header) {
  const protocols = new Set();
  let start = -1;
  let end = -1;
  let i = 0;

  for (i; i < header.length; i++) {
    const code = header.charCodeAt(i);

    if (end === -1 && wsTokenChars[code] === 1) {
      if (start === -1) start = i;
    } else if (i !== 0 && (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */) {
      if (end === -1 && start !== -1) end = i;
    } else if (code === 0x2c /* ',' */) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }

      if (end === -1) end = i;

      const protocol = header.slice(start, end);

      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }

      protocols.add(protocol);
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
}

/**
 * Emit a `'close'` event on an `EventEmitter`.
 *
 * @param {EventEmitter} server The event emitter
 * @private
 */
function wsEmitClose(server) {
  server._state = CLOSED;
  server.emit("close");
}

function abortHandshake(response, code, message, headers) {
  message = message || http.STATUS_CODES[code];
  headers = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(message),
    ...headers,
  };

  response.writeHead(code, headers);
  response.write(message);
  response.end();
}

function abortHandshakeOrEmitwsClientError(server, req, response, socket, code, message) {
  if (server.listenerCount("wsClientError")) {
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);

    server.emit("wsClientError", err, socket, req);
  } else {
    abortHandshake(response, code, message);
  }
}

const RUNNING = 0;
const CLOSING = 1;
const CLOSED = 2;

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
      message, // a message is received
      open, // a socket is opened
      close, // a socket is closed
      drain, // the socket is ready to receive more data
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
        // nodebuffer
        message = Buffer.from(message);
      }
    } else {
      //Buffer
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
    // first drain event
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
        // backpressure wait until next drain event
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
        // backpressure
        this.#enquedMessages.push([data, compress, cb]);
        this.#bufferedAmount += data.length;
        return;
      }

      typeof cb === "function" && cb();
    } else if (this.#state === 0) {
      // not connected yet
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
  /**
   * Set up the socket and the internal resources.
   *
   * @param {(net.Socket|tls.Socket)} socket The network socket between the
   *     server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Object} options Options object
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Number} [options.maxPayload=0] The maximum allowed message size
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @private
   */
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

  /**
   * Create a `WebSocketServer` instance.
   *
   * @param {Object} options Configuration options
   * @param {Number} [options.backlog=511] The maximum length of the queue of
   *     pending connections
   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
   *     track clients
   * @param {Function} [options.handleProtocols] A hook to handle protocols
   * @param {String} [options.host] The hostname where to bind the server
   *     size
   * @param {Boolean} [options.noServer=false] Enable no server mode
   * @param {String} [options.path] Accept only connections matching this path
   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
   *     permessage-deflate
   * @param {Number} [options.port] The port where to bind the server
   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
   * @param {Function} [options.verifyClient] A hook to reject connections
   *     class to use. It must be the `WebSocket` class or class that extends it
   * @param {Function} [callback] A listener for the `listening` event
   */
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
      backlog: null, // use default (511 as implemented in net.js)
      server: null,
      host: null,
      path: null,
      port: null,
      ...options,
    };

    if (
      (options.port == null && !options.server && !options.noServer) ||
      (options.port != null && (options.server || options.noServer)) ||
      (options.server && options.noServer)
    ) {
      throw new TypeError('One and only one of the "port", "server", or "noServer" options must be specified');
    }

    if (options.port != null) {
      this._server = http.createServer((req, res) => {
        const body = http.STATUS_CODES[426];

        res.writeHead(426, {
          "Content-Length": body.length,
          "Content-Type": "text/plain",
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

    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
    if (options.clientTracking) {
      this.clients = new Set();
      this._shouldEmitClose = false;
    }

    this.options = options;
    this._state = RUNNING;
  }

  /**
   * Returns the bound address, the address family name, and port of the server
   * as reported by the operating system if listening on an IP socket.
   * If the server is listening on a pipe or UNIX domain socket, the name is
   * returned as a string.
   *
   * @return {(Object|String|null)} The address of the server
   * @public
   */
  address() {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }

    if (!this._server) return null;
    return this._server.address();
  }

  /**
   * Stop the server from accepting new connections and emit the `'close'` event
   * when all existing connections are closed.
   *
   * @param {Function} [cb] A one-time listener for the `'close'` event
   * @public
   */
  close(cb) {
    if (this._state === CLOSED) {
      if (cb) {
        this.once("close", () => {
          cb(new Error("The server is not running"));
        });
      }

      process.nextTick(server => {
        server._state = CLOSED;
        server.emit("close");
      }, this);
      return;
    }

    if (cb) this.once("close", cb);

    if (this._state === CLOSING) return;
    this._state = CLOSING;

    if (this.options.noServer || this.options.server) {
      if (this._server) {
        this._removeListeners();
        this._removeListeners = this._server = null;
      }

      if (this.clients) {
        if (!this.clients.size) {
          process.nextTick(server => {
            server._state = CLOSED;
            server.emit("close");
          }, this);
        } else {
          this._shouldEmitClose = true;
        }
      } else {
        process.nextTick(server => {
          server._state = CLOSED;
          server.emit("close");
        }, this);
      }
    } else {
      const server = this._server;

      this._removeListeners();
      this._removeListeners = this._server = null;

      //
      // The HTTP/S server was created internally. Close it, and rely on its
      // `'close'` event.
      //
      server.close(() => {
        this._state = CLOSED;
        this.emit("close");
      });
    }
  }

  /**
   * See if a given request should be handled by this server instance.
   *
   * @param {http.IncomingMessage} req Request object to inspect
   * @return {Boolean} `true` if the request is valid, else `false`
   * @public
   */
  shouldHandle(req) {
    if (this.options.path) {
      const index = req.url.indexOf("?");
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

      if (pathname !== this.options.path) return false;
    }

    return true;
  }

  /**
   * Upgrade the connection to WebSocket.
   *
   * @param {Object} extensions The accepted extensions
   * @param {String} key The value of the `Sec-WebSocket-Key` header
   * @param {Set} protocols The subprotocols
   * @param {http.IncomingMessage} request The request object
   * @param {(net.Socket|tls.Socket)} socket The network socket between the
   *     server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @throws {Error} If called more than once with the same socket
   * @private
   */
  completeUpgrade(extensions, key, protocols, request, socket, head, cb) {
    const [server, response, req] = socket[kBunInternals];
    if (this._state > RUNNING) return abortHandshake(response, 503);

    let protocol = "";
    if (protocols.size) {
      //
      // Optionally call external protocol selection handler.
      //
      protocol = this.options.handleProtocols
        ? this.options.handleProtocols(protocols, request)
        : protocols.values().next().value;
    }
    const ws = new BunWebSocketMocked(request.url, protocol, extensions, "nodebuffer");

    const headers = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade"];
    this.emit("headers", headers, request);

    if (
      server.upgrade(req, {
        data: ws[kBunInternals],
      })
    ) {
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
  /**
   * Handle a HTTP Upgrade request.
   *
   * @param {http.IncomingMessage} req The request object
   * @param {(net.Socket|tls.Socket)} socket The network socket between the
   *     server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @public
   */
  handleUpgrade(req, socket, head, cb) {
    // socket is actually fake so we use internal http_res
    const [_, response] = socket[kBunInternals];

    // socket.on("error", socketOnError);

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
    let protocols = new Set();

    if (secWebSocketProtocol !== undefined) {
      try {
        protocols = subprotocolParse(secWebSocketProtocol);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Protocol header";
        abortHandshakeOrEmitwsClientError(this, req, response, socket, 400, message);
        return;
      }
    }

    // TODO: add perMessageDeflate options

    // const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
    const extensions = {};

    // if (secWebSocketExtensions !== undefined) {
    // console.log(secWebSocketExtensions);
    // const perMessageDeflate = new PerMessageDeflate(this.options.perMessageDeflate, true, this.options.maxPayload);

    // try {
    //   const offers = extension.parse(secWebSocketExtensions);

    //   if (offers[PerMessageDeflate.extensionName]) {
    //     perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
    //     extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
    //   }
    // } catch (err) {
    //   const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
    //   abortHandshakeOrEmitwsClientError(this, req, response, socket, 400, message);
    //   return;
    // }
    // }

    //
    // Optionally call external client verification handler.
    //
    if (this.options.verifyClient) {
      const info = {
        origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
        secure: !!(req.socket.authorized || req.socket.encrypted),
        req,
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

      if (!this.options.verifyClient(info)) return abortHandshake(response, 401);
    }

    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
  }
}

BunWebSocket.WebSocketServer = Server;
BunWebSocket.Server = Server;

Object.defineProperty(BunWebSocket, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING"),
});

Object.defineProperty(BunWebSocket.prototype, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING"),
});

Object.defineProperty(BunWebSocket, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN"),
});

Object.defineProperty(BunWebSocket.prototype, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN"),
});

Object.defineProperty(BunWebSocket, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING"),
});

Object.defineProperty(BunWebSocket.prototype, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING"),
});

Object.defineProperty(BunWebSocket, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED"),
});

Object.defineProperty(BunWebSocket.prototype, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED"),
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

var createWebSocketStream = ws => {
  throw new Error("Not supported yet in Bun");
};

BunWebSocket.createWebSocketStream = createWebSocketStream;

BunWebSocket[Symbol.for("CommonJS")] = 0;

export default BunWebSocket;
export { createWebSocketStream, Server, Receiver, Sender, BunWebSocket as WebSocket, Server as WebSocketServer };
