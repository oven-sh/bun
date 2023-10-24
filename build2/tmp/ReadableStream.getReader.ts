// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(options) {  if (!__intrinsic__isReadableStream(this)) throw __intrinsic__makeThisTypeError("ReadableStream", "getReader");

  const mode = __intrinsic__toDictionary(options, {}, "ReadableStream.getReader takes an object as first argument").mode;
  if (mode === undefined) {
    var start_ = __intrinsic__getByIdDirectPrivate(this, "start");
    if (start_) {
      __intrinsic__putByIdDirectPrivate(this, "start", undefined);
      start_();
    }

    return new ReadableStreamDefaultReader(this);
  }
  // String conversion is required by spec, hence double equals.
  if (mode == "byob") {
    return new ReadableStreamBYOBReader(this);
  }

  __intrinsic__throwTypeError("Invalid mode is specified");
}).$$capture_end$$;
