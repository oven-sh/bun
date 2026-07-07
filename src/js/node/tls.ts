// Hardcoded module "node:tls"
const { isArrayBufferView } = require("node:util/types");
const net = require("node:net");
const Duplex = require("internal/streams/duplex");
const EventEmitter = require("node:events");
const addServerName = $newRustFunction("Listener.rs", "jsAddServerName", 3);
const { throwNotImplemented } = require("internal/shared");
const { throwOnInvalidTLSArray } = require("internal/tls");
const {
  validateString,
  validateNumber,
  validateUint32,
  validateInt32,
  validateBuffer,
  validateFunction,
} = require("internal/validators");

const { Server: NetServer, Socket: NetSocket } = net;
const karmHandshakeTimeout = Symbol.for("::buntlsarmhandshaketimeout::");

const getBundledRootCertificates = $newCppFunction("NodeTLS.cpp", "getBundledRootCertificates", 1);
const getExtraCACertificates = $newCppFunction("NodeTLS.cpp", "getExtraCACertificates", 1);
const getSystemCACertificates = $newCppFunction("NodeTLS.cpp", "getSystemCACertificates", 1);
const canonicalizeIP = $newCppFunction("NodeTLS.cpp", "Bun__canonicalizeIP", 1);

const getTLSDefaultCiphers = $newCppFunction("NodeTLS.cpp", "getDefaultCiphers", 0);
const setTLSDefaultCiphers = $newCppFunction("NodeTLS.cpp", "setDefaultCiphers", 1);
let _VALID_CIPHERS_SET: Set<string> | undefined;
function getValidCiphersSet() {
  if (!_VALID_CIPHERS_SET) {
    // The TLS 1.2-and-below cipher suites BoringSSL can actually negotiate
    // (vendor/boringssl/ssl/ssl_cipher.cc kCiphers). A cipher string whose
    // entries match none of these produces an empty cipher list, which
    // SSL_CTX_set_cipher_list reports as NO_CIPHER_MATCH.
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

function validateCiphers(ciphers: string, name: string = "options") {
  // Set the cipher list and cipher suite before anything else because
  // @SECLEVEL=<n> changes the security level and that affects subsequent
  // operations.
  if (ciphers !== undefined && ciphers !== null) {
    validateString(ciphers, `${name}.ciphers`);

    // TODO: right now we need this because we dont create the CTX before listening/connecting
    // we need to change that in the future and let BoringSSL do the validation
    //
    // Mirrors SSL_CTX_set_cipher_list: unrecognized individual names are
    // ignored; the call only fails when the resulting TLS <= 1.2 cipher list
    // is empty. TLS 1.3 suite names (TLS_*) configure the fixed TLS 1.3 list,
    // which BoringSSL does not allow overriding, so they are skipped entirely
    // (matching Node built against BoringSSL).
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
        CIPHER_LIST_SELECTORS.has(r) ||
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

// Group names (and their aliases) BoringSSL's SSL_CTX_set1_curves_list accepts:
// vendor/boringssl/ssl/ssl_key_share.cc kNamedGroups.
const SUPPORTED_ECDH_GROUPS = new Set([
  "P-256",
  "prime256v1",
  "P-384",
  "secp384r1",
  "P-521",
  "secp521r1",
  "X25519",
  "x25519",
  "X25519Kyber768Draft00",
  "X25519MLKEM768",
  "MLKEM1024",
]);

function validateSecureContextOptions(options) {
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
  // Node validates sigalgs for every secure context, not only tls.Server:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L213-L217
  if (sigalgs !== undefined && sigalgs !== null) {
    validateString(sigalgs, "options.sigalgs");
    if (sigalgs === "") throw $ERR_INVALID_ARG_VALUE("options.sigalgs", sigalgs);
  }
  if (ecdhCurve !== undefined && ecdhCurve !== null) {
    validateString(ecdhCurve, "options.ecdhCurve");
    // Mirrors Node's SetECDHCurve failure: SSL_CTX_set1_curves_list rejects the
    // whole string when any entry is not a group BoringSSL supports
    // (vendor/boringssl/ssl/ssl_key_share.cc kNamedGroups; "auto" is handled
    // before reaching OpenSSL in Node and accepts the default group list).
    if (ecdhCurve !== "auto") {
      for (const curve of StringPrototypeSplit.$call(ecdhCurve, ":")) {
        if (!SUPPORTED_ECDH_GROUPS.has(curve)) {
          // Node's THROW_ERR_CRYPTO_OPERATION_FAILED sets `code` without
          // renaming the error, so String(err) keeps the upstream tests' shape:
          // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1973-L1975
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

const SymbolReplace = Symbol.replace;
const RegExpPrototypeSymbolReplace = RegExp.prototype[SymbolReplace];
const SymbolSplit = Symbol.split;
const RegExpPrototypeSymbolSplit = RegExp.prototype[SymbolSplit];
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;

const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSubstring = String.prototype.substring;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringFromCharCode = String.fromCharCode;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSome = Array.prototype.some;
const ArrayPrototypeReduce = Array.prototype.reduce;
const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeMap = Array.prototype.map;

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
const NativeSecureContext = $rust("SecureContext.rs", "js.getConstructor");

// Node treats any falsy key/cert/ca as "not provided" (test-tls-options-
// boolean-check.js exercises false/0/""). The bindgen SSLConfigFile union only
// accepts null|string|ArrayBuffer|Blob|array, so coerce falsy → null before
// crossing into native so `{ key: false }` etc. doesn't throw
// ERR_INVALID_ARG_TYPE from the bindgen layer.
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

function hasPemObject(key) {
  if (!key) return false;
  if ($isArray(key)) return ArrayPrototypeSome.$call(key, isPemKeyEntry);
  return isPemKeyEntry(key);
}

function isPemKeyEntry(k) {
  return k && typeof k === "object" && !isArrayBufferView(k) && "pem" in k;
}

// Node accepts each `key` entry as `{ pem, passphrase }`, the entry passphrase
// overriding the context-level one; the native converter needs the PEM bytes:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L203
function normalizePemKeyOption(key, ctxPassphrase) {
  if (!key || !hasPemObject(key)) return key;
  const entries = $isArray(key) ? key : [key];
  return ArrayPrototypeMap.$call(entries, k => {
    if (!isPemKeyEntry(k)) return k;
    const passphrase = k.passphrase ?? ctxPassphrase;
    if (passphrase == null) return k.pem;
    const { createPrivateKey } = require("node:crypto");
    return createPrivateKey({ key: k.pem, passphrase }).export({ type: "pkcs8", format: "pem" });
  });
}

// OpenSSL/BoringSSL SSL_OP_CIPHER_SERVER_PREFERENCE (vendor/boringssl/include/openssl/ssl.h).
const SSL_OP_CIPHER_SERVER_PREFERENCE = 0x00400000;

// The digest cache is opt-in: the internal connect/listen paths pass
// `cached = true` explicitly. A forgotten opt-in on a future entry point is a
// perf regression, not a shared trust store.
function newNativeSecureContext(options, cached = false) {
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
    let { key, cert, ca } = options;
    const normalizedKey = normalizePemKeyOption(key, options.passphrase);
    if (normalizedKey !== key) {
      key = normalizedKey;
      options = { ...options, key };
    }
    if (!key || !cert || !ca) {
      options = {
        ...options,
        key: key || null,
        cert: cert || null,
        ca: ca || null,
      };
    }
    // The native option converter is strict about integer fields; an explicit
    // sessionTimeout: null (which Node accepts as "use the default") is
    // normalized to the default before crossing the boundary.
    if (options.sessionTimeout == null) {
      options = { ...options, sessionTimeout: 0 };
    }
    // Node never type-checks rejectUnauthorized (it is not even a
    // secure-context option there) and treats every value but `false` as
    // true; the strict native converter only accepts a boolean.
    const rejectUnauthorized = options.rejectUnauthorized;
    if (rejectUnauthorized !== undefined && typeof rejectUnauthorized !== "boolean") {
      options = { ...options, rejectUnauthorized: true };
    }
    // allowPartialTrustChain is a plain truthy check in Node
    // (secure-context.js#L186), so it is coerced for the same reason.
    const allowPartialTrustChain = options.allowPartialTrustChain;
    if (allowPartialTrustChain !== undefined && typeof allowPartialTrustChain !== "boolean") {
      options = { ...options, allowPartialTrustChain: !!allowPartialTrustChain };
    }
    // Node folds honorCipherOrder into secureOptions inside createSecureContext
    // (lib/internal/tls/common.js:108), so every context path — STARTTLS wrap,
    // addContext, SNICallback — carries it, not just Server.setSecureContext.
    if (options.honorCipherOrder) {
      options = { ...options, secureOptions: options.secureOptions | 0 | SSL_OP_CIPHER_SERVER_PREFERENCE };
    }
  }
  if (options) {
    // Read each option once. Translate minVersion/maxVersion/secureProtocol to
    // the integer protocol range the native layer applies, so the bindings
    // receive numbers, not the user-facing strings. When none are given the
    // module-level tls.DEFAULT_MIN_VERSION / DEFAULT_MAX_VERSION apply, the
    // way Node's createSecureContext does.
    const { minVersion: optMinVersion, maxVersion: optMaxVersion, secureProtocol: optSecureProtocol } = options;
    {
      let minVersion, maxVersion;
      const range = secureProtocolToVersionRange(optSecureProtocol);
      if (range) {
        minVersion = range[0];
        maxVersion = range[1];
      } else {
        minVersion = tlsStringToProtocolVersion(optMinVersion ?? DEFAULT_MIN_VERSION);
        maxVersion = tlsStringToProtocolVersion(optMaxVersion ?? DEFAULT_MAX_VERSION);
      }
      options = { ...options, minVersion, maxVersion };
    }
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

  constructor(options, cached = false) {
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
      const crl = options.crl;
      if (crl) throwOnInvalidTLSArray("options.crl", crl);
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
    // BoringSSL's cipher-list parser has no notion of TLS 1.3 suite names —
    // Node configures those separately (and BoringSSL does not allow
    // overriding them), so they must not reach SSL_CTX_set_cipher_list.
    const requestedCiphers = options?.ciphers;
    if (requestedCiphers && StringPrototypeIncludes.$call(requestedCiphers, "TLS_")) {
      options = { ...options, ciphers: stripTls13CipherNames(requestedCiphers) };
    }
    // The native handle (SSL_CTX wrapper) is what's memoised — not this JS
    // object — so per-call fields like `servername` come from THIS call's
    // options while the expensive SSL_CTX is shared.
    this.context = newNativeSecureContext(options, cached);
    this.servername = options?.servername;
  }
};

function SecureContext(options): void {
  // Same contract as createSecureContext(): user-constructed contexts own
  // their SSL_CTX exclusively (see the note there), so delegate to it.
  return createSecureContext(options) as never;
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
  return new InternalSecureContext(options);
}

// Translate some fields from the handle's C-friendly format into more idiomatic
// javascript object representations before passing them back to the user.  Can
// be used on any cert object, but changing the name would be semver-major.
function translatePeerCertificate(c) {
  return c;
}

const ksecureContext = Symbol("ksecureContext");
const ksharedCredsOptions = Symbol("ksharedCredsOptions");
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
  this._rejectUnauthorized = false;
  this._securePending = true;
  this._newSessionPending = undefined;
  this._controlReleased = undefined;
  this.secureConnecting = false;
  this._SNICallback = undefined;
  this.servername = undefined;
  this.authorized = false;
  // Node initializes to null in the constructor (lib/internal/tls/wrap.js:556)
  // and only assigns on failure; a clean handshake leaves the null untouched.
  this.authorizationError = null;
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

  // A directly-constructed TLSSocket only rejects unauthorized peers when the
  // caller asked for it: Node's _init uses `!!options.rejectUnauthorized` here,
  // and the secure-by-default `rejectUnauthorized !== false` rule is applied by
  // tls.connect() / tls.Server, which re-derive this field from their options.
  this._rejectUnauthorized = !!options.rejectUnauthorized;

  NetSocket.$call(this, options);

  // A server-side TLSSocket is created with { isServer: true }; track it so
  // server-only guards (e.g. setServername throwing ERR_TLS_SNI_FROM_SERVER)
  // behave like Node. Accepted sockets set this again in onconnection.
  const isServer = !!options.isServer;
  this.isServer = isServer;
  // Node's _init: clients always request the peer certificate, servers only
  // when asked. Must be set before the server-wrap upgrade below builds its
  // native payload: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L845-L848
  this._requestCert = !!options.requestCert || !isServer;

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
  // Internal path: keep the per-digest cache (the user-facing constructors,
  // createSecureContext() and new tls.SecureContext(), own theirs exclusively).
  this[ksecureContext] = options.secureContext || new InternalSecureContext(options, true);
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

// Node assigns the native TLSWrap to `this.ssl` (an alias of `this._handle`)
// and a handful of upstream tests reach into `ssl.verifyError()` and `ssl.fd`.
// Expose a thin shim that reports the verification result recorded by the
// handshake handler and forwards the file descriptor; the underlying handle is
// not the same shape as Node's TLSWrap, so only the surface tests rely on is
// provided. The shim is allocated once per socket so callers can hold a stable
// reference (Node creates the TLSWrap in _init, before any handle exists).
const kVerifyError = Symbol.for("::buntlsverifyerror::");
const kSSLShim = Symbol("kSSLShim");
Object.defineProperty(TLSSocket.prototype, "ssl", {
  configurable: true,
  enumerable: false,
  get() {
    // Node nulls `ssl` when the wrap is released; report null once destroyed so
    // consumers polling `ssl` (e.g. test-tls-tlswrap-segfault) terminate.
    if (this.destroyed) return null;
    let shim = this[kSSLShim];
    if (!shim) {
      const sock = this;
      shim = this[kSSLShim] = {
        verifyError() {
          return sock[kVerifyError] ?? null;
        },
        get fd() {
          return sock._handle?.fd;
        },
      };
    }
    return shim;
  },
  // Node's `ssl` is a plain writable own property (`_init` assigns it and
  // `_destroySSL` nulls it), so assignment must stick instead of throwing on
  // a getter-only accessor: shadow the prototype accessor with an own value.
  set(value) {
    Object.defineProperty(this, "ssl", { value, writable: true, enumerable: false, configurable: true });
  },
});

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
  const ctx = context?.context ? context : new InternalSecureContext(context, true);
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
  validateInt32(size, "size");
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
  if (!this._handle) return null;
  const cert = this._handle.getCertificate?.();
  if (cert) {
    // It's not a peer cert, but the formatting is identical.
    return translatePeerCertificate(cert);
  }
  // Like Node, a connection with no local certificate reports an empty object.
  return {};
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
    ciphers: this.ciphers && stripTls13CipherNames(this.ciphers),
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
  this.crl = undefined;
  this.allowPartialTrustChain = undefined;
  this.sessionTimeout = undefined;
  this.sigalgs = undefined;
  this.passphrase = undefined;
  this.secureOptions = undefined;
  this._rejectUnauthorized = rejectUnauthorizedDefault();
  this._requestCert = undefined;
  this.servername = undefined;
  this.ALPNProtocols = undefined;
  this._sharedCreds = undefined;

  let contexts: Map<string, typeof InternalSecureContext> | null = null;

  this.addContext = function (hostname, context) {
    if (typeof hostname !== "string") {
      throw new TypeError("hostname must be a string");
    }
    if (!(context instanceof InternalSecureContext)) {
      context = new InternalSecureContext(context, true);
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
    // The STARTTLS 'connection' listener below wraps plain sockets with
    // _sharedCreds, built at the end of this function only once validation has
    // succeeded, so a throwing call cannot leave the wrap path on rejected
    // options.
    const serverTLSOptions = options;
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
      const pfxExtraCAs = options._pfxExtraCACerts;
      if (pfxExtraCAs?.length) {
        ca = ca == null ? pfxExtraCAs : Array.isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
      }
      if (ca) {
        throwOnInvalidTLSArray("options.ca", ca);
      }
      this.ca = ca;

      const crl = options.crl;
      if (crl) {
        throwOnInvalidTLSArray("options.crl", crl);
      }
      this.crl = crl;

      // A truthy allowPartialTrustChain lets store certificates act as anchors
      // (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L186);
      // Node never type-checks it, but the strict native converter needs a boolean.
      this.allowPartialTrustChain = !!options.allowPartialTrustChain;

      this.sessionTimeout = options.sessionTimeout;

      const sigalgs = options.sigalgs;
      if (sigalgs !== undefined && sigalgs !== null) {
        validateString(sigalgs, "options.sigalgs");
        if (sigalgs === "") throw $ERR_INVALID_ARG_VALUE("options.sigalgs", sigalgs);
      }
      this.sigalgs = sigalgs;

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
      // Node's server honors its own cipher order unless honorCipherOrder is
      // explicitly disabled; it reaches OpenSSL as a context option.
      if (options.honorCipherOrder !== false) secureOptions |= SSL_OP_CIPHER_SERVER_PREFERENCE;
      this.secureOptions = secureOptions;

      const requestCert = options.requestCert || false;

      if (requestCert) this._requestCert = requestCert;
      else this._requestCert = undefined;

      const rejectUnauthorized = options.rejectUnauthorized;

      if (typeof rejectUnauthorized !== "undefined") {
        // Node's tls.Server applies `rejectUnauthorized !== false`:
        // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1368
        this._rejectUnauthorized = rejectUnauthorized !== false;
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
    // Node builds one _sharedCreds per setSecureContext (wrap.js:1520) and
    // reuses it for every connection. The native accept path builds its own
    // SSL_CTX at listen time (via `this[buntls]`) and reports key/cert
    // failures on the server's 'error' event; keep that lazy contract by
    // stashing the post-normalized options here and building _sharedCreds on
    // first STARTTLS wrap so it uses the same secureOptions (with the
    // server's honorCipherOrder default) as the native path.
    this._sharedCreds = serverTLSOptions instanceof InternalSecureContext ? serverTLSOptions : null;
    this[ksharedCredsOptions] = serverTLSOptions;
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
        // `{ pem, passphrase }` key entries and a null sessionTimeout ("use
        // the default") are normalized for the strict native converter the
        // way newNativeSecureContext() does; `this.key` keeps the user value.
        key: normalizePemKeyOption(this.key, this.passphrase),
        cert: this.cert,
        ca: this.ca,
        crl: this.crl,
        allowPartialTrustChain: this.allowPartialTrustChain,
        sessionTimeout: this.sessionTimeout ?? 0,
        sigalgs: this.sigalgs,
        passphrase: this.passphrase,
        secureOptions: this.secureOptions,
        rejectUnauthorized: this._rejectUnauthorized,
        requestCert: isClient ? true : this._requestCert,
        ALPNProtocols: this.ALPNProtocols,
        clientRenegotiationLimit: CLIENT_RENEG_LIMIT,
        clientRenegotiationWindow: CLIENT_RENEG_WINDOW,
        contexts: contexts,
        ciphers: this.ciphers && stripTls13CipherNames(this.ciphers),
        // Translate minVersion/maxVersion/secureProtocol to the integer
        // protocol range the native layer applies (secureProtocol wins, like
        // Node's SecureContext::Init). When none are given the module-level
        // tls.DEFAULT_MIN_VERSION / DEFAULT_MAX_VERSION apply.
        ...(() => {
          let minVersion, maxVersion;
          const range = secureProtocolToVersionRange(this.secureProtocol);
          if (range) {
            minVersion = range[0];
            maxVersion = range[1];
          } else {
            minVersion = tlsStringToProtocolVersion(this.minVersion ?? DEFAULT_MIN_VERSION);
            maxVersion = tlsStringToProtocolVersion(this.maxVersion ?? DEFAULT_MAX_VERSION);
          }
          return { minVersion, maxVersion };
        })(),
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

  // Node's tls.Server uses its net.Server connection listener to upgrade plain
  // sockets handed in via `server.emit('connection', socket)` (the STARTTLS
  // pattern). Sockets accepted by Bun's native listener are already TLSSockets
  // and skip the wrap.
  this.on("connection", socket => {
    if (!socket || socket.encrypted || socket instanceof TLSSocket) return;
    // Build _sharedCreds once per setSecureContext, from the post-normalized
    // server fields, so every emitted socket reuses one SSL_CTX with the
    // server's honorCipherOrder default and pfx-derived CA (Node wrap.js:1520).
    let secureContext = this._sharedCreds;
    if (!secureContext) {
      secureContext = this._sharedCreds = new InternalSecureContext(
        {
          ...this[ksharedCredsOptions],
          // pfx was already parsed into this.key/cert/ca by setSecureContext.
          pfx: undefined,
          _pfxExtraCACerts: undefined,
          key: this.key,
          cert: this.cert,
          ca: this.ca,
          crl: this.crl,
          ciphers: this.ciphers,
          secureOptions: this.secureOptions,
          allowPartialTrustChain: this.allowPartialTrustChain,
          sessionTimeout: this.sessionTimeout,
          sigalgs: this.sigalgs,
          passphrase: this.passphrase,
          secureProtocol: this.secureProtocol,
          minVersion: this.minVersion,
          maxVersion: this.maxVersion,
        },
        true,
      );
    }
    const wrapped = new TLSSocket(socket, {
      secureContext,
      isServer: true,
      requestCert: this._requestCert,
      rejectUnauthorized: this._rejectUnauthorized,
      SNICallback: this._SNICallback,
      ALPNProtocols: this.ALPNProtocols,
      ALPNCallback: this._ALPNCallback,
    });
    wrapped.server = this;
    wrapped._requestCert = this._requestCert;
    wrapped._rejectUnauthorized = this._rejectUnauthorized;
    // Node's connection listener arms the server's handshakeTimeout on every
    // wrap, including sockets handed in via emit("connection"):
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L961-L962
    this[karmHandshakeTimeout](wrapped);
  });
}
$toClass(Server, "Server", NetServer);

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
const DEFAULT_ECDH_CURVE = "auto";
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

  // Own key only: Node's spread over its defaults copies own properties, so an
  // explicit `undefined` throws ERR_INVALID_ARG_TYPE (test-tls-basic-validations)
  // while an inherited one is invisible.
  if (ObjectPrototypeHasOwnProperty.$call(options, "checkServerIdentity")) {
    validateFunction(options.checkServerIdentity, "options.checkServerIdentity");
  }

  if (servername && net.isIP(servername)) {
    throw $ERR_INVALID_ARG_VALUE(
      "options.servername",
      servername,
      "Setting the TLS ServerName to an IP address is not permitted.",
    );
  }

  // Secure by default: only a literal own `false` opts out. Node spreads the
  // user options over its defaults, so an own `undefined` shadows the env var
  // and coerces to true while an omitted key falls through to it:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1732-L1781
  const hasOwnRejectUnauthorized = ObjectPrototypeHasOwnProperty.$call(options, "rejectUnauthorized");
  const rejectUnauthorized = hasOwnRejectUnauthorized
    ? options.rejectUnauthorized !== false
    : rejectUnauthorizedDefault();

  // Node's defaults-then-spread: every option the socket reads is an own key of
  // the merged object, so an inherited `rejectUnauthorized`/`checkServerIdentity`
  // can never reach it. The clone also keeps the writes below off the caller's
  // object - https.Agent keys its socket pool on it.
  const connectOptions = { checkServerIdentity, ...options, rejectUnauthorized };
  if (!ObjectPrototypeHasOwnProperty.$call(options, "ciphers") || connectOptions.ciphers == null) {
    // Read at connect time, so a runtime tls.DEFAULT_CIPHERS assignment is seen.
    connectOptions.ciphers = getDefaultCiphers();
  }
  normal[0] = connectOptions;

  if (ALPNProtocols) {
    convertALPNProtocols(ALPNProtocols, connectOptions);
  }

  const tlssock = new TLSSocket(connectOptions);
  tlssock._rejectUnauthorized = rejectUnauthorized;
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
    // Elements with no PEM certificate block are skipped, like Node's
    // ArrayOfStringsToX509s (PEM_read_bio_X509 simply finds nothing in them).
    if (!StringPrototypeIncludes.$call(text, "-----BEGIN")) continue;
    // Keep only the blocks that actually start a PEM certificate: bundle
    // files routinely begin with comment headers (curl's cacert.pem,
    // RHEL's ca-bundle.crt) that the lookahead split leaves as a leading
    // non-PEM element.
    const blocks = ArrayPrototypeFilter.$call(
      RegExpPrototypeSymbolSplit.$call(/(?=-----BEGIN [A-Z0-9 ]*CERTIFICATE-----)/, text),
      block => StringPrototypeIncludes.$call(block, "CERTIFICATE-----"),
    );
    for (const block of blocks) {
      let x509;
      try {
        x509 = new _X509CertificateClass(block as CACertInput);
      } catch (parseError: any) {
        // A PEM block whose contents do not decode fails the whole call. Node
        // built against BoringSSL reports PEM_read_bio_X509's failure with
        // this code (asserted by the openssl_is_boringssl branch of
        // test-tls-set-default-ca-certificates-recovery.js); keep the real
        // BoringSSL error message from the parse.
        const err = new Error(parseError?.message || "Failed to parse certificate") as Error & { code: string };
        err.code = "ERR_OSSL_PEM_ASN.1_ENCODING_ROUTINES";
        throw err;
      }
      const fingerprint = x509.fingerprint256;
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        normalized.push(x509.toString());
      }
    }
  }
  // A non-empty input that yields no certificates is an error in Node
  // (crypto_context.cc: "No valid certificates found in the provided array").
  if (normalized.length === 0 && certs.length > 0) {
    throw $ERR_CRYPTO_OPERATION_FAILED("No valid certificates found in the provided array");
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
  return !StringPrototypeStartsWith.$call(a, "TLS_");
}

// Drops TLS 1.3 suite names from a cipher string before it is handed to
// SSL_CTX_set_cipher_list (see the note in InternalSecureContext).
function stripTls13CipherNames(ciphers: string): string {
  if (!StringPrototypeIncludes.$call(ciphers, "TLS_")) return ciphers;
  const kept = ArrayPrototypeFilter.$call(StringPrototypeSplit.$call(ciphers, ":"), tlsCipherFilter);
  return ArrayPrototypeJoin.$call(kept, ":");
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
      value = stripTls13CipherNames(value);
    }
    setTLSDefaultCiphers(value);
  },
  DEFAULT_ECDH_CURVE,
  // Accessors so `tls.DEFAULT_MAX_VERSION = 'TLSv1.2'` reaches the
  // module-level variables that context construction reads (Node mutates the
  // exports object the same way).
  get DEFAULT_MAX_VERSION() {
    return DEFAULT_MAX_VERSION;
  },
  set DEFAULT_MAX_VERSION(value) {
    DEFAULT_MAX_VERSION = value;
  },
  get DEFAULT_MIN_VERSION() {
    return DEFAULT_MIN_VERSION;
  },
  set DEFAULT_MIN_VERSION(value) {
    DEFAULT_MIN_VERSION = value;
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
