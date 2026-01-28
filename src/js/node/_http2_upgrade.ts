const { Duplex } = require("node:stream");
const upgradeDuplexToTLS = $newZigFunction("socket.zig", "jsUpgradeDuplexToTLS", 2);

/**
 * @typedef {Object} UpgradeContextType
 * @property {Function} connectionListener - H2 session factory
 * @property {Object} server - Http2SecureServer instance
 * @property {Object} rawSocket - Raw TCP socket being upgraded
 * @property {Object|null} nativeHandle - TLS socket handle from upgradeDuplexToTLS
 * @property {Array|null} events - [onData, onEnd, onDrain, onClose] event handlers
 */

/**
 * @typedef {import("node:stream").Duplex & {
 *   _ctx: UpgradeContextType,
 *   _writeCallback?: Function,
 *   alpnProtocol: string|null,
 *   authorized: boolean,
 *   encrypted: boolean,
 *   server: Object,
 *   _requestCert: boolean,
 *   _rejectUnauthorized: boolean,
 *   _securePending: boolean,
 *   secureConnecting: boolean,
 *   _secureEstablished: boolean,
 *   authorizationError?: string,
 * }} TLSProxySocket
 */

/**
 * Context object holding upgrade-time state for the TLS proxy socket.
 * Attached as `tlsSocket._ctx` so named functions can reach it via `this._ctx`
 * (Duplex methods) or via a bound `this` (socket callbacks).
 *
 * @param {Function} connectionListener - H2 session factory
 * @param {Object} server - Http2SecureServer instance
 * @param {Object} rawSocket - Raw TCP socket being upgraded
 */
function UpgradeContext(connectionListener, server, rawSocket) {
  this.connectionListener = connectionListener;
  this.server = server;
  this.rawSocket = rawSocket;
  this.nativeHandle = null;
  this.events = null;
}

// ---------------------------------------------------------------------------
// Duplex stream methods — called with `this` = tlsSocket (standard stream API)
// ---------------------------------------------------------------------------

/**
 * _read: called by stream machinery when the H2 session wants data.
 * Resume the native TLS handle so it feeds decrypted data via the data callback.
 * Mirrors net.ts Socket.prototype._read which calls socket.resume().
 *
 * @this {TLSProxySocket}
 */
function tlsSocketRead() {
  const h = this._ctx.nativeHandle;
  if (h) {
    h.resume();
  }
}

/**
 * _write: called when the H2 session writes outbound frames.
 * Forward to the native TLS handle for encryption, then back to rawSocket.
 * Mirrors net.ts Socket.prototype._write which calls socket.$write().
 *
 * @this {TLSProxySocket}
 * @param {Buffer} chunk - Data to encrypt and send
 * @param {string} encoding - Encoding (unused for Buffer chunks)
 * @param {Function} callback - Stream callback; invoke when write completes or on error
 */
function tlsSocketWrite(chunk, encoding, callback) {
  const h = this._ctx.nativeHandle;
  if (!h) {
    callback(new Error("Socket is closed"));
    return;
  }
  // $write returns true if fully flushed, false if buffered
  if (h.$write(chunk, encoding)) {
    callback();
  } else {
    // Store callback so drain event can invoke it (backpressure)
    this._writeCallback = callback;
  }
}

/**
 * _destroy: called when the stream is destroyed (e.g. tlsSocket.destroy(err)).
 * Cleans up the native TLS handle.
 * Mirrors net.ts Socket.prototype._destroy.
 *
 * @this {TLSProxySocket}
 * @param {Error|null} err - Error that caused destruction, or null
 * @param {Function} callback - Stream callback; invoke when cleanup is done
 */
function tlsSocketDestroy(err, callback) {
  const h = this._ctx.nativeHandle;
  if (h) {
    h.close();
    this._ctx.nativeHandle = null;
  }
  callback(err);
}

/**
 * _final: called when the writable side is ending (all data flushed).
 * Shuts down the TLS write side gracefully.
 * Mirrors net.ts Socket.prototype._final.
 *
 * @this {TLSProxySocket}
 * @param {Function} callback - Stream callback; invoke when shutdown is done
 */
function tlsSocketFinal(callback) {
  const h = this._ctx.nativeHandle;
  if (!h) return callback();
  // Signal end-of-stream to the TLS layer
  h.end();
  callback();
}

// ---------------------------------------------------------------------------
// Socket callbacks — called by Zig with `this` = native handle (not useful).
// All are bound to tlsSocket so `this` inside each = tlsSocket.
// ---------------------------------------------------------------------------

/**
 * open: called when the TLS layer is initialized (before handshake).
 * No action needed; we wait for the handshake callback.
 */
function socketOpen() {}

/**
 * data: called with decrypted plaintext after the TLS layer decrypts incoming data.
 * Push into tlsSocket so the H2 session's _read() receives these frames.
 *
 * @this {TLSProxySocket}
 * @param {Object} _socket - Native socket handle (unused; we use bound this)
 * @param {Buffer} chunk - Decrypted data buffer
 */
function socketData(_socket, chunk) {
  this.push(chunk);
}

/**
 * end: TLS peer signaled end-of-stream; signal EOF to the H2 session.
 *
 * @this {TLSProxySocket}
 */
function socketEnd() {
  this.push(null);
}

/**
 * drain: raw socket is writable again after being full; propagate backpressure signal.
 * If _write stored a callback waiting for drain, invoke it now.
 *
 * @this {TLSProxySocket}
 */
function socketDrain() {
  const cb = this._writeCallback;
  if (cb) {
    this._writeCallback = null;
    cb();
  }
}

/**
 * close: TLS connection closed; tear down the tlsSocket Duplex.
 *
 * @this {TLSProxySocket}
 */
function socketClose() {
  if (!this.destroyed) {
    this.destroy();
  }
}

/**
 * error: TLS-level error (e.g. certificate verification failure).
 * In server mode without _requestCert, the server doesn't request a client cert,
 * so issuer verification errors on the server's own cert are non-fatal.
 *
 * @this {TLSProxySocket}
 * @param {Object} _socket - Native socket handle (unused; we use bound this)
 * @param {Error} err - TLS error
 */
function socketError(_socket, err) {
  const ctx = this._ctx;
  if (!ctx.server._requestCert && err?.code === "UNABLE_TO_GET_ISSUER_CERT") {
    return;
  }
  this.destroy(err);
}

/**
 * timeout: socket idle timeout; forward to the Duplex so H2 session can handle it.
 *
 * @this {TLSProxySocket}
 */
function socketTimeout() {
  this.emit("timeout");
}

/**
 * handshake: TLS handshake completed. This is the critical callback that triggers
 * H2 session creation.
 *
 * Mirrors the handshake logic in net.ts ServerHandlers.handshake:
 *   - Set secure-connection state flags on tlsSocket
 *   - Read alpnProtocol from the native handle (set by ALPN negotiation)
 *   - Handle _requestCert / _rejectUnauthorized for mutual TLS
 *   - Call connectionListener to create the ServerHttp2Session
 *
 * @this {TLSProxySocket}
 * @param {Object} nativeHandle - The TLS socket handle with .alpnProtocol
 * @param {boolean} success - Whether the handshake succeeded
 * @param {Error|null} verifyError - Certificate verification error or null
 */
function socketHandshake(nativeHandle, success, verifyError) {
  const tlsSocket = this; // bound
  const ctx = tlsSocket._ctx;

  if (!success) {
    const err = verifyError || new Error("TLS handshake failed");
    ctx.server.emit("tlsClientError", err, ctx.rawSocket);
    tlsSocket.destroy(err);
    return;
  }

  // Mark TLS handshake as complete on the proxy socket
  tlsSocket._securePending = false;
  tlsSocket.secureConnecting = false;
  tlsSocket._secureEstablished = true;

  // Copy the negotiated ALPN protocol (e.g. "h2") from the native TLS handle.
  // The H2 session checks this to confirm HTTP/2 was negotiated.
  tlsSocket.alpnProtocol = nativeHandle?.alpnProtocol;

  // Handle mutual TLS: if the server requested a client cert, check for errors
  if (tlsSocket._requestCert || tlsSocket._rejectUnauthorized) {
    if (verifyError) {
      tlsSocket.authorized = false;
      tlsSocket.authorizationError = verifyError.code || verifyError.message;
      ctx.server.emit("tlsClientError", verifyError, tlsSocket);
      if (tlsSocket._rejectUnauthorized) {
        tlsSocket.emit("secure", tlsSocket);
        tlsSocket.destroy(verifyError);
        return;
      }
    } else {
      tlsSocket.authorized = true;
    }
  } else {
    tlsSocket.authorized = true;
  }

  // Invoke the H2 connectionListener which creates a ServerHttp2Session.
  // This is the same function passed to Http2SecureServer's constructor
  // and is what normally fires on the 'secureConnection' event.
  ctx.connectionListener.$call(ctx.server, tlsSocket);

  // Resume the Duplex so the H2 session can read frames from it.
  // Mirrors net.ts ServerHandlers.handshake line 438: `self.resume()`.
  tlsSocket.resume();
}

// ---------------------------------------------------------------------------
// Close-cleanup handler
// ---------------------------------------------------------------------------

/**
 * onTlsClose: when the TLS socket closes (e.g. H2 session destroyed), clean up
 * the raw socket listeners to prevent memory leaks and stale callback references.
 * EventEmitter calls 'close' handlers with `this` = emitter (tlsSocket).
 *
 * @this {TLSProxySocket}
 */
function onTlsClose() {
  const ctx = this._ctx;
  const raw = ctx.rawSocket;
  const ev = ctx.events;
  raw.removeListener("data", ev[0]);
  raw.removeListener("end", ev[1]);
  raw.removeListener("drain", ev[2]);
  raw.removeListener("close", ev[3]);
}

// ---------------------------------------------------------------------------
// Module-scope noop (replaces anonymous () => {} for the error suppression)
// ---------------------------------------------------------------------------

/**
 * noop: no-op handler used to suppress unhandled error events until
 * the H2 session attaches its own error handler.
 */
function noop() {}

// ---------------------------------------------------------------------------
// Main upgrade function
// ---------------------------------------------------------------------------

/**
 * Upgrades a raw TCP socket to TLS and initiates an H2 session on it.
 *
 * When a net.Server forwards an accepted TCP connection to an Http2SecureServer
 * via `h2Server.emit('connection', socket)`, the socket has not been TLS-upgraded.
 * Node.js Http2SecureServer expects to receive this and perform the upgrade itself.
 *
 * This mirrors the TLS server handshake pattern from net.ts ServerHandlers, but
 * targets the H2 connectionListener instead of a generic secureConnection event.
 *
 * Data flow after upgrade:
 *   rawSocket (TCP) → upgradeDuplexToTLS (Zig TLS layer) → socket callbacks
 *     → tlsSocket.push() → H2 session reads
 *   H2 session writes → tlsSocket._write() → handle.$write() → Zig TLS layer → rawSocket
 *
 * CRITICAL: We do NOT set tlsSocket._handle to the native TLS handle.
 * If we did, the H2FrameParser constructor would detect it as a JSTLSSocket
 * and call attachNativeCallback(), which intercepts all decrypted data at the
 * Zig level, completely bypassing our JS data callback and Duplex.push() path.
 * Instead, we store the handle in _ctx.nativeHandle so _read/_write/_destroy
 * can use it, while the H2 session sees _handle as null and uses the JS-level
 * socket.on("data") → Duplex → parser.read() path for incoming frames.
 *
 * @param {Function} connectionListener - The H2 session factory (module-scope in http2.ts)
 * @param {Object} server - The Http2SecureServer instance
 * @param {Object} rawSocket - The raw TCP socket to upgrade
 * @returns {boolean} Always returns true
 */
function upgradeRawSocketToH2(connectionListener, server, rawSocket) {
  // Create a Duplex stream that acts as the TLS "socket" from the H2 session's perspective.
  const tlsSocket = new Duplex();
  tlsSocket._ctx = new UpgradeContext(connectionListener, server, rawSocket);

  // Duplex stream methods — `this` is tlsSocket, no bind needed
  tlsSocket._read = tlsSocketRead;
  tlsSocket._write = tlsSocketWrite;
  tlsSocket._destroy = tlsSocketDestroy;
  tlsSocket._final = tlsSocketFinal;

  // Suppress unhandled error events until the H2 session attaches its own error handler
  tlsSocket.on("error", noop);

  // Set TLS-like properties that connectionListener and the H2 session expect.
  // These are set on the Duplex because we cannot use a real TLSSocket here —
  // its internal state machine would conflict with upgradeDuplexToTLS.
  tlsSocket.alpnProtocol = null;
  tlsSocket.authorized = false;
  tlsSocket.encrypted = true;
  tlsSocket.server = server;

  // Only enforce client cert verification if the server explicitly requests it.
  // tls.Server defaults _rejectUnauthorized to true, but without _requestCert
  // the server doesn't actually ask for a client cert, so verification errors
  // (e.g. UNABLE_TO_GET_ISSUER_CERT for the server's own self-signed cert) are
  // spurious and must be ignored.
  tlsSocket._requestCert = server._requestCert || false;
  tlsSocket._rejectUnauthorized = server._requestCert ? server._rejectUnauthorized : false;

  // socket: callbacks — bind to tlsSocket since Zig calls them with native handle as `this`
  let handle, events;
  try {
    // upgradeDuplexToTLS wraps rawSocket with a TLS layer in server mode (isServer: true).
    // The Zig side will:
    //   1. Read encrypted data from rawSocket via events[0..3]
    //   2. Decrypt it through the TLS engine (with ALPN negotiation for "h2")
    //   3. Call our socket callbacks below with the decrypted plaintext
    //
    // ALPNProtocols: server.ALPNProtocols is a Buffer in wire format (e.g. <Buffer 02 68 32>
    // for ["h2"]). The Zig SSLConfig expects an ArrayBuffer, so we slice the underlying buffer.
    [handle, events] = upgradeDuplexToTLS(rawSocket, {
      isServer: true,
      tls: {
        key: server.key,
        cert: server.cert,
        ca: server.ca,
        passphrase: server.passphrase,
        ALPNProtocols: server.ALPNProtocols
          ? server.ALPNProtocols.buffer.slice(
              server.ALPNProtocols.byteOffset,
              server.ALPNProtocols.byteOffset + server.ALPNProtocols.byteLength,
            )
          : null,
      },
      socket: {
        open: socketOpen,
        data: socketData.bind(tlsSocket),
        end: socketEnd.bind(tlsSocket),
        drain: socketDrain.bind(tlsSocket),
        close: socketClose.bind(tlsSocket),
        error: socketError.bind(tlsSocket),
        timeout: socketTimeout.bind(tlsSocket),
        handshake: socketHandshake.bind(tlsSocket),
      },
      data: {},
    });
  } catch (e) {
    tlsSocket.destroy(e);
    return true;
  }

  // Store handle in _ctx (NOT on tlsSocket._handle).
  // This prevents H2FrameParser from attaching as native callback which would
  // intercept data at the Zig level and bypass our Duplex push path.
  tlsSocket._ctx.nativeHandle = handle;
  tlsSocket._ctx.events = events;

  // Wire up the raw TCP socket to feed encrypted data into the TLS layer.
  // events[0..3] are native event handlers returned by upgradeDuplexToTLS that
  // the Zig TLS engine expects to receive data/end/drain/close through.
  rawSocket.on("data", events[0]);
  rawSocket.on("end", events[1]);
  rawSocket.on("drain", events[2]);
  rawSocket.on("close", events[3]);

  // When the TLS socket closes (e.g. H2 session destroyed), clean up the raw socket
  // listeners to prevent memory leaks and stale callback references.
  // EventEmitter calls 'close' handlers with `this` = emitter (tlsSocket).
  tlsSocket.once("close", onTlsClose);
  return true;
}

export default { upgradeRawSocketToH2 };
