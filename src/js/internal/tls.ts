const { isTypedArray, isArrayBuffer } = require("node:util/types");
const { validateString } = require("internal/validators");

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

// BoringSSL TLS1_x_VERSION constants (from openssl/tls1.h). The native context
// applies these via SSL_CTX_set_min/max_proto_version.
const TLS1_VERSION = 0x0301;
const TLS1_1_VERSION = 0x0302;
const TLS1_2_VERSION = 0x0303;
const TLS1_3_VERSION = 0x0304;

const VALID_TLS_VERSIONS = new Set(["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"]);

// Backs tls.DEFAULT_MIN_VERSION / tls.DEFAULT_MAX_VERSION. Kept here so node:tls
// and the node:http(s) server resolve version bounds from one source of truth.
// https://github.com/Jarred-Sumner/uSockets/blob/fafc241e8664243fc0c51d69684d5d02b9805134/src/crypto/openssl.c#L519-L523
const defaultProtocolVersions = { min: "TLSv1.2", max: "TLSv1.3" };

// Node seeds the protocol-version defaults from its --tls-min-vX.Y /
// --tls-max-vX.Y CLI flags; the equivalent flags reach us through
// process.execArgv. The lowest requested minimum and the highest requested
// maximum win when several are passed, matching node_options precedence.
{
  const execArgv = process.execArgv;
  const hasFlag = (flag: string) => execArgv.includes(flag);
  if (hasFlag("--tls-min-v1.0")) defaultProtocolVersions.min = "TLSv1";
  else if (hasFlag("--tls-min-v1.1")) defaultProtocolVersions.min = "TLSv1.1";
  else if (hasFlag("--tls-min-v1.2")) defaultProtocolVersions.min = "TLSv1.2";
  else if (hasFlag("--tls-min-v1.3")) defaultProtocolVersions.min = "TLSv1.3";
  if (hasFlag("--tls-max-v1.3")) defaultProtocolVersions.max = "TLSv1.3";
  else if (hasFlag("--tls-max-v1.2")) defaultProtocolVersions.max = "TLSv1.2";
}

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
 * Translate minVersion/maxVersion/secureProtocol into the integer protocol
 * range the native TLS context applies. secureProtocol wins over the explicit
 * bounds, like Node's SecureContext::Init; unset bounds fall back to
 * tls.DEFAULT_MIN_VERSION / tls.DEFAULT_MAX_VERSION.
 */
function resolveProtocolVersionRange(minVersion, maxVersion, secureProtocol) {
  const range = secureProtocolToVersionRange(secureProtocol);
  if (range) return { minVersion: range[0], maxVersion: range[1] };
  return {
    minVersion: tlsStringToProtocolVersion(minVersion ?? defaultProtocolVersions.min),
    maxVersion: tlsStringToProtocolVersion(maxVersion ?? defaultProtocolVersions.max),
  };
}

function validateProtocolVersions(minVersion, maxVersion) {
  if (minVersion != null && !VALID_TLS_VERSIONS.has(minVersion))
    throw $ERR_TLS_INVALID_PROTOCOL_VERSION(String(minVersion), "minimum");
  if (maxVersion != null && !VALID_TLS_VERSIONS.has(maxVersion))
    throw $ERR_TLS_INVALID_PROTOCOL_VERSION(String(maxVersion), "maximum");
}

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

export {
  VALID_TLS_ERROR_MESSAGE_TYPES,
  defaultProtocolVersions,
  isValidTLSArray,
  isValidTLSItem,
  resolveProtocolVersionRange,
  throwOnInvalidTLSArray,
  validateProtocolVersions,
  validateSecureProtocol,
};
