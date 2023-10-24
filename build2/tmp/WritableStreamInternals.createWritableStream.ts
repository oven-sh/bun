// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(startAlgorithm,writeAlgorithm,closeAlgorithm,abortAlgorithm,highWaterMark,sizeAlgorithm,) {  (IS_BUN_DEVELOPMENT?$assert(typeof highWaterMark === "number" && highWaterMark === highWaterMark && highWaterMark >= 0,"typeof highWaterMark === \"number\" && highWaterMark === highWaterMark && highWaterMark >= 0"):void 0);

  const internalStream = {};
  __intrinsic__initializeWritableStreamSlots(internalStream, {});
  const controller = new WritableStreamDefaultController();

  __intrinsic__setUpWritableStreamDefaultController(
    internalStream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );

  return __intrinsic__createWritableStreamFromInternal(internalStream);
}).$$capture_end$$;
