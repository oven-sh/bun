const Duplex = require("internal/streams/duplex");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const EventEmitter = require("node:events");
let dns: typeof import("node:dns");

const normalizedArgsSymbol = Symbol("normalizedArgs");
const { ExceptionWithHostPort } = require("internal/shared");
import type { Socket, SocketHandler, SocketListener } from "bun";
import type { Server as NetServer, Socket as NetSocket, ServerOpts } from "node:net";
import type { TLSSocket } from "node:tls";
const { kTimeout, getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validateAbortSignal, validatePort, validateBoolean, validateInt32, validateString } = require("internal/validators"); // prettier-ignore
const { NodeAggregateError, ErrnoException } = require("internal/shared");

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

const { Socket } = require("internal/net/socket");

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

