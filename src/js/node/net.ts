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
const { isUint8Array } = require("node:util/types");
const { getDefaultHighWaterMark } = require("internal/streams/state");
const EventEmitter = require("node:events");
// Fake timers replace the global, and 'close' must still fire.
const setImmediate = $newCppFunction("node/NodeTimers.cpp", "functionSetImmediate", 1);
let dns: typeof import("./dns").default;

const normalizedArgsSymbol = Symbol("normalizedArgs");
const {
  ExceptionWithHostPort,
  listenException,
  ConnResetException,
  NodeAggregateError,
  ErrnoException,
  hasObserver,
  startPerf,
  stopPerf,
  isStoppedModuleGraphRunning,
} = require("internal/shared");
import type { Socket, SocketHandler, SocketListener } from "bun";
import type { Server as NetServer, Socket as NetSocket, ServerOpts } from "node:net";
const { kTimeout, getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validatePort, validateBoolean, validateInt32, validateString } = require("internal/validators"); // prettier-ignore
const { isIPv4, isIPv6, isIP } = require("internal/net/isIP");
const {
  kAcceptedTLS,
  kArmHandshakeTimeout,
  kDestroyOnRead,
  kPreHandshakeWrite,
  kReadStop,
  kSecureConnectDone,
  kSelectSNIContext,
  kSNIError,
  kStandaloneWrap,
  kUpgradeClientTLS,
  kVerifyError,
} = require("internal/net/symbols");
const { addServerAbortSignalOption } = require("internal/net/server_abort_signal");
const AsyncContextFrame = require("internal/async_context_frame");

type SocketHandle = Socket<SocketInstance> & {
  setTypeOfService?(tos: number): number | undefined;
  readonly listener?: ListenerHandle;
};
type NativeSocketError = Error & { errno?: number };
type NativeConnectError = Error & { errno: number };
type ConnectException = InstanceType<typeof ExceptionWithHostPort> & { localAddress?: string; localPort?: number };

interface ListenerHandle extends SocketListener<ServerInstance> {
  onconnection?: (this: ListenerHandle, err: number, clientHandle: Socket<SocketInstance>) => void;
}

interface SocketInternals {
  bytesRead: number;
  _bytesDispatched: number;
  connecting: boolean;
  isServer: boolean;
  server: ServerInstance | null | undefined;
  _server: ServerInstance | undefined;
  _handle: SocketHandle | null;
  _hadError: boolean;
  _closeAfterHandlingError: boolean;
  _pendingData: string | Buffer | null | undefined;
  _pendingEncoding: BufferEncoding | "" | undefined;
  _unrefTimer(): void;
  readonly writableBuffer: { chunk: string | Buffer; encoding: BufferEncoding }[] | undefined;
  _requestCert?: boolean;
  _rejectUnauthorized?: boolean;
}
type SocketInstance = Omit<NetSocket, keyof SocketInternals> & SocketInternals;

interface TLSSocketInternals {
  servername: string | false | undefined;
  alpnProtocol: string | false | null;
  authorized: boolean;
  authorizationError: string | null;
  secureConnecting: boolean;
  _securePending: boolean;
  _secureEstablished: boolean;
  _requestCert: boolean;
  _rejectUnauthorized: boolean;
  _releaseControl(): boolean;
  _emitTLSError(err: Error): void;
  setSession(session: string | Buffer): void;
  _SNICallback?: SNICallback;
  _ALPNCallback?: ALPNCallback;
}
type TLSSocketInstance = Omit<SocketInstance, keyof TLSSocketInternals> & TLSSocketInternals;

interface ServerInternals {
  _handle: ListenerHandle | null;
  _connections: number;
  allowHalfOpen: boolean;
  pauseOnConnect: boolean;
  noDelay: boolean;
  keepAlive: boolean;
  keepAliveInitialDelay: number;
  highWaterMark: number;
  blockList?: import("node:net").BlockList;
  _requestCert?: boolean;
  _rejectUnauthorized?: boolean;
  _SNICallback?: SNICallback;
  _ALPNCallback?: ALPNCallback;
}
type SNICallback = (servername: string, callback: (err: unknown, context?: unknown) => void) => void;
type ALPNCallback = (arg: { servername: string | false; protocols: string[] }) => string | undefined;
type ServerInstance = Omit<NetServer, keyof ServerInternals> & ServerInternals;

interface ConnectReq {
  oncomplete?: (
    status: number,
    handle: SocketHandle | null,
    req: ConnectReq,
    readable: boolean,
    writable: boolean,
  ) => void;
  address?: string;
  port?: number;
  localAddress?: string;
  localPort?: number;
  addressType?: 4 | 6;
  tls?: TLSConnectOptions;
  pauseOnConnect?: boolean;
  dispatching?: boolean;
  errno?: number;
}

interface SNIState {
  server: ServerInstance | TLSSocketInstance;
  socketHandle: Socket<SocketInstance> | undefined;
  socket: SocketInstance | undefined;
  selected: unknown;
  failed: Error | undefined;
  settled: boolean;
  suspended: boolean;
}

interface TLSConnectOptions {
  ALPNProtocols: unknown;
  checkServerIdentity: ((hostname: string, cert: import("node:tls").PeerCertificate) => Error | undefined) | undefined;
  session: string | Buffer | null | undefined;
  rejectUnauthorized: boolean;
  requestCert: boolean;
  ciphers: unknown;
  secureContext: unknown;
  servername: string;
}

interface InternalSocketHandler<Data> extends SocketHandler<Data> {
  writeComplete?(socket: Socket<Data>, status: number): void;
  session?(socket: Socket<Data>, session: Buffer): void;
  keylog?(socket: Socket<Data>, line: Buffer): void;
  alpnCallback?(
    socket: Socket<Data>,
    servername: string | undefined,
    protocolsWire: Uint8Array,
  ): string | false | undefined;
  serverName?(
    server: ServerInstance | TLSSocketInstance,
    servername: string,
    socketHandle: Socket<Data> | undefined,
    socket?: Data,
  ): unknown;
}

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypePush = Array.prototype.push;
const MathMax = Math.max;
const MathMin = Math.min;
const reportError = globalThis.reportError;

let uvBinding;
function uv() {
  return (uvBinding ??= process.binding("uv"));
}
const isWindows = process.platform === "win32";

// Module state, like Node's lib/net.js, so each Worker has its own copy.
let autoSelectFamilyDefault = true;
// Node's docs say 250, but its CLI default in node_options.h is 500.
let autoSelectFamilyAttemptTimeoutDefault = 500;

function getDefaultAutoSelectFamily() {
  return autoSelectFamilyDefault;
}

function setDefaultAutoSelectFamily(value) {
  validateBoolean(value, "value");
  autoSelectFamilyDefault = value;
}

function getDefaultAutoSelectFamilyAttemptTimeout() {
  return autoSelectFamilyAttemptTimeoutDefault;
}

function setDefaultAutoSelectFamilyAttemptTimeout(value) {
  validateInt32(value, "value", 1);
  if (value < 10) {
    value = 10;
  }
  autoSelectFamilyAttemptTimeoutDefault = value;
}

/**
 * `--tls-keylog=<file>`: every TLS socket appends its NSS key-log lines here,
 * the way Node's CLI option store seeds an implicit 'keylog' listener.
 */
let tlsKeylogPath: string | undefined;
let tlsKeylogWarned = false;
function appendTlsKeylog(path: string, line: Buffer) {
  if (!tlsKeylogWarned) {
    tlsKeylogWarned = true;
    process.emitWarning(
      "Using --tls-keylog makes TLS connections insecure by writing secret key material to file " + path,
    );
  }
  try {
    // The keylog contains TLS master secrets; create it owner-readable only.
    // The mode is only applied when the file is created.
    require("node:fs").appendFileSync(path, line, { mode: 0o600 });
  } catch {
    // Node ignores keylog write failures.
  }
}

// Node seeds the family-autoselection defaults from its CLI option store.
// The equivalent flags reach us through process.execArgv; apply them once at
// module load so getDefaultAutoSelectFamily*() reflect the command line.
{
  const execArgv = process.execArgv;
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    if (arg === "--no-network-family-autoselection" || arg === "--no-enable-network-family-autoselection") {
      setDefaultAutoSelectFamily(false);
    } else if (arg === "--network-family-autoselection" || arg === "--enable-network-family-autoselection") {
      setDefaultAutoSelectFamily(true);
    } else if (arg.startsWith("--network-family-autoselection-attempt-timeout=")) {
      const value = Number(arg.slice(arg.indexOf("=") + 1));
      // The setter validates >= 1 and clamps < 10 to 10, like Node's; ignore
      // degenerate CLI values rather than throwing at module load.
      if (Number.isFinite(value) && value >= 1) setDefaultAutoSelectFamilyAttemptTimeout(value);
    } else if (arg === "--network-family-autoselection-attempt-timeout" && i + 1 < execArgv.length) {
      const value = Number(execArgv[i + 1]);
      if (Number.isFinite(value) && value >= 1) setDefaultAutoSelectFamilyAttemptTimeout(value);
    } else if (arg.startsWith("--tls-keylog=")) {
      tlsKeylogPath = arg.slice("--tls-keylog=".length);
    } else if (arg === "--tls-keylog" && i + 1 < execArgv.length) {
      tlsKeylogPath = execArgv[i + 1];
    }
  }
}
let BlockList, SocketAddress;
function lazyBlockList() {
  return (BlockList ??= $bindgen("BlockList.bind.ts", "BlockList"));
}
const newDetachedSocket = $bindgen("node_net_binding.bind.ts", "newDetachedSocket");
const doConnect = $newRustFunction("node_net_binding.rs", "doConnect", 2);

const addServerName = $bindgen("Listener.bind.ts", "addServerName");
const upgradeDuplexToTLS = $bindgen("socket_body.bind.ts", "upgradeDuplexToTLS");
// tls.connect({ socket }) upgrade: hostname policy stays with this JS layer.
const upgradeTLSDeferred = $bindgen("socket_body.bind.ts", "upgradeTLSDeferred");
const checkServerIdentityInHandshake = $bindgen("socket_body.bind.ts", "checkServerIdentityInHandshake");
// destroy() in the handshake callback: drops the handshake flight that the native layer holds.
const releaseHeldFlight = $bindgen("socket_body.bind.ts", "releaseHeldFlight");
const isNamedPipeSocket = $bindgen("socket_body.bind.ts", "isNamedPipeSocket");
const getBufferedAmount = $bindgen("socket_body.bind.ts", "getBufferedAmount");
const getBytesRead = $bindgen("socket_body.bind.ts", "getBytesRead");

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const { owner_symbol } = require("internal/async_hooks").symbols;

// Write-only by design: the onconnection write is a GC edge keeping the
// native Listener reachable via accepted socket handles (see a93d2fa48e).
const kBytesRead = Symbol("kBytesRead");
const kBytesWritten = Symbol("kBytesWritten");
const kLastWriteQueueSize = Symbol("kLastWriteQueueSize");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
// tls.Server exposes its native SecureContext constructor through this key so
// the SNI dispatch (below) can recognize a raw native context the way Node's
// `context.context || context` unwrap does - without net.ts needing its own
// binding to the constructor.
const kNativeSecureContextCtor = Symbol.for("::buntlsnativesecurecontextctor::");
const kReinitializeHandle = Symbol("kReinitializeHandle");

const kRealListen = Symbol("kRealListen");
const kSetNoDelay = Symbol("kSetNoDelay");
const kSetTOS = Symbol("kSetTOS");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSetKeepAliveInitialDelay = Symbol("kSetKeepAliveInitialDelay");
const kConnectOptions = Symbol("connect-options");
const kAttach = Symbol("kAttach");
const kCloseRawConnection = Symbol("kCloseRawConnection");
const kOnUpgradedClose = Symbol("kOnUpgradedClose");
const kupgraded = Symbol("kupgraded");
// On the raw handle of an adopted fd: the TLS socket that adopted it.
const kAdoptedTLSRaw = Symbol("kAdoptedTLSRaw");
// On that TLS socket: the fd closed, and the socket it wraps waits to be closed with it.
const kOwesRawClose = Symbol("kOwesRawClose");
// Emitted on a socket under the stream-level TLS engine in place of reporting a read error itself.
const kReadError = Symbol("kReadError");
// The verdict on the peer let the session through, so the application can have written over it.
const kSessionAccepted = Symbol("kSessionAccepted");
const ksocket = Symbol("ksocket");
const khandlers = Symbol("khandlers");
const kConnectReq = Symbol("kConnectReq");
const kclosed = Symbol("closed");
const kended = Symbol("ended");
const kpendingSession = Symbol("pendingSession");
const kALPNError = Symbol("kALPNError");
const kPerfHooksNetConnectContext = Symbol("kPerfHooksNetConnectContext");
const khandshakeTimer = Symbol("khandshakeTimer");
const kerrorEmitted = Symbol("kerrorEmitted");
const kUserUnrefed = Symbol("kUserUnrefed");
// Set when readStop() dropped the handle's hold on the loop, so the read paths
// only restore a hold they actually removed - re-refing a handle that never
// held the loop (a wrapped duplex with no fd) would pin the process.
const kPausedUnref = Symbol("kPausedUnref");
const kOnreadDeliver = Symbol("kOnreadDeliver");
function noop() {}
function onUpgradeAttachedWrite(chunk, encoding, callback, onClose) {
  this.off("close", onClose);
  this._write(chunk, encoding, callback);
}

function onUpgradeWriteClose(callback) {
  callback($ERR_SOCKET_CLOSED());
}
const kUpgradeAttached = Symbol("kUpgradeAttached");
const kOnreadTail = Symbol("kOnreadTail");
const kOnreadDraining = Symbol("kOnreadDraining");
const kOnreadBuffer = Symbol("kOnreadBuffer");
const kOnreadPendingEnd = Symbol("kOnreadPendingEnd");
const kOnreadReadRequested = Symbol("kOnreadReadRequested");
const kOnreadEmptyTail = Buffer.alloc(0);
// The write the handle queued, like Node's WriteWrap: { handle, callback, frame }.
const kWriteReq = Symbol("kWriteReq");
const kSocketClass = Symbol("kSocketClass");
const kServerSocket = Symbol("kServerSocket");

// https://github.com/nodejs/node/blob/v26.5.0/lib/internal/stream_base_commons.js#L81-L107
function onWriteComplete(self, handle, status) {
  const req = self[kWriteReq];
  // connect() settled the write of the handle it replaced.
  if (req?.handle !== handle) return;
  self[kWriteReq] = undefined;
  let err: Error | null = null;
  if (status < 0) {
    // https://github.com/nodejs/node/blob/v26.5.0/src/crypto/crypto_tls.cc#L1318
    const reason = self.encrypted && status === uv().UV_ECANCELED ? "Canceled because of SSL destruction" : undefined;
    err = new ErrnoException(status, "write", reason);
  } else if (!self.destroyed) {
    self._unrefTimer();
    self[kLastWriteQueueSize] = 0;
    unrefAfterDrain(self, handle);
  }
  // Node's WriteWrap is an AsyncResource that write() creates.
  AsyncContextFrame.run(req.frame, req.callback, undefined, err);
}
function endNT(self, socket, callback) {
  // Node's _final half-closes the writable side (sends FIN) and leaves the
  // readable side open; the Duplex's allowHalfOpen drives the eventual destroy.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/net.js#L500
  // A TLS wrap made since _final attached this socket's handle, or left the fd to the raw half of `socket`.
  const current = self._handle;
  (!socket || current?.[kAdoptedTLSRaw] ? current : socket)?.shutdown();
  callback();
}
function emitCloseNT(self, hasError) {
  self.emit("close", hasError);
}
// Shared-fd TLS pair teardown: mirrors node's close ordering, where the
// close-callbacks phase runs after the check phase (lib/net.js close path in
// node v26.3.0), so destroy()-time setImmediates still see the pair alive.
function closeAdoptedTLSRawNT(self, handle, isException) {
  setImmediate(closeSocketHandle, self, handle, isException);
}
// Bytes an onread callback declined don't count until it gets them.
function handleBytesRead(self, handle) {
  return getBytesRead(handle) - (self[kOnreadTail]?.length ?? 0);
}
// `bytesRead` and `bytesWritten` stay readable after the socket let go of its handle.
function detachSocket(self) {
  const handle = self._handle;
  if (!handle) return;
  self[kBytesRead] = handleBytesRead(self, handle);
  self[kBytesWritten] = handle.bytesWritten;
  handle.onread = noop;
  self._handle = null;
  self._sockname = null;
}
function destroyNT(self, err) {
  self.destroy(err);
}
// Node's wrap 'close' -> destroy(): https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L739-L741
function onUpgradedClose(self, connection) {
  if (self[kupgraded] !== connection) return;
  // The stream-level engine reads its transport with no backpressure, so the
  // transport can close after the peer's EOF with plaintext still unread.
  if ((self[kended] || self[kOnreadPendingEnd]) && !self.readableEnded) self.once("end", self[kOnUpgradedClose]);
  else self.destroy();
}
// Armed ahead of the stream-level engine's own 'close' thunk: that thunk aborts
// a pending handshake, which a socket destroyed first does not report.
function destroyWhenUpgradedCloses(self, connection) {
  connection.once("close", (self[kOnUpgradedClose] = onUpgradedClose.bind(null, self, connection)));
}
// Node's wrap 'error' -> _emitTLSError.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/js_stream_socket.js#L65
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L977
function onUpgradedError(self, err) {
  if (self.destroyed || self._hadError) return;
  // The close that follows is no second error.
  self._hadError = true;
  self._emitTLSError(err);
}
// TLSWrap owns the reads of the handle it wraps: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
function onUpgradedReadError(self, err) {
  self._closeAfterHandlingError = true;
  onReadEnd(self, err);
  self.destroy();
}
// Node wraps any stream in a JSStreamSocket, so a Duplex from another implementation (readable-stream) works too.
function isWrappableStream(stream) {
  return stream instanceof Duplex || require("internal/tls").hasStreamMethods(stream);
}
// Like Node's `connecting || !_handle`, except that an http 'connect' or 'upgrade' socket is connected without a handle.
function isNotConnected(socket) {
  return socket.pending || socket.destroyed;
}
// Whatever state the wrapped stream is in: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L739-L741
function linkUpgraded(self, connection: SocketInstance) {
  const isSocket = connection instanceof Socket;
  self[kupgraded] = connection;
  self._parent = isSocket ? connection : null;
  destroyWhenUpgradedCloses(self, connection);
  connection.on("error", onUpgradedError.bind(null, self));
  self.connecting = isSocket && isNotConnected(connection);
}
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L964-L973
function onUpgradedConnect(self, connection) {
  if (self.destroyed || !self.connecting || self[kupgraded] !== connection) return;
  self.connecting = false;
  self.emit("connect");
}
// A net.Socket emits 'end' after its owner's destroy(), which is no EOF from the peer.
function onUpgradedEnd(connection, eof) {
  if (!connection.destroyed) eof();
}
function attachTLSEngine(self, connection, options) {
  const [handle, events] = upgradeDuplexToTLS(connection, options);
  connection.on("data", events[0]);
  connection.on("end", onUpgradedEnd.bind(null, connection, events[1]));
  connection.on("close", events[2]);
  connection.once(kReadError, onUpgradedReadError.bind(null, self));
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/js_stream_socket.js#L117-L120
  connection.resume();
  self._handle = handle;
}
function adoptTLSPair(self, connection, pair) {
  if (!pair) throw new Error("Invalid socket");
  const raw = (connection._handle = pair[0]);
  raw[kAdoptedTLSRaw] = self;
  self.once("end", self[kCloseRawConnection]);
  raw.connecting = false;
  self._handle = pair[1];
}
function attachClientTLS(self, connection, tls, upgradeDuplex) {
  const handle = connection._handle;
  if (self.destroyed || (!upgradeDuplex && !handle)) return;
  const options = { data: self, tls, socket: self[khandlers], isServer: false };
  try {
    if (upgradeDuplex || isNamedPipeSocket(handle) || hasUnflushedWrites(connection)) {
      attachTLSEngine(self, connection, options);
    } else {
      adoptTLSPair(self, connection, upgradeTLSDeferred(handle, options));
    }
  } catch (error) {
    self.destroy(error);
  }
}
function adoptServerTLS(self, connection, options) {
  if (self.destroyed) return;
  const handle = connection._handle;
  if (connection.destroyed || connection[kclosed] || !handle) {
    self.destroy();
    return;
  }
  try {
    // A user 'connection' listener that ran after the wrap may have queued plain writes, which must flush first.
    if (hasUnflushedWrites(connection)) {
      attachTLSEngine(self, connection, options);
    } else {
      // What was read off the fd before the wrap sits in the connection's readable buffer.
      options.initialData = connection.read(connection.readableLength) || undefined;
      adoptTLSPair(self, connection, handle.upgradeTLS(options));
    }
  } catch (error) {
    self.destroy(error);
    return;
  }
  self.emit(kUpgradeAttached);
}
// What TLSWrap.prototype.close destroys. The raw twin of an adopted fd closes with that fd instead (closeWithTLSSocket).
function unadoptedTransport(self): SocketInstance | undefined {
  const upgraded = self[kupgraded];
  if (upgraded && !upgraded.destroyed && upgraded._handle?.[kAdoptedTLSRaw] !== self) return upgraded;
}
// Node destroys the transport at every close: all writes have completed by then. Here a write completes once the transport has
// taken the ciphertext, so one that can hold some of the application's is released instead (releaseTransport).
function transportToDestroy(self): SocketInstance | undefined {
  if (self[kSessionAccepted] !== true) return unadoptedTransport(self);
}
// Sessions below one that was never accepted, or is reset, carried nothing else of the application's: they go with it.
function abortTransport(transport: SocketInstance) {
  if (transport instanceof Socket) transport[kSessionAccepted] = false;
  transport.destroy();
}
function releaseTransport(transport: SocketInstance) {
  if (!(transport instanceof Socket)) return void transport.destroy();
  // What leaves a socket at 'finish' is still the kernel's to send, and a close over unread input drops that. So it only gets the
  // end() of the engine, closes at the FIN of its peer and reports its own errors until then.
  transport.removeAllListeners(kReadError);
}
// The wrapped socket reports nothing and closes with the TLS socket: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L676-L688
function closeWithTLSSocket(self, raw) {
  const tlsSocket = raw[kAdoptedTLSRaw];
  if (!tlsSocket || tlsSocket[kupgraded] !== self) return false;
  if (self.destroyed) return true;
  tlsSocket[kOwesRawClose] = true;
  // A _destroy that deferred the close of its handle has returned by now.
  if (tlsSocket.destroyed) process.nextTick(closeOwedRaw, tlsSocket, self);
  return true;
}
// _destroy calls this after it queued 'error': node's order is 'error', wrapped socket 'close', 'close'.
function closeOwedRaw(self, upgraded) {
  if (!self[kOwesRawClose]) return;
  self[kOwesRawClose] = false;
  if (!upgraded.destroyed) self[kCloseRawConnection]();
}
let addAbortListener;
function destroyWhenAborted(err) {
  if (!this.destroyed) {
    // node's stream layer (addAbortSignal) destroys the socket with an AbortError (code
    // ABORT_ERR) carrying the signal's reason as `cause`, not with the raw reason itself.
    this.destroy($makeAbortError(undefined, { cause: err?.target?.reason }));
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
// The built-in name check also runs natively inside the handshake: a refusal there keeps the client certificate off the wire.
function startNameCheckInHandshake(self, socket) {
  const options = self[bunTLSConnectOptions];
  if (!options) return;
  checkServerIdentityInHandshake(
    socket,
    self._rejectUnauthorized === true &&
      !self[kStandaloneWrap] &&
      options.checkServerIdentity === options.builtinCheckServerIdentity &&
      // The native check reads the SNI name. Any other host stays with the check after the handshake.
      !!options.serverName &&
      options.serverName === self.servername,
  );
}
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1647-L1707
function onClientHandshake(self, socket, success, verifyError) {
  if (!success && verifyError?.code === "ECONNRESET") {
    // will be handled in onConnectEnd
    return;
  }
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1081-L1090
  if (self.destroyed) return;
  if (!success) {
    const code = verifyError?.code;
    if (code === "EPROTO" || /^ERR_(SSL|OSSL)_/.test(code)) {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L480-L488
      self._hadError = true;
      self._closeAfterHandlingError = true;
      self.destroy(require("internal/tls").tlsHandshakeError(verifyError));
      return;
    }
    // Only a chain that this client refuses goes on: it gets its X509 error below.
    if (code == null || !self._rejectUnauthorized) {
      // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1203-L1213
      if (self.writableFinished) self.secureConnecting = false;
      else onConnectEnd.$call(self);
      return;
    }
  }

  // The chain verified. The JS check below gives node's error for the name that the native check refused.
  const refusedName = verifyError?.code === "ERR_TLS_CERT_ALTNAME_INVALID" ? verifyError : undefined;
  if (refusedName) verifyError = null;
  self._securePending = false;
  self._secureEstablished = true;
  self[kVerifyError] = verifyError ?? null;
  // https://github.com/nodejs/node/blob/v26.5.0/lib/internal/tls/wrap.js#L1190
  self.servername ||= false;
  self.alpnProtocol = socket.alpnProtocol;
  // Node has no try/catch around these emits; a listener throw reaches
  // InternalCallbackScope as uncaughtException. reportError mirrors that
  // without changing Bun.connect's handshake-throw-to-error-handler contract.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1107
  try {
    if (self[kStandaloneWrap]) {
      finishStandaloneWrap(self, verifyError);
      return;
    }
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1662-L1673
    // Unlike Node, don't gate on !isSessionReused(): BoringSSL keeps the peer
    // chain on a resumed SSL_SESSION, so re-check it against this servername.
    // The gate alone is the cross-servername resume of CVE-2026-48934.
    const { checkServerIdentity } = self[bunTLSConnectOptions];
    if (!verifyError && typeof checkServerIdentity === "function") {
      const options = self[kConnectOptions];
      const hostname = self.servername || options?.host || options?.socket?._host || self._host || "localhost";
      const cert = self.getPeerCertificate(true);
      if (cert) {
        // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1671. After TLSSocket#connect() the callback can be the constructor's, and then `options` is not its owner.
        const receiver =
          options !== undefined && $getByIdDirect(options, "checkServerIdentity") === checkServerIdentity
            ? options
            : undefined;
        verifyError = checkServerIdentity.$call(receiver, hostname, cert);
      }
    }
    verifyError ||= refusedName;
    let rejectUnauthorized;
    if (self._requestCert || (rejectUnauthorized = self._rejectUnauthorized)) {
      if (verifyError) {
        self.authorized = false;
        self.authorizationError = verifyError.code || verifyError.message;
        if (rejectUnauthorized ?? self._rejectUnauthorized) {
          self.destroy(verifyError);
          // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1686-L1688
          self.emit("secure", self);
          return;
        }
      } else {
        self.authorized = true;
      }
    } else {
      self.authorized = true;
    }
    self[kSessionAccepted] = true;
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1697-L1698
    self.secureConnecting = false;
    // pauseOnConnect stopped the handle as the handshake completed, whatever resume() did before that.
    if (!self.isPaused()) readStart(self, socket);
    self.emit(kSecureConnectDone);
    self.emit("secureConnect", verifyError);
    const pendingSession = self[kpendingSession];
    if (pendingSession) {
      self[kpendingSession] = null;
      self.emit("session", pendingSession);
    }
    self.removeListener("end", onConnectEnd);
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1810
    self.emit("secure", self);
  } catch (err) {
    reportError(err);
  }
}
// Unlike node, a wrap rejects a bad certificate: node leaves that check to the app, and a forgotten check accepts anything.
function finishStandaloneWrap(self, verifyError) {
  if (verifyError && self._rejectUnauthorized) {
    // The error reaches '_tlsError', so 'secure' must not report it again.
    self.destroy(verifyError);
    return;
  }
  self[kSessionAccepted] = true;
  // The rest is node's _finishInit: no hostname check, no 'secureConnect', and `authorized` stays false.
  self.secureConnecting = false;
  self.emit(kSecureConnectDone);
  const pendingSession = self[kpendingSession];
  if (pendingSession) {
    self[kpendingSession] = null;
    self.emit("session", pendingSession);
  }
  self.emit("secure", self);
}
function onConnectEnd() {
  // Under another TLS socket the EOF is that one's to report.
  if (!this._hadError && this.secureConnecting && this.listenerCount(kReadError) === 0) {
    const options = this[kConnectOptions];
    this._hadError = true;
    const error: InstanceType<typeof ConnResetException> & {
      path?: string;
      host?: string;
      port?: number;
      localAddress?: string;
    } = new ConnResetException("Client network socket disconnected before secure TLS connection was established");
    error.path = options.path;
    error.host = options.host;
    error.port = options.port;
    error.localAddress = options.localAddress;
    this.destroy(error);
  }
}

// The native layer hands a fatal TLS error on an established session to `error`, then closes. A failed write has a syscall.
function establishedTLSError(self, error) {
  if (self._secureEstablished && error?.code === "EPROTO" && error.syscall === undefined) {
    return require("internal/tls").tlsHandshakeError(error);
  }
}

function readStop(self, handle) {
  handle?.pause?.();
  // A socket over a generic duplex has no fd and never held the loop.
  if (self[kupgraded] && !(self[kupgraded] instanceof Socket)) return;
  self[kPausedUnref] = true;
  if (!self[kWriteReq]) handle?.unref?.();
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L494-L498
function pauseOnCreate(self, handle) {
  readStop(self, handle);
  self.readableFlowing = false;
}

// Gives back the hold readStop dropped. Cleared even when the user unref'd, so a later ref() is not undone by unrefAfterDrain.
function readStart(self, handle) {
  handle?.resume?.();
  if (!self[kPausedUnref]) return;
  self[kPausedUnref] = false;
  if (!self[kUserUnrefed]) handle?.ref?.();
}

// The write that was holding the loop (_write) just drained; a socket whose
// reads are over (peer FIN) or stopped is back at rest and lets go again.
function unrefAfterDrain(self, handle) {
  if ((self[kended] || self[kPausedUnref]) && !self[kUserUnrefed] && handle === self._handle) handle.unref?.();
}

function finishSocketEnd(self) {
  // destroy() isn't an EOF from the peer, so it emits 'close' without 'end'.
  if (self[kended] || self.destroyed) return;
  self[kended] = true;
  if (!self.allowHalfOpen) self.write = writeAfterFIN;
  self.push(null);
  Duplex.prototype.read.$call(self, 0);
  // The peer's FIN means kernel reads are over for good. In libuv a stream handle only holds
  // the loop while reading or with a write in flight, so node lets the process exit even if
  // the (half-open) writable side stays open and the readable side was never consumed. Mirror
  // that: drop this handle's hold on the loop unless a write is still waiting on drain, and
  // forget any readStop-time unref so a later read()/resume() does not pin the loop again.
  // A subsequent buffered write re-refs (see _write) so its callback can still fire.
  const socket = self._handle;
  // No _read() follows the end, and a TLS handle that backpressure stopped still has the peer's FIN to read.
  socket?.resume?.();
  if (socket && !self[kWriteReq]) {
    socket.unref?.();
    self[kPausedUnref] = false;
  }
}

function deferEndForOnreadTail(self) {
  if (self[kOnreadTail] === undefined || self.destroyed) return false;
  self[kOnreadPendingEnd] = true;
  return true;
}

// EOF, or the read error the handle closed with: https://github.com/nodejs/node/blob/v26.5.0/lib/internal/stream_base_commons.js#L207-L234
function onReadEnd(self, err?) {
  if (self.destroyed) return;
  // A reset after both directions finished. Node stops reading at EOF, so it never sees one.
  const teardownNoise = self[kended] && self.writableFinished;
  const hasErrorListener = self.listenerCount("error") > 0;
  // Without a listener a peer's reset would be an uncaught exception, so the socket closes quietly. A write in flight fails it anyway.
  const reportsReadError = hasErrorListener || (self[kWriteReq] !== undefined && !self[kended]);
  if (err && !teardownNoise && reportsReadError) {
    // Its TLS socket reports the error. The handle is gone, so this socket closes with nothing to report.
    if (self.emit(kReadError, err)) return void self.destroy();
    // The listener can be gone by the tick that emits 'error' (a request that finished as the reset arrived).
    if (hasErrorListener) self.once("error", noop);
    return void self.destroy(new ErrnoException(err.errno, err.syscall));
  }
  if (!self[kended]) {
    if (!deferEndForOnreadTail(self)) finishSocketEnd(self);
  } else if (err && !(teardownNoise && !self.readableEnded)) {
    // What a finished exchange left unread is still the reader's: its 'end' closes the socket.
    self.destroy();
  }
}

function onHandleClose(self, handle, err) {
  if (self[kclosed]) return;
  self[kclosed] = true;
  if (closeWithTLSSocket(self, handle)) return;
  // A connection attempt that lost the race and a handle that a TLS upgrade replaced end quietly.
  if (handle !== self._handle) err = undefined;
  onReadEnd(self, err);
  // Node destroys the socket with this error. Where it isn't reported, a half-open socket ends its writable side at 'end' like any other.
  if (!err || !self.allowHalfOpen || self.destroyed) return;
  if (self.readableEnded) self.end();
  else self.once("end", self.end);
}

// --- SNICallback dispatch helpers (hoisted: no per-handshake closures) ---

// Normalizes non-Error rejections (cb(true), cb("reason"), throw true): the
// native dispatch recognizes Error returns as the abort signal, and a literal
// `true` would collide with the handshake-suspension sentinel.
function toSNIError(err) {
  return err instanceof Error ? err : Object.assign(new Error("SNI callback error"), { reason: err });
}

// Applies one SNICallback resolution to the dispatch state. Node assigns
// `sni_context = context.context || context`: both the SecureContext wrapper
// and a raw native context are accepted, a falsy or primitive value keeps the
// default context, and anything else is an invalid SNI context that drops the
// connection before the handshake completes.
function consumeSNIResult(state, err, context) {
  if (err) {
    state.failed = toSNIError(err);
    return;
  }
  if (!context) return;
  const selected = context.context || context;
  const NativeSecureContext = state.server?.[kNativeSecureContextCtor];
  if (NativeSecureContext && selected instanceof NativeSecureContext) {
    state.selected = selected;
  } else if (typeof selected === "object" || typeof selected === "function") {
    state.failed = new TypeError("Invalid SNI context");
  }
}

// Stash per-connection (state.socket is this connection's TLSSocket):
// with concurrent handshakes a per-server stash could hand one connection's
// error to another's failure handler. The server is the legacy fallback when
// no handle was available at dispatch time.
function stashSNIError(state) {
  const target = state.socket ?? state.server;
  if (target) target[kSNIError] = state.failed;
}

// The user SNICallback's completion callback (bound to the per-handshake
// state). Synchronous resolutions are carried by serverName's return value;
// asynchronous ones complete the parked handshake via resumeSNI.
function onSNIResolution(state, err, context) {
  if (state.settled) return; // an SNICallback must resolve exactly once
  state.settled = true;
  consumeSNIResult(state, err, context);
  if (!state.suspended) return; // synchronous resolution - serverName's return carries it
  if (state.failed !== undefined) {
    stashSNIError(state);
    state.socketHandle?.resumeSNI(undefined, true);
  } else {
    state.socketHandle?.resumeSNI(state.selected, false);
  }
}

// `socket.data` is the net.Socket that owns the handle. Until 'open' hands an accepted handle to one, it's the net.Server.
const SocketHandlers = {
  data(socket, buffer) {
    const self = socket.data;
    self._unrefTimer();
    // TLS took over the fd; the wrapped socket reads nothing: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
    if (socket[kAdoptedTLSRaw]) return;
    if (self[kDestroyOnRead]) {
      $debug("DATA on a socket that must receive nothing - destroying it");
      self.destroy();
      return;
    }
    let full;
    try {
      full = self.push(buffer) === false;
    } catch (e) {
      // Node reports a throwing 'data' listener as uncaughtException and keeps reading.
      reportError(e);
      return;
    }
    if (full) readStop(self, socket);
  },
  writeComplete(socket, status: number) {
    onWriteComplete(socket.data, socket, status);
  },
  end(socket) {
    onReadEnd(socket.data);
  },
  close(socket, err?: NativeSocketError) {
    onHandleClose(socket.data, socket, err);
  },
  // Node's onnewsessionclient: emit once the handshake is verified. Until then, the handshake handler emits it.
  session(socket: Socket<TLSSocketInstance>, session) {
    const self = socket.data;
    if (self._secureEstablished) {
      self.emit("session", session);
    } else {
      self[kpendingSession] = session;
    }
  },
  keylog(socket, line) {
    const self = socket.data;
    self.emit("keylog", line);
    if (tlsKeylogPath !== undefined) appendTlsKeylog(tlsKeylogPath, line);
    self.server?.emit?.("keylog", line, self);
  },
  alpnCallback(socket: Socket<TLSSocketInstance>, servername, protocolsWire) {
    // Returns false when this server has no ALPNCallback (the native side
    // falls through to the static ALPNProtocols list), the selected protocol
    // string, or undefined to refuse the connection - Node's contract.
    const self = socket.data;
    const cb = self?._ALPNCallback ?? self?.server?._ALPNCallback;
    if (typeof cb !== "function") return false;
    const wire = Buffer.isBuffer(protocolsWire) ? protocolsWire : Buffer.from(protocolsWire);
    const protocols: string[] = [];
    for (let i = 0; i + 1 <= wire.length;) {
      const n = wire[i];
      protocols.push(wire.toString("latin1", i + 1, i + 1 + n));
      i += 1 + n;
    }
    let result;
    try {
      result = cb.$call(self, { servername: servername ?? false, protocols });
    } catch (err) {
      // Node: a throwing ALPNCallback refuses the connection (fatal
      // no_application_protocol alert) and surfaces the thrown error as
      // 'tlsClientError'.
      if (self) self[kALPNError] = err;
      return undefined;
    }
    if (result !== undefined && !ArrayPrototypeIncludes.$call(protocols, result)) {
      // Node: the callback selected a protocol the client did not offer -
      // refuse the connection and report ERR_TLS_ALPN_CALLBACK_INVALID_RESULT
      // through 'tlsClientError'.
      const err = $ERR_TLS_ALPN_CALLBACK_INVALID_RESULT(
        `ALPN callback returned a value (${result}) that did not match any of the client's offered protocols (${ArrayPrototypeJoin.$call(protocols, ", ")})`,
      );
      if (self) self[kALPNError] = err;
      return undefined;
    }
    return result;
  },
  serverName(server, servername, socketHandle, socket = socketHandle?.data) {
    // Returns what the SNICallback selects for this handshake:
    //   - the native SecureContext (synchronous selection)
    //   - undefined to fall through to the default context
    //   - an Error to abort the handshake (stashed for tlsClientError)
    //   - `true` to SUSPEND the handshake: the callback is asynchronous, and
    //     `socketHandle.resumeSNI(ctx, isError)` completes it when the
    //     callback finally resolves. The native side parks the connection
    //     (BoringSSL select-certificate retry) until then.
    // Nothing is cached - the callback runs per-connection the way Node's
    // does. The native dispatch passes the listener's `data` (the owning
    // tls.Server) and the accepted connection's handle, whose `data` is its TLSSocket.
    const cb = server?._SNICallback;
    if (typeof cb !== "function" || !servername) return undefined;
    const state: SNIState = {
      server,
      socketHandle,
      socket,
      selected: undefined,
      failed: undefined,
      settled: false,
      suspended: false,
    };
    try {
      // https://github.com/nodejs/node/blob/v26.5.0/lib/internal/tls/wrap.js#L298
      cb.$call(socket, servername, onSNIResolution.bind(null, state));
    } catch (err) {
      state.settled = true;
      state.failed = toSNIError(err);
    }
    if (!state.settled) {
      // The SNICallback did not resolve synchronously. Without a connection
      // handle the suspension could never be resumed - keep the legacy
      // fall-through-to-default behavior in that (unexpected) case.
      if (!socketHandle) return undefined;
      state.suspended = true;
      return true;
    }
    const failed = state.failed;
    if (failed !== undefined) {
      // Stash the error so the handshake-failure handler emits
      // 'tlsClientError' with it, and return it - the native dispatch
      // detects an Error return and aborts the handshake, dropping the
      // connection without a TLS alert the way Node does.
      stashSNIError(state);
      return failed;
    }
    return state.selected;
  },
  open(socket: SocketHandle) {
    const self = socket.data;
    // Dispatch through the listener handle's onconnection hook so user code
    // (and node:cluster RoundRobinHandle) can intercept accepted sockets the
    // same way Node.js exposes TCP/Pipe wrap onconnection.
    const listener = (self as any as ServerInstance)._handle || socket.listener;
    if (listener && typeof listener.onconnection === "function") {
      listener.onconnection(0, socket);
      return;
    }
    socket[owner_symbol] = self;
    // Ahead of `oncomplete`: a 'connect' listener that writes sends the ClientHello, which has to offer the session.
    const session = self[bunTLSConnectOptions]?.session;
    // On the native socket: an fd upgrade assigns `_handle` after `open`.
    if (session) socket.setSession(typeof session === "string" ? Buffer.from(session, "latin1") : session);
    startNameCheckInHandshake(self, socket);
    const req = socket[kConnectReq];
    socket[kConnectReq] = undefined;
    // A TLS session over a transport the caller handed in has no request. An attempt that timed out has no `oncomplete`.
    req?.oncomplete?.(0, self._handle, req, true, true);
  },
  connectError(socket: SocketHandle, error: NativeConnectError) {
    const self = socket.data;
    const req = socket[kConnectReq];
    socket[owner_symbol] = self;
    // connect() or bind() failed inside doConnect(): kConnectDispatch returns the errno, as Node's handle.connect() does.
    if (req?.dispatching) {
      req.errno = error.errno || uv().UV_ECANCELED;
      return;
    }
    socket[kConnectReq] = undefined;
    // A TLS engine that failed before it opened has no connect pending: afterConnect would drop the failure.
    if (self[kupgraded]) {
      if (!self.destroyed) self.destroy(new ErrnoException(error.errno, "connect"));
      return;
    }
    // Not deferred like libuv's ECANCELED of a closed handle: it would fail a connect() made right after destroy().
    req?.oncomplete?.(error.errno, self._handle, req, true, true);
  },
  handshake(socket: Socket<TLSSocketInstance>, success, verifyError) {
    const self = socket.data;
    if (!self.isServer) return onClientHandshake(self, socket, success, verifyError);
    // `server` is null for a standalone `new tls.TLSSocket(socket, { isServer: true })`
    // (no listening server owns it) — guard every server.emit / server option read.
    const server = self.server;
    if (self[khandshakeTimer]) {
      clearTimeout(self[khandshakeTimer]);
      self[khandshakeTimer] = undefined;
    }
    // On the server side the second argument is the raw handshake result
    // (client-certificate verification is reported separately through
    // `verifyError` and handled below), so !success always means the TLS
    // session was never established.
    if (!success) {
      // The handshake never completed: there is no TLS session, so there is
      // no secureConnection. Report the failure through tlsClientError the
      // way Node does and tear the connection down. A connection that was
      // already reported (handshake timeout, explicit destroy) is not
      // reported a second time when its teardown unwinds the handshake.
      let alreadyDestroyed;
      if (self._hadError || self[kerrorEmitted] || (alreadyDestroyed = self.destroyed)) {
        if (!(alreadyDestroyed ?? self.destroyed)) self.destroy();
        return;
      }
      // An SNICallback that reported an error (or returned an invalid
      // context) aborted this handshake: surface that error through
      // 'tlsClientError' instead of the generic disconnect message.
      let err;
      if (self[kSNIError]) {
        err = self[kSNIError];
        self[kSNIError] = undefined;
      } else if (server?.[kSNIError]) {
        // Legacy/fallback stash location (no connection handle was available
        // at SNI-dispatch time).
        err = server[kSNIError];
        server[kSNIError] = undefined;
      } else if (self[kALPNError]) {
        // The ALPNCallback refused the connection (threw, or selected a
        // protocol the client did not offer).
        err = self[kALPNError];
        self[kALPNError] = undefined;
      } else {
        err = require("internal/tls").tlsHandshakeError(verifyError);
      }
      self.servername = socket.getServername();
      self._hadError = true;
      // Node's onerror destroys *with* the error when the handshake never
      // finished, so 'close' reports hadError === true; the socket stays
      // reachable for the 'tlsClientError' listener because the destroy is
      // deferred through _closeAfterHandlingError.
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L480-L488
      self._closeAfterHandlingError = true;
      self.destroy(err);
      return;
    }
    self._securePending = false;
    self.secureConnecting = false;
    self._secureEstablished = !!success;
    self.servername = socket.getServername() ?? false;
    self.alpnProtocol = socket.alpnProtocol;
    self[kVerifyError] = verifyError ?? null;
    // The native verifier reports a non-OK code when there is no peer certificate,
    // which is the normal case for plain TLS servers.
    if (self._requestCert) {
      if (verifyError) {
        self.authorized = false;
        self.authorizationError = verifyError.code || verifyError.message;
        if (self._rejectUnauthorized) {
          // The connection is refused: report the verification result through
          // tlsClientError before tearing down. When the connection is kept
          // (rejectUnauthorized: false) it proceeds with authorized=false and
          // no tlsClientError - Node's onServerSocketSecure never emits it
          // there and test-tls-sni-option asserts mustNotCall on it for the
          // authorized=false cases.
          // Node reports a connection once: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1234-L1240
          if (!self[kerrorEmitted]) {
            self[kerrorEmitted] = true;
            server?.emit("tlsClientError", verifyError, self);
          }
          // A rejected peer is torn down with the verification error, so
          // 'close' reports hadError === true. The internal 'error' listener
          // installed by the TLSSocket constructor (node's _init) keeps this
          // from surfacing as an uncaught exception when the user attached
          // none of their own.
          // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L606
          self.destroy(verifyError);
          return;
        }
      } else {
        self.authorized = true;
      }
    }
    self[kSessionAccepted] = true;
    // A net.Socket with its own transport never emits 'connect', but a finished handshake proves it's connected.
    if (self.connecting) {
      try {
        onUpgradedConnect(self, self[kupgraded]);
      } catch (err) {
        reportError(err);
      }
    }
    const pauseOnConnect = server?.pauseOnConnect;
    if (pauseOnConnect) {
      pauseOnCreate(self, socket);
    }
    if (!pauseOnConnect && !self.destroyed) {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L502-L524
      self.read(0);
    }
    // Node: a listener throw here reaches InternalCallbackScope as
    // uncaughtException; Bun's dispatch would route it to this table's error
    // handler instead. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1107
    try {
      if (server) {
        // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1214-L1232
        if (!self.destroyed && self._releaseControl()) {
          server.emit("secureConnection", self);
        }
      }
      if (self.destroyed) return;
      self.emit(kSecureConnectDone);
      // Accepted sockets expose no post-handshake events: node's socket-level
      // 'secure' fires before a tls.Server user can hold the socket (the
      // 'connection' event hands out the raw socket), and 'secureConnect' is
      // attached by the client path only. A standalone
      // `new TLSSocket(s, { isServer: true })` is user-held from construction,
      // so its 'secure' stays observable.
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1107
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1810
      if (!server) self.emit("secure", self);
    } catch (err) {
      reportError(err);
    }
  },
  error(socket: Socket<TLSSocketInstance>, error) {
    const self = socket.data;
    if (!self || self._hadError) return;
    self._hadError = true;
    if (typeof self[bunTlsSymbol] !== "function") {
      self.destroy(error);
      return;
    }
    const tlsError = establishedTLSError(self, error);
    if (tlsError) error = tlsError;
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L467-L498
    if (!self._secureEstablished) {
      // The socket stays reachable while 'tlsClientError' is emitted through the '_tlsError' hop.
      self._closeAfterHandlingError = true;
      self.destroy(error);
    } else if (self.isServer && self._rejectUnauthorized && /peer did not return a certificate/.test(error?.message)) {
      // Ignore server's authorization errors
      self.destroy();
    } else if (tlsError && !self[kWriteReq]) {
      self._emitTLSError(error);
    } else if (self.isServer) {
      // Node leaves the socket alive. Bun's tls.Server completes the handshake of a peer that already reset, and that error would be uncaught.
      self.emit("_tlsError", error);
      self.destroy(self.listenerCount("error") > 0 ? error : undefined);
    } else {
      self.destroy(error);
    }
  },
  binaryType: "buffer",
} as const satisfies InternalSocketHandler<SocketInstance>;

function applyRejectUnauthorized(self, tls, rejectUnauthorized) {
  if (typeof rejectUnauthorized !== "undefined") {
    self._rejectUnauthorized = rejectUnauthorized !== false;
    tls.rejectUnauthorized = self._rejectUnauthorized;
  } else {
    self._rejectUnauthorized = tls.rejectUnauthorized;
  }
}

// tlsConnectionListener registers this on every accepted socket so an error
// raised while the server still owns the connection reaches 'tlsClientError'
// exactly once.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1234-L1240
function onSocketTLSError(err) {
  if (!this._controlReleased && !this[kerrorEmitted]) {
    this[kerrorEmitted] = true;
    this.server?.emit("tlsClientError", err, this);
  }
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1246-L1257
function onSocketTLSClose(hadError) {
  if (hadError) return;
  if (!this._controlReleased && !this[kerrorEmitted]) {
    this[kerrorEmitted] = true;
    this.server?.emit("tlsClientError", new ConnResetException("socket hang up"), this);
  }
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1056-L1058
function onHandshakeDeadline(socket) {
  socket[khandshakeTimer] = undefined;
  if (socket.destroyed) return;
  socket._emitTLSError($ERR_TLS_HANDSHAKE_TIMEOUT());
  socket.emit("timeout");
}

// 'close' listener: `this` is the socket.
function clearHandshakeTimeout() {
  if (this[khandshakeTimer]) {
    clearTimeout(this[khandshakeTimer]);
    this[khandshakeTimer] = undefined;
  }
}

function initAcceptedTLSSocket(server, socket) {
  socket[kerrorEmitted] = false;
  socket.on("_tlsError", onSocketTLSError);
  socket.on("error", onSocketTLSError);
  socket.on("close", onSocketTLSClose);
  const handshakeTimeout = server._handshakeTimeout;
  if (!(handshakeTimeout > 0)) return;
  // Node arms socket.setTimeout() on its TLSSocket. Here the program's own setTimeout() is on the same socket, and bytes that arrive mid-handshake must not put the deadline off.
  const timer = setTimeout(onHandshakeDeadline, handshakeTimeout, socket);
  // Node's handshake timer is unref'd: a fully-unref'd server (the
  // graceful-shutdown pattern) must not be held open by a client that
  // stalls mid-handshake.
  timer.unref?.();
  socket[khandshakeTimer] = timer;
  socket.once("close", clearHandshakeTimeout);
}
// Node.js-compatible onconnection: assigned to server._handle.onconnection in
// kRealListen and invoked from SocketHandlers.open with `this` bound to the
// listener handle. Kept as a standalone function so tests/cluster can wrap it.
function onconnection(err, clientHandle) {
  const handle = this;
  const self = handle[owner_symbol] as ServerInstance;
  if (err) {
    self.emit("error", err);
    return;
  }
  // Nothing reads this: it keeps the listener reachable for the garbage collector while a connection of its is open.
  clientHandle[kServerSocket] = handle;
  const options = self[bunSocketServerOptions];
  const { [kSocketClass]: SClass } = options;
  // Read per connection like node; the listener itself was created with the value listen() saw.
  const pauseOnConnect = self.pauseOnConnect;
  // Propagate the server's half-open/highWaterMark settings to the accepted
  // socket so the Duplex's allowHalfOpen matches what the native layer was
  // configured with in kRealListen; without this, net.createServer({
  // allowHalfOpen: true }) would be ignored on accepted connections.
  // Matches Node's onconnection:
  // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L2349
  const _socket = new SClass({
    allowHalfOpen: self.allowHalfOpen,
    highWaterMark: self.highWaterMark,
  }) as SocketInstance;
  _socket.isServer = true;
  // Use the server's normalized fields so the per-socket flag agrees with the
  // native listener: node's tlsConnectionListener passes `this.requestCert`
  // (`=== true`-normalized), not the raw option.
  if (typeof _socket[bunTlsSymbol] === "function") {
    _socket._requestCert = self._requestCert;
    _socket._rejectUnauthorized = self._rejectUnauthorized;
  }

  _socket[kAttach](clientHandle);

  const blockList = self.blockList;
  if (blockList) {
    const addressType = isIP(clientHandle.remoteAddress);
    // No 'drop': https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2512-L2520
    if (addressType && blockList.check(clientHandle.remoteAddress, `ipv${addressType}`)) {
      clientHandle.end();
      return;
    }
  }
  if (self.maxConnections != null && self._connections >= self.maxConnections) {
    const data = {
      localAddress: _socket.localAddress,
      localPort: _socket.localPort || clientHandle.localPort,
      localFamily: _socket.localFamily,
      remoteAddress: _socket.remoteAddress,
      remotePort: _socket.remotePort,
      remoteFamily: _socket.remoteFamily || "IPv4",
    };

    clientHandle.end();
    self.emit("drop", data);
    return;
  }

  const bunTLS = _socket[bunTlsSymbol];
  const isTLS = typeof bunTLS === "function";

  if (self.noDelay && clientHandle.setNoDelay) {
    _socket[kSetNoDelay] = true;
    clientHandle.setNoDelay(true);
  }
  if (self.keepAlive && clientHandle.setKeepAlive) {
    _socket[kSetKeepAlive] = true;
    _socket[kSetKeepAliveInitialDelay] = self.keepAliveInitialDelay * 1000;
    clientHandle.setKeepAlive(true, self.keepAliveInitialDelay * 1000);
  }

  self._connections++;
  _socket.server = self;
  _socket._server = self;

  // Before 'connection', so it can't undo a listener's readStop: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L623-L632
  if (isTLS) {
    initAcceptedTLSSocket(self, _socket);
    _socket[kAcceptedTLS] = self;
  } else if (pauseOnConnect) pauseOnCreate(_socket, clientHandle);
  else _socket.read(0);

  // Node reports a throwing 'connection' listener as uncaughtException and keeps the socket.
  try {
    self.emit("connection", _socket);
  } catch (e) {
    reportError(e);
  }
}

// Native code asks JS from inside every handshake for each of these members a table has, so a listener gets only what its server uses.
const {
  session: _session,
  connectError: _connectError,
  serverName,
  alpnCallback,
  ...AcceptedHandlers
} = SocketHandlers;
const AcceptedHandlersSNI = { ...AcceptedHandlers, serverName };
const AcceptedHandlersALPN = { ...AcceptedHandlers, alpnCallback };
const AcceptedHandlersSNIAndALPN = { ...AcceptedHandlers, serverName, alpnCallback };

function serverHandlersFor(server) {
  if (server._SNICallback) return server._ALPNCallback ? AcceptedHandlersSNIAndALPN : AcceptedHandlersSNI;
  return server._ALPNCallback ? AcceptedHandlersALPN : AcceptedHandlers;
}

// The `onread` option: https://github.com/nodejs/node/blob/v26.5.0/lib/internal/stream_base_commons.js#L177-L185
const OnreadHandlers = {
  ...SocketHandlers,
  data(socket, buffer) {
    const self = socket.data;
    self._unrefTimer();
    if (socket[kAdoptedTLSRaw]) return;
    const tail = self[kOnreadTail];
    if (tail !== undefined) {
      self[kOnreadTail] = Buffer.concat([tail, buffer]);
      return;
    }
    self[kOnreadDeliver](buffer);
  },
};

// node.net.native trace events: one 'b'/'e' pair per connect *attempt*, including
// failed ones. 'b' fires where the attempt is issued; the per-req flag dedupes the
// 'e' across the afterConnect(Multiple) / rejected-promise / attempt-timeout paths.
const kNetTraceCat = "node,node.net,node.net.native";
const kTraceConnectActive = Symbol("kTraceConnectActive");
let traceEvents: typeof import("internal/trace_events").default;
function traceConnectStart(req, pipePath?) {
  traceEvents ??= require("internal/trace_events");
  if (!traceEvents.isCategoryGroupEnabled(kNetTraceCat)) return;
  if (pipePath !== undefined) {
    // Node (pipe_wrap.cc) emits path_type/pipe_path at the top level of the
    // event's `args` for pipe connects; an abstract socket path starts with
    // '\0', which is stripped from the reported path.
    const isAbstract = pipePath.charCodeAt(0) === 0;
    traceEvents.emitEventWithArgs("b", kNetTraceCat, "connect", undefined, {
      path_type: isAbstract ? "abstract socket" : "file",
      pipe_path: isAbstract ? pipePath.slice(1) : pipePath,
    });
  } else {
    traceEvents.emitEvent("b", kNetTraceCat, "connect");
  }
  req[kTraceConnectActive] = true;
}
function traceConnectEnd(req) {
  if (req && req[kTraceConnectActive]) {
    req[kTraceConnectActive] = false;
    traceEvents.emitEvent("e", kNetTraceCat, "connect");
  }
}

function kConnectTcp(self, addressType, req, address, port) {
  $debug("SocketHandle.kConnectTcp", addressType, address, port);
  // Node dials through the handle, and @mswjs/interceptors replaces these methods to take over the connection.
  const handle = self._handle;
  const replaced = addressType === 6 ? handle.connect6 : handle.connect;
  if (typeof replaced === "function") return replaced.$call(handle, req, address, port);
  traceConnectStart(req);
  return kConnectDispatch(self, req, {
    hostname: address,
    port,
    localAddress: req.localAddress || undefined,
    localPort: req.localPort || undefined,
    ipv6Only: addressType === 6,
    // The native socket is always half-open: closing it on the peer's FIN
    // would discard whatever is still buffered on the writable side. The
    // stream layer implements allowHalfOpen=false (onSocketEnd ends the
    // writable side, which flushes, sends FIN and destroys), matching Node
    // where libuv sockets are half-open and the stream layer decides.
    allowHalfOpen: true,
    tls: req.tls,
    pauseOnConnect: req.pauseOnConnect,
  });
}

function kConnectPipe(self, req, address) {
  $debug("SocketHandle.kConnectPipe");
  const handle = self._handle;
  const replaced = handle.connect;
  if (typeof replaced === "function") return replaced.$call(handle, req, address);
  traceConnectStart(req, address);
  const errno = kConnectDispatch(self, req, {
    hostname: address,
    unix: address,
    // Always half-open natively; see kConnect.
    allowHalfOpen: true,
    tls: req.tls,
    pauseOnConnect: req.pauseOnConnect,
  });
  // libuv returns EINVAL for a name it can't use and reports a failed connect(2) from the loop.
  if (errno === 0 || errno === uv().UV_EINVAL) return errno;
  setImmediate(afterPipeConnectFailed, self, handle, req, errno);
  return 0;
}

function afterPipeConnectFailed(self, handle, req, errno) {
  // destroy() or another connect() already ended this request.
  if (self._handle === handle && handle[kConnectReq] === req) req.oncomplete(errno, handle, req, true, true);
}

function kConnectDispatch(self, req, opts) {
  // Node's TCPWrap returns errno for sync uv_*_connect failure and defers
  // oncomplete; doConnect instead fires connectError inside this call. Bracket
  // it so connectError hands the errno back here instead of re-entering.
  const handle = self._handle;
  handle[kConnectReq] = req;
  opts.data = self;
  opts.socket = self[khandlers];
  req.dispatching = true;
  const promise = doConnect(handle, opts);
  req.dispatching = false;
  promise.catch(_reason => {
    // eat this so there's no unhandledRejection
    // we already catch this in connectError and error
    traceConnectEnd(req);
  });
  const errno = req.errno;
  if (errno !== undefined) {
    req.errno = undefined;
    return errno;
  }
  return 0;
}

function Socket(options?): void {
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

  // Own properties only, as after node's `options = { ...options }`: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L410-L419
  const fd = opts.fd;
  if (fd !== undefined) {
    validateInt32(fd, "options.fd", 0);
  }

  // `opts` carries the caller's readable / writable like node: a `readable: false` side starts ended and never emits 'end'.
  Duplex.$call(this, {
    ...opts,
    allowHalfOpen,
    //For node.js compat do not emit close on destroy.
    emitClose: false,
    autoDestroy: true,
    // Handle strings directly.
    decodeStrings: false,
  });
  this._parent = null;
  this._parentWrap = null;
  this[kupgraded] = null;
  this[kStandaloneWrap] = false;
  this[kOnUpgradedClose] = undefined;
  this[kOwesRawClose] = false;

  this[kSetNoDelay] = Boolean(noDelay);
  this[kSetKeepAlive] = Boolean(keepAlive);
  // Bun's native _handle.setKeepAlive takes milliseconds (it is the public
  // Bun.Socket), so store ms here. Node stores seconds because libuv does.
  this[kSetKeepAliveInitialDelay] = MathMax(0, ~~keepAliveInitialDelay);

  this[khandlers] = SocketHandlers;
  this[kDestroyOnRead] = false;
  this[kBytesRead] = 0;
  this[kBytesWritten] = undefined;
  this[kLastWriteQueueSize] = 0;
  this[kclosed] = false;
  this[kended] = false;
  this.connecting = false;
  this._host = undefined;
  this._port = undefined;
  this[bunTLSConnectOptions] = null;
  this.timeout = 0;
  // node initializes the timer slot to null so it is observable before setTimeout() is called.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L401
  this[kTimeout] = null;
  this[kWriteReq] = undefined;
  this._pendingData = undefined;
  this._pendingEncoding = undefined; // for compatibility
  this._hadError = false;
  this.isServer = false;
  this._handle = options?.handle || null;
  this[ksocket] = undefined;
  this.server = undefined;
  this._server = undefined;
  this._peername = null;
  this._sockname = null;
  this._closeAfterHandlingError = false;

  // Shut down the socket when we're finished with it.
  this.on("end", onSocketEnd);

  let stats;
  let fdIsWriteOnly = false;
  if (fd !== undefined) {
    // Adopt pipe/character-device fds with synchronous writes. Matches
    // node's effective semantics for stdio-style sockets: writes to a pipe
    // complete inline, so data survives an immediate process.exit().
    // Gated on an explicit `writable: true` (how node's own stdio wraps fds,
    // e.g. new Socket({ fd: 2, readable: false, writable: true })).
    if (opts.writable === true) {
      try {
        stats = require("node:fs").fstatSync(fd);
      } catch {
        // Node: createHandle -> uv_guess_handle returns UV_UNKNOWN_HANDLE
        // for an fd it cannot fstat, then throws ERR_INVALID_FD_TYPE.
        throw $ERR_INVALID_FD_TYPE("UNKNOWN");
      }
      // Node's createHandle() wraps PIPE and TCP fds only: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L183-L199
      if (stats.isFile()) {
        throw $ERR_INVALID_FD_TYPE("FILE");
      }
    }
  }

  // After the fd type check like Node, but before adopting the fd: a socket discarded by the throw would close it.
  const typeOfService = opts.typeOfService;
  if (typeOfService !== undefined) {
    validateInt32(typeOfService, "options.typeOfService", 0, 255);
    this[kSetTOS] = typeOfService;
  }

  if (stats !== undefined) {
    // isSocket() covers stdio handed to a child as a socketpair, which is how spawn implements pipes on unix.
    const optionsReadable = opts.readable;
    if (stats.isFIFO() || stats.isCharacterDevice() || (stats.isSocket() && optionsReadable !== true)) {
      fdIsWriteOnly = true;
      // No native reads on this path: an unspecified `readable` gets EOF here (`false` already ended it in the Duplex).
      if (optionsReadable !== true && optionsReadable !== false) {
        this.push(null);
        this.read(0);
      }
    }
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
    if (!isUint8Array(onread.buffer) && typeof onread.buffer !== "function") onread = null;
  }
  if (onread) {
    const onreadBuffer = onread.buffer;
    const onreadCallback = onread.callback;
    const onreadBufferIsFn = typeof onreadBuffer === "function";
    const self = this;
    this[kOnreadTail] = undefined;
    this[kOnreadDraining] = false;
    // Node calls the factory once at initSocketHandle time, then once after
    // every callback (stream_base_commons onStreamRead): the first delivery
    // already has a real buffer, and a non-Uint8Array result leaves the prior
    // value (or the `true` sentinel) in place.
    if (onreadBufferIsFn) {
      const first = onreadBuffer();
      this[kOnreadBuffer] = isUint8Array(first) ? first : true;
    } else {
      this[kOnreadBuffer] = onreadBuffer;
    }
    // onStreamRead calls the user callback bare - a throw is an uncaught
    // exception, not a socket 'error'. Node bounds each kernel read to the
    // onread buffer's size, so each slice is a separate onStreamRead call and
    // a swallowed uncaughtException loses no bytes; bun slices one larger
    // native read in this loop, so the catch is per-slice.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L179
    this[kOnreadDeliver] = function deliver(buffer) {
      let offset = 0;
      const total = buffer.length;
      while (offset < total) {
        const dest = self[kOnreadBuffer];
        if (dest === true) {
          let ret;
          try {
            ret = onreadCallback.$call(self, total - offset, true);
            if (onreadBufferIsFn) {
              const next = onreadBuffer();
              if (isUint8Array(next)) self[kOnreadBuffer] = next;
            }
          } catch (e) {
            // The native data dispatch would otherwise route a throw to the
            // socket error handler; hand it to the uncaught-exception path
            // synchronously the way node's bare call does.
            reportError(e);
          }
          if (self.destroyed) return;
          if (ret === false || self.isPaused()) {
            self[kOnreadTail] = kOnreadEmptyTail;
            readStop(self, self._handle);
          }
          return;
        }
        if (dest.length === 0) {
          const err = new Error("read ENOBUFS") as Error & { code?: string; errno?: number; syscall?: string };
          err.code = "ENOBUFS";
          err.errno = uv().UV_ENOBUFS;
          err.syscall = "read";
          self.destroy(err);
          return;
        }
        const n = MathMin(dest.length, total - offset);
        dest.set(buffer.subarray(offset, offset + n));
        offset += n;
        let ret;
        try {
          ret = onreadCallback.$call(self, n, dest);
          if (onreadBufferIsFn) {
            const next = onreadBuffer();
            if (isUint8Array(next)) self[kOnreadBuffer] = next;
          }
        } catch (e) {
          // Same as above: report then fall through so the next slice is
          // delivered, matching node's per-onStreamRead behavior.
          reportError(e);
        }
        if (self.destroyed) return;
        if (ret === false || self.isPaused()) {
          const rest = buffer.subarray(offset);
          self[kOnreadTail] = rest.length !== 0 ? rest : kOnreadEmptyTail;
          readStop(self, self._handle);
          return;
        }
      }
    };
    this[khandlers] = OnreadHandlers;
  }
  if (signal) {
    if (signal.aborted) {
      process.nextTick(destroyNT, this, $makeAbortError(undefined, { cause: signal.reason }));
    } else {
      // addAbortListener registers a once listener; the close hook detaches it when the socket
      // goes away first (mirrors node's addAbortSignal + eos cleanup).
      addAbortListener ??= require("internal/abort_listener").addAbortListener;
      const disposable = addAbortListener(signal, destroyWhenAborted.bind(this));
      this.once("close", disposable[Symbol.dispose]);
    }
  }
  const optsBlockList = opts.blockList;
  if (optsBlockList) {
    if (!lazyBlockList().isBlockList(optsBlockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", optsBlockList);
    }
    this.blockList = optsBlockList;
  }

  // usockets can't read a FIFO (recv() fails with ENOTSOCK), and it would close fds 0-2 on destroy, which Node never does.
  if (fdIsWriteOnly) {
    Socket.prototype.connect.$call(this, { fd, fdIsWriteOnly });
    // Nothing is read from this handle. Like a socket whose peer sent FIN, it holds the loop only while a write is pending.
    this[kended] = true;
    this._handle.unref();
  } else if (process.platform !== "win32" && fd > 2 && opts.readable !== false && !this[bunTlsSymbol]) {
    try {
      stats ??= require("node:fs").fstatSync(fd);
    } catch {}
    if (stats?.isSocket()) Socket.prototype.connect.$call(this, { fd });
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
  // A write queued before 'connect' isn't in progress yet.
  if (this._pendingData && !this.connecting) {
    return;
  }

  const handle = this._handle;
  if (handle) {
    // A write queue that moved since the last tick is still draining, so wait another period. A stalled one times out.
    const writeQueueSize = getBufferedAmount(handle);
    if (writeQueueSize !== this[kLastWriteQueueSize]) {
      this[kLastWriteQueueSize] = writeQueueSize;
      this._unrefTimer();
      return;
    }
  }
  this.emit("timeout");
};

Object.defineProperty(Socket.prototype, "bufferSize", {
  get: function () {
    // Node returns undefined once the handle is gone (after close).
    if (this._handle) {
      return this.writableLength;
    }
  },
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L939-L950
Object.defineProperty(Socket.prototype, "bytesRead", {
  configurable: false,
  enumerable: true,
  get: function () {
    const handle = this._handle;
    return handle ? handleBytesRead(this, handle) : this[kBytesRead];
  },
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L1043-L1045
Object.defineProperty(Socket.prototype, "_bytesDispatched", {
  get: function () {
    const handle = this._handle;
    return (handle ? handle.bytesWritten : this[kBytesWritten]) || 0;
  },
});

Object.defineProperty(Socket.prototype, "bytesWritten", {
  get: function (this: SocketInstance) {
    let bytes = this._bytesDispatched;
    const data = this._pendingData;
    const writableBuffer = this.writableBuffer;
    if (!writableBuffer) return undefined;
    for (const el of writableBuffer) {
      bytes += el.chunk instanceof Buffer ? el.chunk.length : Buffer.byteLength(el.chunk, el.encoding);
    }
    if (data) {
      // Writes are either a string or a Buffer.
      if (typeof data !== "string") bytes += data.length;
      else bytes += Buffer.byteLength(data, this._pendingEncoding || "utf8");
    }
    return bytes;
  },
});

Socket.prototype[kAttach] = function (socket) {
  socket.data = this;
  socket[owner_symbol] = this;
  const timeout = this.timeout;
  if (timeout) {
    this.setTimeout(timeout);
  }
  this._handle = socket;
  this.connecting = false;

  if (!this[kupgraded]) {
    // this is not actually emitted on nodejs when socket used on the connection
    // this is already emmited on non-TLS socket and on TLS socket is emmited secureConnect after handshake
    this.emit("connect", this);
    this.emit("ready");
  }
};

Socket.prototype[kCloseRawConnection] = function () {
  const connection = this[kupgraded];
  // Only a destroy the connection's owner started counts as it closing under this socket.
  if (!connection.destroyed) connection.removeListener("close", this[kOnUpgradedClose]);
  connection.connecting = false;
  detachSocket(connection);
  connection.unref();
  connection.destroy();
};

// A handle that is open already (fd, wrapped stream) starts reading unless the user paused. afterConnect does this for a dial.
function startReadingNT(self) {
  if (!self.connecting && !self.isPaused()) self.read(0);
}

Socket.prototype.connect = function connect(...args) {
  $debug("Socket.prototype.connect");
  // The closed handle cancels its queued write from the event loop. By then that would fail this connection.
  if (this.destroyed && this[kWriteReq]) onWriteComplete(this, this[kWriteReq].handle, uv().UV_ECANCELED);
  const [options, cb] = $isArray(args[0]) && args[0][normalizedArgsSymbol] ? args[0] : normalizeArgs(args);
  {
    let connection = this[ksocket];
    let upgradeDuplex = false;
    let { port, host, path, socket, rejectUnauthorized, checkServerIdentity, session, fd, pauseOnConnect } = options;
    // A session over a transport the caller handed in has no connection of its own to dial again.
    if (!socket && this[kupgraded] && !this.destroyed) {
      const ex = new ExceptionWithHostPort(uv().UV_EISCONN, "connect", path || host || "localhost", port);
      process.nextTick(destroyNT, this, ex);
      return this;
    }
    if (typeof this[bunTlsSymbol] === "function") this.servername = options.servername;
    if (socket) {
      connection = socket;
    }
    if (fd != null) {
      // createConnection({ fd }) gets here after the constructor already adopted the fd.
      if (this._handle?.fd !== fd) {
        this._handle ??= newDetachedSocket(false);
        const errno = kConnectDispatch(
          this,
          { oncomplete: afterOpenFd },
          {
            fd,
            fdIsRawSocket: options.fdIsRawSocket === true,
            fdIsWriteOnly: options.fdIsWriteOnly === true,
            // Always half-open natively; see kConnect.
            allowHalfOpen: true,
            pauseOnConnect,
          },
        );
        // https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L568-L569
        if (errno !== 0) throw new ErrnoException(errno, "open");
      }
      if (pauseOnConnect) pauseOnCreate(this, this._handle);
      else process.nextTick(startReadingNT, this);
      return this;
    }
    if (pauseOnConnect) {
      // A dial is paused when it opens, and afterConnect releases its hold.
      this.readableFlowing = false;
    } else {
      process.nextTick(startReadingNT, this);
      this.connecting = true;
    }
    const bunTLS = this[bunTlsSymbol];
    if (
      // TLSSocket already created a socket and is forwarding it here. This is a private API.
      !(
        socket &&
        $isObject(socket) &&
        (typeof bunTLS === "function" ? isWrappableStream(socket) : socket instanceof Duplex)
      ) &&
      // public api for net.Socket.connect
      port === undefined &&
      path == null
    ) {
      throw $ERR_MISSING_ARGS(["options", "port", "path"]);
    }
    var tls: TLSConnectOptions | undefined = undefined;
    if (typeof bunTLS === "function") {
      tls = bunTLS.$call(this, host);
      // Client always request Cert
      this._requestCert = true;
      if (tls) {
        applyRejectUnauthorized(this, tls, rejectUnauthorized);
        tls.requestCert = true;
        tls.session = session || tls.session;
        this.servername = tls.servername;
        if (checkServerIdentity !== undefined) {
          validateFunction(checkServerIdentity, "options.checkServerIdentity");
        }
        tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
        this[bunTLSConnectOptions] = tls;
      }
      if (connection) {
        // An http 'connect' or 'upgrade' socket is connected but has no fd to adopt.
        const connectedWithoutHandle = !connection._handle && !isNotConnected(connection);
        if (
          typeof connection !== "object" ||
          !(connection instanceof Socket) ||
          typeof connection[bunTlsSymbol] === "function" ||
          connectedWithoutHandle
        ) {
          if (isWrappableStream(connection)) {
            upgradeDuplex = true;
          } else {
            throw new TypeError("socket must be an instance of net.Socket or Duplex");
          }
        }
      }
      this.authorized = false;
      this.secureConnecting = true;
      this[kPreHandshakeWrite] = false;
      this._secureEstablished = false;
      this[kSessionAccepted] = false;
      this._securePending = true;
      this[kConnectOptions] = options;
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1811
      this.removeListener("end", onConnectEnd);
      if (!this[kStandaloneWrap]) this.prependListener("end", onConnectEnd);
    }
    // start using existing connection
    if (connection) {
      if (cb != null) this.once("secureConnect", cb);
      // reset the underlying writable object when establishing a new connection
      // this is a function on `Duplex`, originally defined on `Writable`
      // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L311
      // https://github.com/nodejs/node/blob/c5cfdd48497fe9bd8dbd55fd1fca84b321f48ec1/lib/net.js#L1126
      this._undestroy();
      linkUpgraded(this, connection);
      // upgradeTLS() takes an established socket.
      if (upgradeDuplex || !this.connecting) attachClientTLS(this, connection, tls, upgradeDuplex);
      else connection.once("connect", attachClientTLS.bind(null, this, connection, tls, false));
      if (this.connecting) connection.once("connect", onUpgradedConnect.bind(null, this, connection));
      return this;
    }
  }

  if (typeof this[bunTlsSymbol] === "function" && cb !== null) {
    this.once("secureConnect", cb);
  } else if (cb !== null) {
    this.once("connect", cb);
  }
  if (this._parent?.connecting) {
    return this;
  }
  const socketWrite = Socket.prototype.write;
  if (this.write !== socketWrite) {
    this.write = socketWrite;
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
  const upgraded = this[kupgraded];

  // What closes with this socket clears its own.
  clearTimeout(this[kTimeout]);
  const released = unadoptedTransport(this);
  if (released !== undefined && !this.resetAndClosing && this[kSessionAccepted] === true) releaseTransport(released);

  $debug("close");
  const currentHandle = this._handle;
  if (currentHandle) {
    $debug("close handle");
    const isException = err ? true : false;
    // Ahead of every branch: two of them close the handle a loop turn later, when the flight has left.
    if (typeof this[bunTlsSymbol] === "function" || currentHandle[kAdoptedTLSRaw]) {
      releaseHeldFlight(currentHandle);
    }
    if (this.resetAndClosing) {
      this.resetAndClosing = false;
      // resetAndDestroy() must send an RST (not a graceful FIN) so the peer sees
      // ECONNRESET. `close()` does a fast shutdown (clean close) which only
      // happens to surface as RST on some platforms; `terminate()` arms
      // SO_LINGER{1,0} for a real reset on all platforms.
      const transport = unadoptedTransport(this);
      if (transport !== undefined) abortTransport(transport);
      const err = this._handle.terminate();
      setImmediate(() => {
        $debug("emit close");
        this.emit("close", isException);
      });
      if (err) this.emit("error", new ErrnoException(err, "reset"));
    } else if (this._closeAfterHandlingError) {
      // Enqueue closing the socket as a microtask, so that the socket can be
      // accessible when an `error` event is handled in the `next tick queue`.
      // The native close that follows a failure reported under a JS call detaches _handle before this runs.
      queueMicrotask(() => closeSocketHandle(this, currentHandle, isException, true));
    } else if (currentHandle[kAdoptedTLSRaw]) {
      // Shared-fd TLS pair: defer the close two check-phase turns
      // (test-tls-socket-close); see closeAdoptedTLSRawNT.
      currentHandle.pause?.();
      setImmediate(closeAdoptedTLSRawNT, this, currentHandle, isException);
    } else {
      closeSocketHandle(this, currentHandle, isException);
    }

    if (!this._closeAfterHandlingError) detachSocket(this);
    callback(err);
    closeOwedRaw(this, upgraded);
  } else {
    callback(err);
    closeOwedRaw(this, upgraded);
    const transport = transportToDestroy(this);
    if (transport !== undefined) abortTransport(transport);
    if (transport instanceof Socket) transport.once("close", emitCloseNT.bind(null, this, err ? true : false));
    else process.nextTick(emitCloseNT, this, err ? true : false);
  }

  const server = this._server;
  if (server) {
    $debug("has server");
    server._connections--;
    if (server._emitCloseIfDrained) {
      server._emitCloseIfDrained();
    }
  }
};

Socket.prototype._final = function _final(callback) {
  $debug("Socket.prototype._final");
  if (this.connecting) {
    return this.once("connect", this._final.bind(this, callback));
  }
  const socket = this._handle;

  // already closed call destroy. A server-side wrap attaches its handle on the tick its constructor queued, ahead of endNT.
  if (!socket && !this[kupgraded]) return callback();

  // emit FIN allowHalfOpen only allow the readable side to close first
  process.nextTick(endNT, this, socket, callback);
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

// Queued/in-flight plain writes would be stranded on the retired TCP wrapper
// if the fd were adopted; such sockets use the stream-level TLS engine, whose
// ciphertext queues behind the pending writes (order + callbacks preserved).
function hasUnflushedWrites(connection) {
  return connection.writableLength > 0 || connection[kWriteReq] !== undefined;
}

function drainOnreadTail(self, fromRead?) {
  if (self[kOnreadTail] === undefined) return false;
  if (fromRead) self[kOnreadReadRequested] = true;
  if (!self[kOnreadDraining]) {
    self[kOnreadDraining] = true;
    process.nextTick(drainOnreadTailNT, self);
  }
  return true;
}

function drainOnreadTailNT(socket) {
  socket[kOnreadDraining] = false;
  const fromRead = socket[kOnreadReadRequested];
  socket[kOnreadReadRequested] = false;
  const tail = socket[kOnreadTail];
  if (tail === undefined || socket.destroyed) return;
  if (!fromRead && socket.isPaused()) return;
  socket[kOnreadTail] = undefined;
  socket[kOnreadDeliver](tail);
  if (socket[kOnreadTail] !== undefined || socket.destroyed) return;
  if (socket[kOnreadPendingEnd]) {
    socket[kOnreadPendingEnd] = false;
    finishSocketEnd(socket);
  } else if (fromRead || !socket.isPaused()) {
    readStart(socket, socket._handle);
  }
}

Socket.prototype.resume = function resume() {
  // Node's Readable.resume() ignores a destroyed stream. Ours also waits for 'end', which destroy() doesn't emit.
  if (this.destroyed) return this;

  // Schedule the Readable flow tick first so its read() runs while
  // kOnreadDraining is still set and does not queue a second drain: Node's
  // override sets handle.reading synchronously for the same reason.
  const ret = Duplex.prototype.resume.$call(this);
  // Reads start from _read(), which a full buffer doesn't reach. Only an onread socket starts them here: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L976-L982
  if (this[kOnreadBuffer] !== undefined && !this.connecting && !drainOnreadTail(this)) readStart(this, this._handle);
  return ret;
};

// Only a connected onread socket stops reading here: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L817-L827
Socket.prototype.pause = function pause() {
  const handle = this._handle;
  if (handle && this[kOnreadBuffer] !== undefined && !this.connecting && !this.secureConnecting && !this.destroyed) {
    readStop(this, handle);
  }
  return Duplex.prototype.pause.$call(this);
};

Socket.prototype[kReadStop] = function () {
  const handle = this._handle;
  if (handle) readStop(this, handle);
};

// Server-side TLS upgrade over an accepted socket, for
// `new tls.TLSSocket(socket, { isServer: true })`. Adopts the connection's fd
// into an accept-state TLS socket (us_socket_adopt_tls with is_client=0) so the
// native read path drives the handshake. Lives here, not tls.ts, to reach
// serverHandlersFor() — the shared accepted-socket handler table, with per-socket
// state carried via `data` (mirrors tls.createServer's one-handler-for-all model).
Socket.prototype[Symbol.for("::bunUpgradeServerTLS::")] = function (
  connection: SocketInstance & { encrypted?: boolean },
  tls,
) {
  linkUpgraded(this, connection);
  const options = { data: this, tls, socket: serverHandlersFor(this), isServer: true };
  const socket = connection._handle;
  if (
    !socket ||
    !(connection instanceof Socket) ||
    connection.encrypted ||
    isNamedPipeSocket(socket) ||
    hasUnflushedWrites(connection)
  ) {
    // No adoptable fd (generic Duplex, named pipe, never dialed), TLS over TLS (the fd belongs to the
    // outer SSL layer), or pending plain writes that must flush first.
    attachTLSEngine(this, connection, options);
  } else if (connection.connecting) {
    connection.once("connect", process.nextTick.bind(null, adoptServerTLS, this, connection, options));
  } else {
    process.nextTick(adoptServerTLS, this, connection, options);
  }
  if (this.connecting) connection.once("connect", onUpgradedConnect.bind(null, this, connection));
};

// Client-side `new tls.TLSSocket(socket)`: the tls.connect({ socket }) upgrade, without onConnectSecure and onConnectEnd.
Socket.prototype[kUpgradeClientTLS] = function (connection, servername) {
  // Own, as in tls.connect(): connect() takes an inherited `rejectUnauthorized` for the caller's choice.
  Socket.prototype.connect.$call(this, {
    socket: connection,
    servername,
    rejectUnauthorized: this._rejectUnauthorized,
  });
};

// https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L985-L991
Socket.prototype.read = function read(size) {
  if (this[kOnreadBuffer] !== undefined && !this.connecting && !drainOnreadTail(this, true))
    readStart(this, this._handle);
  return Duplex.prototype.read.$call(this, size);
};

Socket.prototype._read = function _read(size) {
  const socket = this._handle;
  if (this.connecting || !socket) {
    this.once("connect", () => this._read(size));
  } else if (!drainOnreadTail(this, true)) {
    readStart(this, socket);
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
  this[kUserUnrefed] = false;
  // An explicit ref() supersedes the hold a pause dropped on the user's behalf;
  // unrefAfterDrain must not give it up again.
  this[kPausedUnref] = false;
  const socket = this._handle;
  if (!socket) {
    this.once("connect", this.ref);
    return this;
  }
  // Node has one handle under both sockets. Here the TLS socket that adopted the fd holds the loop.
  (socket[kAdoptedTLSRaw] ?? socket).ref();
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
  // Bun's native _handle.setKeepAlive takes milliseconds; the ms→seconds
  // conversion for TCP_KEEPIDLE lives in the native binding. Clamp to 0 so
  // negatives and ~~ overflow match Node's no-validate behavior.
  const initialDelay = MathMax(0, ~~initialDelayMsecs);

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

// EINVAL is a unix socket, EBADF is TLS over a stream. Node's Pipe and TLSWrap lack these methods, so it only caches the value.
function handleHasNoTypeOfService(socket, err) {
  return err === uv().UV_EINVAL || (err === uv().UV_EBADF && !socket.connecting);
}

// Matches Node's setTypeOfService/getTypeOfService (lib/net.js + TCPWrap).
// The native handle does the setsockopt (IP_TOS / IPV6_TCLASS); a socket
// without a handle yet caches the value and applies it on connect.
// https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/net.js#L661
Socket.prototype.setTypeOfService = function setTypeOfService(tos) {
  if (Number.isNaN(tos)) {
    throw $ERR_INVALID_ARG_TYPE("tos", "number", tos);
  }
  validateInt32(tos, "tos", 0, 255);

  if (!this._handle || !this._handle.setTypeOfService) {
    this[kSetTOS] = tos;
    return this;
  }

  if (tos !== this[kSetTOS]) {
    this[kSetTOS] = tos;
    const err = this._handle.setTypeOfService(tos);
    // Windows often restricts TOS or reports errors even when partially
    // applied - best-effort there, the way Node treats it.
    if (err && process.platform !== "win32" && !handleHasNoTypeOfService(this, err)) {
      throw new ErrnoException(err, "setTypeOfService");
    }
  }
  return this;
};

Socket.prototype.getTypeOfService = function getTypeOfService() {
  if (!this._handle || !this._handle.getTypeOfService) {
    return this[kSetTOS] !== undefined ? this[kSetTOS] : 0;
  }
  const res = this._handle.getTypeOfService();
  if (typeof res === "number" && res < 0) {
    // getsockopt(IP_TOS) commonly fails on Windows: fall back to the cached
    // value the way Node does.
    if (process.platform === "win32" || handleHasNoTypeOfService(this, res)) {
      return this[kSetTOS] !== undefined ? this[kSetTOS] : 0;
    }
    throw new ErrnoException(res, "getTypeOfService");
  }
  return res;
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
  this[kUserUnrefed] = true;
  const socket = this._handle;
  if (!socket) {
    this.once("connect", this.unref);
    return this;
  }
  (socket[kAdoptedTLSRaw] ?? socket).unref();
  return this;
};

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L785
Socket.prototype.destroySoon = function destroySoon() {
  if (this.writable) this.end();
  if (this.writableFinished) this.destroy();
  else this.once("finish", this.destroy);
};

//TODO: migrate to native
// Writable calls this with two chunks or more.
Socket.prototype._writev = function _writev(data, callback) {
  for (let i = 0; i < data.length; i++) {
    const { chunk, encoding } = data[i];
    data[i] = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
  }
  return this._write(Buffer.concat(data), "buffer", callback);
};

Socket.prototype._write = function _write(chunk, encoding, callback) {
  $debug("Socket.prototype._write");
  // If we are still connecting, then buffer this for later.
  // The Writable logic will buffer up any more writes while
  // waiting for this one to be done.
  if (this.connecting) {
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
  const socket = this._handle;
  if (!socket && this[kupgraded] && !this.destroyed) {
    // Node wraps the handle synchronously in the TLSSocket constructor
    // (_wrapHandle), so a banner written in the same tick as the wrap is
    // buffered by TLSWrap and flushed once the handshake completes. Bun
    // adopts the fd a tick later, so hold the write until it lands rather
    // than failing it as a closed socket.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L590-L608
    this._pendingData = chunk;
    this._pendingEncoding = encoding;
    const onClose = onUpgradeWriteClose.bind(this, callback);
    this.once(kUpgradeAttached, onUpgradeAttachedWrite.bind(this, chunk, encoding, callback, onClose));
    this.once("close", onClose);
    return;
  }
  this._pendingData = null;
  this._pendingEncoding = "";
  if (!socket) {
    callback($ERR_SOCKET_CLOSED());
    return false;
  }
  this._unrefTimer();
  if (this.secureConnecting) this[kPreHandshakeWrite] = true;
  const status = socket.$write(chunk, encoding);
  if (status === false) {
    this[kWriteReq] = { handle: socket, callback, frame: AsyncContextFrame.current() };
    // A pending write holds the loop even on a handle whose FIN/pause dropped
    // its hold (libuv: the uv_write_t is active); unrefAfterDrain lets go again.
    if ((this[kended] || this[kPausedUnref]) && !this[kUserUnrefed]) socket.ref?.();
  } else if (status !== true) {
    // https://github.com/nodejs/node/blob/v26.5.0/lib/internal/stream_base_commons.js#L158-L159
    callback(new ErrnoException(status, "write"));
  } else if (this.encrypted) {
    // A TLS write is never done in the same call in Node, so writableLength counts it until the next tick (test-tls-buffersize.js).
    process.nextTick(callback);
  } else {
    // Done in the same call, so a tight write() loop stops at the kernel's backpressure, not at highWaterMark (test-net-throttle.js).
    callback();
  }
};

function createConnection(...args) {
  const normalized = normalizeArgs(args);
  const options = normalized[0];
  const socket = new Socket(options);

  const optionsTimeout = options.timeout;
  if (optionsTimeout) {
    socket.setTimeout(optionsTimeout);
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
  port = +(port ?? 0) | 0;

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

  self._host = host;
  self._port = port;

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

  const optionsLookup = options.lookup;
  if (optionsLookup != null) validateFunction(optionsLookup, "options.lookup");

  if (dns === undefined) dns = require("node:dns");
  const dnsopts: { family: unknown; hints: number; all?: boolean } = {
    family: socketToDnsFamily(options.family),
    hints: options.hints || 0,
  };
  if (!isWindows && dnsopts.family !== 4 && dnsopts.family !== 6 && dnsopts.hints === 0) {
    dnsopts.hints = dns.ADDRCONFIG;
  }

  $debug("connect: find host", host, addressType);
  $debug("connect: dns options", dnsopts);
  const lookup = optionsLookup || dns.lookup;

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
    } else if (typeof ip !== "string" || !isIP(ip)) {
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

// Per attempt, not per connect(): setServername()/setSession() calls made after tls.connect() must reach the dial.
// Per attempt: a setSession() or setServername() made since connect() counts.
function clientTLSOptionsForAttempt(self, options): TLSConnectOptions | undefined {
  const bunTLS = self[bunTlsSymbol];
  if (typeof bunTLS !== "function") return undefined;
  const tls = bunTLS.$call(self, self._host);
  if (tls) {
    const { rejectUnauthorized, session, checkServerIdentity } = options;
    applyRejectUnauthorized(self, tls, rejectUnauthorized);
    tls.requestCert = true;
    tls.session = session || tls.session;
    self.servername = tls.servername;
    tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
    self[bunTLSConnectOptions] = tls;
  }
  return tls;
}

function internalConnect(self, options, path);
function internalConnect(self, options, address, port, addressType, localAddress, localPort);
function internalConnect(self, options, address, port?, addressType?, localAddress?, localPort?) {
  $assert(self.connecting);

  let err;

  // The native connect binds, and reports a failed bind() as its own error.
  if (localPort) localAddress ||= addressType === 4 ? "0.0.0.0" : "::";

  const tls = clientTLSOptionsForAttempt(self, options);

  $debug("connect: attempting to connect to %s:%d (addressType: %d)", address, port, addressType);
  self.emit("connectionAttempt", address, port, addressType);
  // A listener may destroy() the socket. Connecting now would open a handle with no owner.
  if (!self.connecting) return;

  if (addressType === 6 || addressType === 4) {
    if (self.blockList?.check(address, `ipv${addressType}`)) {
      self.destroy($ERR_IP_BLOCKED(address));
      return;
    }
    const req: ConnectReq = {};
    req.oncomplete = afterConnect;
    req.address = address;
    req.port = port;
    req.localAddress = localAddress;
    req.localPort = localPort;
    req.addressType = addressType;
    req.tls = tls;
    req.pauseOnConnect = options.pauseOnConnect;

    err = kConnectTcp(self, addressType, req, address, port);
    // kConnectTcp returns 0 (not undefined) on the async-connect path, so the
    // perf context must be established whenever the attempt was dispatched
    // without a synchronous error — matching the `if (err)` failure check
    // below. Guarding on `err === undefined` never fired, so the 'net' entry
    // was never produced for the TCP path.
    if (!err && hasObserver("net")) {
      startPerf(self, kPerfHooksNetConnectContext, {
        type: "net",
        name: "connect",
        detail: { host: address, port },
      });
    }
  } else {
    const req: ConnectReq = {};
    req.address = address;
    req.oncomplete = afterConnect;
    req.tls = tls;
    req.pauseOnConnect = options.pauseOnConnect;

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

  const { localPort, port } = context;
  const { address, family: addressType } = context.addresses[current];
  const localAddress = localPort ? (addressType === 4 ? "0.0.0.0" : "::") : undefined;

  if (self.blockList?.check(address, `ipv${addressType}`)) {
    const ex = $ERR_IP_BLOCKED(address);
    ArrayPrototypePush.$call(context.errors, ex);
    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    internalConnectMultiple(context);
    return;
  }

  const tls = clientTLSOptionsForAttempt(self, context.options);

  $debug("connect/multiple: attempting to connect to %s:%d (addressType: %d)", address, port, addressType);
  self.emit("connectionAttempt", address, port, addressType);
  if (!self.connecting) return;

  // const req = new TCPConnectWrap();
  const req: ConnectReq = {};
  req.oncomplete = afterConnectMultiple.bind(undefined, context, current);
  req.address = address;
  req.port = port;
  req.localAddress = localAddress;
  req.localPort = localPort;
  req.addressType = addressType;
  req.tls = tls;
  req.pauseOnConnect = context.options.pauseOnConnect;

  ArrayPrototypePush.$call(self.autoSelectFamilyAttemptedAddresses, `${address}:${port}`);

  const err = kConnectTcp(self, addressType, req, address, port);

  if (err) {
    const ex = new ExceptionWithHostPort(err, "connect", address, port);
    ArrayPrototypePush.$call(context.errors, ex);

    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    // A listener may destroy() on that event; same guard as afterConnectMultiple.
    if (self.connecting) internalConnectMultiple(context);
    return;
  }

  // After a sync open, arming the timer would capture a stale handle and overwrite the next attempt's kTimeout.
  if (!self.connecting || context.current !== current + 1) {
    return;
  }

  // Match the single-address path (and Node): the 'net' perf entry starts when
  // the attempt is dispatched, not when it completes; the winning attempt's
  // context is transferred to the socket in afterConnectMultiple.
  if (hasObserver("net")) {
    startPerf(context, kPerfHooksNetConnectContext, {
      type: "net",
      name: "connect",
      detail: { host: address, port },
    });
  }

  if (current < context.addresses.length - 1) {
    $debug("connect/multiple: setting the attempt timeout to %d ms", context.timeout);

    // If the attempt has not returned an error, start the connection timer
    context[kTimeout] = setTimeout(internalConnectMultipleTimeout, context.timeout, context, req, self._handle).unref();
  }
}

function internalConnectMultipleTimeout(context, req, handle) {
  // Socket._destroy can't reach the per-context timer, so destroy() mid-attempt
  // leaves this armed; don't emit a spurious timeout or re-close the handle.
  if (!context.socket.connecting) return;

  $debug("connect/multiple: connection to %s:%s timed out", req.address, req.port);
  context.socket.emit("connectionAttemptTimeout", req.address, req.port, req.addressType);

  req.oncomplete = undefined;
  // `oncomplete` is what would have ended the span.
  traceConnectEnd(req);
  ArrayPrototypePush.$call(context.errors, createConnectionError(req, uv().UV_ETIMEDOUT));
  handle.close();

  // Try the next address, unless we were aborted
  if (context.socket.connecting) {
    internalConnectMultiple(context);
  }
}

// Options set before the socket had a connection.
function applySocketOptions(self, handle) {
  if (self[kSetTOS] !== undefined && handle.setTypeOfService) {
    handle.setTypeOfService(self[kSetTOS]);
  }
  if (self[kSetNoDelay] && handle.setNoDelay) {
    handle.setNoDelay(true);
  }
  if (self[kSetKeepAlive] && handle.setKeepAlive) {
    handle.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
  }
}

// An adopted descriptor is open already, so this runs inside connect({ fd }).
function afterOpenFd(_status, handle) {
  const self = handle[owner_symbol];
  self._unrefTimer();
  applySocketOptions(self, handle);
  try {
    self.emit("connect", self);
    self.emit("ready");
  } catch (e) {
    reportError(e);
  }
}

function afterConnect(status, handle, req, readable, writable) {
  traceConnectEnd(req);
  if (!handle) return;
  const self = handle[owner_symbol];
  if (!self) return;

  // Callback may come after call to destroy
  if (self.destroyed) {
    return;
  }

  $debug("afterConnect", status, readable, writable);

  // A pre-open error on a user-supplied duplex (tls.connect({ socket })) can
  // clear `connecting` before the queued StartTLS task fires this callback.
  // The socket is already being torn down, so bail out instead of asserting:
  // this both avoids the debug $assert abort and stops the late callback from
  // proceeding to touch a handle that the error path already freed.
  if (!self.connecting) return;
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
    applySocketOptions(self, self._handle);

    // Ours already reads, Node's starts at read(): stop a paused plain socket now, and after the listeners unless one asked for a read.
    // A socket built with `readable: false` never reads: read() cannot reach _read once the readable side has ended.
    const pausedBeforeConnect = self.isPaused() || (self.readableEnded && self[kOnreadBuffer] === undefined);
    if (pausedBeforeConnect && !self.encrypted) readStop(self, self._handle);

    // Node reports a throwing 'connect' or 'ready' listener as uncaughtException and keeps the socket.
    try {
      self.emit("connect");
      self.emit("ready");
    } catch (e) {
      reportError(e);
    }

    if (self[kPerfHooksNetConnectContext] && hasObserver("net")) {
      stopPerf(self, kPerfHooksNetConnectContext);
    }

    // Start the first read, or get an immediate EOF.
    // this doesn't actually consume any bytes, because len=0.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L1695-L1696
    if (readable && !self.isPaused()) self.read(0);
    else if (!pausedBeforeConnect && !self.encrypted && !self._readableState.reading) readStop(self, self._handle);
  } else {
    let details;
    const localAddress = req.localAddress;
    let localPort;
    if (localAddress && (localPort = req.localPort)) {
      details = localAddress + ":" + localPort;
    }
    const ex: ConnectException = new ExceptionWithHostPort(status, "connect", req.address, req.port, details);
    if (details) {
      ex.localAddress = req.localAddress;
      ex.localPort = req.localPort;
    }

    self.emit("connectionAttemptFailed", req.address, req.port, req.addressType, ex);
    self.destroy(ex);
  }
}

function afterConnectMultiple(context, current, status, handle, req, readable, writable) {
  traceConnectEnd(req);
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
      internalConnectMultiple(context, status === uv().UV_ECANCELED);
    }

    return;
  }

  // The attempt's perf entry was started in internalConnectMultiple on the
  // shared context; hand it to the socket so afterConnect's stopPerf records
  // the real connect duration.
  if (hasObserver("net") && context[kPerfHooksNetConnectContext]) {
    self[kPerfHooksNetConnectContext] = context[kPerfHooksNetConnectContext];
  }

  afterConnect(status, self._handle, req, readable, writable);
}

function createConnectionError(req, status) {
  let details;

  const localAddress = req.localAddress;
  let localPort;
  if (localAddress && (localPort = req.localPort)) {
    details = localAddress + ":" + localPort;
  }

  const ex: ConnectException = new ExceptionWithHostPort(status, "connect", req.address, req.port, details);
  if (details) {
    ex.localAddress = req.localAddress;
    ex.localPort = req.localPort;
  }

  return ex;
}

type MaybeListener = ListenerHandle | null;

function Server(): void;
function Server(options?: null | undefined): void;
function Server(connectionListener: () => {}): void;
function Server(options: ServerOpts, connectionListener?: () => {}): void;
function Server(options?, connectionListener?): void {
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
  let {
    allowHalfOpen = false,
    keepAlive = false,
    keepAliveInitialDelay,
    highWaterMark = getDefaultHighWaterMark(),
    pauseOnConnect = false,
    noDelay = false,
  } = options;

  if (keepAliveInitialDelay !== undefined) {
    validateNumber(keepAliveInitialDelay, "options.keepAliveInitialDelay");
    if (keepAliveInitialDelay < 0) keepAliveInitialDelay = 0;
  } else {
    keepAliveInitialDelay = 0;
  }

  this._connections = 0;

  this._handle = null as MaybeListener;
  this._usingWorkers = false;
  this.workers = [];
  this._unref = false;

  this[bunSocketServerOptions] = undefined;
  // Server option coercion matches Node's Server constructor:
  // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L1880
  this.allowHalfOpen = allowHalfOpen;
  this.keepAlive = Boolean(keepAlive);
  // In seconds: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2041
  this.keepAliveInitialDelay = ~~(keepAliveInitialDelay / 1000);
  this.highWaterMark = highWaterMark;
  this.pauseOnConnect = Boolean(pauseOnConnect);
  this.noDelay = Boolean(noDelay);

  // Node registers the createServer callback as a plain "connection"
  // listener in the constructor, so a manual emit("connection", socket)
  // reaches it and listenerCount("connection") counts it.
  // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L1837-L1846
  if (typeof connectionListener === "function") {
    this.on("connection", connectionListener);
  }
  this[bunSocketServerOptions] = options;

  const optionsBlockList = options.blockList;
  if (optionsBlockList) {
    if (!lazyBlockList().isBlockList(optionsBlockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", optionsBlockList);
    }
    this.blockList = optionsBlockList;
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
  this[kClusterListeningId] = (this[kClusterListeningId] || 0) + 1;
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
    if (typeof this._handle.stop === "function") {
      this._handle.stop(false);
      // Listener::do_stop unrefs the loop at once; hold it one turn like node's uv_close() (test-process-beforeexit).
      setImmediate(noop);
      // Released here, not on 'close': https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2434-L2437
      const clusterHandle = this[kClusterHandle];
      if (clusterHandle) {
        this[kClusterHandle] = null;
        this[kClusterUnixPath] = undefined;
        clusterHandle.close();
      }
    } else {
      this._handle.close();
    }
    this._handle = null;
  }

  this._emitCloseIfDrained();

  return this;
};

Server.prototype[Symbol.asyncDispose] = function () {
  // Node resolves immediately when the server is not listening (lib/net.js
  // SymbolAsyncDispose); without the guard a second dispose rejects with
  // ERR_SERVER_NOT_RUNNING and re-emits 'close'.
  if (!this._handle) return Promise.$resolve();
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
    const unix = server.unix || this[kClusterUnixPath];
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
    process.nextTick(callback, null, this._connections);
  }
  return this;
};

Server.prototype.listen = function listen(port, hostname, backlogArg) {
  const argsLength = arguments.length;
  // The callback is always the last argument: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L315-L319
  const lastArg = argsLength > 0 ? arguments[argsLength - 1] : undefined;
  let onListen = typeof lastArg === "function" ? lastArg : undefined;
  // (path, backlog), (port, backlog) or (port, host, backlog)
  let backlog = toNumber(argsLength > 1 && hostname) || toNumber(argsLength > 2 && backlogArg);
  let path;
  let exclusive = false;
  let reusePort = false;
  let ipv6Only = false;
  let readableAll = false;
  let writableAll = false;
  let fd;
  if (isPipeName(port)) {
    path = port;
    hostname = undefined;
    port = undefined;
  } else {
    if (typeof hostname !== "string") hostname = undefined;

    if (typeof port === "function") {
      port = 0;
    } else if (port !== null && typeof port === "object") {
      const options = port;
      addServerAbortSignalOption(this, options);

      hostname = options.host;
      exclusive = options.exclusive;
      path = options.path;
      port = options.port;
      ipv6Only = options.ipv6Only;
      // NOTE: options.allowHalfOpen for a server is consumed by the Server
      // constructor (it shapes accepted sockets' Duplex behavior); the native
      // listen always uses allowHalfOpen: true.
      reusePort = options.reusePort;
      backlog = options.backlog || backlog;
      // For a unix-socket listen, readableAll/writableAll chmod the socket file
      // in kRealListen; threaded through as locals (not stashed on the instance).
      readableAll = options.readableAll;
      writableAll = options.writableAll;

      const optionsFd = options.fd;
      if (typeof optionsFd === "number" && optionsFd >= 0) {
        fd = optionsFd;
        port = 0;
      }

      const isLinux = process.platform === "linux" || process.platform === "android";

      // Match Node's listen() option normalization + validation.
      // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/net.js#L2145
      if ((port === undefined && "port" in options) || port === null) {
        port = 0;
      }

      if (typeof port === "number" || typeof port === "string") {
        // validatePort coerces "0" -> 0 and throws ERR_SOCKET_BAD_PORT for
        // out-of-range/non-numeric values; a valid port takes precedence over path.
        validatePort(port, "options.port");
        port = +port | 0;
        // A valid port takes precedence over `path` (Node listens on TCP when both are given).
        path = undefined;
      } else if (isPipeName(path)) {
        const isAbstractPath = path.startsWith("\0");
        if (isLinux && isAbstractPath && (options.writableAll || options.readableAll)) {
          const message = `The argument 'options' can not set readableAll or writableAll to true when path is abstract unix socket. Received ${JSON.stringify(options)}`;

          const error = new TypeError(message);
          error.code = "ERR_INVALID_ARG_VALUE";
          throw error;
        }

        hostname = path;
        port = undefined;
      } else if (!("port" in options) && !("path" in options)) {
        let message = 'The argument \'options\' must have the property "port" or "path"';
        try {
          message = `${message}. Received ${JSON.stringify(options)}`;
        } catch {}

        const error = new TypeError(message);
        error.code = "ERR_INVALID_ARG_VALUE";
        throw error;
      } else {
        let message = "The argument 'options' is invalid";
        try {
          message = `${message}. Received ${JSON.stringify(options)}`;
        } catch {}

        const error = new TypeError(message);
        error.code = "ERR_INVALID_ARG_VALUE";
        throw error;
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
    } else if (port === undefined || port === null) {
      port = 0;
    } else if (typeof port === "number" || typeof port === "string") {
      // Positional port: validatePort coerces and throws ERR_SOCKET_BAD_PORT for
      // out-of-range/non-numeric values, matching Node's normalizeArgs + validatePort.
      validatePort(port, "options.port");
      port = +port | 0;
    } else {
      let message = "The argument 'options' is invalid";
      try {
        message = `${message}. Received ${JSON.stringify(port)}`;
      } catch {}
      const error = new TypeError(message);
      error.code = "ERR_INVALID_ARG_VALUE";
      throw error;
    }
    if (reusePort === true) {
      exclusive = true;
    }
    var clusterHost: string | null | undefined = typeof hostname === "string" && hostname.length > 0 ? hostname : null;
    hostname = hostname || "::";
  }

  if (this._handle) {
    throw $ERR_SERVER_ALREADY_LISTEN();
  }

  if (onListen != null) {
    this.once("listening", onListen);
  }

  try {
    var tls: any = undefined;
    var TLSSocketClass = undefined;
    const bunTLS = this[bunTlsSymbol];
    const options = this[bunSocketServerOptions];
    let contexts: Map<string, any> | null = null;
    if (typeof bunTLS === "function") {
      [tls, TLSSocketClass] = bunTLS.$call(this, hostname);
      options.servername = tls.serverName;
      options[kSocketClass] = TLSSocketClass;
      contexts = tls.contexts;
    } else {
      options[kSocketClass] = Socket;
    }

    const flags = (ipv6Only === true ? 1 : 0) | (reusePort === true ? 2 : 0);
    let queryAddress: string | null = null;
    let queryPort: number | null | undefined = port;
    let queryAddressType: number | null = 4;
    if (path) {
      queryAddress = path;
      queryPort = -1;
      queryAddressType = -1;
    } else if (typeof fd === "number" && fd >= 0) {
      queryPort = null;
      queryAddressType = null;
    } else if (typeof clusterHost === "string") {
      queryAddress = clusterHost;
      queryAddressType = isIP(clusterHost) || 4;
    }

    const listenOn = host =>
      listenInCluster(
        this,
        queryAddress,
        queryPort,
        queryAddressType,
        backlog,
        fd,
        exclusive,
        ipv6Only,
        reusePort,
        readableAll,
        writableAll,
        flags,
        path,
        host,
        tls,
        contexts,
      );
    try {
      listenOn(hostname);
    } catch (err: any) {
      // No host and no IPv6 in the kernel: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2127-L2139
      if (queryAddress !== null || err?.code !== "EAFNOSUPPORT") throw err;
      listenOn((hostname = "0.0.0.0"));
    }
  } catch (err) {
    const address = path ?? (fd === undefined ? hostname : null);
    process.nextTick(emitErrorNextTick, this, listenException(err, address, path != null ? -1 : port));
  }
  return this;
};

Server.prototype[kRealListen] = function (
  path,
  port,
  hostname,
  exclusive,
  ipv6Only,
  reusePort,
  readableAll,
  writableAll,
  tls,
  contexts,
  fd,
) {
  // NOTE: accepted sockets are always allowHalfOpen:true at the native layer
  // (hardcoded below); the stream layer implements allowHalfOpen=false
  // semantics itself, so the server option is consumed in JS only.
  if (reusePort) {
    exclusive = false;
  }
  const serverOptions = this[bunSocketServerOptions];
  const listenOptions = {
    tls,
    allowHalfOpen: true,
    reusePort: reusePort || serverOptions?.reusePort || false,
    ipv6Only: ipv6Only || serverOptions?.ipv6Only || false,
    exclusive: exclusive || serverOptions?.exclusive || false,
    socket: serverHandlersFor(this),
    data: this,
    pauseOnConnect: this.pauseOnConnect,
  };
  if (path) this._handle = Bun.listen({ unix: path, ...listenOptions });
  else if (fd != null) this._handle = Bun.listen({ fd, hostname, ...listenOptions });
  else this._handle = Bun.listen({ port, hostname, ...listenOptions });
  if (path) {
    // Mirror libuv uv_pipe_chmod: readableAll/writableAll relax the unix socket
    // file's group/other permission bits. Skipped on Windows and abstract
    // sockets (no filesystem entry). uSockets binds synchronously, so the file
    // exists by the time Bun.listen returns.
    // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/net.js#L1899
    if ((readableAll || writableAll) && process.platform !== "win32" && path.charCodeAt(0) !== 0) {
      let desired = 0;
      if (readableAll) desired |= 0o44; // S_IRGRP | S_IROTH
      if (writableAll) desired |= 0o22; // S_IWGRP | S_IWOTH
      try {
        const fs = require("node:fs");
        const cur = fs.statSync(path).mode;
        if ((cur & desired) !== desired) fs.chmodSync(path, cur | desired);
      } catch (e) {
        // _handle is a Bun.listen SocketListener: it exposes stop(), not close().
        this._handle?.stop?.(true);
        this._handle = null;
        throw e;
      }
    }
  }

  this._handle[owner_symbol] = this;
  this._handle.onconnection = onconnection;

  const addr = this.address();
  if (addr && typeof addr === "object") {
    const familyLast = String(addr.family).slice(-1);
    this._connectionKey = `${familyLast}:${addr.address}:${port}`;
  }

  if (contexts) {
    for (const [name, context] of contexts) {
      // tls.ts stores the InternalSecureContext wrapper; the native side wants
      // the native SSL_CTX wrapper at `.context`.
      addServerName(this._handle, name, context.context ?? context);
    }
  }

  // Unref the handle if the server was unref'ed prior to listening
  if (this._unref) this.unref();

  // A tick, not a timer, so a close() from 'listening' runs before the loop accepts anything (as in Node).
  process.nextTick(emitListeningNextTick, this);
};

Server.prototype[EventEmitter.captureRejectionSymbol] = function (err, event, sock) {
  switch (event) {
    case "connection":
    case "secureConnection":
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

function emitListeningNextTick(self) {
  // (Or the Bun.ModuleGraph whose script listened has been disposed: its listener was closed with it.)
  if (!self._handle || isStoppedModuleGraphRunning()) return;
  self.emit("listening");
}

const { isPrimary } = require("internal/cluster/isPrimary");
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
  reusePort,
  readableAll,
  writableAll,
  flags,
  path,
  hostname,
  tls,
  contexts,
) {
  exclusive = !!exclusive;

  // A worker's first require of node:cluster runs its bootstrap (IPC handlers, 'online'); listen() has always been one
  // of the places that happens, exclusive or not.
  if (!isPrimary && cluster === undefined) cluster = require("node:cluster");

  if (
    !isPrimary &&
    !exclusive &&
    typeof address === "string" &&
    address.length > 0 &&
    typeof port === "number" &&
    port >= 0 &&
    isIP(address) === 0
  ) {
    const lookupListeningId = (server[kClusterListeningId] = (server[kClusterListeningId] || 0) + 1);
    // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2259-L2278
    require("node:dns").lookup(address, (err, ip, family) => {
      if (lookupListeningId !== server[kClusterListeningId]) return;
      if (err) {
        // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2268-L2269
        server.emit("error", err);
        return;
      }
      listenInCluster(
        server,
        ip,
        port,
        family === 6 ? 6 : 4,
        backlog,
        fd,
        exclusive,
        ipv6Only,
        reusePort,
        readableAll,
        writableAll,
        flags,
        path,
        hostname,
        tls,
        contexts,
      );
    });
    return;
  }

  if (isPrimary || exclusive) {
    server[kRealListen](
      path,
      port,
      hostname,
      exclusive,
      ipv6Only,
      reusePort,
      readableAll,
      writableAll,
      tls,
      contexts,
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
    readableAll,
    writableAll,
    sharedOnly: tls ? true : undefined,
  };
  const listeningId = (server[kClusterListeningId] = (server[kClusterListeningId] || 0) + 1);
  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2080-L2102
  cluster._getServer(server, serverQuery, function listenOnPrimaryHandle(err, handle, _reply) {
    if (listeningId !== server[kClusterListeningId]) {
      handle?.close();
      return;
    }
    err = checkBindError(err, port, handle);
    if (err) {
      const ex = new ExceptionWithHostPort(err, "bind", address, port);
      if (typeof _reply?.bunHint === "string") ex.message += `\n  note: ${_reply.bunHint}`;
      server.emit("error", ex);
      return;
    }
    const sharedFd = handle?.sharedFd;
    if (handle && typeof sharedFd === "number") {
      server[kClusterHandle] = handle;
      handle[kClusterOwner] = server;
      // The primary owns the socket file; the adopted fd only needs to report it from address().
      server[kClusterUnixPath] = path;
      try {
        // The reply is asynchronous: a setSecureContext() or addContext() made since listen() counts.
        if (tls) {
          tls = server[bunTlsSymbol](hostname)[0];
          contexts = tls.contexts;
        }
        server[kRealListen](
          undefined,
          port,
          hostname,
          exclusive,
          ipv6Only,
          reusePort,
          readableAll,
          writableAll,
          tls,
          contexts,
          sharedFd,
        );
        handle.adopted = true;
      } catch (err) {
        server[kClusterHandle] = null;
        server[kClusterUnixPath] = undefined;
        handle[kClusterOwner] = null;
        handle.close();
        process.nextTick(emitErrorNextTick, server, err);
      }
      return;
    }
    server[kClusterFauxListen](handle, backlog, path);
  });
}

const kClusterListeningId = Symbol("kClusterListeningId");
const kClusterHandle = Symbol("kClusterHandle");
const kClusterUnixPath = Symbol("kClusterUnixPath");
const kClusterFauxListen = Symbol("kClusterFauxListen");
const { kClusterOwner } = require("internal/shared");

Server.prototype[kClusterFauxListen] = function (handle, backlog, path) {
  this[kClusterHandle] = handle;
  this._handle = handle;
  if (path) {
    handle.unix = path;
  }
  handle.onconnection = onClusterConnection;
  handle[kClusterOwner] = this;
  handle.listen(backlog || 511);
  if (this._unref) this.unref();
  process.nextTick(emitListeningNextTick, this);
};

function onClusterConnection(err, clientHandle) {
  const self = this[kClusterOwner];
  if (!self || self[kClusterHandle] !== this) {
    clientHandle?.close();
    return;
  }
  if (err) {
    self.emit("error", new ErrnoException(err, "accept"));
    return;
  }
  if (self.maxConnections != null && self._connections >= self.maxConnections) {
    self.emit("drop");
    clientHandle.close();
    return;
  }
  const socket = new Socket({
    allowHalfOpen: self.allowHalfOpen,
    highWaterMark: self.highWaterMark,
  });
  socket.isServer = true;
  if (self.noDelay) socket[kSetNoDelay] = true;
  if (self.keepAlive) {
    socket[kSetKeepAlive] = true;
    socket[kSetKeepAliveInitialDelay] = self.keepAliveInitialDelay * 1000;
  }
  socket.connect({ fd: clientHandle.fd, fdIsRawSocket: true, pauseOnConnect: self.pauseOnConnect });
  const blockList = self.blockList;
  if (blockList) {
    const remote = socket.remoteAddress;
    const t = isIP(remote);
    if (t && blockList.check(remote, `ipv${t}`)) {
      // node's onconnection closes a blocked peer silently; 'drop' is for maxConnections only.
      socket.destroy();
      return;
    }
  }
  socket.server = self;
  socket._server = self;
  self._connections++;
  self.emit("connection", socket);
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
  // Bytes the onread callback declined belong to the previous connection.
  if (self[kOnreadTail] !== undefined) {
    self[kOnreadTail] = undefined;
    self[kOnreadPendingEnd] = false;
  }

  // Handle creation may be deferred to bind() or connect() time.
  const handle = self._handle;
  if (handle) {
    handle[owner_symbol] = self;
    // A fresh handle (e.g. an autoSelectFamily retry) inherits a prior unref()/pause().
    if (self[kUserUnrefed] || self[kPausedUnref]) handle.unref?.();
  }
}

// Node's handle.close(callback) takes a completion callback; userland code
// intercepts close on `socket._handle` and invokes it, so always pass one.
function onSocketHandleClosed() {}

function closeSocketHandle(self, handle, isException, isCleanupPending = false) {
  $debug("closeSocketHandle", isException, isCleanupPending);
  // Ahead of the setImmediate below: the transport's 'close' precedes this socket's.
  const transport = transportToDestroy(self);
  if (transport !== undefined) abortTransport(transport);
  // The owner of a wrapped socket destroyed it: the TLS socket goes first, so the close of their fd is nothing to report.
  handle[kAdoptedTLSRaw]?.destroy();
  handle.close(onSocketHandleClosed);
  // Arguments instead of a closure, so no scope keeps the closed handle alive.
  if (isCleanupPending) setImmediate(emitCloseAndDetachHandle, self, isException, handle);
  else setImmediate(emitClose, self, isException);
}

function emitClose(self, isException) {
  $debug("emit close");
  self.emit("close", isException);
}

function emitCloseAndDetachHandle(self, isException, handle) {
  emitClose(self, isException);
  // connect() may have replaced it since.
  if (self._handle === handle) detachSocket(self);
}

function checkBindError(err, port, handle) {
  // EADDRINUSE may not be reported until we call listen() or connect().
  // To complicate matters, a failed bind() followed by listen() or connect()
  // will implicitly bind to a random port. Ergo, check that the socket is
  // bound to the expected port before calling listen() or connect().
  if (err === 0 && port > 0 && handle.getsockname) {
    const out: { port?: number } = {};
    err = handle.getsockname(out);
    let outPort;
    if (err === 0 && port !== (outPort = out.port)) {
      $debug(`checkBindError, bound to ${outPort} instead of ${port}`);
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

Server.prototype[kArmHandshakeTimeout] = function (socket) {
  initAcceptedTLSSocket(this, socket);
};

Server.prototype[kSelectSNIContext] = function (servername, socketHandle, socket) {
  return serverName(this, servername, socketHandle, socket);
};

const netExports = {
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

  get BlockList() {
    return lazyBlockList();
  },
  set BlockList(value) {
    Object.defineProperty(netExports, "BlockList", { value, writable: true, enumerable: true, configurable: true });
  },
  get SocketAddress() {
    return (SocketAddress ??= $bindgen("SocketAddress.bind.ts", "SocketAddress"));
  },
  set SocketAddress(value) {
    Object.defineProperty(netExports, "SocketAddress", { value, writable: true, enumerable: true, configurable: true });
  },
  // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L2456
  Stream: Socket,
} as any as typeof import("node:net");
export default netExports;
