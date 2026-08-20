const { validateNumber } = require("internal/validators");

function boundsError(value, length, type?) {
  if (Math.floor(value) !== value) {
    validateNumber(value, type);
    throw $ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
  }
  if (length < 0) throw $ERR_BUFFER_OUT_OF_BOUNDS();
  throw $ERR_OUT_OF_RANGE(type || "offset", `>= ${type ? 1 : 0} and <= ${length}`, value);
}

function checkBounds(buf, offset, byteLength) {
  validateNumber(offset, "offset");
  // Numeric bound check, not `buf[offset] === undefined`: JSC's TypedArray
  // indexed get returns undefined for index 2**32 - 1 even when in range,
  // which would misreport a valid last-byte offset on a kMaxLength buffer.
  const last = buf.length - byteLength;
  if (Math.floor(offset) !== offset || !(offset >= 0 && offset <= last)) boundsError(offset, last);
}

function checkInt(buf, value, offset, min, max, byteLength) {
  if (value > max || value < min) {
    const n = typeof min === "bigint" ? "n" : "";
    let range;
    if (byteLength > 4) {
      if (min === 0 || min === 0n) {
        range = `>= 0${n} and < 2${n} ** ${byteLength * 8}${n}`;
      } else {
        range = `>= -(2${n} ** ${byteLength * 8 - 1}${n}) and ` + `< 2${n} ** ${byteLength * 8 - 1}${n}`;
      }
    } else {
      range = `>= ${min}${n} and <= ${max}${n}`;
    }
    throw $ERR_OUT_OF_RANGE("value", range, value);
  }
  checkBounds(buf, offset, byteLength);
}

function writeU_Int8(buf, value, offset, min, max) {
  // `checkInt()` can not be used here because it checks two entries.
  validateNumber(offset, "offset");
  if (value > max || value < min) {
    throw $ERR_OUT_OF_RANGE("value", `>= ${min} and <= ${max}`, value);
  }
  const last = buf.length - 1;
  if (Math.floor(offset) !== offset || !(offset >= 0 && offset <= last)) boundsError(offset, last);
}

export default {
  boundsError,
  checkBounds,
  checkInt,
  writeU_Int8,
};
