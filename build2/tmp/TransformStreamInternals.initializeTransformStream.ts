// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/TransformStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,startPromise,writableHighWaterMark,writableSizeAlgorithm,readableHighWaterMark,readableSizeAlgorithm,) {  const startAlgorithm = () => {
    return startPromise;
  };
  const writeAlgorithm = chunk => {
    return __intrinsic__transformStreamDefaultSinkWriteAlgorithm(stream, chunk);
  };
  const abortAlgorithm = reason => {
    return __intrinsic__transformStreamDefaultSinkAbortAlgorithm(stream, reason);
  };
  const closeAlgorithm = () => {
    return __intrinsic__transformStreamDefaultSinkCloseAlgorithm(stream);
  };
  const writable = __intrinsic__createWritableStream(
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    writableHighWaterMark,
    writableSizeAlgorithm,
  );

  const pullAlgorithm = () => {
    return __intrinsic__transformStreamDefaultSourcePullAlgorithm(stream);
  };
  const cancelAlgorithm = reason => {
    __intrinsic__transformStreamErrorWritableAndUnblockWrite(stream, reason);
    return Promise.__intrinsic__resolve();
  };
  const underlyingSource = {};
  __intrinsic__putByIdDirectPrivate(underlyingSource, "start", startAlgorithm);
  __intrinsic__putByIdDirectPrivate(underlyingSource, "pull", pullAlgorithm);
  __intrinsic__putByIdDirectPrivate(underlyingSource, "cancel", cancelAlgorithm);
  const options = {};
  __intrinsic__putByIdDirectPrivate(options, "size", readableSizeAlgorithm);
  __intrinsic__putByIdDirectPrivate(options, "highWaterMark", readableHighWaterMark);
  const readable = new ReadableStream(underlyingSource, options);

  // The writable to expose to JS through writable getter.
  __intrinsic__putByIdDirectPrivate(stream, "writable", writable);
  // The writable to use for the actual transform algorithms.
  __intrinsic__putByIdDirectPrivate(stream, "internalWritable", __intrinsic__getInternalWritableStream(writable));

  __intrinsic__putByIdDirectPrivate(stream, "readable", readable);
  __intrinsic__putByIdDirectPrivate(stream, "backpressure", undefined);
  __intrinsic__putByIdDirectPrivate(stream, "backpressureChangePromise", undefined);

  __intrinsic__transformStreamSetBackpressure(stream, true);
  __intrinsic__putByIdDirectPrivate(stream, "controller", undefined);
}).$$capture_end$$;
