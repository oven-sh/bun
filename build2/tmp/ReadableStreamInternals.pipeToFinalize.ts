// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState) {  __intrinsic__writableStreamDefaultWriterRelease(pipeState.writer);
  __intrinsic__readableStreamReaderGenericRelease(pipeState.reader);

  // Instead of removing the abort algorithm as per spec, we make it a no-op which is equivalent.
  pipeState.finalized = true;

  if (arguments.length > 1) pipeState.promiseCapability.reject.__intrinsic__call(undefined, arguments[1]);
  else pipeState.promiseCapability.resolve.__intrinsic__call();
}).$$capture_end$$;
