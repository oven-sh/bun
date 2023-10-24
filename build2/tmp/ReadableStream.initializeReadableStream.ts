// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(underlyingSource,strategy,) {  if (underlyingSource === undefined)
    underlyingSource = { __intrinsic__bunNativeType: 0, __intrinsic__bunNativePtr: 0, __intrinsic__lazy: false } as UnderlyingSource;
  if (strategy === undefined) strategy = {};

  if (!__intrinsic__isObject(underlyingSource)) __intrinsic__throwTypeError("ReadableStream constructor takes an object as first argument");

  if (strategy !== undefined && !__intrinsic__isObject(strategy))
    __intrinsic__throwTypeError("ReadableStream constructor takes an object as second argument, if any");

  __intrinsic__putByIdDirectPrivate(this, "state", __intrinsic__streamReadable);

  __intrinsic__putByIdDirectPrivate(this, "reader", undefined);

  __intrinsic__putByIdDirectPrivate(this, "storedError", undefined);

  __intrinsic__putByIdDirectPrivate(this, "disturbed", false);

  // Initialized with null value to enable distinction with undefined case.
  __intrinsic__putByIdDirectPrivate(this, "readableStreamController", null);
  __intrinsic__putByIdDirectPrivate(this, "bunNativeType", __intrinsic__getByIdDirectPrivate(underlyingSource, "bunNativeType") ?? 0);
  __intrinsic__putByIdDirectPrivate(this, "bunNativePtr", __intrinsic__getByIdDirectPrivate(underlyingSource, "bunNativePtr") ?? 0);

  __intrinsic__putByIdDirectPrivate(this, "asyncContext", __intrinsic__getInternalField(__intrinsic__asyncContext, 0));

  const isDirect = underlyingSource.type === "direct";
  // direct streams are always lazy
  const isUnderlyingSourceLazy = !!underlyingSource.__intrinsic__lazy;
  const isLazy = isDirect || isUnderlyingSourceLazy;

  // FIXME: We should introduce https://streams.spec.whatwg.org/#create-readable-stream.
  // For now, we emulate this with underlyingSource with private properties.
  if (__intrinsic__getByIdDirectPrivate(underlyingSource, "pull") !== undefined && !isLazy) {
    const size = __intrinsic__getByIdDirectPrivate(strategy, "size");
    const highWaterMark = __intrinsic__getByIdDirectPrivate(strategy, "highWaterMark");
    __intrinsic__putByIdDirectPrivate(this, "highWaterMark", highWaterMark);
    __intrinsic__putByIdDirectPrivate(this, "underlyingSource", undefined);
    __intrinsic__setupReadableStreamDefaultController(
      this,
      underlyingSource,
      size,
      highWaterMark !== undefined ? highWaterMark : 1,
      __intrinsic__getByIdDirectPrivate(underlyingSource, "start"),
      __intrinsic__getByIdDirectPrivate(underlyingSource, "pull"),
      __intrinsic__getByIdDirectPrivate(underlyingSource, "cancel"),
    );

    return this;
  }
  if (isDirect) {
    __intrinsic__putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
    __intrinsic__putByIdDirectPrivate(this, "highWaterMark", __intrinsic__getByIdDirectPrivate(strategy, "highWaterMark"));
    __intrinsic__putByIdDirectPrivate(this, "start", () => __intrinsic__createReadableStreamController(this, underlyingSource, strategy));
  } else if (isLazy) {
    const autoAllocateChunkSize = underlyingSource.autoAllocateChunkSize;
    __intrinsic__putByIdDirectPrivate(this, "highWaterMark", undefined);
    __intrinsic__putByIdDirectPrivate(this, "underlyingSource", undefined);
    __intrinsic__putByIdDirectPrivate(
      this,
      "highWaterMark",
      autoAllocateChunkSize || __intrinsic__getByIdDirectPrivate(strategy, "highWaterMark"),
    );

    __intrinsic__putByIdDirectPrivate(this, "start", () => {
      const instance = __intrinsic__lazyLoadStream(this, autoAllocateChunkSize);
      if (instance) {
        __intrinsic__createReadableStreamController(this, instance, strategy);
      }
    });
  } else {
    __intrinsic__putByIdDirectPrivate(this, "underlyingSource", undefined);
    __intrinsic__putByIdDirectPrivate(this, "highWaterMark", __intrinsic__getByIdDirectPrivate(strategy, "highWaterMark"));
    __intrinsic__putByIdDirectPrivate(this, "start", undefined);
    __intrinsic__createReadableStreamController(this, underlyingSource, strategy);
  }

  return this;
}).$$capture_end$$;
