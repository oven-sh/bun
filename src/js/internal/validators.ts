export default {
  validateInteger: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0),
  validateNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateNumber", 0),
  validateString: $newCppFunction("NodeValidator.cpp", "jsFunction_validateString", 0),
  validateFiniteNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateFiniteNumber", 0),
  checkRangesOrGetDefault: $newCppFunction("NodeValidator.cpp", "jsFunction_checkRangesOrGetDefault", 0),
  validateFunction: $newCppFunction("NodeValidator.cpp", "jsFunction_validateFunction", 0),
};
