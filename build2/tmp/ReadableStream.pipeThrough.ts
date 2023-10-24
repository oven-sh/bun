// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(streams,options) {  const transforms = streams;

  const readable = transforms["readable"];
  if (!__intrinsic__isReadableStream(readable)) throw __intrinsic__makeTypeError("readable should be ReadableStream");

  const writable = transforms["writable"];
  const internalWritable = __intrinsic__getInternalWritableStream(writable);
  if (!__intrinsic__isWritableStream(internalWritable)) throw __intrinsic__makeTypeError("writable should be WritableStream");

  let preventClose = false;
  let preventAbort = false;
  let preventCancel = false;
  let signal;
  if (!__intrinsic__isUndefinedOrNull(options)) {
    if (!__intrinsic__isObject(options)) throw __intrinsic__makeTypeError("options must be an object");

    preventAbort = !!options["preventAbort"];
    preventCancel = !!options["preventCancel"];
    preventClose = !!options["preventClose"];

    signal = options["signal"];
    if (signal !== undefined && !__intrinsic__isAbortSignal(signal)) throw __intrinsic__makeTypeError("options.signal must be AbortSignal");
  }

  if (!__intrinsic__isReadableStream(this)) throw __intrinsic__makeThisTypeError("ReadableStream", "pipeThrough");

  if (__intrinsic__isReadableStreamLocked(this)) throw __intrinsic__makeTypeError("ReadableStream is locked");

  if (__intrinsic__isWritableStreamLocked(internalWritable)) throw __intrinsic__makeTypeError("WritableStream is locked");

  __intrinsic__readableStreamPipeToWritableStream(this, internalWritable, preventClose, preventAbort, preventCancel, signal);

  return readable;
}).$$capture_end$$;
