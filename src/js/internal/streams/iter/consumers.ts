// Port of Node.js lib/internal/streams/iter/consumers.js
//
// bytes(), text(), arrayBuffer(), array() - collect entire stream
// tap(), tapSync() - observe without modifying
// ondrain() - backpressure drain utility
// (merge() is not ported.)


const { validateAbortSignal, validateFunction, validateInteger, validateObject } = require("internal/validators");

const { from, fromSync } = require("internal/streams/iter/from");

const { concatBytes } = require("internal/streams/iter/utils");

const { drainableProtocol } = require("internal/streams/iter/types");

// =============================================================================
// Shared chunk collection helpers
// =============================================================================

/**
 * Collect chunks from a sync source into an array.
 */
function collectSync(source, limit) {
  const normalized = fromSync(source);
  const chunks = [];
  let totalBytes = 0;

  for (const batch of normalized) {
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      if (limit !== undefined) {
        totalBytes += chunk.byteLength;
        if (totalBytes > limit) {
          throw $ERR_OUT_OF_RANGE("totalBytes", `<= ${limit}`, totalBytes);
        }
      }
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Collect chunks from an async or sync source into an array.
 */
async function collectAsync(source, signal, limit) {
  signal?.throwIfAborted();

  const normalized = from(source);
  const chunks = [];

  // Fast path: no signal and no limit
  if (!signal && limit === undefined) {
    for await (const batch of normalized) {
      for (let i = 0; i < batch.length; i++) {
        chunks.push(batch[i]);
      }
    }
    return chunks;
  }

  let totalBytes = 0;

  for await (const batch of normalized) {
    signal?.throwIfAborted();
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      if (limit !== undefined) {
        totalBytes += chunk.byteLength;
        if (totalBytes > limit) {
          throw $ERR_OUT_OF_RANGE("totalBytes", `<= ${limit}`, totalBytes);
        }
      }
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Convert a Uint8Array to its backing ArrayBuffer, slicing if necessary.
 */
function toArrayBuffer(data) {
  const byteOffset = data.byteOffset;
  const byteLength = data.byteLength;
  const buffer = data.buffer;
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

// =============================================================================
// Shared option validation
// =============================================================================

function validateBaseConsumerOptions(options) {
  validateObject(options, "options");
  if (options.limit !== undefined) {
    validateInteger(options.limit, "options.limit", 0);
  }
  if (options.encoding !== undefined) {
    if (typeof options.encoding !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.encoding", "string", options.encoding);
    }
    try {
      new TextDecoder(options.encoding);
    } catch {
      throw $ERR_INVALID_ARG_VALUE("options.encoding", options.encoding);
    }
  }
}

function validateConsumerOptions(options) {
  validateBaseConsumerOptions(options);
  if (options.signal !== undefined) {
    validateAbortSignal(options.signal, "options.signal");
  }
}

function validateSyncConsumerOptions(options) {
  validateBaseConsumerOptions(options);
}

// =============================================================================
// Sync Consumers
// =============================================================================

const kNullPrototype = { __proto__: null };

/**
 * Collect all bytes from a sync source.
 */
function bytesSync(source, options = kNullPrototype) {
  validateSyncConsumerOptions(options);
  return concatBytes(collectSync(source, options.limit));
}

/**
 * Collect and decode text from a sync source.
 */
function textSync(source, options = kNullPrototype) {
  validateSyncConsumerOptions(options);
  const data = concatBytes(collectSync(source, options.limit));
  const decoder = new TextDecoder(options.encoding ?? "utf-8", {
    fatal: true,
  });
  return decoder.decode(data);
}

/**
 * Collect bytes as ArrayBuffer from a sync source.
 */
function arrayBufferSync(source, options = kNullPrototype) {
  validateSyncConsumerOptions(options);
  return toArrayBuffer(concatBytes(collectSync(source, options.limit)));
}

/**
 * Collect all chunks as an array from a sync source.
 */
function arraySync(source, options = kNullPrototype) {
  validateSyncConsumerOptions(options);
  return collectSync(source, options.limit);
}

// =============================================================================
// Async Consumers
// =============================================================================

/**
 * Collect all bytes from an async or sync source.
 */
async function bytes(source, options = kNullPrototype) {
  validateConsumerOptions(options);
  const chunks = await collectAsync(source, options.signal, options.limit);
  return concatBytes(chunks);
}

/**
 * Collect and decode text from an async or sync source.
 */
async function text(source, options = kNullPrototype) {
  validateConsumerOptions(options);
  const chunks = await collectAsync(source, options.signal, options.limit);
  const data = concatBytes(chunks);
  const decoder = new TextDecoder(options.encoding ?? "utf-8", {
    fatal: true,
  });
  return decoder.decode(data);
}

/**
 * Collect bytes as ArrayBuffer from an async or sync source.
 */
async function arrayBuffer(source, options = kNullPrototype) {
  validateConsumerOptions(options);
  const chunks = await collectAsync(source, options.signal, options.limit);
  return toArrayBuffer(concatBytes(chunks));
}

/**
 * Collect all chunks as an array from an async or sync source.
 */
async function array(source, options = kNullPrototype) {
  validateConsumerOptions(options);
  return collectAsync(source, options.signal, options.limit);
}

// =============================================================================
// Tap Utilities
// =============================================================================

/**
 * Create a pass-through transform that observes chunks without modifying them.
 */
function tap(callback) {
  validateFunction(callback, "callback");
  return async (chunks, options) => {
    await callback(chunks, options);
    return chunks;
  };
}

/**
 * Create a sync pass-through transform that observes chunks.
 */
function tapSync(callback) {
  validateFunction(callback, "callback");
  return chunks => {
    callback(chunks);
    return chunks;
  };
}

// =============================================================================
// Drain Utility
// =============================================================================

/**
 * Wait for a drainable object's backpressure to clear.
 */
function ondrain(drainable) {
  if (drainable === null || drainable === undefined || typeof drainable !== "object") {
    return null;
  }

  if (!(drainableProtocol in drainable) || typeof drainable[drainableProtocol] !== "function") {
    return null;
  }

  return drainable[drainableProtocol]();
}

export default {
  array,
  arrayBuffer,
  arrayBufferSync,
  arraySync,
  bytes,
  bytesSync,
  ondrain,
  tap,
  tapSync,
  text,
  textSync,
};
