export default {
  /** `(value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER)` */
  validateInteger: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0),
  /** `(value, name, min = undefined, max)` */
  validateNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateNumber", 0),
  /** `(value, name)` */
  validateString: $newCppFunction("NodeValidator.cpp", "jsFunction_validateString", 0),
  /** `(number, name)` */
  validateFiniteNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateFiniteNumber", 0),
  /** `(number, name, lower, upper, def)` */
  checkRangesOrGetDefault: $newCppFunction("NodeValidator.cpp", "jsFunction_checkRangesOrGetDefault", 0),
  /** `(value, name)` */
  validateFunction: $newCppFunction("NodeValidator.cpp", "jsFunction_validateFunction", 0),
  /** `(value, name)` */
  validateBoolean: $newCppFunction("NodeValidator.cpp", "jsFunction_validateBoolean", 0),
  /** `(port, name = 'Port', allowZero = true)` */
  validatePort: $newCppFunction("NodeValidator.cpp", "jsFunction_validatePort", 0),
  /** `(signal, name)` */
  validateAbortSignal: $newCppFunction("NodeValidator.cpp", "jsFunction_validateAbortSignal", 0),
  /** `(value, name, minLength = 0)` */
  validateArray: $newCppFunction("NodeValidator.cpp", "jsFunction_validateArray", 0),
  /** `(value, name, min = -2147483648, max = 2147483647)` */
  validateInt32: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInt32", 0),
  /** `(value, name, positive = false)` */
  validateUint32: $newCppFunction("NodeValidator.cpp", "jsFunction_validateUint32", 0),
  /** `(signal, name = 'signal')` */
  validateSignalName: $newCppFunction("NodeValidator.cpp", "jsFunction_validateSignalName", 0),
  /** `(data, encoding)` */
  validateEncoding: $newCppFunction("NodeValidator.cpp", "jsFunction_validateEncoding", 0),
  /** `(value, name)` */
  validatePlainFunction: $newCppFunction("NodeValidator.cpp", "jsFunction_validatePlainFunction", 0),
  /** `(value, name)` */
  validateUndefined: $newCppFunction("NodeValidator.cpp", "jsFunction_validateUndefined", 0),
  /** `(buffer, name = 'buffer')` */
  validateBuffer: $newCppFunction("NodeValidator.cpp", "jsFunction_validateBuffer", 0),
};
