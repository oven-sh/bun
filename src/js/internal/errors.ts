const { SafeArrayIterator } = require("internal/primordials");

const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;

function aggregateTwoErrors(innerError: Error | undefined, outerError: Error & { errors?: Error[] }) {
  if (innerError && outerError && innerError !== outerError) {
    const outerErrors = outerError.errors;
    if (ArrayIsArray(outerErrors)) {
      // If `outerError` is already an `AggregateError`.
      ArrayPrototypePush.$call(outerErrors, innerError);
      return outerError;
    }
    const err = new AggregateError(new SafeArrayIterator([outerError, innerError]), outerError.message);
    err.code = outerError.code;
    return err;
  }
  return innerError || outerError;
}

export default {
  aggregateTwoErrors,
};
