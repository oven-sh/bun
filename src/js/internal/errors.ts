const { SafeArrayIterator } = require("internal/primordials");

const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const ReflectApply = Reflect.$apply;
const ErrorCaptureStackTrace = Error.captureStackTrace;

function aggregateTwoErrors(innerError, outerError) {
  if (innerError && outerError && innerError !== outerError) {
    if (ArrayIsArray(outerError.errors)) {
      // If `outerError` is already an `AggregateError`.
      ArrayPrototypePush.$call(outerError.errors, innerError);
      return outerError;
    }
    const err = new AggregateError(new SafeArrayIterator([outerError, innerError]), outerError.message);
    err.code = outerError.code;
    return err;
  }
  return innerError || outerError;
}

/**
 * This function removes unnecessary frames from Node.js core errors.
 * @template {(...args: unknown[]) => unknown} T
 * @param {T} fn
 * @returns {T}
 */
function hideStackFrames(fn) {
  function wrappedFn(...args) {
    try {
      return ReflectApply(fn, this, args);
    } catch (error) {
      Error.stackTraceLimit && $isObject(error) && ErrorCaptureStackTrace(error, wrappedFn);
      throw error;
    }
  }
  wrappedFn.withoutStackTrace = fn;
  return wrappedFn;
}

export default {
  aggregateTwoErrors,
  hideStackFrames,
};
