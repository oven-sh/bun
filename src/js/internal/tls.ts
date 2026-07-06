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

const VALID_TLS_ERROR_MESSAGE_TYPES = "string or an instance of Buffer, TypedArray, DataView, or BunFile";

// Negative session timeouts are rejected (min 0), and null means "not provided",
// matching Node — newer OpenSSL/BoringSSL do not handle negative values the way
// users expect. Shared so tls.Server and https.Server reject the same inputs.
// https://github.com/nodejs/node/blob/614050b657e9757c1097aa85f92f2cb51149dc0d/lib/internal/tls/secure-context.js#L319
function validateSessionTimeout(sessionTimeout: unknown) {
  if (sessionTimeout === undefined || sessionTimeout === null) return;
  // Node validates this with validateInt32(..., 0), whose range message reads
  // ">= 0 && <= 2147483647"; the shared validator words it differently, so the
  // check is spelled out to match.
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

export {
  VALID_TLS_ERROR_MESSAGE_TYPES,
  isValidTLSArray,
  isValidTLSItem,
  throwOnInvalidTLSArray,
  validateSessionTimeout,
};
