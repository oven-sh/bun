// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  const [textStream, closer] = __intrinsic__createTextStream(__intrinsic__getByIdDirectPrivate(stream, "highWaterMark"));
  const prom = __intrinsic__readStreamIntoSink(stream, textStream, false);
  if (prom && __intrinsic__isPromise(prom)) {
    return Promise.__intrinsic__resolve(prom).__intrinsic__then(closer.promise);
  }
  return closer.promise;
}).$$capture_end$$;
