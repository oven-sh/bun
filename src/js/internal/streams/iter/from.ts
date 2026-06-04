// Port of Node.js lib/internal/streams/iter/from.js
//
// Creates normalized byte stream iterables from various input types.
// Handles recursive flattening of nested iterables and protocol conversions.

const { isAnyArrayBuffer, isPromise, isTypedArray, isUint8Array } = require("node:util/types");

const { kValidatedSource, toStreamable, toAsyncStreamable } = require("internal/streams/iter/types");

const { hasProtocol, toUint8Array } = require("internal/streams/iter/utils");

const SymbolIterator = Symbol.iterator;
const SymbolAsyncIterator = Symbol.asyncIterator;
const ArrayIsArray = Array.isArray;
const ArrayBufferIsView = ArrayBuffer.isView;

// Maximum number of chunks to yield per batch from from()/fromSync().
const FROM_BATCH_SIZE = 128;

// =============================================================================
// Type Guards and Detection
// =============================================================================

/**
 * Check if value is a primitive chunk (string, ArrayBuffer, or ArrayBufferView).
 */
function isPrimitiveChunk(value) {
  return typeof value === "string" || isAnyArrayBuffer(value) || ArrayBufferIsView(value);
}

/**
 * Check if value is a sync iterable (has Symbol.iterator).
 */
function isSyncIterable(value) {
  return typeof value !== "string" && typeof value?.[SymbolIterator] === "function";
}

/**
 * Check if value is an async iterable (has Symbol.asyncIterator).
 */
function isAsyncIterable(value) {
  return typeof value?.[SymbolAsyncIterator] === "function";
}

// =============================================================================
// Primitive Conversion
// =============================================================================

/**
 * Convert a primitive chunk to Uint8Array.
 */
function primitiveToUint8Array(chunk) {
  if (typeof chunk === "string") {
    return toUint8Array(chunk);
  }
  if (isAnyArrayBuffer(chunk)) {
    return new Uint8Array(chunk);
  }
  if (isUint8Array(chunk)) {
    return chunk;
  }
  return arrayBufferViewToUint8Array(chunk);
}

function arrayBufferViewToUint8Array(chunk) {
  if (isTypedArray(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  // DataView
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

// =============================================================================
// Sync Normalization (for fromSync and sync contexts)
// =============================================================================

/**
 * Normalize a sync streamable yield value to Uint8Array chunks.
 */
function* normalizeSyncValue(value) {
  if (isPrimitiveChunk(value)) {
    yield primitiveToUint8Array(value);
    return;
  }

  if (hasProtocol(value, toStreamable)) {
    const result = value[toStreamable]();
    yield* normalizeSyncValue(result);
    return;
  }

  if (ArrayIsArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* normalizeSyncValue(value[i]);
    }
    return;
  }

  if (isSyncIterable(value)) {
    for (const item of value) {
      yield* normalizeSyncValue(item);
    }
    return;
  }

  throw $ERR_INVALID_ARG_TYPE("value", ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "toStreamable"], value);
}

/**
 * Check if value is already a Uint8Array[] batch (fast path).
 */
function isUint8ArrayBatch(value) {
  if (!ArrayIsArray(value)) return false;
  const len = value.length;
  if (len === 0) return true;
  if (len === 1) return isUint8Array(value[0]);
  if (!isUint8Array(value[0]) || !isUint8Array(value[len - 1])) return false;
  if (len === 2) return true;
  for (let i = 1; i < len - 1; i++) {
    if (!isUint8Array(value[i])) return false;
  }
  return true;
}

function* yieldBoundedBatch(batch) {
  if (batch.length === 0) {
    return;
  }
  if (batch.length <= FROM_BATCH_SIZE) {
    yield batch;
    return;
  }
  for (let i = 0; i < batch.length; i += FROM_BATCH_SIZE) {
    yield batch.slice(i, i + FROM_BATCH_SIZE);
  }
}

/**
 * Normalize a sync streamable source, yielding batches of Uint8Array.
 */
function* normalizeSyncSource(source) {
  let batch = [];

  for (const value of source) {
    if (isUint8ArrayBatch(value)) {
      if (batch.length > 0) {
        yield batch;
        batch = [];
      }
      yield* yieldBoundedBatch(value);
      continue;
    }
    if (isUint8Array(value)) {
      batch.push(value);
      if (batch.length === FROM_BATCH_SIZE) {
        yield batch;
        batch = [];
      }
      continue;
    }
    if (batch.length > 0) {
      yield batch;
      batch = [];
    }
    let valueBatch = [];
    for (const chunk of normalizeSyncValue(value)) {
      valueBatch.push(chunk);
      if (valueBatch.length === FROM_BATCH_SIZE) {
        yield valueBatch;
        valueBatch = [];
      }
    }
    if (valueBatch.length > 0) {
      yield valueBatch;
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}

// =============================================================================
// Async Normalization (for from and async contexts)
// =============================================================================

/**
 * Normalize an async streamable yield value to Uint8Array chunks.
 */
async function* normalizeAsyncValue(value) {
  if (isPromise(value)) {
    const resolved = await value;
    yield* normalizeAsyncValue(resolved);
    return;
  }

  if (isPrimitiveChunk(value)) {
    yield primitiveToUint8Array(value);
    return;
  }

  if (hasProtocol(value, toAsyncStreamable)) {
    const result = value[toAsyncStreamable]();
    if (isPromise(result)) {
      yield* normalizeAsyncValue(await result);
    } else {
      yield* normalizeAsyncValue(result);
    }
    return;
  }

  if (hasProtocol(value, toStreamable)) {
    const result = value[toStreamable]();
    yield* normalizeAsyncValue(result);
    return;
  }

  if (ArrayIsArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* normalizeAsyncValue(value[i]);
    }
    return;
  }

  if (isAsyncIterable(value)) {
    for await (const item of value) {
      yield* normalizeAsyncValue(item);
    }
    return;
  }

  if (isSyncIterable(value)) {
    for (const item of value) {
      yield* normalizeAsyncValue(item);
    }
    return;
  }

  throw $ERR_INVALID_ARG_TYPE(
    "value",
    ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "AsyncIterable", "toStreamable", "toAsyncStreamable"],
    value,
  );
}

/**
 * Normalize an async streamable source, yielding batches of Uint8Array.
 */
async function* normalizeAsyncSource(source) {
  if (isAsyncIterable(source)) {
    for await (const value of source) {
      if (isUint8ArrayBatch(value)) {
        if (value.length > 0) {
          yield value;
        }
        continue;
      }
      if (isUint8Array(value)) {
        yield [value];
        continue;
      }
      const batch = [];
      for await (const chunk of normalizeAsyncValue(value)) {
        batch.push(chunk);
      }
      if (batch.length > 0) {
        yield batch;
      }
    }
    return;
  }

  if (isSyncIterable(source)) {
    let batch = [];

    for (const value of source) {
      if (isUint8ArrayBatch(value)) {
        if (batch.length > 0) {
          yield batch;
          batch = [];
        }
        yield* yieldBoundedBatch(value);
        continue;
      }
      if (isUint8Array(value)) {
        batch.push(value);
        if (batch.length === FROM_BATCH_SIZE) {
          yield batch;
          batch = [];
        }
        continue;
      }
      if (batch.length > 0) {
        yield batch;
        batch = [];
      }
      let asyncBatch = [];
      for await (const chunk of normalizeAsyncValue(value)) {
        asyncBatch.push(chunk);
        if (asyncBatch.length === FROM_BATCH_SIZE) {
          yield asyncBatch;
          asyncBatch = [];
        }
      }
      if (asyncBatch.length > 0) {
        yield asyncBatch;
      }
    }

    if (batch.length > 0) {
      yield batch;
    }
    return;
  }

  throw $ERR_INVALID_ARG_TYPE("source", ["Iterable", "AsyncIterable"], source);
}

// =============================================================================
// Public API: from() and fromSync()
// =============================================================================

/**
 * Create a SyncByteStreamReadable from a ByteInput or SyncStreamable.
 */
function fromSync(input) {
  if (input == null) {
    throw $ERR_INVALID_ARG_TYPE("input", "a non-null value", input);
  }

  if (isPrimitiveChunk(input)) {
    const chunk = primitiveToUint8Array(input);
    return {
      __proto__: null,
      *[SymbolIterator]() {
        yield [chunk];
      },
    };
  }

  if (ArrayIsArray(input)) {
    if (input.length === 0) {
      return {
        __proto__: null,
        *[SymbolIterator]() {
          // Empty - yield nothing
        },
      };
    }
    if (isUint8Array(input[0])) {
      const allUint8 = input.every(isUint8Array);
      if (allUint8) {
        const batch = input;
        return {
          __proto__: null,
          *[SymbolIterator]() {
            if (batch.length <= FROM_BATCH_SIZE) {
              yield batch;
            } else {
              for (let i = 0; i < batch.length; i += FROM_BATCH_SIZE) {
                yield batch.slice(i, i + FROM_BATCH_SIZE);
              }
            }
          },
        };
      }
    }
  }

  if (typeof input[toStreamable] === "function") {
    return fromSync(input[toStreamable]());
  }

  if (isAsyncIterable(input)) {
    throw $ERR_INVALID_ARG_TYPE("input", "a synchronous input (not AsyncIterable)", input);
  }
  if (typeof input === "object" && input !== null && typeof input.then === "function") {
    throw $ERR_INVALID_ARG_TYPE("input", "a synchronous input (not Promise)", input);
  }

  if (!isSyncIterable(input)) {
    throw $ERR_INVALID_ARG_TYPE(
      "input",
      ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "toStreamable"],
      input,
    );
  }

  return {
    __proto__: null,
    *[SymbolIterator]() {
      yield* normalizeSyncSource(input);
    },
  };
}

/**
 * Create a ByteStreamReadable from a ByteInput or Streamable.
 */
function from(input) {
  if (input == null) {
    throw $ERR_INVALID_ARG_TYPE("input", "a non-null value", input);
  }

  if (input[kValidatedSource]) {
    return input;
  }

  if (isPrimitiveChunk(input)) {
    const chunk = primitiveToUint8Array(input);
    return {
      __proto__: null,
      async *[SymbolAsyncIterator]() {
        yield [chunk];
      },
    };
  }

  if (ArrayIsArray(input)) {
    if (input.length === 0) {
      return {
        __proto__: null,
        async *[SymbolAsyncIterator]() {
          // Empty - yield nothing
        },
      };
    }
    if (isUint8Array(input[0])) {
      const allUint8 = input.every(isUint8Array);
      if (allUint8) {
        const batch = input;
        return {
          __proto__: null,
          async *[SymbolAsyncIterator]() {
            if (batch.length <= FROM_BATCH_SIZE) {
              yield batch;
            } else {
              for (let i = 0; i < batch.length; i += FROM_BATCH_SIZE) {
                yield batch.slice(i, i + FROM_BATCH_SIZE);
              }
            }
          },
        };
      }
    }
  }

  if (typeof input[toAsyncStreamable] === "function") {
    const result = input[toAsyncStreamable]();
    if (result?.[kValidatedSource]) {
      return result;
    }
    return {
      __proto__: null,
      async *[SymbolAsyncIterator]() {
        const resolved = await result;
        if (resolved?.[kValidatedSource]) {
          yield* resolved[SymbolAsyncIterator]();
          return;
        }
        yield* from(resolved)[SymbolAsyncIterator]();
      },
    };
  }

  if (typeof input[toStreamable] === "function") {
    return from(input[toStreamable]());
  }

  if (!isSyncIterable(input) && !isAsyncIterable(input)) {
    throw $ERR_INVALID_ARG_TYPE(
      "input",
      ["string", "ArrayBuffer", "ArrayBufferView", "Iterable", "AsyncIterable", "toStreamable", "toAsyncStreamable"],
      input,
    );
  }

  return normalizeAsyncSource(input);
}

export default {
  arrayBufferViewToUint8Array,
  from,
  fromSync,
  isAsyncIterable,
  isPrimitiveChunk,
  isSyncIterable,
  isUint8ArrayBatch,
  normalizeAsyncSource,
  normalizeAsyncValue,
  normalizeSyncSource,
  normalizeSyncValue,
  primitiveToUint8Array,
};
