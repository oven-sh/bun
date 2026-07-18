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
const {
  ExceptionWithHostPort,
  ConnResetException,
  NodeAggregateError,
  ErrnoException,
  hasObserver,
  startPerf,
  stopPerf,
} = require("internal/shared");
import type { Socket, SocketHandler, SocketListener } from "bun";
import type { Server as NetServer, Socket as NetSocket, ServerOpts } from "node:net";
import type { TLSSocket } from "node:tls";
const { kTimeout, getTimerDuration } = require("internal/timers");
const { validateFunction, validateNumber, validateAbortSignal, validatePort, validateBoolean, validateInt32, validateString } = require("internal/validators"); // prettier-ignore
const { isIPv4, isIPv6, isIP } = require("internal/net/isIP");

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypePush = Array.prototype.push;
const MathMax = Math.max;

const { UV_ECANCELED, UV_ETIMEDOUT } = process.binding("uv");
const isWindows = process.platform === "win32";

const getDefaultAutoSelectFamily = $rust("node_net_binding.rs", "getDefaultAutoSelectFamily");
const setDefaultAutoSelectFamily = $rust("node_net_binding.rs", "setDefaultAutoSelectFamily");
const getDefaultAutoSelectFamilyAttemptTimeout = $rust("node_net_binding.rs", "getDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore
const setDefaultAutoSelectFamilyAttemptTimeout = $rust("node_net_binding.rs", "setDefaultAutoSelectFamilyAttemptTimeout"); // prettier-ignore

/**
 * `--tls-keylog=<file>`: every TLS socket appends its NSS key-log lines here,
 * the way Node's CLI option store seeds an implicit 'keylog' listener.
 */
let tlsKeylogPath: string | undefined;
let tlsKeylogWarned = false;
function appendTlsKeylog(line: Buffer) {
  if (!tlsKeylogWarned) {
    tlsKeylogWarned = true;
    process.emitWarning(
      "Using --tls-keylog makes TLS connections insecure by writing secret key material to file " + tlsKeylogPath,
    );
  }
  try {
    // The keylog contains TLS master secrets; create it owner-readable only.
    // The mode is only applied when the file is created.
    require("node:fs").appendFileSync(tlsKeylogPath, line, { mode: 0o600 });
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
const SocketAddress = $rust("node_net_binding.rs", "SocketAddress");
const BlockList = $rust("node_net_binding.rs", "BlockList");
const newDetachedSocket = $newRustFunction("node_net_binding.rs", "newDetachedSocket", 1);
const doConnect = $newRustFunction("node_net_binding.rs", "doConnect", 2);

const addServerName = $newRustFunction("Listener.rs", "jsAddServerName", 3);
const upgradeDuplexToTLS = $newRustFunction("runtime/socket/socket.rs", "jsUpgradeDuplexToTLS", 2);
// tls.connect({ socket }) upgrade: hostname policy stays with this JS layer.
const upgradeTLSDeferred = $newRustFunction("runtime/socket/socket.rs", "jsUpgradeTLSDeferred", 2);
const isNamedPipeSocket = $newRustFunction("runtime/socket/socket.rs", "jsIsNamedPipeSocket", 1);
const getBufferedAmount = $newRustFunction("runtime/socket/socket.rs", "jsGetBufferedAmount", 1);

const bunTlsSymbol = Symbol.for("::buntls::");
const bunSocketServerOptions = Symbol.for("::bunnetserveroptions::");
const owner_symbol = Symbol("owner_symbol");

const kServerSocket = Symbol("kServerSocket");
const kBytesWritten = Symbol("kBytesWritten");
const bunTLSConnectOptions = Symbol.for("::buntlsconnectoptions::");
// tls.Server exposes its native SecureContext constructor through this key so
// the SNI dispatch (below) can recognize a raw native context the way Node's
// `context.context || context` unwrap does - without net.ts needing its own
// binding to the constructor.
const kNativeSecureContextCtor = Symbol.for("::buntlsnativesecurecontextctor::");
const kReinitializeHandle = Symbol("kReinitializeHandle");

const kRealListen = Symbol("kRealListen");
const kSetNoDelay = Symbol("kSetNoDelay");
const kAdoptedFd = Symbol("kAdoptedFd");
const kSetTOS = Symbol("kSetTOS");
const kSetKeepAlive = Symbol("kSetKeepAlive");
const kSyncWriteFd = Symbol("kSyncWriteFd");
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
const kpendingSession = Symbol("pendingSession");
const kSNIError = Symbol("kSNIError");
const kALPNError = Symbol("kALPNError");
const kPerfHooksNetConnectContext = Symbol("kPerfHooksNetConnectContext");
const khandshakeTimer = Symbol("khandshakeTimer");
const kUserUnrefed = Symbol("kUserUnrefed");
// Set when pause() dropped the handle's hold on the loop, so the read paths
// only restore a hold they actually removed - re-refing a handle that never
// held the loop (a wrapped duplex with no fd) would pin the process.
const kPausedUnref = Symbol("kPausedUnref");
const kwriteCallback = Symbol("writeCallback");
const kSocketClass = Symbol("kSocketClass");

// A completed write whose status is a negative errno: Node hands it to the write
// callback as errnoException(status, 'write') and destroys the stream when no
// callback is pending. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L81-L92
function failWrite(self, negErrno, callback) {
  let er = new ErrnoException(negErrno, "write") as Error & { code?: string; errno?: number; syscall?: string };
  if (typeof er.code !== "string" || !/^E[A-Z0-9]+$/.test(er.code)) {
    // A raw WSA value the errno table cannot name (Windows delivers fatal
    // send errors this way): shape it like SocketEmitEndNT shapes reads,
    // keeping the original errno.
    er = new ConnResetException("write ECONNRESET") as Error & { code: string; errno?: number; syscall?: string };
    er.errno = negErrno;
    er.syscall = "write";
  }
  self._pendingData = null;
  self[kwriteCallback] = null;
  if (callback) {
    // Node delivers a failed write to BOTH the write callback and the socket:
    // onWriteComplete calls errorOrDestroy(self, ...) in addition to the
    // chained callback (lib/internal/stream_base_commons.js), so 'error' and
    // 'close' still fire even when every write had a callback. Only handing
    // the error to a callback that ignores it left the socket alive forever
    // (test-net-stream's server never observed its peer vanish).
    callback(er);
    if (!self.destroyed && !self._hadError) {
      // _hadError is the cross-path once-guard: the native error dispatch
      // (SocketHandlers.error) can deliver the same failure, and node emits
      // a socket error exactly once.
      self._hadError = true;
      self.destroy(er);
    }
  } else if (!self.destroyed) {
    if (self.listenerCount("error") > 0) {
      // The consumer can detach its listener between now and destroy()'s
      // deferred 'error' emission - the same last-resort guard
      // SocketEmitEndNT uses for read errors.
      self.once("error", () => {});
      self.destroy(er);
    } else {
      // No write callback and no 'error' listener: a failed flush on an
      // orphaned socket (an h2 teardown racing the peer's reset - routine on
      // Windows, where the reset completes the send first) is teardown noise.
      // Same silent-close policy as SocketEmitEndNT's no-listener case.
      self.destroy();
    }
  }
}
function endNT(socket, callback, err) {
  // Node's _final half-closes the writable side (sends FIN) and leaves the
  // readable side open; the Duplex's allowHalfOpen drives the eventual destroy.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/net.js#L500
  socket.shutdown();
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

/**
 * Build the Error for a handshake that failed before completing. A fatal SSL
 * protocol error (wrong version number, bad record, ...) carries the OpenSSL
 * error string in `verifyError.reason`; everything else is the peer
 * disconnecting mid-handshake, which Node reports as ECONNRESET.
 */
function tlsHandshakeError(verifyError) {
  const verifyErrorCode = verifyError ? verifyError.code : undefined;
  if (verifyErrorCode && verifyErrorCode !== "ECONNRESET") {
    const reason = verifyError.reason || verifyError.message || "TLS handshake failed";
    const err = new Error(reason) as Error & {
      code?: string;
      library?: string;
      function?: string;
      reason?: string;
    };
    // A fatal SSL-library error carries the full OpenSSL error string
    // ("error:0a00042e:SSL routines:OPENSSL_internal:TLSV1_ALERT_PROTOCOL_VERSION").
    // Decompose it into Node's library/function/reason properties and the
    // ERR_SSL_<REASON> code the way ThrowCryptoError does.
    const match = /^error:[0-9a-f]+:SSL routines:([^:]*):(.+)$/.exec(reason);
    if (match) {
      err.library = "SSL routines";
      err.function = match[1];
      err.reason = match[2];
      err.code = `ERR_SSL_${match[2]}`;
    } else {
      err.code = verifyErrorCode;
    }
    return err;
  }
  return new ConnResetException("socket hang up");
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

    self._unrefTimer();
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
      const res = socket.$write(writeChunk || "", self._pendingEncoding || "utf8");
      if (res < 0) {
        // The retried send failed for good (peer gone): $write returned -errno.
        failWrite(self, res, callback);
      } else if (res) {
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
  // A new resumable TLS session arrived (the peer's NewSessionTicket was just
  // processed). Mirrors Node's onnewsessionclient: emit once the handshake has
  // been verified, otherwise park it and emit from the handshake handler.
  session(socket, session) {
    const self = socket.data;
    if (!self) return;
    if (self._secureEstablished) {
      self.emit("session", session);
    } else {
      self[kpendingSession] = session;
    }
  },
  keylog(socket, line) {
    const self = socket.data;
    if (!self) return;
    self.emit("keylog", line);
    if (tlsKeylogPath !== undefined) appendTlsKeylog(line);
    self.server?.emit?.("keylog", line, self);
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
    const selfTimeout = self.timeout;
    if (selfTimeout) {
      self.setTimeout(selfTimeout);
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

    // A TOS value set before the connection existed (setTypeOfService before
    // connect) is applied to the live handle now.
    let handle;
    if (self[kSetTOS] !== undefined && (handle = self._handle)?.setTypeOfService) {
      handle.setTypeOfService(self[kSetTOS]);
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
    // The second argument is "authorized" (handshake + verification +
    // hostname), matching the public Bun.connect handshake callback. node:tls
    // decides what to do with verification results in JS via the
    // rejectUnauthorized / checkServerIdentity handling below, so a
    // verification-class result (an X509 code such as
    // UNABLE_TO_VERIFY_LEAF_SIGNATURE, or the native hostname verdict) still
    // means the TLS session itself was established. Only a fatal TLS protocol
    // failure tears the socket down here: those arrive as EPROTO carrying the
    // OpenSSL "error:...:SSL routines:..." reason (or an already decomposed
    // ERR_SSL_* / ERR_OSSL_* code).
    const isProtocolFailure =
      !success &&
      verifyError?.code != null &&
      (verifyError.code === "EPROTO" || /^ERR_(SSL|OSSL)_/.test(verifyError.code));
    if (isProtocolFailure) {
      // Surface the OpenSSL reason instead of letting the close path report a
      // generic disconnect.
      self.destroy(tlsHandshakeError(verifyError));
      return;
    }

    self._securePending = false;
    self.secureConnecting = false;
    // ECONNRESET and protocol-level failures returned above, so reaching here
    // means the TLS session itself was established - even when `success`
    // (authorized) is false purely because of the native hostname verdict,
    // which arrives with no error object.
    self._secureEstablished = true;

    self.emit("secure", self);
    self.alpnProtocol = socket.alpnProtocol;
    const { checkServerIdentity } = self[bunTLSConnectOptions];
    if (!verifyError && typeof checkServerIdentity === "function") {
      const hostname = self.servername || self._host || "localhost";
      const cert = self.getPeerCertificate(true);
      if (cert) {
        verifyError = checkServerIdentity(hostname, cert);
      }
    }
    let rejectUnauthorized;
    if (self._requestCert || (rejectUnauthorized = self._rejectUnauthorized)) {
      if (verifyError) {
        self.authorized = false;
        self.authorizationError = verifyError.code || verifyError.message;
        if (rejectUnauthorized ?? self._rejectUnauthorized) {
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
    // For TLS 1.2 the NewSessionTicket is part of the handshake, so the
    // new-session callback fired before the handshake completed and the
    // session was parked; deliver it now that 'secureConnect' has been
    // emitted, the way Node flushes its kPendingSession.
    const pendingSession = self[kpendingSession];
    if (pendingSession) {
      self[kpendingSession] = null;
      self.emit("session", pendingSession);
    }
  },
  timeout(socket) {
    const self = socket.data;
    if (!self) return;

    self.emit("timeout", self);
  },
  binaryType: "buffer",
} as const;

function SocketEmitEndNT(self, _err?) {
  // A read error delivered with the close (e.g. a received RST surfacing as
  // ECONNRESET) is not a clean EOF — Node destroys the socket with the error
  // ("read ECONNRESET") instead of emitting a graceful 'end'. Guard on
  // !destroyed so an already-torn-down socket isn't re-destroyed, and on an
  // 'error' listener so callers that opted into error handling get Node's
  // behavior while those that did not keep the previous silent EOF (a server
  // hard-closing after a clean response would otherwise surface here as an
  // unhandled error across the proxy/http2/fetch suites under ASAN/baseline
  // timing).
  // A reset that lands after the exchange already finished in BOTH
  // directions (clean EOF delivered and nothing left being written) is
  // teardown noise - a peer hard-closing once the exchange completed - not
  // data loss; Node would have destroyed the socket on 'end' for these
  // non-keepalive flows before the RST could ever be observed. Surfacing it
  // produced unhandled errors between tests across the fetch/http2 suites on
  // Windows, where loopback RSTs at teardown are routine. A reset while the
  // socket is still writing (the peer aborted mid-transfer) is real and is
  // surfaced (test-net-error-twice).
  // writableFinished (everything actually flushed) - NOT writableEnded (end()
  // merely called): a peer reset while queued data is still unflushed is the
  // peer aborting mid-transfer and must surface (test-net-error-twice).
  const teardownNoise = self[kended] && self.writableFinished;
  // _hadError: the failure already reached JS through the error dispatch
  // (native on_error / a fatal write); node emits a socket error exactly
  // once, so the close that follows it is delivered plain.
  if (_err && !self.destroyed && !self._hadError && !teardownNoise && self.listenerCount("error") > 0) {
    // The consumer can detach its 'error' listener between this close
    // callback and destroy()'s deferred 'error' emission (a request that
    // finished just as the reset arrived); a last-resort no-op listener keeps
    // that race from surfacing as an uncaught exception - the no-listener
    // case is already a documented silent close.
    self.once("error", () => {});
    let errErrno;
    if (_err.code === undefined && typeof (errErrno = _err.errno) === "number" && errErrno !== 0) {
      // A codeless close error that still carries the errno (Windows IOCP
      // delivers some this way): derive the proper code from it, like Node's
      // errnoException(nread, 'read'). Raw WSA values (-10054, ...) that the
      // errno table cannot name fall through to the reset shape below instead
      // of surfacing "Unknown system error N".
      const er = new ErrnoException(errErrno, "read") as Error & { code?: string };
      if (typeof er.code === "string" && /^E[A-Z0-9]+$/.test(er.code)) {
        self.destroy(er);
        return;
      }
    }
    if (_err.code === undefined || _err.code === "ECONNRESET") {
      // Shape a reset (or a fully bare close error) like Node's
      // errnoException(UV_ECONNRESET, 'read').
      const er = new ConnResetException("read ECONNRESET") as Error & {
        code: string;
        errno?: number;
        syscall?: string;
      };
      er.errno = _err.errno ?? (process.platform === "win32" ? -4077 : process.platform === "linux" ? -104 : -54);
      er.syscall = "read";
      self.destroy(er);
    } else {
      // Any other coded error (ETIMEDOUT, EPIPE, ...) keeps its identity.
      self.destroy(_err);
    }
    return;
  }
  if (!self[kended]) {
    if (!self.allowHalfOpen) {
      self.write = writeAfterFIN;
    }
    self[kended] = true;
    self.push(null);
    self.read(0);
  } else if (_err && !self.destroyed) {
    // An error excluded from the synthesis above (teardown noise, or no
    // listener attached): nothing more is coming, but the socket still has to
    // finish its lifecycle - close it quietly instead of leaving it open with
    // no further events.
    self.destroy();
  }
  // A write that was waiting on the native drain can never complete once the
  // socket is gone - fail it so 'finish'/destroy are not stuck behind it.
  const pendingWrite = self[kwriteCallback];
  if (pendingWrite && (self.destroyed || _err)) {
    self[kwriteCallback] = null;
    pendingWrite(_err ?? $ERR_SOCKET_CLOSED());
  }
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
// and a raw native context are accepted, null/undefined falls through to the
// default context, and anything else is an invalid SNI context that drops the
// connection before the handshake completes.
function consumeSNIResult(state, err, context) {
  if (err) {
    state.failed = toSNIError(err);
    return;
  }
  if (context == null) return;
  const innerContext = typeof context === "object" ? context.context : undefined;
  if (innerContext) {
    state.selected = innerContext;
  } else if (state.server?.[kNativeSecureContextCtor] && context instanceof state.server[kNativeSecureContextCtor]) {
    state.selected = context;
  } else {
    state.failed = new Error("Invalid SNI context");
  }
}

// Stash per-connection (socketHandle.data is this connection's TLSSocket):
// with concurrent handshakes a per-server stash could hand one connection's
// error to another's failure handler. The server is the legacy fallback when
// no handle was available at dispatch time.
function stashSNIError(state) {
  const target = state.socketHandle?.data ?? state.server;
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

const ServerHandlers: SocketHandler<NetSocket> = {
  data(socket, buffer) {
    const { data: self } = socket;
    if (!self) return;

    self._unrefTimer();
    self.bytesRead += buffer.length;
    if (!self.push(buffer)) {
      socket.pause();
    }
  },
  keylog(socket, line) {
    const { data: self } = socket;
    if (!self) return;
    self.emit("keylog", line);
    if (tlsKeylogPath !== undefined) appendTlsKeylog(line);
    self.server?.emit?.("keylog", line, self);
  },
  alpnCallback(socket, servername, protocolsWire) {
    // Returns false when this server has no ALPNCallback (the native side
    // falls through to the static ALPNProtocols list), the selected protocol
    // string, or undefined to refuse the connection - Node's contract.
    const self = socket.data;
    const server = self?.server ?? self;
    const cb = server?._ALPNCallback;
    if (typeof cb !== "function") return false;
    const wire = Buffer.isBuffer(protocolsWire) ? protocolsWire : Buffer.from(protocolsWire);
    const protocols = [];
    for (let i = 0; i + 1 <= wire.length; ) {
      const n = wire[i];
      protocols.push(wire.toString("latin1", i + 1, i + 1 + n));
      i += 1 + n;
    }
    let result;
    try {
      result = cb.$call(self, { servername, protocols });
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
  serverName(server, servername, socketHandle) {
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
    // tls.Server) and the accepted connection's handle.
    const cb = server?._SNICallback;
    if (typeof cb !== "function" || !servername) return undefined;
    const state = {
      server,
      socketHandle,
      selected: undefined,
      failed: undefined,
      settled: false,
      suspended: false,
    };
    try {
      cb.$call(server, servername, onSNIResolution.bind(null, state));
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
    if (!self) return;
    // Dispatch through the listener handle's onconnection hook so user code
    // (and node:cluster RoundRobinHandle) can intercept accepted sockets the
    // same way Node.js exposes TCP/Pipe wrap onconnection.
    // For a standalone server-side wrap (new TLSSocket(duplex, { isServer })),
    // `self` is the wrapping socket - not a Server - and its handle has no
    // onconnection; throwing here would tear the brand-new TLS engine down
    // before the ClientHello ever arrives.
    const handle = self._handle || socket.listener;
    if (handle && typeof handle.onconnection === "function") {
      handle.onconnection(0, socket);
    }
  },
  handshake(socket, success, verifyError) {
    const self = socket.data;
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
      if (self._hadError || (alreadyDestroyed = self.destroyed)) {
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
        err = tlsHandshakeError(verifyError);
      }
      self.emit("_tlsError", err);
      server?.emit("tlsClientError", err, self);
      self._hadError = true;
      // error before handshake on the server side will only be emitted using tlsClientError
      self.destroy();
      return;
    }
    self._securePending = false;
    self.secureConnecting = false;
    self._secureEstablished = !!success;
    self.servername = socket.getServername();
    self.alpnProtocol = socket.alpnProtocol;
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
          server?.emit("tlsClientError", verifyError, self);
          // if we reject we still need to emit secure
          self.emit("secure", self);
          // No error argument: the socket has no 'error' listener yet, so destroy(err)
          // would surface as an uncaught exception.
          self.destroy();
          return;
        }
      } else {
        self.authorized = true;
      }
    }
    if (server) {
      const connectionListener = server[bunSocketServerOptions]?.connectionListener;
      if (typeof connectionListener === "function") {
        server.prependOnceListener("secureConnection", connectionListener);
      }
      server.emit("secureConnection", self);
    }
    // after secureConnection event we emmit secure and secureConnect
    self.emit("secure", self);
    self.emit("secureConnect", verifyError);
    if (server?.pauseOnConnect) {
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
      SocketHandlers.error(socket, error, true);
      this.server?.emit("clientError", error, data);
      return;
    }
    // Plain TCP: the delegation above is a no-op (_hadError was just set and
    // SocketHandlers.error's guard returns on it). On kqueue a fatal-flush
    // from on_writable is the only place the errno is visible (the close it
    // issues short-circuits the read dispatch at loop.c's
    // us_socket_is_closed check), so swallowing it hung the server behind an
    // un-failed pending write (test-net-stream on darwin). Shape it like
    // Node's onWriteComplete: fail the pending write callback, then destroy
    // with the error. destroy() owns the single 'error' emission via the
    // stream's errorEmitted guard; callback(error) may have already
    // destroyed, in which case this is a no-op.
    const callback = data[kwriteCallback];
    if (callback) {
      data[kwriteCallback] = null;
      callback(error);
    }
    if (!data.destroyed) {
      data.destroy(error);
    }
  },
  timeout(socket) {
    SocketHandlers.timeout(socket);
  },
  drain(socket) {
    SocketHandlers.drain(socket);
  },
  binaryType: "buffer",
} as const;

// Node.js-compatible onconnection: assigned to server._handle.onconnection in
// kRealListen and invoked from ServerHandlers.open with `this` bound to the
// listener handle. Kept as a standalone function so tests/cluster can wrap it.
function onconnection(err, clientHandle) {
  const handle = this;
  const self = handle[owner_symbol] as NetServer;
  if (err) {
    self.emit("error", err);
    return;
  }
  clientHandle[kServerSocket] = handle;
  const options = self[bunSocketServerOptions];
  const { pauseOnConnect, connectionListener, [kSocketClass]: SClass, requestCert, rejectUnauthorized } = options;
  // Propagate the server's half-open/highWaterMark settings to the accepted
  // socket so the Duplex's allowHalfOpen matches what the native layer was
  // configured with in kRealListen; without this, net.createServer({
  // allowHalfOpen: true }) would be ignored on accepted connections.
  // Matches Node's onconnection:
  // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L2349
  const _socket = new SClass({
    allowHalfOpen: self.allowHalfOpen,
    highWaterMark: self.highWaterMark,
  }) as NetSocket | TLSSocket;
  _socket.isServer = true;
  _socket._requestCert = requestCert;
  // The raw options object only has rejectUnauthorized when the user passed it explicitly;
  // fall back to the server's normalized value (defaults to true for tls.Server).
  _socket._rejectUnauthorized = rejectUnauthorized ?? self._rejectUnauthorized;

  _socket[kAttach](clientHandle.localPort, clientHandle);

  const blockList = self.blockList;
  if (blockList) {
    const addressType = isIP(clientHandle.remoteAddress);
    if (addressType && blockList.check(clientHandle.remoteAddress, `ipv${addressType}`)) {
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
    _socket[kSetKeepAliveInitialDelay] = self.keepAliveInitialDelay;
    clientHandle.setKeepAlive(true, self.keepAliveInitialDelay);
  }

  self._connections++;
  _socket.server = self;
  _socket._server = self;

  if (pauseOnConnect) {
    _socket.pause();
  }

  if (typeof connectionListener === "function") {
    clientHandle.pauseOnConnect = pauseOnConnect;
    if (!isTLS) {
      self.prependOnceListener("connection", connectionListener);
    }
  }
  // A client that never completes the TLS handshake must not hold the
  // accepted socket open forever: report it through tlsClientError after
  // handshakeTimeout the way Node does. The timer is cleared when the
  // handshake settles (either way) or the socket closes first.
  let handshakeTimeout;
  if (isTLS && (handshakeTimeout = self._handshakeTimeout) > 0) {
    const timer = setTimeout(() => {
      _socket[khandshakeTimer] = undefined;
      const err = $ERR_TLS_HANDSHAKE_TIMEOUT();
      _socket._hadError = true;
      self.emit("tlsClientError", err, _socket);
      if (!_socket.destroyed) _socket.destroy();
    }, handshakeTimeout);
    // Node's handshake timer is unref'd: a fully-unref'd server (the
    // graceful-shutdown pattern) must not be held open by a client that
    // stalls mid-handshake.
    timer.unref?.();
    _socket[khandshakeTimer] = timer;
    _socket.once("close", () => {
      if (_socket[khandshakeTimer]) {
        clearTimeout(_socket[khandshakeTimer]);
        _socket[khandshakeTimer] = undefined;
      }
    });
  }

  self.emit("connection", _socket);
  // the duplex implementation start paused, so we resume when pauseOnConnect is falsy
  if (!pauseOnConnect && !isTLS) {
    _socket.resume();
  }
}

// TODO: SocketHandlers2 is a bad name but its temporary. reworking the Server in a followup PR
const SocketHandlers2: SocketHandler<NonNullable<import("node:net").Socket["_handle"]>["data"]> = {
  open(socket) {
    $debug("Bun.Socket open");
    let { self, req } = socket.data;
    socket[owner_symbol] = self;
    $debug("self[kupgraded]", String(self[kupgraded]));
    // Offer a previously-negotiated session for resumption before oncomplete
    // (afterConnect) runs: a user 'connect' listener that writes immediately
    // would otherwise send the ClientHello before SSL_set_session runs and
    // silently skip resumption.
    {
      const options = self[bunTLSConnectOptions];
      if (options) {
        const { session } = options;
        if (session) {
          self.setSession(session);
        }
      }
    }
    if (!self[kupgraded]) req!.oncomplete(0, self._handle, req, true, true);
    socket.data.req = undefined;
    if (self.pauseOnConnect) {
      self.pause();
    }
    if (self[kupgraded]) {
      self.connecting = false;
      SocketHandlers2.drain!(socket);
    }
  },
  data(socket, buffer) {
    $debug("Bun.Socket data");
    const { self } = socket.data;
    self._unrefTimer();
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
      const res = socket.$write(writeChunk || "", self._pendingEncoding || "utf8");
      if (res < 0) {
        // The retried send failed for good (peer gone): $write returned -errno.
        self[kBytesWritten] = socket.bytesWritten;
        failWrite(self, res, callback);
      } else if (res) {
        self[kBytesWritten] = socket.bytesWritten;
        self._pendingData = self[kwriteCallback] = null;
        // The buffered write drained: if end() already unref'd (peer FIN) and _write
        // re-ref'd for this pending flush, drop the ref again now nothing is in flight.
        if (self[kended] && !self[kUserUnrefed] && socket === self._handle) socket.unref?.();
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
    // The peer's FIN means kernel reads are over for good. In libuv a stream handle only holds
    // the loop while reading or with a write in flight, so node lets the process exit even if
    // the (half-open) writable side stays open and the readable side was never consumed. Mirror
    // that: drop this handle's hold on the loop unless a write is still waiting on drain, and
    // forget any pause()-time unref so a later read()/resume() does not pin the loop again.
    // A subsequent buffered write re-refs (see _write) so its callback can still fire.
    if (socket === self._handle && !self[kwriteCallback]) {
      socket.unref?.();
      self[kPausedUnref] = false;
    }
  },
  // See SocketHandlers.session.
  session(socket, session) {
    const { self } = socket.data;
    if (!self) return;
    if (self._secureEstablished) {
      self.emit("session", session);
    } else {
      self[kpendingSession] = session;
    }
  },
  keylog(socket, line) {
    const { self } = socket.data;
    if (!self) return;
    self.emit("keylog", line);
    if (tlsKeylogPath !== undefined) appendTlsKeylog(line);
  },
  close(socket, err) {
    $debug("Bun.Socket close");
    let { self } = socket.data;
    if (err) $debug(err);
    if (self[kclosed]) return;
    self[kclosed] = true;
    // A received RST surfacing as ECONNRESET with the close is not a clean
    // EOF - Node destroys the socket with "read ECONNRESET" instead of a
    // graceful 'end'. Only surface it when the closing handle is still the
    // socket's current handle: connection attempts that lost the
    // family-autoselection race and raw sockets handed off during a TLS
    // upgrade also report errors on close, and those must keep ending
    // cleanly.
    if (err && !self.destroyed && socket === self._handle && self.listenerCount("error") > 0) {
      // Same late-detach guard as SocketEmitEndNT: the listener seen at
      // close-time can be gone by the deferred 'error' emission.
      self.once("error", () => {});
      if (err.code === undefined || err.code === "ECONNRESET") {
        // Shape it like Node's errnoException(UV_ECONNRESET, 'read').
        const er = new ConnResetException("read ECONNRESET") as Error & { errno?: number; syscall?: string };
        er.errno = err.errno;
        er.syscall = "read";
        self.destroy(er);
      } else {
        // Any other recv errno (ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, ...)
        // keeps its identity — Node's onStreamRead does
        // `stream.destroy(errnoException(nread, 'read'))` for any nread that
        // is not UV_EOF. The native on_close only passes a non-undefined err
        // when the close was driven by a recv() failure (libus close-code
        // enum values are filtered out in NewSocket::on_close).
        self.destroy(err);
      }
      return;
    }
    self[kended] = true;
    if (!self.allowHalfOpen) self.write = writeAfterFIN;
    self.push(null);
    self.read(0);
    // A write that was waiting on the native drain can never complete once the
    // socket is gone - fail it so 'finish'/destroy are not stuck behind it
    // (mirrors SocketEmitEndNT).
    const pendingWrite = self[kwriteCallback];
    if (pendingWrite) {
      self[kwriteCallback] = null;
      pendingWrite($ERR_SOCKET_CLOSED());
    }
  },
  handshake(socket, success, verifyError) {
    $debug("Bun.Socket handshake");
    const { self } = socket.data;
    if (!success && verifyError?.code === "ECONNRESET") {
      // will be handled in onConnectEnd
      return;
    }
    // The second argument is "authorized" (handshake + verification +
    // hostname), matching the public Bun.connect handshake callback. node:tls
    // decides what to do with verification results in JS via the
    // rejectUnauthorized / checkServerIdentity handling below, so a
    // verification-class result (an X509 code such as
    // UNABLE_TO_VERIFY_LEAF_SIGNATURE, or the native hostname verdict) still
    // means the TLS session itself was established. Only a fatal TLS protocol
    // failure tears the socket down here: those arrive as EPROTO carrying the
    // OpenSSL "error:...:SSL routines:..." reason (or an already decomposed
    // ERR_SSL_* / ERR_OSSL_* code).
    const isProtocolFailure =
      !success &&
      verifyError?.code != null &&
      (verifyError.code === "EPROTO" || /^ERR_(SSL|OSSL)_/.test(verifyError.code));
    if (isProtocolFailure) {
      // Surface the OpenSSL reason instead of letting the close path report a
      // generic disconnect.
      self.destroy(tlsHandshakeError(verifyError));
      return;
    }

    self._securePending = false;
    self.secureConnecting = false;
    // ECONNRESET and protocol-level failures returned above, so reaching here
    // means the TLS session itself was established - even when `success`
    // (authorized) is false purely because of the native hostname verdict,
    // which arrives with no error object.
    self._secureEstablished = true;

    self.emit("secure", self);
    self.alpnProtocol = socket.alpnProtocol;
    const { checkServerIdentity } = self[bunTLSConnectOptions];
    if (!verifyError && typeof checkServerIdentity === "function") {
      const hostname = self.servername || self._host || "localhost";
      const cert = self.getPeerCertificate(true);
      if (cert) {
        verifyError = checkServerIdentity(hostname, cert);
      }
    }
    let rejectUnauthorized;
    if (self._requestCert || (rejectUnauthorized = self._rejectUnauthorized)) {
      if (verifyError) {
        self.authorized = false;
        self.authorizationError = verifyError.code || verifyError.message;
        if (rejectUnauthorized ?? self._rejectUnauthorized) {
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
    // For TLS 1.2 the NewSessionTicket is part of the handshake, so the
    // new-session callback fired before the handshake completed and the
    // session was parked; deliver it now that 'secureConnect' has been
    // emitted, the way Node flushes its kPendingSession.
    const pendingSession = self[kpendingSession];
    if (pendingSession) {
      self[kpendingSession] = null;
      self.emit("session", pendingSession);
    }
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
    socket.data.req = undefined;
    // doConnect dispatches this synchronously when connect()/bind() fails at
    // the syscall; surface it as kConnectTcp/Pipe's return value (callers'
    // Node-derived `if (err)` expects that) instead of re-entering oncomplete.
    if (req!.dispatching) {
      req.errno = error.errno || UV_ECANCELED;
      return;
    }
    req!.oncomplete(error.errno, self._handle, req, true, true);
  },
};

// The same table minus the per-connection callback members: a listener whose
// config has neither handler never registers the native SNI/ALPN dispatches,
// so a server without an SNICallback or ALPNCallback does not pay a JS
// round-trip from inside the handshake for them.
const { serverName: _serverNameHandler, alpnCallback: _alpnCallbackHandler, ...ServerHandlersNoSNI } = ServerHandlers;
// Partial tables so a server with exactly one of the callbacks only registers
// that dispatch (the other would be a per-handshake JS round-trip that always
// falls through).
const { serverName: _snOnly, ...ServerHandlersALPNOnly } = ServerHandlers;
const { alpnCallback: _acOnly, ...ServerHandlersSNIOnly } = ServerHandlers;

/** The handler table for a listen config: the full table only when a
 *  per-connection callback is configured, so other servers never pay a JS
 *  round-trip from inside the handshake. */
function serverHandlersFor(server) {
  const sni = !!server._SNICallback;
  const alpn = !!server._ALPNCallback;
  if (sni && alpn) return ServerHandlers;
  if (sni) return ServerHandlersSNIOnly;
  if (alpn) return ServerHandlersALPNOnly;
  return ServerHandlersNoSNI;
}

// node.net.native trace events: one 'b'/'e' pair per connect *attempt*, including
// failed ones. 'b' fires where the attempt is issued; the per-req flag dedupes the
// 'e' across the afterConnect(Multiple) / rejected-promise / attempt-timeout paths.
const kNetTraceCat = "node,node.net,node.net.native";
const kTraceConnectActive = Symbol("kTraceConnectActive");
let traceEvents = null;
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
    data: { self, req },
    socket: self[khandlers],
  });
}

function kConnectPipe(self, req, address) {
  $debug("SocketHandle.kConnectPipe");
  return kConnectDispatch(self, req, {
    hostname: address,
    unix: address,
    // Always half-open natively; see kConnect.
    allowHalfOpen: true,
    tls: req.tls,
    data: { self, req },
    socket: self[khandlers],
  });
}

function kConnectDispatch(self, req, opts) {
  // Node's TCPWrap returns errno for sync uv_*_connect failure and defers
  // oncomplete; doConnect instead fires connectError inside this call. Bracket
  // it so connectError hands the errno back here instead of re-entering.
  req.dispatching = true;
  const promise = doConnect(self._handle, opts);
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
  // Bun's native _handle.setKeepAlive takes milliseconds (it is the public
  // Bun.Socket), so store ms here. Node stores seconds because libuv does.
  this[kSetKeepAliveInitialDelay] = MathMax(0, ~~keepAliveInitialDelay);

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
  // node initializes the timer slot to null so it is observable before setTimeout() is called.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L401
  this[kTimeout] = null;
  this[kwriteCallback] = undefined;
  this._pendingData = undefined;
  this._pendingEncoding = undefined; // for compatibility
  this._hadError = false;
  this.isServer = false;
  this._handle = options?.handle || null;
  this[ksocket] = undefined;
  this.server = undefined;
  this.pauseOnConnect = false;
  this._peername = null;
  this._sockname = null;
  this._closeAfterHandlingError = false;

  // Shut down the socket when we're finished with it.
  this.on("end", onSocketEnd);

  // -1 = do not adopt; otherwise the validated fd to attach at the end of the ctor.
  let adoptFd = -1;
  if (options?.fd !== undefined) {
    const { fd } = options;
    validateInt32(fd, "fd", 0);
    // Adopt pipe/character-device/file fds with synchronous writes. Matches
    // node's effective semantics for stdio-style sockets: writes to a pipe
    // complete inline, so data survives an immediate process.exit().
    // Gated on an explicit `writable: true` (how node's own stdio wraps fds,
    // e.g. new Socket({ fd: 2, readable: false, writable: true })): a bare
    // { fd } is the connect({ fd }) path (child_process extra stdio), which
    // attaches a native duplex handle in Socket.prototype.connect - adopting
    // here would end its readable side and stomp its write path.
    // Network-socket fds are not supported (handle adoption needs native
    // support); those keep the previous validated-but-inert behavior.
    if (options.writable === true) {
      let stats;
      try {
        stats = require("node:fs").fstatSync(fd);
      } catch {
        // Node: createHandle -> uv_guess_handle returns UV_UNKNOWN_HANDLE
        // for an fd it cannot fstat, then throws ERR_INVALID_FD_TYPE.
        throw $ERR_INVALID_FD_TYPE("UNKNOWN");
      }
      // isSocket() covers stdio handed to a child as a socketpair (how spawn
      // implements pipes on unix); writable-only adoption with sync write(2)
      // is correct there too.
      const optionsReadable = options.readable;
      if (
        stats.isFIFO() ||
        stats.isCharacterDevice() ||
        stats.isFile() ||
        (stats.isSocket() && optionsReadable !== true)
      ) {
        this[kSyncWriteFd] = fd;
        this._write = fdSyncWrite;
        this._writev = fdSyncWritev;
        if (optionsReadable !== true) {
          this.push(null);
          this.read(0);
        }
      }
    } else if (options.readable === undefined && options.writable === undefined && fd > 0) {
      // Bare `new net.Socket({ fd })`: node's constructor adopts the fd right
      // away (createHandle + read start), so the socket is live without the
      // caller having to call connect(). This is how a child reads an extra
      // stdio pipe it inherited, e.g. `new net.Socket({ fd: 4 })`.
      //
      // Only pipes and sockets are adopted. An fd we cannot fstat, or one that
      // is a file/tty, keeps the previous construct-but-stay-inert behavior:
      // routing those through connect() surfaces a misleading ECONNREFUSED
      // rather than node's ERR_INVALID_FD_TYPE, and turning a previously
      // silent construction into a throw is a bigger behavior change than the
      // gap being fixed. fd 0 is excluded for the same non-regression reason:
      // connect()'s fd handling (and the native listener's `get_truthy("fd")`)
      // both test the fd for truthiness, so adopting 0 here would fall through
      // to the host/port path and throw ERR_MISSING_ARGS.
      let stats;
      try {
        stats = require("node:fs").fstatSync(fd);
      } catch {
        stats = undefined;
      }
      // Record the fd and adopt at the very end of the constructor, not here:
      // attaching a native handle before the remaining option validation would
      // leak the fd (and the handle) if a later check throws.
      // Note the `onread` option is still not honored for an adopted fd -
      // connect()'s fd branch attaches the module-level SocketHandlers rather
      // than this[khandlers]. That gap predates this branch (a bare { fd } used
      // to attach nothing at all), so it is left alone here.
      if (stats !== undefined && (stats.isFIFO() || stats.isSocket())) adoptFd = fd;
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
    // when the onread option is specified we use a different handlers object
    this[khandlers] = {
      ...SocketHandlers2,
      data(socket, buffer) {
        const { self } = socket.data;
        if (!self) return;
        self._unrefTimer();
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
    if (!BlockList.isBlockList(optsBlockList)) {
      throw $ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", optsBlockList);
    }
    this.blockList = optsBlockList;
  }

  // Attach the inherited fd only once every option has been validated: an
  // attach before the `signal`/`onread`/`blockList` checks would leak the fd
  // (and its native handle) if one of them threw. kAdoptedFd stops a following
  // createConnection()-style connect() from attaching the same fd twice.
  //
  // `adoptFd` carries the fd validated above rather than re-reading
  // `options.fd`, so an options object with an `fd` getter cannot return a
  // different descriptor than the one validateInt32/fstatSync approved.
  // pauseOnConnect is passed explicitly because connect() assigns it
  // unconditionally and would otherwise reset it to undefined.
  if (adoptFd !== -1) {
    Socket.prototype.connect.$call(this, { fd: adoptFd, pauseOnConnect: this.pauseOnConnect });
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
  const timeout = this.timeout;
  if (timeout) {
    this.setTimeout(timeout);
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
    // A fd already adopted by the constructor is skipped here: createConnection()
    // constructs the Socket and then calls connect() with the same options, and
    // attaching the same fd twice would leak the first handle.
    if (fd && this[kAdoptedFd] !== fd) {
      this[kAdoptedFd] = fd;
      doConnect(this._handle, {
        data: this,
        fd: fd,
        ...(options.fdIsRawSocket === true ? { fdIsRawSocket: true } : {}),
        socket: SocketHandlers,
        // Always half-open natively; see kConnect.
        allowHalfOpen: true,
      }).catch(error => {
        // The attach failed, so nothing owns this fd now. Drop the sentinel or a
        // retry with the same fd would be silently skipped by the guard above.
        this[kAdoptedFd] = undefined;
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
        // Honor pause()/resume() calls made while connecting — only start
        // reading if the user hasn't explicitly paused the stream. Matches
        // Node's afterConnect, which calls socket.read(0) only when not paused:
        // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L1649
        // read(0) starts the handle reading without switching the stream into
        // flowing mode, so data that arrives before a 'data' listener is
        // attached stays buffered instead of being emitted to nobody.
        if (!this.isPaused()) this.read(0);
      });
      if (!fd) this.connecting = true;
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
        if (checkServerIdentity !== undefined) {
          validateFunction(checkServerIdentity, "options.checkServerIdentity");
        }
        tls.checkServerIdentity = checkServerIdentity || tls.checkServerIdentity;
        this[bunTLSConnectOptions] = tls;
        let tlsSocket;
        if (!connection && (tlsSocket = tls.socket)) {
          connection = tlsSocket;
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
      // A generic duplex transport is already established, so this socket is
      // not "connecting" - only the TLS layer is pending, which
      // secureConnecting tracks. Node reports false here. A provided
      // net.Socket keeps its existing accounting (its own connect lifecycle
      // drives this flag).
      if (!(connection instanceof Socket)) {
        this.connecting = false;
      }
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
          // upgradeTLS requires an established socket; a socket that is still
          // connecting (e.g. tls.connect({ socket: net.connect(port) })) must be
          // upgraded once it emits 'connect'.
          if (socket && !connection.connecting) {
            this[kupgraded] = connection;
            const result = upgradeTLSDeferred(socket, {
              data: { self: this, req: { oncomplete: afterConnect } },
              tls,
              socket: this[khandlers],
              isServer: false,
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
              // The TLS socket may have been destroyed before the underlying
              // socket connected (e.g. tls.connect({ socket }).destroy()); don't
              // start a handshake on a dead socket.
              if (this.destroyed) {
                connection.destroy();
                return;
              }
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
                const result = upgradeTLSDeferred(socket, {
                  data: { self: this, req: { oncomplete: afterConnect } },
                  tls,
                  socket: this[khandlers],
                  isServer: false,
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
  // Release the adopted-fd sentinel: the handle is going away, so a later
  // connect() with the same fd number must attach again rather than be
  // mistaken for the constructor's adoption.
  this[kAdoptedFd] = undefined;
  // Tear down a wrapped generic duplex with this socket: the native handle's
  // close only flushes close_notify and lets the wrapper drain; without an
  // explicit destroy here a late RST on the underlying transport can surface
  // as an unhandled error after this socket is gone.
  const upgraded = this[kupgraded];
  if (upgraded && !(upgraded instanceof Socket) && !upgraded.destroyed) {
    upgraded.destroy?.();
  }

  // Close an fd adopted for synchronous writes (node closes the wrapping
  // libuv handle here). Leave stdio fds 0-2 open: process.stdout/stderr and
  // other wrappers share them, matching SyncWriteStream's autoClose gate.
  const syncFd = this[kSyncWriteFd];
  if (syncFd !== undefined) {
    this[kSyncWriteFd] = undefined;
    // Drop the instance overrides so a later connect() on this (reusable)
    // socket goes through the fresh handle's normal write path.
    delete this._write;
    delete this._writev;
    if (syncFd > 2) {
      try {
        require("node:fs").closeSync(syncFd);
      } catch {
        // Already closed by the peer/user; nothing to release.
      }
    }
  }

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
      // resetAndDestroy() must send an RST (not a graceful FIN) so the peer sees
      // ECONNRESET. `close()` does a fast shutdown (clean close) which only
      // happens to surface as RST on some platforms; `terminate()` arms
      // SO_LINGER{1,0} for a real reset on all platforms.
      const err = this._handle.terminate();
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
      const handle = this._handle;
      if (handle) handle.onread = () => {};
      this._handle = null;
      this._sockname = null;
    }
    callback(err);
  } else {
    callback(err);
    process.nextTick(emitCloseNT, this, !!err);
  }

  const server = this.server;
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
    this._handle?.resume?.();
  }
  // Restore the hold pause() removed - even while still connecting, so the
  // pause-then-resume sequence is symmetric. Gated on the pause flag so a
  // socket that was never paused (e.g. a wrapped duplex with no fd) is not
  // newly pinned to the loop.
  if (this[kPausedUnref] && !this[kUserUnrefed]) {
    this._handle?.ref?.();
    this[kPausedUnref] = false;
  }
  return Duplex.prototype.resume.$call(this);
};

Socket.prototype.pause = function pause() {
  if (!this.destroyed) {
    this._handle?.pause?.();
    // libuv only counts a stream handle as active - and therefore as keeping
    // the event loop alive - while it is reading. A paused socket lets the
    // process exit; resume() re-refs it unless the user explicitly unref'd.
    this._handle?.unref?.();
    // Only remember the unref when this handle can actually hold the loop: a
    // TLS socket wrapped over a generic duplex has no fd, so re-refing it
    // later would newly pin the process.
    if (!this[kupgraded] || this[kupgraded] instanceof Socket) {
      this[kPausedUnref] = true;
    }
  }
  return Duplex.prototype.pause.$call(this);
};

// Server-side TLS upgrade over an accepted socket, for
// `new tls.TLSSocket(socket, { isServer: true })`. Adopts the connection's fd
// into an accept-state TLS socket (us_socket_adopt_tls with is_client=0) so the
// native read path drives the handshake. Lives here, not tls.ts, to reach
// ServerHandlers — the shared accepted-socket handler table, with per-socket
// state carried via `data` (mirrors tls.createServer's one-handler-for-all model).
Socket.prototype[Symbol.for("::bunUpgradeServerTLS::")] = function (connection, tls) {
  const socket = connection._handle;
  if (!socket) {
    // A generic Duplex (or a not-yet-connected net.Socket) has no native fd
    // to adopt into a TLS socket; run the TLS engine over the stream itself.
    // The returned events feed the stream's bytes into the engine and back.
    const [result, events] = upgradeDuplexToTLS(connection, {
      data: this,
      tls,
      socket: serverHandlersFor(this),
      isServer: true,
    });
    connection.on("data", events[0]);
    connection.on("end", events[1]);
    connection.on("drain", events[2]);
    connection.on("close", events[3]);
    this[kupgraded] = connection;
    this._handle = result;
    return;
  }
  this[kupgraded] = connection;
  // Bytes that already arrived before the wrap (e.g. the ClientHello) were
  // pulled off the fd into the connection's readable buffer; hand them to the
  // TLS engine so the handshake doesn't stall.
  const pending = connection.read();
  const result = socket.upgradeTLS({
    data: this,
    tls,
    socket: serverHandlersFor(this),
    isServer: true,
    initialData: pending || undefined,
  });
  if (!result) {
    this._handle = null;
    throw new Error("Invalid socket");
  }
  const [raw, tlsHandle] = result;
  connection._handle = raw;
  this.once("end", this[kCloseRawConnection]);
  raw.connecting = false;
  this._handle = tlsHandle;
};

Socket.prototype.read = function read(size) {
  if (!this.connecting) {
    this._handle?.resume?.();
    // Restarting kernel reads makes the handle hold the loop open again;
    // mirror resume()'s re-ref or a paused-then-read() socket waits for
    // data without keeping the process alive.
    if (this[kPausedUnref] && !this[kUserUnrefed]) {
      this._handle?.ref?.();
      this[kPausedUnref] = false;
    }
  }
  return Duplex.prototype.read.$call(this, size);
};

Socket.prototype._read = function _read(size) {
  const socket = this._handle;
  if (this.connecting || !socket) {
    this.once("connect", () => this._read(size));
  } else {
    socket?.resume?.();
    // See read() above - the Readable machinery's pull path must also
    // restore the handle's hold on the loop.
    if (this[kPausedUnref] && !this[kUserUnrefed]) {
      socket?.ref?.();
      this[kPausedUnref] = false;
    }
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

function fdSyncWrite(chunk, encoding, callback) {
  const fs = require("node:fs");
  try {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
    let offset = 0;
    while (offset < buf.length) {
      offset += fs.writeSync(this[kSyncWriteFd], buf, offset);
    }
    // No native handle on this path, so feed bytesWritten/_bytesDispatched
    // directly (node accounts these via the libuv handle).
    this[kBytesWritten] = (this[kBytesWritten] || 0) + offset;
    callback();
  } catch (err) {
    callback(err);
  }
}

function fdSyncWritev(data, callback) {
  const fs = require("node:fs");
  try {
    let total = 0;
    for (let i = 0; i < data.length; i++) {
      const { chunk, encoding } = data[i];
      const buf = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
      let offset = 0;
      while (offset < buf.length) {
        offset += fs.writeSync(this[kSyncWriteFd], buf, offset);
      }
      total += offset;
    }
    // See fdSyncWrite: no native handle to account these on.
    this[kBytesWritten] = (this[kBytesWritten] || 0) + total;
    callback();
  } catch (err) {
    callback(err);
  }
}

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
    if (err && process.platform !== "win32") {
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
    if (process.platform === "win32") {
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
  if (socket.readyState < 0) {
    // The handle's native socket was already closed (e.g. handle.close() was
    // called directly): fail the write the way a write(2) on a closed fd does
    // in Node instead of waiting forever for a drain that never comes.
    // Node reports this as errnoException(UV_EBADF/UV_EPIPE, 'write'), with
    // message, code, errno and syscall all populated.
    const er = new ErrnoException(process.platform === "win32" ? -4047 /* UV_EPIPE */ : -9 /* UV_EBADF */, "write");
    process.nextTick(callback, er);
    return false;
  }
  const res = socket.$write(chunk, encoding);
  this[kBytesWritten] = socket.bytesWritten;
  if (res < 0) {
    // The kernel rejected the send outright (peer reset): $write returned the
    // negative errno; deliver it like the EBADF/EPIPE branch above.
    process.nextTick(failWrite, this, res, callback);
    return false;
  }
  if (res) {
    if (this.encrypted) {
      // TLS batches writes through the SSL engine, so the bytes stay buffered
      // after $write returns. Defer the callback so writableLength/bufferSize
      // reflects the queued bytes until they are flushed (test-tls-buffersize.js).
      // Node's bufferSize getter is just writableLength:
      // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L752
      process.nextTick(callback);
    } else {
      // A plain TCP write completes synchronously once $write reports success.
      // Calling the callback synchronously lets writableLength drain so a tight
      // write() loop backpressures at the kernel rather than the JS
      // highWaterMark, matching Node's _write (test-net-throttle.js):
      // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L1036
      callback();
    }
  } else if (this[kwriteCallback]) {
    callback(new Error("overlapping _write()"));
  } else {
    this[kwriteCallback] = callback;
    // libuv holds the loop for a pending uv_write_t regardless of the handle's ref
    // state; end() dropped ours on the peer's FIN. Re-ref while this buffered write
    // waits for drain so the process does not exit with data unflushed.
    if (this[kended] && !this[kUserUnrefed]) socket.ref?.();
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
  const dnsopts = {
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
  const optionsSocket = options.socket;
  if (optionsSocket) {
    connection = optionsSocket;
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
      let tlsSocket;
      if (!connection && (tlsSocket = tls.socket)) {
        connection = tlsSocket;
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

    traceConnectStart(req);
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
    const req: any = {};
    req.address = address;
    req.oncomplete = afterConnect;
    req.tls = tls;

    traceConnectStart(req, address);
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
  const contextOptionsSocket = context.options.socket;
  if (contextOptionsSocket) {
    connection = contextOptionsSocket;
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
      let tlsSocket;
      if (!connection && (tlsSocket = tls.socket)) {
        connection = tlsSocket;
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

  traceConnectStart(req);
  err = kConnectTcp(self, addressType, req, address, port);

  if (err) {
    const ex = new ExceptionWithHostPort(err, "connect", address, port);
    ArrayPrototypePush.$call(context.errors, ex);

    self.emit("connectionAttemptFailed", address, port, addressType, ex);
    // A listener may destroy() on that event; same guard as afterConnectMultiple.
    if (self.connecting) internalConnectMultiple(context);
    return;
  }

  // The if(err) above covers sync failure; this catches a sync open or a
  // destroy() from a 'connectionAttempt' listener. Arming the timer now
  // would capture a stale handle and overwrite the next attempt's kTimeout.
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
  // close() on a still-connecting handle runs no terminal callback and never
  // rejects doConnect's promise (see socket_body.rs), so end the span here.
  traceConnectEnd(req);
  ArrayPrototypePush.$call(context.errors, createConnectionError(req, UV_ETIMEDOUT));
  handle.close();

  // Try the next address, unless we were aborted
  if (context.socket.connecting) {
    internalConnectMultiple(context);
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

    if (self[kSetTOS] !== undefined && self._handle.setTypeOfService) {
      self._handle.setTypeOfService(self[kSetTOS]);
    }
    if (self[kSetNoDelay] && self._handle.setNoDelay) {
      self._handle.setNoDelay(true);
    }

    if (self[kSetKeepAlive] && self._handle.setKeepAlive) {
      self._handle.setKeepAlive(true, self[kSetKeepAliveInitialDelay]);
    }

    self.emit("connect");
    self.emit("ready");

    if (self[kPerfHooksNetConnectContext] && hasObserver("net")) {
      stopPerf(self, kPerfHooksNetConnectContext);
    }

    // Start the first read, or get an immediate EOF.
    // this doesn't actually consume any bytes, because len=0.
    if (readable && !self.isPaused()) self.read(0);
  } else {
    let details;
    const localAddress = req.localAddress;
    let localPort;
    if (localAddress && (localPort = req.localPort)) {
      details = localAddress + ":" + localPort;
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
      internalConnectMultiple(context, status === UV_ECANCELED);
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
  this.listeningId = 1;

  this[bunSocketServerOptions] = undefined;
  // Server option coercion matches Node's Server constructor:
  // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/net.js#L1880
  this.allowHalfOpen = allowHalfOpen;
  this.keepAlive = Boolean(keepAlive);
  this.keepAliveInitialDelay = MathMax(0, ~~keepAliveInitialDelay);
  this.highWaterMark = highWaterMark;
  this.pauseOnConnect = Boolean(pauseOnConnect);
  this.noDelay = Boolean(noDelay);

  options.connectionListener = connectionListener;
  this[bunSocketServerOptions] = options;

  const optionsBlockList = options.blockList;
  if (optionsBlockList) {
    if (!BlockList.isBlockList(optionsBlockList)) {
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
    } else {
      this._handle.close();
    }
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
  let reusePort = false;
  let ipv6Only = false;
  let readableAll = false;
  let writableAll = false;
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
      backlog = options.backlog;
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
        port = port | 0;
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
      port = port | 0;
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
    var clusterHost = typeof hostname === "string" && hostname.length > 0 ? hostname : null;
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

    const flags = (ipv6Only === true ? 1 : 0) | (reusePort === true ? 2 : 0);
    let queryAddress = null;
    let queryPort = port;
    let queryAddressType = 4;
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
      undefined,
      path,
      hostname,
      tls,
      contexts,
      onListen,
    );
  } catch (err) {
    const isUnix = path != null;
    setTimeout(emitErrorNextTick, 1, this, formatListenError(err, isUnix ? path : hostname, isUnix ? undefined : port));
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
  _onListen,
  fd,
) {
  // NOTE: accepted sockets are always allowHalfOpen:true at the native layer
  // (hardcoded below); the stream layer implements allowHalfOpen=false
  // semantics itself, so the server option is consumed in JS only.
  if (reusePort) {
    exclusive = false;
  }
  if (path) {
    this._handle = Bun.listen({
      unix: path,
      tls,
      // Accepted sockets are always half-open natively; the stream layer
      // implements allowHalfOpen=false (see kConnect / onSocketEnd).
      allowHalfOpen: true,
      reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
      ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
      exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
      socket: serverHandlersFor(this),
      data: this,
    });
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
  } else if (fd != null) {
    this._handle = Bun.listen({
      fd,
      hostname,
      tls,
      allowHalfOpen: true,
      reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
      ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
      exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
      socket: serverHandlersFor(this),
      data: this,
    });
  } else {
    this._handle = Bun.listen({
      port,
      hostname,
      tls,
      allowHalfOpen: true,
      reusePort: reusePort || this[bunSocketServerOptions]?.reusePort || false,
      ipv6Only: ipv6Only || this[bunSocketServerOptions]?.ipv6Only || false,
      exclusive: exclusive || this[bunSocketServerOptions]?.exclusive || false,
      socket: serverHandlersFor(this),
      data: this,
    });
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
  reusePort,
  readableAll,
  writableAll,
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

  if (
    !cluster.isPrimary &&
    !exclusive &&
    typeof address === "string" &&
    address.length > 0 &&
    typeof port === "number" &&
    port >= 0 &&
    isIP(address) === 0
  ) {
    const lookupListeningId = (server[kClusterListeningId] = (server[kClusterListeningId] || 0) + 1);
    require("node:dns").lookup(address, (err, ip, family) => {
      if (lookupListeningId !== server[kClusterListeningId]) return;
      if (err) {
        setTimeout(emitErrorNextTick, 1, server, err);
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
        options,
        path,
        hostname,
        tls,
        contexts,
        onListen,
      );
    });
    return;
  }

  if (cluster.isPrimary || exclusive) {
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
    readableAll,
    writableAll,
    ...options,
    sharedOnly: tls ? true : undefined,
  };
  const listeningId = (server[kClusterListeningId] = (server[kClusterListeningId] || 0) + 1);
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
      server.once("close", () => handle.close());
      try {
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
          onListen,
          sharedFd,
        );
        handle.adopted = true;
        if (path && (readableAll || writableAll) && process.platform !== "win32" && path.charCodeAt(0) !== 0) {
          let desired = 0;
          if (readableAll) desired |= 0o44; // S_IRGRP | S_IROTH
          if (writableAll) desired |= 0o22; // S_IWGRP | S_IWOTH
          const fs = require("node:fs");
          try {
            const cur = fs.statSync(path).mode;
            if ((cur & desired) !== desired) fs.chmodSync(path, cur | desired);
          } catch (e) {
            server._handle?.stop?.(true);
            server._handle = null;
            throw e;
          }
        }
      } catch (err) {
        server[kClusterHandle] = null;
        handle[kClusterOwner] = null;
        handle.close();
        setTimeout(emitErrorNextTick, 1, server, err);
      }
      return;
    }
    server[kClusterFauxListen](handle, backlog, path);
  });
}

const kClusterListeningId = Symbol("kClusterListeningId");
const kClusterHandle = Symbol("kClusterHandle");
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
  setTimeout(emitListeningNextTick, 1, this);
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
    socket[kSetKeepAliveInitialDelay] = self.keepAliveInitialDelay;
  }
  socket.connect({ fd: clientHandle.fd, fdIsRawSocket: true, pauseOnConnect: self.pauseOnConnect });
  const blockList = self.blockList;
  if (blockList) {
    const remote = socket.remoteAddress;
    const t = isIP(remote);
    if (t && blockList.check(remote, `ipv${t}`)) {
      const data = {
        localAddress: socket.localAddress,
        localPort: socket.localPort,
        localFamily: socket.localFamily,
        remoteAddress: remote,
        remotePort: socket.remotePort,
        remoteFamily: socket.remoteFamily,
      };
      socket.destroy();
      self.emit("drop", data);
      return;
    }
  }
  socket.server = self;
  socket._server = self;
  self._connections++;
  const connectionListener = self[bunSocketServerOptions]?.connectionListener;
  if (typeof connectionListener === "function" && typeof self[bunTlsSymbol] !== "function") {
    self.prependOnceListener("connection", connectionListener);
  }
  self.emit("connection", socket);
  if (!self.pauseOnConnect) {
    socket.resume();
  }
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
  const handle = self._handle;
  if (handle) {
    handle[owner_symbol] = self;
  }
}

// Node's handle.close(callback) takes a completion callback; userland code
// intercepts close on `socket._handle` and invokes it, so always pass one.
function onSocketHandleClosed() {}

function closeSocketHandle(self, isException, isCleanupPending = false) {
  const handle = self._handle;
  $debug("closeSocketHandle", isException, isCleanupPending, !!handle);
  if (handle) {
    handle.close(onSocketHandleClosed);
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

// Reformat a native listen error to Node's "listen <CODE>: <description> <addr>"
// (Node uses exceptionWithHostPort). Only rewrites known uv codes; the code is
// already set natively.
// https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/net.js#L1899
function uvListenErrorDescription(code) {
  switch (code) {
    case "EADDRINUSE":
      return "address already in use";
    case "EACCES":
      return "permission denied";
    case "EADDRNOTAVAIL":
      return "address not available";
    case "EINVAL":
      return "invalid argument";
    default:
      return undefined;
  }
}
function formatListenError(err, address, port) {
  const desc = err && typeof err.code === "string" ? uvListenErrorDescription(err.code) : undefined;
  if (desc) {
    err.syscall = "listen";
    // Node's exceptionWithHostPort also exposes the failing address/port as
    // own properties; user code commonly reads them off listen errors.
    err.address = address;
    if (port) err.port = port;
    const where = port ? `${address}:${port}` : address;
    err.message = `listen ${err.code}: ${desc}${where ? ` ${where}` : ""}`;
  }
  return err;
}

function checkBindError(err, port, handle) {
  // EADDRINUSE may not be reported until we call listen() or connect().
  // To complicate matters, a failed bind() followed by listen() or connect()
  // will implicitly bind to a random port. Ergo, check that the socket is
  // bound to the expected port before calling listen() or connect().
  if (err === 0 && port > 0 && handle.getsockname) {
    const out = {};
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
