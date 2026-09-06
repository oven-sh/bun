const { isTypedArray, isArrayBuffer } = require("node:util/types");

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

// BoringSSL TLS1_x_VERSION constants (from openssl/tls1.h). The native TLS
// config applies these via SSL_CTX_set_min/max_proto_version.
const TLS1_VERSION = 0x0301;
const TLS1_1_VERSION = 0x0302;
const TLS1_2_VERSION = 0x0303;
const TLS1_3_VERSION = 0x0304;
function tlsStringToProtocolVersion(v) {
  switch (v) {
    case "TLSv1":
      return TLS1_VERSION;
    case "TLSv1.1":
      return TLS1_1_VERSION;
    case "TLSv1.2":
      return TLS1_2_VERSION;
    case "TLSv1.3":
      return TLS1_3_VERSION;
    default:
      return 0;
  }
}

// Matches Node: SSLv2/SSLv3 methods are disabled, anything unrecognized is an
// unknown method (THROW_ERR_TLS_INVALID_PROTOCOL_METHOD in
// src/crypto/crypto_context.cc SecureContext::Init).
let _SECURE_PROTOCOL_METHODS: Set<string> | undefined;
function validateSecureProtocol(secureProtocol) {
  if (secureProtocol === undefined || secureProtocol === null) return;
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
function secureProtocolToVersionRange(secureProtocol) {
  if (typeof secureProtocol !== "string") return null;
  if (
    secureProtocol === "TLSv1_method" ||
    secureProtocol === "TLSv1_client_method" ||
    secureProtocol === "TLSv1_server_method"
  )
    return [TLS1_VERSION, TLS1_VERSION];
  if (
    secureProtocol === "TLSv1_1_method" ||
    secureProtocol === "TLSv1_1_client_method" ||
    secureProtocol === "TLSv1_1_server_method"
  )
    return [TLS1_1_VERSION, TLS1_1_VERSION];
  if (
    secureProtocol === "TLSv1_2_method" ||
    secureProtocol === "TLSv1_2_client_method" ||
    secureProtocol === "TLSv1_2_server_method"
  )
    return [TLS1_2_VERSION, TLS1_2_VERSION];
  return null;
}

let NativeSecureContext;

/**
 * Node's `pfx` option: parse each PKCS#12 blob into PEM key/cert/ca and fold
 * them into the regular options so every downstream consumer (the native
 * config, the multi-identity check, the CA store) sees plain key/cert/ca.
 * Returns the original object untouched when no pfx is present.
 */
function processPfxOptions(options) {
  if (options == null || options.pfx == null) return options;
  NativeSecureContext ??= $rust("SecureContext.rs", "js.getConstructor");
  const out = { ...options };
  const keys = out.key == null ? [] : Array.isArray(out.key) ? [...out.key] : [out.key];
  const certs = out.cert == null ? [] : Array.isArray(out.cert) ? [...out.cert] : [out.cert];
  const pfxCAs = [];
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
    keys.push(parsed.key);
    certs.push(parsed.cert);
    // A CA bundled inside the PKCS#12 EXTENDS the trust set (Node loads it
    // via addCACert on top of the default roots); folding it into the `ca`
    // option would instead REPLACE the trust store and break verification
    // against the default/NODE_EXTRA_CA_CERTS roots for pfx-only clients.
    const parsedCA = parsed.ca;
    if (parsedCA) pfxCAs.push(parsedCA);
  }
  out.key = keys.length === 1 ? keys[0] : keys;
  out.cert = certs.length === 1 ? certs[0] : certs;
  if (pfxCAs.length) out._pfxExtraCACerts = pfxCAs;
  out.pfx = undefined;
  return out;
}

// Node.js only requests a client certificate when `requestCert: true`.
// The uSockets SSL context treats `ca` alone as "verify peer", so without
// these two flags an `https.Server({ ca })` would reject every client that
// doesn't present a cert. Mirror tls.Server (net.ts): default `requestCert`
// to false and, when not requesting, force `rejectUnauthorized` to false so
// the CA is loaded into the trust store without requiring a client cert.
function normalizeServerTls(tls) {
  const requestCert = !!tls.requestCert;
  tls.requestCert = requestCert;
  tls.rejectUnauthorized = requestCert ? tls.rejectUnauthorized !== false : false;
  return tls;
}

// Bun.serve `tls` config for https.Server. Never null: without key/cert the listener still speaks TLS.
function httpsServerTlsOptions(options) {
  // Node's https.Server accepts PKCS#12 bundles (pfx [+ passphrase]); fold
  // them into plain key/cert/ca so the native TLS config sees PEM material.
  let tlsOptions = options;
  if (options.pfx) {
    tlsOptions = processPfxOptions(options);
  }

  let cert = tlsOptions.cert;
  if (cert) {
    throwOnInvalidTLSArray("options.cert", cert);
  }

  let key = tlsOptions.key;
  if (key) {
    throwOnInvalidTLSArray("options.key", key);
  }

  let ca = tlsOptions.ca;
  // PKCS#12-embedded CAs extend the trust set; the server path hands raw
  // {key, cert, ca} to the native config and has no addCACert hook, so fold
  // them into `ca` (mirrors tls.Server.setSecureContext).
  const pfxExtraCAs = tlsOptions._pfxExtraCACerts;
  if (pfxExtraCAs?.length) {
    ca = ca == null ? pfxExtraCAs : $isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
  }
  if (ca) {
    throwOnInvalidTLSArray("options.ca", ca);
  }

  let passphrase = options.passphrase;
  if (passphrase && typeof passphrase !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
  }

  let serverName = options.servername;
  if (serverName && typeof serverName !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.servername", "string", serverName);
  }

  let secureOptions = options.secureOptions || 0;
  if (secureOptions && typeof secureOptions !== "number") {
    throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
  }

  // Translate minVersion/maxVersion/secureProtocol into the integer
  // protocol range the native layer applies (secureProtocol wins, like
  // Node's SecureContext::Init); 0 keeps the native defaults.
  validateSecureProtocol(options.secureProtocol);
  let minVersion, maxVersion;
  const range = secureProtocolToVersionRange(options.secureProtocol);
  if (range) {
    minVersion = range[0];
    maxVersion = range[1];
  } else {
    minVersion = tlsStringToProtocolVersion(options.minVersion);
    maxVersion = tlsStringToProtocolVersion(options.maxVersion);
  }
  return normalizeServerTls({
    serverName,
    key,
    cert,
    ca,
    passphrase,
    secureOptions,
    minVersion,
    maxVersion,
    ciphers: typeof options.ciphers === "string" && options.ciphers ? options.ciphers : undefined,
    requestCert: options.requestCert,
    rejectUnauthorized: options.rejectUnauthorized,
  });
}

export {
  httpsServerTlsOptions,
  normalizeServerTls,
  processPfxOptions,
  secureProtocolToVersionRange,
  throwOnInvalidTLSArray,
  tlsStringToProtocolVersion,
  validateSecureProtocol,
};
