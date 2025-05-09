const { isTypedArray, isArrayBuffer } = require("node:util/types");

const getDefaultMinTLSVersionFromCLIFlag = $newZigFunction(
  "node_tls_binding.zig",
  "getDefaultMinTLSVersionFromCLIFlag",
  0,
) as () => number | null;

const getDefaultMaxTLSVersionFromCLIFlag = $newZigFunction(
  "node_tls_binding.zig",
  "getDefaultMaxTLSVersionFromCLIFlag",
  0,
) as () => number | null;

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

function getTlsVersionOrDefault(version: number | null, fallback: import("node:tls").SecureVersion) {
  if (!version) return fallback;
  const asString = TLS_VERSION_REVERSE_MAP[version];
  if (!asString) return fallback;
  return asString;
}

const DEFAULT_MIN_VERSION: import("node:tls").SecureVersion = getTlsVersionOrDefault(
  getDefaultMinTLSVersionFromCLIFlag(),
  "TLSv1.2",
);
const DEFAULT_MAX_VERSION: import("node:tls").SecureVersion = getTlsVersionOrDefault(
  getDefaultMaxTLSVersionFromCLIFlag(),
  "TLSv1.3",
);

const TLS_VERSION_MAP = {
  "TLSv1": 0x0301,
  "TLSv1.1": 0x0302,
  "TLSv1.2": 0x0303,
  "TLSv1.3": 0x0304,
} as const satisfies Record<import("node:tls").SecureVersion, number>;

const TLS_VERSION_REVERSE_MAP: {
  [Key in keyof typeof TLS_VERSION_MAP as (typeof TLS_VERSION_MAP)[Key]]: Key;
} = {
  0x0301: "TLSv1",
  0x0302: "TLSv1.1",
  0x0303: "TLSv1.2",
  0x0304: "TLSv1.3",
};

function resolveTLSVersions(options: import("node:tls").TLSSocketOptions): [min: number, max: number] {
  const secureProtocol = options?.secureProtocol;

  const hasSecureProtocol = secureProtocol !== undefined;
  const hasMinVersionOption = options && options.minVersion !== undefined;
  const hasMaxVersionOption = options && options.maxVersion !== undefined;

  if (hasSecureProtocol && (hasMinVersionOption || hasMaxVersionOption)) {
    throw $ERR_TLS_PROTOCOL_VERSION_CONFLICT(
      TLS_VERSION_REVERSE_MAP[hasMinVersionOption ? options.minVersion : options.maxVersion],
      secureProtocol,
    );
  }

  let minVersionName: import("node:tls").SecureVersion;
  let maxVersionName: import("node:tls").SecureVersion;

  if (hasSecureProtocol) {
    if (typeof secureProtocol !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.secureProtocol", "string", secureProtocol);
    }
    switch (secureProtocol) {
      case "TLSv1_method":
        minVersionName = maxVersionName = "TLSv1";
        break;
      case "TLSv1_1_method":
        minVersionName = maxVersionName = "TLSv1.1";
        break;
      case "TLSv1_2_method":
        minVersionName = maxVersionName = "TLSv1.2";
        break;
      case "TLSv1_3_method":
        minVersionName = maxVersionName = "TLSv1.3";
        break;
      case "TLS_method":
      case "SSLv23_method":
        minVersionName = DEFAULT_MIN_VERSION;
        maxVersionName = DEFAULT_MAX_VERSION;
        break;
      default:
        throw $ERR_TLS_INVALID_PROTOCOL_METHOD(secureProtocol);
    }
  } else {
    minVersionName = options && options.minVersion !== undefined ? options.minVersion : DEFAULT_MIN_VERSION;
    maxVersionName = options && options.maxVersion !== undefined ? options.maxVersion : DEFAULT_MAX_VERSION;
  }

  if (minVersionName) {
    if (typeof minVersionName !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.minVersion", "string", minVersionName);
    }
    if (!(minVersionName in TLS_VERSION_MAP)) {
      throw $ERR_TLS_INVALID_PROTOCOL_VERSION(minVersionName, "minimum");
    }
  }
  const minVersion = TLS_VERSION_MAP[minVersionName];

  if (maxVersionName) {
    if (typeof maxVersionName !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.maxVersion", "string", maxVersionName);
    }
    if (!(maxVersionName in TLS_VERSION_MAP)) {
      throw $ERR_TLS_INVALID_PROTOCOL_VERSION(maxVersionName, "maximum");
    }
  }
  const maxVersion = TLS_VERSION_MAP[maxVersionName];

  return [minVersion, maxVersion];
}

export { VALID_TLS_ERROR_MESSAGE_TYPES, isValidTLSArray, isValidTLSItem, resolveTLSVersions, throwOnInvalidTLSArray };
