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
const { addServerName, upgradeDuplexToTLS, isNamedPipeSocket } = require("../internal/net");
const { ExceptionWithHostPort } = require("internal/shared");

// IPv4 Segment
const v4Seg = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
var IPv4Reg;

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg;

const DEFAULT_IPV4_ADDR = "0.0.0.0";
const DEFAULT_IPV6_ADDR = "::";

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

const kServerSocket = Symbol("kServerSocket");
const kBytesWritten = Symbol("kBytesWritten");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");

const kRealListen = Symbol("kRealListen");
const kSetNoDelay = Symbol("kSetNoDelay");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");

function endNT(socket, callback, err) {
  socket.$end();
  callback(err);
}
function emitCloseNT(self, hasError) {
  if (hasError) {
    self.emit("close", hasError);
  } else {
    self.emit("close");
  }
}
function detachSocket(self) {
  if (!self) self = this;
  self._handle = null;
}
function finishSocket(hasError) {
  detachSocket(this);
  this.emit("close", hasError);
}

function destroyNT(self, err) {
  self.destroy(err);
}
function destroyWhenAborted(err) {
  if (!this.destroyed) {
    this.destroy(err.target.reason);
  }
}
// Provide a better error message when we call end() as a result
// of the other side sending a FIN.  The standard 'write after end'
// is overly vague, and makes it seem like the user's code is to blame.
function writeAfterFIN(chunk, encoding, cb) {
  if (!this.writableEnded) {
    return Duplex.prototype.write.$call(this, chunk, encoding, cb);
  }

  if (typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }

  const err = new Error("This socket has been ended by the other party");
  err.code = "EPIPE";
  if (typeof cb === "function") {
    process.nextTick(cb, err);
  }
  this.destroy(err);

  return false;
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
      data(socket, buffer) {
        const { data: self } = socket;
        if (!self) return;

        self.bytesRead += buffer.length;
        if (!self.push(buffer)) {
          socket.pause();
        }
      },
      drain: Socket.#Drain,
      end: Socket.#End,
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
        socket.timeout(Math.ceil(self.timeout / 1000));

        if (self.#unrefOnConnected) socket.unref();
        self._handle = socket;
        self.connecting = false;
        const options = self[bunTLSConnectOptions];

        if (options) {
          const { session } = options;
          if (session) {
            self.setSession(session);
          }
        }

        if (self[kSetNoDelay]) {
          socket.setNoDelay(true);
        }

        if (self[kSetKeepAlive]) {
          socket.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
        }

        if (!self.#upgraded) {
          self[kBytesWritten] = socket.bytesWritten;
          // this is not actually emitted on nodejs when socket used on the connection
          // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
          self.emit("connect", self);
          self.emit("ready");
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
        self.alpnProtocol = socket.alpnProtocol;
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
          } else {
            self.authorized = true;
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

    static #End(socket) {
      const self = socket.data;
      if (!self) return;

      // we just reuse the same code but we can push null or enqueue right away
      Socket.#EmitEndNT(self);
    }
    static #EmitEndNT(self, err) {
      if (!self.#ended) {
        if (!self.allowHalfOpen) {
          self.write = writeAfterFIN;
        }
        self.#ended = true;
        self.push(null);
      }
      // TODO: check how the best way to handle this
      // if (err) {
      //   self.destroy(err);
      // }
    }
    static #Close(socket, err) {
      const self = socket.data;
      if (!self || self.#closed) return;
      self.#closed = true;
      //socket cannot be used after close
      detachSocket(self);
      Socket.#EmitEndNT(self, err);
      self.data = null;
    }

    static #Drain(socket) {
      const self = socket.data;
      if (!self) return;
      const callback = self.#writeCallback;
      self.connecting = false;
      if (callback) {
        const writeChunk = self._pendingData;
        if (!writeChunk || socket.$write(writeChunk || "", self._pendingEncoding || "utf8")) {
          self._pendingData = self.#writeCallback = null;
          callback(null);
        } else {
          self._pendingData = null;
        }

        self[kBytesWritten] = socket.bytesWritten;
      }
    }

    static [bunSocketServerHandlers] = {
      data: Socket.#Handlers.data,
      close(socket, err) {
        const data = this.data;
        if (!data) return;
        Socket.#Handlers.close(socket, err);
        data.server[bunSocketServerConnections]--;
        data.server._emitCloseIfDrained();
      },
      end(socket) {
        Socket.#Handlers.end(socket);
      },
      open(socket) {
        const self = this.data;
        socket[kServerSocket] = self._handle;
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
            localPort: _socket.localPort || this.localPort,
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

        if (typeof connectionListener === "function") {
          this.pauseOnConnect = pauseOnConnect;
          if (!isTLS) {
            connectionListener.$call(self, _socket);
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
        self.servername = socket.getServername();
        const server = self.server;
        self.alpnProtocol = socket.alpnProtocol;
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
          } else {
            self.authorized = true;
          }
        } else {
          self.authorized = true;
        }
        const connectionListener = server[bunSocketServerOptions]?.connectionListener;
        if (typeof connectionListener === "function") {
          connectionListener.$call(server, self);
        }
        server.emit("secureConnection", self);
        // after secureConnection event we emmit secure and secureConnect
        self.emit("secure", self);
        self.emit("secureConnect", verifyError);
        if (!server.pauseOnConnect) {
          self.resume();
        }
      },
      error(socket, error) {
        const data = this.data;
        if (!data) return;
        Socket.#Handlers.error(socket, error);
        data.emit("error", error);
        data.server.emit("clientError", error, data);
      },
      timeout: Socket.#Handlers.timeout,
      connectError: Socket.#Handlers.connectError,
      drain: Socket.#Handlers.drain,
      binaryType: "buffer",
    };

    bytesRead = 0;
    [kBytesWritten] = undefined;
    #closed = false;
    #ended = false;
    connecting = false;
    localAddress = "127.0.0.1";
    remotePort;
    [bunTLSConnectOptions] = null;
    timeout = 0;
    #writeCallback;
    _pendingData;
    _pendingEncoding; // for compatibility
    #pendingRead;

    isServer = false;
    _handle = null;
    _parent;
    _parentWrap;
    #socket;
    server;
    pauseOnConnect = false;
    #upgraded;
    #unrefOnConnected = false;
    #handlers = Socket.#Handlers;
    [kSetNoDelay];
    [kSetKeepAlive];
    [kSetKeepAliveInitialDelay];
    constructor(options) {
      const {
        socket,
        signal,
        write,
        read,
        allowHalfOpen = false,
        onread = null,
        noDelay = false,
        keepAlive = false,
        keepAliveInitialDelay = 0,
        ...opts
      } = options || {};

      super({
        ...opts,
        allowHalfOpen,
        readable: true,
        writable: true,
        //For node.js compat do not emit close on destroy.
        emitClose: false,
        autoDestroy: true,
        // Handle strings directly.
        decodeStrings: false,
      });
      this._parent = this;
      this._parentWrap = this;
      this.#pendingRead = undefined;
      this.#upgraded = null;

      this[kSetNoDelay] = Boolean(noDelay);
      this[kSetKeepAlive] = Boolean(keepAlive);
      this[kSetKeepAliveInitialDelay] = ~~(keepAliveInitialDelay / 1000);
      if (socket instanceof Socket) {
        this.#socket = socket;
      }
      if (onread) {
        if (typeof onread !== "object") {
          throw new TypeError("onread must be an object");
        }
        if (typeof onread.callback !== "function") {
          throw new TypeError("onread.callback must be a function");
        }
        // when the onread option is specified we use a different handlers object
        this.#handlers = {
          ...Socket.#Handlers,
          data({ data: self }, buffer) {
            if (!self) return;
            try {
              onread.callback(buffer.length, buffer);
            } catch (e) {
              self.emit("error", e);
            }
          },
        };
      }
      if (signal) {
        if (signal.aborted) {
          process.nextTick(destroyNT, this, signal.reason);
        } else {
          signal.addEventListener("abort", destroyWhenAborted.bind(this));
        }
      }
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

    get _bytesDispatched() {
      return this[kBytesWritten] || 0;
    }

    get bytesWritten() {
      let bytes = this[kBytesWritten] || 0;
      const data = this._pendingData;
      const writableBuffer = this.writableBuffer;
      if (!writableBuffer) return undefined;

      for (const el of writableBuffer) {
        bytes += el.chunk instanceof Buffer ? el.chunk.length : Buffer.byteLength(el.chunk, el.encoding);
      }

      if ($isArray(data)) {
        // Was a writev, iterate over chunks to get total length
        for (let i = 0; i < data.length; i++) {
          const chunk = data[i];

          if (data.allBuffers || chunk instanceof Buffer) bytes += chunk.length;
          else bytes += Buffer.byteLength(chunk.chunk, chunk.encoding);
        }
      } else if (data) {
        bytes += data.byteLength;
      }
      return bytes;
    }

    #attach(port, socket) {
      this.remotePort = port;
      socket.data = this;
      socket.timeout(Math.ceil(this.timeout / 1000));
      if (this.#unrefOnConnected) socket.unref();
      this._handle = socket;
      this.connecting = false;

      if (this[kSetNoDelay]) {
        socket.setNoDelay(true);
      }

      if (this[kSetKeepAlive]) {
        socket.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
      }

      if (!this.#upgraded) {
        this[kBytesWritten] = socket.bytesWritten;
        // this is not actually emitted on nodejs when socket used on the connection
        // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
        this.emit("connect", this);
        this.emit("ready");
      }
      Socket.#Drain(socket);
    }

    #closeRawConnection() {
      const connection = this.#upgraded;
      connection.connecting = false;
      connection._handle = null;
      connection.unref();
      connection.destroy();
    }

    connect(...args) {
      const [options, connectListener] = normalizeArgs(args);
      let connection = this.#socket;

      let upgradeDuplex = false;

      let {
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
      } = options;

      this.servername = servername;

      if (socket) {
        connection = socket;
      }
      if (fd) {
        bunConnect({
          data: this,
          fd: fd,
          socket: this.#handlers,
          allowHalfOpen: this.allowHalfOpen,
        }).catch(error => {
          if (!this.destroyed) {
            this.emit("error", error);
            this.emit("close");
          }
        });
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
          tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
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
            if (connection instanceof Duplex) {
              upgradeDuplex = true;
            } else {
              throw new TypeError("socket must be an instance of net.Socket or Duplex");
            }
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
        // reset the underlying writable object when establishing a new connection
        // this is a function on `Duplex`, originally defined on `Writable`
        // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L311
        // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L1126
        this._undestroy();

        if (connection) {
          const socket = connection._handle;
          if (!upgradeDuplex && socket) {
            // if is named pipe socket we can upgrade it using the same wrapper than we use for duplex
            upgradeDuplex = isNamedPipeSocket(socket);
          }
          if (upgradeDuplex) {
            this.connecting = true;
            this.#upgraded = connection;
            const [result, events] = upgradeDuplexToTLS(connection, {
              data: this,
              tls,
              socket: this.#handlers,
            });

            connection.on("data", events[0]);
            connection.on("end", events[1]);
            connection.on("drain", events[2]);
            connection.on("close", events[3]);

            this._handle = result;
          } else {
            if (socket) {
              this.connecting = true;
              this.#upgraded = connection;
              const result = socket.upgradeTLS({
                data: this,
                tls,
                socket: this.#handlers,
              });
              if (result) {
                const [raw, tls] = result;
                // replace socket
                connection._handle = raw;
                this.once("end", this.#closeRawConnection);
                raw.connecting = false;
                this._handle = tls;
              } else {
                this._handle = null;
                throw new Error("Invalid socket");
              }
            } else {
              // wait to be connected
              connection.once("connect", () => {
                const socket = connection._handle;
                if (!upgradeDuplex && socket) {
                  // if is named pipe socket we can upgrade it using the same wrapper than we use for duplex
                  upgradeDuplex = isNamedPipeSocket(socket);
                }
                if (upgradeDuplex) {
                  this.connecting = true;
                  this.#upgraded = connection;

                  const [result, events] = upgradeDuplexToTLS(connection, {
                    data: this,
                    tls,
                    socket: this.#handlers,
                  });

                  connection.on("data", events[0]);
                  connection.on("end", events[1]);
                  connection.on("drain", events[2]);
                  connection.on("close", events[3]);

                  this._handle = result;
                } else {
                  this.connecting = true;
                  this.#upgraded = connection;
                  const result = socket.upgradeTLS({
                    data: this,
                    tls,
                    socket: this.#handlers,
                  });

                  if (result) {
                    const [raw, tls] = result;
                    // replace socket
                    connection._handle = raw;
                    this.once("end", this.#closeRawConnection);
                    raw.connecting = false;
                    this._handle = tls;
                  } else {
                    this._handle = null;
                    throw new Error("Invalid socket");
                  }
                }
              });
            }
          }
        } else if (path) {
          // start using unix socket
          bunConnect({
            data: this,
            unix: path,
            socket: this.#handlers,
            tls,
            allowHalfOpen: this.allowHalfOpen,
          }).catch(error => {
            if (!this.destroyed) {
              this.emit("error", error);
              this.emit("close");
            }
          });
        } else {
          // default start
          bunConnect({
            data: this,
            hostname: host || "localhost",
            port: port,
            socket: this.#handlers,
            tls,
            allowHalfOpen: this.allowHalfOpen,
          }).catch(error => {
            if (!this.destroyed) {
              this.emit("error", error);
              this.emit("close");
            }
          });
        }
      } catch (error) {
        process.nextTick(emitErrorAndCloseNextTick, this, error);
      }
      return this;
    }

    end(...args) {
      if (!this._readableState.endEmitted) {
        this.secureConnecting = false;
      }
      return super.end(...args);
    }

    _destroy(err, callback) {
      this.connecting = false;
      const { ending } = this._writableState;
      if (!err && this.secureConnecting && !this.isServer) {
        this.secureConnecting = false;
        err = new ConnResetException("Client network socket disconnected before secure TLS connection was established");
      }
      // lets make sure that the writable side is closed
      if (!ending) {
        // at this state destroyed will be true but we need to close the writable side
        this._writableState.destroyed = false;
        this.end();
        // we now restore the destroyed flag
        this._writableState.destroyed = true;
      }

      detachSocket(self);
      callback(err);
      process.nextTick(emitCloseNT, this, !!err);
    }

    _final(callback) {
      if (this.connecting) {
        return this.once("connect", () => this._final(callback));
      }
      const socket = this._handle;

      // already closed call destroy
      if (!socket) return callback();

      // emit FIN allowHalfOpen only allow the readable side to close first
      process.nextTick(endNT, socket, callback);
    }

    get localFamily() {
      return "IPv4";
    }

    get localPort() {
      return this._handle?.localPort;
    }
    get _connecting() {
      return this.connecting;
    }

    get pending() {
      return !this._handle || this.connecting;
    }

    resume() {
      if (!this.connecting) {
        this._handle?.resume();
      }
      return super.resume();
    }
    pause() {
      if (!this.destroyed) {
        this._handle?.pause();
      }
      return super.pause();
    }
    read(size) {
      if (!this.connecting) {
        this._handle?.resume();
      }
      return super.read(size);
    }

    _read(size) {
      const socket = this._handle;
      if (this.connecting || !socket) {
        this.once("connect", () => this._read(size));
      } else {
        socket?.resume();
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
      const socket = this._handle;
      if (!socket) {
        this.#unrefOnConnected = false;
        return this;
      }
      socket.ref();
      return this;
    }

    get remoteAddress() {
      return this._handle?.remoteAddress;
    }

    get remoteFamily() {
      return "IPv4";
    }

    resetAndDestroy() {
      if (this._handle) {
        if (this.connecting) {
          this.once("connect", () => this._handle?.terminate());
        } else {
          this._handle.terminate();
        }
      } else {
        this.destroy($ERR_SOCKET_CLOSED_BEFORE_CONNECTION("ERR_SOCKET_CLOSED_BEFORE_CONNECTION"));
      }
    }

    setKeepAlive(enable = false, initialDelayMsecs = 0) {
      enable = Boolean(enable);
      const initialDelay = ~~(initialDelayMsecs / 1000);

      if (!this._handle) {
        this[kSetKeepAlive] = enable;
        this[kSetKeepAliveInitialDelay] = initialDelay;
        return this;
      }

      if (!this._handle.setKeepAlive) {
        return this;
      }

      if (enable !== this[kSetKeepAlive] || (enable && this[kSetKeepAliveInitialDelay] !== initialDelay)) {
        this[kSetKeepAlive] = enable;
        this[kSetKeepAliveInitialDelay] = initialDelay;
        this._handle.setKeepAlive(enable, initialDelay);
      }

      return this;
    }

    setNoDelay(enable = true) {
      // Backwards compatibility: assume true when `enable` is omitted
      enable = Boolean(enable === undefined ? true : enable);

      if (!this._handle) {
        this[kSetNoDelay] = enable;
        return this;
      }

      if (this._handle.setNoDelay && enable !== this[kSetNoDelay]) {
        this[kSetNoDelay] = enable;
        this._handle.setNoDelay(enable);
      }
      return this;
    }

    setTimeout(timeout, callback) {
      // internally or timeouts are in seconds
      // we use Math.ceil because 0 would disable the timeout and less than 1 second but greater than 1ms would be 1 second (the minimum)
      this._handle?.timeout(Math.ceil(timeout / 1000));
      this.timeout = timeout;
      if (callback) this.once("timeout", callback);
      return this;
    }
    // for compatibility
    _unrefTimer() {}
    unref() {
      const socket = this._handle;
      if (!socket) {
        this.#unrefOnConnected = true;
        return this;
      }
      socket.unref();
      return this;
    }

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L785
    destroySoon() {
      if (this.writable) this.end();

      if (this.writableFinished) this.destroy();
      else this.once("finish", this.destroy);
    }

    //TODO: migrate to native
    _writev(data, callback) {
      const allBuffers = data.allBuffers;
      const chunks = data;
      if (allBuffers) {
        if (data.length === 1) {
          return this._write(data[0], "buffer", callback);
        }
        for (let i = 0; i < data.length; i++) {
          data[i] = data[i].chunk;
        }
      } else {
        if (data.length === 1) {
          const { chunk, encoding } = data[0];
          return this._write(chunk, encoding, callback);
        }
        for (let i = 0; i < data.length; i++) {
          const { chunk, encoding } = data[i];
          if (typeof chunk === "string") {
            data[i] = Buffer.from(chunk, encoding);
          } else {
            data[i] = chunk;
          }
        }
      }
      const chunk = Buffer.concat(chunks || []);
      return this._write(chunk, "buffer", callback);
    }

    _write(chunk, encoding, callback) {
      // If we are still connecting, then buffer this for later.
      // The Writable logic will buffer up any more writes while
      // waiting for this one to be done.
      if (this.connecting) {
        this.#writeCallback = callback;
        this._pendingData = chunk;
        this._pendingEncoding = encoding;
        function onClose() {
          callback($ERR_SOCKET_CLOSED_BEFORE_CONNECTION("ERR_SOCKET_CLOSED_BEFORE_CONNECTION"));
        }
        this.once("connect", function connect() {
          this.off("close", onClose);
        });
        this.once("close", onClose);
        return;
      }
      this._pendingData = null;
      this._pendingEncoding = "";
      this.#writeCallback = null;
      const socket = this._handle;
      if (!socket) {
        callback($ERR_SOCKET_CLOSED("Socket is closed"));
        return false;
      }

      const success = socket.$write(chunk, encoding);
      this[kBytesWritten] = socket.bytesWritten;
      if (success) {
        callback();
      } else if (this.#writeCallback) {
        callback(new Error("overlapping _write()"));
      } else {
        this.#writeCallback = callback;
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
  [bunSocketServerConnections] = 0;
  [bunSocketServerOptions];
  maxConnections = 0;
  _handle = null;

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
    return !!this._handle;
  }

  ref() {
    this._handle?.ref();
    return this;
  }

  unref() {
    this._handle?.unref();
    return this;
  }

  close(callback) {
    if (typeof callback === "function") {
      if (!this._handle) {
        this.once("close", function close() {
          callback($ERR_SERVER_NOT_RUNNING());
        });
      } else {
        this.once("close", callback);
      }
    }

    if (this._handle) {
      this._handle.stop(false);
      this._handle = null;
    }

    this._emitCloseIfDrained();

    return this;
  }

  [Symbol.asyncDispose]() {
    const { resolve, reject, promise } = Promise.withResolvers();
    this.close(function (err, ...args) {
      if (err) reject(err);
      else resolve(...args);
    });
    return promise;
  }

  _emitCloseIfDrained() {
    if (this._handle || this[bunSocketServerConnections] > 0) {
      return;
    }
    process.nextTick(() => {
      this.emit("close");
    });
  }

  address() {
    const server = this._handle;
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
      callback(null, this._handle ? this[bunSocketServerConnections] : 0);
    }
    return this;
  }

  listen(port, hostname, onListen) {
    let backlog;
    let path;
    let exclusive = false;
    let allowHalfOpen = false;
    let reusePort = false;
    let ipv6Only = false;
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
        exclusive = options.exclusive;
        path = options.path;
        port = options.port;
        ipv6Only = options.ipv6Only;
        allowHalfOpen = options.allowHalfOpen;
        reusePort = options.reusePort;

        const isLinux = process.platform === "linux";

        if (!Number.isSafeInteger(port) || port < 0) {
          if (path) {
            const isAbstractPath = path.startsWith("\0");
            if (isLinux && isAbstractPath && (options.writableAll || options.readableAll)) {
              const message = `The argument 'options' can not set readableAll or writableAll to true when path is abstract unix socket. Received ${JSON.stringify(options)}`;

              const error = new TypeError(message);
              error.code = "ERR_INVALID_ARG_VALUE";
              throw error;
            }

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

        if (typeof options.callback === "function") onListen = options?.callback;
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
      let contexts: Map<string, any> | null = null;
      if (typeof bunTLS === "function") {
        [tls, TLSSocketClass] = bunTLS.$call(this, port, hostname, false);
        options.servername = tls.serverName;
        options.InternalSocketClass = TLSSocketClass;
        contexts = tls.contexts;
        if (!tls.requestCert) {
          tls.rejectUnauthorized = false;
        }
      } else {
        options.InternalSocketClass = SocketClass;
      }

      listenInCluster(
        this,
        null,
        port,
        4,
        backlog,
        undefined,
        exclusive,
        ipv6Only,
        allowHalfOpen,
        reusePort,
        undefined,
        undefined,
        path,
        hostname,
        tls,
        contexts,
        onListen,
      );
    } catch (err) {
      setTimeout(emitErrorNextTick, 1, this, err);
    }
    return this;
  }

  [kRealListen](path, port, hostname, exclusive, ipv6Only, allowHalfOpen, reusePort, tls, contexts, onListen) {
    if (path) {
      this._handle = Bun.listen({
        unix: path,
        tls,
        allowHalfOpen: allowHalfOpen || this[bunSocketServerOptions]?.allowHalfOpen || false,
        reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
        ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
        exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
        socket: SocketClass[bunSocketServerHandlers],
      });
    } else {
      this._handle = Bun.listen({
        port,
        hostname,
        tls,
        allowHalfOpen: allowHalfOpen || this[bunSocketServerOptions]?.allowHalfOpen || false,
        reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
        ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
        exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
        socket: SocketClass[bunSocketServerHandlers],
      });
    }

    //make this instance available on handlers
    this._handle.data = this;

    if (contexts) {
      for (const [name, context] of contexts) {
        addServerName(this._handle, name, context);
      }
    }

    // We must schedule the emitListeningNextTick() only after the next run of
    // the event loop's IO queue. Otherwise, the server may not actually be listening
    // when the 'listening' event is emitted.
    //
    // That leads to all sorts of confusion.
    //
    // process.nextTick() is not sufficient because it will run before the IO queue.
    setTimeout(emitListeningNextTick, 1, this, onListen?.bind(this));
  }

  getsockname(out) {
    out.port = this.address().port;
    return out;
  }
}

function emitErrorNextTick(self, error) {
  self.emit("error", error);
}

function emitErrorAndCloseNextTick(self, error) {
  self.emit("error", error);
  self.emit("close");
}
class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
  }

  get ["constructor"]() {
    return Error;
  }
}

function emitListeningNextTick(self, onListen) {
  if (typeof onListen === "function") {
    try {
      onListen.$call(self);
    } catch (err) {
      self.emit("error", err);
    }
  }
  self.emit("listening");
}

let cluster;
function listenInCluster(
  server,
  address,
  port,
  addressType,
  backlog,
  fd,
  exclusive,
  ipv6Only,
  allowHalfOpen,
  reusePort,
  flags,
  options,
  path,
  hostname,
  tls,
  contexts,
  onListen,
) {
  exclusive = !!exclusive;

  if (cluster === undefined) cluster = require("node:cluster");

  if (cluster.isPrimary || exclusive) {
    server[kRealListen](path, port, hostname, exclusive, ipv6Only, allowHalfOpen, reusePort, tls, contexts, onListen);
    return;
  }

  const serverQuery = {
    address: address,
    port: port,
    addressType: addressType,
    fd: fd,
    flags,
    backlog,
    ...options,
  };
  cluster._getServer(server, serverQuery, function listenOnPrimaryHandle(err, handle) {
    err = checkBindError(err, port, handle);
    if (err) {
      throw new ExceptionWithHostPort(err, "bind", address, port);
    }
    server[kRealListen](path, port, hostname, exclusive, ipv6Only, allowHalfOpen, reusePort, tls, contexts, onListen);
  });
}

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

function normalizeArgs(args) {
  while (args[args.length - 1] == null) args.pop();
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    return arr;
  }

  const arg0 = args[0];
  let options: any = {};
  if (typeof arg0 === "object" && arg0 !== null) {
    options = arg0;
  } else if (isPipeName(arg0)) {
    options.path = arg0;
  } else {
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === "string") {
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== "function") arr = [options, null];
  else arr = [options, cb];

  return arr;
}

function checkBindError(err, port, handle) {
  // EADDRINUSE may not be reported until we call listen() or connect().
  // To complicate matters, a failed bind() followed by listen() or connect()
  // will implicitly bind to a random port. Ergo, check that the socket is
  // bound to the expected port before calling listen() or connect().
  if (err === 0 && port > 0 && handle.getsockname) {
    const out = {};
    err = handle.getsockname(out);
    if (err === 0 && port !== out.port) {
      $debug(`checkBindError, bound to ${out.port} instead of ${port}`);
      const UV_EADDRINUSE = -4091;
      err = UV_EADDRINUSE;
    }
  }
  return err;
}

function isPipeName(s) {
  return typeof s === "string" && toNumber(s) === false;
}

function toNumber(x) {
  return (x = Number(x)) >= 0 ? x : false;
}

// TODO:
class BlockList {
  constructor() {}

  addSubnet(net, prefix, type) {}

  check(address, type) {
    return false;
  }
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
  _normalizeArgs: normalizeArgs,

  getDefaultAutoSelectFamily: $zig("node_net_binding.zig", "getDefaultAutoSelectFamily"),
  setDefaultAutoSelectFamily: $zig("node_net_binding.zig", "setDefaultAutoSelectFamily"),
  getDefaultAutoSelectFamilyAttemptTimeout: $zig("node_net_binding.zig", "getDefaultAutoSelectFamilyAttemptTimeout"),
  setDefaultAutoSelectFamilyAttemptTimeout: $zig("node_net_binding.zig", "setDefaultAutoSelectFamilyAttemptTimeout"),

  BlockList,
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  Stream: Socket,
};
