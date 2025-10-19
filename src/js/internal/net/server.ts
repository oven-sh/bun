import type { Socket, SocketHandler } from "bun";
import type { Server as NetServer, Socket as NetSocket, ServerOpts } from "node:net";
import type { TLSSocket } from "node:tls";
const {
  Duplex,
  getDefaultHighWaterMark,
  EventEmitter,
  dns,
  normalizedArgsSymbol,
  ExceptionWithHostPort,
  kTimeout,
  getTimerDuration,
  validateFunction,
  validateNumber,
  validateAbortSignal,
  validatePort,
  validateBoolean,
  validateInt32,
  validateString,
  NodeAggregateError,
  ErrnoException,
  ArrayPrototypeIncludes,
  ArrayPrototypePush,
  MathMax,
  UV_ECANCELED,
  UV_ETIMEDOUT,
  isWindows,
  getDefaultAutoSelectFamily,
  setDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,
  SocketAddress,
  BlockList,
  newDetachedSocket,
  doConnect,
  addServerName,
  upgradeDuplexToTLS,
  isNamedPipeSocket,
  getBufferedAmount,
  isIPv4,
  isIPv6,
  isIP,
  bunTlsSymbol,
  bunSocketServerOptions,
  owner_symbol,
  kServerSocket,
  kBytesWritten,
  bunTLSConnectOptions,
  kReinitializeHandle,
  kRealListen,
  kSetNoDelay,
  kSetKeepAlive,
  kSetKeepAliveInitialDelay,
  kConnectOptions,
  kAttach,
  kCloseRawConnection,
  kpendingRead,
  kupgraded,
  ksocket,
  khandlers,
  kclosed,
  kended,
  kwriteCallback,
  kSocketClass,
  endNT,
  emitCloseNT,
  detachSocket,
  destroyNT,
  destroyWhenAborted,
  onSocketEnd,
  writeAfterFIN,
  onConnectEnd,
  ConnResetException,
} = require("internal/net/shared");
const { Socket, SocketHandlers } = require("internal/net/socket");

const SocketEmitEndNT = function SocketEmitEndNT(self, err) {
  if (!self.writable) emitCloseNT(self, !!err);
  if (!self.destroyed) self.emit("end");
};

const ServerHandlers: SocketHandler<NetSocket> = {
  data(socket, buffer) {
    const { data: self } = socket;
    if (!self) return;

    self.bytesRead += buffer.length;
    if (!self.push(buffer)) {
      socket.pause();
    }
  },
  close(socket, err) {
    $debug("Bun.Server close");
    const data = this.data;
    if (!data) return;

    {
      if (!data[kclosed]) {
        data[kclosed] = true;
        //socket cannot be used after close
        detachSocket(data);
        SocketEmitEndNT(data, err);
        data.data = null;
        socket[owner_symbol] = null;
      }
    }
  },
  end(socket) {
    SocketHandlers.end(socket);
  },
  open(socket) {
    $debug("Bun.Server open");
    const self = socket.data as any as NetServer;
    socket[kServerSocket] = self._handle;
    const options = self[bunSocketServerOptions];
    const { pauseOnConnect, connectionListener, [kSocketClass]: SClass, requestCert, rejectUnauthorized } = options;
    const _socket = new SClass({}) as NetSocket | TLSSocket;
    _socket.isServer = true;
    _socket._requestCert = requestCert;
    _socket._rejectUnauthorized = rejectUnauthorized;

    _socket[kAttach](this.localPort, socket);

    if (self.blockList) {
      const addressType = isIP(socket.remoteAddress);
      if (addressType && self.blockList.check(socket.remoteAddress, `ipv${addressType}`)) {
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
    }
    if (self.maxConnections != null && self._connections >= self.maxConnections) {
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

    self._connections++;
    _socket.server = self;

    if (pauseOnConnect) {
      _socket.pause();
    }

    if (typeof connectionListener === "function") {
      this.pauseOnConnect = pauseOnConnect;
      if (!isTLS) {
        self.prependOnceListener("connection", connectionListener);
      }
    }
    self.emit("connection", _socket);
    // the duplex implementation start paused, so we resume when pauseOnConnect is falsy
    if (!pauseOnConnect && !isTLS) {
      _socket.resume();
    }
  },
  handshake(socket, success, verifyError) {
    const self = socket.data;
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
    const server = self.server!;
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
      server.prependOnceListener("secureConnection", connectionListener);
    }
    server.emit("secureConnection", self);
    // after secureConnection event we emmit secure and secureConnect
    self.emit("secure", self);
    self.emit("secureConnect", verifyError);
    if (server.pauseOnConnect) {
      self.pause();
    } else {
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
        SocketHandlers.error(socket, error, true);
        return;
      }
    }
    SocketHandlers.error(socket, error, true);
    data.server.emit("clientError", error, data);
  },
  timeout(socket) {
    SocketHandlers.timeout(socket);
  },
  drain(socket) {
    SocketHandlers.drain(socket);
  },
  binaryType: "buffer",
} as const;

// TODO: SocketHandlers2 is a bad name but its temporary. reworking the Server in a followup PR
const SocketHandlers2: SocketHandler<NonNullable<import("node:net").Socket["_handle"]>["data"]> = {
  open(socket) {
    $debug("Bun.Socket open");
    let { self, req } = socket.data;
    socket[owner_symbol] = self;
    $debug("self[kupgraded]", String(self[kupgraded]));
    if (!self[kupgraded]) req!.oncomplete(0, self._handle, req, true, true);
    socket.data.req = undefined;
    if (self.pauseOnConnect) {
      self.pause();
    }
    if (self[kupgraded]) {
      self.connecting = false;
      const options = self[bunTLSConnectOptions];
      if (options) {
        const { session } = options;
        if (session) {
          self.setSession(session);
        }
      }
      SocketHandlers2.drain!(socket);
    }
  },
  data(socket, buffer) {
    $debug("Bun.Socket data");
    const { self } = socket.data;
    self.bytesRead += buffer.length;
    if (!self.push(buffer)) socket.pause();
  },
  drain(socket) {
    $debug("Bun.Socket drain");
    const { self } = socket.data;
    const callback = self[kwriteCallback];
    self.connecting = false;
    if (callback) {
      const writeChunk = self._pendingData;
      if (socket.$write(writeChunk || "", self._pendingEncoding || "utf8")) {
        self[kBytesWritten] = socket.bytesWritten;
        self._pendingData = self[kwriteCallback] = null;
        callback(null);
      } else {
        self[kBytesWritten] = socket.bytesWritten;
        self._pendingData = null;
      }
    }
  },
  end(socket) {
    $debug("Bun.Socket end");
    const { self } = socket.data;
    if (self[kended]) return;
    self[kended] = true;
    if (!self.allowHalfOpen) self.write = writeAfterFIN;
    self.push(null);
    self.read(0);
  },
  close(socket, err) {
    $debug("Bun.Socket close");
    let { self } = socket.data;
    if (err) $debug(err);
    if (self[kclosed]) return;
    self[kclosed] = true;
    // TODO: should we be doing something with err?
    self[kended] = true;
    if (!self.allowHalfOpen) self.write = writeAfterFIN;
    self.push(null);
    self.read(0);
  },
  handshake(socket, success, verifyError) {
    $debug("Bun.Socket handshake");
    const { self } = socket.data;
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
  error(socket, error) {
    $debug("Bun.Socket error");
    if (socket.data === undefined) return;
    const { self } = socket.data;
    if (self._hadError) return;
    self._hadError = true;

    const callback = self[kwriteCallback];
    if (callback) {
      self[kwriteCallback] = null;
      callback(error);
    }

    if (!self.destroyed) process.nextTick(destroyNT, self, error);
  },
  timeout(socket) {
    $debug("Bun.Socket timeout");
    const { self } = socket.data;
    self.emit("timeout", self);
  },
  connectError(socket, error) {
    $debug("Bun.Socket connectError");
    let { self, req } = socket.data;
    socket[owner_symbol] = self;
    req!.oncomplete(error.errno, self._handle, req, true, true);
    socket.data.req = undefined;
  },
};

export function Server();
export function Server(options?: null | undefined);
export function Server(connectionListener: () => {});
export function Server(options: ServerOpts, connectionListener?: () => {});
export function Server(options?, connectionListener?) {
  if (!(this instanceof Server)) {
    return new Server(options, connectionListener);
  }

  EventEmitter.$apply(this, []);

  if (typeof options === "function") {
    connectionListener = options;
    options = {};
  } else if (options == null || typeof options === "object") {
    options = { ...options };
  } else {
    throw $ERR_INVALID_ARG_TYPE("options", ["Object", "Function"], options);
  }

  // https://nodejs.org/api/net.html#netcreateserveroptions-connectionlistener
  const {
    allowHalfOpen = false,
    keepAlive = false,
    keepAliveInitialDelay = 0,
    highWaterMark = getDefaultHighWaterMark(),
    pauseOnConnect = false,
    noDelay = false,
  } = options;

  this._connections = 0;

  this._handle = null as MaybeListener;
  this._usingWorkers = false;
  this.workers = [];
  this._unref = false;
  this.listeningId = 1;

  this[bunSocketServerOptions] = undefined;
  this.allowHalfOpen = allowHalfOpen;
  this.keepAlive = keepAlive;
  this.keepAliveInitialDelay = keepAliveInitialDelay;
  this.highWaterMark = highWaterMark;
  this.pauseOnConnect = Boolean(pauseOnConnect);
  this.noDelay = noDelay;

  options.connectionListener = connectionListener;
  this[bunSocketServerOptions] = options;

  if (options.blockList) {
    if (!BlockList.isBlockList(options.blockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", options.blockList);
    }
    this.blockList = options.blockList;
  }
}
$toClass(Server, "Server", EventEmitter);

Object.defineProperty(Server.prototype, "listening", {
  get() {
    return !!this._handle;
  },
});

Server.prototype.ref = function ref() {
  this._unref = false;
  this._handle?.ref();
  return this;
};

Server.prototype.unref = function unref() {
  this._unref = true;
  this._handle?.unref();
  return this;
};

Server.prototype.close = function close(callback) {
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
};

Server.prototype[Symbol.asyncDispose] = function () {
  const { resolve, reject, promise } = Promise.withResolvers();
  this.close(function (err, ...args) {
    if (err) reject(err);
    else resolve(...args);
  });
  return promise;
};

Server.prototype._emitCloseIfDrained = function _emitCloseIfDrained() {
  if (this._handle || this._connections > 0) {
    return;
  }
  process.nextTick(() => {
    this.emit("close");
  });
};

Server.prototype.address = function address() {
  const server = this._handle;
  if (server) {
    const unix = server.unix;
    if (unix) {
      return unix;
    }

    const out = {};
    const err = this._handle.getsockname(out);
    if (err) throw new ErrnoException(err, "address");
    return out;
  }
  return null;
};

Server.prototype.getConnections = function getConnections(callback) {
  if (typeof callback === "function") {
    //in Bun case we will never error on getConnections
    //node only errors if in the middle of the couting the server got disconnected, what never happens in Bun
    //if disconnected will only pass null as well and 0 connected
    callback(null, this._handle ? this._connections : 0);
  }
  return this;
};

Server.prototype.listen = function listen(port, hostname, onListen) {
  const argsLength = arguments.length;
  if (typeof port === "string") {
    const numPort = Number(port);
    if (!Number.isNaN(numPort)) port = numPort;
  }
  let backlog;
  let path;
  let exclusive = false;
  let allowHalfOpen = false;
  let reusePort = false;
  let ipv6Only = false;
  let fd;
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
    if (typeof hostname === "number") {
      backlog = hostname;
      hostname = undefined;
    } else if (typeof hostname === "function") {
      onListen = hostname;
      hostname = undefined;
    } else if (typeof hostname === "string" && typeof onListen === "number") {
      backlog = onListen;
      onListen = argsLength > 3 ? arguments[3] : undefined;
    }

    if (typeof port === "function") {
      onListen = port;
      port = 0;
    } else if (typeof port === "object") {
      const options = port;
      addServerAbortSignalOption(this, options);

      hostname = options.host;
      exclusive = options.exclusive;
      path = options.path;
      port = options.port;
      ipv6Only = options.ipv6Only;
      allowHalfOpen = options.allowHalfOpen;
      reusePort = options.reusePort;
      backlog = options.backlog;

      if (typeof options.fd === "number" && options.fd >= 0) {
        fd = options.fd;
        port = 0;
      }

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
      } else if (port === undefined) {
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

  if (typeof port === "number" && (port < 0 || port >= 65536)) {
    throw $ERR_SOCKET_BAD_PORT(`options.port should be >= 0 and < 65536. Received type number: (${port})`);
  }

  if (this._handle) {
    throw $ERR_SERVER_ALREADY_LISTEN();
  }

  if (onListen != null) {
    this.once("listening", onListen);
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
      options[kSocketClass] = TLSSocketClass;
      contexts = tls.contexts;
      if (!tls.requestCert) {
        tls.rejectUnauthorized = false;
      }
    } else {
      options[kSocketClass] = Socket;
    }

    listenInCluster(
      this,
      null,
      port,
      4,
      backlog,
      fd,
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
};

Server.prototype[kRealListen] = function (
  path,
  port,
  hostname,
  exclusive,
  ipv6Only,
  allowHalfOpen,
  reusePort,
  tls,
  contexts,
  _onListen,
  fd,
) {
  if (path) {
    this._handle = Bun.listen({
      unix: path,
      tls,
      allowHalfOpen: allowHalfOpen || this[bunSocketServerOptions]?.allowHalfOpen || false,
      reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
      ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
      exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
      socket: ServerHandlers,
      data: this,
    });
  } else if (fd != null) {
    this._handle = Bun.listen({
      fd,
      hostname,
      tls,
      allowHalfOpen: allowHalfOpen || this[bunSocketServerOptions]?.allowHalfOpen || false,
      reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
      ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
      exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
      socket: ServerHandlers,
      data: this,
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
      socket: ServerHandlers,
      data: this,
    });
  }

  const addr = this.address();
  if (addr && typeof addr === "object") {
    const familyLast = String(addr.family).slice(-1);
    this._connectionKey = `${familyLast}:${addr.address}:${port}`;
  }

  if (contexts) {
    for (const [name, context] of contexts) {
      addServerName(this._handle, name, context);
    }
  }

  // Unref the handle if the server was unref'ed prior to listening
  if (this._unref) this.unref();

  // We must schedule the emitListeningNextTick() only after the next run of
  // the event loop's IO queue. Otherwise, the server may not actually be listening
  // when the 'listening' event is emitted.
  //
  // That leads to all sorts of confusion.
  //
  // process.nextTick() is not sufficient because it will run before the IO queue.
  setTimeout(emitListeningNextTick, 1, this);
};

Server.prototype[EventEmitter.captureRejectionSymbol] = function (err, event, sock) {
  switch (event) {
    case "connection":
      sock.destroy(err);
      break;
    default:
      this.emit("error", err);
  }
};

Server.prototype.getsockname = function getsockname(out) {
  out.port = this.address().port;
  return out;
};

function emitErrorNextTick(self, error) {
  self.emit("error", error);
}

function emitErrorAndCloseNextTick(self, error) {
  self.emit("error", error);
  self.emit("close", true);
}

function addServerAbortSignalOption(self, options) {
  if (options?.signal === undefined) {
    return;
  }
  validateAbortSignal(options.signal, "options.signal");
  const { signal } = options;
  const onAborted = () => self.close();
  if (signal.aborted) {
    process.nextTick(onAborted);
  } else {
    signal.addEventListener("abort", onAborted);
  }
}

function emitListeningNextTick(self) {
  if (!self._handle) return;
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
    server[kRealListen](
      path,
      port,
      hostname,
      exclusive,
      ipv6Only,
      allowHalfOpen,
      reusePort,
      tls,
      contexts,
      onListen,
      fd,
    );
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
    server[kRealListen](
      path,
      port,
      hostname,
      exclusive,
      ipv6Only,
      allowHalfOpen,
      reusePort,
      tls,
      contexts,
      onListen,
      fd,
    );
  });
}
