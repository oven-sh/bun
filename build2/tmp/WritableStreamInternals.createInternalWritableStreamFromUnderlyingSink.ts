// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(underlyingSink,strategy) {  const stream = {};

  if (underlyingSink === undefined) underlyingSink = {};

  if (strategy === undefined) strategy = {};

  if (!__intrinsic__isObject(underlyingSink)) __intrinsic__throwTypeError("WritableStream constructor takes an object as first argument");

  if ("type" in underlyingSink) __intrinsic__throwRangeError("Invalid type is specified");

  const sizeAlgorithm = __intrinsic__extractSizeAlgorithm(strategy);
  const highWaterMark = __intrinsic__extractHighWaterMark(strategy, 1);

  const underlyingSinkDict = {};
  if ("start" in underlyingSink) {
    underlyingSinkDict["start"] = underlyingSink["start"];
    if (typeof underlyingSinkDict["start"] !== "function") __intrinsic__throwTypeError("underlyingSink.start should be a function");
  }
  if ("write" in underlyingSink) {
    underlyingSinkDict["write"] = underlyingSink["write"];
    if (typeof underlyingSinkDict["write"] !== "function") __intrinsic__throwTypeError("underlyingSink.write should be a function");
  }
  if ("close" in underlyingSink) {
    underlyingSinkDict["close"] = underlyingSink["close"];
    if (typeof underlyingSinkDict["close"] !== "function") __intrinsic__throwTypeError("underlyingSink.close should be a function");
  }
  if ("abort" in underlyingSink) {
    underlyingSinkDict["abort"] = underlyingSink["abort"];
    if (typeof underlyingSinkDict["abort"] !== "function") __intrinsic__throwTypeError("underlyingSink.abort should be a function");
  }

  __intrinsic__initializeWritableStreamSlots(stream, underlyingSink);
  __intrinsic__setUpWritableStreamDefaultControllerFromUnderlyingSink(
    stream,
    underlyingSink,
    underlyingSinkDict,
    highWaterMark,
    sizeAlgorithm,
  );

  return stream;
}).$$capture_end$$;
