const { isTypedArray, isArrayBuffer } = require("node:util/types");
const { ConnResetException } = require("internal/shared");

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

/**
 * Build the Error for a server-side handshake that failed before completing. A
 * fatal SSL protocol error (wrong version number, bad record, ...) carries the
 * OpenSSL error string in `verifyError.reason`; everything else is the peer
 * disconnecting mid-handshake, which Node reports as ECONNRESET.
 */
function tlsHandshakeError(verifyError) {
  const verifyErrorCode = verifyError ? verifyError.code : undefined;
  if (verifyErrorCode && verifyErrorCode !== "ECONNRESET") {
    const reason = verifyError.reason || verifyError.message || "TLS handshake failed";
    const err = new Error(reason) as Error & {
      code?: string;
      library?: string;
      function?: string;
      reason?: string;
    };
    // A fatal SSL-library error carries the full OpenSSL error string
    // ("error:0a00042e:SSL routines:OPENSSL_internal:TLSV1_ALERT_PROTOCOL_VERSION").
    // Decompose it into Node's library/function/reason properties and the
    // ERR_SSL_<REASON> code the way ThrowCryptoError does.
    const match = /^error:[0-9a-f]+:SSL routines:([^:]*):(.+)$/.exec(reason);
    if (match) {
      err.library = "SSL routines";
      err.function = match[1];
      err.reason = match[2];
      err.code = `ERR_SSL_${match[2]}`;
    } else {
      err.code = verifyErrorCode;
    }
    return err;
  }
  return new ConnResetException("socket hang up");
}

export {
  VALID_TLS_ERROR_MESSAGE_TYPES,
  isValidTLSArray,
  isValidTLSItem,
  throwOnInvalidTLSArray,
  tlsHandshakeError,
};
