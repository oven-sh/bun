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

const VALID_TLS_VERSIONS = new Set(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]);

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

const StringPrototypeSplit = String.prototype.split;

// Subset of Node's configSecureContext() validations:
// https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/internal/tls/secure-context.js#L318
function validateSecureContextOptions(options) {
  const { validateString, validateBuffer } = require("internal/validators");
  const {
    ciphers,
    passphrase,
    ecdhCurve,
    minVersion,
    maxVersion,
    sessionTimeout,
    sigalgs,
    ticketKeys,
    clientCertEngine,
    dhparam,
    secureProtocol,
  } = options;
  validateSecureProtocol(secureProtocol);
  if (ciphers !== undefined && ciphers !== null) validateString(ciphers, "options.ciphers");
  if (passphrase !== undefined && passphrase !== null) validateString(passphrase, "options.passphrase");
  if (sigalgs !== undefined && sigalgs !== null) {
    validateString(sigalgs, "options.sigalgs");
    if (sigalgs === "") throw $ERR_INVALID_ARG_VALUE("options.sigalgs", sigalgs);
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
  if (minVersion != null && !VALID_TLS_VERSIONS.has(minVersion))
    throw $ERR_TLS_INVALID_PROTOCOL_VERSION(String(minVersion), "minimum");
  if (maxVersion != null && !VALID_TLS_VERSIONS.has(maxVersion))
    throw $ERR_TLS_INVALID_PROTOCOL_VERSION(String(maxVersion), "maximum");
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

// SSL_OP_CIPHER_SERVER_PREFERENCE: `honorCipherOrder` folds into secureOptions.
const SSL_OP_CIPHER_SERVER_PREFERENCE = 0x00400000;

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

export {
  SSL_OP_CIPHER_SERVER_PREFERENCE,
  processPfxOptions,
  secureProtocolToVersionRange,
  throwOnInvalidTLSArray,
  tlsStringToProtocolVersion,
  validateSecureContextOptions,
  validateSecureProtocol,
};
