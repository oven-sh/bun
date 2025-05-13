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
  const maybeConflictVersion = options.minVersion || options.maxVersion;
  if (secureProtocol && maybeConflictVersion) {
    throw $ERR_TLS_PROTOCOL_VERSION_CONFLICT(maybeConflictVersion, secureProtocol);
  }

  let minVersionName: import("node:tls").SecureVersion = DEFAULT_MIN_VERSION;
  let maxVersionName: import("node:tls").SecureVersion = DEFAULT_MAX_VERSION;

  // Node's C++ logic: https://github.com/nodejs/node/blob/main/src/crypto/crypto_context.cc
  if (typeof secureProtocol === "string") {
    if (
      secureProtocol === "SSLv2_method" ||
      secureProtocol === "SSLv2_server_method" ||
      secureProtocol === "SSLv2_client_method"
    ) {
      throw $ERR_TLS_INVALID_PROTOCOL_METHOD("SSLv2 methods disabled");
    } else if (
      secureProtocol === "SSLv3_method" ||
      secureProtocol === "SSLv3_server_method" ||
      secureProtocol === "SSLv3_client_method"
    ) {
      throw $ERR_TLS_INVALID_PROTOCOL_METHOD("SSLv3 methods disabled");
    } else if (secureProtocol === "SSLv23_method") {
      minVersionName = DEFAULT_MIN_VERSION;
      maxVersionName = DEFAULT_MAX_VERSION;
    } else if (secureProtocol === "SSLv23_server_method") {
      minVersionName = DEFAULT_MIN_VERSION;
      maxVersionName = DEFAULT_MAX_VERSION;
    } else if (secureProtocol === "SSLv23_client_method") {
      minVersionName = DEFAULT_MIN_VERSION;
      maxVersionName = DEFAULT_MAX_VERSION;
      // method = TLS_client_method();
    } else if (secureProtocol === "TLS_method") {
      minVersionName = "TLSv1";
      maxVersionName = "TLSv1.3";
    } else if (secureProtocol === "TLS_server_method") {
      minVersionName = "TLSv1";
      maxVersionName = "TLSv1.3";
      // method = TLS_server_method();
    } else if (secureProtocol === "TLS_client_method") {
      minVersionName = "TLSv1";
      maxVersionName = "TLSv1.3";
      // method = TLS_client_method();
    } else if (secureProtocol === "TLSv1_method") {
      minVersionName = maxVersionName = "TLSv1";
    } else if (secureProtocol === "TLSv1_server_method") {
      minVersionName = maxVersionName = "TLSv1";
      // method = TLS_server_method();
    } else if (secureProtocol === "TLSv1_client_method") {
      minVersionName = maxVersionName = "TLSv1";
      // method = TLS_client_method();
    } else if (secureProtocol === "TLSv1_1_method") {
      minVersionName = maxVersionName = "TLSv1.1";
    } else if (secureProtocol === "TLSv1_1_server_method") {
      minVersionName = maxVersionName = "TLSv1.1";
      // method = TLS_server_method();
    } else if (secureProtocol === "TLSv1_1_client_method") {
      minVersionName = maxVersionName = "TLSv1.1";
      // method = TLS_client_method();
    } else if (secureProtocol === "TLSv1_2_method") {
      minVersionName = maxVersionName = "TLSv1.2";
    } else if (secureProtocol === "TLSv1_2_server_method") {
      minVersionName = maxVersionName = "TLSv1.2";
      // method = TLS_server_method();
    } else if (secureProtocol === "TLSv1_2_client_method") {
      minVersionName = maxVersionName = "TLSv1.2";
      // method = TLS_client_method();
    } else if (secureProtocol === "TLSv1_3_method") {
      minVersionName = maxVersionName = "TLSv1.3";
    } else if (secureProtocol === "TLSv1_3_server_method") {
      minVersionName = maxVersionName = "TLSv1.3";
      // method = TLS_server_method();
    } else if (secureProtocol === "TLSv1_3_client_method") {
      minVersionName = maxVersionName = "TLSv1.3";
      // method = TLS_client_method();
    } else {
      throw $ERR_TLS_INVALID_PROTOCOL_METHOD(`Unknown method: ${secureProtocol}`);
    }
  } else {
    minVersionName = options && options.minVersion !== undefined ? options.minVersion : DEFAULT_MIN_VERSION;
    maxVersionName = options && options.maxVersion !== undefined ? options.maxVersion : DEFAULT_MAX_VERSION;
  }

  let minVersion: number;
  let maxVersion: number;

  if (typeof minVersionName === "string") {
    if (!(minVersionName in TLS_VERSION_MAP)) {
      throw $ERR_TLS_INVALID_PROTOCOL_VERSION(minVersionName, "minimum");
    }
    minVersion = TLS_VERSION_MAP[minVersionName];
  } else {
    throw $ERR_INVALID_ARG_TYPE("options.minVersion", "string", minVersionName);
  }

  if (typeof maxVersionName === "string") {
    if (!(maxVersionName in TLS_VERSION_MAP)) {
      throw $ERR_TLS_INVALID_PROTOCOL_VERSION(maxVersionName, "maximum");
    }
    maxVersion = TLS_VERSION_MAP[maxVersionName];
  } else {
    throw $ERR_INVALID_ARG_TYPE("options.maxVersion", "string", maxVersionName);
  }

  return [minVersion, maxVersion];
}

function validateTLSOptions(options: any) {
  if (!options || typeof options !== "object") return;

  let cert = options.cert;
  if (cert) throwOnInvalidTLSArray("options.cert", cert);

  let key = options.key;
  if (key) throwOnInvalidTLSArray("options.key", key);

  let ca = options.ca;
  if (ca) throwOnInvalidTLSArray("options.ca", ca);

  if (!$isUndefinedOrNull(options.privateKeyIdentifier)) {
    if ($isUndefinedOrNull(options.privateKeyEngine)) {
      throw $ERR_INVALID_ARG_VALUE("options.privateKeyEngine", options.privateKeyEngine);
    } else if (typeof options.privateKeyEngine !== "string") {
      throw $ERR_INVALID_ARG_TYPE(
        "options.privateKeyEngine",
        ["string", "null", "undefined"],
        options.privateKeyEngine,
      );
    }
    if (typeof options.privateKeyIdentifier !== "string") {
      throw $ERR_INVALID_ARG_TYPE(
        "options.privateKeyIdentifier",
        ["string", "null", "undefined"],
        options.privateKeyIdentifier,
      );
    }
  }

  const ciphers = options.ciphers;
  if (ciphers !== undefined && typeof ciphers !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.ciphers", "string", ciphers);
  }

  const passphrase = options.passphrase;
  if (passphrase !== undefined && typeof passphrase !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
  }

  const servername = options.servername;
  if (servername !== undefined && typeof servername !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.servername", "string", servername);
  }

  const ecdhCurve = options.ecdhCurve;
  if (ecdhCurve !== undefined && typeof ecdhCurve !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.ecdhCurve", "string", ecdhCurve);
  }

  const handshakeTimeout = options.handshakeTimeout;
  if (handshakeTimeout !== undefined && typeof handshakeTimeout !== "number") {
    throw $ERR_INVALID_ARG_TYPE("options.handshakeTimeout", "number", handshakeTimeout);
  }

  const sessionTimeout = options.sessionTimeout;
  if (sessionTimeout !== undefined && typeof sessionTimeout !== "number") {
    throw $ERR_INVALID_ARG_TYPE("options.sessionTimeout", "number", sessionTimeout);
  }

  const ticketKeys = options.ticketKeys;
  if (ticketKeys !== undefined) {
    if (!Buffer.isBuffer(ticketKeys)) {
      throw $ERR_INVALID_ARG_TYPE("options.ticketKeys", "Buffer", ticketKeys);
    }
    if (ticketKeys.length !== 48) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.ticketKeys",
        ticketKeys.length,
        "The property 'options.ticketKeys' must be exactly 48 bytes",
      );
    }
  }

  const secureOptions = options.secureOptions || 0;
  if (secureOptions && typeof secureOptions !== "number") {
    throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
  }

  const requestCert = options.requestCert;
  if (requestCert !== undefined && typeof requestCert !== "boolean") {
    throw $ERR_INVALID_ARG_TYPE("options.requestCert", "boolean", requestCert);
  }

  const rejectUnauthorized = options.rejectUnauthorized;
  if (rejectUnauthorized !== undefined && typeof rejectUnauthorized !== "boolean") {
    throw $ERR_INVALID_ARG_TYPE("options.rejectUnauthorized", "boolean", rejectUnauthorized);
  }
}

let warnOnAllowUnauthorized = true;

function getAllowUnauthorized(): boolean {
  const allowUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";

  if (allowUnauthorized && warnOnAllowUnauthorized) {
    warnOnAllowUnauthorized = false;
    process.emitWarning(
      "Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS " +
        "connections and HTTPS requests insecure by disabling certificate verification.",
    );
  }
  return allowUnauthorized;
}

export default {
  getAllowUnauthorized,
  isValidTLSArray,
  isValidTLSItem,
  resolveTLSVersions,
  throwOnInvalidTLSArray,
  VALID_TLS_ERROR_MESSAGE_TYPES,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
  validateTLSOptions,

  TLS_VERSION_REVERSE_MAP,
  TLS_VERSION_MAP,
};
