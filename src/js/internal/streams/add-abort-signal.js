"use strict";
const primordials = require("internal/primordials");
const { SymbolDispose } = primordials;

const { isNodeStream, isWebStream, kControllerErrorFunction } = require("internal/streams/utils");

const { AbortError } = require("node:events");

const eos = require("./end-of-stream");
let addAbortListener;

// This method is inlined here for readable-stream
// It also does not allow for signal to not exist on the stream
// https://github.com/nodejs/node/pull/36061#discussion_r533718029
const validateAbortSignal = (signal, name) => {
  if (typeof signal !== "object" || !("aborted" in signal)) {
    throw $ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};

var addAbortSignal = function addAbortSignal(signal, stream) {
  validateAbortSignal(signal, "signal");
  if (!isNodeStream(stream) && !isWebStream(stream)) {
    throw $ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
  }
  return addAbortSignalNoValidate(signal, stream);
};

var addAbortSignalNoValidate = function (signal, stream) {
  if (typeof signal !== "object" || !("aborted" in signal)) {
    return stream;
  }
  const onAbort = isNodeStream(stream)
    ? () => {
        stream.destroy(new AbortError(undefined, { cause: signal.reason }));
      }
    : () => {
        stream[kControllerErrorFunction](new AbortError(undefined, { cause: signal.reason }));
      };
  if (signal.aborted) {
    onAbort();
  } else {
    addAbortListener ??= require("../../node/events").addAbortListener;
    const disposable = addAbortListener(signal, onAbort);
    eos(stream, disposable[SymbolDispose]);
  }
  return stream;
};

export default { addAbortListener, addAbortSignalNoValidate, validateAbortSignal, addAbortSignal };
