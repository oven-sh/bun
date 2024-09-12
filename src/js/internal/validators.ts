const { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE, ERR_BUFFER_OUT_OF_BOUNDS } = require("internal/errors");

export default {
  validateIntRange: $newCppFunction("NodeValidator.cpp", "jsFunction_validateIntRange", 0),
  validateBounds: $newCppFunction("NodeValidator.cpp", "jsFunction_validateBounds", 0),

  validateInteger: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0),
};
