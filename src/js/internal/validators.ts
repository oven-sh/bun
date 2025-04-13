const { hideFromStack } = require("internal/shared");

const RegExpPrototypeExec = RegExp.prototype.exec;

let tokenRegExp: RegExp | undefined;

/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val) {
  return RegExpPrototypeExec.$call((tokenRegExp ??= /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/), val) !== null;
}

/*
  The rules for the Link header field are described here:
  https://www.rfc-editor.org/rfc/rfc8288.html#section-3

  This regex validates any string surrounded by angle brackets
  (not necessarily a valid URI reference) followed by zero or more
  link-params separated by semicolons.
*/
let linkValueRegExp: RegExp | undefined;
function validateLinkHeaderFormat(value, name) {
  if (
    typeof value === "undefined" ||
    !RegExpPrototypeExec.$call((linkValueRegExp ??= /^(?:<[^>]*>)(?:\s*;\s*[^;"\s]+(?:=(")?[^;"\s]*\1)?)*$/), value)
  ) {
    throw $ERR_INVALID_ARG_VALUE(
      name,
      value,
      `must be an array or string of format "</styles.css>; rel=preload; as=style"`,
    );
  }
}

function validateLinkHeaderValue(hints) {
  if (typeof hints === "string") {
    validateLinkHeaderFormat(hints, "hints");
    return hints;
  } else if ($isArray(hints)) {
    const hintsLength = hints.length;
    let result = "";

    if (hintsLength === 0) {
      return result;
    }

    for (let i = 0; i < hintsLength; i++) {
      const link = hints[i];
      validateLinkHeaderFormat(link, "hints");
      result += link;

      if (i !== hintsLength - 1) {
        result += ", ";
      }
    }

    return result;
  }

  throw $ERR_INVALID_ARG_VALUE(
    "hints",
    hints,
    `must be an array or string of format "</styles.css>; rel=preload; as=style"`,
  );
}
hideFromStack(validateLinkHeaderValue);

// We want to let the JIT remove the most trivial checks.
const validateObjectInternal = $newCppFunction("NodeValidator.cpp", "jsFunction_validateObject", 2);
const validateNumberInternal = $newCppFunction("NodeValidator.cpp", "jsFunction_validateNumber", 0);
const validateStringInternal = $newCppFunction("NodeValidator.cpp", "jsFunction_validateString", 0);
const validateFunctionInternal = $newCppFunction("NodeValidator.cpp", "jsFunction_validateFunction", 0);
const validateBooleanInternal = $newCppFunction("NodeValidator.cpp", "jsFunction_validateBoolean", 0);
const validateArrayInternal = $newCppFunction("NodeValidator.cpp", "jsFunction_validateArray", 0);

export default {
  /** (value, name) */
  validateObject: function validateObject(value, name) {
    if (!$isObject(value)) {
      return validateObjectInternal.$apply(this, arguments);
    }
  },

  /** `(value, name, min, max)` */
  validateInteger: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0),
  /** `(value, name, min, max)` */
  validateNumber: function validateNumber(value, name, min, max) {
    if (typeof value !== "number") {
      return validateNumberInternal.$apply(this, arguments);
    }
  },
  /** `(value, name)` */
  validateString: function validateString(value, name) {
    if (typeof value !== "string") {
      return validateStringInternal.$apply(this, arguments);
    }
  },
  /** `(number, name)` */
  validateFiniteNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateFiniteNumber", 0),
  /** `(number, name, lower, upper, def)` */
  checkRangesOrGetDefault: $newCppFunction("NodeValidator.cpp", "jsFunction_checkRangesOrGetDefault", 0),
  /** `(value, name)` */
  validateFunction: function validateFunction(value, name) {
    if (typeof value !== "function") {
      return validateFunctionInternal.$apply(this, arguments);
    }
  },
  /** `(value, name)` */
  validateBoolean: function validateBoolean(value, name) {
    if (typeof value !== "boolean") {
      return validateBooleanInternal.$apply(this, arguments);
    }
  },
  validatePort: $newCppFunction("NodeValidator.cpp", "jsFunction_validatePort", 0),
  /** `(signal, name)` */
  validateAbortSignal: $newCppFunction("NodeValidator.cpp", "jsFunction_validateAbortSignal", 0),
  /** `(value, name, minLength = 0)` */
  validateArray: function validateArray(value, name, minLength) {
    if (!$isArray(value) || (typeof minLength === "number" && value.length < minLength)) {
      return validateArrayInternal.$apply(this, arguments);
    }
  },
  /** `(value, name, min = -2147483648, max = 2147483647)` */
  validateInt32: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInt32", 0),
  /** `(value, name, positive = false)` */
  validateUint32: $newCppFunction("NodeValidator.cpp", "jsFunction_validateUint32", 0),
  /** `(signal, name = 'signal')` */
  validateSignalName: $newCppFunction("NodeValidator.cpp", "jsFunction_validateSignalName", 0),
  /** `(data, encoding)` */
  validateEncoding: $newCppFunction("NodeValidator.cpp", "jsFunction_validateEncoding", 0),

  // ** UNUSED **
  /** `(value, name)` */
  // validatePlainFunction: $newCppFunction("NodeValidator.cpp", "jsFunction_validatePlainFunction", 0),
  // /** `(value, name)` */
  // validateUndefined: function validateUndefined(value, name) {
  //   if (typeof value !== "undefined") {
  //     return validateUndefinedInternal.$apply(this, arguments);
  //   }
  // },
  /** `(buffer, name = 'buffer')` */
  validateBuffer: $newCppFunction("NodeValidator.cpp", "jsFunction_validateBuffer", 0),
  /** `(value, name, oneOf)` */
  validateOneOf: $newCppFunction("NodeValidator.cpp", "jsFunction_validateOneOf", 0),
  validateLinkHeaderValue: validateLinkHeaderValue,
  checkIsHttpToken: checkIsHttpToken,
};
