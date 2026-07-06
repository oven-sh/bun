const { isTypedArray, isArrayBuffer } = require("node:util/types");
const { validateUint32, validateString, validateBuffer, validateFunction } = require("internal/validators");

function isPemObject(obj: unknown): obj is { pem: unknown } {
  return $isObject(obj) && "pem" in obj;
}

function isPemArray(obj: unknown): obj is [{ pem: unknown }] {
  // if (obj instanceof Object && "pem" in obj) return isValidTLSArray(obj.pem);
  return $isArray(obj) && obj.every(isPemObject);
}

function isValidTLSItem(obj: unknown) {
  if (typeof obj === "string" || isTypedArray(obj) || isArrayBuffer(obj) || $inheritsBlob(obj) || isPemArray(obj)) {
    return true;
  }

  return false;
}

function findInvalidTLSItem(obj: unknown) {
  if ($isArray(obj)) {
    for (var i = 0, length = obj.length; i < length; i++) {
      const item = obj[i];
      if (!isValidTLSItem(item)) return item;
    }
  }
  return obj;
}

function throwOnInvalidTLSArray(name: string, value: unknown) {
  if (!isValidTLSArray(value)) {
    throw $ERR_INVALID_ARG_TYPE(name, VALID_TLS_ERROR_MESSAGE_TYPES, findInvalidTLSItem(value));
  }
}

function isValidTLSArray(obj: unknown) {
  if (isValidTLSItem(obj)) return true;

  if ($isArray(obj)) {
    for (var i = 0, length = obj.length; i < length; i++) {
      const item = obj[i];
      if (!isValidTLSItem(item)) return false;
    }

    return true;
  }

  return false;
}

const VALID_TLS_ERROR_MESSAGE_TYPES = "string or an instance of Buffer, TypedArray, DataView, or BunFile";

// The TLS half of `tls.TLSSocket`. Every method reads the negotiated state off
// `this._handle`, so any object that carries a handle exposing these natives
// gets the documented TLS surface: `tls.TLSSocket` (a `Bun.connect` socket) and
// the `https.Server` request socket (a uWS connection, see
// node:_http_server's NodeHTTPServerTLSSocket). Installed on both prototypes by
// `installTLSSocketMethods`.
const kSession = Symbol("kSession");
const kRenegotiationDisabled = Symbol("kRenegotiationDisabled");
// Marks the https.Server request socket, which cannot extend TLSSocket (its
// base class is the uWS-backed Duplex) but is one everywhere it matters.
// node:tls's TLSSocket[Symbol.hasInstance] consults it.
const kTLSSocketFacade = Symbol("kTLSSocketFacade");

// The native X509 encoder already hands back the idiomatic shape Node's
// translatePeerCertificate(node:_tls_common) produces (infoAccess is parsed
// into an object there), so nothing is translated on the way out.
function getPeerCertificate(detailed) {
  const handle = this._handle;
  if (handle) {
    // The native parameter means "abbreviated" - the inverse of Node's
    // `detailed`. Detailed requests get the whole chain with
    // issuerCertificate links; everything else gets just the leaf.
    const cert = arguments.length < 1 ? handle.getPeerCertificate?.() : handle.getPeerCertificate?.(!detailed);
    return cert || {};
  }
  return null;
}

function getCertificate() {
  return this._handle?.getCertificate?.();
}

function getPeerX509Certificate() {
  // Build the X509Certificate chain from the detailed peer-certificate
  // objects, linking each to its issuer the way Node does. The
  // `issuerCertificate` own property shadows the prototype getter (which is
  // always undefined for certificates parsed outside a TLS connection).
  const cert = this.getPeerCertificate(true);
  if (!cert || !cert.raw) {
    return this._handle?.getPeerX509Certificate?.();
  }
  const { X509Certificate } = require("node:crypto");
  const seen = new Map();
  const toX509 = chainCert => {
    if (!chainCert || !chainCert.raw) return undefined;
    const cached = seen.$get(chainCert);
    if (cached) return cached;
    const x509 = new X509Certificate(chainCert.raw);
    seen.$set(chainCert, x509);
    const issuerCertificate = chainCert.issuerCertificate;
    if (issuerCertificate && issuerCertificate !== chainCert) {
      const issuer = toX509(issuerCertificate);
      if (issuer) {
        Object.defineProperty(x509, "issuerCertificate", {
          __proto__: null,
          value: issuer,
          configurable: true,
          enumerable: false,
        });
      }
    }
    return x509;
  };
  return toX509(cert);
}

function getX509Certificate() {
  return this._handle?.getX509Certificate?.();
}

function getSession() {
  return this._handle?.getSession?.();
}

function setSession(session) {
  this[kSession] = session;
  if (typeof session === "string") session = Buffer.from(session, "latin1");
  return this._handle?.setSession?.(session);
}

function getEphemeralKeyInfo() {
  const info = this._handle?.getEphemeralKeyInfo?.();
  if (info == null) return info;
  // Empirically node always surfaces all three keys here (values undefined when
  // absent): a client socket on a TLS 1.3 ECDHE session observes
  // Object.keys(...) === ['type','name','size'] under node v26.3.0, so the
  // reshape below is required for key-set parity with our native return.
  return { type: info.type, name: info.name, size: info.size };
}

function getCipher() {
  return this._handle?.getCipher?.();
}

function getSharedSigalgs() {
  return this._handle?.getSharedSigalgs?.();
}

function getProtocol() {
  // Node returns the negotiated protocol string, or null once the socket is no
  // longer connected (e.g. after 'close').
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/_tls_wrap.js#L1455
  return this._handle?.getTLSVersion?.() ?? null;
}

function getFinished() {
  return this._handle?.getTLSFinishedMessage?.() || undefined;
}

function getPeerFinished() {
  return this._handle?.getTLSPeerFinishedMessage?.() || undefined;
}

function isSessionReused() {
  return this._handle?.isSessionReused?.() ?? false;
}

function getTLSTicket() {
  return this._handle?.getTLSTicket?.();
}

function setMaxSendFragment(size) {
  return this._handle?.setMaxSendFragment?.(size) || false;
}

function enableTrace() {
  // only for debug purposes so we just mock for now
}

function setServername(name) {
  validateString(name, "name");
  if (this.isServer) {
    throw $ERR_TLS_SNI_FROM_SERVER();
  }
  // if the socket is detached we can't set the servername but we set this property so when open will auto set to it
  this.servername = name;
  this._handle?.setServername?.(name);
}

function exportKeyingMaterial(length, label, context) {
  // https://github.com/nodejs/node/blob/v25.2.1/lib/internal/tls/wrap.js#L1039
  validateUint32(length, "length", true);
  validateString(label, "label");
  if (context !== undefined) validateBuffer(context, "context");

  if (!this._secureEstablished) {
    throw $ERR_TLS_INVALID_STATE();
  }

  if (context) {
    return this._handle?.exportKeyingMaterial?.(length, label, context);
  }
  return this._handle?.exportKeyingMaterial?.(length, label);
}

function renegotiate(options, callback) {
  // https://github.com/nodejs/node/blob/v25.2.1/lib/_tls_wrap.js#L878
  if (options === null || typeof options !== "object") {
    throw $ERR_INVALID_ARG_TYPE("options", "object", options);
  }
  if (callback !== undefined) {
    validateFunction(callback, "callback");
  }

  if (this.destroyed) {
    return;
  }

  if (this[kRenegotiationDisabled]) {
    // if renegotiation is disabled should emit error event in nextTick for nodejs compatibility
    const error = $ERR_TLS_RENEGOTIATION_DISABLED();
    if (typeof callback === "function") process.nextTick(callback, error);
    return false;
  }

  const socket = this._handle;
  // if the socket is detached we can't renegotiate, nodejs do a noop too (we should not return false or true here)
  if (!socket) return;

  let requestCert = !!this._requestCert;
  let rejectUnauthorized = !!this._rejectUnauthorized;
  const { requestCert: requestCertOption, rejectUnauthorized: rejectUnauthorizedOption } = options;
  if (requestCertOption !== undefined) requestCert = !!requestCertOption;
  if (rejectUnauthorizedOption !== undefined) rejectUnauthorized = !!rejectUnauthorizedOption;
  if (requestCert !== this._requestCert || rejectUnauthorized !== this._rejectUnauthorized) {
    socket.setVerifyMode?.(requestCert, rejectUnauthorized);
    this._requestCert = requestCert;
    this._rejectUnauthorized = rejectUnauthorized;
  }

  // BoringSSL does not implement TLS renegotiation; Node built against
  // BoringSSL reports exactly this from renegotiate() regardless of the
  // protocol version, and so do we.
  const error = $ERR_TLS_RENEGOTIATION_UNSUPPORTED();
  if (typeof callback === "function") process.nextTick(callback, error);
  return false;
}

function disableRenegotiation() {
  this[kRenegotiationDisabled] = true;
  // disable renegotiation on the socket
  return this._handle?.disableRenegotiation?.();
}

const tlsSocketMethods = {
  __proto__: null,
  getPeerCertificate,
  getCertificate,
  getPeerX509Certificate,
  getX509Certificate,
  getSession,
  setSession,
  getEphemeralKeyInfo,
  getCipher,
  getSharedSigalgs,
  getProtocol,
  getFinished,
  getPeerFinished,
  isSessionReused,
  getTLSTicket,
  setMaxSendFragment,
  enableTrace,
  setServername,
  exportKeyingMaterial,
  renegotiate,
  disableRenegotiation,
};

function installTLSSocketMethods(prototype) {
  const names = Object.keys(tlsSocketMethods);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    prototype[name] = tlsSocketMethods[name];
  }
}

export {
  VALID_TLS_ERROR_MESSAGE_TYPES,
  installTLSSocketMethods,
  isValidTLSArray,
  isValidTLSItem,
  kRenegotiationDisabled,
  kSession,
  kTLSSocketFacade,
  throwOnInvalidTLSArray,
};
