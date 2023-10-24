// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingByteSource,highWaterMark) {  if (!__intrinsic__isReadableStream(stream)) __intrinsic__throwTypeError("ReadableByteStreamController needs a ReadableStream");

  // readableStreamController is initialized with null value.
  if (__intrinsic__getByIdDirectPrivate(stream, "readableStreamController") !== null)
    __intrinsic__throwTypeError("ReadableStream already has a controller");

  __intrinsic__putByIdDirectPrivate(this, "controlledReadableStream", stream);
  __intrinsic__putByIdDirectPrivate(this, "underlyingByteSource", underlyingByteSource);
  __intrinsic__putByIdDirectPrivate(this, "pullAgain", false);
  __intrinsic__putByIdDirectPrivate(this, "pulling", false);
  __intrinsic__readableByteStreamControllerClearPendingPullIntos(this);
  __intrinsic__putByIdDirectPrivate(this, "queue", __intrinsic__newQueue());
  __intrinsic__putByIdDirectPrivate(this, "started", 0);
  __intrinsic__putByIdDirectPrivate(this, "closeRequested", false);

  let hwm = __intrinsic__toNumber(highWaterMark);
  if (hwm !== hwm || hwm < 0) __intrinsic__throwRangeError("highWaterMark value is negative or not a number");
  __intrinsic__putByIdDirectPrivate(this, "strategyHWM", hwm);

  let autoAllocateChunkSize = underlyingByteSource.autoAllocateChunkSize;
  if (autoAllocateChunkSize !== undefined) {
    autoAllocateChunkSize = __intrinsic__toNumber(autoAllocateChunkSize);
    if (autoAllocateChunkSize <= 0 || autoAllocateChunkSize === Infinity || autoAllocateChunkSize === -Infinity)
      __intrinsic__throwRangeError("autoAllocateChunkSize value is negative or equal to positive or negative infinity");
  }
  __intrinsic__putByIdDirectPrivate(this, "autoAllocateChunkSize", autoAllocateChunkSize);
  __intrinsic__putByIdDirectPrivate(this, "pendingPullIntos", __intrinsic__createFIFO());

  const controller = this;
  __intrinsic__promiseInvokeOrNoopNoCatch(__intrinsic__getByIdDirectPrivate(controller, "underlyingByteSource"), "start", [controller]).__intrinsic__then(
    () => {
      __intrinsic__putByIdDirectPrivate(controller, "started", 1);
      (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "pulling"),"!$getByIdDirectPrivate(controller, \"pulling\")"):void 0);
      (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "pullAgain"),"!$getByIdDirectPrivate(controller, \"pullAgain\")"):void 0);
      __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
    },
    error => {
      if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable)
        __intrinsic__readableByteStreamControllerError(controller, error);
    },
  );

  __intrinsic__putByIdDirectPrivate(this, "cancel", __intrinsic__readableByteStreamControllerCancel);
  __intrinsic__putByIdDirectPrivate(this, "pull", __intrinsic__readableByteStreamControllerPull);

  return this;
}).$$capture_end$$;
