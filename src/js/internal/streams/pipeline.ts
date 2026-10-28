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

const { isReadableState } = require("internal/streams/state");

const SymbolAsyncIterator: typeof Symbol.asyncIterator = Symbol.asyncIterator;
const ArrayIsArray = Array.isArray;
const SymbolDispose: typeof Symbol.dispose = Symbol.dispose;
const PromisePrototypeThen = $Promise.prototype.$then;

let PassThrough: $BunModules["internal/streams/passthrough"] | undefined;
let Readable: $BunModules["internal/streams/readable"] | undefined;
let addAbortListener: $BunModules["internal/abort_listener"]["addAbortListener"] | undefined;
let runInFrame;
let HeldReader;

type AnyIterable = Iterable<unknown> | AsyncIterable<unknown>;
type PipelineCallback = (error?: Error | null, value?: unknown) => void;
type Then = ((onFulfilled: (value: unknown) => unknown, onRejected: (error: Error) => unknown) => unknown) | undefined;

interface PipelineOptions {
  signal?: AbortSignal;
  end?: boolean;
}

function destroyer(stream: $Node.AnyStream, reading: boolean, writing: boolean) {
  let finished = false;
  stream.on("close", () => {
    finished = true;
  });

  const cleanup = eos(stream, { readable: reading, writable: writing }, err => {
    finished = !err;
  });

  return {
    destroy: (err?: Error | null) => {
      if (finished) return;
      finished = true;
      destroyImpl.destroyer(stream, err || $ERR_STREAM_DESTROYED("pipe"));
    },
    cleanup,
  };
}

function popCallback(streams: unknown[]) {
  // Streams should never be an empty array. It should always contain at least
  // a single stream. Therefore optimize for the average case instead of
  // checking for length === 0 as well.
  validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
  return streams.pop() as PipelineCallback;
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

async function* fromReadable(val: $Node.Readable) {
  Readable ??= require("internal/streams/readable");
  yield* Readable.prototype[SymbolAsyncIterator].$call(val);
}

// Created at the first use: a process that pipes no web stream does not pay for the class.
function createHeldReader() {
  // The native functions. A program can replace the ones on the prototype of the reader and on the global (fake timers).
  const readerRead = $newCppFunction(
    "streams/JSReadableStreamDefaultReader.cpp",
    "jsReadableStreamDefaultReaderPrototypeFunction_read",
    0,
  );
  const readerCancel = $newCppFunction(
    "streams/JSReadableStreamDefaultReader.cpp",
    "jsReadableStreamDefaultReaderPrototypeFunction_cancel",
    1,
  );
  const readerRelease = $newCppFunction(
    "streams/JSReadableStreamDefaultReader.cpp",
    "jsReadableStreamDefaultReaderPrototypeFunction_releaseLock",
    0,
  );
  const setImmediate = $newCppFunction("node/NodeTimers.cpp", "functionSetImmediate", 1);
  const nop = () => {};
  const iteratorDone = () => ({ done: true, value: undefined });
  const cancelHeld = held => {
    held.cancel();
  };

  // A reader the pipeline can cancel. Node uses the stream's iterator, whose return() queues behind a pending next().
  return class HeldReader {
    #stream: ReadableStream | null = null;
    #reader: ReadableStreamDefaultReader | null = null;
    #frame = $getInternalField($asyncContext, 0);
    #stopped = false;
    #cancelled: Promise<unknown> | undefined = undefined;

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
      return readerRead.$call(this.#reader!);
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
          cancelled = PromisePrototypeThen.$call(readerCancel.$call(reader), undefined, nop);
          readerRelease.$call(reader);
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
      if (!this.#stopped) {
        this.#stopped = true;
        runInFrame ??= require("internal/async_context_frame").run;
        runInFrame(this.#frame, setImmediate, undefined, cancelHeld, this);
      }
      return true;
    }

    // A stopped source is cancelled here if the pump failed before it got to that.
    release() {
      if (this.#stopped) this.cancel();
      const reader = this.#reader;
      if (reader !== null) readerRelease.$call(reader);
      this.#reader = this.#stream = null;
      this.#frame = undefined;
    }
  };
}

function hold(stream, destroys) {
  if (destroys === undefined || !isReadableStream(stream)) return null;
  try {
    // Not the built-in iterator (a subclass, a property, a replacement on the prototype): the loop reads through it.
    if (stream[SymbolAsyncIterator] !== $ReadableStream.prototype.$values) return null;
  } catch {
    // A getter threw. The loop reads it again, where the pump reports the error.
    return null;
  }
  HeldReader ??= createHeldReader();
  return new HeldReader(stream);
}

async function pumpToNode(
  iterable: AnyIterable,
  writable: $Node.AnyStream,
  finish: $Node.ErrorCallback,
  { end }: { end: boolean },
  destroys?: ((err?: Error | null) => void)[],
) {
  let error: Error | undefined;
  let onresolve: (() => void) | null = null;
  let torn;
  let reported = false;
  const source = hold(iterable, destroys);

  const resume = (err?: Error | null) => {
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
    destroys!.push(err => {
      torn ??= err;
      // The report of a destination that the teardown destroyed stops the pump, and ends a wait on a dead destination.
      if ((end || onresolve !== null) && !reported && writable.destroyed) return;
      source.stop();
      resume(undefined);
    });
    onfinished = err => {
      reported = true;
      resume(err);
      if (err || torn !== undefined) source.stop();
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
      if (!writable.write!(chunk)) {
        await wait();
      }
    }

    if (source !== null) {
      if (source.stopped) {
        await source.cancel();
        // The source did not end. The pump fails as it does when a chunk meets a dead destination.
        throw error || torn;
      }
      source.release();
    }

    if (end) {
      writable.end!();
      await wait();
    }

    finish();
  } catch (err) {
    finish(error !== err ? aggregateTwoErrors(error, err as Error) : (err as Error));
  } finally {
    source?.release();
    cleanup();
    writable.off("drain", resume);
    if (onclose !== undefined) writable.off("close", onclose);
  }
}

// The reaction lives as long as the sink does: it holds the source, not the scope of the pump or its async context.
function stopWhenErrored(sink, source) {
  const stop = () => source.stop();
  runInFrame ??= require("internal/async_context_frame").run;
  runInFrame(undefined, PromisePrototypeThen, $webStreamClosedPromise(sink), undefined, stop);
}

async function pumpToWeb(
  readable: AnyIterable,
  writable: WritableStream | TransformStream,
  finish: $Node.ErrorCallback,
  { end }: { end: boolean },
  destroys?: ((err?: Error | null) => void)[],
) {
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
    finish(err as Error);
    return;
  }
  let torn;
  if (source !== null) {
    readable = source;
    destroys!.push(err => {
      torn ??= err;
      source.stop();
    });
    // `writable` of a TransformStream is a property that a program can replace with any object.
    if (isWritableStream(writable)) stopWhenErrored(writable, source);
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

    // The source did not end: the teardown stopped the pump. It does not wait for room in the sink.
    const stopped = source !== null && source.stopped && torn !== undefined;
    const ready = writer.ready;
    // A sink that is gone has rejected this with its own error, as it does for the next chunk.
    if (!stopped || !$isPromise(ready) || !$isPromisePending(ready)) await ready;
    if (stopped) throw torn;

    if (end) {
      await writer.close();
    }

    finish();
  } catch (err) {
    try {
      await writer.abort(err);
      finish(err as Error);
    } catch (err) {
      finish(err as Error);
    }
  } finally {
    source?.release();
  }
}

function pipeline(...streams) {
  return pipelineImpl(streams, once(popCallback(streams)));
}

function pipelineImpl(streams, callback: PipelineCallback, opts?: PipelineOptions) {
  if (streams.length === 1 && ArrayIsArray(streams[0])) {
    streams = streams[0];
  }

  if (streams.length < 2) {
    throw $ERR_MISSING_ARGS("streams");
  }

  let ac: AbortController | undefined;
  let isAborted = false;
  const outerSignal = opts?.signal;

  function signalForStage() {
    if (!ac) {
      ac = new AbortController();
      if (isAborted) ac.abort();
    }
    return ac.signal;
  }

  // Need to cleanup event listeners if last stream is readable
  // https://github.com/nodejs/node/issues/35452
  const lastStreamCleanup: (() => void)[] = [];

  validateAbortSignal(outerSignal, "options.signal");

  function abort() {
    finishImpl($makeAbortError(undefined, { cause: outerSignal?.reason }));
  }

  addAbortListener ??= require("internal/abort_listener").addAbortListener;
  let disposable: Disposable | undefined;
  if (outerSignal) {
    disposable = addAbortListener(outerSignal, abort);
  }

  let error: Error | null | undefined;
  let value: unknown;
  const destroys: ((err?: Error | null) => void)[] = [];

  let finishCount = 0;

  function finish(err?: Error | null) {
    finishImpl(err, --finishCount === 0);
  }

  function finishOnlyHandleError(err?: Error | null) {
    finishImpl(err, false);
  }

  function finishImpl(err?: Error | null, final?: boolean) {
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
    isAborted = true;
    ac?.abort();

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
      function onError(err: Error | null | undefined) {
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
        ret = (stream as (options: { signal: AbortSignal }) => unknown)({ signal: signalForStage() });
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
      ret = (stream as (source: AnyIterable, options: { signal: AbortSignal }) => unknown)(ret, {
        signal: signalForStage(),
      });

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
        const then: Then = ret?.then;
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
          const toRead = (ret as any).readable || ret;
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
        const toRead = (ret as any).readable || ret;
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
        pumpToWeb(makeAsyncIterable(ret), stream as WritableStream | TransformStream, finish, { end });
      } else if (isReadableStream(ret) || isIterable(ret)) {
        finishCount++;
        pumpToWeb(ret, stream as WritableStream | TransformStream, finish, { end }, held);
      } else if (isTransformStream(ret)) {
        finishCount++;
        pumpToWeb(ret.readable, stream as WritableStream | TransformStream, finish, { end }, held);
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

  if (isAborted || outerSignal?.aborted) {
    process.nextTick(abort);
  }

  return ret;
}

function pipe(
  src: $Node.Readable,
  dst: $Node.AnyStream,
  finish: $Node.ErrorCallback,
  finishOnlyHandleError: $Node.ErrorCallback,
  { end }: { end: boolean },
) {
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
      dst.end!();
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
    const rState = src._readableState as $Node.ReadableState | $Node.ForeignState | undefined;
    if (
      err &&
      err.code === "ERR_STREAM_PREMATURE_CLOSE" &&
      (isReadableState(rState)
        ? rState.ended && !rState.errored && !rState.errorEmitted
        : rState?.ended && !rState.errored && !rState.errorEmitted)
    ) {
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
