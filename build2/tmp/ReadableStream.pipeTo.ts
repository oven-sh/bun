// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(destination) {  if (!__intrinsic__isReadableStream(this)) return Promise.__intrinsic__reject(__intrinsic__makeThisTypeError("ReadableStream", "pipeTo"));

  if (__intrinsic__isReadableStreamLocked(this)) return Promise.__intrinsic__reject(__intrinsic__makeTypeError("ReadableStream is locked"));

  // FIXME: https://bugs.webkit.org/show_bug.cgi?id=159869.
  // Built-in generator should be able to parse function signature to compute the function length correctly.
  let options = __intrinsic__argument(1);

  let preventClose = false;
  let preventAbort = false;
  let preventCancel = false;
  let signal;
  if (!__intrinsic__isUndefinedOrNull(options)) {
    if (!__intrinsic__isObject(options)) return Promise.__intrinsic__reject(__intrinsic__makeTypeError("options must be an object"));

    try {
      preventAbort = !!options["preventAbort"];
      preventCancel = !!options["preventCancel"];
      preventClose = !!options["preventClose"];

      signal = options["signal"];
    } catch (e) {
      return Promise.__intrinsic__reject(e);
    }

    if (signal !== undefined && !__intrinsic__isAbortSignal(signal))
      return Promise.__intrinsic__reject(__intrinsic__makeTypeError("options.signal must be AbortSignal"));
  }

  const internalDestination = __intrinsic__getInternalWritableStream(destination);
  if (!__intrinsic__isWritableStream(internalDestination))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("ReadableStream pipeTo requires a WritableStream"));

  if (__intrinsic__isWritableStreamLocked(internalDestination)) return Promise.__intrinsic__reject(__intrinsic__makeTypeError("WritableStream is locked"));

  return __intrinsic__readableStreamPipeToWritableStream(
    this,
    internalDestination,
    preventClose,
    preventAbort,
    preventCancel,
    signal,
  );
}).$$capture_end$$;
