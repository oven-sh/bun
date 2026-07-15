// Hardcoded module "node:tls"
const { isArrayBufferView } = require("node:util/types");
const net = require("node:net");
const Duplex = require("internal/streams/duplex");
const EventEmitter = require("node:events");
const addServerName = $newRustFunction("Listener.rs", "jsAddServerName", 3);
const { throwNotImplemented } = require("internal/shared");
const {
  throwOnInvalidTLSArray,
  validateCiphers,
  validateSecureContextOptions,
  processPfxOptions,
  foldPfxExtraCAs,
  convertALPNProtocols,
  resolveTLSVersionRange,
  getNativeSecureContext,
  getDefaultMinVersion,
  setDefaultMinVersion,
  getDefaultMaxVersion,
  setDefaultMaxVersion,
} = require("internal/tls");
const {
  validateString,
  validateNumber,
  validateUint32,
  validateBuffer,
  validateFunction,
} = require("internal/validators");

const { Server: NetServer, Socket: NetSocket } = net;

const getBundledRootCertificates = $newCppFunction("NodeTLS.cpp", "getBundledRootCertificates", 1);
const getExtraCACertificates = $newCppFunction("NodeTLS.cpp", "getExtraCACertificates", 1);
const getSystemCACertificates = $newCppFunction("NodeTLS.cpp", "getSystemCACertificates", 1);
const canonicalizeIP = $newCppFunction("NodeTLS.cpp", "Bun__canonicalizeIP", 1);

const getTLSDefaultCiphers = $newCppFunction("NodeTLS.cpp", "getDefaultCiphers", 0);
const setTLSDefaultCiphers = $newCppFunction("NodeTLS.cpp", "setDefaultCiphers", 1);
const SymbolReplace = Symbol.replace;
const RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;

const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSubstring = String.prototype.substring;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringFromCharCode = String.fromCharCode;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSome = Array.prototype.some;

const ObjectFreeze = Object.freeze;

function parseCertString() {
  // Removed since JAN 2022 Node v18.0.0+ https://github.com/nodejs/node/pull/41479
  throwNotImplemented("Not implemented");
}

// Node.js reads NODE_TLS_REJECT_UNAUTHORIZED lazily (per connection), so a
// script can set it after loading the module and still have it apply.
function rejectUnauthorizedDefault() {
  const value = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  return value !== "0" && value !== "false";
}

function unfqdn(host) {
  return RegExpPrototypeSymbolReplace.$call(/[.]$/, host, "");
}
// String#toLowerCase() is locale-sensitive so we use
// a conservative version that only lowercases A-Z.
function toLowerCase(c) {
  return StringFromCharCode(32 + StringPrototypeCharCodeAt.$call(c, 0));
}

function splitHost(host) {
  return StringPrototypeSplit.$call(RegExpPrototypeSymbolReplace.$call(/[A-Z]/g, unfqdn(host), toLowerCase), ".");
}

function check(hostParts, pattern, wildcards) {
  // Empty strings, null, undefined, etc. never match.
  if (!pattern) return false;

  const patternParts = splitHost(pattern);

  if (hostParts.length !== patternParts.length) return false;

  // Pattern has empty components, e.g. "bad..example.com".
  if (ArrayPrototypeIncludes.$call(patternParts, "")) return false;

  // RFC 6125 allows IDNA U-labels (Unicode) in names but we have no
  // good way to detect their encoding or normalize them so we simply
  // reject them.  Control characters and blanks are rejected as well
  // because nothing good can come from accepting them.
  const isBad = s => RegExpPrototypeExec.$call(/[^\u0021-\u007F]/u, s) !== null;
  if (ArrayPrototypeSome.$call(patternParts, isBad)) return false;

  // Check host parts from right to left first.
  for (let i = hostParts.length - 1; i > 0; i -= 1) {
    if (hostParts[i] !== patternParts[i]) return false;
  }

  const hostSubdomain = hostParts[0];
  const patternSubdomain = patternParts[0];
  const patternSubdomainParts = StringPrototypeSplit.$call(patternSubdomain, "*");

  // Short-circuit when the subdomain does not contain a wildcard.
  // RFC 6125 does not allow wildcard substitution for components
  // containing IDNA A-labels (Punycode) so match those verbatim.
  if (patternSubdomainParts.length === 1 || StringPrototypeIncludes.$call(patternSubdomain, "xn--"))
    return hostSubdomain === patternSubdomain;

  if (!wildcards) return false;

  // More than one wildcard is always wrong.
  if (patternSubdomainParts.length > 2) return false;

  // *.tld wildcards are not allowed.
  if (patternParts.length <= 2) return false;

  const { 0: prefix, 1: suffix } = patternSubdomainParts;

  if (prefix.length + suffix.length > hostSubdomain.length) return false;

  if (!StringPrototypeStartsWith.$call(hostSubdomain, prefix)) return false;

  if (!StringPrototypeEndsWith.$call(hostSubdomain, suffix)) return false;

  return true;
}

// This pattern is used to determine the length of escaped sequences within
// the subject alt names string. It allows any valid JSON string literal.
// This MUST match the JSON specification (ECMA-404 / RFC8259) exactly.
const jsonStringPattern =
  // eslint-disable-next-line no-control-regex
  /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;

function splitEscapedAltNames(altNames) {
  const result = [];
  let currentToken = "";
  let offset = 0;
  while (offset !== altNames.length) {
    const nextSep = StringPrototypeIndexOf.$call(altNames, ", ", offset);
    const nextQuote = StringPrototypeIndexOf.$call(altNames, '"', offset);
    if (nextQuote !== -1 && (nextSep === -1 || nextQuote < nextSep)) {
      // There is a quote character and there is no separator before the quote.
      currentToken += StringPrototypeSubstring.$call(altNames, offset, nextQuote);
      const match = RegExpPrototypeExec.$call(jsonStringPattern, StringPrototypeSubstring.$call(altNames, nextQuote));
      if (!match) {
        throw $ERR_TLS_CERT_ALTNAME_FORMAT();
      }
      currentToken += JSON.parse(match[0]);
      offset = nextQuote + match[0].length;
    } else if (nextSep !== -1) {
      // There is a separator and no quote before it.
      currentToken += StringPrototypeSubstring.$call(altNames, offset, nextSep);
      ArrayPrototypePush.$call(result, currentToken);
      currentToken = "";
      offset = nextSep + 2;
    } else {
      currentToken += StringPrototypeSubstring.$call(altNames, offset);
      offset = altNames.length;
    }
  }
  ArrayPrototypePush.$call(result, currentToken);
  return result;
}

function checkServerIdentity(hostname, cert) {
  const subject = cert.subject;
  const altNames = cert.subjectaltname;
  const dnsNames = [];
  const ips = [];

  hostname = "" + hostname;

  if (altNames) {
    const splitAltNames = StringPrototypeIncludes.$call(altNames, '"')
      ? splitEscapedAltNames(altNames)
      : StringPrototypeSplit.$call(altNames, ", ");
    ArrayPrototypeForEach.$call(splitAltNames, name => {
      if (StringPrototypeStartsWith.$call(name, "DNS:")) {
        ArrayPrototypePush.$call(dnsNames, StringPrototypeSlice.$call(name, 4));
      } else if (StringPrototypeStartsWith.$call(name, "IP Address:")) {
        ArrayPrototypePush.$call(ips, canonicalizeIP(StringPrototypeSlice.$call(name, 11)));
      }
    });
  }

  let valid = false;
  let reason = "Unknown reason";

  hostname = unfqdn(hostname); // Remove trailing dot for error messages.
  if (net.isIP(hostname)) {
    valid = ArrayPrototypeIncludes.$call(ips, canonicalizeIP(hostname));
    if (!valid) reason = `IP: ${hostname} is not in the cert's list: ` + ArrayPrototypeJoin.$call(ips, ", ");
  } else {
    const hasDnsNames = dnsNames.length > 0;
    if (hasDnsNames || subject?.CN) {
      const hostParts = splitHost(hostname);
      const wildcard = pattern => check(hostParts, pattern, true);

      if (hasDnsNames) {
        valid = ArrayPrototypeSome.$call(dnsNames, wildcard);
        if (!valid) reason = `Host: ${hostname}. is not in the cert's altnames: ${altNames}`;
      } else {
        // Match against Common Name only if no supported identifiers exist.
        const cn = subject.CN;

        if (Array.isArray(cn)) valid = ArrayPrototypeSome.$call(cn, wildcard);
        else if (cn) valid = wildcard(cn);

        if (!valid) reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
      }
    } else {
      reason = "Cert does not contain a DNS name";
    }
  }
  if (!valid) {
    return $ERR_TLS_CERT_ALTNAME_INVALID(reason, hostname, cert);
  }
}

// Native SSL_CTX wrapper. `intern()` is WeakGCMap-memoised by config digest
// (the native `SSLContextCache` underneath is shared with every native consumer
// — Postgres, Valkey, `Bun.connect`, …), so identical options return the same
// native handle and the same `SSL_CTX*`. Replaces the SHA-256/WeakRef cache
// that used to live in this file.
const NativeSecureContext = getNativeSecureContext();

// Node treats any falsy key/cert/ca as "not provided" (test-tls-options-
// boolean-check.js exercises false/0/""). The bindgen SSLConfigFile union only
// accepts null|string|ArrayBuffer|Blob|array, so coerce falsy → null before
// crossing into native so `{ key: false }` etc. doesn't throw
// ERR_INVALID_ARG_TYPE from the bindgen layer.
function newNativeSecureContext(options, cached = true) {
  maybeWarnAboutExtraCACerts();
  // tls.createSecureContext() with no options still goes through the version
  // translation below so the module-level DEFAULT_MIN/MAX_VERSION apply.
  options = options == null ? {} : processPfxOptions(options);
  // PKCS#12-embedded CAs extend the trust set after the context is built; a
  // mutated context must not be the shared cached one.
  const pfxExtraCAs = options._pfxExtraCACerts;
  if (pfxExtraCAs) cached = false;
  // ALPN protocols given as an array of strings are converted to the
  // length-prefixed wire format before crossing into native, the way Node's
  // convertALPNProtocols normalizes them on the socket options.
  const ALPNProtocols = options.ALPNProtocols;
  if (Array.isArray(ALPNProtocols)) {
    const normalized = {};
    convertALPNProtocols(ALPNProtocols, normalized);
    options = { ...options, ALPNProtocols: normalized.ALPNProtocols };
  }
  if (options) {
    const { key, cert, ca } = options;
    if (!key || !cert || !ca) {
      options = {
        ...options,
        key: key || null,
        cert: cert || null,
        ca: ca || null,
      };
    }
  }
  if (options) {
    // Read each option once. Translate minVersion/maxVersion/secureProtocol to
    // the integer protocol range the native layer applies, so the bindings
    // receive numbers, not the user-facing strings. When none are given the
    // module-level tls.DEFAULT_MIN_VERSION / DEFAULT_MAX_VERSION apply, the
    // way Node's createSecureContext does.
    options = {
      ...options,
      ...resolveTLSVersionRange(options.secureProtocol, options.minVersion, options.maxVersion),
    };
  }
  const ctx = (cached ? NativeSecureContext.intern : NativeSecureContext.createPrivate)(options);
  if (pfxExtraCAs) {
    for (const pem of pfxExtraCAs) ctx.addCACert(pem);
  }
  return ctx;
}

var InternalSecureContext = class SecureContext {
  context;
  servername;

  constructor(options, cached = true) {
    // When tls.setDefaultCACertificates() has installed an override and no
    // explicit `ca` was given, use the override as the default CA set so the
    // process-wide default applies on every construction path (the public
    // createSecureContext(), the connect/TLSSocket path, addContext and
    // setSecureContext), matching Node's secure-context default.
    if (_defaultCACertificatesOverride !== undefined && (options == null || options.ca == null)) {
      options = { ...options, ca: _defaultCACertificatesOverride };
    }
    if (options) {
      validateSecureContextOptions(options);
      const cert = options.cert;
      if (cert) throwOnInvalidTLSArray("options.cert", cert);
      const key = options.key;
      if (key) throwOnInvalidTLSArray("options.key", key);
      const ca = options.ca;
      if (ca) throwOnInvalidTLSArray("options.ca", ca);
      if (options.servername != null && typeof options.servername !== "string")
        throw new TypeError("servername argument must be an string");
      if (options.secureOptions != null && typeof options.secureOptions !== "number")
        throw new TypeError("secureOptions argument must be an number");
      const privateKeyIdentifier = options.privateKeyIdentifier;
      if (!$isUndefinedOrNull(privateKeyIdentifier)) {
        const privateKeyEngine = options.privateKeyEngine;
        if ($isUndefinedOrNull(privateKeyEngine))
          throw $ERR_INVALID_ARG_VALUE("options.privateKeyEngine", privateKeyEngine);
        if (typeof privateKeyEngine !== "string")
          throw $ERR_INVALID_ARG_TYPE("options.privateKeyEngine", ["string", "null", "undefined"], privateKeyEngine);
        if (typeof privateKeyIdentifier !== "string")
          throw $ERR_INVALID_ARG_TYPE(
            "options.privateKeyIdentifier",
            ["string", "null", "undefined"],
            privateKeyIdentifier,
          );
      }
    }
    // The native handle (SSL_CTX wrapper) is what's memoised — not this JS
    // object — so per-call fields like `servername` come from THIS call's
    // options while the expensive SSL_CTX is shared.
    this.context = newNativeSecureContext(options, cached);
    this.servername = options?.servername;
  }
};

function SecureContext(options): void {
  return new InternalSecureContext(options) as never;
}

function createSecureContext(options) {
  if (options instanceof InternalSecureContext) return options;
  // The setDefaultCACertificates() override is applied inside the
  // InternalSecureContext constructor so every construction path honors it.
  // The native handle (SSL_CTX) is memoised inside `NativeSecureContext.intern`
  // by the per-VM `SSLContextCache`, so no JS-side hashing here. The JS wrapper
  // is built fresh because it carries the per-call `servername`.
  // The user-facing constructor owns its SSL_CTX exclusively so addCACert
  // cannot leak across contexts; internal connect/listen paths stay cached.
  return new InternalSecureContext(options, false);
}

// Translate some fields from the handle's C-friendly format into more idiomatic
// javascript object representations before passing them back to the user.  Can
// be used on any cert object, but changing the name would be semver-major.
function translatePeerCertificate(c) {
  return c;
}

const ksecureContext = Symbol("ksecureContext");
const kcheckServerIdentity = Symbol("kcheckServerIdentity");
const ksession = Symbol("ksession");
const krenegotiationDisabled = Symbol("renegotiationDisabled");

const buntls = Symbol.for("::buntls::");
// net.ts's SNI dispatch uses this to recognize a raw native SecureContext
// (Node's `context.context || context` unwrap accepts both the wrapper and
// the unwrapped native context).
const kNativeSecureContextCtor = Symbol.for("::buntlsnativesecurecontextctor::");

function TLSSocket(socket?, options?) {
  this[ksecureContext] = undefined;
  this.ALPNProtocols = undefined;
  this[kcheckServerIdentity] = undefined;
  this[ksession] = undefined;
  this.alpnProtocol = null;
  this._secureEstablished = false;
  this._rejectUnauthorized = rejectUnauthorizedDefault();
  this._securePending = true;
  this._newSessionPending = undefined;
  this._controlReleased = undefined;
  this.secureConnecting = false;
  this._SNICallback = undefined;
  this.servername = undefined;
  this.authorized = false;
  void this.authorizationError;
  this[krenegotiationDisabled] = undefined;
  this.encrypted = true;

  const isNetSocketOrDuplex = socket instanceof Duplex;

  // A provided underlying socket must be a Duplex/net.Socket. An event emitter
  // that isn't a stream (e.g. a bare EventEmitter) is not a valid socket — Node
  // throws when wrapping it. Distinguished from a TLS options object, which is
  // not an EventEmitter.
  if (socket != null && !isNetSocketOrDuplex && socket instanceof EventEmitter) {
    throw $ERR_INVALID_ARG_TYPE("socket", "Duplex", socket);
  }

  options = isNetSocketOrDuplex ? { ...options, allowHalfOpen: false } : options || socket || {};

  NetSocket.$call(this, options);

  // A server-side TLSSocket is created with { isServer: true }; track it so
  // server-only guards (e.g. setServername throwing ERR_TLS_SNI_FROM_SERVER)
  // behave like Node. Accepted sockets set this again in onconnection.
  const isServer = !!options.isServer;
  this.isServer = isServer;

  // A custom SNICallback must be a function — but Node only validates it on the
  // server side (it is meaningless for a client), inside the isServer branch.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/wrap.js#L929
  if (isServer) {
    const sniCallback = options.SNICallback;
    if (sniCallback != null) {
      validateFunction(sniCallback, "options.SNICallback");
      this._SNICallback = sniCallback;
    }
    const alpnCallback = options.ALPNCallback;
    if (alpnCallback != null) {
      validateFunction(alpnCallback, "options.ALPNCallback");
      if (options.ALPNProtocols) {
        throw $ERR_TLS_ALPN_CALLBACK_WITH_PROTOCOLS();
      }
      this._ALPNCallback = alpnCallback;
    }
  }

  this.ciphers = options.ciphers;
  if (this.ciphers) {
    validateCiphers(options.ciphers);
  }

  if (typeof options === "object") {
    const { ALPNProtocols } = options;
    if (ALPNProtocols) {
      convertALPNProtocols(ALPNProtocols, this);
    }

    if (isNetSocketOrDuplex && !this.isServer) {
      this._handle = socket;
      // keep compatibility with http2-wrapper or other places that try to grab JSStreamSocket in node.js, with here is just the TLSSocket
      this._handle._parentWrap = this;
    }
    // For the server wrap, _handle is assigned the upgraded TLS handle by the
    // server-upgrade method below; leaving it unset until then means a synchronous
    // teardown during upgradeTLS won't call close() on the bare net.Socket.
  }
  // Internal path: keep the per-digest cache (only the user-facing
  // tls.createSecureContext() owns its SSL_CTX exclusively).
  this[ksecureContext] = options.secureContext || new InternalSecureContext(options);
  this.authorized = false;
  this.secureConnecting = true;
  this._secureEstablished = false;
  this._securePending = true;
  const checkServerIdentityOption = options.checkServerIdentity;
  if (checkServerIdentityOption !== undefined) {
    validateFunction(checkServerIdentityOption, "options.checkServerIdentity");
  }
  this[kcheckServerIdentity] = checkServerIdentityOption || checkServerIdentity;
  this[ksession] = options.session || null;

  // `new tls.TLSSocket(socket, { isServer: true })`: drive the server-side TLS
  // handshake over the provided socket via net.ts's native upgrade path (reaches
  // the module-private kupgraded + the shared ServerHandlers). Client-side wraps
  // go through the connect path elsewhere.
  if (isNetSocketOrDuplex && this.isServer) {
    this[Symbol.for("::bunUpgradeServerTLS::")](socket, this[buntls](null, null));
  }
}
$toClass(TLSSocket, "TLSSocket", NetSocket);

TLSSocket.prototype._destroySSL = function _destroySSL() {
  // Releases the TLS state for this socket; the connection itself is torn
  // down by the caller (Node's callers always destroy() right after). The
  // native socket frees its SSL when it closes, so there is nothing to free
  // separately here.
  this.secureConnecting = false;
  this._secureEstablished = false;
};

TLSSocket.prototype._start = function _start() {
  // some frameworks uses this _start internal implementation is suposed to start TLS handshake/connect
  this.connect();
};

TLSSocket.prototype._final = function _final(callback) {
  // Defer the FIN until the TLS handshake completes. net.Socket._final calls
  // socket.shutdown(), which while SSL is still in init half-closes the write
  // side before the client's TLS Finished is flushed — the peer then sees a
  // bare FIN and reports ECONNRESET (e.g. socket.end('') right after
  // tls.connect()). Node's native TLSWrap.DoShutdown likewise flushes the
  // handshake output before the underlying stream's FIN.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/src/crypto/crypto_tls.cc#L1203
  // A never-connected TLSSocket (e.g. new tls.TLSSocket().end(cb)) has no handle
  // and no handshake to wait for; finish immediately like NetSocket._final's
  // no-handle fast path, otherwise the deferred callback would never fire.
  if (!this._handle) return callback();
  if (this.secureConnecting) {
    return this.once("secureConnect", NetSocket.prototype._final.bind(this, callback));
  }
  return NetSocket.prototype._final.$call(this, callback);
};

TLSSocket.prototype.getSession = function getSession() {
  return this._handle?.getSession?.();
};

TLSSocket.prototype.getEphemeralKeyInfo = function getEphemeralKeyInfo() {
  const info = this._handle?.getEphemeralKeyInfo?.();
  if (info == null) return info;
  // Empirically node always surfaces all three keys here (values undefined when
  // absent): a client socket on a TLS 1.3 ECDHE session observes
  // Object.keys(...) === ['type','name','size'] under node v26.3.0, so the
  // reshape below is required for key-set parity with our native return.
  return { type: info.type, name: info.name, size: info.size };
};

TLSSocket.prototype.getCipher = function getCipher() {
  return this._handle?.getCipher?.();
};

TLSSocket.prototype.getSharedSigalgs = function getSharedSigalgs() {
  return this._handle?.getSharedSigalgs?.();
};

TLSSocket.prototype.getProtocol = function getProtocol() {
  // Node returns the negotiated protocol string, or null once the socket is no
  // longer connected (e.g. after 'close').
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/_tls_wrap.js#L1455
  return this._handle?.getTLSVersion?.() ?? null;
};

TLSSocket.prototype.getFinished = function getFinished() {
  return this._handle?.getTLSFinishedMessage?.() || undefined;
};

TLSSocket.prototype.getPeerFinished = function getPeerFinished() {
  return this._handle?.getTLSPeerFinishedMessage?.() || undefined;
};

TLSSocket.prototype.isSessionReused = function isSessionReused() {
  return this._handle?.isSessionReused?.() ?? false;
};

TLSSocket.prototype.renegotiate = function renegotiate(options, callback) {
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

  if (this[krenegotiationDisabled]) {
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
};

TLSSocket.prototype.disableRenegotiation = function disableRenegotiation() {
  this[krenegotiationDisabled] = true;
  // disable renegotiation on the socket
  return this._handle?.disableRenegotiation?.();
};

TLSSocket.prototype.getTLSTicket = function getTLSTicket() {
  return this._handle?.getTLSTicket?.();
};

TLSSocket.prototype.setKeyCert = function setKeyCert(context) {
  // Serve this connection's identity from the given context (Node calls this
  // from ALPNCallback/SNICallback before the certificate is sent). Accepts a
  // SecureContext or the same options object createSecureContext takes.
  const ctx = context?.context ? context : new InternalSecureContext(context);
  this._handle?.setKeyCert?.(ctx.context);
};

TLSSocket.prototype.exportKeyingMaterial = function exportKeyingMaterial(length, label, context) {
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
};

TLSSocket.prototype.setMaxSendFragment = function setMaxSendFragment(size) {
  return this._handle?.setMaxSendFragment?.(size) || false;
};

TLSSocket.prototype.enableTrace = function enableTrace() {
  // only for debug purposes so we just mock for now
};

TLSSocket.prototype.setServername = function setServername(name) {
  validateString(name, "name");
  if (this.isServer) {
    throw $ERR_TLS_SNI_FROM_SERVER();
  }
  // if the socket is detached we can't set the servername but we set this property so when open will auto set to it
  this.servername = name;
  this._handle?.setServername?.(name);
};

TLSSocket.prototype.setSession = function setSession(session) {
  this[ksession] = session;
  if (typeof session === "string") session = Buffer.from(session, "latin1");
  return this._handle?.setSession?.(session);
};

TLSSocket.prototype.getPeerCertificate = function getPeerCertificate(detailed) {
  const handle = this._handle;
  if (handle) {
    // The native parameter means "abbreviated" - the inverse of Node's
    // `detailed`. Detailed requests get the whole chain with
    // issuerCertificate links; everything else gets just the leaf.
    const cert = arguments.length < 1 ? handle.getPeerCertificate?.() : handle.getPeerCertificate?.(!detailed);
    if (cert) {
      return translatePeerCertificate(cert);
    }
    return {};
  }
  return null;
};

TLSSocket.prototype.getCertificate = function getCertificate() {
  // getCertificate is not yet implemented on the native socket
  const cert = this._handle?.getCertificate?.();
  if (cert) {
    // It's not a peer cert, but the formatting is identical.
    return translatePeerCertificate(cert);
  }
};

TLSSocket.prototype.getPeerX509Certificate = function getPeerX509Certificate() {
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
    const cached = seen.get(chainCert);
    if (cached) return cached;
    const x509 = new X509Certificate(chainCert.raw);
    seen.set(chainCert, x509);
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
};

TLSSocket.prototype.getX509Certificate = function getX509Certificate() {
  return this._handle?.getX509Certificate?.();
};

TLSSocket.prototype[buntls] = function (port, host) {
  const ctx = this[ksecureContext];
  // RFC 6066 forbids IP literals in SNI. Match Node.js: only default servername to host
  // when host is not an IP. For IP hosts, pass "" so the native layer skips SNI instead of
  // falling back to the connection host.
  let servername = this.servername || ctx?.servername;
  if (servername === undefined) {
    servername = host && !net.isIP(host) ? host : "";
  }
  return {
    socket: this._handle,
    ALPNProtocols: this.ALPNProtocols,
    checkServerIdentity: this[kcheckServerIdentity],
    session: this[ksession],
    rejectUnauthorized: this._rejectUnauthorized,
    requestCert: this._requestCert,
    ciphers: this.ciphers,
    // Hand the native SSL_CTX wrapper to upgradeTLS so it can up_ref instead
    // of rebuilding from raw cert/key bytes.
    secureContext: ctx?.context,
    servername,
  };
};

let CLIENT_RENEG_LIMIT = 3,
  CLIENT_RENEG_WINDOW = 600;

function Server(options, secureConnectionListener): void {
  if (!(this instanceof Server)) {
    return new Server(options, secureConnectionListener);
  }

  // tls.createServer(options) requires an object (a function is the connection
  // listener); matches Node throwing ERR_INVALID_ARG_TYPE for e.g. a string.
  if (options != null && typeof options !== "object" && typeof options !== "function") {
    throw $ERR_INVALID_ARG_TYPE("options", "object", options);
  }
  // A custom SNICallback must be a function.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/wrap.js#L929
  if (options != null && typeof options === "object") {
    const sniCallback = options.SNICallback;
    if (sniCallback != null) {
      validateFunction(sniCallback, "options.SNICallback");
      this._SNICallback = sniCallback;
    }
    const alpnCallback = options.ALPNCallback;
    if (alpnCallback != null) {
      validateFunction(alpnCallback, "options.ALPNCallback");
      // Node forbids combining the dynamic callback with a static list.
      if (options.ALPNProtocols) {
        throw $ERR_TLS_ALPN_CALLBACK_WITH_PROTOCOLS();
      }
      this._ALPNCallback = alpnCallback;
    }
  }

  NetServer.$apply(this, [options, secureConnectionListener]);

  this.key = undefined;
  this.cert = undefined;
  this.ca = undefined;
  this.passphrase = undefined;
  this.secureOptions = undefined;
  this._rejectUnauthorized = rejectUnauthorizedDefault();
  this._requestCert = undefined;
  this.servername = undefined;
  this.ALPNProtocols = undefined;

  let contexts: Map<string, typeof InternalSecureContext> | null = null;

  this.addContext = function (hostname, context) {
    if (typeof hostname !== "string") {
      throw new TypeError("hostname must be a string");
    }
    if (!(context instanceof InternalSecureContext)) {
      context = new InternalSecureContext(context);
    }
    const handle = this._handle;
    if (handle) {
      // Pass the native SSL_CTX wrapper, not the JS InternalSecureContext —
      // the native side detects it via SecureContext.fromJS and up_refs.
      addServerName(handle, hostname, context.context);
    } else {
      if (!contexts) contexts = new Map();
      contexts.set(hostname, context);
    }
  };

  this.setSecureContext = function (options) {
    if (options instanceof InternalSecureContext) {
      options = options.context;
    }
    if (options) {
      validateSecureContextOptions(options);
      options = processPfxOptions(options);
      const { ALPNProtocols } = options;

      if (ALPNProtocols) {
        convertALPNProtocols(ALPNProtocols, this);
      } else {
        // An omitted ALPNProtocols clears the previous call's protocols.
        this.ALPNProtocols = undefined;
      }

      let cert = options.cert;
      // Assign unconditionally so a later setSecureContext() that omits an
      // option clears the previous call's value (Node resets each omitted
      // field) instead of silently keeping stale key material.
      if (cert) {
        throwOnInvalidTLSArray("options.cert", cert);
      }
      this.cert = cert;

      let key = options.key;
      if (key) {
        throwOnInvalidTLSArray("options.key", key);
      }
      this.key = key;

      // BoringSSL rejects a mixed EC/RSA multi-identity configuration while
      // loading the chain. The native context is built lazily at listen time,
      // so surface the most common mismatch synchronously here: a key whose
      // type differs from its own index-paired certificate. This is a
      // best-effort check - the native loader at listen time remains the
      // authority and still rejects configurations that pass it.
      const keyLength = Array.isArray(key) ? key.length : 0;
      if (keyLength > 1 && cert) {
        const certs = Array.isArray(cert) ? cert : [cert];
        try {
          const { createPrivateKey, X509Certificate } = require("node:crypto");
          for (let i = 0; i < keyLength; i++) {
            const k = key[i];
            if (typeof k !== "string" && !$isTypedArrayView(k)) continue;
            const pairedCert = certs[i < certs.length ? i : certs.length - 1];
            const certType = new X509Certificate(pairedCert).publicKey.asymmetricKeyType;
            if (createPrivateKey(k).asymmetricKeyType !== certType) {
              const err = new Error(
                "error:0b000074:X.509 certificate routines:OPENSSL_internal:KEY_TYPE_MISMATCH",
              ) as Error & { code: string; library: string; function: string; reason: string };
              err.code = "ERR_OSSL_X509_KEY_TYPE_MISMATCH";
              err.library = "X.509 certificate routines";
              err.function = "OPENSSL_internal";
              err.reason = "KEY_TYPE_MISMATCH";
              throw err;
            }
          }
        } catch (e: any) {
          if (e?.code === "ERR_OSSL_X509_KEY_TYPE_MISMATCH") throw e;
          // An unparseable key or certificate falls through to the native
          // load, which produces its own error.
        }
      }

      let ca = options.ca;
      // The process-wide default-CA override (tls.setDefaultCACertificates)
      // applies here too when no explicit `ca` was given: this path hands raw
      // {key, cert, ca} to the native listener and never goes through
      // InternalSecureContext, so without this an mTLS server would verify
      // client certificates against the bundled roots instead of the
      // overridden defaults.
      if (_defaultCACertificatesOverride !== undefined && ca == null) {
        ca = _defaultCACertificatesOverride;
      }
      // PKCS#12-embedded CAs are stashed separately so createSecureContext can
      // extend (not replace) the default trust set via addCACert. The server
      // path hands raw {key, cert, ca} to the native listener and has no
      // addCACert hook, so fold them into `ca` here - an mTLS server should
      // verify client certificates against the bundle's own CA chain.
      ca = foldPfxExtraCAs(ca, options._pfxExtraCACerts);
      if (ca) {
        throwOnInvalidTLSArray("options.ca", ca);
      }
      this.ca = ca;

      let passphrase = options.passphrase;
      if (passphrase && typeof passphrase !== "string") {
        throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
      }
      this.passphrase = passphrase;

      let servername = options.servername;
      if (servername && typeof servername !== "string") {
        throw $ERR_INVALID_ARG_TYPE("options.servername", "string", servername);
      }
      this.servername = servername;

      let secureOptions = options.secureOptions || 0;
      if (secureOptions && typeof secureOptions !== "number") {
        throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
      }
      this.secureOptions = secureOptions;

      const requestCert = options.requestCert || false;

      if (requestCert) this._requestCert = requestCert;
      else this._requestCert = undefined;

      const rejectUnauthorized = options.rejectUnauthorized;

      if (typeof rejectUnauthorized !== "undefined") {
        this._rejectUnauthorized = rejectUnauthorized;
      } else this._rejectUnauthorized = rejectUnauthorizedDefault();

      const ciphers = options.ciphers;
      if (typeof ciphers !== "undefined") {
        if (typeof ciphers !== "string") {
          throw $ERR_INVALID_ARG_TYPE("options.ciphers", "string", ciphers);
        }

        validateCiphers(ciphers);
      }
      // Unconditional so an omitted `ciphers` clears the previous value.
      this.ciphers = options.ciphers;

      // Pin the protocol version range the server will negotiate.
      // validateSecureContextOptions already rejected unknown method names.
      // Assign unconditionally so a later setSecureContext() without these
      // options clears the previous call's version constraints instead of
      // re-applying them on the next listen.
      this.secureProtocol = options.secureProtocol;
      this.minVersion = options.minVersion;
      this.maxVersion = options.maxVersion;
    }
  };

  // Lets net.ts's SNI dispatch recognize a raw native SecureContext handed to
  // an SNICallback (the `context.context || context` unwrap accepts both the
  // wrapper and the unwrapped native context).
  Server.prototype[kNativeSecureContextCtor] = NativeSecureContext;

  Server.prototype.getTicketKeys = function () {
    throw Error("Not implented in Bun yet");
  };

  Server.prototype.setTicketKeys = function (keys) {
    if (!ArrayBuffer.isView(keys)) {
      throw $ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView"], keys);
    }
    if (keys.byteLength !== 48) {
      throw $ERR_INVALID_ARG_VALUE("buffer", keys, "Session ticket keys must be a 48-byte buffer");
    }
    throw Error("Not implented in Bun yet");
  };

  this[buntls] = function (port, host, isClient) {
    return [
      {
        serverName: this.servername || host || "localhost",
        key: this.key,
        cert: this.cert,
        ca: this.ca,
        passphrase: this.passphrase,
        secureOptions: this.secureOptions,
        rejectUnauthorized: this._rejectUnauthorized,
        requestCert: isClient ? true : this._requestCert,
        ALPNProtocols: this.ALPNProtocols,
        clientRenegotiationLimit: CLIENT_RENEG_LIMIT,
        clientRenegotiationWindow: CLIENT_RENEG_WINDOW,
        contexts: contexts,
        ciphers: this.ciphers,
        // Translate minVersion/maxVersion/secureProtocol to the integer
        // protocol range the native layer applies (secureProtocol wins, like
        // Node's SecureContext::Init). When none are given the module-level
        // tls.DEFAULT_MIN_VERSION / DEFAULT_MAX_VERSION apply.
        ...resolveTLSVersionRange(this.secureProtocol, this.minVersion, this.maxVersion),
      },
      TLSSocket,
    ];
  };

  this.setSecureContext(options);
  maybeWarnAboutExtraCACerts();
  // Matches Node's tls.Server handshakeTimeout default + validation:
  // https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/internal/tls/wrap.js#L1386
  const handshakeTimeout = (options && options.handshakeTimeout) || 120 * 1000;
  validateNumber(handshakeTimeout, "options.handshakeTimeout");
  this._handshakeTimeout = handshakeTimeout;
}
$toClass(Server, "Server", NetServer);

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
const DEFAULT_ECDH_CURVE = "auto";

function normalizeConnectArgs(listArgs) {
  const args = net._normalizeArgs(listArgs);
  $assert($isObject(args[0]));

  // If args[0] was options, then normalize dealt with it.
  // If args[0] is port, or args[0], args[1] is host, port, we need to
  // find the options and merge them in, normalize's options has only
  // the host/port/path args that it knows about, not the tls options.
  // This means that options.host overrides a host arg.
  if (listArgs[1] !== null && typeof listArgs[1] === "object") {
    ObjectAssign(args[0], listArgs[1]);
  } else if (listArgs[2] !== null && typeof listArgs[2] === "object") {
    ObjectAssign(args[0], listArgs[2]);
  }

  return args;
}

// tls.connect(options[, callback])
// tls.connect(path[, options][, callback])
// tls.connect(port[, host][, options][, callback])
function connect(...args) {
  let normal = normalizeConnectArgs(args);
  const options = normal[0];
  const { ALPNProtocols, servername } = options as { ALPNProtocols?: unknown; servername?: unknown };

  if ("checkServerIdentity" in options) {
    // Node validates whenever the key is present - an explicit `undefined`
    // throws ERR_INVALID_ARG_TYPE (test-tls-basic-validations).
    validateFunction(options.checkServerIdentity, "options.checkServerIdentity");
  }

  if (servername && net.isIP(servername)) {
    throw $ERR_INVALID_ARG_VALUE(
      "options.servername",
      servername,
      "Setting the TLS ServerName to an IP address is not permitted.",
    );
  }

  if (ALPNProtocols) {
    convertALPNProtocols(ALPNProtocols, options);
  }

  const tlssock = new TLSSocket(options);
  // Honor the `timeout` option here: Socket.prototype.connect does not (only
  // the net.createConnection factory does), so tls.connect applies it
  // explicitly, exactly like Node's tls connect.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/wrap.js#L1791
  const timeout = options.timeout;
  if (timeout) {
    tlssock.setTimeout(timeout);
  }
  return tlssock.connect(normal);
}

function getCiphers() {
  return getDefaultCiphers().split(":");
}

let bundledRootCertificates: string[] | undefined;
function cacheBundledRootCertificates(): string[] {
  bundledRootCertificates ||= getBundledRootCertificates() as string[];
  return bundledRootCertificates;
}
const getUseSystemCA = $newRustFunction("bun.rs", "getUseSystemCA", 0);

let defaultCACertificates: string[] | undefined;
function cacheDefaultCACertificates() {
  if (defaultCACertificates) return defaultCACertificates;
  defaultCACertificates = [];

  const bundled = cacheBundledRootCertificates();
  for (let i = 0; i < bundled.length; ++i) {
    ArrayPrototypePush.$call(defaultCACertificates, bundled[i]);
  }

  // Include system certificates when --use-system-ca is set or NODE_USE_SYSTEM_CA=1
  if (getUseSystemCA() || process.env.NODE_USE_SYSTEM_CA === "1") {
    const system = cacheSystemCACertificates();
    for (let i = 0; i < system.length; ++i) {
      ArrayPrototypePush.$call(defaultCACertificates, system[i]);
    }
  }

  if (process.env.NODE_EXTRA_CA_CERTS) {
    const extra = cacheExtraCACertificates();
    for (let i = 0; i < extra.length; ++i) {
      ArrayPrototypePush.$call(defaultCACertificates, extra[i]);
    }
  }

  ObjectFreeze(defaultCACertificates);
  return defaultCACertificates;
}

let systemCACertificates: string[] | undefined;
function cacheSystemCACertificates(): string[] {
  systemCACertificates ||= getSystemCACertificates() as string[];
  return systemCACertificates;
}

let extraCACertificates: string[] | undefined;
function cacheExtraCACertificates(): string[] {
  extraCACertificates ||= getExtraCACertificates() as string[];
  return extraCACertificates;
}

let warnedAboutExtraCACerts = false;
/**
 * Match Node's crypto_context.cc: a NODE_EXTRA_CA_CERTS file that cannot be
 * loaded is ignored with a one-time warning on stderr - emitted when the
 * first secure context is created, not at startup - rather than failing the
 * process. The reason text mirrors the strerror()-derived string Node prints.
 */
function maybeWarnAboutExtraCACerts() {
  if (warnedAboutExtraCACerts) return;
  warnedAboutExtraCACerts = true;
  const extraPath = process.env.NODE_EXTRA_CA_CERTS;
  if (!extraPath) return;
  try {
    require("node:fs").accessSync(extraPath);
  } catch (err: any) {
    // Node prints this with a raw fprintf(stderr, ...) from
    // crypto_context.cc, not through process.emitWarning - no pid prefix and
    // no colorization.
    process.stderr.write(
      `Warning: Ignoring extra certs from \`${extraPath}\`, load failed: ${
        err?.code === "ENOENT" ? "No such file or directory" : err?.message
      }\n`,
    );
  }
}

// Runtime override for the "default" CA certificate set, installed by
// tls.setDefaultCACertificates(). undefined = no override (use the real
// bundled/system default). Only affects type "default"/implicit — "bundled",
// "system" and "extra" are unchanged.
// https://github.com/nodejs/node/blob/main/lib/internal/tls/secure-context.js
let _defaultCACertificatesOverride: Array<string> | undefined;

type CACertInput = string | NodeJS.ArrayBufferView;
interface X509CertificateLike {
  readonly fingerprint256: string;
  toString(): string;
}
type X509CertificateCtor = new (cert: CACertInput) => X509CertificateLike;
let _X509CertificateClass: X509CertificateCtor | undefined;

// tls.setDefaultCACertificates(certs)
// https://github.com/nodejs/node/blob/v25.2.1/lib/tls.js#L202
// Node validates `certs` as an Array (its ERR_INVALID_ARG_TYPE renders the
// 'Array' name as "an instance of Array"; Bun's validateArray renders the same
// name as "of type Array", so build the error directly to match Node here),
// then hands the certs to the native root store. Bun has no equivalent native
// store override, so keep a JS-side override that getCACertificates('default')
// and createSecureContext() read.
function setDefaultCACertificates(certs: ReadonlyArray<CACertInput>): void {
  if (!$isArray(certs)) {
    let received: string;
    if (certs === null) received = "null";
    else if (typeof certs === "object") received = `an instance of ${(certs as object).constructor?.name ?? "Object"}`;
    else if (typeof certs === "string") received = `type string ('${certs}')`;
    else received = `type ${typeof certs} (${String(certs)})`;
    const error = new TypeError(`The "certs" argument must be an instance of Array. Received ${received}`) as Error & {
      code: string;
    };
    error.code = "ERR_INVALID_ARG_TYPE";
    throw error;
  }
  _X509CertificateClass ??= require("node:crypto").X509Certificate as X509CertificateCtor;
  // Parse each cert and de-duplicate by fingerprint so getCACertificates()
  // returns a normalized, unique PEM set (matching Node, whose native store
  // collapses duplicates). Build into a temp array and only commit on success,
  // so an invalid element leaves the previous default untouched.
  const seen = new Set<string>();
  const normalized: Array<string> = [];
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (typeof cert !== "string" && !isArrayBufferView(cert)) {
      throw $ERR_INVALID_ARG_TYPE(`certs[${i}]`, "string or an instance of ArrayBufferView", cert);
    }
    // An element may be a concatenated PEM bundle; Node adds every certificate
    // it contains, so split on certificate boundaries before parsing (a single
    // X509Certificate parse only consumes the first block).
    const text =
      typeof cert === "string" ? cert : Buffer.from(cert.buffer, cert.byteOffset, cert.byteLength).toString("latin1");
    const blocks = text.includes("-----BEGIN")
      ? // Keep only the blocks that actually start a PEM certificate: bundle
        // files routinely begin with comment headers (curl's cacert.pem,
        // RHEL's ca-bundle.crt) that the lookahead split leaves as a leading
        // non-PEM element.
        text.split(/(?=-----BEGIN [A-Z0-9 ]*CERTIFICATE-----)/).filter(block => block.includes("CERTIFICATE-----"))
      : [cert];
    for (const block of blocks) {
      const x509 = new _X509CertificateClass(block as CACertInput);
      const fingerprint = x509.fingerprint256;
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        normalized.push(x509.toString());
      }
    }
  }
  _defaultCACertificatesOverride = normalized;
}

function getCACertificates(type = "default") {
  validateString(type, "type");

  switch (type) {
    case "default":
      if (_defaultCACertificatesOverride !== undefined) {
        return _defaultCACertificatesOverride.slice();
      }
      return cacheDefaultCACertificates();
    case "bundled":
      return cacheBundledRootCertificates();
    case "system":
      return cacheSystemCACertificates();
    case "extra":
      return cacheExtraCACertificates();
    default:
      throw $ERR_INVALID_ARG_VALUE("type", type);
  }
}

function tlsCipherFilter(a: string) {
  return !a.startsWith("TLS_");
}

function getDefaultCiphers() {
  // TLS_ will always be present until SSL_CTX_set_cipher_list is supported see default_ciphers.h
  const ciphers = getTLSDefaultCiphers();
  return `TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256${ciphers ? ":" + ciphers : ""}`;
}

export default {
  CLIENT_RENEG_LIMIT,
  CLIENT_RENEG_WINDOW,
  connect,
  convertALPNProtocols,
  createSecureContext,
  createServer,
  get DEFAULT_CIPHERS() {
    return getDefaultCiphers();
  },
  set DEFAULT_CIPHERS(value) {
    if (value) {
      validateCiphers(value, "value");
      // filter out TLS_ ciphers
      const ciphers = value.split(":");
      value = ciphers.filter(tlsCipherFilter).join(":");
    }
    setTLSDefaultCiphers(value);
  },
  DEFAULT_ECDH_CURVE,
  // Accessors so `tls.DEFAULT_MAX_VERSION = 'TLSv1.2'` reaches the
  // module-level variables that context construction reads (Node mutates the
  // exports object the same way).
  get DEFAULT_MAX_VERSION() {
    return getDefaultMaxVersion();
  },
  set DEFAULT_MAX_VERSION(value) {
    setDefaultMaxVersion(value);
  },
  get DEFAULT_MIN_VERSION() {
    return getDefaultMinVersion();
  },
  set DEFAULT_MIN_VERSION(value) {
    setDefaultMinVersion(value);
  },
  getCiphers,
  setDefaultCACertificates,
  parseCertString,
  SecureContext,
  Server,
  TLSSocket,
  checkServerIdentity,
  get rootCertificates() {
    return cacheBundledRootCertificates();
  },
  getCACertificates,
} as any as typeof import("node:tls");
