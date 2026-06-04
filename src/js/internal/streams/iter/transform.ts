// Port of Node.js lib/internal/streams/iter/transform.js
//
// Compression / Decompression transforms for the iterable streams API.
//
// DEVIATION FROM NODE: Node.js drives a bare native zlib handle
// (internalBinding('zlib')) incrementally, yielding output as the engine
// produces it. Bun does not expose that binding to builtins, so these
// transforms buffer their input and run the one-shot node:zlib codec at
// flush time. The observable protocol (stateful transform that consumes
// batches + null flush signal and yields Uint8Array output) is identical.

const zlib = require("node:zlib");
const { validateObject } = require("internal/validators");

const kNullPrototype = { __proto__: null };

/**
 * Create an async stateful transform that buffers all input and yields the
 * result of processFn(Buffer) once the null flush signal is received.
 * @param processFn one-shot codec, e.g. zlib.gzipSync
 * @param emitOnEmpty whether to run processFn when no input was received
 *   (true for compressors - an empty stream still has a valid header;
 *    false for decompressors - zero input means zero output).
 */
function makeBufferedTransformAsync(processFn, emitOnEmpty) {
  return {
    __proto__: null,
    transform: async function* (source, options) {
      const signal = options?.signal;
      signal?.throwIfAborted();

      const chunks: Uint8Array[] = [];
      let finalized = false;

      for await (const batch of source) {
        signal?.throwIfAborted();

        if (batch === null) {
          if (!finalized) {
            finalized = true;
            if (chunks.length > 0 || emitOnEmpty) {
              yield processFn(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
              chunks.length = 0;
            }
          }
          continue;
        }

        for (let i = 0; i < batch.length; i++) {
          chunks.push(batch[i]);
        }
      }

      // Source ended without a null flush signal.
      if (!finalized && !signal?.aborted) {
        if (chunks.length > 0 || emitOnEmpty) {
          yield processFn(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
        }
      }
    },
  };
}

/**
 * Sync counterpart of makeBufferedTransformAsync.
 */
function makeBufferedTransformSync(processFn, emitOnEmpty) {
  return {
    __proto__: null,
    transform: function* (source) {
      const chunks: Uint8Array[] = [];
      let finalized = false;

      for (const batch of source) {
        if (batch === null) {
          if (!finalized) {
            finalized = true;
            if (chunks.length > 0 || emitOnEmpty) {
              yield processFn(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
              chunks.length = 0;
            }
          }
          continue;
        }

        for (let i = 0; i < batch.length; i++) {
          chunks.push(batch[i]);
        }
      }

      if (!finalized) {
        if (chunks.length > 0 || emitOnEmpty) {
          yield processFn(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
        }
      }
    },
  };
}

function makeCodecFn(method, options) {
  if (options === kNullPrototype) {
    return input => method(input);
  }
  return input => method(input, options);
}

// ---------------------------------------------------------------------------
// Async compression factories
// ---------------------------------------------------------------------------

function compressGzip(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformAsync(makeCodecFn(zlib.gzipSync, options), true);
}

function compressDeflate(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformAsync(makeCodecFn(zlib.deflateSync, options), true);
}

function compressBrotli(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformAsync(makeCodecFn(zlib.brotliCompressSync, options), true);
}

// ---------------------------------------------------------------------------
// Async decompression factories
// ---------------------------------------------------------------------------

function decompressGzip(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformAsync(makeCodecFn(zlib.gunzipSync, options), false);
}

function decompressDeflate(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformAsync(makeCodecFn(zlib.inflateSync, options), false);
}

function decompressBrotli(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformAsync(makeCodecFn(zlib.brotliDecompressSync, options), false);
}

// ---------------------------------------------------------------------------
// Sync compression factories
// ---------------------------------------------------------------------------

function compressGzipSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformSync(makeCodecFn(zlib.gzipSync, options), true);
}

function compressDeflateSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformSync(makeCodecFn(zlib.deflateSync, options), true);
}

function compressBrotliSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformSync(makeCodecFn(zlib.brotliCompressSync, options), true);
}

// ---------------------------------------------------------------------------
// Sync decompression factories
// ---------------------------------------------------------------------------

function decompressGzipSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformSync(makeCodecFn(zlib.gunzipSync, options), false);
}

function decompressDeflateSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformSync(makeCodecFn(zlib.inflateSync, options), false);
}

function decompressBrotliSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeBufferedTransformSync(makeCodecFn(zlib.brotliDecompressSync, options), false);
}

export default {
  compressBrotli,
  compressBrotliSync,
  compressDeflate,
  compressDeflateSync,
  compressGzip,
  compressGzipSync,
  decompressBrotli,
  decompressBrotliSync,
  decompressDeflate,
  decompressDeflateSync,
  decompressGzip,
  decompressGzipSync,
};
