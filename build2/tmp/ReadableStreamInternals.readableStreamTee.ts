// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,shouldClone) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStream(stream),"$isReadableStream(stream)"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(typeof shouldClone === "boolean","typeof shouldClone === \"boolean\""):void 0);

  var start_ = __intrinsic__getByIdDirectPrivate(stream, "start");
  if (start_) {
    __intrinsic__putByIdDirectPrivate(stream, "start", undefined);
    start_();
  }

  const reader = new __intrinsic__ReadableStreamDefaultReader(stream);

  const teeState = {
    closedOrErrored: false,
    canceled1: false,
    canceled2: false,
    reason1: undefined,
    reason2: undefined,
  };

  teeState.cancelPromiseCapability = __intrinsic__newPromiseCapability(Promise);

  const pullFunction = __intrinsic__readableStreamTeePullFunction(teeState, reader, shouldClone);

  const branch1Source = {};
  __intrinsic__putByIdDirectPrivate(branch1Source, "pull", pullFunction);
  __intrinsic__putByIdDirectPrivate(branch1Source, "cancel", __intrinsic__readableStreamTeeBranch1CancelFunction(teeState, stream));

  const branch2Source = {};
  __intrinsic__putByIdDirectPrivate(branch2Source, "pull", pullFunction);
  __intrinsic__putByIdDirectPrivate(branch2Source, "cancel", __intrinsic__readableStreamTeeBranch2CancelFunction(teeState, stream));

  const branch1 = new __intrinsic__ReadableStream(branch1Source);
  const branch2 = new __intrinsic__ReadableStream(branch2Source);

  __intrinsic__getByIdDirectPrivate(reader, "closedPromiseCapability").promise.__intrinsic__then(undefined, function (e) {
    if (teeState.closedOrErrored) return;
    __intrinsic__readableStreamDefaultControllerError(branch1.__intrinsic__readableStreamController, e);
    __intrinsic__readableStreamDefaultControllerError(branch2.__intrinsic__readableStreamController, e);
    teeState.closedOrErrored = true;
    if (!teeState.canceled1 || !teeState.canceled2) teeState.cancelPromiseCapability.resolve.__intrinsic__call();
  });

  // Additional fields compared to the spec, as they are needed within pull/cancel functions.
  teeState.branch1 = branch1;
  teeState.branch2 = branch2;

  return [branch1, branch2];
}).$$capture_end$$;
