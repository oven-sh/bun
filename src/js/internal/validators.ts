const { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE, ERR_BUFFER_OUT_OF_BOUNDS } = require("internal/errors");

export default {
  validateIntRange: function (value, name, min, max) {
    if (typeof value != "number") {
      throw ERR_INVALID_ARG_TYPE(name, "number", value);
    }
    if (value < min || value > max || value === Infinity || value === -Infinity) {
      throw ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
    }
    if (!Number.isInteger(value)) {
      throw ERR_OUT_OF_RANGE(name, "an integer", value);
    }
  },
  validateBounds: (value, name, min, buffer, width) => {
    if (typeof value != "number") {
      throw ERR_INVALID_ARG_TYPE(name, "number", value);
    }
    let max = buffer.byteLength - buffer.byteOffset - width;
    max = Math.max(min, max);
    if (value === Infinity || value === -Infinity) {
      throw ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
    }
    if (!Number.isInteger(value)) {
      throw ERR_OUT_OF_RANGE(name, "an integer", value);
    }
    if (buffer.byteOffset + value > buffer.byteLength || buffer.byteOffset + value + width - 1 > buffer.byteLength) {
      throw ERR_BUFFER_OUT_OF_BOUNDS();
    }
    if (value < min || value > max) {
      throw ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
    }
  },

  validateInteger: (value, name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => {
    max = Math.max(min, max);
    if (typeof value !== "number") throw ERR_INVALID_ARG_TYPE(name, "number", value);
    if (!Number.isInteger(value)) throw ERR_OUT_OF_RANGE(name, "an integer", value);
    if (value < min || value > max) throw ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
  },
};
