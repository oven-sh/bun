export const Duplex = require("internal/streams/duplex");
export const { getDefaultHighWaterMark } = require("internal/streams/state");
export const EventEmitter = require("node:events");

export const normalizedArgsSymbol = Symbol("normalizedArgs");
export const { ExceptionWithHostPort } = require("internal/shared");
export const { kTimeout, getTimerDuration } = require("internal/timers");
export const { validateFunction, validateNumber, validateAbortSignal, validatePort, validateBoolean, validateInt32, validateString } = require("internal/validators"); // prettier-ignore
export const { NodeAggregateError, ErrnoException } = require("internal/shared");

export const ArrayPrototypeIncludes = Array.prototype.includes;
export const ArrayPrototypePush = Array.prototype.push;
export const MathMax = Math.max;

export const { UV_ECANCELED, UV_ETIMEDOUT } = process.binding("uv");
export const isWindows = process.platform === "win32";

export const getDefaultAutoSelectFamily = $zig("node_net_binding.zig", "getDefaultAutoSelectFamily");
export const setDefaultAutoSelectFamily = $zig("node_net_binding.zig", "setDefaultAutoSelectFamily");
export const getDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "getDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
export const setDefaultAutoSelectFamilyAttemptTimeout = $zig("node_net_binding.zig", "setDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
export const SocketAddress = $zig("node_net_binding.zig", "SocketAddress");
export const BlockList = $zig("node_net_binding.zig", "BlockList");
export const newDetachedSocket = $newZigFunction("node_net_binding.zig", "newDetachedSocket", 1);
export const doConnect = $newZigFunction("node_net_binding.zig", "doConnect", 2);

export const addServerName = $newZigFunction("Listener.zig", "jsAddServerName", 3);
export const upgradeDuplexToTLS = $newZigFunction("socket.zig", "jsUpgradeDuplexToTLS", 2);
export const isNamedPipeSocket = $newZigFunction("socket.zig", "jsIsNamedPipeSocket", 1);
export const getBufferedAmount = $newZigFunction("socket.zig", "jsGetBufferedAmount", 1);

// IPv4 Segment
const v4Seg = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
var IPv4Reg;

// IPv6 Segment
const v6Seg = "(?:[0-9a-fA-F]{1,4})";
var IPv6Reg;

export function isIPv4(s): boolean {
  return (IPv4Reg ??= new RegExp(`^${v4Str}$`)).test(s);
}

export function isIPv6(s): boolean {
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

export function isIP(s): 0 | 4 | 6 {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

export const bunTlsSymbol = Symbol.for("::buntls::");
export const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
export const owner_symbol = Symbol("owner_symbol");

export const kServerSocket = Symbol("kServerSocket");
export const kBytesWritten = Symbol("kBytesWritten");
export const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
export const kReinitializeHandle = Symbol("kReinitializeHandle");

export const kRealListen = Symbol("kRealListen");
export const kSetNoDelay = Symbol("kSetNoDelay");
export const kSetKeepAlive = Symbol("kSetKeepAlive");
export const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");
export const kConnectOptions = Symbol("connect-options");
export const kAttach = Symbol("kAttach");
export const kCloseRawConnection = Symbol("kCloseRawConnection");
export const kpendingRead = Symbol("kpendingRead");
export const kupgraded = Symbol("kupgraded");
export const ksocket = Symbol("ksocket");
export const khandlers = Symbol("khandlers");
export const kclosed = Symbol("closed");
export const kended = Symbol("ended");
export const kwriteCallback = Symbol("writeCallback");
export const kSocketClass = Symbol("kSocketClass");

export function endNT(socket, callback, err) {
  socket.$end();
  callback(err);
}
export function emitCloseNT(self, hasError) {
  self.emit("close", hasError);
}
export function detachSocket(self) {
  if (!self) self = this;
  self._handle = null;
}
export function destroyNT(self, err) {
  self.destroy(err);
}
export function destroyWhenAborted(err) {
  if (!this.destroyed) {
    this.destroy(err.target.reason);
  }
}
// in node's code this callback is called 'onReadableStreamEnd' but that seemed confusing when `ReadableStream`s now exist
export function onSocketEnd() {
  if (!this.allowHalfOpen) {
    this.write = writeAfterFIN;
  }
}
// Provide a better error message when we call end() as a result
// of the other side sending a FIN.  The standard 'write after end'
// is overly vague, and makes it seem like the user's code is to blame.
export function writeAfterFIN(chunk, encoding, cb) {
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
export function onConnectEnd() {
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
