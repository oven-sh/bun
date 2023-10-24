// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isWritableStreamLocked(stream),"$isWritableStreamLocked(stream)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === "writable","$getByIdDirectPrivate(stream, \"state\") === \"writable\""):void 0);

  const writePromiseCapability = __intrinsic__newPromiseCapability(Promise);
  const writeRequests = __intrinsic__getByIdDirectPrivate(stream, "writeRequests");
  writeRequests.push(writePromiseCapability);
  return writePromiseCapability.promise;
}).$$capture_end$$;
