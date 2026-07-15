const { isTypedArray, isArrayBuffer, isArrayBufferView } = require("node:util/types");
const { validateString, validateBuffer } = require("internal/validators");

const ArrayPrototypeReduce = Array.prototype.reduce;

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

let _VALID_CIPHERS_SET: Set<string> | undefined;
function getValidCiphersSet() {
  if (!_VALID_CIPHERS_SET) {
    _VALID_CIPHERS_SET = new Set([
      "EXP1024-RC4-MD5",
      "EXP1024-RC2-CBC-MD5",
      "EXP1024-DES-CBC-SHA",
      "EXP1024-DHE-DSS-DES-CBC-SHA",
      "EXP1024-RC4-SHA",
      "EXP1024-DHE-DSS-RC4-SHA",
      "DHE-DSS-RC4-SHA",

      // AES ciphersuites from RFC 3268
      "AES128-SHA",
      "DH-DSS-AES128-SHA",
      "DH-RSA-AES128-SHA",
      "DHE-DSS-AES128-SHA",
      "DHE-RSA-AES128-SHA",
      "ADH-AES128-SHA",
      "AES256-SHA",
      "DH-DSS-AES256-SHA",
      "DH-RSA-AES256-SHA",
      "DHE-DSS-AES256-SHA",
      "DHE-RSA-AES256-SHA",
      "ADH-AES256-SHA",

      // ECC ciphersuites from RFC 4492
      "ECDH-ECDSA-NULL-SHA",
      "ECDH-ECDSA-RC4-SHA",
      "ECDH-ECDSA-DES-CBC3-SHA",
      "ECDH-ECDSA-AES128-SHA",
      "ECDH-ECDSA-AES256-SHA",
      "ECDHE-ECDSA-NULL-SHA",
      "ECDHE-ECDSA-RC4-SHA",
      "ECDHE-ECDSA-DES-CBC3-SHA",
      "ECDHE-ECDSA-AES128-SHA",
      "ECDHE-ECDSA-AES256-SHA",

      "ECDH-RSA-NULL-SHA",
      "ECDH-RSA-RC4-SHA",
      "ECDH-RSA-DES-CBC3-SHA",
      "ECDH-RSA-AES128-SHA",
      "ECDH-RSA-AES256-SHA",
      "ECDHE-RSA-NULL-SHA",
      "ECDHE-RSA-RC4-SHA",
      "ECDHE-RSA-DES-CBC3-SHA",
      "ECDHE-RSA-AES128-SHA",
      "ECDHE-RSA-AES256-SHA",
      "ECDHE-RSA-AES128-SHA256",
      "AECDH-NULL-SHA",
      "AECDH-RC4-SHA",
      "AECDH-DES-CBC3-SHA",
      "AECDH-AES128-SHA",
      "AECDH-AES256-SHA",

      // PSK ciphersuites from RFC 4279
      "PSK-RC4-SHA",
      "PSK-3DES-EDE-CBC-SHA",
      "PSK-AES128-CBC-SHA",
      "PSK-AES256-CBC-SHA",

      // PSK ciphersuites from RFC 5489
      "ECDHE-PSK-AES128-CBC-SHA",
      "ECDHE-PSK-AES256-CBC-SHA",

      // SRP ciphersuite from RFC 5054
      "SRP-3DES-EDE-CBC-SHA",
      "SRP-RSA-3DES-EDE-CBC-SHA",
      "SRP-DSS-3DES-EDE-CBC-SHA",
      "SRP-AES-128-CBC-SHA",
      "SRP-RSA-AES-128-CBC-SHA",
      "SRP-DSS-AES-128-CBC-SHA",
      "SRP-AES-256-CBC-SHA",
      "SRP-RSA-AES-256-CBC-SHA",
      "SRP-DSS-AES-256-CBC-SHA",

      // Camellia ciphersuites from RFC 4132
      "CAMELLIA128-SHA",
      "DH-DSS-CAMELLIA128-SHA",
      "DH-RSA-CAMELLIA128-SHA",
      "DHE-DSS-CAMELLIA128-SHA",
      "DHE-RSA-CAMELLIA128-SHA",
      "ADH-CAMELLIA128-SHA",

      "CAMELLIA256-SHA",
      "DH-DSS-CAMELLIA256-SHA",
      "DH-RSA-CAMELLIA256-SHA",
      "DHE-DSS-CAMELLIA256-SHA",
      "DHE-RSA-CAMELLIA256-SHA",
      "ADH-CAMELLIA256-SHA",

      // SEED ciphersuites from RFC 4162
      "SEED-SHA",
      "DH-DSS-SEED-SHA",
      "DH-RSA-SEED-SHA",
      "DHE-DSS-SEED-SHA",
      "DHE-RSA-SEED-SHA",
      "ADH-SEED-SHA",

      // TLS v1.2 ciphersuites
      "NULL-SHA256",
      "AES128-SHA256",
      "AES256-SHA256",
      "DH-DSS-AES128-SHA256",
      "DH-RSA-AES128-SHA256",
      "DHE-DSS-AES128-SHA256",
      "DHE-RSA-AES128-SHA256",
      "DH-DSS-AES256-SHA256",
      "DH-RSA-AES256-SHA256",
      "DHE-DSS-AES256-SHA256",
      "DHE-RSA-AES256-SHA256",
      "ADH-AES128-SHA256",
      "ADH-AES256-SHA256",

      // TLS v1.2 GCM ciphersuites from RFC 5288
      "AES128-GCM-SHA256",
      "AES256-GCM-SHA384",
      "DHE-RSA-AES128-GCM-SHA256",
      "DHE-RSA-AES256-GCM-SHA384",
      "DH-RSA-AES128-GCM-SHA256",
      "DH-RSA-AES256-GCM-SHA384",
      "DHE-DSS-AES128-GCM-SHA256",
      "DHE-DSS-AES256-GCM-SHA384",
      "DH-DSS-AES128-GCM-SHA256",
      "DH-DSS-AES256-GCM-SHA384",
      "ADH-AES128-GCM-SHA256",
      "ADH-AES256-GCM-SHA384",

      // ECDH HMAC based ciphersuites from RFC 5289

      "ECDHE-ECDSA-AES128-SHA256",
      "ECDHE-ECDSA-AES256-SHA384",
      "ECDH-ECDSA-AES128-SHA256",
      "ECDH-ECDSA-AES256-SHA384",
      "ECDHE-RSA-AES128-SHA256",
      "ECDHE-RSA-AES256-SHA384",
      "ECDH-RSA-AES128-SHA256",
      "ECDH-RSA-AES256-SHA384",

      // ECDH GCM based ciphersuites from RFC 5289
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDH-ECDSA-AES128-GCM-SHA256",
      "ECDH-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDH-RSA-AES128-GCM-SHA256",
      "ECDH-RSA-AES256-GCM-SHA384",
      "ECDHE-RSA-CHACHA20-POLY1305",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-PSK-CHACHA20-POLY1305",

      // TLS 1.3 ciphersuites from RFC 8446.
      "TLS_AES_128_GCM_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",

      // Configurations include in the default cipher list
      "HIGH",
      "!aNULL",
      "!eNULL",
      "!EXPORT",
      "!DES",
      "!RC4",
      "!MD5",
      "!PSK",
      "!SRP",
      "!CAMELLIA",
    ]);
  }
  return _VALID_CIPHERS_SET;
}

// OpenSSL cipher-list selector keywords that are not literal suite names.
const CIPHER_LIST_SELECTORS = new Set([
  "DEFAULT",
  "ALL",
  "COMPLEMENTOFDEFAULT",
  "COMPLEMENTOFALL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "PSK",
  "aNULL",
  "eNULL",
  "NULL",
  "EXPORT",
  "EXP",
  "kRSA",
  "aRSA",
  "RSA",
  "kDHE",
  "kEDH",
  "DH",
  "DHE",
  "EDH",
  "kECDHE",
  "kEECDH",
  "ECDHE",
  "EECDH",
  "ECDH",
  "aECDSA",
  "ECDSA",
  "aDSS",
  "DSS",
  "AES",
  "AESGCM",
  "AESCCM",
  "CHACHA20",
  "3DES",
  "DES",
  "RC4",
  "RC2",
  "MD5",
  "SHA",
  "SHA1",
  "SHA256",
  "SHA384",
  "CAMELLIA",
  "ARIA",
  "SRP",
  "TLSv1",
  "TLSv1.0",
  "TLSv1.2",
  "TLSv1.3",
  "SSLv3",
]);

function validateCiphers(ciphers: string, name: string = "options") {
  // Set the cipher list and cipher suite before anything else because
  // @SECLEVEL=<n> changes the security level and that affects subsequent
  // operations.
  if (ciphers !== undefined && ciphers !== null) {
    validateString(ciphers, `${name}.ciphers`);

    // TODO: right now we need this because we dont create the CTX before listening/connecting
    // we need to change that in the future and let BoringSSL do the validation
    const ciphersSet = getValidCiphersSet();
    const requested = ciphers.split(":");
    for (const r of requested) {
      if (r && !ciphersSet.has(r)) {
        // OpenSSL cipher-list grammar: `!X`/`-X`/`+X` operators, `A+B`
        // intersections, `@SECLEVEL=n`/`@STRENGTH` directives and selector
        // keywords (HIGH, PSK, aNULL, ...) are not literal cipher names -
        // leave their evaluation to BoringSSL. Only an unrecognized literal
        // suite name is rejected here.
        // BoringSSL has no security levels: its cipher parser rejects
        // @SECLEVEL with INVALID_COMMAND. Report that the way the native
        // parser would, with Node's decomposed error shape.
        if (r.includes("@SECLEVEL")) {
          const err = new Error("error:0f000076:SSL routines:OPENSSL_internal:INVALID_COMMAND") as Error & {
            code: string;
            library: string;
            function: string;
            reason: string;
          };
          err.code = "ERR_SSL_INVALID_COMMAND";
          err.library = "SSL routines";
          err.function = "OPENSSL_internal";
          err.reason = "INVALID_COMMAND";
          throw err;
        }
        const first = r.charCodeAt(0);
        if (
          first === 0x21 /* ! */ ||
          first === 0x2d /* - */ ||
          first === 0x2b /* + */ ||
          first === 0x40 /* @ */ ||
          r.includes("+") ||
          CIPHER_LIST_SELECTORS.has(r)
        ) {
          continue;
        }
        throw $ERR_SSL_NO_CIPHER_MATCH();
      }
    }
  }
}

const VALID_TLS_VERSIONS = new Set(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]);

// Subset of Node's configSecureContext() validations:
// https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/internal/tls/secure-context.js#L318
// Valid OpenSSL/BoringSSL secureProtocol method names (legacy API). Built lazily
// so the Set is only allocated when a secureProtocol option is actually used.
let _SECURE_PROTOCOL_METHODS: Set<string> | undefined;
function getSecureProtocolMethods() {
  if (!_SECURE_PROTOCOL_METHODS) {
    _SECURE_PROTOCOL_METHODS = new Set([
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
  }
  return _SECURE_PROTOCOL_METHODS;
}
// Matches Node: SSLv2/SSLv3 methods are disabled, anything unrecognized is an
// unknown method.
// https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/secure-context.js#L100
function invalidProtocolMethod(message) {
  // Node throws all secureProtocol failures (SSLv2/SSLv3 disabled + unknown
  // method) via THROW_ERR_TLS_INVALID_PROTOCOL_METHOD: a TypeError carrying the
  // ERR_TLS_INVALID_PROTOCOL_METHOD code, varying only the message.
  const error = new TypeError(message);
  error.code = "ERR_TLS_INVALID_PROTOCOL_METHOD";
  return error;
}
function validateSecureProtocol(secureProtocol) {
  if (secureProtocol === undefined || secureProtocol === null) return;
  validateString(secureProtocol, "options.secureProtocol");
  if (secureProtocol.startsWith("SSLv2_")) throw invalidProtocolMethod("SSLv2 methods disabled");
  if (secureProtocol.startsWith("SSLv3_")) throw invalidProtocolMethod("SSLv3 methods disabled");
  if (!getSecureProtocolMethods().has(secureProtocol)) {
    throw invalidProtocolMethod(`Unknown method: ${secureProtocol}`);
  }
}

function validateSecureContextOptions(options) {
  const {
    ciphers,
    passphrase,
    ecdhCurve,
    minVersion,
    maxVersion,
    sessionTimeout,
    ticketKeys,
    clientCertEngine,
    dhparam,
    secureProtocol,
  } = options;
  validateSecureProtocol(secureProtocol);
  if (ciphers !== undefined && ciphers !== null) validateString(ciphers, "options.ciphers");
  if (passphrase !== undefined && passphrase !== null) validateString(passphrase, "options.passphrase");
  if (ecdhCurve !== undefined && ecdhCurve !== null) validateString(ecdhCurve, "options.ecdhCurve");
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

// BoringSSL TLS1_x_VERSION constants (from openssl/tls1.h). The native context
// applies these via SSL_CTX_set_min/max_proto_version.
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

// https://github.com/Jarred-Sumner/uSockets/blob/fafc241e8664243fc0c51d69684d5d02b9805134/src/crypto/openssl.c#L519-L523
let DEFAULT_MIN_VERSION = "TLSv1.2",
  DEFAULT_MAX_VERSION = "TLSv1.3";

// Node seeds the protocol-version defaults from its --tls-min-vX.Y /
// --tls-max-vX.Y CLI flags; the equivalent flags reach us through
// process.execArgv. The lowest requested minimum and the highest requested
// maximum win when several are passed, matching node_options precedence.
{
  const execArgv = process.execArgv;
  const hasFlag = (flag: string) => execArgv.includes(flag);
  if (hasFlag("--tls-min-v1.0")) DEFAULT_MIN_VERSION = "TLSv1";
  else if (hasFlag("--tls-min-v1.1")) DEFAULT_MIN_VERSION = "TLSv1.1";
  else if (hasFlag("--tls-min-v1.2")) DEFAULT_MIN_VERSION = "TLSv1.2";
  else if (hasFlag("--tls-min-v1.3")) DEFAULT_MIN_VERSION = "TLSv1.3";
  if (hasFlag("--tls-max-v1.3")) DEFAULT_MAX_VERSION = "TLSv1.3";
  else if (hasFlag("--tls-max-v1.2")) DEFAULT_MAX_VERSION = "TLSv1.2";
}

function getDefaultMinVersion() {
  return DEFAULT_MIN_VERSION;
}
function setDefaultMinVersion(value) {
  DEFAULT_MIN_VERSION = value;
}
function getDefaultMaxVersion() {
  return DEFAULT_MAX_VERSION;
}
function setDefaultMaxVersion(value) {
  DEFAULT_MAX_VERSION = value;
}

/**
 * Translate the user-facing minVersion/maxVersion/secureProtocol options into
 * the integer protocol range the native layer applies (secureProtocol wins,
 * like Node's SecureContext::Init). When none are given the module-level
 * tls.DEFAULT_MIN_VERSION / DEFAULT_MAX_VERSION apply, the way Node's
 * createSecureContext does.
 */
function resolveTLSVersionRange(secureProtocol, minVersion, maxVersion) {
  const range = secureProtocolToVersionRange(secureProtocol);
  if (range) {
    return { minVersion: range[0], maxVersion: range[1] };
  }
  return {
    minVersion: tlsStringToProtocolVersion(minVersion ?? DEFAULT_MIN_VERSION),
    maxVersion: tlsStringToProtocolVersion(maxVersion ?? DEFAULT_MAX_VERSION),
  };
}

let NativeSecureContext;
function getNativeSecureContext() {
  // Native SSL_CTX wrapper. `intern()` is WeakGCMap-memoised by config digest
  // (the native `SSLContextCache` underneath is shared with every native
  // consumer — Postgres, Valkey, `Bun.connect`, …), so identical options
  // return the same native handle and the same `SSL_CTX*`.
  return (NativeSecureContext ??= $rust("SecureContext.rs", "js.getConstructor"));
}

/**
 * Node's `pfx` option: parse each PKCS#12 blob into PEM key/cert/ca and fold
 * them into the regular options so every downstream consumer (the native
 * config, the multi-identity check, the CA store) sees plain key/cert/ca.
 * Returns the original object untouched when no pfx is present.
 */
function processPfxOptions(options) {
  if (options == null || options.pfx == null) return options;
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
        const entryPassphrase = entry.passphrase;
        if (entryPassphrase !== undefined) passphrase = entryPassphrase;
      }
    }
    const parsed = getNativeSecureContext().parsePkcs12(buf, passphrase);
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

/**
 * Fold PKCS#12-embedded CAs into the `ca` option for server paths that hand
 * raw {key, cert, ca} to the native listener and have no addCACert hook: an
 * mTLS server should verify client certificates against the bundle's own CA
 * chain.
 */
function foldPfxExtraCAs(ca, pfxExtraCAs) {
  if (!pfxExtraCAs?.length) return ca;
  return ca == null ? pfxExtraCAs : Array.isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
}

// Convert protocols array into valid OpenSSL protocols list
// ("\x06spdy/2\x08http/1.1\x08http/1.0")
function convertProtocols(protocols) {
  const lens = new Array(protocols.length);
  const buff = Buffer.allocUnsafe(
    ArrayPrototypeReduce.$call(
      protocols,
      (p, c, i) => {
        const len = Buffer.byteLength(c);
        if (len > 255) {
          const err = new RangeError(
            `The byte length of the protocol at index ${i} exceeds the maximum length. It must be <= 255. Received ${len}`,
          );
          (err as any).code = "ERR_OUT_OF_RANGE";
          throw err;
        }
        lens[i] = len;
        return p + 1 + len;
      },
      0,
    ),
  );

  let offset = 0;
  for (let i = 0, c = protocols.length; i < c; i++) {
    buff[offset++] = lens[i];
    buff.write(protocols[i], offset);
    offset += lens[i];
  }

  return buff;
}

// Matches Node's convertALPNProtocols:
// https://github.com/nodejs/node/blob/843dc5f0d5ad/lib/tls.js#L268
function convertALPNProtocols(protocols, out) {
  // If protocols is Array - translate it into buffer
  if (Array.isArray(protocols)) {
    out.ALPNProtocols = convertProtocols(protocols);
  } else if (isArrayBufferView(protocols)) {
    // Copy new buffer not to be modified by user.
    out.ALPNProtocols = Buffer.from(
      protocols.buffer.slice(protocols.byteOffset, protocols.byteOffset + protocols.byteLength),
    );
  }
}

export {
  VALID_TLS_ERROR_MESSAGE_TYPES,
  convertALPNProtocols,
  foldPfxExtraCAs,
  getDefaultMaxVersion,
  getDefaultMinVersion,
  getNativeSecureContext,
  isValidTLSArray,
  isValidTLSItem,
  processPfxOptions,
  resolveTLSVersionRange,
  setDefaultMaxVersion,
  setDefaultMinVersion,
  throwOnInvalidTLSArray,
  validateCiphers,
  validateSecureContextOptions,
};
