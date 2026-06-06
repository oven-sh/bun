// Port of Node.js lib/internal/streams/iter/transform.js
//
// Compression / Decompression transforms for the iterable streams API.
//
// DEVIATION FROM NODE: Node.js creates bare native handles via
// internalBinding('zlib'). Bun reaches the same native handle through the
// node:zlib stream constructors instead (they validate options and init the
// handle): the async transforms drive the Transform stream incrementally
// with backpressure, and the sync transforms drive the underlying handle's
// writeSync() chunk-by-chunk like node's makeZlibTransformSync. Both yield
// output as the engine produces it, so memory stays bounded. The observable
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
      let pending: Uint8Array[] = [];
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
        // Swap-and-iterate instead of shift() (O(N) total, not O(N^2));
        // the outer loop picks up chunks pushed by "data" events that fire
        // while a yield is suspended.
        while (pending.length > 0) {
          const batch = pending;
          pending = [];
          for (let i = 0; i < batch.length; i++) {
            yield batch[i];
          }
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

const kEmptyBuffer = Buffer.alloc(0);
const UintSlice = Uint8Array.prototype.slice;

/**
 * Sync counterpart of makeStreamingTransformAsync: drives the bare native
 * handle behind a node:zlib stream object with handle.writeSync(), exactly
 * like node's makeZlibTransformSync (lib/internal/streams/iter/transform.js)
 * drives internalBinding('zlib'). The stream object is only used for its
 * validated, initialized handle (_handle/_writeState/_chunkSize and the
 * codec's process/finish flush flags); none of the Transform machinery runs.
 * Output is yielded as the engine produces it, so memory stays bounded.
 */
function makeStreamingTransformSync(createStream, finalizeOnEmpty) {
  return {
    __proto__: null,
    transform: function* (source) {
      const stream = createStream();
      const handle = stream._handle;
      const writeState = stream._writeState;
      const chunkSize = stream._chunkSize;
      const processFlag = stream._defaultFlushFlag;
      const finishFlag = stream._finishFlushFlag;

      // writeSync reports failures synchronously through onerror; capture and
      // rethrow instead of routing through the stream's error machinery.
      let error: any = null;
      handle.onerror = (message, errno, code) => {
        error = new Error(message);
        error.errno = errno;
        error.code = code;
      };

      let outBuf = Buffer.allocUnsafe(chunkSize);
      let outOffset = 0;
      let pending: Uint8Array[] = [];

      function processSyncInput(input, flushFlag) {
        let inOff = 0;
        let availIn = input.byteLength;
        let availOutBefore = chunkSize - outOffset;

        handle.writeSync(flushFlag, input, inOff, availIn, outBuf, outOffset, availOutBefore);
        if (error) throw error;

        while (true) {
          const availOut = writeState[0];
          const availInAfter = writeState[1];
          const have = availOutBefore - availOut;
          const bufferExhausted = availOut === 0 || outOffset + have >= chunkSize;

          if (have > 0) {
            if (bufferExhausted && outOffset === 0) {
              // Entire buffer filled - hand it off, no copy.
              pending.push(outBuf);
            } else if (bufferExhausted) {
              // Tail filled, buffer being replaced - subarray is safe.
              pending.push(outBuf.subarray(outOffset, outOffset + have));
            } else {
              // Partial fill, buffer reused - must copy.
              pending.push(UintSlice.$call(outBuf, outOffset, outOffset + have));
            }
            outOffset += have;
          }

          if (bufferExhausted) {
            outBuf = Buffer.allocUnsafe(chunkSize);
            outOffset = 0;
          }

          if (availOut === 0) {
            // Engine has more output - loop.
            const consumed = availIn - availInAfter;
            inOff += consumed;
            availIn = availInAfter;
            availOutBefore = chunkSize - outOffset;

            handle.writeSync(flushFlag, input, inOff, availIn, outBuf, outOffset, availOutBefore);
            if (error) throw error;
            continue;
          }

          // All input consumed.
          break;
        }
      }

      let finalized = false;
      let wroteAny = false;

      function* drainPending() {
        // Swap-and-iterate instead of shift() (O(N) total, not O(N^2)).
        while (pending.length > 0) {
          const batch = pending;
          pending = [];
          for (let i = 0; i < batch.length; i++) {
            yield batch[i];
          }
        }
      }

      function* finalize() {
        finalized = true;
        // Decompressors with zero input yield zero output; finalizing an
        // empty inflate stream would error with "unexpected end of file".
        if (wroteAny || finalizeOnEmpty) {
          processSyncInput(kEmptyBuffer, finishFlag);
        }
        yield* drainPending();
      }

      try {
        for (const batch of source) {
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
            processSyncInput(batch[i], processFlag);
            yield* drainPending();
          }
        }

        // Source ended without a null flush signal.
        if (!finalized) {
          yield* finalize();
        }
      } finally {
        stream.close();
      }
    },
  };
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
  return makeStreamingTransformSync(() => zlib.createGzip(options), true);
}

function compressDeflateSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformSync(() => zlib.createDeflate(options), true);
}

function compressBrotliSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformSync(() => zlib.createBrotliCompress(options), true);
}

// ---------------------------------------------------------------------------
// Sync decompression factories
// ---------------------------------------------------------------------------

function decompressGzipSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformSync(() => zlib.createGunzip(options), false);
}

function decompressDeflateSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformSync(() => zlib.createInflate(options), false);
}

function decompressBrotliSync(options = kNullPrototype) {
  validateObject(options, "options");
  return makeStreamingTransformSync(() => zlib.createBrotliDecompress(options), false);
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
