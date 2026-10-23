// Hardcoded module "node:tls"
const { isAnyArrayBuffer, isArrayBufferView } = require("node:util/types");
const net = require("node:net");
const Duplex = require("internal/streams/duplex");
const EventEmitter = require("node:events");
const addServerName = $bindgen("Listener.bind.ts", "addServerName");
const setListenerSecureContext = $bindgen("Listener.bind.ts", "setSecureContext");
const firstFlightBeforeFin = $bindgen("socket_body.bind.ts", "firstFlightBeforeFin");
const { throwNotImplemented, kInternalAssertionSuffix } = require("internal/shared");
const { idnaToASCII } = require("internal/url");
const {
  throwOnInvalidTLSArray,
  nativeCiphersAndVersions,
  normalizePemKeyOption,
  processPfxOptions,
  readSecureContextOptions,
  stripTls13CipherNames,
  validateSecureContextOptions,
  SSL_OP_CIPHER_SERVER_PREFERENCE,
  hasStreamMethods,
} = require("internal/tls");
const {
  validateString,
  validateNumber,
  validateUint32,
  validateInt32,
  validateBuffer,
  validateFunction,
} = require("internal/validators");

const { Server: NetServer, Socket: NetSocket } = net;
const {
  kAcceptedTLS,
  kArmHandshakeTimeout,
  kPreHandshakeWrite,
  kSecureConnectDone,
  kSNIContexts,
  kStandaloneWrap,
  kTLSHandle,
  kUpgradeClientTLS,
  kVerifyError,
} = require("internal/net/symbols");

const getBundledRootCertificates = $newCppFunction("NodeTLS.cpp", "getBundledRootCertificates", 1);
const getExtraCACertificates = $newCppFunction("NodeTLS.cpp", "getExtraCACertificates", 1);
// Node warns at the first secure context; the once-per-process native load is what prints it.
const maybeWarnAboutExtraCACerts = $newCppFunction("NodeTLS.cpp", "loadExtraCACertificates", 0);
const getSystemCACertificates = $newCppFunction("NodeTLS.cpp", "getSystemCACertificates", 1);
const canonicalizeIP = $newCppFunction("NodeTLS.cpp", "Bun__canonicalizeIP", 1);
const parseCACertificates = $newCppFunction("NodeTLS.cpp", "parseCACertificates", 1);

const getTLSDefaultCiphers = $bindgen("node_tls_binding.bind.ts", "getDefaultCiphers");
const setTLSDefaultCiphers = $bindgen("node_tls_binding.bind.ts", "setDefaultCiphers");
const getTLSDefaultCA = $bindgen("node_tls_binding.bind.ts", "getDefaultCA");
const setTLSDefaultCA = $bindgen("node_tls_binding.bind.ts", "setDefaultCA");
const getDefaultCACertificateTypes = $bindgen("node_tls_binding.bind.ts", "getDefaultCACertificateTypes");
const selectServerName = $newCppFunction("NodeTLS.cpp", "selectServerName", 2);
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

// tls.connect() and tls.createServer() report a list that matches nothing in OpenSSL's words. A bare context reports BoringSSL's.
function checkCipherMatch(ciphers: string) {
  const ciphersSet = getValidCiphersSet();
  const requested = StringPrototypeSplit.$call(ciphers, ":");
  let sawLegacyEntry = false;
  let sawUsableEntry = false;
  for (const r of requested) {
    if (!r) continue;
    // BoringSSL has no security levels, and its parser rejects @SECLEVEL with INVALID_COMMAND. This is that error in Node's shape.
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
    // Operators (`!X`, `-X`, `+X`, `A+B`), `@STRENGTH` and selector keywords (HIGH, PSK, aNULL) aren't cipher names: BoringSSL evaluates them.
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
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringFromCharCode = String.fromCharCode;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;

const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSome = Array.prototype.some;
const ArrayPrototypeReduce = Array.prototype.reduce;
const ArrayPrototypeSort = Array.prototype.sort;

const ObjectFreeze = Object.freeze;

function parseCertString() {
  // Removed since JAN 2022 Node v18.0.0+ https://github.com/nodejs/node/pull/41479
  throwNotImplemented("Not implemented");
}

// Mirrors Node's getAllowUnauthorized(): warn (once) when certificate
// verification is disabled by NODE_TLS_REJECT_UNAUTHORIZED=0.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/options.js#L204-L215
let warnOnAllowUnauthorized = true;
function getAllowUnauthorized() {
  const allowUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";

  if (allowUnauthorized && warnOnAllowUnauthorized) {
    warnOnAllowUnauthorized = false;
    process.emitWarning(
      "Setting the NODE_TLS_REJECT_UNAUTHORIZED " +
        "environment variable to '0' makes TLS connections " +
        "and HTTPS requests insecure by disabling " +
        "certificate verification.",
    );
  }
  return allowUnauthorized;
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

  // Node lets "*" match the empty label of ".example.com", the IDNA form of "。example.com".
  if (hostSubdomain === "") return false;

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
  // CVE-2026-48618: UTS #46 maps "。" to ".". Not url.domainToASCII() as in Node.js: that URL host parse cuts the name at "/".
  const hostnameASCII =
    RegExpPrototypeExec.$call(/[^\u0000-\u007F]/, hostname) === null ? hostname : idnaToASCII(hostname);

  // Remove trailing dots for error messages and matching.
  hostname = unfqdn(hostname);
  const hostnameASCIIWithoutFQDN = unfqdn(hostnameASCII);

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

  // As in Node.js (https://github.com/nodejs/node/commit/1d87a24050), a host is an IP address only as typed.
  if (net.isIP(hostname)) {
    // canonicalizeIP() drops the zone id of "fe80::1%eth0". It is undefined for a malformed IP SAN, and undefined must not match undefined.
    const ip = canonicalizeIP(hostname);
    valid = ip !== undefined && ArrayPrototypeIncludes.$call(ips, ip);
    if (!valid) reason = `IP: ${hostname} is not in the cert's list: ` + ArrayPrototypeJoin.$call(ips, ", ");
  } else {
    const hasDnsNames = dnsNames.length > 0;
    if (hasDnsNames || subject?.CN) {
      // Not in Node.js: a host with a character that no hostname has matches nothing, as in rustls and mozilla::pkix. "*.evil.test" would cover "localhost/.evil.test".
      const isHostname = RegExpPrototypeExec.$call(/[^A-Za-z0-9._-]/, hostnameASCIIWithoutFQDN) === null;
      const hostParts = isHostname ? splitHost(hostnameASCIIWithoutFQDN) : [];
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
const NativeSecureContext = $bindgen("SecureContext.bind.ts", "SecureContext");

// SNI is a C string, so as in Node.js it ends at a NUL. checkServerIdentity() still gets the whole servername.
function sniName(servername) {
  if (typeof servername !== "string") return servername;
  const nul = StringPrototypeIndexOf.$call(servername, "\0");
  return nul === -1 ? servername : StringPrototypeSlice.$call(servername, 0, nul);
}

// `options` is a record of ours, never a caller's object, so it's normalized in place.
function newNativeSecureContext(options, cached = false) {
  maybeWarnAboutExtraCACerts();
  options = processPfxOptions(options);
  options.servername = sniName(options.servername);
  // A bundle's CAs and the ticket keys change the context once it's built, so it can't be the shared cached one.
  const pfxExtraCAs = options._pfxExtraCACerts;
  const ticketKeys = options.ticketKeys;
  if (pfxExtraCAs || ticketKeys != null) cached = false;
  // Node counts a falsy key, cert or ca as absent (test-tls-options-boolean-check.js). The native parser only takes null.
  options.key = normalizePemKeyOption(options.key, options.passphrase) || null;
  options.cert ||= null;
  options.ca ||= null;
  options.sessionTimeout ??= 0;
  if (options.ecdhCurve === undefined) options.ecdhCurve = DEFAULT_ECDH_CURVE;
  const rejectUnauthorized = options.rejectUnauthorized;
  if (rejectUnauthorized !== undefined && typeof rejectUnauthorized !== "boolean") options.rejectUnauthorized = true;
  if (options.allowPartialTrustChain !== undefined) options.allowPartialTrustChain = !!options.allowPartialTrustChain;
  if (options.honorCipherOrder) options.secureOptions = options.secureOptions | 0 | SSL_OP_CIPHER_SERVER_PREFERENCE;
  ObjectAssign(options, nativeCiphersAndVersions(options, DEFAULT_MIN_VERSION, DEFAULT_MAX_VERSION));
  const ctx = (cached ? NativeSecureContext.intern : NativeSecureContext.createPrivate)(options);
  if (pfxExtraCAs) {
    for (const pem of pfxExtraCAs) ctx.addCACert(pem);
  }
  if (ticketKeys != null) ctx.setTicketKeys(ticketKeys);
  return ctx;
}

var InternalSecureContext = class SecureContext {
  context;
  servername;

  constructor(options, cached = false) {
    // The native handle (SSL_CTX wrapper) is what's memoised — not this JS
    // object — so per-call fields like `servername` come from THIS call's
    // options while the expensive SSL_CTX is shared.
    this.servername = options.servername;
    this.context = newNativeSecureContext(options, cached);
  }
};

// Every check node:tls makes of a context's options. Each path to a context runs it once.
function validateContextOptions(options, matchCiphers) {
  validateSecureContextOptions(options);
  const { ciphers, cert, key, ca, crl, servername, secureOptions } = options;
  if (matchCiphers && ciphers) checkCipherMatch(ciphers);
  if (cert) throwOnInvalidTLSArray("options.cert", cert);
  if (key) throwOnInvalidTLSArray("options.key", key);
  if (ca) throwOnInvalidTLSArray("options.ca", ca);
  if (crl) throwOnInvalidTLSArray("options.crl", crl);
  if (servername != null) validateString(servername, "options.servername");
  if (secureOptions != null) validateNumber(secureOptions, "options.secureOptions");
}

// For options as a caller gave them. tls.Server reads and checks its own before it stages them.
function newSecureContext(options, cached, matchCiphers = false) {
  options = readSecureContextOptions(options || {});
  validateContextOptions(options, matchCiphers);
  return new InternalSecureContext(options, cached);
}

function SecureContext(options): void {
  return createSecureContext(options) as never;
}
SecureContext.prototype = InternalSecureContext.prototype;
InternalSecureContext.prototype.constructor = SecureContext;

function createSecureContext(options) {
  if (options instanceof InternalSecureContext) return options;
  // The native handle (SSL_CTX) is memoised inside `NativeSecureContext.intern`
  // by the per-VM `SSLContextCache`, so no JS-side hashing here. The JS wrapper
  // is built fresh because it carries the per-call `servername`.
  // The user-facing constructor owns its SSL_CTX exclusively so addCACert
  // cannot leak across contexts; a TLSSocket's own and addContext()'s stay cached.
  return newSecureContext(options, false);
}

const ksecureContext = Symbol("ksecureContext");
const kcheckServerIdentity = Symbol("kcheckServerIdentity");
const ksession = Symbol("ksession");
const kservername = Symbol("kservername");
const krenegotiationDisabled = Symbol("renegotiationDisabled");

const buntls = Symbol.for("::buntls::");
// net.ts's SNI dispatch uses this to recognize a raw native SecureContext
// (Node's `context.context || context` unwrap accepts both the wrapper and
// the unwrapped native context).
const kNativeSecureContextCtor = Symbol.for("::buntlsnativesecurecontextctor::");

// `target` is a tls.Server or a server-side TLSSocket: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L929
function takeServerCallbacks(target, options) {
  const sniCallback = options.SNICallback;
  if (sniCallback) {
    validateFunction(sniCallback, "options.SNICallback");
    target._SNICallback = sniCallback;
  }
  const alpnCallback = options.ALPNCallback;
  if (alpnCallback) {
    validateFunction(alpnCallback, "options.ALPNCallback");
    // Node forbids combining the dynamic callback with a static list.
    if (options.ALPNProtocols) {
      throw $ERR_TLS_ALPN_CALLBACK_WITH_PROTOCOLS();
    }
    target._ALPNCallback = alpnCallback;
  }
}

function TLSSocket(socket?, options?) {
  this[kAcceptedTLS] = null;
  this[ksecureContext] = undefined;
  this.ALPNProtocols = undefined;
  this[kcheckServerIdentity] = undefined;
  this[ksession] = undefined;
  this[kservername] = undefined;
  this.alpnProtocol = null;
  this._secureEstablished = false;
  this._rejectUnauthorized = false;
  this._securePending = true;
  this._newSessionPending = undefined;
  this._controlReleased = false;
  this.secureConnecting = false;
  this._SNICallback = undefined;
  this.servername = undefined;
  this.authorized = false;
  // Node initializes this to null and only replaces it with the verification
  // error code when authorization fails:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L556
  this.authorizationError = null;
  this[krenegotiationDisabled] = undefined;
  this.encrypted = true;

  const isDuplex = socket instanceof Duplex;
  // The first argument can be the options object instead of a stream.
  const isOtherStream = !isDuplex && !!socket && hasStreamMethods(socket);
  // Node throws when it tries to wrap something that isn't a stream.
  if (!isDuplex && !isOtherStream && socket && (options !== undefined || socket instanceof EventEmitter)) {
    throw $ERR_INVALID_ARG_TYPE("socket", "Duplex", socket);
  }
  const isNetSocketOrDuplex = isDuplex || isOtherStream;

  // A wrapped socket keeps its allowHalfOpen and drops onread: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L592-L596
  if (isNetSocketOrDuplex) {
    options = { ...options, allowHalfOpen: socket.allowHalfOpen, onread: null };
  } else {
    options = options || socket || {};
    const wrapped = options.socket;
    if (wrapped instanceof Duplex || (wrapped && hasStreamMethods(wrapped))) {
      options = { ...options, allowHalfOpen: wrapped.allowHalfOpen, onread: null };
    }
  }

  this._rejectUnauthorized = !!options.rejectUnauthorized;

  // Never forward readable / writable / typeOfService: node's TLSSocket builds its own net.Socket options. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L590-L600
  NetSocket.$call(
    this,
    options.readable === undefined && options.writable === undefined && options.typeOfService === undefined
      ? options
      : { ...options, readable: undefined, writable: undefined, typeOfService: undefined },
  );

  // Node's _init installs this as the first 'error' listener and removes it in
  // _releaseControl: until control is handed to the user it routes errors
  // through '_tlsError' (which the server turns into 'tlsClientError') and
  // keeps a destroy(err) from surfacing as an uncaught exception.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L606
  this.on("error", this._tlsError);

  // A server-side TLSSocket is created with { isServer: true }; track it so
  // server-only guards (e.g. setServername throwing ERR_TLS_SNI_FROM_SERVER)
  // behave like Node. Accepted sockets set this again in onconnection.
  const isServer = !!options.isServer;
  this.isServer = isServer;
  this._requestCert = !!options.requestCert || !isServer;

  // They mean nothing to a client, so Node doesn't look at a client's.
  if (isServer) takeServerCallbacks(this, options);

  const { ALPNProtocols, secureContext } = options;
  if (ALPNProtocols) {
    convertALPNProtocols(ALPNProtocols, this);
    // What convertALPNProtocols() leaves alone, Node's setALPNProtocols() refuses. A string or an ArrayBuffer is ignored, as on 1.4.4.
    if (this.ALPNProtocols === undefined && typeof ALPNProtocols !== "string" && !isAnyArrayBuffer(ALPNProtocols)) {
      throw new TypeError("Must give a Buffer as first argument");
    }
  }
  if (secureContext) {
    if (!(secureContext.context instanceof NativeSecureContext)) {
      throw $ERR_TLS_INVALID_CONTEXT("context must be a SecureContext");
    }
    // Node doesn't look at `ciphers` next to a context. 1.4.4 checked it.
    const ciphers = options.ciphers;
    if (ciphers) {
      validateString(ciphers, "options.ciphers");
      checkCipherMatch(ciphers);
    }
  }
  // Cached by digest. createSecureContext() and new tls.SecureContext() own theirs.
  this[ksecureContext] = secureContext || newSecureContext(options, true, true);
  this.secureConnecting = true;
  const checkServerIdentityOption = options.checkServerIdentity;
  if (checkServerIdentityOption !== undefined) {
    validateFunction(checkServerIdentityOption, "options.checkServerIdentity");
  }
  this[kcheckServerIdentity] = checkServerIdentityOption || checkServerIdentity;
  this[ksession] = options.session || null;

  // Both upgrades live in net.ts (module-private state); _handle stays unset until one hands back the TLS handle.
  if (isNetSocketOrDuplex) {
    if (isServer) {
      this[Symbol.for("::bunUpgradeServerTLS::")](socket, this[buntls](null));
    } else {
      // The rule of tls.connect(): an untrusted certificate is rejected unless the caller passes `false`.
      this._rejectUnauthorized = ObjectPrototypeHasOwnProperty.$call(options, "rejectUnauthorized")
        ? options.rejectUnauthorized !== false
        : !getAllowUnauthorized();
      this[kStandaloneWrap] = true;
      this[kUpgradeClientTLS](socket, options.servername);
      // http2-wrapper reads `new TLSSocket(new PassThrough())._handle._parentWrap.constructor` as its JSStreamSocket.
      const handle = this._handle;
      if (handle) handle._parentWrap = this;
    }
  }
}
$toClass(TLSSocket, "TLSSocket", NetSocket);

const kSSLShim = Symbol("kSSLShim");
Object.defineProperty(TLSSocket.prototype, "ssl", {
  configurable: true,
  enumerable: false,
  get() {
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
  set(value) {
    Object.defineProperty(this, "ssl", { value, writable: true, enumerable: false, configurable: true });
  },
});

Object.defineProperty(TLSSocket.prototype, kTLSHandle, {
  configurable: true,
  enumerable: false,
  get() {
    return this._handle;
  },
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1060-L1079
TLSSocket.prototype._tlsError = function _tlsError(err) {
  this.emit("_tlsError", err);
  if (this._controlReleased) return err;
  return null;
};

TLSSocket.prototype._emitTLSError = function _emitTLSError(err) {
  const e = this._tlsError(err);
  if (e) this.emit("error", e);
};

TLSSocket.prototype._releaseControl = function _releaseControl() {
  if (this._controlReleased) return false;
  this._controlReleased = true;
  this.removeListener("error", this._tlsError);
  return true;
};

TLSSocket.prototype._destroySSL = function _destroySSL() {
  // Releases the TLS state for this socket; the connection itself is torn
  // down by the caller (Node's callers always destroy() right after). The
  // native socket frees its SSL when it closes, so there is nothing to free
  // separately here.
  this.secureConnecting = false;
  this._secureEstablished = false;
};

TLSSocket.prototype._start = function _start() {
  // Node sends the ClientHello of a constructor wrap here (the mysql driver calls it). Ours went out in the constructor.
};

TLSSocket.prototype._final = function _final(callback) {
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1119-L1133
  if (this.secureConnecting && this[kPreHandshakeWrite]) {
    return this.once(kSecureConnectDone, NetSocket.prototype._final.bind(this, callback));
  }
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1203-L1213
  return NetSocket.prototype._final.$call(this, callback);
};

TLSSocket.prototype.getSession = function getSession() {
  return this[kTLSHandle]?.getSession?.();
};

TLSSocket.prototype.getEphemeralKeyInfo = function getEphemeralKeyInfo() {
  const info = this[kTLSHandle]?.getEphemeralKeyInfo?.();
  if (info == null) return info;
  // Empirically node always surfaces all three keys here (values undefined when
  // absent): a client socket on a TLS 1.3 ECDHE session observes
  // Object.keys(...) === ['type','name','size'] under node v26.3.0, so the
  // reshape below is required for key-set parity with our native return.
  return { type: info.type, name: info.name, size: info.size };
};

TLSSocket.prototype.getCipher = function getCipher() {
  return this[kTLSHandle]?.getCipher?.();
};

TLSSocket.prototype.getSharedSigalgs = function getSharedSigalgs() {
  return this[kTLSHandle]?.getSharedSigalgs?.();
};

TLSSocket.prototype.getProtocol = function getProtocol() {
  // Node returns the negotiated protocol string, or null once the socket is no
  // longer connected (e.g. after 'close').
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/_tls_wrap.js#L1455
  return this[kTLSHandle]?.getTLSVersion?.() ?? null;
};

TLSSocket.prototype.getFinished = function getFinished() {
  return this[kTLSHandle]?.getTLSFinishedMessage?.() || undefined;
};

TLSSocket.prototype.getPeerFinished = function getPeerFinished() {
  return this[kTLSHandle]?.getTLSPeerFinishedMessage?.() || undefined;
};

TLSSocket.prototype.isSessionReused = function isSessionReused() {
  return this[kTLSHandle]?.isSessionReused?.() ?? false;
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

  const socket = this[kTLSHandle];
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
  return this[kTLSHandle]?.disableRenegotiation?.();
};

TLSSocket.prototype.getTLSTicket = function getTLSTicket() {
  return this[kTLSHandle]?.getTLSTicket?.();
};

// Lets net.ts's SNI dispatch recognize a raw native SecureContext returned by
// a socket-level SNICallback (`new tls.TLSSocket(sock, { isServer: true,
// SNICallback })`), where the handler's `this` is the socket, not a Server.
TLSSocket.prototype[kNativeSecureContextCtor] = NativeSecureContext;

TLSSocket.prototype.setKeyCert = function setKeyCert(context) {
  // Serve this connection's identity from the given context (Node calls this
  // from ALPNCallback/SNICallback before the certificate is sent). Accepts a
  // SecureContext or the same options object createSecureContext takes.
  const ctx = context?.context ? context : newSecureContext(context, true);
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1679
  if (this.isServer) this[kTLSHandle]?.setKeyCert?.(ctx.context);
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
    return this[kTLSHandle]?.exportKeyingMaterial?.(length, label, context);
  }
  return this[kTLSHandle]?.exportKeyingMaterial?.(length, label);
};

TLSSocket.prototype.setMaxSendFragment = function setMaxSendFragment(size) {
  validateInt32(size, "size");
  return this[kTLSHandle]?.setMaxSendFragment?.(size) || false;
};

TLSSocket.prototype.enableTrace = function enableTrace() {
  // only for debug purposes so we just mock for now
};

TLSSocket.prototype.setServername = function setServername(name) {
  validateString(name, "name");
  if (this.isServer) {
    throw $ERR_TLS_SNI_FROM_SERVER();
  }
  this[kservername] = name;
  this.servername = name;
  this[kTLSHandle]?.setServername?.(name);
};

TLSSocket.prototype.setSession = function setSession(session) {
  this[ksession] = session;
  if (typeof session === "string") session = Buffer.from(session, "latin1");
  return this[kTLSHandle]?.setSession?.(session);
};

TLSSocket.prototype.getPeerCertificate = function getPeerCertificate(detailed) {
  const handle = this[kTLSHandle];
  if (handle) {
    // The native parameter means "abbreviated" - the inverse of Node's
    // `detailed`. Detailed requests get the whole chain with
    // issuerCertificate links; everything else gets just the leaf.
    return (arguments.length < 1 ? handle.getPeerCertificate?.() : handle.getPeerCertificate?.(!detailed)) || {};
  }
  return null;
};

TLSSocket.prototype.getCertificate = function getCertificate() {
  const handle = this[kTLSHandle];
  if (!handle) return null;
  return handle.getCertificate?.() || {};
};

TLSSocket.prototype.getPeerX509Certificate = function getPeerX509Certificate() {
  // Build the X509Certificate chain from the detailed peer-certificate
  // objects, linking each to its issuer the way Node does. The
  // `issuerCertificate` own property shadows the prototype getter (which is
  // always undefined for certificates parsed outside a TLS connection).
  const cert = this.getPeerCertificate(true);
  if (!cert || !cert.raw) {
    return this[kTLSHandle]?.getPeerX509Certificate?.();
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
  return this[kTLSHandle]?.getX509Certificate?.();
};

TLSSocket.prototype[buntls] = function (host) {
  const ctx = this[ksecureContext];
  // RFC 6066 forbids IP literals in SNI. Match Node.js: only default servername to host
  // when host is not an IP. For IP hosts, pass "" so the native layer skips SNI instead of
  // falling back to the connection host.
  let servername = this.servername || this[kservername] || ctx?.servername;
  if (servername == null) {
    servername = host && !net.isIP(host) ? host : "";
  }
  return {
    ALPNProtocols: this.ALPNProtocols,
    checkServerIdentity: this[kcheckServerIdentity],
    builtinCheckServerIdentity: checkServerIdentity,
    session: this[ksession],
    rejectUnauthorized: this._rejectUnauthorized,
    requestCert: this._requestCert,
    // Hand the native SSL_CTX wrapper to upgradeTLS so it can up_ref instead
    // of rebuilding from raw cert/key bytes.
    secureContext: ctx?.context,
    servername,
    serverName: sniName(servername),
  };
};

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1599-L1611
function SNICallback(servername, callback) {
  callback(null, selectServerName(this.server[kSNIContexts], servername));
}

function Server(options, secureConnectionListener): void {
  if (!(this instanceof Server)) {
    return new Server(options, secureConnectionListener);
  }

  // tls.createServer(options) requires an object (a function is the connection
  // listener); matches Node throwing ERR_INVALID_ARG_TYPE for e.g. a string.
  if (typeof options === "function") {
    secureConnectionListener = options;
    options = {};
  } else if (options != null && typeof options !== "object") {
    throw $ERR_INVALID_ARG_TYPE("options", "object", options);
  }
  if (options != null) takeServerCallbacks(this, options);

  // The listener belongs on "secureConnection", not "connection": do not let
  // the net.Server constructor register it.
  NetServer.$apply(this, [options]);

  this.key = undefined;
  this.cert = undefined;
  this.ca = undefined;
  this.crl = undefined;
  this.allowPartialTrustChain = undefined;
  this.sessionTimeout = undefined;
  this.ticketKeys = undefined;
  this.sigalgs = undefined;
  this.ecdhCurve = undefined;
  this.passphrase = undefined;
  this.secureOptions = undefined;
  // The Server constructor is the only writer of these: node assigns them
  // here and Server.prototype.setSecureContext never touches them, so a later
  // context swap cannot change whether client certificates are requested.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1367-L1368
  // NODE_TLS_REJECT_UNAUTHORIZED is a client-side switch; a server's default
  // is unconditionally true.
  const serverOptions = options instanceof InternalSecureContext ? undefined : options;
  this._requestCert = serverOptions?.requestCert === true ? true : undefined;
  this._rejectUnauthorized = serverOptions?.rejectUnauthorized !== false;
  this.servername = undefined;
  this.ALPNProtocols = undefined;
  // Constructor-only in node, like the two flags above: setSecureContext() never reads it.
  if (serverOptions?.ALPNProtocols) convertALPNProtocols(serverOptions.ALPNProtocols, this);
  this._sharedCreds = undefined;

  const contexts = (this[kSNIContexts] = new Map<string, InstanceType<typeof InternalSecureContext>>());

  this.addContext = function (hostname, context) {
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1571-L1574
    if (!hostname) {
      throw $ERR_TLS_REQUIRED_SERVER_NAME();
    }
    if (typeof hostname !== "string") {
      throw new TypeError("hostname must be a string");
    }
    if (!(context instanceof InternalSecureContext)) {
      context = newSecureContext(context, true);
    }
    const handle = this._handle;
    if (handle) {
      // Pass the native SSL_CTX wrapper, not the JS InternalSecureContext —
      // the native side detects it via SecureContext.fromJS and up_refs.
      addServerName(handle, hostname, context.context);
    }
    // listen() replays the map in order: a re-added name moves to the end.
    contexts.$delete(hostname);
    contexts.$set(hostname, context);
  };

  let listenerContext;
  // What the last setSecureContext() that named options built its context from.
  let contextOptions: Record<string, any> = { __proto__: null };

  this.setSecureContext = function (options) {
    const isContext = options instanceof InternalSecureContext;
    // An instance names no key, as in Node.
    let given = isContext ? {} : options;
    let staged = contextOptions;
    if (given) {
      given = readSecureContextOptions(given);
      // A falsy value counts as absent: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1423-L1518
      given.pfx ||= undefined;
      given.key ||= undefined;
      given.passphrase ||= undefined;
      given.cert ||= undefined;
      given.clientCertEngine ||= undefined;
      given.ca ||= undefined;
      given.minVersion ||= undefined;
      given.maxVersion ||= undefined;
      given.secureProtocol ||= undefined;
      given.crl ||= undefined;
      given.ciphers ||= undefined;
      given.secureOptions ||= undefined;
      given.sessionTimeout ||= undefined;
      given.ticketKeys ||= undefined;
      given.servername ||= undefined;
      validateContextOptions(given, true);
      given = processPfxOptions(given);

      let ca = given.ca;
      // An mTLS server verifies clients against the bundle's own CA chain, so it goes into `ca`.
      const pfxExtraCAs = given._pfxExtraCACerts;
      if (pfxExtraCAs?.length) {
        // They extend tls.setDefaultCACertificates()'s list, which a `ca` of only them would replace.
        ca ??= getTLSDefaultCA();
        ca = ca == null ? pfxExtraCAs : Array.isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
      }
      let secureOptions = given.secureOptions || 0;
      if (given.honorCipherOrder !== false) secureOptions |= SSL_OP_CIPHER_SERVER_PREFERENCE;

      // Names every field, so an option this call omits clears the previous call's value, as in Node.
      staged = {
        __proto__: null,
        key: given.key,
        cert: given.cert,
        ca,
        crl: given.crl,
        allowPartialTrustChain: !!given.allowPartialTrustChain,
        sessionTimeout: given.sessionTimeout,
        // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1482-L1483: omitting it keeps the previous keys
        ticketKeys: given.ticketKeys || this.ticketKeys,
        sigalgs: given.sigalgs,
        ecdhCurve: given.ecdhCurve,
        passphrase: given.passphrase,
        servername: given.servername,
        secureOptions,
        ciphers: given.ciphers,
        secureProtocol: given.secureProtocol,
        minVersion: given.minVersion,
        maxVersion: given.maxVersion,
      };
    }
    // Not interned: no other server or client may share its session cache and ticket keys. Throws on material BoringSSL rejects, before any field changes.
    const own = new InternalSecureContext({
      ...given,
      pfx: undefined,
      _pfxExtraCACerts: undefined,
      ...staged,
      // The verify mode accepted sockets inherit. setSecureContext() does not name them.
      requestCert: this._requestCert === true,
      rejectUnauthorized: this._rejectUnauthorized,
    });
    // Accepted sockets take their verify mode from the context, so the listener's is always this server's own.
    listenerContext = own.context;
    if (given) {
      const handle = this._handle;
      if (handle) setListenerSecureContext(handle, listenerContext);
      contextOptions = staged;
      ObjectAssign(this, staged);
    }
    this._sharedCreds = isContext ? options : own;
  };

  this[buntls] = function (host) {
    return [
      {
        serverName: sniName(this.servername || host || "localhost"),
        secureContext: listenerContext,
        rejectUnauthorized: this._rejectUnauthorized,
        requestCert: this._requestCert,
        ALPNProtocols: this.ALPNProtocols,
        contexts,
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

  this.on("connection", socket => {
    if (!socket) return;
    // Skip only the accept path's own emit. A TLSSocket emitted again gets a TLS session inside it, like in Node.
    if (socket[kAcceptedTLS] === this) {
      socket[kAcceptedTLS] = null;
      return;
    }
    const wrapped = new TLSSocket(socket, {
      secureContext: this._sharedCreds,
      isServer: true,
      requestCert: this._requestCert,
      rejectUnauthorized: this._rejectUnauthorized,
      SNICallback: this._SNICallback ?? (contexts.size ? SNICallback : undefined),
      ALPNProtocols: this.ALPNProtocols,
      ALPNCallback: this._ALPNCallback,
    });
    wrapped.server = this;
    wrapped._requestCert = this._requestCert;
    wrapped._rejectUnauthorized = this._rejectUnauthorized;
    this[kArmHandshakeTimeout](wrapped);
  });

  // Node registers the createServer callback as a plain "secureConnection"
  // listener, so a manual emit("secureConnection", socket) reaches it.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1408-L1410
  if (secureConnectionListener) {
    this.on("secureConnection", secureConnectionListener);
  }
}
$toClass(Server, "Server", NetServer);

// Lets net.ts's SNI dispatch recognize a raw native SecureContext handed to
// an SNICallback (the `context.context || context` unwrap accepts both the
// wrapper and the unwrapped native context).
Server.prototype[kNativeSecureContextCtor] = NativeSecureContext;

Server.prototype.getTicketKeys = function getTicketKeys() {
  return this._sharedCreds.context.getTicketKeys();
};

Server.prototype.setTicketKeys = function setTicketKeys(keys) {
  if (!isArrayBufferView(keys)) {
    throw $ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView"], keys);
  }
  if (keys.byteLength !== 48) {
    throw $ERR_INTERNAL_ASSERTION("Session ticket keys must be a 48-byte buffer" + kInternalAssertionSuffix);
  }
  this._sharedCreds.context.setTicketKeys(keys);
};

function createServer(options, connectionListener) {
  return new Server(options, connectionListener);
}
let DEFAULT_ECDH_CURVE = "auto";
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
  const servername = options.servername as string | undefined;

  // Read per connection, and it warns even if `rejectUnauthorized` overrides it: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1730
  const allowUnauthorized = getAllowUnauthorized();

  // Node rejects an own key that is `undefined` (test-tls-basic-validations). The TLSSocket constructor checks every other value.
  if (
    options.checkServerIdentity === undefined &&
    ObjectPrototypeHasOwnProperty.$call(options, "checkServerIdentity")
  ) {
    validateFunction(undefined, "options.checkServerIdentity");
  }

  // BoringSSL has no finite-field DHE ciphers, so there's never a DH key to compare against this.
  if (ObjectPrototypeHasOwnProperty.$call(options, "minDHSize")) {
    validateNumber(options.minDHSize, "options.minDHSize", 1);
  }

  if (servername && net.isIP(servername)) {
    throw $ERR_INVALID_ARG_VALUE(
      "options.servername",
      servername,
      "Setting the TLS ServerName to an IP address is not permitted.",
    );
  }

  const rejectUnauthorized = ObjectPrototypeHasOwnProperty.$call(options, "rejectUnauthorized")
    ? options.rejectUnauthorized !== false
    : !allowUnauthorized;

  const connectOptions: Record<PropertyKey, any> = {
    checkServerIdentity,
    ...options,
    // Node's spread would drop an inherited one, which 1.4.4 took.
    ALPNProtocols: options.ALPNProtocols,
    rejectUnauthorized,
  };
  if (!ObjectPrototypeHasOwnProperty.$call(options, "ciphers") || connectOptions.ciphers == null) {
    connectOptions.ciphers = getDefaultCiphers();
  }
  normal[0] = connectOptions;

  // win-ca, mac-ca and syswide-cas replace tls.createSecureContext to add CAs. Skip the built-in one so TLSSocket reuses its cached SSL_CTX.
  const createContext = tlsExports.createSecureContext;
  if (createContext !== createSecureContext && !connectOptions.secureContext) {
    connectOptions.secureContext = createContext(connectOptions);
  }

  const tlssock = new TLSSocket(connectOptions);
  // A client socket is the caller's from the start, so its errors are theirs
  // to handle: node releases control before the connection is even started.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1798
  tlssock._releaseControl();
  // Honor the `timeout` option here: Socket.prototype.connect does not (only
  // the net.createConnection factory does), so tls.connect applies it
  // explicitly, exactly like Node's tls connect.
  // https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/wrap.js#L1791
  const timeout = options.timeout;
  if (timeout) {
    tlssock.setTimeout(timeout);
  }
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1795
  if (!options.socket) tlssock.once("connect", onConnectStart);
  return tlssock.connect(normal);
}

// The engine sends the ClientHello when the listeners of 'connect' have run. An end() of theirs must not get ahead of it.
function onConnectStart() {
  firstFlightBeforeFin(this._handle);
}

function getCiphers() {
  const ciphers = ["tls_aes_128_gcm_sha256", "tls_aes_256_gcm_sha384", "tls_chacha20_poly1305_sha256"];
  for (const name of getValidCiphersSet()) ArrayPrototypePush.$call(ciphers, StringPrototypeToLowerCase.$call(name));
  return ArrayPrototypeSort.$call(ciphers);
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

let defaultCACertificates: string[] | undefined;
function cacheDefaultCACertificates() {
  if (defaultCACertificates) return defaultCACertificates;
  defaultCACertificates = [];

  const types = getDefaultCACertificateTypes();
  for (let i = 0; i < types.length; ++i) {
    const certs = getCACertificates(types[i]);
    for (let j = 0; j < certs.length; ++j) {
      ArrayPrototypePush.$call(defaultCACertificates, certs[j]);
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

type CACertInput = string | NodeJS.ArrayBufferView;
// tls.setDefaultCACertificates(certs)
// https://github.com/nodejs/node/blob/v25.2.1/lib/tls.js#L202
// Node validates `certs` as an Array (its ERR_INVALID_ARG_TYPE renders the
// 'Array' name as "an instance of Array"; Bun's validateArray renders the same
// name as "of type Array", so build the error directly to match Node here),
// then hands the certs to the native root store.
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
  const snapshot: Array<CACertInput> = [];
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (typeof cert !== "string" && !isArrayBufferView(cert)) {
      throw $ERR_INVALID_ARG_TYPE(`certs[${i}]`, "string or an instance of ArrayBufferView", cert);
    }
    snapshot.push(cert);
  }
  const normalized = parseCACertificates(snapshot);
  if (normalized.length === 0 && snapshot.length > 0) {
    throw $ERR_CRYPTO_OPERATION_FAILED("No valid certificates found in the provided array");
  }
  setTLSDefaultCA(normalized);
}

function getCACertificates(type = "default") {
  validateString(type, "type");

  switch (type) {
    case "default":
      return getTLSDefaultCA() ?? cacheDefaultCACertificates();
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

function getDefaultCiphers() {
  // TLS_ will always be present until SSL_CTX_set_cipher_list is supported see default_ciphers.h
  const ciphers = getTLSDefaultCiphers();
  return `TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256${ciphers ? ":" + ciphers : ""}`;
}

const tlsExports = {
  CLIENT_RENEG_LIMIT: 3,
  CLIENT_RENEG_WINDOW: 600,
  connect,
  convertALPNProtocols,
  createSecureContext,
  createServer,
  get DEFAULT_CIPHERS() {
    return getDefaultCiphers();
  },
  set DEFAULT_CIPHERS(value) {
    if (value) {
      validateString(value, "value.ciphers");
      checkCipherMatch(value);
      // filter out TLS_ ciphers
      value = stripTls13CipherNames(value).cipherList;
      // Throws ERR_SSL_NO_CIPHER_MATCH for a list such as "!aNULL": every default context is built from what is stored.
      newNativeSecureContext({ ciphers: value });
    }
    setTLSDefaultCiphers(value);
  },
  get DEFAULT_ECDH_CURVE() {
    return DEFAULT_ECDH_CURVE;
  },
  set DEFAULT_ECDH_CURVE(value) {
    DEFAULT_ECDH_CURVE = value;
  },
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
};
Object.defineProperty(tlsExports, "rootCertificates", { configurable: false });

export default tlsExports as any as typeof import("node:tls") & {
  SecureContext: typeof SecureContext;
  convertALPNProtocols: typeof convertALPNProtocols;
};
