// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,reason) {  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  if (state === "closed" || state === "errored") return Promise.__intrinsic__resolve();

  const pendingAbortRequest = __intrinsic__getByIdDirectPrivate(stream, "pendingAbortRequest");
  if (pendingAbortRequest !== undefined) return pendingAbortRequest.promise.promise;

  (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);
  let wasAlreadyErroring = false;
  if (state === "erroring") {
    wasAlreadyErroring = true;
    reason = undefined;
  }

  const abortPromiseCapability = __intrinsic__newPromiseCapability(Promise);
  __intrinsic__putByIdDirectPrivate(stream, "pendingAbortRequest", {
    promise: abortPromiseCapability,
    reason: reason,
    wasAlreadyErroring: wasAlreadyErroring,
  });

  if (!wasAlreadyErroring) __intrinsic__writableStreamStartErroring(stream, reason);
  return abortPromiseCapability.promise;
}).$$capture_end$$;
