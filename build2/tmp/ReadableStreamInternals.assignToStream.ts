// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,sink) {  // The stream is either a direct stream or a "default" JS stream
  var underlyingSource = __intrinsic__getByIdDirectPrivate(stream, "underlyingSource");

  // we know it's a direct stream when $underlyingSource is set
  if (underlyingSource) {
    try {
      return __intrinsic__readDirectStream(stream, sink, underlyingSource);
    } catch (e) {
      throw e;
    } finally {
      underlyingSource = undefined;
      stream = undefined;
      sink = undefined;
    }
  }

  return __intrinsic__readStreamIntoSink(stream, sink, true);
}).$$capture_end$$;
