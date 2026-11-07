const { validateInteger, validateInt32 } = require("internal/validators");
const BigIntConstructor = BigInt;

function coerceReadLength(length) {
  // Node exposes V8's uncoded TypeError for mixing bigint and number operands.
  if (typeof length === "bigint") throw new TypeError("Cannot mix BigInt and other types, use explicit conversions");
  return length | 0;
}

// https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/utils.js
function validateReadPosition(position, length) {
  if (position == null) return;
  if (typeof position === "number") {
    validateInteger(position, "position", -1);
  } else if (typeof position === "bigint") {
    const max = 2n ** 63n - 1n - BigIntConstructor(length);
    if (position < -1n || position > max) {
      throw $ERR_OUT_OF_RANGE("position", `>= -1 && <= ${max}`, position);
    }
  } else {
    throw $ERR_INVALID_ARG_TYPE("position", ["integer", "bigint"], position);
  }
}

function validateReadRange(buffer, offset, length) {
  if (length === 0) return;
  const byteLength = buffer.byteLength;
  if (byteLength === 0) {
    throw $ERR_INVALID_ARG_VALUE("buffer", buffer, "is empty and cannot be written");
  }
  if (length < 0) throw $ERR_OUT_OF_RANGE("length", ">= 0", length);
  if (typeof length === "bigint") throw new TypeError("Cannot mix BigInt and other types, use explicit conversions");
  if (offset + length > byteLength) {
    throw $ERR_OUT_OF_RANGE("length", `<= ${byteLength - offset}`, length);
  }
}

function validateWriteRange(buffer, offset, length) {
  const byteLength = buffer.byteLength;
  if (offset > byteLength) throw $ERR_OUT_OF_RANGE("offset", `<= ${byteLength}`, offset);
  if (length > byteLength - offset) throw $ERR_OUT_OF_RANGE("length", `<= ${byteLength - offset}`, length);
  if (length < 0) throw $ERR_OUT_OF_RANGE("length", ">= 0", length);
  validateInt32(length, "length", 0);
}

export default { coerceReadLength, validateReadPosition, validateReadRange, validateWriteRange };
