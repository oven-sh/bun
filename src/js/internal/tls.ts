const { isTypedArray, isArrayBuffer, isArrayBufferView } = require("node:util/types");
const { validateString, validateBuffer } = require("internal/validators");

const StringPrototypeSplit: (this: string, separator: string | RegExp, limit?: number) => string[] =
  String.prototype.split;
const StringPrototypeReplace: (this: string, searchValue: string | RegExp, replaceValue: string) => string =
  String.prototype.replace;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeIncludes = String.prototype.includes;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeSome = Array.prototype.some;
const ArrayPrototypeMap = Array.prototype.map;

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

// Node's exact wording for invalid key/cert/ca options. Bun additionally
// accepts BunFile values (isValidTLSItem), but the message must match Node:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L74-L87
const VALID_TLS_ERROR_MESSAGE_TYPES = "string or an instance of Buffer, TypedArray, or DataView";

const protocolVersionCode: (name: string) => number = $bindgen("SSLConfig.bind.ts", "protocolVersionCode");

// The code SSL_CTX_set_min/max_proto_version takes, 0 for none. A `fallback` that names no version counts as none, as on 1.4.4 (Node throws).
function toProtocolVersion(which: string, version: unknown, fallback: unknown) {
  if (version == null) return typeof fallback === "string" ? protocolVersionCode(fallback) : 0;
  const code = typeof version === "string" ? protocolVersionCode(version) : 0;
  if (code === 0) throw $ERR_TLS_INVALID_PROTOCOL_VERSION(JSON.stringify(version), which);
  return code;
}

// Matches Node: SSLv2/SSLv3 methods are disabled, anything unrecognized is an
// unknown method (THROW_ERR_TLS_INVALID_PROTOCOL_METHOD in
// src/crypto/crypto_context.cc SecureContext::Init).
let _SECURE_PROTOCOL_METHODS: Set<string> | undefined;
function validateSecureProtocol(
  secureProtocol: string | null | undefined,
  minVersion: string | null | undefined,
  maxVersion: string | null | undefined,
) {
  if (secureProtocol === undefined || secureProtocol === null) return;
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/common.js#L78
  if (secureProtocol) {
    if (minVersion != null)
      throw $ERR_TLS_PROTOCOL_VERSION_CONFLICT(JSON.stringify(minVersion), JSON.stringify(secureProtocol));
    if (maxVersion != null)
      throw $ERR_TLS_PROTOCOL_VERSION_CONFLICT(JSON.stringify(maxVersion), JSON.stringify(secureProtocol));
  }
  if (typeof secureProtocol !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.secureProtocol", "string", secureProtocol);
  }
  let message: string | undefined;
  if (secureProtocol.startsWith("SSLv2_")) message = "SSLv2 methods disabled";
  else if (secureProtocol.startsWith("SSLv3_")) message = "SSLv3 methods disabled";
  else {
    _SECURE_PROTOCOL_METHODS ??= new Set([
      "TLS_method",
      "TLS_client_method",
      "TLS_server_method",
      "SSLv23_method",
      "SSLv23_client_method",
      "SSLv23_server_method",
      "TLSv1_method",
      "TLSv1_client_method",
      "TLSv1_server_method",
      "TLSv1_1_method",
      "TLSv1_1_client_method",
      "TLSv1_1_server_method",
      "TLSv1_2_method",
      "TLSv1_2_client_method",
      "TLSv1_2_server_method",
    ]);
    if (!_SECURE_PROTOCOL_METHODS.has(secureProtocol)) message = `Unknown method: ${secureProtocol}`;
  }
  if (message !== undefined) throw $ERR_TLS_INVALID_PROTOCOL_METHOD(message);
}

// Node's legacy secureProtocol string pins both bounds to a single version
// (e.g. 'TLSv1_2_method'); 'TLS_method'/'SSLv23_method' leave the range open.
// https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/secure-context.js#L120
function secureProtocolToVersionRange(secureProtocol: string | null | undefined) {
  if (typeof secureProtocol !== "string") return null;
  let name;
  if (
    secureProtocol === "TLSv1_method" ||
    secureProtocol === "TLSv1_client_method" ||
    secureProtocol === "TLSv1_server_method"
  )
    name = "TLSv1";
  else if (
    secureProtocol === "TLSv1_1_method" ||
    secureProtocol === "TLSv1_1_client_method" ||
    secureProtocol === "TLSv1_1_server_method"
  )
    name = "TLSv1.1";
  else if (
    secureProtocol === "TLSv1_2_method" ||
    secureProtocol === "TLSv1_2_client_method" ||
    secureProtocol === "TLSv1_2_server_method"
  )
    name = "TLSv1.2";
  else return null;
  const version = protocolVersionCode(name);
  return [version, version];
}

const SUPPORTED_ECDH_GROUPS = new Set([
  "P-256",
  "prime256v1",
  "P-384",
  "secp384r1",
  "P-521",
  "secp521r1",
  "X25519",
  "x25519",
  "X25519MLKEM768",
  "MLKEM1024",
]);

// Subset of Node's configSecureContext() validations:
// https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/internal/tls/secure-context.js#L318
function validateSecureContextOptions(options) {
  const {
    ciphers,
    key,
    passphrase,
    ecdhCurve,
    minVersion,
    maxVersion,
    privateKeyIdentifier,
    privateKeyEngine,
    sessionTimeout,
    sigalgs,
    ticketKeys,
    clientCertEngine,
    dhparam,
    secureProtocol,
  } = options;
  validateSecureProtocol(secureProtocol, minVersion, maxVersion);
  if (ciphers !== undefined && ciphers !== null) validateString(ciphers, "options.ciphers");
  if (passphrase !== undefined && passphrase !== null) validateString(passphrase, "options.passphrase");
  if (sigalgs !== undefined && sigalgs !== null) {
    validateString(sigalgs, "options.sigalgs");
    if (sigalgs === "") throw $ERR_INVALID_ARG_VALUE("options.sigalgs", sigalgs);
  }
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L222 (BoringSSL has no ENGINE support)
  if (privateKeyIdentifier !== undefined && privateKeyIdentifier !== null) {
    if (privateKeyEngine === undefined || privateKeyEngine === null) {
      throw $ERR_INVALID_ARG_VALUE("options.privateKeyEngine", privateKeyEngine);
    }
    if (key) {
      throw $ERR_INVALID_ARG_VALUE("options.privateKeyIdentifier", privateKeyIdentifier);
    }
    if (typeof privateKeyIdentifier !== "string") {
      throw $ERR_INVALID_ARG_TYPE(
        "options.privateKeyIdentifier",
        ["string", "null", "undefined"],
        privateKeyIdentifier,
      );
    }
    if (typeof privateKeyEngine !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.privateKeyEngine", ["string", "null", "undefined"], privateKeyEngine);
    }
    throw $ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED("Custom engines not supported by this OpenSSL");
  }
  if (ecdhCurve !== undefined) {
    validateString(ecdhCurve, "options.ecdhCurve");
    if (ecdhCurve !== "auto") {
      for (const curve of StringPrototypeSplit.$call(ecdhCurve, ":")) {
        if (!SUPPORTED_ECDH_GROUPS.has(curve)) {
          // Not $ERR_*: Node's THROW_ERR_CRYPTO_OPERATION_FAILED has no bracketed
          // toString; test-tls-ecdh-multiple.js pins /Error: Failed to set ECDH curve/.
          const err = new Error("Failed to set ECDH curve") as Error & { code: string };
          err.code = "ERR_CRYPTO_OPERATION_FAILED";
          throw err;
        }
      }
    }
  }
  // clientCertEngine must be a string (engine name); a provided engine then
  // fails because BoringSSL (which Bun always uses) has no OpenSSL ENGINE
  // support, matching Node's setClientCertEngine. Node:
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/secure-context.js#L296
  if (clientCertEngine !== undefined && clientCertEngine !== null) {
    if (typeof clientCertEngine !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.clientCertEngine", ["string", "null", "undefined"], clientCertEngine);
    }
    throw $ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED("Custom engines not supported by this OpenSSL");
  }
  // BoringSSL (always used by Bun) has no automatic DH parameter selection.
  // Matches Node's setDHParam('auto') throwing ERR_CRYPTO_UNSUPPORTED_OPERATION.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/secure-context.js#L254
  if (dhparam === "auto") {
    throw $ERR_CRYPTO_UNSUPPORTED_OPERATION("Automatic DH parameter selection is not supported");
  }
  if (ticketKeys !== undefined && ticketKeys !== null) {
    validateBuffer(ticketKeys, "options.ticketKeys");
    const ticketKeysByteLength = ticketKeys.byteLength;
    if (ticketKeysByteLength !== 48) {
      throw $ERR_INVALID_ARG_VALUE("options.ticketKeys", ticketKeysByteLength, "must be exactly 48 bytes");
    }
  }
  // Negative session timeouts are rejected (min 0), matching Node — newer
  // OpenSSL/BoringSSL do not handle negative values as users expect.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/secure-context.js#L319
  if (sessionTimeout !== undefined && sessionTimeout !== null) {
    // Node validates this with validateInt32(..., 0), whose range message
    // reads ">= 0 && <= 2147483647"; the shared validator here words it
    // differently, so spell the check out to match.
    if (typeof sessionTimeout !== "number") {
      throw $ERR_INVALID_ARG_TYPE("options.sessionTimeout", "number", sessionTimeout);
    }
    if (!Number.isInteger(sessionTimeout)) {
      throw $ERR_OUT_OF_RANGE("options.sessionTimeout", "an integer", sessionTimeout);
    }
    if (sessionTimeout < 0 || sessionTimeout > 2147483647) {
      throw $ERR_OUT_OF_RANGE("options.sessionTimeout", ">= 0 && <= 2147483647", sessionTimeout);
    }
  }
}

// Reads each option by name, as Node does, so an inherited one, a getter and a non-enumerable one count. A spread would drop them.
function readSecureContextOptions(options) {
  return {
    __proto__: null,
    pfx: options.pfx,
    key: options.key,
    passphrase: options.passphrase,
    cert: options.cert,
    clientCertEngine: options.clientCertEngine,
    ca: options.ca,
    minVersion: options.minVersion,
    maxVersion: options.maxVersion,
    secureProtocol: options.secureProtocol,
    crl: options.crl,
    sigalgs: options.sigalgs,
    ciphers: options.ciphers,
    ecdhCurve: options.ecdhCurve,
    dhparam: options.dhparam,
    honorCipherOrder: options.honorCipherOrder,
    secureOptions: options.secureOptions,
    sessionTimeout: options.sessionTimeout,
    ticketKeys: options.ticketKeys,
    privateKeyIdentifier: options.privateKeyIdentifier,
    privateKeyEngine: options.privateKeyEngine,
    allowPartialTrustChain: options.allowPartialTrustChain,
    // Not in Node: what else the native parser takes. ALPNProtocols belongs to the socket, not to the context.
    servername: options.servername,
    serverName: options.serverName,
    keyFile: options.keyFile,
    certFile: options.certFile,
    caFile: options.caFile,
    dhParamsFile: options.dhParamsFile,
    lowMemoryMode: options.lowMemoryMode,
    requestCert: options.requestCert,
    rejectUnauthorized: options.rejectUnauthorized,
    clientRenegotiationLimit: options.clientRenegotiationLimit,
    clientRenegotiationWindow: options.clientRenegotiationWindow,
  };
}

// https.Server takes Node's options only, as on 1.4.4. BoringSSL has no DHE suites to apply dhparam to.
const ignoredByHttpsServer = {
  dhparam: undefined,
  keyFile: undefined,
  certFile: undefined,
  caFile: undefined,
  dhParamsFile: undefined,
  lowMemoryMode: undefined,
  serverName: undefined,
  clientRenegotiationLimit: undefined,
  clientRenegotiationWindow: undefined,
};

const SSL_OP_CIPHER_SERVER_PREFERENCE = 0x00400000;

let NativeSecureContext: $Node.NativeSecureContextConstructor | undefined;

/**
 * Node's `pfx` option: parse each PKCS#12 blob into PEM key/cert/ca and fold
 * them into the regular options so every downstream consumer (the native
 * config, the multi-identity check, the CA store) sees plain key/cert/ca.
 * Returns the original object untouched when no pfx is present.
 */
function processPfxOptions(options: Record<string, any>): Record<string, any> {
  if (options == null || options.pfx == null) return options;
  NativeSecureContext ??= $bindgen("SecureContext.bind.ts", "SecureContext") as $Node.NativeSecureContextConstructor;
  const out = { ...options };
  const keys = out.key == null ? [] : Array.isArray(out.key) ? [...out.key] : [out.key];
  const certs = out.cert == null ? [] : Array.isArray(out.cert) ? [...out.cert] : [out.cert];
  const pfxCAs: string[] = [];
  const entries = Array.isArray(out.pfx) ? out.pfx : [out.pfx];
  for (const entry of entries) {
    let buf = entry;
    let passphrase = out.passphrase;
    if (entry != null && typeof entry === "object" && !Buffer.isBuffer(entry) && !$isTypedArrayView(entry)) {
      const entryBuf = entry.buf;
      if (entryBuf !== undefined) {
        buf = entryBuf;
        passphrase = entry.passphrase || passphrase;
      }
    }
    const parsed = NativeSecureContext.parsePkcs12(buf, passphrase);
    const parsedCA = parsed.ca;
    keys.push(parsed.key);
    // The bundle's other certificates are the chain: https://github.com/nodejs/node/blob/v26.5.0/src/crypto/crypto_context.cc#L2324
    certs.push(parsedCA ? parsed.cert + parsedCA : parsed.cert);
    // A CA bundled inside the PKCS#12 EXTENDS the trust set (Node loads it
    // via addCACert on top of the default roots); folding it into the `ca`
    // option would instead REPLACE the trust store and break verification
    // against the default/NODE_EXTRA_CA_CERTS roots for pfx-only clients.
    if (parsedCA) pfxCAs.push(parsedCA);
  }
  out.key = keys.length === 1 ? keys[0] : keys;
  out.cert = certs.length === 1 ? certs[0] : certs;
  if (pfxCAs.length) out._pfxExtraCACerts = pfxCAs;
  out.pfx = undefined;
  return out;
}

function hasPemObject(key) {
  if (!key) return false;
  if ($isArray(key)) return ArrayPrototypeSome.$call(key, isPemKeyEntry);
  return isPemKeyEntry(key);
}

function isPemKeyEntry(k) {
  return k && typeof k === "object" && !isArrayBufferView(k) && "pem" in k;
}

function normalizePemKeyOption(key, ctxPassphrase) {
  if (!key || !hasPemObject(key)) return key;
  const entries = $isArray(key) ? key : [key];
  return ArrayPrototypeMap.$call(entries, k => {
    if (!isPemKeyEntry(k)) return k;
    // Node: val?.passphrase !== undefined ? val.passphrase : passphrase - an
    // explicit per-key null means "no passphrase for this key" and does NOT
    // fall back to the context-level one.
    const passphrase = k.passphrase !== undefined ? k.passphrase : ctxPassphrase;
    if (passphrase == null) return k.pem;
    const { createPrivateKey } = require("node:crypto");
    return createPrivateKey({ key: k.pem, passphrase }).export({ type: "pkcs8", format: "pem" });
  });
}

function tlsCipherFilter(a: string) {
  return !StringPrototypeStartsWith.$call(a, "TLS_");
}

// Node's processCiphers splits into cipherList (<=1.2) and cipherSuites (1.3);
// when only 1.3 suites were given it forces minVersion = TLSv1.3 so the empty
// 1.2 list does not leave the handshake with nothing to offer:
// https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/internal/tls/secure-context.js#L117
function stripTls13CipherNames(ciphers: string): { cipherList: string; tls13Only: boolean } {
  if (!StringPrototypeIncludes.$call(ciphers, "TLS_")) return { cipherList: ciphers, tls13Only: false };
  const parts = StringPrototypeSplit.$call(ciphers, ":");
  const kept = ArrayPrototypeFilter.$call(parts, tlsCipherFilter);
  const cipherList = ArrayPrototypeJoin.$call(kept, ":");
  return { cipherList, tls13Only: cipherList === "" && kept.length !== parts.length };
}

// `ciphers`, `secureProtocol`, `minVersion` and `maxVersion` of node:tls as the `ciphers`, `minVersion` and `maxVersion` the native parser takes.
function nativeCiphersAndVersions(options, defaultMinVersion?, defaultMaxVersion?) {
  let { ciphers } = options;
  let minVersion = toProtocolVersion("minimum", options.minVersion, defaultMinVersion);
  let maxVersion = toProtocolVersion("maximum", options.maxVersion, defaultMaxVersion);
  if (ciphers) {
    const stripped = stripTls13CipherNames(ciphers);
    ciphers = stripped.cipherList;
    if (stripped.tls13Only) minVersion = protocolVersionCode("TLSv1.3");
  }
  // It wins, as in Node's SecureContext::Init.
  const range = secureProtocolToVersionRange(options.secureProtocol);
  if (range) {
    minVersion = range[0];
    maxVersion = range[1];
  }
  return { ciphers, minVersion, maxVersion };
}

// The native `ca` replaces the default store, so the CAs of an archive can only extend a `ca` the caller gave.
function unsealPfxForNative(tls) {
  // `tls` can be the caller's own object, so a `pfx` that comes from a polluted Object.prototype doesn't count.
  if (tls.pfx == null || tls.pfx === (Object.prototype as { pfx?: unknown }).pfx) return tls;
  // processPfxOptions() copies its argument, and a copy of `tls` would only have its own enumerable properties. The
  // native parser also reads inherited and non-enumerable ones, and losing a `ca` or `checkServerIdentity` would loosen
  // the verification. So pass what it needs by name, and let the result inherit the rest from `tls`.
  const {
    key,
    cert,
    _pfxExtraCACerts: pfxCAs,
  } = processPfxOptions({ pfx: tls.pfx, passphrase: tls.passphrase, key: tls.key, cert: tls.cert });
  const { ca } = tls;
  const unsealed = { __proto__: tls, key, cert, ca, pfx: undefined };
  if (!pfxCAs) return unsealed;
  if (ca) unsealed.ca = $isArray(ca) ? [...ca, ...pfxCAs] : [ca, ...pfxCAs];
  return unsealed;
}

const nodeClientTlsKeys = [
  "rejectUnauthorized",
  "ca",
  "cert",
  "key",
  "pfx",
  "passphrase",
  "servername",
  "checkServerIdentity",
  "ciphers",
  "secureOptions",
  "minVersion",
  "maxVersion",
  "crl",
  "sigalgs",
  "ecdhCurve",
  "allowPartialTrustChain",
];

// `options` of tls.connect(), as a null-prototype copy, to the `tls` option of fetch() and WebSocket.
function nodeClientTlsToNative(options) {
  // BoringSSL has no DHE suites to apply it to.
  options.dhparam = undefined;
  validateSecureContextOptions(options);
  // BoringSSL has no security levels to set.
  if (options.ciphers) options.ciphers = StringPrototypeReplace.$call(options.ciphers, /:?@SECLEVEL=\d/g, "");
  const { ciphers, minVersion, maxVersion } = nativeCiphersAndVersions(options);
  options.ciphers = ciphers;
  options.minVersion = minVersion || undefined;
  options.maxVersion = maxVersion || undefined;
  let tls;
  for (let i = 0; i < nodeClientTlsKeys.length; i++) {
    const name = nodeClientTlsKeys[i];
    let value = options[name];
    if (value == null || value === "") continue;
    if (name === "rejectUnauthorized") {
      value = value !== false;
    } else if (name === "allowPartialTrustChain") {
      if (value !== true) continue;
    } else if (name === "key") {
      value = normalizePemKeyOption(value, options.passphrase);
    }
    (tls ??= { __proto__: null })[name] = value;
  }
  return tls && unsealPfxForNative(tls);
}

/**
 * Build the Error for a handshake that failed before completing. A fatal SSL
 * protocol error (wrong version number, bad record, ...) carries the OpenSSL
 * error string in `verifyError.reason`; everything else is the peer
 * disconnecting mid-handshake, which Node reports as ECONNRESET.
 */
function tlsHandshakeError(verifyError: { code?: string; reason?: string; message?: string } | null | undefined) {
  const verifyErrorCode = verifyError ? verifyError.code : undefined;
  if (verifyErrorCode && verifyErrorCode !== "ECONNRESET") {
    const reason = verifyError!.reason || verifyError!.message || "TLS handshake failed";
    const err = new Error(reason) as Error & {
      code?: string;
      library?: string;
      function?: string;
      reason?: string;
    };
    // "error:0a00042e:SSL routines:OPENSSL_internal:TLSV1_ALERT_PROTOCOL_VERSION". ERR_SSL_<REASON> whatever the library:
    // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L876-L891
    const match = /^error:[0-9a-f]+:([^:]*):([^:]*):(.+)$/.exec(reason);
    if (match) {
      err.library = match[1];
      err.function = match[2];
      err.reason = match[3];
      err.code = `ERR_SSL_${match[3]}`;
    } else {
      err.code = verifyErrorCode;
    }
    return err;
  }
  return new (require("internal/shared").ConnResetException)("socket hang up");
}

// Returns true if `stream` has every method the TLS engine calls on a wrapped stream.
function hasStreamMethods(stream) {
  return (
    typeof stream.pause === "function" &&
    typeof stream.resume === "function" &&
    typeof stream.on === "function" &&
    typeof stream.once === "function" &&
    typeof stream.write === "function" &&
    typeof stream.end === "function" &&
    typeof stream.destroy === "function"
  );
}

export {
  SSL_OP_CIPHER_SERVER_PREFERENCE,
  hasStreamMethods,
  ignoredByHttpsServer,
  nativeCiphersAndVersions,
  nodeClientTlsKeys,
  nodeClientTlsToNative,
  normalizePemKeyOption,
  processPfxOptions,
  readSecureContextOptions,
  stripTls13CipherNames,
  throwOnInvalidTLSArray,
  tlsHandshakeError,
  unsealPfxForNative,
  validateSecureContextOptions,
};
