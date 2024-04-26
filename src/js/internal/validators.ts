const NumberIsInteger = Number.isInteger;

const { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } = require("./codes");

export function validateBoolean(value, name) {
  if (typeof value !== "boolean") throw ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

export function validateInt32(value, name, min = -2147483648, max = 2147483647) {
  // The defaults for min and max correspond to the limits of 32-bit integers.
  if (typeof value !== "number") {
    throw ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!NumberIsInteger(value)) {
    throw ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  if (value < min || value > max) {
    throw ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
}
