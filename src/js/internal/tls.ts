const { isTypedArray, isArrayBuffer } = require("node:util/types");
const { validateString } = require("internal/validators");

function isValidTLSItem(obj: unknown) {
  if (typeof obj === "string" || isTypedArray(obj) || isArrayBuffer(obj) || $inheritsBlob(obj)) {
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

// `{ pem, passphrase? }` is only an element form of the `key` array; `cert` and
// `ca` take the raw forms only.
function isPemObject(entry: unknown): entry is { pem: unknown; passphrase?: unknown } {
  return $isObject(entry) && (entry as { pem?: unknown }).pem !== undefined;
}

/**
 * Validates `options.key` and unwraps the `{ pem, passphrase? }` array elements
 * documented by `tls.createSecureContext`. An entry's own passphrase applies to
 * that key alone, which a native secure context (one passphrase per SSL_CTX)
 * cannot express, so that entry's key is decrypted here instead. Returns `key`
 * untouched when there is nothing to unwrap.
 * https://github.com/nodejs/node/blob/main/lib/internal/tls/secure-context.js
 */
function normalizeKeyOption(key: unknown) {
  if (!$isArray(key)) {
    throwOnInvalidTLSArray("options.key", key);
    return key;
  }

  const length = key.length;
  let hasPemObject = false;
  for (let i = 0; i < length; i++) {
    if (isPemObject(key[i])) {
      hasPemObject = true;
      break;
    }
  }
  if (!hasPemObject) {
    throwOnInvalidTLSArray("options.key", key);
    return key;
  }

  let createPrivateKey;
  const normalized = $newArrayWithSize(length);
  for (let i = 0; i < length; i++) {
    const entry = key[i];
    const isPem = isPemObject(entry);
    const pem = isPem ? entry.pem : entry;
    if (!isValidTLSItem(pem)) {
      throw $ERR_INVALID_ARG_TYPE("options.key", VALID_TLS_ERROR_MESSAGE_TYPES, pem);
    }

    const passphrase = isPem ? entry.passphrase : undefined;
    if ($isUndefinedOrNull(passphrase)) {
      normalized[i] = pem;
      continue;
    }

    validateString(passphrase, "options.passphrase");
    createPrivateKey ??= require("node:crypto").createPrivateKey;
    normalized[i] = createPrivateKey({ key: pem, passphrase }).export({ type: "pkcs8", format: "pem" });
  }
  return normalized;
}

export { VALID_TLS_ERROR_MESSAGE_TYPES, isValidTLSArray, isValidTLSItem, normalizeKeyOption, throwOnInvalidTLSArray };
