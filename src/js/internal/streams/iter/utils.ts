// Port of Node.js lib/internal/streams/iter/utils.js
// Trimmed to the helpers needed by pull/consumers/FileHandle (the push,
// broadcast, and share families are not ported).

const { isUint8Array, isSharedArrayBuffer } = require("node:util/types");

// Shared TextEncoder instance for string conversion.
const encoder = new TextEncoder();

/**
 * Convert a chunk (string or Uint8Array) to Uint8Array.
 * Strings are UTF-8 encoded.
 */
function toUint8Array(chunk) {
  if (typeof chunk === "string") {
    return encoder.encode(chunk);
  }
  if (!isUint8Array(chunk)) {
    throw $ERR_INVALID_ARG_TYPE("chunk", ["string", "Uint8Array"], chunk);
  }
  return chunk;
}

/**
 * Check if all chunks in an array are already Uint8Array (no strings).
 */
function allUint8Array(chunks) {
  for (let i = 0; i < chunks.length; i++) {
    if (typeof chunks[i] === "string") return false;
  }
  return true;
}

/**
 * Concatenate multiple Uint8Arrays into a single Uint8Array.
 */
function concatBytes(chunks) {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  if (chunks.length === 1) {
    const chunk = chunks[0];
    if (chunk.byteOffset === 0) {
      const buf = chunk.buffer;
      const bufByteLength = isSharedArrayBuffer(buf) ? buf.byteLength : buf.byteLength;
      if (chunk.byteLength === bufByteLength) {
        return chunk;
      }
    }
    return new Uint8Array(chunk);
  }
  let totalByteLength = 0;
  for (let i = 0; i < chunks.length; i++) {
    totalByteLength += chunks[i].byteLength;
  }
  const concatenated = new Uint8Array(totalByteLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    concatenated.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  return concatenated;
}

/**
 * Convert an array of chunks (strings or Uint8Arrays) to a Uint8Array[].
 * Always returns a fresh copy of the array.
 */
function convertChunks(chunks) {
  if (allUint8Array(chunks)) {
    return chunks.slice();
  }
  const len = chunks.length;
  const result = new Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = toUint8Array(chunks[i]);
  }
  return result;
}

/**
 * Wrap a caught value as an Error, converting non-Error values.
 */
function wrapError(error) {
  return error instanceof Error ? error : $ERR_OPERATION_FAILED(`Operation failed: ${String(error)}`);
}

/**
 * Check if a value implements a Symbol-keyed protocol.
 */
function hasProtocol(value, symbol) {
  return value !== null && typeof value === "object" && symbol in value && typeof value[symbol] === "function";
}

/**
 * Check if a value is PullOptions (object without transform or write property).
 */
function isPullOptions(value) {
  return value !== null && typeof value === "object" && !("transform" in value) && !("write" in value);
}

/**
 * Check if a value is a stateful transform object (has a transform method).
 */
function isTransformObject(value) {
  return typeof value?.transform === "function";
}

/**
 * Check if a value is a valid transform (function or transform object).
 */
function isTransform(value) {
  return typeof value === "function" || isTransformObject(value);
}

/**
 * Parse variadic arguments for pull/pullSync.
 * Returns { transforms, options }
 */
function parsePullArgs(args) {
  if (args.length === 0) {
    return { __proto__: null, transforms: [], options: undefined };
  }

  let transforms;
  let options;
  const last = args[args.length - 1];
  if (isPullOptions(last)) {
    transforms = args.slice(0, -1);
    options = last;
  } else {
    transforms = args;
    options = undefined;
  }

  for (let i = 0; i < transforms.length; i++) {
    if (!isTransform(transforms[i])) {
      throw $ERR_INVALID_ARG_TYPE(`transforms[${i}]`, ["Function", "Object with transform()"], transforms[i]);
    }
  }

  return { __proto__: null, transforms, options };
}

export default {
  allUint8Array,
  concatBytes,
  convertChunks,
  hasProtocol,
  isPullOptions,
  isTransform,
  isTransformObject,
  parsePullArgs,
  toUint8Array,
  wrapError,
};
