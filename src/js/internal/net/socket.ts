const Duplex: DuplexConstructor = require("internal/streams/duplex");
const { validateNumber, validateFunction, validateUint32 } = require("internal/validators");
const { isIP } = require("internal/net/ip") as Readonly<{ isIP: (ip: string) => 0 | 4 | 6 }>;
const { getTimerDuration } = require("internal/timers");
const {
  upgradeDuplexToTLS,
  isNamedPipeSocket,
  bunTlsSymbol,
  bunSocketServerHandlers,
  bunSocketServerConnections,
  bunSocketServerOptions,
} = require("internal/net") as Readonly<{
  upgradeDuplexToTLS: (socket: IDuplex, options: Record<string | symbol | number, any>) => [TLSSocket, Function[]];
  isNamedPipeSocket: (socket: IDuplex) => boolean;
  bunTlsSymbol: symbol;
  bunSocketServerHandlers: symbol;
  bunSocketServerConnections: symbol;
  bunSocketServerOptions: symbol;
}>;

import type { TCPSocket, TCPSocketConnectOptions, TLSSocket, UnixSocketOptions } from "bun";
import type { Duplex as IDuplex } from "node:stream";

const { connect: bunConnect } = Bun;

const kServerSocket = Symbol("kServerSocket");
const kTimeout = Symbol("kTimeout");
const kBytesWritten = Symbol("kBytesWritten");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
const kSetNoDelay = Symbol("kSetNoDelay");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");
const kConnectOptions = Symbol("connect-options");

type NativeSocket = TCPSocket | TLSSocket;

declare class InternalDuplex extends IDuplex {
  _writableState: any; // WritableState in duplex.ts
  _readableState: any; // ReadableState in duplex.ts
  readonly writableBuffer: { chunk; encoding; callback }[];
  _undestroy(): void;
}
declare interface DuplexConstructor {
  new (options): InternalDuplex;
}

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
    error(socket, error, ignoreHadError) {
      const self = socket.data;
      if (!self) return;
      if (self._hadError && !ignoreHadError) return;
      self._hadError = true;

      const callback = self.#writeCallback;
      if (callback) {
        self.#writeCallback = null;
        callback(error);
      }
      self.emit("error", error);
    },
    open(socket) {
      const self: Socket = socket.data;
      if (!self) return;
      socket.timeout(Math.ceil(self.timeout / 1000));

      if (self.#unrefOnConnected) socket.unref();
      self._handle = socket;
      self.connecting = false;
      const options = self[bunTLSConnectOptions];

      if (options) {
        const { session } = options;
        if (session) {
          $assert("setSession" in self && typeof self.setSession === "function");
          // exists on TLS sockets
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
      if (!success && verifyError?.code === "ECONNRESET") {
        // will be handled in onConnectEnd
        return;
      }

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
      self.removeListener("end", onConnectEnd);
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
  static #EmitEndNT(self, err?) {
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
      if (socket.$write(writeChunk || "", self._pendingEncoding || "utf8")) {
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

      data.server[bunSocketServerConnections]--;
      {
        if (!data.#closed) {
          data.#closed = true;
          //socket cannot be used after close
          detachSocket(data);
          Socket.#EmitEndNT(data, err);
          data.data = null;
        }
      }

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
      if (!success && verifyError?.code === "ECONNRESET") {
        const err = new ConnResetException("socket hang up");
        self.emit("_tlsError", err);
        self.server.emit("tlsClientError", err, self);
        self._hadError = true;
        // error before handshake on the server side will only be emitted using tlsClientError
        self.destroy();
        return;
      }
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

      if (data._hadError) return;
      data._hadError = true;
      const bunTLS = this[bunTlsSymbol];

      if (typeof bunTLS === "function") {
        // Destroy socket if error happened before handshake's finish
        if (!data._secureEstablished) {
          data.destroy(error);
        } else if (
          data.isServer &&
          data._rejectUnauthorized &&
          /peer did not return a certificate/.test(error?.message)
        ) {
          // Ignore server's authorization errors
          data.destroy();
        } else {
          // Emit error
          data._emitTLSError(error);
          this.emit("_tlsError", error);
          this.server.emit("tlsClientError", error, data);
          Socket.#Handlers.error(socket, error, true);
          return;
        }
      }
      Socket.#Handlers.error(socket, error, true);
      data.server.emit("clientError", error, data);
    },
    timeout: Socket.#Handlers.timeout,
    drain: Socket.#Handlers.drain,
    binaryType: "buffer",
  };

  bytesRead = 0;
  [kBytesWritten]: number | undefined = undefined;
  #closed = false;
  #ended = false;
  connecting = false;
  localAddress = "127.0.0.1";
  remotePort;
  [bunTLSConnectOptions] = null;
  declare authorized?: boolean;
  declare secureConnecting?: boolean;
  declare _secureEstablished?: boolean;
  declare _securePending?: boolean;
  declare _requestCert?: boolean;
  declare _rejectUnauthorized?: boolean;
  timeout = 0;
  [kTimeout]: Timer | null = null;
  #writeCallback;
  _pendingData;
  _pendingEncoding; // for compatibility
  #pendingRead;
  _hadError = false;
  isServer = false;
  _handle: NativeSocket | null = null;
  _parent;
  _parentWrap;
  #socket;
  server;
  servername: string | undefined;
  pauseOnConnect = false;
  #upgraded;
  #unrefOnConnected = false;

  #handlers = Socket.#Handlers;
  [kSetNoDelay];
  [kSetKeepAlive];
  [kSetKeepAliveInitialDelay];
  [kConnectOptions]: Record<string | symbol | number, any> | undefined;
  declare [bunTlsSymbol]: Function | undefined;
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
    this._parent = null;
    this._parentWrap = this;
    this.#pendingRead = undefined;
    this.#upgraded = null;

    this[kSetNoDelay] = Boolean(noDelay);
    this[kSetKeepAlive] = Boolean(keepAlive);
    this[kSetKeepAliveInitialDelay] = ~~(keepAliveInitialDelay / 1000);

    // Shut down the socket when we're finished with it.
    this.on("end", onSocketEnd);

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
      socket.setKeepAlive(true, this[kSetKeepAliveInitialDelay]);
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

  public connect(...args) {
    const [options, connectListener] = normalizeArgs(args);
    if (options.port === undefined && options.path == null) {
      const err = $ERR_MISSING_ARGS("");
      err.message = 'The "options" or "port" or "path" argument must be specified';
      throw err;
    }
    let connection = this.#socket;

    let upgradeDuplex = false;

    let {
      fd,
      port,
      host,
      path,
      socket,
      localAddress,
      localPort,
      // TODOs
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

    if (localAddress && !isIP(localAddress)) {
      throw $ERR_INVALID_IP_ADDRESS(localAddress);
    }
    if (localPort) {
      validateNumber(localPort, "options.localPort");
    }

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

    // this.pauseOnConnect = pauseOnConnect;

    if (fd) {
      // if (!pauseOnConnect) {
      //   process.nextTick(() => {
      //     this.resume();
      //   });
      // }
      return this;
    }

    this.remotePort = port;

    const bunTLS = this[bunTlsSymbol]; // fixme
    var tls: any = undefined;

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
      this[kConnectOptions] = options;

      this.prependListener("end", onConnectEnd);
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
        this.connecting = true;
        this.#internalConnect({
          data: this,
          unix: path,
          socket: this.#handlers,
          tls,
          allowHalfOpen: this.allowHalfOpen,
        });
      } else {
        // default start
        this.#lookupAndConnect(port, family, host, tls);
      }
    } catch (error) {
      process.nextTick(emitErrorAndCloseNextTick, this, error);
    }
    return this;
  }

  async #lookupAndConnect(
    port: number,
    family: 4 | 6 | 0 | "IPv4" | "IPv6" | "any" | undefined,
    hostname: string | undefined,
    tls,
  ) {
    this.connecting = true;
    try {
      // TODO: options.lookup
      var lookup = await Bun.dns.lookup(hostname || "localhost", {
        family,
        port,
        socketType: "tcp",
      });
    } catch (error) {
      // It's possible we were destroyed while looking this up.
      if (!this.connecting) return;
      if ("code" in error && error.code.startsWith("DNS_")) {
        error.code = error.code.replace("DNS_", "");
      }
      this.emit("lookup", error, undefined, undefined, hostname);
      process.nextTick(connectErrorNT, this, error);
      return;
    }

    // It's possible we were destroyed while looking this up.
    if (!this.connecting) return;
    $assert(lookup.length > 0);
    if (lookup.length === 0) {
      console.log("lookup empty");
      this.emit("lookup", new Error("getaddrinfo ENOTFOUND"), undefined, undefined, hostname);
      process.nextTick(connectErrorNT, this, new Error("getaddrinfo ENOTFOUND"));
      return;
    }

    throw new Error("lookup: " + lookup);
    // NOTE: Node uses all the addresses returned by dns.lookup, but our
    // Bun.connect API doesn't support this
    const { address: ip, family: addressType } = lookup[0];
    $assert(isIP(ip) == addressType);
    this.emit("lookup", null, ip, addressType, hostname);
    $debug("attempting to connect to %s:%d (addressType: %d)", ip, port, addressType);
    // console.log("attempting to connect to %s:%d (addressType: %d)", ip, port, addressType);
    this.emit("connectionAttempt", ip, port, addressType);
    this._unrefTimer();
    this.#internalConnect({
      data: this,
      port,
      host: ip,
      family: addressType,
      socket: this.#handlers,
      allowHalfOpen: this.allowHalfOpen,
      tls,
    });
  }

  // #lookupAndConnect(port: number, family: 4 | 6 | 0 | "IPv4" | "IPv6" | "any", hostname = "localhost") {
  //   this.connecting = true;
  //   try {
  //     var lookup = await Bun.dns.lookup(hostname, {
  //       family,
  //       port,
  //       socketType: "tcp",
  //     });
  //   } catch (error) {
  //     if (!this.destroyed) {
  //       this.emit("error", error);
  //       this.emit("close");
  //     }
  //     return;
  //   }
  // }

  #internalConnect(options: TCPSocketConnectOptions<this>): Promise<void>;
  #internalConnect(options: UnixSocketOptions<this>): Promise<void>;
  async #internalConnect(options: TCPSocketConnectOptions<this> | UnixSocketOptions<this>): Promise<void> {
    $assert(this.connecting);

    try {
      await bunConnect(options as any);
    } catch (error) {
      if (!this.destroyed) {
        this.emit("error", error);
        this.emit("close");
        connectErrorNT(this, error);
      }
    }
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

    // lets make sure that the writable side is closed
    if (!ending) {
      // at this state destroyed will be true but we need to close the writable side
      this._writableState.destroyed = false;
      this.end();

      // we now restore the destroyed flag
      this._writableState.destroyed = true;
    }

    detachSocket(this);
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

  get localPort(): number | undefined {
    return this._handle?.localPort;
  }
  get _connecting(): boolean {
    return this.connecting;
  }

  get pending(): boolean {
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

  private _unrefTimer() {
    for (let socket = this; socket != null; socket = socket._parent) {
      socket[kTimeout]?.refresh();
    }
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
    timeout = getTimerDuration(timeout, "msecs");
    // internally or timeouts are in seconds
    // we use Math.ceil because 0 would disable the timeout and less than 1 second but greater than 1ms would be 1 second (the minimum)
    this._handle?.timeout(Math.ceil(timeout / 1000));
    this.timeout = timeout;
    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.once("timeout", callback);
    }
    return this;
  }
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
}

function onConnectEnd(this: Socket) {
  if (!this._hadError && this.secureConnecting) {
    const options = this[kConnectOptions];
    $assert(options);
    this._hadError = true;
    const error = new ConnResetException(
      "Client network socket disconnected before secure TLS connection was established",
    );
    error.path = options.path;
    error.host = options.host;
    error.port = options.port;
    error.localAddress = options.localAddress;
    this.destroy(error);
  }
}

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
const connectErrorNT = destroyNT;
function destroyWhenAborted(err) {
  if (!this.destroyed) {
    this.destroy(err.target.reason);
  }
}

// in node's code this callback is called 'onReadableStreamEnd' but that seemed confusing when `ReadableStream`s now exist
function onSocketEnd(this: Socket) {
  if (!this.allowHalfOpen) {
    this.write = writeAfterFIN;
  }
}

function emitErrorAndCloseNextTick(self, error) {
  self.emit("error", error);
  self.emit("close");
}

// Provide a better error message when we call end() as a result
// of the other side sending a FIN.  The standard 'write after end'
// is overly vague, and makes it seem like the user's code is to blame.
function writeAfterFIN(this: Socket, chunk, encoding, cb?) {
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

class ConnResetException extends Error {
  path?;
  host?;
  port?;
  localAddress?;
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
  }

  get ["constructor"]() {
    return Error;
  }
}

function normalizeArgs(args: unknown[]) {
  while (args.length > 0 && args[args.length - 1] == null) args.pop();
  let arr: [options: Record<PropertyKey, any>, cb: Function | null];

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

function isPipeName(s: unknown): s is string {
  return typeof s === "string" && toNumber(s) === false;
}

function toNumber(x: any): number | false {
  return (x = Number(x)) >= 0 ? x : false;
}

export default { Socket };
