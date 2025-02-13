const { validateNumber, validateInteger } = require("internal/validators");

function boundsError(value, length, type?) {
  if (Math.floor(value) !== value) {
    validateNumber(value, type);
    throw $ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
  }
  if (length < 0) throw $ERR_BUFFER_OUT_OF_BOUNDS();
  throw $ERR_OUT_OF_RANGE(type || "offset", `>= ${type ? 1 : 0} and <= ${length}`, value);
}

export default {
  boundsError,
};
