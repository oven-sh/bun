(function (){"use strict";// build3/tmp/node/net.ts
var isIPv4 = function(s) {
  return IPv4Reg.test(s);
};
var isIPv6 = function(s) {
  return IPv6Reg.test(s);
};
var isIP = function(s) {
  if (isIPv4(s))
    return 4;
  if (isIPv6(s))
    return 6;
  return 0;
};
var closeNT = function(self) {
  self.emit("close");
};
var endNT = function(socket, callback, err) {
  socket.end();
  callback(err);
};
var createConnection = function(port, host, connectListener) {
  if (typeof port === "object") {
    return new Socket(port).connect(port, host, connectListener);
  }
  return new Socket().connect(port, host, connectListener);
};
var emitErrorNextTick = function(self, error) {
  self.emit("error", error);
};
var emitErrorAndCloseNextTick = function(self, error) {
  self.emit("error", error);
  self.emit("close");
};
var emitListeningNextTick = function(self, onListen) {
  if (typeof onListen === "function") {
    try {
      onListen();
    } catch (err) {
      self.emit("error", err);
    }
  }
  self.emit("listening");
};
var createServer = function(options, connectionListener) {
  return new Server(options, connectionListener);
};
var $;
var { Duplex } = @getInternalField(@internalModuleRegistry, 39) || @createInternalModuleById(39);
var EventEmitter = @getInternalField(@internalModuleRegistry, 20) || @createInternalModuleById(20);
var v4Seg = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
var v4Str = `(${v4Seg}[.]){3}${v4Seg}`;
var IPv4Reg = new @RegExp(`^${v4Str}\$`);
var v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg = new @RegExp("^(" + `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` + `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` + `(?:${v6Seg}:){5}(?::${v4Str}|(:${v6Seg}){1,2}|:)|` + `(?:${v6Seg}:){4}(?:(:${v6Seg}){0,1}:${v4Str}|(:${v6Seg}){1,3}|:)|` + `(?:${v6Seg}:){3}(?:(:${v6Seg}){0,2}:${v4Str}|(:${v6Seg}){1,4}|:)|` + `(?:${v6Seg}:){2}(?:(:${v6Seg}){0,3}:${v4Str}|(:${v6Seg}){1,5}|:)|` + `(?:${v6Seg}:){1}(?:(:${v6Seg}){0,4}:${v4Str}|(:${v6Seg}){1,6}|:)|` + `(?::((?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` + ")(%[0-9a-zA-Z-.:]{1,})?$");
var { connect: bunConnect } = Bun;
var { setTimeout } = globalThis;
var bunTlsSymbol = Symbol.for("::buntls::");
var bunSocketServerHandlers = Symbol.for("::bunsocket_serverhandlers::");
var bunSocketServerConnections = Symbol.for("::bunnetserverconnections::");
var bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
var bunSocketInternal = Symbol.for("::bunnetsocketinternal::");
var bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
var SocketClass;
var Socket = function(InternalSocket) {
  SocketClass = InternalSocket;
  Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "Socket",
    enumerable: false
  });
  function Socket3(options) {
    return new InternalSocket(options);
  }
  Socket3.prototype = InternalSocket.prototype;
  return Object.defineProperty(Socket3, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalSocket;
    }
  });
}(class Socket2 extends Duplex {
  static #Handlers = {
    close: Socket2.#Close,
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
      const self = socket.data;
      const callback = self.#writeCallback;
      if (callback) {
        self.#writeCallback = null;
        callback(error);
      }
      self.emit("error", error);
    },
    open(socket) {
      const self = socket.data;
      socket.timeout(self.timeout);
      socket.ref();
      self[bunSocketInternal] = socket;
      self.connecting = false;
      const options = self[bunTLSConnectOptions];
      if (options) {
        const { session } = options;
        if (session) {
          self.setSession(session);
        }
      }
      if (!self.#upgraded) {
        self.emit("connect", self);
      }
      Socket2.#Drain(socket);
    },
    handshake(socket, success, verifyError) {
      const { data: self } = socket;
      self._securePending = false;
      self.secureConnecting = false;
      self._secureEstablished = !!success;
      self.emit("secure", self);
      const { checkServerIdentity } = self[bunTLSConnectOptions];
      if (!verifyError && typeof checkServerIdentity === "function" && self.servername) {
        const cert = self.getPeerCertificate(true);
        verifyError = checkServerIdentity(self.servername, cert);
      }
      if (self._requestCert || self._rejectUnauthorized) {
        if (verifyError) {
          self.authorized = false;
          self.authorizationError = verifyError.code || verifyError.message;
          if (self._rejectUnauthorized) {
            self.destroy(verifyError);
            return;
          }
        }
      } else {
        self.authorized = true;
      }
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
    self.#closed = true;
    self[bunSocketInternal] = null;
    const queue = self.#readQueue;
    if (queue.isEmpty()) {
      if (self.push(null))
        return;
    }
    queue.push(null);
  }
  static #Drain(socket) {
    const self = socket.data;
    const callback = self.#writeCallback;
    if (callback) {
      const chunk = self.#writeChunk;
      const written = socket.write(chunk);
      self.bytesWritten += written;
      if (written < chunk.length) {
        self.#writeChunk = chunk.slice(written);
      } else {
        self.#writeCallback = null;
        self.#writeChunk = null;
        callback(null);
      }
    }
  }
  static [bunSocketServerHandlers] = {
    data: Socket2.#Handlers.data,
    close(socket) {
      Socket2.#Handlers.close(socket);
      this.data[bunSocketServerConnections]--;
    },
    end(socket) {
      Socket2.#Handlers.end(socket);
      this.data[bunSocketServerConnections]--;
    },
    open(socket) {
      const self = this.data;
      const options = self[bunSocketServerOptions];
      const { pauseOnConnect, connectionListener, InternalSocketClass, requestCert, rejectUnauthorized } = options;
      const _socket = new InternalSocketClass({});
      _socket.isServer = true;
      _socket._requestCert = requestCert;
      _socket._rejectUnauthorized = rejectUnauthorized;
      _socket.#attach(this.localPort, socket);
      if (self.maxConnections && self[bunSocketServerConnections] >= self.maxConnections) {
        const data = {
          localAddress: _socket.localAddress,
          localPort: _socket.localPort,
          localFamily: _socket.localFamily,
          remoteAddress: _socket.remoteAddress,
          remotePort: _socket.remotePort,
          remoteFamily: _socket.remoteFamily || "IPv4"
        };
        socket.end();
        self.emit("drop", data);
        return;
      }
      if (!pauseOnConnect) {
        _socket.resume();
      }
      self[bunSocketServerConnections]++;
      if (typeof connectionListener == "function") {
        if (InternalSocketClass.name === "TLSSocket") {
          self.once("secureConnection", () => connectionListener(_socket));
        } else {
          connectionListener(_socket);
        }
      }
      self.emit("connection", _socket);
    },
    handshake(socket, success, verifyError) {
      const { data: self } = socket;
      self.emit("secure", self);
      self._securePending = false;
      self.secureConnecting = false;
      self._secureEstablished = !!success;
      if (self._requestCert || self._rejectUnauthorized) {
        if (verifyError) {
          self.authorized = false;
          self.authorizationError = verifyError.code || verifyError.message;
          if (self._rejectUnauthorized) {
            self.destroy(verifyError);
            return;
          }
        }
      } else {
        self.authorized = true;
      }
      self.emit("secureConnection", verifyError);
    },
    error(socket, error) {
      Socket2.#Handlers.error(socket, error);
      this.data.emit("error", error);
    },
    timeout: Socket2.#Handlers.timeout,
    connectError: Socket2.#Handlers.connectError,
    drain: Socket2.#Handlers.drain,
    binaryType: "buffer"
  };
  bytesRead = 0;
  bytesWritten = 0;
  #closed = false;
  connecting = false;
  localAddress = "127.0.0.1";
  #readQueue = @createFIFO();
  remotePort;
  [bunSocketInternal] = null;
  [bunTLSConnectOptions] = null;
  timeout = 0;
  #writeCallback;
  #writeChunk;
  #pendingRead;
  isServer = false;
  _handle;
  _parent;
  _parentWrap;
  #socket;
  #upgraded;
  constructor(options) {
    const { socket, signal, write, read, allowHalfOpen = false, ...opts } = options || {};
    super({
      ...opts,
      allowHalfOpen,
      readable: true,
      writable: true
    });
    this._handle = this;
    this._parent = this;
    this._parentWrap = this;
    this.#pendingRead = @undefined;
    this.#upgraded = null;
    if (socket instanceof Socket2) {
      this.#socket = socket;
    }
    signal?.once("abort", () => this.destroy());
    this.once("connect", () => this.emit("ready"));
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
    this.remotePort = port;
    socket.data = this;
    socket.timeout(this.timeout);
    socket.ref();
    this[bunSocketInternal] = socket;
    this.connecting = false;
    if (!this.#upgraded) {
      this.emit("connect", this);
    }
    Socket2.#Drain(socket);
  }
  #closeRawConnection() {
    const connection = this.#upgraded;
    connection[bunSocketInternal] = null;
    connection.unref();
    connection.destroy();
    process.nextTick(closeNT, connection);
  }
  connect(port, host, connectListener) {
    var path;
    var connection = this.#socket;
    var _checkServerIdentity = @undefined;
    if (typeof port === "string") {
      path = port;
      port = @undefined;
      if (typeof host === "function") {
        connectListener = host;
        host = @undefined;
      }
    } else if (typeof host == "function") {
      if (typeof port === "string") {
        path = port;
        port = @undefined;
      }
      connectListener = host;
      host = @undefined;
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
      _checkServerIdentity = checkServerIdentity;
      this.servername = servername;
      if (socket) {
        connection = socket;
      }
    }
    if (!pauseOnConnect) {
      this.resume();
    }
    this.connecting = true;
    this.remotePort = port;
    const bunTLS = this[bunTlsSymbol];
    var tls = @undefined;
    if (typeof bunTLS === "function") {
      tls = bunTLS.@call(this, port, host, true);
      this._requestCert = true;
      this._rejectUnauthorized = rejectUnauthorized;
      if (tls) {
        tls.rejectUnauthorized = rejectUnauthorized;
        tls.requestCert = true;
        tls.session = session || tls.session;
        this.servername = tls.servername;
        tls.checkServerIdentity = _checkServerIdentity || tls.checkServerIdentity;
        this[bunTLSConnectOptions] = tls;
        if (!connection && tls.socket) {
          connection = tls.socket;
        }
      }
      if (connection) {
        if (typeof connection !== "object" || !(connection instanceof Socket2) || typeof connection[bunTlsSymbol] === "function") {
          @throwTypeError("socket must be an instance of net.Socket");
        }
      }
      this.authorized = false;
      this.secureConnecting = true;
      this._secureEstablished = false;
      this._securePending = true;
      if (connectListener)
        this.on("secureConnect", connectListener);
    } else if (connectListener)
      this.on("connect", connectListener);
    try {
      if (connection) {
        const socket2 = connection[bunSocketInternal];
        if (socket2) {
          this.connecting = true;
          this.#upgraded = connection;
          const result = socket2.upgradeTLS({
            data: this,
            tls,
            socket: Socket2.#Handlers
          });
          if (result) {
            const [raw, tls2] = result;
            connection[bunSocketInternal] = raw;
            raw.timeout(raw.timeout);
            this.once("end", this.#closeRawConnection);
            raw.connecting = false;
            this[bunSocketInternal] = tls2;
          } else {
            this[bunSocketInternal] = null;
            throw new Error("Invalid socket");
          }
        } else {
          connection.once("connect", () => {
            const socket3 = connection[bunSocketInternal];
            if (!socket3)
              return;
            this.connecting = true;
            this.#upgraded = connection;
            const result = socket3.upgradeTLS({
              data: this,
              tls,
              socket: Socket2.#Handlers
            });
            if (result) {
              const [raw, tls2] = result;
              connection[bunSocketInternal] = raw;
              raw.timeout(raw.timeout);
              this.once("end", this.#closeRawConnection);
              raw.connecting = false;
              this[bunSocketInternal] = tls2;
            } else {
              this[bunSocketInternal] = null;
              throw new Error("Invalid socket");
            }
          });
        }
      } else if (path) {
        bunConnect({
          data: this,
          unix: path,
          socket: Socket2.#Handlers,
          tls
        }).catch((error) => {
          this.emit("error", error);
          this.emit("close");
        });
      } else {
        bunConnect({
          data: this,
          hostname: host || "localhost",
          port,
          socket: Socket2.#Handlers,
          tls
        }).catch((error) => {
          this.emit("error", error);
          this.emit("close");
        });
      }
    } catch (error) {
      process.nextTick(emitErrorAndCloseNextTick, this, error);
    }
    return this;
  }
  _destroy(err, callback) {
    const socket = this[bunSocketInternal];
    socket && process.nextTick(endNT, socket, callback, err);
  }
  _final(callback) {
    this[bunSocketInternal]?.end();
    callback();
    process.nextTick(closeNT, this);
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
      const can_continue = !this.push(chunk);
      queue.shift();
      if (!can_continue)
        break;
    }
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
  setKeepAlive(enable = false, initialDelay = 0) {
    return this;
  }
  setNoDelay(noDelay = true) {
    return this;
  }
  setTimeout(timeout, callback) {
    this[bunSocketInternal]?.timeout(timeout);
    this.timeout = timeout;
    if (callback)
      this.once("timeout", callback);
    return this;
  }
  unref() {
    this[bunSocketInternal]?.unref();
  }
  _write(chunk, encoding, callback) {
    if (typeof chunk == "string" && encoding !== "ascii")
      chunk = @Buffer.from(chunk, encoding);
    var written = this[bunSocketInternal]?.write(chunk);
    if (written == chunk.length) {
      callback();
    } else if (this.#writeCallback) {
      callback(new Error("overlapping _write()"));
    } else {
      if (written > 0) {
        if (typeof chunk == "string") {
          chunk = chunk.slice(written);
        } else {
          chunk = chunk.subarray(written);
        }
      }
      this.#writeCallback = callback;
      this.#writeChunk = chunk;
    }
  }
});
var connect = createConnection;

class Server extends EventEmitter {
  #server;
  #listening = false;
  [bunSocketServerConnections] = 0;
  [bunSocketServerOptions];
  maxConnections = 0;
  constructor(options, connectionListener) {
    super();
    if (typeof options === "function") {
      connectionListener = options;
      options = {};
    } else if (options == null || typeof options === "object") {
      options = { ...options };
    } else {
      throw new Error("bun-net-polyfill: invalid arguments");
    }
    const { maxConnections } = options;
    this.maxConnections = Number.isSafeInteger(maxConnections) && maxConnections > 0 ? maxConnections : 0;
    options.connectionListener = connectionListener;
    this[bunSocketServerOptions] = options;
  }
  ref() {
    this.#server?.ref();
    return this;
  }
  unref() {
    this.#server?.unref();
    return this;
  }
  close(callback) {
    if (this.#server) {
      this.#server.stop(true);
      this.#server = null;
      this.#listening = false;
      this[bunSocketServerConnections] = 0;
      this.emit("close");
      if (typeof callback === "function") {
        callback();
      }
      return this;
    }
    if (typeof callback === "function") {
      const error = new Error("Server is not running");
      error.code = "ERR_SERVER_NOT_RUNNING";
      callback(error);
    }
    return this;
  }
  address() {
    const server = this.#server;
    if (server) {
      const unix = server.unix;
      if (unix) {
        return unix;
      }
      let address = server.hostname;
      const type = isIP(address);
      const port = server.port;
      if (typeof port === "number") {
        return {
          port,
          address,
          family: type ? `IPv${type}` : @undefined
        };
      }
      if (type) {
        return {
          address,
          family: type ? `IPv${type}` : @undefined
        };
      }
      return address;
    }
    return null;
  }
  getConnections(callback) {
    if (typeof callback === "function") {
      callback(null, this.#server ? this[bunSocketServerConnections] : 0);
    }
    return this;
  }
  listen(port, hostname, onListen) {
    let backlog;
    let path;
    let exclusive = false;
    if (typeof port === "string") {
      if (Number.isSafeInteger(hostname)) {
        if (hostname > 0) {
          backlog = hostname;
        }
      } else if (typeof hostname === "function") {
        onListen = hostname;
      }
      path = port;
      hostname = @undefined;
      port = @undefined;
    } else {
      if (typeof hostname === "function") {
        onListen = hostname;
        hostname = @undefined;
      }
      if (typeof port === "function") {
        onListen = port;
        port = 0;
      } else if (typeof port === "object") {
        const options = port;
        options.signal?.addEventListener("abort", () => this.close());
        hostname = options.host;
        exclusive = options.exclusive === true;
        const path2 = options.path;
        port = options.port;
        if (!Number.isSafeInteger(port) || port < 0) {
          if (path2) {
            hostname = path2;
            port = @undefined;
          } else {
            let message = 'The argument \'options\' must have the property "port" or "path"';
            try {
              message = `${message}. Received ${JSON.stringify(options)}`;
            } catch {
            }
            const error = @makeTypeError(message);
            error.code = "ERR_INVALID_ARG_VALUE";
            throw error;
          }
        } else if (!Number.isSafeInteger(port) || port < 0) {
          port = 0;
        }
        if (typeof port.callback === "function")
          onListen = port?.callback;
      } else if (!Number.isSafeInteger(port) || port < 0) {
        port = 0;
      }
      hostname = hostname || "::";
    }
    try {
      var tls = @undefined;
      var TLSSocketClass = @undefined;
      const bunTLS = this[bunTlsSymbol];
      const options = this[bunSocketServerOptions];
      if (typeof bunTLS === "function") {
        [tls, TLSSocketClass] = bunTLS.@call(this, port, hostname, false);
        options.servername = tls.serverName;
        options.InternalSocketClass = TLSSocketClass;
      } else {
        options.InternalSocketClass = SocketClass;
      }
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
      });
      this.#server.data = this;
      this.#listening = true;
      setTimeout(emitListeningNextTick, 1, this, onListen);
    } catch (err) {
      this.#listening = false;
      setTimeout(emitErrorNextTick, 1, this, err);
    }
    return this;
  }
}
$ = {
  createServer,
  Server,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  [Symbol.for("::bunternal::")]: SocketClass
};
return $})
