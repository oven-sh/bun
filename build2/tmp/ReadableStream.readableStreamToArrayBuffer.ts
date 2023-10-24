// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  // this is a direct stream
  var underlyingSource = __intrinsic__getByIdDirectPrivate(stream, "underlyingSource");

  if (underlyingSource !== undefined) {
    return __intrinsic__readableStreamToArrayBufferDirect(stream, underlyingSource);
  }

  var result = Bun.readableStreamToArray(stream);
  if (__intrinsic__isPromise(result)) {
    // `result` is an InternalPromise, which doesn't have a `.$then` method
    // but `.then` isn't user-overridable, so we can use it safely.
    return result.then(Bun.concatArrayBuffers);
  }

  return Bun.concatArrayBuffers(result);
}).$$capture_end$$;
