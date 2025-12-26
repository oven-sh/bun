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
const Duplex = require("internal/streams/duplex");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const EventEmitter = require("node:events");
let dns: typeof import("node:dns");

const normalizedArgsSymbol = Symbol("normalizedArgs");
const { ExceptionWithHostPort, ConnResetException, NodeAggregateError, ErrnoException } = require("internal/shared");
import type { Socket, SocketHandler, SocketListener } from "bun";
import type { Server as NetServer, Socket as NetSocket, ServerOpts } from "node:net";
import type { TLSSocket } from "node:tls";
const { kTimeout, getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validateAbortSignal, validatePort, validateBoolean, validateInt32, validateString } = require("internal/validators"); // prettier-ignore
const { isIPv4, isIPv6, isIP } = require("internal/net/isIP");

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypePush = Array.prototype.push;
const MathMax = Math.max;

const { UV_ECANCELED, UV_ETIMEDOUT } = process.binding("uv");
const isWindows = process.platform === "win32";

const getDefaultAutoSelectFamily = $zig("node_net_binding.zig", "getDefaultAutoSelectFamily");
const setDefaultAutoSelectFamily = $zig("node_net_binding.zig", "setDefaultAutoSelectFamily");
const getDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "getDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const setDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "setDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const SocketAddress = $zig("node_net_binding.zig", "SocketAddress");
const BlockList = $zig("node_net_binding.zig", "BlockList");
const newDetachedSocket = $newZigFunction("node_net_binding.zig", "newDetachedSocket", 1);
const doConnect = $newZigFunction("node_net_binding.zig", "doConnect", 2);

const addServerName = $newZigFunction("Listener.zig", "jsAddServerName", 3);
const upgradeDuplexToTLS = $newZigFunction("socket.zig", "jsUpgradeDuplexToTLS", 2);
const isNamedPipeSocket = $newZigFunction("socket.zig", "jsIsNamedPipeSocket", 1);
const getBufferedAmount = $newZigFunction("socket.zig", "jsGetBufferedAmount", 1);

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const owner_symbol = Symbol("owner_symbol");

const kServerSocket = Symbol("kServerSocket");
const kBytesWritten = Symbol("kBytesWritten");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
const kReinitializeHandle = Symbol("kReinitializeHandle");

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
  self.emit("close", hasError);
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
  error(socket, error) {
    const self = socket.data;
    if (!self) return;
    if (self._hadError) return;
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
    // make sure to disable timeout on usocket and handle on TS side
    socket.timeout(0);
    if (self.timeout) {
      self.setTimeout(self.timeout);
    }
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
} as const;

function SocketEmitEndNT(self, _err?) {
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
}

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
    this.server?.emit("clientError", error, data);
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

function kConnectTcp(self, addressType, req, address, port) {
  $debug("SocketHandle.kConnectTcp", addressType, address, port);
  const promise = doConnect(self._handle, {
    hostname: address,
    port,
    ipv6Only: addressType === 6,
    allowHalfOpen: self.allowHalfOpen,
    tls: req.tls,
    data: { self, req },
    socket: self[khandlers],
  });
  promise.catch(_reason => {
    // eat this so there's no unhandledRejection
    // we already catch this in connectError and error
  });
  return 0;
}

function kConnectPipe(self, req, address) {
  $debug("SocketHandle.kConnectPipe");
  const promise = doConnect(self._handle, {
    hostname: address,
    unix: address,
    allowHalfOpen: self.allowHalfOpen,
    tls: req.tls,
    data: { self, req },
    socket: self[khandlers],
  });
  promise.catch(_reason => {
    // eat this so there's no unhandledRejection
    // we already catch this in connectError and error
  });
  return 0;
}

function Socket(options?) {
  if (!(this instanceof Socket)) return new Socket(options);

  let {
    socket,
    signal,
    allowHalfOpen = false,
    onread = null,
    noDelay = false,
    keepAlive = false,
    keepAliveInitialDelay,
    ...opts
  } = options || {};

  if (options?.objectMode) throw $ERR_INVALID_ARG_VALUE("options.objectMode", options.objectMode, "is not supported");
  if (options?.readableObjectMode)
    throw $ERR_INVALID_ARG_VALUE("options.readableObjectMode", options.readableObjectMode, "is not supported");
  if (options?.writableObjectMode)
    throw $ERR_INVALID_ARG_VALUE("options.writableObjectMode", options.writableObjectMode, "is not supported");

  if (keepAliveInitialDelay !== undefined) {
    validateNumber(keepAliveInitialDelay, "options.keepAliveInitialDelay");
    if (keepAliveInitialDelay < 0) keepAliveInitialDelay = 0;
  }

  if (options?.fd !== undefined) {
    validateInt32(options.fd, "options.fd", 0);
  }

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
  this._parent = null;
  this._parentWrap = null;
  this[kpendingRead] = undefined;
  this[kupgraded] = null;

  this[kSetNoDelay] = Boolean(noDelay);
  this[kSetKeepAlive] = Boolean(keepAlive);
  this[kSetKeepAliveInitialDelay] = ~~(keepAliveInitialDelay / 1000);

  this[khandlers] = SocketHandlers2;
  this.bytesRead = 0;
  this[kBytesWritten] = undefined;
  this[kclosed] = false;
  this[kended] = false;
  this.connecting = false;
  this._host = undefined;
  this._port = undefined;
  this[bunTLSConnectOptions] = null;
  this.timeout = 0;
  this[kwriteCallback] = undefined;
  this._pendingData = undefined;
  this._pendingEncoding = undefined; // for compatibility
  this._hadError = false;
  this.isServer = false;
  this._handle = null;
  this[ksocket] = undefined;
  this.server = undefined;
  this.pauseOnConnect = false;
  this._peername = null;
  this._sockname = null;
  this._closeAfterHandlingError = false;

  // Shut down the socket when we're finished with it.
  this.on("end", onSocketEnd);

  if (options?.fd !== undefined) {
    const { fd } = options;
    validateInt32(fd, "fd", 0);
  }

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
      ...SocketHandlers2,
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
  if (opts.blockList) {
    if (!BlockList.isBlockList(opts.blockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", opts.blockList);
    }
    this.blockList = opts.blockList;
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
      // Writes are either a string or a Buffer.
      if (typeof data !== "string") bytes += data.length;
      else bytes += Buffer.byteLength(data, this._pendingEncoding || "utf8");
    }
    return bytes;
  },
});

Socket.prototype[kAttach] = function (port, socket) {
  socket.data = this;
  socket[owner_symbol] = this;
  if (this.timeout) {
    this.setTimeout(this.timeout);
  }
  // make sure to disable timeout on usocket and handle on TS side
  socket.timeout(0);
  this._handle = socket;
  this.connecting = false;

  if (this[kSetNoDelay]) {
    socket.setNoDelay(true);
  }

  if (this[kSetKeepAlive]) {
    socket.setKeepAlive(true, this[kSetKeepAliveInitialDelay]);
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
  $debug("Socket.prototype.connect");
  {
    const [options, connectListener] =
      $isArray(args[0]) && args[0][normalizedArgsSymbol] ? args[0] : normalizeArgs(args);
    let connection = this[ksocket];
    let upgradeDuplex = false;
    let { port, host, path, socket, rejectUnauthorized, checkServerIdentity, session, fd, pauseOnConnect } = options;
    this.servername = options.servername;
    if (socket) {
      connection = socket;
    }
    if (fd) {
      doConnect(this._handle, {
        data: this,
        fd: fd,
        socket: SocketHandlers,
        allowHalfOpen: this.allowHalfOpen,
      }).catch(error => {
        if (!this.destroyed) {
          this.emit("error", error);
          this.emit("close", true);
        }
      });
    }
    this.pauseOnConnect = pauseOnConnect;
    if (pauseOnConnect) {
      this.pause();
    } else {
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
    const bunTLS = this[bunTlsSymbol];
    var tls: any | undefined = undefined;
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
      this[kConnectOptions] = options;
      this.prependListener("end", onConnectEnd);
    }
    // start using existing connection
    if (connection) {
      if (connectListener != null) this.once("secureConnect", connectListener);
      try {
        // reset the underlying writable object when establishing a new connection
        // this is a function on `Duplex`, originally defined on `Writable`
        // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L311
        // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L1126
        this._undestroy();
        const socket = connection._handle;
        if (!upgradeDuplex && socket) {
          // if is named pipe socket we can upgrade it using the same wrapper than we use for duplex
          upgradeDuplex = isNamedPipeSocket(socket);
        }
        if (upgradeDuplex) {
          this[kupgraded] = connection;
          const [result, events] = upgradeDuplexToTLS(connection, {
            data: { self: this, req: { oncomplete: afterConnect } },
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
            this[kupgraded] = connection;
            const result = socket.upgradeTLS({
              data: { self: this, req: { oncomplete: afterConnect } },
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
                this[kupgraded] = connection;
                const [result, events] = upgradeDuplexToTLS(connection, {
                  data: { self: this, req: { oncomplete: afterConnect } },
                  tls,
                  socket: this[khandlers],
                });
                connection.on("data", events[0]);
                connection.on("end", events[1]);
                connection.on("drain", events[2]);
                connection.on("close", events[3]);
                this._handle = result;
              } else {
                this[kupgraded] = connection;
                const result = socket.upgradeTLS({
                  data: { self: this, req: { oncomplete: afterConnect } },
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
      } catch (error) {
        process.nextTick(emitErrorAndCloseNextTick, this, error);
      }
      return this;
    }
  }

  const [options, cb] = $isArray(args[0]) && args[0][normalizedArgsSymbol] ? args[0] : normalizeArgs(args);

  if (typeof this[bunTlsSymbol] === "function" && cb !== null) {
    this.once("secureConnect", cb);
  } else if (cb !== null) {
    this.once("connect", cb);
  }
  if (this._parent?.connecting) {
    return this;
  }
  if (this.write !== Socket.prototype.write) {
    this.write = Socket.prototype.write;
  }
  if (this.destroyed) {
    this._handle = null;
    this._peername = null;
    this._sockname = null;
  }

  this.connecting = true;

  const { path } = options;
  const pipe = !!path;
  $debug("pipe", pipe, path);

  if (!this._handle) {
    this._handle = newDetachedSocket(typeof this[bunTlsSymbol] === "function");
    initSocketHandle(this);
  }

  if (!pipe) {
    lookupAndConnect(this, options);
  } else {
    validateString(path, "options.path");
    internalConnect(this, options, path);
  }
  return this;
};

Socket.prototype[kReinitializeHandle] = function reinitializeHandle(handle) {
  this._handle?.close();

  this._handle = handle;
  this._handle[owner_symbol] = this;

  initSocketHandle(this);
};

Socket.prototype.end = function end(data, encoding, callback) {
  $debug("Socket.prototype.end");
  return Duplex.prototype.end.$call(this, data, encoding, callback);
};

Socket.prototype._destroy = function _destroy(err, callback) {
  $debug("Socket.prototype._destroy");

  this.connecting = false;

  for (let s = this; s !== null; s = s._parent) {
    clearTimeout(s[kTimeout]);
  }

  $debug("close");
  if (this._handle) {
    $debug("close handle");
    const isException = err ? true : false;
    // `bytesRead` and `kBytesWritten` should be accessible after `.destroy()`
    // this[kBytesRead] = this._handle.bytesRead;
    this[kBytesWritten] = this._handle.bytesWritten;

    if (this.resetAndClosing) {
      this.resetAndClosing = false;
      const err = this._handle.close();
      setImmediate(() => {
        $debug("emit close");
        this.emit("close", isException);
      });
      if (err) this.emit("error", new ErrnoException(err, "reset"));
    } else if (this._closeAfterHandlingError) {
      // Enqueue closing the socket as a microtask, so that the socket can be
      // accessible when an `error` event is handled in the `next tick queue`.
      queueMicrotask(() => closeSocketHandle(this, isException, true));
    } else {
      closeSocketHandle(this, isException);
    }

    if (!this._closeAfterHandlingError) {
      if (this._handle) this._handle.onread = () => {};
      this._handle = null;
      this._sockname = null;
    }
    callback(err);
  } else {
    callback(err);
    process.nextTick(emitCloseNT, this, false);
  }

  if (this.server) {
    $debug("has server");
    this.server._connections--;
    if (this.server._emitCloseIfDrained) {
      this.server._emitCloseIfDrained();
    }
  }
};

Socket.prototype._final = function _final(callback) {
  $debug("Socket.prototype._final");
  if (this.connecting) {
    return this.once("connect", () => this._final(callback));
  }
  const socket = this._handle;

  // already closed call destroy
  if (!socket) return callback();

  // emit FIN allowHalfOpen only allow the readable side to close first
  process.nextTick(endNT, socket, callback);
};

Object.defineProperty(Socket.prototype, "localAddress", {
  get: function () {
    return this._getsockname().address;
  },
});

Object.defineProperty(Socket.prototype, "localFamily", {
  get: function () {
    return this._getsockname().family;
  },
});

Object.defineProperty(Socket.prototype, "localPort", {
  get: function () {
    return this._getsockname().port;
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
  $debug("Socket.prototype._reset");
  this.resetAndClosing = true;
  return this.destroy();
};

Socket.prototype._getpeername = function () {
  if (!this._handle || this.connecting) {
    return this._peername || {};
  } else if (!this._peername) {
    const family = this._handle.remoteFamily;
    if (!family) return {};
    this._peername = {
      family,
      address: this._handle.remoteAddress,
      port: this._handle.remotePort,
    };
  }
  return this._peername;
};

Socket.prototype._getsockname = function () {
  if (!this._handle || this.connecting) {
    return this._sockname || {};
  } else if (!this._sockname) {
    const family = this._handle.localFamily;
    if (!family) return {};
    this._sockname = {
      family,
      address: this._handle.localAddress,
      port: this._handle.localPort,
    };
  }
  return this._sockname;
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

Object.defineProperty(Socket.prototype, "remotePort", {
  get: function () {
    return this._getpeername().port;
  },
});

Object.defineProperty(Socket.prototype, "remoteAddress", {
  get: function () {
    return this._getpeername().address;
  },
});

Object.defineProperty(Socket.prototype, "remoteFamily", {
  get: function () {
    return this._getpeername().family;
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

Socket.prototype.setTimeout = {
  setTimeout(msecs, callback) {
    if (this.destroyed) return this;

    this.timeout = msecs;

    msecs = getTimerDuration(msecs, "msecs");

    clearTimeout(this[kTimeout]);

    if (msecs === 0) {
      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }
    } else {
      this[kTimeout] = setTimeout(this._onTimeout.bind(this), msecs).unref();

      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }
    return this;
  },
}.setTimeout;

Socket.prototype._unrefTimer = function _unrefTimer() {
  for (let s = this; s !== null; s = s._parent) {
    if (s[kTimeout]) s[kTimeout].refresh();
  }
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
  $debug("Socket.prototype._write");
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
      this._write(chunk, encoding, callback);
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
  this._unrefTimer();
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

function createConnection(...args) {
  const normalized = normalizeArgs(args);
  const options = normalized[0];
  const socket = new Socket(options);

  if (options.timeout) {
    socket.setTimeout(options.timeout);
  }

  return socket.connect(normalized);
}

function lookupAndConnect(self, options) {
  const { localAddress, localPort } = options;
  const host = options.host || "localhost";
  let { port, autoSelectFamilyAttemptTimeout, autoSelectFamily } = options;

  validateString(host, "options.host");

  if (localAddress && !isIP(localAddress)) {
    throw $ERR_INVALID_IP_ADDRESS(localAddress);
  }
  if (localPort) {
    validateNumber(localPort, "options.localPort");
  }
  if (typeof port !== "undefined") {
    if (typeof port !== "number" && typeof port !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.port", ["number", "string"], port);
    }
    validatePort(port);
  }
  port |= 0;

  if (autoSelectFamily != null) {
    validateBoolean(autoSelectFamily, "options.autoSelectFamily");
  } else {
    autoSelectFamily = getDefaultAutoSelectFamily();
  }

  if (autoSelectFamilyAttemptTimeout != null) {
    validateInt32(autoSelectFamilyAttemptTimeout, "options.autoSelectFamilyAttemptTimeout", 1);

    if (autoSelectFamilyAttemptTimeout < 10) {
      autoSelectFamilyAttemptTimeout = 10;
    }
  } else {
    autoSelectFamilyAttemptTimeout = getDefaultAutoSelectFamilyAttemptTimeout();
  }

  // If host is an IP, skip performing a lookup
  const addressType = isIP(host);
  if (addressType) {
    process.nextTick(() => {
      if (self.connecting) {
        internalConnect(self, options, host, port, addressType, localAddress, localPort);
      }
    });
    return;
  }

  if (options.lookup != null) validateFunction(options.lookup, "options.lookup");

  if (dns === undefined) dns = require("node:dns");
  const dnsopts = {
    family: socketToDnsFamily(options.family),
    hints: options.hints || 0,
  };
  if (!isWindows && dnsopts.family !== 4 && dnsopts.family !== 6 && dnsopts.hints === 0) {
    dnsopts.hints = dns.ADDRCONFIG;
  }

  $debug("connect: find host", host, addressType);
  $debug("connect: dns options", dnsopts);
  self._host = host;
  self._port = port;
  const lookup = options.lookup || dns.lookup;

  if (dnsopts.family !== 4 && dnsopts.family !== 6 && !localAddress && autoSelectFamily) {
    $debug("connect: autodetecting", host, port);

    dnsopts.all = true;
    lookupAndConnectMultiple(
      self,
      lookup,
      host,
      options,
      dnsopts,
      port,
      localAddress,
      localPort,
      autoSelectFamilyAttemptTimeout,
    );
    return;
  }

  lookup(host, dnsopts, function emitLookup(err, ip, addressType) {
    self.emit("lookup", err, ip, addressType, host);
    if (!self.connecting) return;
    if (err) {
      process.nextTick(destroyNT, self, err);
    } else if (!isIP(ip)) {
      err = $ERR_INVALID_IP_ADDRESS(ip);
      process.nextTick(destroyNT, self, err);
    } else if (addressType !== 4 && addressType !== 6) {
      err = $ERR_INVALID_ADDRESS_FAMILY(addressType, options.host, options.port);
      process.nextTick(destroyNT, self, err);
    } else {
      self._unrefTimer();
      internalConnect(self, options, ip, port, addressType, localAddress, localPort);
    }
  });
}

function socketToDnsFamily(family) {
  switch (family) {
    case "IPv4": return 4; // prettier-ignore
    case "IPv6": return 6; // prettier-ignore
  }
  return family;
}

function lookupAndConnectMultiple(self, lookup, host, options, dnsopts, port, localAddress, localPort, timeout) {
  lookup(host, dnsopts, function emitLookup(err, addresses) {
    if (!self.connecting) {
      return;
    } else if (err) {
      self.emit("lookup", err, undefined, undefined, host);
      process.nextTick(destroyNT, self, err);
      return;
    }

    const validAddresses = [[], []];
    const validIps = [[], []];
    let destinations;
    for (let i = 0, l = addresses.length; i < l; i++) {
      const address = addresses[i];
      const { address: ip, family: addressType } = address;
      self.emit("lookup", err, ip, addressType, host);
      if (!self.connecting) {
        return;
      }
      if (isIP(ip) && (addressType === 4 || addressType === 6)) {
        destinations ||= addressType === 6 ? { 6: 0, 4: 1 } : { 4: 0, 6: 1 };

        const destination = destinations[addressType];

        // Only try an address once
        if (!ArrayPrototypeIncludes.$call(validIps[destination], ip)) {
          ArrayPrototypePush.$call(validAddresses[destination], address);
          ArrayPrototypePush.$call(validIps[destination], ip);
        }
      }
    }

    // When no AAAA or A records are available, fail on the first one
    if (!validAddresses[0].length && !validAddresses[1].length) {
      const { address: firstIp, family: firstAddressType } = addresses[0];

      if (!isIP(firstIp)) {
        err = $ERR_INVALID_IP_ADDRESS(firstIp);
        process.nextTick(destroyNT, self, err);
      } else if (firstAddressType !== 4 && firstAddressType !== 6) {
        err = $ERR_INVALID_ADDRESS_FAMILY(firstAddressType, options.host, options.port);
        process.nextTick(destroyNT, self, err);
      }

      return;
    }

    // Sort addresses alternating families
    const toAttempt = [];
    for (let i = 0, l = MathMax(validAddresses[0].length, validAddresses[1].length); i < l; i++) {
      if (i in validAddresses[0]) {
        ArrayPrototypePush.$call(toAttempt, validAddresses[0][i]);
      }
      if (i in validAddresses[1]) {
        ArrayPrototypePush.$call(toAttempt, validAddresses[1][i]);
      }
    }

    if (toAttempt.length === 1) {
      $debug("connect/multiple: only one address found, switching back to single connection");
      const { address: ip, family: addressType } = toAttempt[0];

      self._unrefTimer();
      internalConnect(self, options, ip, port, addressType, localAddress, localPort);

      return;
    }

    self.autoSelectFamilyAttemptedAddresses = [];
    $debug("connect/multiple: will try the following addresses", toAttempt);

    const context = {
      socket: self,
      addresses: toAttempt,
      current: 0,
      port,
      localPort,
      timeout,
      [kTimeout]: null,
      errors: [],
      options,
    };

    self._unrefTimer();
    internalConnectMultiple(context);
  });
}

function internalConnect(self, options, path);
function internalConnect(self, options, address, port, addressType, localAddress, localPort, _flags?) {
  $assert(self.connecting);

  let err;

  if (localAddress || localPort) {
    if (addressType === 4) {
      localAddress ||= "0.0.0.0";
      // TODO:
      // err = self._handle.bind(localAddress, localPort);
    } else {
      // addressType === 6
      localAddress ||= "::";
      // TODO:
      // err = self._handle.bind6(localAddress, localPort, flags);
    }
    $debug(
      "connect: binding to localAddress: %s and localPort: %d (addressType: %d)",
      localAddress,
      localPort,
      addressType,
    );

    err = checkBindError(err, localPort, self._handle);
    if (err) {
      const ex = new ExceptionWithHostPort(err, "bind", localAddress, localPort);
      self.destroy(ex);
      return;
    }
  }

  //TLS
  let connection = self[ksocket];
  if (options.socket) {
    connection = options.socket;
  }
  let tls = undefined;
  const bunTLS = self[bunTlsSymbol];
  if (typeof bunTLS === "function") {
    tls = bunTLS.$call(self, port, self._host, true);
    self._requestCert = true; // Client always request Cert
    if (tls) {
      const { rejectUnauthorized, session, checkServerIdentity } = options;
      if (typeof rejectUnauthorized !== "undefined") {
        self._rejectUnauthorized = rejectUnauthorized;
        tls.rejectUnauthorized = rejectUnauthorized;
      } else {
        self._rejectUnauthorized = tls.rejectUnauthorized;
      }
      tls.requestCert = true;
      tls.session = session || tls.session;
      self.servername = tls.servername;
      tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
      self[bunTLSConnectOptions] = tls;
      if (!connection && tls.socket) {
        connection = tls.socket;
      }
    }
    self.authorized = false;
    self.secureConnecting = true;
    self._secureEstablished = false;
    self._securePending = true;
    self[kConnectOptions] = options;
    self.prependListener("end", onConnectEnd);
  }
  //TLS

  $debug("connect: attempting to connect to %s:%d (addressType: %d)", address, port, addressType);
  self.emit("connectionAttempt", address, port, addressType);

  if (addressType === 6 || addressType === 4) {
    if (self.blockList?.check(address, `ipv${addressType}`)) {
      self.destroy($ERR_IP_BLOCKED(address));
      return;
    }
    const req: any = {};
    req.oncomplete = afterConnect;
    req.address = address;
    req.port = port;
    req.localAddress = localAddress;
    req.localPort = localPort;
    req.addressType = addressType;
    req.tls = tls;

    err = kConnectTcp(self, addressType, req, address, port);
  } else {
    const req: any = {};
    req.address = address;
    req.oncomplete = afterConnect;
    req.tls = tls;

    err = kConnectPipe(self, req, address);
  }

  if (err) {
    const ex = new ExceptionWithHostPort(err, "connect", address, port);
    self.destroy(ex);
  }
}

function internalConnectMultiple(context, canceled?) {
  clearTimeout(context[kTimeout]);
  const self = context.socket;

  // We were requested to abort. Stop all operations
  if (self._aborted) {
    return;
  }

  // All connections have been tried without success, destroy with error
  if (canceled || context.current === context.addresses.length) {
    if (context.errors.length === 0) {
      self.destroy($ERR_SOCKET_CONNECTION_TIMEOUT());
      return;
    }

    self.destroy(new NodeAggregateError(context.errors));
    return;
  }

  $assert(self.connecting);

  const current = context.current++;

  if (current > 0) {
    self[kReinitializeHandle](newDetachedSocket(typeof self[bunTlsSymbol] === "function"));
  }

  const { localPort, port, _flags } = context;
  const { address, family: addressType } = context.addresses[current];
  let localAddress;
  let err;

  if (localPort) {
    if (addressType === 4) {
      localAddress = DEFAULT_IPV4_ADDR;
      // TODO:
      // err = self._handle.bind(localAddress, localPort);
    } else {
      // addressType === 6
      localAddress = DEFAULT_IPV6_ADDR;
      // TODO:
      // err = self._handle.bind6(localAddress, localPort, flags);
    }

    $debug(
      "connect/multiple: binding to localAddress: %s and localPort: %d (addressType: %d)",
      localAddress,
      localPort,
      addressType,
    );

    err = checkBindError(err, localPort, self._handle);
    if (err) {
      ArrayPrototypePush.$call(context.errors, new ExceptionWithHostPort(err, "bind", localAddress, localPort));
      internalConnectMultiple(context);
      return;
    }
  }

  if (self.blockList?.check(address, `ipv${addressType}`)) {
    const ex = $ERR_IP_BLOCKED(address);
    ArrayPrototypePush.$call(context.errors, ex);
    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    internalConnectMultiple(context);
    return;
  }

  //TLS
  let connection = self[ksocket];
  if (context.options.socket) {
    connection = context.options.socket;
  }
  let tls = undefined;
  const bunTLS = self[bunTlsSymbol];
  if (typeof bunTLS === "function") {
    tls = bunTLS.$call(self, port, self._host, true);
    self._requestCert = true; // Client always request Cert
    if (tls) {
      const { rejectUnauthorized, session, checkServerIdentity } = context.options;
      if (typeof rejectUnauthorized !== "undefined") {
        self._rejectUnauthorized = rejectUnauthorized;
        tls.rejectUnauthorized = rejectUnauthorized;
      } else {
        self._rejectUnauthorized = tls.rejectUnauthorized;
      }
      tls.requestCert = true;
      tls.session = session || tls.session;
      self.servername = tls.servername;
      tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
      self[bunTLSConnectOptions] = tls;
      if (!connection && tls.socket) {
        connection = tls.socket;
      }
    }
    self.authorized = false;
    self.secureConnecting = true;
    self._secureEstablished = false;
    self._securePending = true;
    self[kConnectOptions] = context.options;
    self.prependListener("end", onConnectEnd);
  }
  //TLS

  $debug("connect/multiple: attempting to connect to %s:%d (addressType: %d)", address, port, addressType);
  self.emit("connectionAttempt", address, port, addressType);

  // const req = new TCPConnectWrap();
  const req = {};
  req.oncomplete = afterConnectMultiple.bind(undefined, context, current);
  req.address = address;
  req.port = port;
  req.localAddress = localAddress;
  req.localPort = localPort;
  req.addressType = addressType;
  req.tls = tls;

  ArrayPrototypePush.$call(self.autoSelectFamilyAttemptedAddresses, `${address}:${port}`);

  err = kConnectTcp(self, addressType, req, address, port);

  if (err) {
    const ex = new ExceptionWithHostPort(err, "connect", address, port);
    ArrayPrototypePush.$call(context.errors, ex);

    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    internalConnectMultiple(context);
    return;
  }

  if (current < context.addresses.length - 1) {
    $debug("connect/multiple: setting the attempt timeout to %d ms", context.timeout);

    // If the attempt has not returned an error, start the connection timer
    context[kTimeout] = setTimeout(internalConnectMultipleTimeout, context.timeout, context, req, self._handle).unref();
  }
}

function internalConnectMultipleTimeout(context, req, handle) {
  $debug("connect/multiple: connection to %s:%s timed out", req.address, req.port);
  context.socket.emit("connectionAttemptTimeout", req.address, req.port, req.addressType);

  req.oncomplete = undefined;
  ArrayPrototypePush.$call(context.errors, createConnectionError(req, UV_ETIMEDOUT));
  handle.close();

  // Try the next address, unless we were aborted
  if (context.socket.connecting) {
    internalConnectMultiple(context);
  }
}

function afterConnect(status, handle, req, readable, writable) {
  if (!handle) return;
  const self = handle[owner_symbol];
  if (!self) return;

  // Callback may come after call to destroy
  if (self.destroyed) {
    return;
  }

  $debug("afterConnect", status, readable, writable);

  $assert(self.connecting);
  self.connecting = false;
  self._sockname = null;

  if (status === 0) {
    if (self.readable && !readable) {
      self.push(null);
      self.read();
    }
    if (self.writable && !writable) {
      self.end();
    }
    self._unrefTimer();

    if (self[kSetNoDelay] && self._handle.setNoDelay) {
      self._handle.setNoDelay(true);
    }

    if (self[kSetKeepAlive] && self._handle.setKeepAlive) {
      self._handle.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
    }

    self.emit("connect");
    self.emit("ready");

    // Start the first read, or get an immediate EOF.
    // this doesn't actually consume any bytes, because len=0.
    if (readable && !self.isPaused()) self.read(0);
  } else {
    let details;
    if (req.localAddress && req.localPort) {
      details = req.localAddress + ":" + req.localPort;
    }
    const ex = new ExceptionWithHostPort(status, "connect", req.address, req.port);
    if (details) {
      ex.localAddress = req.localAddress;
      ex.localPort = req.localPort;
    }

    self.emit("connectionAttemptFailed", req.address, req.port, req.addressType, ex);
    self.destroy(ex);
  }
}

function afterConnectMultiple(context, current, status, handle, req, readable, writable) {
  $debug("connect/multiple: connection attempt to %s:%s completed with status %s", req.address, req.port, status);

  // Make sure another connection is not spawned
  $debug("clearTimeout", context[kTimeout]);
  clearTimeout(context[kTimeout]);

  // One of the connection has completed and correctly dispatched but after timeout, ignore this one
  if (status === 0 && current !== context.current - 1) {
    $debug("connect/multiple: ignoring successful but timedout connection to %s:%s", req.address, req.port);
    handle.close();
    return;
  }

  const self = context.socket;

  // Some error occurred, add to the list of exceptions
  if (status !== 0) {
    const ex = createConnectionError(req, status);
    ArrayPrototypePush.$call(context.errors, ex);

    self.emit("connectionAttemptFailed", req.address, req.port, req.addressType, ex);

    // Try the next address, unless we were aborted
    if (context.socket.connecting) {
      internalConnectMultiple(context, status === UV_ECANCELED);
    }

    return;
  }

  afterConnect(status, self._handle, req, readable, writable);
}

function createConnectionError(req, status) {
  let details;

  if (req.localAddress && req.localPort) {
    details = req.localAddress + ":" + req.localPort;
  }

  const ex = new ExceptionWithHostPort(status, "connect", req.address, req.port);
  if (details) {
    ex.localAddress = req.localAddress;
    ex.localPort = req.localPort;
  }

  return ex;
}

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

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}

function normalizeArgs(args: unknown[]): [options: Record<PropertyKey, any>, cb: Function | null] {
  // while (args.length && args[args.length - 1] == null) args.pop();
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

// Called when creating new Socket, or when re-using a closed Socket
function initSocketHandle(self) {
  self._undestroy();
  self._sockname = null;
  self[kclosed] = false;
  self[kended] = false;

  // Handle creation may be deferred to bind() or connect() time.
  if (self._handle) {
    self._handle[owner_symbol] = self;
  }
}

function closeSocketHandle(self, isException, isCleanupPending = false) {
  $debug("closeSocketHandle", isException, isCleanupPending, !!self._handle);
  if (self._handle) {
    self._handle.close();
    setImmediate(() => {
      $debug("emit close", isCleanupPending);
      self.emit("close", isException);
      if (isCleanupPending) {
        self._handle.onread = () => {};
        self._handle = null;
        self._sockname = null;
      }
    });
  }
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

let warnSimultaneousAccepts = true;
function _setSimultaneousAccepts() {
  if (warnSimultaneousAccepts) {
    process.emitWarning(
      "net._setSimultaneousAccepts() is deprecated and will be removed.",
      "DeprecationWarning",
      "DEP0121",
    );
    warnSimultaneousAccepts = false;
  }
}

export default {
  createServer,
  Server,
  createConnection,
  connect: createConnection,
  isIP,
  isIPv4,
  isIPv6,
  Socket,
  _normalizeArgs: normalizeArgs,
  _setSimultaneousAccepts,

  getDefaultAutoSelectFamily,
  setDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,

  BlockList,
  SocketAddress,
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  Stream: Socket,
} as any as typeof import("node:net");
