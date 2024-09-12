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
  validateBounds: $newCppFunction("NodeValidator.cpp", "jsFunction_validateBounds", 0),

  validateInteger: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0),
};
