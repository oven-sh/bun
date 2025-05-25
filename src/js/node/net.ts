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
const [addServerName, upgradeDuplexToTLS, isNamedPipeSocket, getBufferedAmount] = $zig(
  "socket.zig",
  "createNodeTLSBinding",
);
const normalizedArgsSymbol = Symbol("normalizedArgs");
const { ExceptionWithHostPort } = require("internal/shared");
import type { SocketHandler, SocketListener } from "bun";
import type { ServerOpts } from "node:net";
const { getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validateAbortSignal } = require("internal/validators");

const getDefaultAutoSelectFamily = $zig("node_net_binding.zig", "getDefaultAutoSelectFamily");
const setDefaultAutoSelectFamily = $zig("node_net_binding.zig", "setDefaultAutoSelectFamily");
const getDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "getDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const setDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "setDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const SocketAddress = $zig("node_net_binding.zig", "SocketAddress");
const BlockList = $zig("node_net_binding.zig", "BlockList");

// IPv4 Segment
const v4Seg = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
var IPv4Reg;

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg;

function isIPv4(s): boolean {
  return (IPv4Reg ??= new RegExp(`^${v4Str}$`)).test(s);
}

function isIPv6(s): boolean {
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

function isIP(s): 0 | 4 | 6 {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

const { connect: bunConnect } = Bun;
var { setTimeout } = globalThis;

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerConnections = Symbol.for("::bunnetserverconnections::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");

const kServerSocket = Symbol("kServerSocket");
const kBytesWritten = Symbol("kBytesWritten");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");

const kRealListen = Symbol("kRealListen");
const kSetNoDelay = Symbol("kSetNoDelay");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");
const kConnectOptions = Symbol("connect-options");
const kAttach = Symbol("kAttach");
const kCloseRawConnection = Symbol("kCloseRawConnection");
const kpendingRead = Symbol("kpendingRead");
const kupgraded = Symbol("kupgraded");
const ksocket = Symbol("ksocket");
const khandlers = Symbol("khandlers");
const kclosed = Symbol("closed");
const kended = Symbol("ended");
const kwriteCallback = Symbol("writeCallback");
const kSocketClass = Symbol("kSocketClass");

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
function destroyNT(self, err) {
  self.destroy(err);
}
function destroyWhenAborted(err) {
  if (!this.destroyed) {
    this.destroy(err.target.reason);
  }
}
// in node's code this callback is called 'onReadableStreamEnd' but that seemed confusing when `ReadableStream`s now exist
function onSocketEnd() {
  if (!this.allowHalfOpen) {
    this.write = writeAfterFIN;
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
function onConnectEnd() {
  if (!this._hadError && this.secureConnecting) {
    const options = this[kConnectOptions];
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

const SocketHandlers: SocketHandler = {
  close(socket, err) {
    const self = socket.data;
    if (!self || self[kclosed]) return;
    self[kclosed] = true;
    //socket cannot be used after close
    detachSocket(self);
    SocketEmitEndNT(self, err);
    self.data = null;
  },
  data(socket, buffer) {
    const { data: self } = socket;
    if (!self) return;

    self.bytesRead += buffer.length;
    if (!self.push(buffer)) {
      socket.pause();
    }
  },
  drain(socket) {
    const self = socket.data;
    if (!self) return;
    const callback = self[kwriteCallback];
    self.connecting = false;
    if (callback) {
      const writeChunk = self._pendingData;
      if (socket.$write(writeChunk || "", self._pendingEncoding || "utf8")) {
        self._pendingData = self[kwriteCallback] = null;
        callback(null);
      } else {
        self._pendingData = null;
      }

      self[kBytesWritten] = socket.bytesWritten;
    }
  },
  end(socket) {
    const self = socket.data;
    if (!self) return;

    // we just reuse the same code but we can push null or enqueue right away
    SocketEmitEndNT(self);
  },
  error(socket, error, ignoreHadError) {
    const self = socket.data;
    if (!self) return;
    if (self._hadError && !ignoreHadError) return;
    self._hadError = true;

    const callback = self[kwriteCallback];
    if (callback) {
      self[kwriteCallback] = null;
      callback(error);
    }
    self.emit("error", error);
  },
  open(socket) {
    const self = socket.data;
    if (!self) return;
    socket.timeout(Math.ceil(self.timeout / 1000));

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

    if (!self[kupgraded]) {
      self[kBytesWritten] = socket.bytesWritten;
      // this is not actually emitted on nodejs when socket used on the connection
      // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
      self.emit("connect", self);
      self.emit("ready");
    }

    SocketHandlers.drain(socket);
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

const SocketEmitEndNT = (self, _err?) => {
  if (!self[kended]) {
    if (!self.allowHalfOpen) {
      self.write = writeAfterFIN;
    }
    self[kended] = true;
    self.push(null);
  }
  // TODO: check how the best way to handle this
  // if (err) {
  //   self.destroy(err);
  // }
};

const ServerHandlers: SocketHandler = {
  data(socket, buffer) {
    const { data: self } = socket;
    if (!self) return;

    self.bytesRead += buffer.length;
    if (!self.push(buffer)) {
      socket.pause();
    }
  },
  close(socket, err) {
    const data = this.data;
    if (!data) return;

    data.server[bunSocketServerConnections]--;
    {
      if (!data[kclosed]) {
        data[kclosed] = true;
        //socket cannot be used after close
        detachSocket(data);
        SocketEmitEndNT(data, err);
        data.data = null;
      }
    }

    data.server._emitCloseIfDrained();
  },
  end(socket) {
    SocketHandlers.end(socket);
  },
  open(socket) {
    const self = this.data;
    socket[kServerSocket] = self._handle;
    const options = self[bunSocketServerOptions];
    const { pauseOnConnect, connectionListener, [kSocketClass]: SClass, requestCert, rejectUnauthorized } = options;
    const _socket = new SClass({});
    _socket.isServer = true;
    _socket.server = self;
    _socket._requestCert = requestCert;
    _socket._rejectUnauthorized = rejectUnauthorized;

    _socket[kAttach](this.localPort, socket);
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
        SocketHandlers.error(socket, error, true);
        return;
      }
    }
    SocketHandlers.error(socket, error, true);
    data.server.emit("clientError", error, data);
  },
  timeout: SocketHandlers.timeout,
  drain: SocketHandlers.drain,
  binaryType: "buffer",
};

function Socket(options?) {
  if (!(this instanceof Socket)) return new Socket(options);

  const {
    socket,
    signal,
    allowHalfOpen = false,
    onread = null,
    noDelay = false,
    keepAlive = false,
    keepAliveInitialDelay = 0,
    ...opts
  } = options || {};

  if (options?.objectMode) throw $ERR_INVALID_ARG_VALUE("options.objectMode", options.objectMode, "is not supported");
  if (options?.readableObjectMode)
    throw $ERR_INVALID_ARG_VALUE("options.readableObjectMode", options.readableObjectMode, "is not supported");
  if (options?.writableObjectMode)
    throw $ERR_INVALID_ARG_VALUE("options.writableObjectMode", options.writableObjectMode, "is not supported");

  Duplex.$call(this, {
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
  this[kpendingRead] = undefined;
  this[kupgraded] = null;

  this[kSetNoDelay] = Boolean(noDelay);
  this[kSetKeepAlive] = Boolean(keepAlive);
  this[kSetKeepAliveInitialDelay] = ~~(keepAliveInitialDelay / 1000);

  this[khandlers] = SocketHandlers;
  this.bytesRead = 0;
  this[kBytesWritten] = undefined;
  this[kclosed] = false;
  this[kended] = false;
  this.connecting = false;
  this.localAddress = "127.0.0.1";
  this.remotePort = undefined;
  this[bunTLSConnectOptions] = null;
  this.timeout = 0;
  this[kwriteCallback] = undefined;
  this._pendingData = undefined;
  this._pendingEncoding = undefined; // for compatibility
  this[kpendingRead] = undefined;
  this._hadError = false;
  this.isServer = false;
  this._handle = null;
  this._parent = undefined;
  this._parentWrap = undefined;
  this[ksocket] = undefined;
  this.server = undefined;
  this.pauseOnConnect = false;
  this[kupgraded] = undefined;

  // Shut down the socket when we're finished with it.
  this.on("end", onSocketEnd);

  if (socket instanceof Socket) {
    this[ksocket] = socket;
  }
  if (onread) {
    if (typeof onread !== "object") {
      throw new TypeError("onread must be an object");
    }
    if (typeof onread.callback !== "function") {
      throw new TypeError("onread.callback must be a function");
    }
    // when the onread option is specified we use a different handlers object
    this[khandlers] = {
      ...SocketHandlers,
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
$toClass(Socket, "Socket", Duplex);

Socket.prototype.address = function address() {
  return {
    address: this.localAddress,
    family: this.localFamily,
    port: this.localPort,
  };
};

Socket.prototype._onTimeout = function () {
  // if there is pending data, write is in progress
  // so we suppress the timeout
  if (this._pendingData) {
    return;
  }

  const handle = this._handle;
  // if there is a handle, and it has pending data,
  // we suppress the timeout because a write is in progress
  if (handle && getBufferedAmount(handle) > 0) {
    return;
  }
  this.emit("timeout");
};

Object.defineProperty(Socket.prototype, "bufferSize", {
  get: function () {
    return this.writableLength;
  },
});

Object.defineProperty(Socket.prototype, "_bytesDispatched", {
  get: function () {
    return this[kBytesWritten] || 0;
  },
});

Object.defineProperty(Socket.prototype, "bytesWritten", {
  get: function () {
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
  },
});

Socket.prototype[kAttach] = function (port, socket) {
  this.remotePort = port;
  socket.data = this;
  socket.timeout(Math.ceil(this.timeout / 1000));
  this._handle = socket;
  this.connecting = false;

  if (this[kSetNoDelay]) {
    socket.setNoDelay(true);
  }

  if (this[kSetKeepAlive]) {
    socket.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
  }

  if (!this[kupgraded]) {
    this[kBytesWritten] = socket.bytesWritten;
    // this is not actually emitted on nodejs when socket used on the connection
    // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
    this.emit("connect", this);
    this.emit("ready");
  }
  SocketHandlers.drain(socket);
};

Socket.prototype[kCloseRawConnection] = function () {
  const connection = this[kupgraded];
  connection.connecting = false;
  connection._handle = null;
  connection.unref();
  connection.destroy();
};

Socket.prototype.connect = function connect(...args) {
  const [options, connectListener] =
    $isArray(args[0]) && args[0][normalizedArgsSymbol]
      ? // args have already been normalized.
        // Normalized array is passed as the first and only argument.
        ($assert(args[0].length == 2 && typeof args[0][0] === "object"), args[0])
      : normalizeArgs(args);
  let connection = this[ksocket];
  let upgradeDuplex = false;
  let {
    fd,
    port,
    host,
    path,
    socket,
    localAddress,
    localPort,
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
      socket: this[khandlers],
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
  if (
    // TLSSocket already created a socket and is forwarding it here. This is a private API.
    !(socket && $isObject(socket) && socket instanceof Duplex) &&
    // public api for net.Socket.connect
    port === undefined &&
    path == null
  ) {
    throw $ERR_MISSING_ARGS(["options", "port", "path"]);
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
        this[kupgraded] = connection;
        const [result, events] = upgradeDuplexToTLS(connection, {
          data: this,
          tls,
          socket: this[khandlers],
        });
        connection.on("data", events[0]);
        connection.on("end", events[1]);
        connection.on("drain", events[2]);
        connection.on("close", events[3]);
        this._handle = result;
      } else {
        if (socket) {
          this.connecting = true;
          this[kupgraded] = connection;
          const result = socket.upgradeTLS({
            data: this,
            tls,
            socket: this[khandlers],
          });
          if (result) {
            const [raw, tls] = result;
            // replace socket
            connection._handle = raw;
            this.once("end", this[kCloseRawConnection]);
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
              this[kupgraded] = connection;
              const [result, events] = upgradeDuplexToTLS(connection, {
                data: this,
                tls,
                socket: this[khandlers],
              });
              connection.on("data", events[0]);
              connection.on("end", events[1]);
              connection.on("drain", events[2]);
              connection.on("close", events[3]);
              this._handle = result;
            } else {
              this.connecting = true;
              this[kupgraded] = connection;
              const result = socket.upgradeTLS({
                data: this,
                tls,
                socket: this[khandlers],
              });
              if (result) {
                const [raw, tls] = result;
                // replace socket
                connection._handle = raw;
                this.once("end", this[kCloseRawConnection]);
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
        socket: this[khandlers],
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
        socket: this[khandlers],
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
};

Socket.prototype.end = function end(...args) {
  if (!this._readableState.endEmitted) {
    this.secureConnecting = false;
  }
  return Duplex.prototype.end.$apply(this, args);
};

Socket.prototype._destroy = function _destroy(err, callback) {
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

  detachSocket(self);
  callback(err);
  process.nextTick(emitCloseNT, this, !!err);
};

Socket.prototype._final = function _final(callback) {
  if (this.connecting) {
    return this.once("connect", () => this._final(callback));
  }
  const socket = this._handle;

  // already closed call destroy
  if (!socket) return callback();

  // emit FIN allowHalfOpen only allow the readable side to close first
  process.nextTick(endNT, socket, callback);
};

Object.defineProperty(Socket.prototype, "localFamily", {
  get: function () {
    return "IPv4";
  },
});

Object.defineProperty(Socket.prototype, "localPort", {
  get: function () {
    return this._handle?.localPort;
  },
});

Object.defineProperty(Socket.prototype, "_connecting", {
  get: function () {
    return this.connecting;
  },
});

Object.defineProperty(Socket.prototype, "pending", {
  get: function () {
    return !this._handle || this.connecting;
  },
});

Socket.prototype.resume = function resume() {
  if (!this.connecting) {
    this._handle?.resume();
  }
  return Duplex.prototype.resume.$call(this);
};

Socket.prototype.pause = function pause() {
  if (!this.destroyed) {
    this._handle?.pause();
  }
  return Duplex.prototype.pause.$call(this);
};

Socket.prototype.read = function read(size) {
  if (!this.connecting) {
    this._handle?.resume();
  }
  return Duplex.prototype.read.$call(this, size);
};

Socket.prototype._read = function _read(size) {
  const socket = this._handle;
  if (this.connecting || !socket) {
    this.once("connect", () => this._read(size));
  } else {
    socket?.resume();
  }
};

Socket.prototype._reset = function _reset() {
  this.resetAndClosing = true;
  return this.destroy();
};

Object.defineProperty(Socket.prototype, "readyState", {
  get: function () {
    if (this.connecting) return "opening";
    if (this.readable && this.writable) return "open";
    if (this.readable && !this.writable) return "readOnly";
    if (!this.readable && this.writable) return "writeOnly";
    return "closed";
  },
});

Socket.prototype.ref = function ref() {
  const socket = this._handle;
  if (!socket) {
    this.once("connect", this.ref);
    return this;
  }
  socket.ref();
  return this;
};

Object.defineProperty(Socket.prototype, "remoteAddress", {
  get: function () {
    return this._handle?.remoteAddress;
  },
});

Object.defineProperty(Socket.prototype, "remoteFamily", {
  get: function () {
    return "IPv4";
  },
});

Socket.prototype.resetAndDestroy = function resetAndDestroy() {
  if (this._handle) {
    if (this.connecting) {
      this.once("connect", () => this._reset());
    } else {
      this._reset();
    }
  } else {
    this.destroy($ERR_SOCKET_CLOSED());
  }
  return this;
};

Socket.prototype.setKeepAlive = function setKeepAlive(enable = false, initialDelayMsecs = 0) {
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
};

Socket.prototype.setNoDelay = function setNoDelay(enable = true) {
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
};

Socket.prototype.setTimeout = function setTimeout(timeout, callback) {
  timeout = getTimerDuration(timeout, "msecs");
  // internally or timeouts are in seconds
  // we use Math.ceil because 0 would disable the timeout and less than 1 second but greater than 1ms would be 1 second (the minimum)
  if (callback !== undefined) {
    validateFunction(callback, "callback");
    this.once("timeout", callback);
  }
  this._handle?.timeout(Math.ceil(timeout / 1000));
  this.timeout = timeout;
  return this;
};

Socket.prototype._unrefTimer = function _unrefTimer() {
  // for compatibility
};

Socket.prototype.unref = function unref() {
  const socket = this._handle;
  if (!socket) {
    this.once("connect", this.unref);
    return this;
  }
  socket.unref();
  return this;
};

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L785
Socket.prototype.destroySoon = function destroySoon() {
  if (this.writable) this.end();
  if (this.writableFinished) this.destroy();
  else this.once("finish", this.destroy);
};

//TODO: migrate to native
Socket.prototype._writev = function _writev(data, callback) {
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
};

Socket.prototype._write = function _write(chunk, encoding, callback) {
  // If we are still connecting, then buffer this for later.
  // The Writable logic will buffer up any more writes while
  // waiting for this one to be done.
  if (this.connecting) {
    this[kwriteCallback] = callback;
    this._pendingData = chunk;
    this._pendingEncoding = encoding;
    function onClose() {
      callback($ERR_SOCKET_CLOSED_BEFORE_CONNECTION());
    }
    this.once("connect", function connect() {
      this.off("close", onClose);
    });
    this.once("close", onClose);
    return;
  }
  this._pendingData = null;
  this._pendingEncoding = "";
  this[kwriteCallback] = null;
  const socket = this._handle;
  if (!socket) {
    callback($ERR_SOCKET_CLOSED());
    return false;
  }
  const success = socket.$write(chunk, encoding);
  this[kBytesWritten] = socket.bytesWritten;
  if (success) {
    callback();
  } else if (this[kwriteCallback]) {
    callback(new Error("overlapping _write()"));
  } else {
    this[kwriteCallback] = callback;
  }
};

function createConnection(port, host, connectListener) {
  if (typeof port === "object") {
    // port is option pass Socket options and let connect handle connection options
    return new Socket(port).connect(port, host, connectListener);
  }
  // port is path or host, let connect handle this
  return new Socket().connect(port, host, connectListener);
}

const connect = createConnection;

type MaybeListener = SocketListener<unknown> | null;

function Server();
function Server(options?: null | undefined);
function Server(connectionListener: () => {});
function Server(options: ServerOpts, connectionListener?: () => {});
function Server(options?, connectionListener?) {
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

  $assert(typeof Duplex.getDefaultHighWaterMark === "function");

  // https://nodejs.org/api/net.html#netcreateserveroptions-connectionlistener
  const {
    maxConnections, //
    allowHalfOpen = false,
    keepAlive = false,
    keepAliveInitialDelay = 0,
    highWaterMark = Duplex.getDefaultHighWaterMark(),
    pauseOnConnect = false,
    noDelay = false,
  } = options;

  this._connections = 0;

  this._handle = null as MaybeListener;
  this._usingWorkers = false;
  this.workers = [];
  this._unref = false;
  this.listeningId = 1;

  this[bunSocketServerConnections] = 0;
  this[bunSocketServerOptions] = undefined;
  this.allowHalfOpen = allowHalfOpen;
  this.keepAlive = keepAlive;
  this.keepAliveInitialDelay = keepAliveInitialDelay;
  this.highWaterMark = highWaterMark;
  this.pauseOnConnect = Boolean(pauseOnConnect);
  this.noDelay = noDelay;
  this.maxConnections = Number.isSafeInteger(maxConnections) && maxConnections > 0 ? maxConnections : 0;
  // TODO: options.blockList

  options.connectionListener = connectionListener;
  this[bunSocketServerOptions] = options;
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
  if (this._handle || this[bunSocketServerConnections] > 0) {
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
    callback(null, this._handle ? this[bunSocketServerConnections] : 0);
  }
  return this;
};

Server.prototype.listen = function listen(port, hostname, onListen) {
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
    if (typeof hostname === "function") {
      onListen = hostname;
      hostname = undefined;
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
    });
  }

  //make this instance available on handlers
  this._handle.data = this;

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

Server.prototype.getsockname = function getsockname(out) {
  out.port = this.address().port;
  return out;
};

function emitErrorNextTick(self, error) {
  self.emit("error", error);
}

function emitErrorAndCloseNextTick(self, error) {
  self.emit("error", error);
  self.emit("close");
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

class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
  }

  get ["constructor"]() {
    return Error;
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

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

function normalizeArgs(args: unknown[]): [options: Record<PropertyKey, any>, cb: Function | null] {
  while (args.length && args[args.length - 1] == null) args.pop();
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol as symbol] = true;
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
  arr[normalizedArgsSymbol as symbol] = true;

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

export default {
  createServer,
  Server,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  _normalizeArgs: normalizeArgs,

  getDefaultAutoSelectFamily,
  setDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,

  BlockList,
  SocketAddress,
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  Stream: Socket,
} as any as typeof import("node:net");
