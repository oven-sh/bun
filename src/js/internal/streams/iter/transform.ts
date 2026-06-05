// Port of Node.js lib/internal/streams/iter/transform.js
//
// Compression / Decompression transforms for the iterable streams API.
//
// DEVIATION FROM NODE: Node.js drives a bare native zlib handle
// (internalBinding('zlib')) incrementally. Bun does not expose that binding
// to builtins, so the async transforms drive the node:zlib Transform streams
// instead, yielding output as the engine produces it (bounded memory). Only
// the sync variants buffer and run the one-shot codec at flush time, since a
// synchronous incremental write needs the native handle. The observable
// protocol (stateful transform that consumes batches + null flush signal and
// yields Uint8Array output) is identical.

const zlib = require("node:zlib");
const { validateObject } = require("internal/validators");

const kNullPrototype = { __proto__: null };

/**
 * Create an async stateful transform that feeds input chunks through a
 * node:zlib Transform stream, yielding output incrementally.
 * @param createStream factory, e.g. options => zlib.createGzip(options)
 * @param finalizeOnEmpty whether to finalize when no input was received
 *   (true for compressors - an empty stream still has a valid header;
 *    false for decompressors - zero input means zero output, and finalizing
 *    an empty inflate stream would error with "unexpected end of file").
 */
function makeStreamingTransformAsync(createStream, finalizeOnEmpty) {
  return {
    __proto__: null,
    transform: async function* (source, options) {
      const signal = options?.signal;
      signal?.throwIfAborted();

      const stream = createStream();
      const pending: Uint8Array[] = [];
      let streamError: Error | null = null;
      let streamEnded = false;
      let wake: (() => void) | null = null;
      const notify = () => {
        if (wake !== null) {
          const w = wake;
          wake = null;
          w();
        }
      };
      stream.on("data", chunk => {
        pending.push(chunk);
        notify();
      });
      stream.on("error", err => {
        streamError = err;
        notify();
      });
      stream.on("end", () => {
        streamEnded = true;
        notify();
      });

      // write() resolves once the engine consumed the chunk - that is the
      // backpressure point; output produced so far is drained between writes.
      const writeChunk = chunk =>
        new Promise<void>((resolve, reject) => {
          stream.write(chunk, err => (err ? reject(err) : resolve()));
        });

      let finalized = false;
      let wroteAny = false;

      function* drainPending() {
        if (streamError !== null) throw streamError;
        while (pending.length > 0) {
          yield pending.shift()!;
        }
      }

      async function* finalize() {
        finalized = true;
        if (!wroteAny && !finalizeOnEmpty) {
          return;
        }
        stream.end();
        while (!streamEnded && streamError === null) {
          yield* drainPending();
          if (streamEnded || streamError !== null) break;
          await new Promise<void>(resolve => {
            wake = resolve;
          });
        }
        yield* drainPending();
        if (streamError !== null) throw streamError;
      }

      try {
        for await (const batch of source) {
          signal?.throwIfAborted();

          if (batch === null) {
            if (!finalized) {
              yield* finalize();
            }
            continue;
          }
          if (finalized) {
            // Input after the flush signal is dropped - the engine is done.
            continue;
          }

          for (let i = 0; i < batch.length; i++) {
            wroteAny = true;
            await writeChunk(batch[i]);
            signal?.throwIfAborted();
            yield* drainPending();
          }
        }

        // Source ended without a null flush signal.
        if (!finalized && !signal?.aborted) {
          yield* finalize();
        }
      } finally {
        stream.destroy();
      }
    },
  };
}

/**
 * Sync transform: buffers all input and yields processFn(Buffer) once the
 * null flush signal (or end of source) is reached.
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
  return makeStreamingTransformAsync(() => zlib.createGzip(options), true);
}

function compressDeflate(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformAsync(() => zlib.createDeflate(options), true);
}

function compressBrotli(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformAsync(() => zlib.createBrotliCompress(options), true);
}

// ---------------------------------------------------------------------------
// Async decompression factories
// ---------------------------------------------------------------------------

function decompressGzip(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformAsync(() => zlib.createGunzip(options), false);
}

function decompressDeflate(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformAsync(() => zlib.createInflate(options), false);
}

function decompressBrotli(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformAsync(() => zlib.createBrotliDecompress(options), false);
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
