"use strict";

const { isNodeStream, isWebStream, kControllerErrorFunction } = require("internal/streams/utils");
// A symbol that a pattern takes out of `require(..)` is a plain `symbol` for the type checker.
type ControllerErrorFunction = $BunModules["internal/streams/utils"]["kControllerErrorFunction"];
const eos = require("internal/streams/end-of-stream");

const SymbolDispose: typeof Symbol.dispose = Symbol.dispose;

let addAbortListener: $BunModules["internal/abort_listener"]["addAbortListener"] | undefined;

// This method is inlined here for readable-stream
// It also does not allow for signal to not exist on the stream
// https://github.com/nodejs/node/pull/36061#discussion_r533718029
const validateAbortSignal = (signal, name: string) => {
  if (typeof signal !== "object" || !("aborted" in signal)) {
    throw $ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};

function addAbortSignal(signal: AbortSignal, stream) {
  validateAbortSignal(signal, "signal");
  if (!isNodeStream(stream) && !isWebStream(stream)) {
    throw $ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
  }
  return addAbortSignalNoValidate(signal, stream);
}

function addAbortSignalNoValidate(signal: AbortSignal, stream) {
  if (typeof signal !== "object" || !("aborted" in signal)) {
    return stream;
  }
  const onAbort = isNodeStream(stream)
    ? () => {
        stream.destroy!($makeAbortError(undefined, { cause: signal.reason }));
      }
    : () => {
        const error = $makeAbortError(undefined, { cause: signal.reason });
        // Bun's web streams error natively rather than through Node's symbol, which a
        // userland or polyfilled stream may still define.
        if (stream[kControllerErrorFunction] !== undefined) {
          (stream as $Node.PolyfilledWebStream)[kControllerErrorFunction as ControllerErrorFunction]!(error);
        } else {
          $webStreamControllerError(stream, error);
        }
      };
  if (signal.aborted) {
    onAbort();
  } else {
    addAbortListener ??= require("internal/abort_listener").addAbortListener;
    const disposable = addAbortListener(signal, onAbort);
    eos(stream, disposable[SymbolDispose]);
  }
  return stream;
}

export default {
  addAbortSignal,
  addAbortSignalNoValidate,
};
