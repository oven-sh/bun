// Hardcoded module "node:net"
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
const { Duplex } = require("node:stream");
const EventEmitter = require("node:events");

// IPv4 Segment
const v4Seg = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
var IPv4Reg;

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg;

function isIPv4(s) {
  return (IPv4Reg ??= new RegExp(`^${v4Str}$`)).test(s);
}

function isIPv6(s) {
  return (IPv6Reg ??= new RegExp(
    "^(?:" +
      `(?:${v6Seg}:){7}(?:${v6Seg}|:)|` +
      `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)|` +
      `(?:${v6Seg}:){5}(?::${v4Str}|(?::${v6Seg}){1,2}|:)|` +
      `(?:${v6Seg}:){4}(?:(?::${v6Seg}){0,1}:${v4Str}|(?::${v6Seg}){1,3}|:)|` +
      `(?:${v6Seg}:){3}(?:(?::${v6Seg}){0,2}:${v4Str}|(?::${v6Seg}){1,4}|:)|` +
      `(?:${v6Seg}:){2}(?:(?::${v6Seg}){0,3}:${v4Str}|(?::${v6Seg}){1,5}|:)|` +
      `(?:${v6Seg}:){1}(?:(?::${v6Seg}){0,4}:${v4Str}|(?::${v6Seg}){1,6}|:)|` +
      `(?::(?:(?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))` +
      ")(?:%[0-9a-zA-Z-.:]{1,})?$",
  )).test(s);
}

function isIP(s) {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

const { connect: bunConnect } = Bun;
var { setTimeout } = globalThis;

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerHandlers = Symbol.for("::bunsocket_serverhandlers::");
const bunSocketServerConnections = Symbol.for("::bunnetserverconnections::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");

const bunSocketInternal = Symbol.for("::bunnetsocketinternal::");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
function closeNT(self) {
  self.emit("close");
}
function endNT(socket, callback, err) {
  socket.end();
  callback(err);
}

var SocketClass;
const Socket = (function (InternalSocket) {
  SocketClass = InternalSocket;
  Object.defineProperty(SocketClass.prototype, Symbol.toStringTag, {
    value: "Socket",
    enumerable: false,
  });

  function Socket(options) {
    return new InternalSocket(options);
  }
  Socket.prototype = InternalSocket.prototype;
  return Object.defineProperty(Socket, Symbol.hasInstance, {
    value(instance) {
      return instance instanceof InternalSocket;
    },
  });
})(
  class Socket extends Duplex {
    static #Handlers = {
      close: Socket.#Close,
      data({ data: self }, buffer) {
        if (!self) return;

        self.bytesRead += buffer.length;
        const queue = self.#readQueue;

        if (queue.isEmpty()) {
          if (self.push(buffer)) return;
        }
        queue.push(buffer);
      },
      drain: Socket.#Drain,
      end: Socket.#Close,
      error(socket, error) {
        const self = socket.data;
        if (!self) return;

        const callback = self.#writeCallback;
        if (callback) {
          self.#writeCallback = null;
          callback(error);
        }
        self.emit("error", error);
      },
      open(socket) {
        const self = socket.data;
        if (!self) return;

        socket.timeout(self.timeout);
        if (self.#unrefOnConnected) socket.unref();
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
          // this is not actually emitted on nodejs when socket used on the connection
          // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
          self.emit("connect", self);
        }

        Socket.#Drain(socket);
      },
      handshake(socket, success, verifyError) {
        const { data: self } = socket;
        if (!self) return;

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
              self.emit("error", verifyError);
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
        if (!self) return;

        self.emit("timeout", self);
      },
      binaryType: "buffer",
    };

    static #Close(socket) {
      const self = socket.data;
      if (!self || self.#closed) return;
      self.#closed = true;
      //socket cannot be used after close
      self[bunSocketInternal] = null;
      const queue = self.#readQueue;
      if (queue.isEmpty()) {
        if (self.push(null)) return;
      }
      queue.push(null);
    }

    static #Drain(socket) {
      const self = socket.data;
      if (!self) return;
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
      data: Socket.#Handlers.data,
      close(socket) {
        Socket.#Handlers.close(socket);
        this.data[bunSocketServerConnections]--;
      },
      end(socket) {
        Socket.#Handlers.end(socket);
        this.data[bunSocketServerConnections]--;
      },
      open(socket) {
        const self = this.data;
        const options = self[bunSocketServerOptions];
        const { pauseOnConnect, connectionListener, InternalSocketClass, requestCert, rejectUnauthorized } = options;
        const _socket = new InternalSocketClass({});
        _socket.isServer = true;
        _socket.server = self;
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
            remoteFamily: _socket.remoteFamily || "IPv4",
          };

          socket.end();

          self.emit("drop", data);
          return;
        }

        const bunTLS = _socket[bunTlsSymbol];
        const isTLS = typeof bunTLS === "function";

        self[bunSocketServerConnections]++;

        if (typeof connectionListener == "function") {
          this.pauseOnConnect = pauseOnConnect;
          if (isTLS) {
            // add secureConnection event handler
            self.once("secureConnection", () => connectionListener(_socket));
          } else {
            connectionListener(_socket);
          }
        }
        self.emit("connection", _socket);
        // the duplex implementation start paused, so we resume when pauseOnConnect is falsy
        if (!pauseOnConnect && !isTLS) {
          _socket.resume();
        }
      },
      handshake(socket, success, verifyError) {
        const { data: self } = socket;
        self._securePending = false;
        self.secureConnecting = false;
        self._secureEstablished = !!success;
        const server = self.server;
        if (self._requestCert || self._rejectUnauthorized) {
          if (verifyError) {
            self.authorized = false;
            self.authorizationError = verifyError.code || verifyError.message;
            server.emit("tlsClientError", verifyError, self);
            if (self._rejectUnauthorized) {
              // if we reject we still need to emit secure
              self.emit("secure", self);
              self.destroy(verifyError);
              return;
            }
          }
        } else {
          self.authorized = true;
        }
        self.server.emit("secureConnection", self);
        // after secureConnection event we emmit secure and secureConnect
        self.emit("secure", self);
        self.emit("secureConnect", verifyError);
        if (!server.pauseOnConnect) {
          self.resume();
        }
      },
      error(socket, error) {
        Socket.#Handlers.error(socket, error);
        this.data.emit("error", error);
      },
      timeout: Socket.#Handlers.timeout,
      connectError: Socket.#Handlers.connectError,
      drain: Socket.#Handlers.drain,
      binaryType: "buffer",
    };

    bytesRead = 0;
    bytesWritten = 0;
    #closed = false;
    connecting = false;
    localAddress = "127.0.0.1";
    #readQueue = $createFIFO();
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
    server;
    pauseOnConnect = false;
    #upgraded;
    #unrefOnConnected = false;

    constructor(options) {
      const { socket, signal, write, read, allowHalfOpen = false, ...opts } = options || {};
      super({
        ...opts,
        allowHalfOpen,
        readable: true,
        writable: true,
      });
      this._handle = this;
      this._parent = this;
      this._parentWrap = this;
      this.#pendingRead = undefined;
      this.#upgraded = null;
      if (socket instanceof Socket) {
        this.#socket = socket;
      }

      if (signal) {
        signal.addEventListener("abort", () => this.destroy());
      }
      this.once("connect", () => this.emit("ready"));
    }

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

    #attach(port, socket) {
      this.remotePort = port;
      socket.data = this;
      socket.timeout(this.timeout);
      if (this.#unrefOnConnected) socket.unref();
      this[bunSocketInternal] = socket;
      this.connecting = false;
      if (!this.#upgraded) {
        // this is not actually emitted on nodejs when socket used on the connection
        // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
        this.emit("connect", this);
      }
      Socket.#Drain(socket);
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
      var _checkServerIdentity = undefined;
      if (typeof port === "string") {
        path = port;
        port = undefined;

        if (typeof host === "function") {
          connectListener = host;
          host = undefined;
        }
      } else if (typeof host == "function") {
        if (typeof port === "string") {
          path = port;
          port = undefined;
        }

        connectListener = host;
        host = undefined;
      }
      if (typeof port == "object") {
        var {
          fd,
          port,
          host,
          path,
          socket,
          // TODOs
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
          session,
        } = port;
        _checkServerIdentity = checkServerIdentity;
        this.servername = servername;
        if (socket) {
          connection = socket;
        }
        if (fd) {
          bunConnect({
            data: this,
            fd,
            socket: Socket.#Handlers,
            tls,
          }).catch(error => {
            this.emit("error", error);
            this.emit("close");
          });
        }
      }

      this.pauseOnConnect = pauseOnConnect;
      if (!pauseOnConnect) {
        process.nextTick(() => {
          this.resume();
        });
        this.connecting = true;
      }

      if (fd) {
        return this;
      }

      this.remotePort = port;

      const bunTLS = this[bunTlsSymbol];
      var tls = undefined;

      if (typeof bunTLS === "function") {
        tls = bunTLS.$call(this, port, host, true);
        // Client always request Cert
        this._requestCert = true;

        if (tls) {
          if (typeof rejectUnauthorized !== "undefined") {
            this._rejectUnauthorized = rejectUnauthorized;
            tls.rejectUnauthorized = rejectUnauthorized;
          } else {
            this._rejectUnauthorized = tls.rejectUnauthorized;
          }
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
          if (
            typeof connection !== "object" ||
            !(connection instanceof Socket) ||
            typeof connection[bunTlsSymbol] === "function"
          ) {
            throw new TypeError("socket must be an instance of net.Socket");
          }
        }
        this.authorized = false;
        this.secureConnecting = true;
        this._secureEstablished = false;
        this._securePending = true;

        if (connectListener) this.on("secureConnect", connectListener);
      } else if (connectListener) this.on("connect", connectListener);

      // start using existing connection
      try {
        if (connection) {
          const socket = connection[bunSocketInternal];

          if (socket) {
            this.connecting = true;
            this.#upgraded = connection;
            const result = socket.upgradeTLS({
              data: this,
              tls,
              socket: Socket.#Handlers,
            });
            if (result) {
              const [raw, tls] = result;
              // replace socket
              connection[bunSocketInternal] = raw;
              raw.timeout(raw.timeout);
              this.once("end", this.#closeRawConnection);
              raw.connecting = false;
              this[bunSocketInternal] = tls;
            } else {
              this[bunSocketInternal] = null;
              throw new Error("Invalid socket");
            }
          } else {
            // wait to be connected
            connection.once("connect", () => {
              const socket = connection[bunSocketInternal];
              if (!socket) return;

              this.connecting = true;
              this.#upgraded = connection;
              const result = socket.upgradeTLS({
                data: this,
                tls,
                socket: Socket.#Handlers,
              });

              if (result) {
                const [raw, tls] = result;
                // replace socket
                connection[bunSocketInternal] = raw;
                raw.timeout(raw.timeout);
                this.once("end", this.#closeRawConnection);
                raw.connecting = false;
                this[bunSocketInternal] = tls;
              } else {
                this[bunSocketInternal] = null;
                throw new Error("Invalid socket");
              }
            });
          }
        } else if (path) {
          // start using unix socket
          bunConnect({
            data: this,
            unix: path,
            socket: Socket.#Handlers,
            tls,
          }).catch(error => {
            this.emit("error", error);
            this.emit("close");
          });
        } else {
          // default start
          bunConnect({
            data: this,
            hostname: host || "localhost",
            port: port,
            socket: Socket.#Handlers,
            tls,
          }).catch(error => {
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
      while ((chunk = queue.peek())) {
        const can_continue = !this.push(chunk);
        // always remove from queue push will queue it internally if needed
        queue.shift();
        if (!can_continue) break;
      }
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
      const socket = this[bunSocketInternal];
      if (!socket) {
        this.#unrefOnConnected = false;
        return;
      }
      socket.ref();
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
      // TODO
      return this;
    }

    setNoDelay(noDelay = true) {
      // TODO
      return this;
    }

    setTimeout(timeout, callback) {
      this[bunSocketInternal]?.timeout(timeout);
      this.timeout = timeout;
      if (callback) this.once("timeout", callback);
      return this;
    }

    unref() {
      const socket = this[bunSocketInternal];
      if (!socket) {
        this.#unrefOnConnected = true;
        return;
      }
      socket.unref();
    }

    _write(chunk, encoding, callback) {
      if (typeof chunk == "string" && encoding !== "ascii") chunk = Buffer.from(chunk, encoding);
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
  },
);

function createConnection(port, host, connectListener) {
  if (typeof port === "object") {
    // port is option pass Socket options and let connect handle connection options
    return new Socket(port).connect(port, host, connectListener);
  }
  // port is path or host, let connect handle this
  return new Socket().connect(port, host, connectListener);
}

const connect = createConnection;

class Server extends EventEmitter {
  #server;
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

  get listening() {
    return !!this.#server;
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

      //TODO: fix adress when host is passed
      let address = server.hostname;
      const type = isIP(address);
      const port = server.port;
      if (typeof port === "number") {
        return {
          port,
          address,
          family: type ? `IPv${type}` : undefined,
        };
      }
      if (type) {
        return {
          address,
          family: type ? `IPv${type}` : undefined,
        };
      }

      return address;
    }
    return null;
  }

  getConnections(callback) {
    if (typeof callback === "function") {
      //in Bun case we will never error on getConnections
      //node only errors if in the middle of the couting the server got disconnected, what never happens in Bun
      //if disconnected will only pass null as well and 0 connected
      callback(null, this.#server ? this[bunSocketServerConnections] : 0);
    }
    return this;
  }

  listen(port, hostname, onListen) {
    let backlog;
    let path;
    let exclusive = false;
    //port is actually path
    if (typeof port === "string") {
      if (Number.isSafeInteger(hostname)) {
        if (hostname > 0) {
          //hostname is backlog
          backlog = hostname;
        }
      } else if (typeof hostname === "function") {
        //hostname is callback
        onListen = hostname;
      }

      path = port;
      hostname = undefined;
      port = undefined;
    } else {
      if (typeof hostname === "function") {
        onListen = hostname;
        hostname = undefined;
      }

      if (typeof port === "function") {
        onListen = port;
        port = 0;
      } else if (typeof port === "object") {
        const options = port;
        options.signal?.addEventListener("abort", () => this.close());

        hostname = options.host;
        exclusive = options.exclusive === true;
        const path = options.path;
        port = options.port;

        if (!Number.isSafeInteger(port) || port < 0) {
          if (path) {
            hostname = path;
            port = undefined;
          } else {
            let message = 'The argument \'options\' must have the property "port" or "path"';
            try {
              message = `${message}. Received ${JSON.stringify(options)}`;
            } catch {}

            const error = new TypeError(message);
            error.code = "ERR_INVALID_ARG_VALUE";
            throw error;
          }
        } else if (!Number.isSafeInteger(port) || port < 0) {
          port = 0;
        }

        // port <number>
        // host <string>
        // path <string> Will be ignored if port is specified. See Identifying paths for IPC connections.
        // backlog <number> Common parameter of server.listen() functions.
        // exclusive <boolean> Default: false
        // readableAll <boolean> For IPC servers makes the pipe readable for all users. Default: false.
        // writableAll <boolean> For IPC servers makes the pipe writable for all users. Default: false.
        // ipv6Only <boolean> For TCP servers, setting ipv6Only to true will disable dual-stack support, i.e., binding to host :: won't make 0.0.0.0 be bound. Default: false.
        // signal <AbortSignal> An AbortSignal that may be used to close a listening server.

        if (typeof port.callback === "function") onListen = port?.callback;
      } else if (!Number.isSafeInteger(port) || port < 0) {
        port = 0;
      }
      hostname = hostname || "::";
    }

    try {
      var tls = undefined;
      var TLSSocketClass = undefined;
      const bunTLS = this[bunTlsSymbol];
      const options = this[bunSocketServerOptions];

      if (typeof bunTLS === "function") {
        [tls, TLSSocketClass] = bunTLS.$call(this, port, hostname, false);
        options.servername = tls.serverName;
        options.InternalSocketClass = TLSSocketClass;
        if (!tls.requestCert) {
          tls.rejectUnauthorized = false;
        }
      } else {
        options.InternalSocketClass = SocketClass;
      }
      this.#server = Bun.listen(
        path
          ? {
              exclusive,
              unix: path,
              tls,
              socket: SocketClass[bunSocketServerHandlers],
            }
          : {
              exclusive,
              port,
              hostname,
              tls,
              socket: SocketClass[bunSocketServerHandlers],
            },
      );

      //make this instance available on handlers
      this.#server.data = this;

      // We must schedule the emitListeningNextTick() only after the next run of
      // the event loop's IO queue. Otherwise, the server may not actually be listening
      // when the 'listening' event is emitted.
      //
      // That leads to all sorts of confusion.
      //
      // process.nextTick() is not sufficient because it will run before the IO queue.
      setTimeout(emitListeningNextTick, 1, this, onListen);
    } catch (err) {
      setTimeout(emitErrorNextTick, 1, this, err);
    }
    return this;
  }
}

function emitErrorNextTick(self, error) {
  self.emit("error", error);
}

function emitErrorAndCloseNextTick(self, error) {
  self.emit("error", error);
  self.emit("close");
}

function emitListeningNextTick(self, onListen) {
  if (typeof onListen === "function") {
    try {
      onListen();
    } catch (err) {
      self.emit("error", err);
    }
  }
  self.emit("listening");
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

export default {
  createServer,
  Server,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  [Symbol.for("::bunternal::")]: SocketClass,
};
