// Port of Node.js lib/internal/streams/iter/pull.js
//
// pull(), pullSync(), pipeTo(), pipeToSync()
// Pull-through pipelines with transforms. Data flows on-demand from source
// through transforms to consumer.

const { isAnyArrayBuffer, isPromise, isUint8Array } = require("node:util/types");
const { validateAbortSignal } = require("internal/validators");

const {
  arrayBufferViewToUint8Array,
  from,
  fromSync,
  isSyncIterable,
  isAsyncIterable,
  isPrimitiveChunk,
  isUint8ArrayBatch,
  normalizeAsyncValue,
} = require("internal/streams/iter/from");

const {
  isPullOptions,
  isTransform,
  isTransformObject,
  parsePullArgs,
  toUint8Array,
  wrapError,
} = require("internal/streams/iter/utils");

const {
  drainableProtocol,
  kSyncWriteAcceptedOnFalse,
  kValidatedSource,
  kValidatedTransform,
  toAsyncStreamable,
  toStreamable,
} = require("internal/streams/iter/types");

const SymbolIterator = Symbol.iterator;
const SymbolAsyncIterator = Symbol.asyncIterator;
const ArrayIsArray = Array.isArray;
const ArrayBufferIsView = ArrayBuffer.isView;

function makeAbortError() {
  return new DOMException("Aborted", "AbortError");
}

// =============================================================================
// Type Guards and Helpers
// =============================================================================

function hasMethod(value, name) {
  return typeof value?.[name] === "function";
}

/**
 * Parse pipeTo/pipeToSync arguments: [...transforms, writer, options?]
 */
function parsePipeToArgs(args, requiredMethod) {
  let options;
  let writerIndex = args.length - 1;

  const last = args[args.length - 1];
  if (isPullOptions(last) && !hasMethod(last, requiredMethod)) {
    options = last;
    writerIndex = args.length - 2;
  }

  if (writerIndex < 0) {
    throw $ERR_INVALID_ARG_VALUE("args", args, "pipeTo requires a writer argument");
  }

  const writer = args[writerIndex];
  if (!hasMethod(writer, requiredMethod)) {
    throw $ERR_INVALID_ARG_TYPE("writer", `object with a ${requiredMethod} method`, writer);
  }

  const transforms = args.slice(0, writerIndex);
  for (let i = 0; i < transforms.length; i++) {
    if (!isTransform(transforms[i])) {
      throw $ERR_INVALID_ARG_TYPE(`transforms[${i}]`, ["Function", "Object with transform()"], transforms[i]);
    }
  }

  return {
    __proto__: null,
    transforms,
    writer,
    options,
  };
}

function canUseSyncIterablePipeToFastPath(source, transforms, signal) {
  if (
    signal !== undefined ||
    transforms.length !== 0 ||
    isPrimitiveChunk(source) ||
    ArrayIsArray(source) ||
    source?.[kValidatedSource] ||
    !isSyncIterable(source) ||
    isAsyncIterable(source)
  ) {
    return false;
  }

  return typeof source[toAsyncStreamable] !== "function" && typeof source[toStreamable] !== "function";
}

// =============================================================================
// Transform Output Flattening
// =============================================================================

/**
 * Flatten transform yield to Uint8Array chunks (sync).
 */
function* flattenTransformYieldSync(value) {
  if (isUint8Array(value)) {
    yield value;
    return;
  }
  if (typeof value === "string") {
    yield toUint8Array(value);
    return;
  }
  if (isAnyArrayBuffer(value)) {
    yield new Uint8Array(value);
    return;
  }
  if (ArrayBufferIsView(value)) {
    yield arrayBufferViewToUint8Array(value);
    return;
  }
  if (isSyncIterable(value)) {
    for (const item of value) {
      yield* flattenTransformYieldSync(item);
    }
    return;
  }
  throw $ERR_INVALID_ARG_TYPE("value", ["Uint8Array", "string", "ArrayBuffer", "ArrayBufferView", "Iterable"], value);
}

/**
 * Flatten transform yield to Uint8Array chunks (async).
 */
async function* flattenTransformYieldAsync(value) {
  if (isUint8Array(value)) {
    yield value;
    return;
  }
  if (typeof value === "string") {
    yield toUint8Array(value);
    return;
  }
  if (isAnyArrayBuffer(value)) {
    yield new Uint8Array(value);
    return;
  }
  if (ArrayBufferIsView(value)) {
    yield arrayBufferViewToUint8Array(value);
    return;
  }
  if (isAsyncIterable(value)) {
    for await (const item of value) {
      yield* flattenTransformYieldAsync(item);
    }
    return;
  }
  if (isSyncIterable(value)) {
    for (const item of value) {
      yield* flattenTransformYieldSync(item);
    }
    return;
  }
  throw $ERR_INVALID_ARG_TYPE(
    "value",
    ["Uint8Array", "string", "ArrayBuffer", "ArrayBufferView", "Iterable", "AsyncIterable"],
    value,
  );
}

/**
 * Process transform result (sync).
 */
function* processTransformResultSync(result) {
  if (result === null) {
    return;
  }
  if (isUint8Array(result)) {
    yield [result];
    return;
  }
  if (typeof result === "string") {
    yield [toUint8Array(result)];
    return;
  }
  if (isAnyArrayBuffer(result)) {
    yield [new Uint8Array(result)];
    return;
  }
  if (ArrayBufferIsView(result)) {
    yield [arrayBufferViewToUint8Array(result)];
    return;
  }
  if (isUint8ArrayBatch(result)) {
    if (result.length > 0) {
      yield result;
    }
    return;
  }
  if (isSyncIterable(result)) {
    const batch = [];
    for (const item of result) {
      for (const chunk of flattenTransformYieldSync(item)) {
        batch.push(chunk);
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
    return;
  }
  throw $ERR_INVALID_ARG_TYPE(
    "result",
    ["null", "Uint8Array", "string", "ArrayBuffer", "ArrayBufferView", "Array", "Iterable"],
    result,
  );
}

/**
 * Append normalized transform result batches to an array (sync).
 */
function appendTransformResultSync(target, result) {
  for (const batch of processTransformResultSync(result)) {
    target.push(batch);
  }
}

/**
 * Process transform result (async).
 */
async function* processTransformResultAsync(result) {
  if (isPromise(result)) {
    const resolved = await result;
    yield* processTransformResultAsync(resolved);
    return;
  }
  if (result === null) {
    return;
  }
  if (isUint8Array(result)) {
    yield [result];
    return;
  }
  if (typeof result === "string") {
    yield [toUint8Array(result)];
    return;
  }
  if (isAnyArrayBuffer(result)) {
    yield [new Uint8Array(result)];
    return;
  }
  if (ArrayBufferIsView(result)) {
    yield [arrayBufferViewToUint8Array(result)];
    return;
  }
  if (isUint8ArrayBatch(result)) {
    if (result.length > 0) {
      yield result;
    }
    return;
  }
  if (isAsyncIterable(result)) {
    const batch = [];
    for await (const item of result) {
      if (isUint8Array(item)) {
        batch.push(item);
        continue;
      }
      for await (const chunk of flattenTransformYieldAsync(item)) {
        batch.push(chunk);
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
    return;
  }
  if (isSyncIterable(result)) {
    const batch = [];
    for (const item of result) {
      if (isUint8Array(item)) {
        batch.push(item);
        continue;
      }
      for (const chunk of flattenTransformYieldSync(item)) {
        batch.push(chunk);
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
    return;
  }
  throw $ERR_INVALID_ARG_TYPE(
    "result",
    ["null", "Uint8Array", "string", "ArrayBuffer", "ArrayBufferView", "Array", "Iterable", "AsyncIterable", "Promise"],
    result,
  );
}

/**
 * Append normalized transform result batches to an array (async).
 */
async function appendTransformResultAsync(target, result) {
  for await (const batch of processTransformResultAsync(result)) {
    target.push(batch);
  }
}

// =============================================================================
// Sync Pipeline Implementation
// =============================================================================

/**
 * Apply a fused run of stateless sync transforms.
 */
function* applyFusedStatelessSyncTransforms(source, run) {
  for (const chunks of source) {
    let current = chunks;
    for (let i = 0; i < run.length; i++) {
      const result = run[i](current);
      if (result === null) {
        current = null;
        break;
      }
      current = result;
    }
    if (current === null) continue;
    if (isUint8ArrayBatch(current)) {
      if (current.length > 0) yield current;
    } else if (isUint8Array(current)) {
      yield [current];
    } else if (typeof current === "string") {
      yield [toUint8Array(current)];
    } else if (isAnyArrayBuffer(current)) {
      yield [new Uint8Array(current)];
    } else if (ArrayBufferIsView(current)) {
      yield [arrayBufferViewToUint8Array(current)];
    } else {
      yield* processTransformResultSync(current);
    }
  }
  // Flush each transform after all upstream data has been processed.
  let pending = [];
  for (let i = 0; i < run.length; i++) {
    const next = [];
    for (let j = 0; j < pending.length; j++) {
      appendTransformResultSync(next, run[i](pending[j]));
    }
    appendTransformResultSync(next, run[i](null));
    pending = next;
  }
  for (let i = 0; i < pending.length; i++) {
    yield pending[i];
  }
}

/**
 * Append a null flush signal after the source is exhausted (sync).
 */
function* withFlushSync(source) {
  yield* source;
  yield null;
}

function* applyStatefulSyncTransform(source, transform) {
  const output = transform(withFlushSync(source));
  for (const item of output) {
    const batch = [];
    for (const chunk of flattenTransformYieldSync(item)) {
      batch.push(chunk);
    }
    if (batch.length > 0) {
      yield batch;
    }
  }
}

/**
 * Create a sync pipeline from source through transforms.
 */
function* createSyncPipeline(source, transforms) {
  let current = source;

  let statelessRun = [];

  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (isTransformObject(transform)) {
      if (statelessRun.length > 0) {
        current = applyFusedStatelessSyncTransforms(current, statelessRun);
        statelessRun = [];
      }
      current = applyStatefulSyncTransform(current, transform.transform);
    } else {
      statelessRun.push(transform);
    }
  }
  if (statelessRun.length > 0) {
    current = applyFusedStatelessSyncTransforms(current, statelessRun);
  }

  yield* current;
}

// =============================================================================
// Async Pipeline Implementation
// =============================================================================

/**
 * Apply a fused run of stateless async transforms to a source.
 *
 * INVARIANT: This function accepts a signal, NOT a pre-built options object.
 * A fresh { __proto__: null, signal } options object is created for each
 * transform invocation to prevent cross-transform mutation.
 */
async function* applyFusedStatelessAsyncTransforms(source, run, signal) {
  for await (const chunks of source) {
    let current = chunks;
    for (let i = 0; i < run.length; i++) {
      const result = run[i](current, { __proto__: null, signal });
      if (result === null) {
        current = null;
        break;
      }
      if (isPromise(result)) {
        const resolved = await result;
        if (resolved === null) {
          current = null;
          break;
        }
        current = resolved;
      } else {
        current = result;
      }
    }
    if (current === null) continue;
    if (isUint8ArrayBatch(current)) {
      if (current.length > 0) yield current;
    } else if (isUint8Array(current)) {
      yield [current];
    } else if (typeof current === "string") {
      yield [toUint8Array(current)];
    } else if (isAnyArrayBuffer(current)) {
      yield [new Uint8Array(current)];
    } else if (ArrayBufferIsView(current)) {
      yield [arrayBufferViewToUint8Array(current)];
    } else {
      yield* processTransformResultAsync(current);
    }
  }
  // Flush each transform after all upstream data has been processed.
  let pending = [];
  for (let i = 0; i < run.length; i++) {
    const next = [];
    for (let j = 0; j < pending.length; j++) {
      await appendTransformResultAsync(next, run[i](pending[j], { __proto__: null, signal }));
    }
    await appendTransformResultAsync(next, run[i](null, { __proto__: null, signal }));
    pending = next;
  }
  for (let i = 0; i < pending.length; i++) {
    yield pending[i];
  }
}

/**
 * Append a null flush signal after the source is exhausted (async).
 */
async function* withFlushAsync(source) {
  yield* source;
  yield null;
}

async function* applyStatefulAsyncTransform(source, transform, options) {
  const output = transform(withFlushAsync(source), options);
  for await (const item of output) {
    if (isUint8ArrayBatch(item)) {
      if (item.length > 0) {
        yield item;
      }
      continue;
    }
    if (isUint8Array(item)) {
      yield [item];
      continue;
    }
    const batch = [];
    for await (const chunk of flattenTransformYieldAsync(item)) {
      batch.push(chunk);
    }
    if (batch.length > 0) {
      yield batch;
    }
  }
}

/**
 * Fast path for validated stateful transforms (e.g. compression).
 */
async function* applyValidatedStatefulAsyncTransform(source, transform, options) {
  const output = transform(source, options);
  for await (const batch of output) {
    if (batch.length > 0) {
      yield batch;
    }
  }
  options.signal?.throwIfAborted();
}

/**
 * Create an async pipeline from source through transforms.
 */
async function* createAsyncPipeline(source, transforms, signal) {
  signal?.throwIfAborted();

  const normalized = source;

  if (transforms.length === 0) {
    for await (const batch of normalized) {
      signal?.throwIfAborted();
      yield batch;
    }
    return;
  }

  const controller = new AbortController();
  let abortHandler;
  if (signal) {
    abortHandler = () => {
      controller.abort(signal.reason ?? makeAbortError());
    };
    signal.addEventListener("abort", abortHandler, {
      __proto__: null,
      once: true,
    });
  }

  let current = normalized;
  const transformSignal = controller.signal;
  let statelessRun = [];

  for (let i = 0; i < transforms.length; i++) {
    const transform = transforms[i];
    if (isTransformObject(transform)) {
      if (statelessRun.length > 0) {
        current = applyFusedStatelessAsyncTransforms(current, statelessRun, transformSignal);
        statelessRun = [];
      }
      const opts = { __proto__: null, signal: transformSignal };
      if (transform[kValidatedTransform]) {
        current = applyValidatedStatefulAsyncTransform(current, transform.transform, opts);
      } else {
        current = applyStatefulAsyncTransform(current, transform.transform, opts);
      }
    } else {
      statelessRun.push(transform);
    }
  }
  if (statelessRun.length > 0) {
    current = applyFusedStatelessAsyncTransforms(current, statelessRun, transformSignal);
  }

  let completed = false;
  try {
    for await (const batch of current) {
      controller.signal.throwIfAborted();
      yield batch;
    }
    completed = true;
  } catch (error) {
    if (!controller.signal.aborted) {
      controller.abort(wrapError(error));
    }
    throw error;
  } finally {
    if (!completed && !controller.signal.aborted) {
      controller.abort(makeAbortError());
    }
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

// =============================================================================
// Public API: pull() and pullSync()
// =============================================================================

/**
 * Create a sync pull-through pipeline with transforms.
 */
function pullSync(source, ...transforms) {
  for (let i = 0; i < transforms.length; i++) {
    if (!isTransform(transforms[i])) {
      throw $ERR_INVALID_ARG_TYPE(`transforms[${i}]`, ["Function", "Object with transform()"], transforms[i]);
    }
  }
  return {
    __proto__: null,
    *[SymbolIterator]() {
      yield* createSyncPipeline(fromSync(source), transforms);
    },
  };
}

/**
 * Create an async pull-through pipeline with transforms.
 */
function pull(source, ...args) {
  const { transforms, options } = parsePullArgs(args);
  const signal = options?.signal;
  if (signal !== undefined) {
    validateAbortSignal(signal, "options.signal");
    if (signal.aborted) {
      // Not a generator: it would never yield (it only throws), so build the
      // single-shot rejecting iterator explicitly.
      return {
        __proto__: null,
        [SymbolAsyncIterator]() {
          let done = false;
          return {
            __proto__: null,
            async next() {
              if (done) return { value: undefined, done: true };
              done = true;
              throw signal.reason;
            },
            async return() {
              done = true;
              return { value: undefined, done: true };
            },
          };
        },
      };
    }
  }

  return {
    __proto__: null,
    async *[SymbolAsyncIterator]() {
      yield* createAsyncPipeline(from(source), transforms, signal);
    },
  };
}

// =============================================================================
// Public API: pipeTo() and pipeToSync()
// =============================================================================

/**
 * Write a sync source through transforms to a sync writer.
 */
function pipeToSync(source, ...args) {
  const { transforms, writer, options } = parsePipeToArgs(args, "writeSync");

  if (isTransformObject(writer)) {
    transforms.push(writer);
  }

  const normalized = fromSync(source);
  const pipeline = transforms.length > 0 ? createSyncPipeline(normalized, transforms) : normalized;

  let totalBytes = 0;
  const hasWritevSync = typeof writer.writevSync === "function";
  const hasEndSync = typeof writer.endSync === "function";

  try {
    for (const batch of pipeline) {
      // writeSync/writevSync return false when the writer refuses to write
      // synchronously (chunk over options.chunkSize, limit exceeded, or a
      // failed first write). The async pipeTo falls back to write() in that
      // case; a sync pipe has no such fallback, so a refusal must not be
      // silently counted as written.
      let wrotev = false;
      if (hasWritevSync && batch.length > 1) {
        wrotev = writer.writevSync(batch) !== false;
        if (wrotev) {
          for (let i = 0; i < batch.length; i++) {
            totalBytes += batch[i].byteLength;
          }
        }
        // else: the batch total may exceed the sync threshold even when each
        // chunk fits - fall through to per-chunk writes.
      }
      if (!wrotev) {
        for (let i = 0; i < batch.length; i++) {
          const chunk = batch[i];
          if (writer.writeSync(chunk) === false) {
            // The refusal may be due to chunk size, an exhausted limit, or a
            // failed first write - the writer doesn't say which, so keep the
            // message generic.
            throw $ERR_OPERATION_FAILED("Operation failed: the writer did not accept the chunk synchronously");
          }
          totalBytes += chunk.byteLength;
        }
      }
    }

    if (!options?.preventClose) {
      if (!hasEndSync || writer.endSync() < 0) {
        writer.end?.();
      }
    }
  } catch (error) {
    if (!options?.preventFail) {
      writer.fail?.(wrapError(error));
    }
    throw error;
  }

  return totalBytes;
}

/**
 * Write an async source through transforms to a writer.
 */
async function pipeTo(source, ...args) {
  const { transforms, writer, options } = parsePipeToArgs(args, "write");
  if (options?.signal !== undefined) {
    validateAbortSignal(options.signal, "options.signal");
  }

  if (isTransformObject(writer)) {
    transforms.push(writer);
  }

  const signal = options?.signal;

  signal?.throwIfAborted();

  const hasWriteSync = typeof writer.writeSync === "function";
  const useSyncIterableFastPath = hasWriteSync && canUseSyncIterablePipeToFastPath(source, transforms, signal);
  const normalized = useSyncIterableFastPath ? undefined : from(source);

  let totalBytes = 0;
  const hasWritev = typeof writer.writev === "function";
  const hasWritevSync = typeof writer.writevSync === "function";
  const hasEndSync = typeof writer.endSync === "function";
  const syncFalseCanBeAccepted = writer[kSyncWriteAcceptedOnFalse] === true;

  function syncFalseWasAccepted() {
    return syncFalseCanBeAccepted && writer.desiredSize === 0;
  }

  function waitForSyncBackpressure() {
    const ondrain = writer[drainableProtocol];
    if (typeof ondrain !== "function") return undefined;
    return ondrain.$call(writer);
  }

  async function writeBatchAfterAcceptedBackpressure(batch, startIndex) {
    await waitForSyncBackpressure();
    await writeBatchAsyncFallback(batch, startIndex);
  }

  // Async fallback for writeBatch when sync write fails partway through.
  async function writeBatchAsyncFallback(batch, startIndex) {
    for (let i = startIndex; i < batch.length; i++) {
      const chunk = batch[i];
      if (hasWriteSync && writer.writeSync(chunk)) {
        // Sync retry succeeded
      } else if (syncFalseWasAccepted()) {
        totalBytes += chunk.byteLength;
        await waitForSyncBackpressure();
        continue;
      } else {
        const result = writer.write(chunk, signal ? { __proto__: null, signal } : undefined);
        if (result !== undefined) {
          await result;
        }
      }
      totalBytes += chunk.byteLength;
    }
  }

  // Write a batch using try-fallback: sync first, async if needed.
  function writeBatch(batch) {
    if (hasWritev && batch.length > 1) {
      if (!hasWritevSync || !writer.writevSync(batch)) {
        if (hasWritevSync && syncFalseWasAccepted()) {
          for (let i = 0; i < batch.length; i++) {
            totalBytes += batch[i].byteLength;
          }
          return waitForSyncBackpressure();
        }
        const opts = signal ? { __proto__: null, signal } : undefined;
        return writer.writev(batch, opts).$then(() => {
          for (let i = 0; i < batch.length; i++) {
            totalBytes += batch[i].byteLength;
          }
        });
      }
      for (let i = 0; i < batch.length; i++) {
        totalBytes += batch[i].byteLength;
      }
      return;
    }
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i];
      if (!hasWriteSync || !writer.writeSync(chunk)) {
        if (hasWriteSync && syncFalseWasAccepted()) {
          totalBytes += chunk.byteLength;
          return writeBatchAfterAcceptedBackpressure(batch, i + 1);
        }
        return writeBatchAsyncFallback(batch, i);
      }
      totalBytes += chunk.byteLength;
    }
  }

  try {
    if (useSyncIterableFastPath) {
      for (const value of source) {
        if (isUint8ArrayBatch(value)) {
          if (value.length > 0) {
            const p = writeBatch(value);
            if (p) await p;
          }
          continue;
        }
        if (isUint8Array(value)) {
          const p = writeBatch([value]);
          if (p) await p;
          continue;
        }

        const batch = await Array.fromAsync(normalizeAsyncValue(value));
        if (batch.length > 0) {
          const p = writeBatch(batch);
          if (p) await p;
        }
      }
    } else if (transforms.length === 0) {
      if (signal) {
        for await (const batch of normalized) {
          signal.throwIfAborted();
          const p = writeBatch(batch);
          if (p) await p;
        }
      } else {
        for await (const batch of normalized) {
          const p = writeBatch(batch);
          if (p) await p;
        }
      }
    } else {
      const pipeline = createAsyncPipeline(normalized, transforms, signal);

      if (signal) {
        for await (const batch of pipeline) {
          signal.throwIfAborted();
          const p = writeBatch(batch);
          if (p) await p;
        }
      } else {
        for await (const batch of pipeline) {
          const p = writeBatch(batch);
          if (p) await p;
        }
      }
    }

    if (!options?.preventClose) {
      if (!hasEndSync || writer.endSync() < 0) {
        await writer.end?.(signal ? { __proto__: null, signal } : undefined);
      }
    }
  } catch (error) {
    if (!options?.preventFail) {
      writer.fail?.(wrapError(error));
    }
    throw error;
  }

  return totalBytes;
}

export default {
  pipeTo,
  pipeToSync,
  pull,
  pullSync,
};
