const { isTypedArray, isArrayBuffer, isArrayBufferView } = require("node:util/types");
const { validateInt32, validateString } = require("internal/validators");

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

const SSL_OP_CIPHER_SERVER_PREFERENCE = 0x00400000;

const StringPrototypeSplit = String.prototype.split;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeMap = Array.prototype.map;
const ArrayPrototypeSome = Array.prototype.some;

let _VALID_CIPHERS_SET: Set<string> | undefined;
function getValidCiphersSet() {
  if (!_VALID_CIPHERS_SET) {
    _VALID_CIPHERS_SET = new Set([
      "DES-CBC3-SHA",
      "AES128-SHA",
      "AES256-SHA",
      "PSK-AES128-CBC-SHA",
      "PSK-AES256-CBC-SHA",
      "AES128-GCM-SHA256",
      "AES256-GCM-SHA384",
      "ECDHE-ECDSA-AES128-SHA",
      "ECDHE-ECDSA-AES256-SHA",
      "ECDHE-RSA-AES128-SHA",
      "ECDHE-RSA-AES256-SHA",
      "ECDHE-ECDSA-AES128-SHA256",
      "ECDHE-RSA-AES128-SHA256",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES256-GCM-SHA384",
      "ECDHE-PSK-AES128-CBC-SHA",
      "ECDHE-PSK-AES256-CBC-SHA",
      "ECDHE-RSA-CHACHA20-POLY1305",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-PSK-CHACHA20-POLY1305",
    ]);
  }
  return _VALID_CIPHERS_SET;
}

// OpenSSL cipher-list selector keywords that are not literal suite names.
let _CIPHER_LIST_SELECTORS: Set<string> | undefined;
function getCipherListSelectors() {
  if (!_CIPHER_LIST_SELECTORS) {
    _CIPHER_LIST_SELECTORS = new Set([
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
      "kPSK",
      "aPSK",
      "AES",
      "AES128",
      "AES256",
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
      "FIPS",
    ]);
  }
  return _CIPHER_LIST_SELECTORS;
}

// The SSL_CTX is only built at listen()/connect() time, so the list is checked up front the way BoringSSL would.
function validateCiphers(ciphers: string, name: string = "options") {
  if (ciphers !== undefined && ciphers !== null) {
    validateString(ciphers, `${name}.ciphers`);

    const ciphersSet = getValidCiphersSet();
    const requested = StringPrototypeSplit.$call(ciphers, ":");
    let sawLegacyEntry = false;
    let sawUsableEntry = false;
    for (const r of requested) {
      if (!r) continue;
      // BoringSSL has no security levels: its cipher parser rejects
      // @SECLEVEL with INVALID_COMMAND. Report that the way the native
      // parser would, with Node's decomposed error shape.
      if (StringPrototypeIncludes.$call(r, "@SECLEVEL")) {
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
      if (StringPrototypeStartsWith.$call(r, "TLS_")) continue;
      sawLegacyEntry = true;
      // OpenSSL cipher-list grammar: `!X`/`-X`/`+X` operators, `A+B`
      // intersections, `@STRENGTH` directives and selector keywords
      // (HIGH, PSK, aNULL, ...) are not literal cipher names — leave their
      // evaluation to BoringSSL and assume they can contribute matches.
      const first = StringPrototypeCharCodeAt.$call(r, 0);
      if (
        first === 0x21 /* ! */ ||
        first === 0x2d /* - */ ||
        first === 0x2b /* + */ ||
        first === 0x40 /* @ */ ||
        StringPrototypeIncludes.$call(r, "+") ||
        getCipherListSelectors().has(r) ||
        ciphersSet.has(r)
      ) {
        sawUsableEntry = true;
      }
    }
    if (sawLegacyEntry && !sawUsableEntry) {
      throw $ERR_SSL_NO_CIPHER_MATCH();
    }
  }
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

// Process-wide fallbacks behind tls.DEFAULT_* and setDefaultCACertificates(); `ca` is undefined until one is installed.
const tlsDefaults: { minVersion: string; maxVersion: string; ecdhCurve: string; ca: Array<string> | undefined } = {
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.3",
  ecdhCurve: "auto",
  ca: undefined,
};

// Seeded from Node's --tls-{min,max}-vX.Y flags like Node does: the lowest minimum and highest maximum given win.
{
  const execArgv = process.execArgv;
  const hasFlag = (flag: string) => execArgv.includes(flag);
  if (hasFlag("--tls-min-v1.0")) tlsDefaults.minVersion = "TLSv1";
  else if (hasFlag("--tls-min-v1.1")) tlsDefaults.minVersion = "TLSv1.1";
  else if (hasFlag("--tls-min-v1.2")) tlsDefaults.minVersion = "TLSv1.2";
  else if (hasFlag("--tls-min-v1.3")) tlsDefaults.minVersion = "TLSv1.3";
  if (hasFlag("--tls-max-v1.3")) tlsDefaults.maxVersion = "TLSv1.3";
  else if (hasFlag("--tls-max-v1.2")) tlsDefaults.maxVersion = "TLSv1.2";
}

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

const VALID_TLS_VERSIONS = new Set(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]);
function validateProtocolVersions(minVersion, maxVersion) {
  if (minVersion != null && !VALID_TLS_VERSIONS.has(minVersion))
    throw $ERR_TLS_INVALID_PROTOCOL_VERSION(String(minVersion), "minimum");
  if (maxVersion != null && !VALID_TLS_VERSIONS.has(maxVersion))
    throw $ERR_TLS_INVALID_PROTOCOL_VERSION(String(maxVersion), "maximum");
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

/**
 * Turns the TLS options Node's http.Server / https.Server accept (in the
 * constructor, `setSecureContext()` and `addContext()`) into the `tls` object
 * handed to `Bun.serve`. Every option is validated before anything is built,
 * so a throw leaves the caller's current config untouched.
 */
function serverTlsFromOptions(options) {
  const tlsOptions = options.pfx ? processPfxOptions(options) : options;

  const cert = tlsOptions.cert;
  if (cert) throwOnInvalidTLSArray("options.cert", cert);

  const key = tlsOptions.key;
  if (key) throwOnInvalidTLSArray("options.key", key);

  let ca = tlsOptions.ca;
  if (ca) throwOnInvalidTLSArray("options.ca", ca);
  else if (ca == null) ca = tlsDefaults.ca;
  // PKCS#12-embedded CAs extend the trust set; the server path hands raw
  // {key, cert, ca} to the native config and has no addCACert hook, so fold
  // them into `ca` (mirrors tls.Server.setSecureContext).
  const pfxExtraCAs = tlsOptions._pfxExtraCACerts;
  if (pfxExtraCAs?.length) {
    ca = ca == null ? pfxExtraCAs : $isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
  }

  const passphrase = options.passphrase;
  if (passphrase && typeof passphrase !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
  }

  const serverName = options.servername;
  if (serverName && typeof serverName !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.servername", "string", serverName);
  }

  let secureOptions = options.secureOptions || 0;
  if (secureOptions && typeof secureOptions !== "number") {
    throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
  }
  // Servers prefer their own cipher order unless told otherwise, as in Node.
  if (options.honorCipherOrder !== false) secureOptions |= SSL_OP_CIPHER_SERVER_PREFERENCE;

  // Same checks as tls.Server#setSecureContext() for the options it shares.
  const crl = options.crl;
  if (crl) throwOnInvalidTLSArray("options.crl", crl);
  const sigalgs = options.sigalgs;
  if (sigalgs != null) {
    validateString(sigalgs, "options.sigalgs");
    if (sigalgs === "") throw $ERR_INVALID_ARG_VALUE("options.sigalgs", sigalgs);
  }
  const ecdhCurve = options.ecdhCurve;
  if (ecdhCurve !== undefined) validateString(ecdhCurve, "options.ecdhCurve");
  const sessionTimeout = options.sessionTimeout;
  if (sessionTimeout != null) validateInt32(sessionTimeout, "options.sessionTimeout", 0);
  let ciphers = options.ciphers || undefined;
  let tls13CiphersOnly = false;
  if (ciphers !== undefined) {
    validateCiphers(ciphers);
    ({ cipherList: ciphers, tls13Only: tls13CiphersOnly } = stripTls13CipherNames(ciphers));
  }

  // secureProtocol wins over minVersion/maxVersion, as in Node; the native layer reads integers, 0 = its default.
  validateSecureProtocol(options.secureProtocol);
  validateProtocolVersions(options.minVersion, options.maxVersion);
  let minVersion, maxVersion;
  const range = secureProtocolToVersionRange(options.secureProtocol);
  if (range) {
    minVersion = range[0];
    maxVersion = range[1];
  } else {
    minVersion = tls13CiphersOnly
      ? TLS1_3_VERSION
      : tlsStringToProtocolVersion(options.minVersion ?? tlsDefaults.minVersion);
    maxVersion = tlsStringToProtocolVersion(options.maxVersion ?? tlsDefaults.maxVersion);
  }
  return normalizeServerTls({
    serverName,
    key: normalizePemKeyOption(key, passphrase),
    cert,
    ca,
    passphrase,
    secureOptions,
    minVersion,
    maxVersion,
    ciphers,
    crl,
    sigalgs,
    ecdhCurve: ecdhCurve ?? tlsDefaults.ecdhCurve,
    sessionTimeout: sessionTimeout ?? 0,
    allowPartialTrustChain: !!options.allowPartialTrustChain,
    requestCert: options.requestCert,
    rejectUnauthorized: options.rejectUnauthorized,
  });
}

export {
  SSL_OP_CIPHER_SERVER_PREFERENCE,
  normalizePemKeyOption,
  normalizeServerTls,
  processPfxOptions,
  secureProtocolToVersionRange,
  serverTlsFromOptions,
  stripTls13CipherNames,
  throwOnInvalidTLSArray,
  tlsDefaults,
  tlsStringToProtocolVersion,
  validateCiphers,
  validateProtocolVersions,
  validateSecureProtocol,
};
