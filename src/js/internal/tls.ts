const { isTypedArray, isArrayBuffer } = require("node:util/types");

const DEFAULT_CIPHERS =
  "DHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256";

const DEFAULT_CIPHERS_LIST = DEFAULT_CIPHERS.split(":");
const DEFAULT_CIPHERS_SET = new Set([...DEFAULT_CIPHERS_LIST.map(c => c.toLowerCase()), ...DEFAULT_CIPHERS_LIST]);

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

function validateCiphers(ciphers: string) {
  const requested = ciphers.split(":");
  for (const r of requested) {
    if (!DEFAULT_CIPHERS_SET.has(r)) {
      throw $ERR_SSL_NO_CIPHER_MATCH();
    }
  }
}

const VALID_TLS_ERROR_MESSAGE_TYPES = "string or an instance of Buffer, TypedArray, DataView, or BunFile";

export {
  DEFAULT_CIPHERS,
  DEFAULT_CIPHERS_LIST,
  DEFAULT_CIPHERS_SET,
  VALID_TLS_ERROR_MESSAGE_TYPES,
  isValidTLSArray,
  isValidTLSItem,
  throwOnInvalidTLSArray,
  validateCiphers,
};
