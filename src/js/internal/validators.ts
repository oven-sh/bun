const { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } = require("internal/errors");

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

  validateInteger: (value, name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => {
    if (typeof value !== "number") throw ERR_INVALID_ARG_TYPE(name, "number", value);
    if (!Number.isInteger(value)) throw ERR_OUT_OF_RANGE(name, "an integer", value);
    if (value < min || value > max) throw ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
  },
};
