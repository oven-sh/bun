// Ported from https://github.com/mafintosh/pump with
// permission from the author, Mathias Buus (@mafintosh).

"use strict";

const eos = require("internal/streams/end-of-stream");
const { once } = require("internal/shared");
const destroyImpl = require("internal/streams/destroy");
const Duplex = require("internal/streams/duplex");
const { aggregateTwoErrors } = require("internal/errors");
const { validateFunction, validateAbortSignal } = require("internal/validators");
const {
  isIterable,
  isReadable,
  isReadableNodeStream,
  isNodeStream,
  isTransformStream,
  isWebStream,
  isReadableStream,
  isWritableStream,
  isReadableFinished,
} = require("internal/streams/utils");

const SymbolAsyncIterator = Symbol.asyncIterator;
const ArrayIsArray = Array.isArray;
const SymbolDispose = Symbol.dispose;
const PromisePrototypeThen = $Promise.prototype.$then;
// Captured at load: a setImmediate that user code replaces later (fake timers) must not hold back a teardown.
const setImmediate = globalThis.setImmediate;

let PassThrough;
let Readable;
let addAbortListener;
let runInFrame;
let ReadableStreamValues;
let HeldReader;

function destroyer(stream, reading, writing) {
  let finished = false;
  stream.on("close", () => {
    finished = true;
  });

  const cleanup = eos(stream, { readable: reading, writable: writing }, err => {
    finished = !err;
  });

  return {
    destroy: err => {
      if (finished) return;
      finished = true;
      destroyImpl.destroyer(stream, err || $ERR_STREAM_DESTROYED("pipe"));
    },
    cleanup,
  };
}

function popCallback(streams) {
  // Streams should never be an empty array. It should always contain at least
  // a single stream. Therefore optimize for the average case instead of
  // checking for length === 0 as well.
  validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
  return streams.pop();
}

function makeAsyncIterable(val) {
  if (isIterable(val)) {
    return val;
  } else if (isReadableNodeStream(val)) {
    // Legacy streams are not Iterable.
    return fromReadable(val);
  }
  throw $ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], val);
}

async function* fromReadable(val) {
  Readable ??= require("internal/streams/readable");
  yield* Readable.prototype[SymbolAsyncIterator].$call(val);
}

// Created at the first use: a process that pipes no web stream does not pay for the class.
function createHeldReader() {
  const nop = () => {};
  const iteratorDone = () => ({ done: true, value: undefined });

  // A reader the pipeline can cancel: return() on the stream's own iterator queues behind a pending next().
  return class HeldReader {
    #stream: ReadableStream | null;
    #reader: ReadableStreamDefaultReader | null = null;
    #frame = $getInternalField($asyncContext, 0);
    #stopped = false;
    #cancelled: Promise<void> | undefined = undefined;

    constructor(stream: ReadableStream) {
      this.#stream = stream;
    }

    get stopped() {
      return this.#stopped;
    }

    [SymbolAsyncIterator]() {
      this.#reader = new $ReadableStreamDefaultReader(this.#stream!);
      return this;
    }

    next() {
      // A stopped pump takes no more chunks: it waits for the cancel, or for the source's own end or error.
      if (this.#stopped) return PromisePrototypeThen.$call($webStreamClosedPromise(this.#stream!), iteratorDone);
      return this.#reader!.read();
    }

    return() {
      return PromisePrototypeThen.$call(this.cancel(), iteratorDone);
    }

    // With no reason and through a reader, as the stream's own iterator cancels: not through a cancel() of a subclass.
    cancel() {
      let cancelled = this.#cancelled;
      if (cancelled === undefined) {
        let reader = this.#reader;
        try {
          reader ??= new $ReadableStreamDefaultReader(this.#stream!);
          cancelled = PromisePrototypeThen.$call(reader.cancel(), undefined, nop);
          reader.releaseLock();
        } catch {
          // Not read yet, and someone else holds the lock: there is nothing to cancel here.
          cancelled = Promise.$resolve();
        }
        this.#cancelled = cancelled;
      }
      return cancelled;
    }

    // Cancels in the next turn: an owner that hears the same signal goes first. False once the source has ended.
    stop() {
      if (this.#stream === null) return false;
      this.#stopped = true;
      runInFrame ??= require("internal/async_context_frame").run;
      runInFrame(this.#frame, setImmediate, undefined, () => this.cancel());
      return true;
    }

    // A stopped source is cancelled here if the pump failed before it got to that.
    release() {
      if (this.#stopped) this.cancel();
      this.#reader?.releaseLock();
      this.#reader = this.#stream = null;
    }
  };
}

function hold(stream, destroys) {
  if (destroys === undefined || !isReadableStream(stream)) return null;
  ReadableStreamValues ??= $ReadableStream.prototype[SymbolAsyncIterator];
  try {
    if (stream[SymbolAsyncIterator] !== ReadableStreamValues) return null;
  } catch {
    // A getter of a subclass threw. The loop reads it again, where the pump reports the error.
    return null;
  }
  HeldReader ??= createHeldReader();
  return new HeldReader(stream);
}

async function pumpToNode(iterable, writable, finish, { end }, destroys?) {
  let error;
  let onresolve: (() => void) | null = null;
  let torn;
  let reported = false;
  let onreported: (() => void) | null = null;
  const source = hold(iterable, destroys);

  const resume = err => {
    if (err) {
      error = err;
    }

    if (onresolve) {
      const callback = onresolve;
      onresolve = null;
      callback();
    }
  };

  const wait = () =>
    new Promise<void>((resolve, reject) => {
      if (error) {
        reject(error);
      } else {
        onresolve = () => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
      }
    });

  let onfinished = resume;
  let onclose;
  if (source !== null) {
    iterable = source;
    destroys.push(err => {
      torn ??= err;
      // A wait on a destination that the teardown destroyed ends with its report, as before.
      if (onresolve !== null && !reported && writable.destroyed) return;
      source.stop();
      resume(undefined);
    });
    onfinished = err => {
      reported = true;
      resume(err);
      if (err || torn !== undefined) source.stop();
      if (onreported !== null) onreported();
    };
    // As pipe() reports it for a node source: an error, unless the source has ended.
    onclose = () => {
      if (!error && torn === undefined) resume(source.stop() ? $ERR_STREAM_PREMATURE_CLOSE() : undefined);
    };
  }

  writable.on("drain", resume);
  const cleanup = eos(writable, { readable: false }, onfinished);
  if (onclose !== undefined) writable.on("close", onclose);

  try {
    if (writable.writableNeedDrain) {
      await wait();
    }

    for await (const chunk of iterable) {
      if (!writable.write(chunk)) {
        await wait();
      }
    }

    if (source !== null) {
      if (source.stopped) {
        await source.cancel();
        // With `end`, the teardown destroyed the destination: its close and its own error come before the callback.
        if (end && !reported && writable.destroyed) {
          await new Promise<void>(resolve => {
            onreported = resolve;
          });
        }
        // The source did not end. The pump fails as it does when a chunk meets a dead destination.
        throw error || torn;
      }
      source.release();
    }

    if (end) {
      writable.end();
      await wait();
    }

    finish();
  } catch (err) {
    finish(error !== err ? aggregateTwoErrors(error, err as Error) : err);
  } finally {
    source?.release();
    cleanup();
    writable.off("drain", resume);
    if (onclose !== undefined) writable.off("close", onclose);
  }
}

// The reaction lives as long as the sink does, so it holds the source and not the scope of the pump.
function stopWhenGone(sink, source) {
  const stop = () => source.stop();
  PromisePrototypeThen.$call($webStreamClosedPromise(sink), stop, stop);
}

async function pumpToWeb(readable, writable, finish, { end }, destroys?) {
  if (isTransformStream(writable)) {
    writable = writable.writable;
  }
  const source = hold(readable, destroys);
  // https://streams.spec.whatwg.org/#example-manual-write-with-backpressure
  let writer;
  try {
    writer = writable.getWriter();
  } catch (err) {
    // Not before pipelineImpl has registered every member: finishImpl then tears them all down.
    await source?.cancel();
    finish(err);
    return;
  }
  let torn;
  if (source !== null) {
    readable = source;
    destroys.push(err => {
      torn ??= err;
      source.stop();
    });
    // `writable` of a TransformStream is a property that a program can replace with any object.
    if (isWritableStream(writable)) stopWhenGone(writable, source);
  }

  try {
    for await (const chunk of readable) {
      await writer.ready;
      writer.write(chunk).catch(() => {});
    }

    if (source !== null) {
      if (source.stopped) await source.cancel();
      source.release();
    }

    // A sink that is gone rejects here with its own error, as it does for the next chunk.
    await writer.ready;

    // The source did not end: the teardown stopped the pump.
    if (source?.stopped && torn !== undefined) throw torn;

    if (end) {
      await writer.close();
    }

    finish();
  } catch (err) {
    try {
      await writer.abort(err);
      finish(err);
    } catch (err) {
      finish(err);
    }
  } finally {
    source?.release();
  }
}

function pipeline(...streams) {
  return pipelineImpl(streams, once(popCallback(streams)));
}

function pipelineImpl(streams, callback, opts?) {
  if (streams.length === 1 && ArrayIsArray(streams[0])) {
    streams = streams[0];
  }

  if (streams.length < 2) {
    throw $ERR_MISSING_ARGS("streams");
  }

  const ac = new AbortController();
  const signal = ac.signal;
  const outerSignal = opts?.signal;

  // Need to cleanup event listeners if last stream is readable
  // https://github.com/nodejs/node/issues/35452
  const lastStreamCleanup: (() => void)[] = [];

  validateAbortSignal(outerSignal, "options.signal");

  function abort() {
    finishImpl($makeAbortError(undefined, { cause: outerSignal?.reason }));
  }

  addAbortListener ??= require("internal/abort_listener").addAbortListener;
  let disposable;
  if (outerSignal) {
    disposable = addAbortListener(outerSignal, abort);
  }

  let error;
  let value;
  const destroys: ((err: Error) => void)[] = [];

  let finishCount = 0;

  function finish(err) {
    finishImpl(err, --finishCount === 0);
  }

  function finishOnlyHandleError(err) {
    finishImpl(err, false);
  }

  function finishImpl(err, final?) {
    if (err && (!error || error.code === "ERR_STREAM_PREMATURE_CLOSE" || error.name === "AbortError")) {
      error = err;
    }

    if (!error && !final) {
      return;
    }

    while (destroys.length) {
      destroys.shift()?.(error);
    }

    disposable?.[SymbolDispose]();
    ac.abort();

    if (final) {
      if (!error) {
        lastStreamCleanup.forEach(fn => fn());
      }
      process.nextTick(callback, error, value);
    }
  }

  let ret;
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i];
    const reading = i < streams.length - 1;
    const writing = i > 0;
    const next = i + 1 < streams.length ? streams[i + 1] : null;
    const end = reading || opts?.end !== false;
    const isLastStream = i === streams.length - 1;
    // Where a pump registers the teardown of `ret`. Not for what a function stage returned: that stage has `signal`.
    const held = typeof streams[i - 1] === "function" ? undefined : destroys;

    if (isNodeStream(stream)) {
      if (next !== null && (next?.closed || next?.destroyed)) {
        throw $ERR_STREAM_UNABLE_TO_PIPE();
      }

      if (end) {
        const { destroy, cleanup } = destroyer(stream, reading, writing);
        destroys.push(destroy);

        if (isReadable(stream) && isLastStream) {
          lastStreamCleanup.push(cleanup);
        }
      }

      // Catch stream errors that occur after pipe/pump has completed.
      function onError(err) {
        if (err && err.name !== "AbortError" && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          finishOnlyHandleError(err);
        }
      }
      stream.on("error", onError);
      if (isReadable(stream) && isLastStream) {
        lastStreamCleanup.push(() => {
          stream.removeListener("error", onError);
        });
      }
    }

    if (i === 0) {
      if (typeof stream === "function") {
        ret = stream({ signal });
        if (!isIterable(ret)) {
          throw $ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
        }
      } else if (isIterable(stream) || isReadableNodeStream(stream) || isTransformStream(stream)) {
        ret = stream;
      } else {
        ret = Duplex.from(stream);
      }
    } else if (typeof stream === "function") {
      if (isTransformStream(ret)) {
        ret = makeAsyncIterable(ret?.readable);
      } else {
        ret = makeAsyncIterable(ret);
      }
      ret = stream(ret, { signal });

      if (reading) {
        if (!isIterable(ret, true)) {
          throw $ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i - 1}]`, ret);
        }
      } else {
        PassThrough ??= require("internal/streams/passthrough");

        // If the last argument to pipeline is not a stream
        // we must create a proxy stream so that pipeline(...)
        // always returns a stream which can be further
        // composed through `.pipe(stream)`.

        const pt = new PassThrough({
          objectMode: true,
        });

        // Handle Promises/A+ spec, `then` could be a getter that throws on
        // second use.
        const then = ret?.then;
        if (typeof then === "function") {
          finishCount++;
          then.$call(
            ret,
            val => {
              value = val;
              if (val != null) {
                pt.write(val);
              }
              if (end) {
                pt.end();
              }
              process.nextTick(finish);
            },
            err => {
              pt.destroy(err);
              process.nextTick(finish, err);
            },
          );
        } else if (isIterable(ret, true)) {
          finishCount++;
          pumpToNode(ret, pt, finish, { end });
        } else if (isReadableStream(ret) || isTransformStream(ret)) {
          const toRead = (ret as TransformStream).readable || ret;
          finishCount++;
          pumpToNode(toRead, pt, finish, { end });
        } else {
          throw $ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
        }

        ret = pt;

        const { destroy, cleanup } = destroyer(ret, false, true);
        destroys.push(destroy);
        if (isLastStream) {
          lastStreamCleanup.push(cleanup);
        }
      }
    } else if (isNodeStream(stream)) {
      if (isReadableNodeStream(ret)) {
        finishCount += 2;
        const cleanup = pipe(ret, stream, finish, finishOnlyHandleError, { end });
        if (isReadable(stream) && isLastStream) {
          lastStreamCleanup.push(cleanup);
        }
      } else if (isTransformStream(ret) || isReadableStream(ret)) {
        const toRead = (ret as TransformStream).readable || ret;
        finishCount++;
        pumpToNode(toRead, stream, finish, { end }, held);
      } else if (isIterable(ret)) {
        finishCount++;
        pumpToNode(ret, stream, finish, { end });
      } else {
        throw $ERR_INVALID_ARG_TYPE(
          "val",
          ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
          ret,
        );
      }
      ret = stream;
    } else if (isWebStream(stream)) {
      if (isReadableNodeStream(ret)) {
        finishCount++;
        pumpToWeb(makeAsyncIterable(ret), stream, finish, { end });
      } else if (isReadableStream(ret) || isIterable(ret)) {
        finishCount++;
        pumpToWeb(ret, stream, finish, { end }, held);
      } else if (isTransformStream(ret)) {
        finishCount++;
        pumpToWeb(ret.readable, stream, finish, { end }, held);
      } else {
        throw $ERR_INVALID_ARG_TYPE(
          "val",
          ["Readable", "Iterable", "AsyncIterable", "ReadableStream", "TransformStream"],
          ret,
        );
      }
      ret = stream;
    } else {
      ret = Duplex.from(stream);
    }
  }

  if (signal?.aborted || outerSignal?.aborted) {
    process.nextTick(abort);
  }

  return ret;
}

function pipe(src, dst, finish, finishOnlyHandleError, { end }) {
  let ended = false;
  dst.on("close", () => {
    if (!ended) {
      // Finish if the destination closes before the source has completed.
      finishOnlyHandleError($ERR_STREAM_PREMATURE_CLOSE());
    }
  });

  src.pipe(dst, { end: false }); // If end is true we already will have a listener to end dst.

  if (end) {
    // Compat. Before node v10.12.0 stdio used to throw an error so
    // pipe() did/does not end() stdio destinations.
    // Now they allow it but "secretly" don't close the underlying fd.

    function endFn() {
      ended = true;
      dst.end();
    }

    if (isReadableFinished(src)) {
      // End the destination if the source has already ended.
      process.nextTick(endFn);
    } else {
      src.once("end", endFn);
    }
  } else {
    finish();
  }

  eos(src, { readable: true, writable: false }, err => {
    const rState = src._readableState;
    if (err && err.code === "ERR_STREAM_PREMATURE_CLOSE" && rState?.ended && !rState.errored && !rState.errorEmitted) {
      // Some readable streams will emit 'close' before 'end'. However, since
      // this is on the readable side 'end' should still be emitted if the
      // stream has been ended and no error emitted. This should be allowed in
      // favor of backwards compatibility. Since the stream is piped to a
      // destination this should not result in any observable difference.
      // We don't need to check if this is a writable premature close since
      // eos will only fail with premature close on the reading side for
      // duplex streams.
      src.once("end", finish).once("error", finish);
    } else {
      finish(err);
    }
  });
  return eos(dst, { readable: false, writable: true }, finish);
}

export default { pipelineImpl, pipeline };
