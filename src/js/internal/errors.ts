const { SafeArrayIterator } = require("internal/primordials");

const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;

class AbortError extends Error {
  constructor(message = "The operation was aborted", options?) {
    if (options !== undefined && typeof options !== "object") {
      throw $ERR_INVALID_ARG_TYPE("options", "object", options);
    }
    super(message, options);
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}

function aggregateTwoErrors(innerError, outerError) {
  if (innerError && outerError && innerError !== outerError) {
    if (ArrayIsArray(outerError.errors)) {
      // If `outerError` is already an `AggregateError`.
      ArrayPrototypePush(outerError.errors, innerError);
      return outerError;
    }
    const err = new AggregateError(new SafeArrayIterator([outerError, innerError]), outerError.message);
    err.code = outerError.code;
    return err;
  }
  return innerError || outerError;
}

export default {
  AbortError,
  aggregateTwoErrors,
  ERR_OUT_OF_RANGE: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_OUT_OF_RANGE", 3),
  ERR_INVALID_PROTOCOL: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_INVALID_PROTOCOL", 0),
  ERR_BROTLI_INVALID_PARAM: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_BROTLI_INVALID_PARAM", 0),
  ERR_BUFFER_TOO_LARGE: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_BUFFER_TOO_LARGE", 0),
  ERR_UNHANDLED_ERROR: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_UNHANDLED_ERROR", 0),
};
