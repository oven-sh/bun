// Ported from https://github.com/mafintosh/end-of-stream with
// permission from the author, Mathias Buus (@mafintosh).

"use strict";

const { kEmptyObject, once } = require("internal/shared");
const { validateAbortSignal, validateFunction, validateObject, validateBoolean } = require("internal/validators");
const {
  isClosed,
  isReadable,
  isReadableNodeStream,
  isReadableStream,
  isReadableFinished,
  isReadableErrored,
  isWritable,
  isWritableNodeStream,
  isWritableStream,
  isWritableFinished,
  isWritableErrored,
  isNodeStream,
  willEmitClose: _willEmitClose,
  isWritableSideFinished,
  isReadableSideFinished,
  isNodeStreamClosed,
  willNodeStreamEmitClose,
  kIsClosedPromise,
} = require("internal/streams/utils");

const streamState = require("internal/streams/state");
const { isReadableState, isWritableState } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const sideOfHeir = IS_COMPILED_AHEAD_OF_TIME ? streamState.internals.readableSideOfHeir : undefined;

const enum Flag {
  ErrorEmitted = 1 << 1,
}

const SymbolDispose: typeof Symbol.dispose = Symbol.dispose;
const PromisePrototypeThen = $Promise.prototype.$then;

let addAbortListener: $BunModules["internal/abort_listener"]["addAbortListener"] | undefined;
let AsyncResource: $BunModules["node:async_hooks"]["AsyncResource"] | undefined;
let enabledHooksExist: $BunModules["internal/async_hooks"]["enabledHooksExist"] | undefined;

interface EosOptions {
  __proto__?: null;
  readable?: boolean;
  writable?: boolean;
  error?: boolean;
  cleanup?: boolean;
  signal?: AbortSignal;
  [kEosNodeSynchronousCallback]?: boolean;
}

function isRequest(stream: $Node.AnyStream) {
  return stream.setHeader && typeof stream.abort === "function";
}

const nop = () => {};

function bindAsyncResource(fn: $Node.ErrorCallback, type: string): $Node.ErrorCallback {
  AsyncResource ??= require("node:async_hooks").AsyncResource;
  const resource = new AsyncResource(type);
  return function (this: unknown, ...args: [error?: Error | null]) {
    return resource.runInAsyncScope(fn, this, ...args);
  };
}

// True when an AsyncLocalStorage context is active (node's
// AsyncContextFrame.current()) or createHook() hooks are enabled: eos() then
// binds an AsyncResource so hooks see STREAM_END_OF_STREAM events.
function hasAsyncContext() {
  if ($getInternalField($asyncContext, 0) !== undefined) return true;
  enabledHooksExist ??= require("internal/async_hooks").enabledHooksExist;
  return enabledHooksExist();
}

/**
 * Returns the current stream error tracked by eos(), if any.
 */
function getEosErrored(stream: $Node.AnyStream): Error | null {
  const errored = isWritableErrored(stream) || isReadableErrored(stream);
  return (typeof errored !== "boolean" && errored) || null;
}

/**
 * Returns the error eos() would report from an immediate close, including
 * premature close detection for unfinished readable or writable sides.
 */
function getEosOnCloseError(
  stream: $Node.AnyStream,
  readable: boolean,
  readableFinished: boolean | null,
  writable: boolean,
  writableFinished: boolean | null,
) {
  const errored = getEosErrored(stream);
  if (errored) {
    return errored;
  }

  if (readable && !readableFinished && isReadableNodeStream(stream, true)) {
    if (!isReadableFinished(stream, false)) {
      return $ERR_STREAM_PREMATURE_CLOSE();
    }
  }
  if (writable && !writableFinished) {
    if (!isWritableFinished(stream, false)) {
      return $ERR_STREAM_PREMATURE_CLOSE();
    }
  }

  return null;
}

const enum Own {
  Unknown,
  ReadableAlone,
  Response,
}

function kindOfOwnStream(stream: unknown): Own {
  const internals = streamState.internals;
  if (internals.isPlainReadableAlone?.(stream as $Node.AnyStream)) return Own.ReadableAlone;
  return internals.isPlainUnfinishedResponse?.(stream as $Node.AnyStream) ? Own.Response : Own.Unknown;
}

function onceWithError(callback: $Node.ErrorCallback | undefined): $Node.ErrorCallback {
  return function (this: unknown, error?: Error | null) {
    const fn = callback;
    if (fn === undefined) return;
    callback = undefined;
    if (arguments.length === 0) fn.$call(this);
    else fn.$call(this, error);
  };
}

// Internal only: if eos() can settle immediately, invoke the callback before
// returning cleanup. Callers must tolerate cleanup yet to be assigned.
const kEosNodeSynchronousCallback = Symbol("kEosNodeSynchronousCallback");

function eos(stream: $Node.AnyStream | ReadableStream | WritableStream, callback: $Node.ErrorCallback): () => void;
function eos(
  stream: $Node.AnyStream | ReadableStream | WritableStream,
  options: EosOptions | null | undefined,
  callback: $Node.ErrorCallback,
): () => void;
function eos(stream: $Node.AnyStream | ReadableStream | WritableStream, options, callback?: $Node.ErrorCallback) {
  if (arguments.length === 2) {
    callback = options;
    options = kEmptyObject;
  } else if (options == null) {
    options = kEmptyObject;
  } else if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    typeof options === "object" &&
    !$isProxyObject(options) &&
    !$isJSArray(options)
  )) {
    validateObject(options, "options");
  }
  if (!(IS_COMPILED_AHEAD_OF_TIME && typeof callback === "function")) validateFunction(callback, "callback");
  const givenSignal =
    IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir ? undefined : options.signal;
  if (givenSignal !== undefined) validateAbortSignal(givenSignal, "options.signal");

  if (
    !(IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir) &&
    !(IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(stream as unknown as $Node.Stream, "on")) &&
    (isReadableStream(stream) || isWritableStream(stream))
  ) {
    return eosWeb(stream, options, callback!);
  }

  if (!isNodeStream(stream)) {
    throw $ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
  }

  const readable: boolean =
    (IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir ? undefined : options.readable) ??
    isReadableNodeStream(stream);
  const writable: boolean =
    IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir
      ? false
      : (options.writable ?? isWritableNodeStream(stream));
  // TODO (ronag): Improve soft detection to include core modules and
  // common ecosystem modules that do properly emit 'close' but fail
  // this generic check.
  const own = IS_COMPILED_AHEAD_OF_TIME && options !== sideOfHeir ? kindOfOwnStream(stream) : Own.Unknown;
  let willEmitClose: boolean | null;
  let writableFinished: boolean | null;
  let readableFinished: boolean | null;
  if (own !== Own.Unknown) {
    willEmitClose = willNodeStreamEmitClose(stream) && readable === true && writable === (own === Own.Response);
    writableFinished = own === Own.Response ? isWritableSideFinished(stream, false) : null;
    readableFinished = isReadableSideFinished(stream, false);
  } else {
    willEmitClose =
      _willEmitClose(stream) && isReadableNodeStream(stream) === readable && isWritableNodeStream(stream) === writable;
    writableFinished = isWritableFinished(stream, false);
    readableFinished = isReadableFinished(stream, false);
  }

  const wState = stream._writableState;
  const rState = stream._readableState;

  /**
   * undefined: to be determined
   * null: no error
   * Error: an error occurred
   */
  let immediateResult: Error | null | undefined;
  if (own !== Own.Unknown ? isNodeStreamClosed(stream) : isClosed(stream)) {
    immediateResult = getEosOnCloseError(stream, readable, readableFinished, writable, writableFinished);
  } else if (
    (isWritableState(wState) ? (wState[kState] & Flag.ErrorEmitted) !== 0 : wState?.errorEmitted) ||
    (isReadableState(rState) ? (rState[kState] & Flag.ErrorEmitted) !== 0 : rState?.errorEmitted)
  ) {
    if (!willEmitClose) {
      immediateResult = getEosErrored(stream);
    }
  } else if (
    !readable &&
    (!willEmitClose || isReadable(stream)) &&
    (writableFinished || isWritable(stream) === false) &&
    (isWritableState(wState)
      ? wState.pendingcb === undefined || wState.pendingcb === 0
      : wState == null || wState.pendingcb === undefined || wState.pendingcb === 0)
  ) {
    immediateResult = getEosErrored(stream);
  } else if (
    !writable &&
    (!willEmitClose || isWritable(stream)) &&
    (readableFinished || isReadable(stream) === false)
  ) {
    immediateResult = getEosErrored(stream);
  } else if (rState && stream.req && stream.aborted) {
    immediateResult = getEosErrored(stream);
  }

  let cleanup = () => {
    callback = nop;
  };
  if (immediateResult !== undefined) {
    if ((IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir) || options.error !== false) {
      stream.on("error", nop);
      cleanup = () => {
        callback = nop;
        stream.removeListener("error", nop);
      };
    }
  } else {
    const signal =
      IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir ? undefined : options.signal;
    if (signal?.aborted) {
      immediateResult = $makeAbortError(undefined, { cause: signal.reason });
    }
  }
  // null means "finished without error": invoke with no error argument at all,
  // not an explicit null/undefined.
  const invokeImmediate = () => {
    if (immediateResult === null) {
      callback!.$call(stream);
    } else {
      callback!.$call(stream, immediateResult);
    }
  };

  if (immediateResult !== undefined && options[kEosNodeSynchronousCallback]) {
    invokeImmediate();
    return cleanup;
  }

  if (hasAsyncContext()) {
    callback = bindAsyncResource(callback!, "STREAM_END_OF_STREAM");
  }

  if (immediateResult !== undefined) {
    process.nextTick(invokeImmediate);
    return cleanup;
  }

  callback = IS_COMPILED_AHEAD_OF_TIME ? onceWithError(callback) : once(callback);

  const onlegacyfinish = () => {
    if (!stream.writable) {
      onfinish();
    }
  };

  const onfinish = () => {
    writableFinished = true;
    // Stream should not be destroyed here. If it is that
    // means that user space is doing something differently and
    // we cannot trust willEmitClose.
    if (stream.destroyed) {
      willEmitClose = false;
    }

    if (willEmitClose && (!stream.readable || readable)) {
      return;
    }

    if (!readable || readableFinished) {
      callback!.$call(stream);
    }
  };

  const onend = () => {
    readableFinished = true;
    // Stream should not be destroyed here. If it is that
    // means that user space is doing something differently and
    // we cannot trust willEmitClose.
    if (stream.destroyed) {
      willEmitClose = false;
    }

    if (willEmitClose && (!stream.writable || writable)) {
      return;
    }

    if (!writable || writableFinished) {
      callback!.$call(stream);
    }
  };

  const onerror = (err: Error) => {
    callback!.$call(stream, err);
  };

  const onclose = () => {
    const error = getEosOnCloseError(stream, readable, readableFinished, writable, writableFinished);
    if (error === null) {
      callback!.$call(stream);
    } else {
      ("unlikely");
      callback!.$call(stream, error);
    }
  };

  const onrequest = () => {
    stream.req!.on("finish", onfinish);
  };

  if (isRequest(stream)) {
    stream.on("complete", onfinish);
    if (!willEmitClose) {
      stream.on("abort", onclose);
    }
    if (stream.req) {
      onrequest();
    } else {
      stream.on("request", onrequest);
    }
  } else if (writable && !wState) {
    // legacy streams
    stream.on("end", onlegacyfinish);
    stream.on("close", onlegacyfinish);
  }

  // Not all streams will emit 'close' after 'aborted'.
  if (!willEmitClose && typeof stream.aborted === "boolean") {
    stream.on("aborted", onclose);
  }

  stream.on("end", onend);
  stream.on("finish", onfinish);
  if ((IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir) || options.error !== false) {
    stream.on("error", onerror);
  }
  stream.on("close", onclose);

  cleanup = () => {
    callback = nop;
    stream.removeListener("aborted", onclose);
    stream.removeListener("complete", onfinish);
    stream.removeListener("abort", onclose);
    stream.removeListener("request", onrequest);
    const streamReq = stream.req;
    if (streamReq) streamReq.removeListener("finish", onfinish);
    stream.removeListener("end", onlegacyfinish);
    stream.removeListener("close", onlegacyfinish);
    stream.removeListener("finish", onfinish);
    stream.removeListener("end", onend);
    stream.removeListener("error", onerror);
    stream.removeListener("close", onclose);
  };

  const signal =
    IS_COMPILED_AHEAD_OF_TIME && !CAN_REPLACE_BUILT_INS && options === sideOfHeir ? undefined : options.signal;
  if (signal) {
    const abort = () => {
      // Keep it because cleanup removes it.
      const endCallback = callback!;
      cleanup();
      endCallback.$call(stream, $makeAbortError(undefined, { cause: signal.reason }));
    };
    addAbortListener ??= require("internal/abort_listener").addAbortListener;
    const disposable = addAbortListener(signal, abort);
    const originalCallback = callback!;
    callback = once((...args) => {
      disposable[SymbolDispose]();
      originalCallback.$apply(stream, args);
    });
  }

  return cleanup;
}

function eosWeb(stream: ReadableStream | WritableStream, options: EosOptions, callback: $Node.ErrorCallback) {
  if (hasAsyncContext()) {
    callback = once(bindAsyncResource(callback, "STREAM_END_OF_STREAM"));
  } else {
    callback = once(callback);
  }

  let isAborted = false;
  let abort = nop;
  const signal = options.signal;
  if (signal) {
    abort = () => {
      isAborted = true;
      callback.$call(stream, $makeAbortError(undefined, { cause: signal.reason }));
    };
    if (signal.aborted) {
      process.nextTick(abort);
    } else {
      addAbortListener ??= require("internal/abort_listener").addAbortListener;
      const disposable = addAbortListener(signal, abort);
      const originalCallback = callback;
      callback = once((...args) => {
        disposable[SymbolDispose]();
        originalCallback.$apply(stream, args);
      });
    }
  }
  const resolverFn = (...args: [error?: Error | null]) => {
    if (!isAborted) {
      process.nextTick(() => callback.$apply(stream, args));
    }
  };
  // Bun's web streams carry the closed promise natively rather than on Node's symbol, which a
  // userland or polyfilled stream may still define.
  const closedPromise = stream[kIsClosedPromise]?.promise ?? $webStreamClosedPromise(stream);
  PromisePrototypeThen.$call(closedPromise, resolverFn, resolverFn);
  return nop;
}

function finished(stream: $Node.AnyStream | ReadableStream | WritableStream, opts?: EosOptions | null) {
  let autoCleanup = false;
  if (opts === null) {
    opts = kEmptyObject;
  }
  if (opts?.cleanup) {
    validateBoolean(opts.cleanup, "cleanup");
    autoCleanup = opts.cleanup;
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = eos(stream, opts, err => {
      if (autoCleanup) {
        cleanup();
      }
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

eos.finished = finished;
eos.kEosNodeSynchronousCallback = kEosNodeSynchronousCallback;
export default eos;
