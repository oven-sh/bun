import {Duplex} from "node:stream";
import {EventEmitter} from "node:events";
var isIPv4 = function(s) {
  return IPv4Reg.test(s);
}, isIPv6 = function(s) {
  return IPv6Reg.test(s);
}, isIP = function(s) {
  if (isIPv4(s))
    return 4;
  if (isIPv6(s))
    return 6;
  return 0;
}, createConnection = function(port, host, connectListener) {
  if (typeof port === "object")
    return new Socket(port).connect(port, host, connectListener);
  return new Socket().connect(port, host, connectListener);
}, emitErrorNextTick = function(self, error) {
  self.emit("error", error);
}, emitListeningNextTick = function(self, onListen) {
  if (typeof onListen === "function")
    try {
      onListen();
    } catch (err) {
      self.emit("error", err);
    }
  self.emit("listening");
}, createServer = function(options, connectionListener) {
  return new Server(options, connectionListener);
}, v4Seg = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])", v4Str = `(${v4Seg}[.]){3}${v4Seg}`, IPv4Reg = new RegExp(`^${v4Str}$`), v6Seg = "(?:[0-9a-fA-F]{1,4})", IPv6Reg = new RegExp("^(" + `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` + `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` + `(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|` + `(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|` + `(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|` + `(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|` + `(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|` + `(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` + ")(%[0-9a-zA-Z-.:]{1,})?$"), { Bun, createFIFO, Object } = globalThis[Symbol.for("Bun.lazy")]("primordials"), { connect: bunConnect } = Bun, { setTimeout } = globalThis, bunTlsSymbol = Symbol.for("::buntls::"), bunSocketServerHandlers = Symbol.for("::bunsocket_serverhandlers::"), bunSocketServerConnections = Symbol.for("::bunnetserverconnections::"), bunSocketServerOptions = Symbol.for("::bunnetserveroptions::"), bunSocketInternal = Symbol.for("::bunnetsocketinternal::"), bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::"), SocketClass, Socket = function(InternalSocket) {
  return SocketClass = InternalSocket, Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "Socket",
    enumerable: !1
  }), Object.defineProperty(function Socket(options) {
    return new InternalSocket(options);
  }, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalSocket;
    }
  });
}(class Socket2 extends Duplex {
  static #Handlers = {
    close: Socket2.#Close,
    connectError(socket, error) {
      socket.data.emit("error", error);
    },
    data({ data: self }, buffer) {
      self.bytesRead += buffer.length;
      const queue = self.#readQueue;
      if (queue.isEmpty()) {
        if (self.push(buffer))
          return;
      }
      queue.push(buffer);
    },
    drain: Socket2.#Drain,
    end: Socket2.#Close,
    error(socket, error) {
      const self = socket.data, callback = self.#writeCallback;
      if (callback)
        self.#writeCallback = null, callback(error);
      self.emit("error", error);
    },
    open(socket) {
      const self = socket.data;
      socket.timeout(self.timeout), socket.ref(), self[bunSocketInternal] = socket, self.connecting = !1;
      const options = self[bunTLSConnectOptions];
      if (options) {
        const { session } = options;
        if (session)
          self.setSession(session);
      }
      if (!self.#upgraded)
        self.emit("connect", self);
      Socket2.#Drain(socket);
    },
    handshake(socket, success, verifyError) {
      const { data: self } = socket;
      self._securePending = !1, self.secureConnecting = !1, self._secureEstablished = !!success, self.emit("secure", self);
      const { checkServerIdentity } = self[bunTLSConnectOptions];
      if (!verifyError && typeof checkServerIdentity === "function" && self.servername) {
        const cert = self.getPeerCertificate(!0);
        verifyError = checkServerIdentity(self.servername, cert);
      }
      if (self._requestCert || self._rejectUnauthorized) {
        if (verifyError) {
          if (self.authorized = !1, self.authorizationError = verifyError.code || verifyError.message, self._rejectUnauthorized) {
            self.destroy(verifyError);
            return;
          }
        }
      } else
        self.authorized = !0;
      self.emit("secureConnect", verifyError);
    },
    timeout(socket) {
      const self = socket.data;
      self.emit("timeout", self);
    },
    binaryType: "buffer"
  };
  static #Close(socket) {
    const self = socket.data;
    if (self.#closed)
      return;
    self.#closed = !0, self[bunSocketInternal] = null;
    const queue = self.#readQueue;
    if (queue.isEmpty()) {
      if (self.push(null))
        return;
    }
    queue.push(null);
  }
  static #Drain(socket) {
    const self = socket.data, callback = self.#writeCallback;
    if (callback) {
      const chunk = self.#writeChunk, written = socket.write(chunk);
      if (self.bytesWritten += written, written < chunk.length)
        self.#writeChunk = chunk.slice(written);
      else
        self.#writeCallback = null, self.#writeChunk = null, callback(null);
    }
  }
  static [bunSocketServerHandlers] = {
    data: Socket2.#Handlers.data,
    close(socket) {
      Socket2.#Handlers.close(socket), this.data[bunSocketServerConnections]--;
    },
    end(socket) {
      Socket2.#Handlers.end(socket), this.data[bunSocketServerConnections]--;
    },
    open(socket) {
      const self = this.data, options = self[bunSocketServerOptions], { pauseOnConnect, connectionListener, InternalSocketClass, requestCert, rejectUnauthorized } = options, _socket = new InternalSocketClass({});
      if (_socket.isServer = !0, _socket._requestCert = requestCert, _socket._rejectUnauthorized = rejectUnauthorized, _socket.#attach(this.localPort, socket), self.maxConnections && self[bunSocketServerConnections] >= self.maxConnections) {
        const data = {
          localAddress: _socket.localAddress,
          localPort: _socket.localPort,
          localFamily: _socket.localFamily,
          remoteAddress: _socket.remoteAddress,
          remotePort: _socket.remotePort,
          remoteFamily: _socket.remoteFamily || "IPv4"
        };
        socket.end(), self.emit("drop", data);
        return;
      }
      if (!pauseOnConnect)
        _socket.resume();
      if (self[bunSocketServerConnections]++, typeof connectionListener == "function")
        if (InternalSocketClass.name === "TLSSocket")
          self.once("secureConnection", () => connectionListener(_socket));
        else
          connectionListener(_socket);
      self.emit("connection", _socket);
    },
    handshake(socket, success, verifyError) {
      const { data: self } = socket;
      if (self.emit("secure", self), self._securePending = !1, self.secureConnecting = !1, self._secureEstablished = !!success, self._requestCert || self._rejectUnauthorized) {
        if (verifyError) {
          if (self.authorized = !1, self.authorizationError = verifyError.code || verifyError.message, self._rejectUnauthorized) {
            self.destroy(verifyError);
            return;
          }
        }
      } else
        self.authorized = !0;
      self.emit("secureConnection", verifyError);
    },
    error(socket, error) {
      Socket2.#Handlers.error(socket, error), this.data.emit("error", error);
    },
    timeout: Socket2.#Handlers.timeout,
    connectError: Socket2.#Handlers.connectError,
    drain: Socket2.#Handlers.drain,
    binaryType: "buffer"
  };
  bytesRead = 0;
  bytesWritten = 0;
  #closed = !1;
  connecting = !1;
  localAddress = "127.0.0.1";
  #readQueue = createFIFO();
  remotePort;
  [bunSocketInternal] = null;
  [bunTLSConnectOptions] = null;
  timeout = 0;
  #writeCallback;
  #writeChunk;
  #pendingRead;
  isServer = !1;
  _handle;
  _parent;
  _parentWrap;
  #socket;
  #upgraded;
  constructor(options) {
    const { socket, signal, write, read, allowHalfOpen = !1, ...opts } = options || {};
    super({
      ...opts,
      allowHalfOpen,
      readable: !0,
      writable: !0
    });
    if (this._handle = this, this._parent = this, this._parentWrap = this, this.#pendingRead = void 0, this.#upgraded = !1, socket instanceof Socket2)
      this.#socket = socket;
    signal?.once("abort", () => this.destroy()), this.once("connect", () => this.emit("ready"));
  }
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
  #attach(port, socket) {
    if (this.remotePort = port, socket.data = this, socket.timeout(this.timeout), socket.ref(), this[bunSocketInternal] = socket, this.connecting = !1, !this.#upgraded)
      this.emit("connect", this);
    Socket2.#Drain(socket);
  }
  connect(port, host, connectListener) {
    var path, connection = this.#socket, _checkServerIdentity = void 0;
    if (typeof port === "string") {
      if (path = port, port = void 0, typeof host === "function")
        connectListener = host, host = void 0;
    } else if (typeof host == "function") {
      if (typeof port === "string")
        path = port, port = void 0;
      connectListener = host, host = void 0;
    }
    if (typeof port == "object") {
      var {
        port,
        host,
        path,
        socket,
        localAddress,
        localPort,
        family,
        hints,
        lookup,
        noDelay,
        keepAlive,
        keepAliveInitialDelay,
        requestCert,
        rejectUnauthorized,
        pauseOnConnect,
        servername,
        checkServerIdentity,
        session
      } = port;
      if (_checkServerIdentity = checkServerIdentity, this.servername = servername, socket)
        connection = socket;
    }
    if (!pauseOnConnect)
      this.resume();
    this.connecting = !0, this.remotePort = port;
    const bunTLS = this[bunTlsSymbol];
    var tls = void 0;
    if (typeof bunTLS === "function") {
      if (tls = bunTLS.call(this, port, host, !0), this._requestCert = !0, this._rejectUnauthorized = rejectUnauthorized, tls) {
        if (tls.rejectUnauthorized = rejectUnauthorized, tls.requestCert = !0, tls.session = session || tls.session, this.servername = tls.servername, tls.checkServerIdentity = _checkServerIdentity || tls.checkServerIdentity, this[bunTLSConnectOptions] = tls, !connection && tls.socket)
          connection = tls.socket;
      }
      if (connection) {
        if (typeof connection !== "object" || !(connection instanceof Socket2) || typeof connection[bunTlsSymbol] === "function")
          throw new TypeError("socket must be an instance of net.Socket");
      }
      if (this.authorized = !1, this.secureConnecting = !0, this._secureEstablished = !1, this._securePending = !0, connectListener)
        this.on("secureConnect", connectListener);
    } else if (connectListener)
      this.on("connect", connectListener);
    if (connection) {
      const socket2 = connection[bunSocketInternal];
      if (socket2) {
        this.connecting = !0, this.#upgraded = !0;
        const result = socket2.upgradeTLS({
          data: this,
          tls,
          socket: Socket2.#Handlers
        });
        if (result) {
          const [raw, tls2] = result;
          connection[bunSocketInternal] = raw, raw.timeout(raw.timeout), raw.connecting = !1, this[bunSocketInternal] = tls2;
        } else
          throw this[bunSocketInternal] = null, new Error("Invalid socket");
      } else
        connection.once("connect", () => {
          const socket3 = connection[bunSocketInternal];
          if (!socket3)
            return;
          this.connecting = !0, this.#upgraded = !0;
          const result = socket3.upgradeTLS({
            data: this,
            tls,
            socket: Socket2.#Handlers
          });
          if (result) {
            const [raw, tls2] = result;
            connection[bunSocketInternal] = raw, raw.timeout(raw.timeout), raw.connecting = !1, this[bunSocketInternal] = tls2;
          } else
            throw this[bunSocketInternal] = null, new Error("Invalid socket");
        });
    } else if (path)
      bunConnect({
        data: this,
        unix: path,
        socket: Socket2.#Handlers,
        tls
      }).catch((error) => {
        this.emit("error", error);
      });
    else
      bunConnect({
        data: this,
        hostname: host || "localhost",
        port,
        socket: Socket2.#Handlers,
        tls
      }).catch((error) => {
        this.emit("error", error);
      });
    return this;
  }
  _destroy(err, callback) {
    this[bunSocketInternal]?.end(), callback(err);
  }
  _final(callback) {
    this[bunSocketInternal]?.end(), callback();
  }
  get localAddress() {
    return "127.0.0.1";
  }
  get localFamily() {
    return "IPv4";
  }
  get localPort() {
    return this[bunSocketInternal]?.localPort;
  }
  get pending() {
    return this.connecting;
  }
  _read(size) {
    const queue = this.#readQueue;
    let chunk;
    while (chunk = queue.peek()) {
      if (!this.push(chunk))
        return;
      queue.shift();
    }
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
    this[bunSocketInternal]?.ref();
  }
  get remoteAddress() {
    return this[bunSocketInternal]?.remoteAddress;
  }
  get remoteFamily() {
    return "IPv4";
  }
  resetAndDestroy() {
    this[bunSocketInternal]?.end();
  }
  setKeepAlive(enable = !1, initialDelay = 0) {
    return this;
  }
  setNoDelay(noDelay = !0) {
    return this;
  }
  setTimeout(timeout, callback) {
    if (this[bunSocketInternal]?.timeout(timeout), this.timeout = timeout, callback)
      this.once("timeout", callback);
    return this;
  }
  unref() {
    this[bunSocketInternal]?.unref();
  }
  _write(chunk, encoding, callback) {
    if (typeof chunk == "string" && encoding !== "ascii")
      chunk = Buffer.from(chunk, encoding);
    var written = this[bunSocketInternal]?.write(chunk);
    if (written == chunk.length)
      callback();
    else if (this.#writeCallback)
      callback(new Error("overlapping _write()"));
    else {
      if (written > 0)
        if (typeof chunk == "string")
          chunk = chunk.slice(written);
        else
          chunk = chunk.subarray(written);
      this.#writeCallback = callback, this.#writeChunk = chunk;
    }
  }
}), connect = createConnection;

class Server extends EventEmitter {
  #server;
  #listening = !1;
  [bunSocketServerConnections] = 0;
  [bunSocketServerOptions];
  maxConnections = 0;
  constructor(options, connectionListener) {
    super();
    if (typeof options === "function")
      connectionListener = options, options = {};
    else if (options == null || typeof options === "object")
      options = { ...options };
    else
      throw new Error("bun-net-polyfill: invalid arguments");
    const { maxConnections } = options;
    this.maxConnections = Number.isSafeInteger(maxConnections) && maxConnections > 0 ? maxConnections : 0, options.connectionListener = connectionListener, this[bunSocketServerOptions] = options;
  }
  ref() {
    return this.#server?.ref(), this;
  }
  unref() {
    return this.#server?.unref(), this;
  }
  close(callback) {
    if (this.#server) {
      if (this.#server.stop(!0), this.#server = null, this.#listening = !1, this[bunSocketServerConnections] = 0, this.emit("close"), typeof callback === "function")
        callback();
      return this;
    }
    if (typeof callback === "function") {
      const error = new Error("Server is not running");
      error.code = "ERR_SERVER_NOT_RUNNING", callback(error);
    }
    return this;
  }
  address() {
    const server = this.#server;
    if (server) {
      const unix = server.unix;
      if (unix)
        return unix;
      let address = server.hostname;
      const type = isIP(address), port = server.port;
      if (typeof port === "number")
        return {
          port,
          address,
          family: type ? `IPv${type}` : void 0
        };
      if (type)
        return {
          address,
          family: type ? `IPv${type}` : void 0
        };
      return address;
    }
    return null;
  }
  getConnections(callback) {
    if (typeof callback === "function")
      callback(null, this.#server ? this[bunSocketServerConnections] : 0);
    return this;
  }
  listen(port, hostname, onListen) {
    let backlog, path, exclusive = !1;
    if (typeof port === "string") {
      if (Number.isSafeInteger(hostname)) {
        if (hostname > 0)
          backlog = hostname;
      } else if (typeof hostname === "function")
        onListen = hostname;
      path = port, hostname = void 0, port = void 0;
    } else {
      if (typeof hostname === "function")
        onListen = hostname, hostname = void 0;
      if (typeof port === "function")
        onListen = port, port = 0;
      else if (typeof port === "object") {
        const options = port;
        options.signal?.addEventListener("abort", () => this.close()), hostname = options.host, exclusive = options.exclusive === !0;
        const path2 = options.path;
        if (port = options.port, !Number.isSafeInteger(port) || port < 0)
          if (path2)
            hostname = path2, port = void 0;
          else {
            let message = 'The argument \'options\' must have the property "port" or "path"';
            try {
              message = `${message}. Received ${JSON.stringify(options)}`;
            } catch {
            }
            const error = new TypeError(message);
            throw error.code = "ERR_INVALID_ARG_VALUE", error;
          }
        else if (!Number.isSafeInteger(port) || port < 0)
          port = 0;
        if (typeof port.callback === "function")
          onListen = port?.callback;
      } else if (!Number.isSafeInteger(port) || port < 0)
        port = 0;
      hostname = hostname || "::";
    }
    try {
      var tls = void 0, TLSSocketClass = void 0;
      const bunTLS = this[bunTlsSymbol], options = this[bunSocketServerOptions];
      if (typeof bunTLS === "function")
        [tls, TLSSocketClass] = bunTLS.call(this, port, hostname, !1), options.servername = tls.serverName, options.InternalSocketClass = TLSSocketClass;
      else
        options.InternalSocketClass = SocketClass;
      this.#server = Bun.listen(path ? {
        exclusive,
        unix: path,
        tls,
        socket: SocketClass[bunSocketServerHandlers]
      } : {
        exclusive,
        port,
        hostname,
        tls,
        socket: SocketClass[bunSocketServerHandlers]
      }), this.#server.data = this, this.#listening = !0, setTimeout(emitListeningNextTick, 1, this, onListen);
    } catch (err) {
      this.#listening = !1, setTimeout(emitErrorNextTick, 1, this, err);
    }
    return this;
  }
}
var net_default = {
  createServer,
  Server,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  [Symbol.for("CommonJS")]: 0,
  [Symbol.for("::bunternal::")]: SocketClass
};
export {
  isIPv6,
  isIPv4,
  isIP,
  net_default as default,
  createServer,
  createConnection,
  connect,
  Socket,
  Server
};
