// @ts-check
const { hideFromStack } = require("internal/shared");

const RegExpPrototypeExec = RegExp.prototype.exec;
const ArrayIsArray = Array.isArray;
const NumberIsInteger = Number.isInteger;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val): boolean {
  if (typeof val !== "string") return RegExpPrototypeExec.$call(tokenRegExp, val) !== null;
  const length = val.length;
  if (length === 0) return false;
  for (let i = 0; i < length; i++) {
    const code = StringPrototypeCharCodeAt.$call(val, i);
    const bits = code < 64 ? (code < 32 ? 0 : 0x03ff6cfa) : code < 96 ? 0xc7fffffe : code < 128 ? 0x57ffffff : 0;
    if (((bits >>> (code & 31)) & 1) === 0) return false;
  }
  return true;
}

/*
  The rules for the Link header field are described here:
  https://www.rfc-editor.org/rfc/rfc8288.html#section-3

  This regex validates any string surrounded by angle brackets
  (not necessarily a valid URI reference) followed by zero or more
  link-params separated by semicolons.

  The parameter name excludes "=" so it cannot overlap with the optional
  "=value" suffix; otherwise inputs like "<>;a=b;a=b;...;a=b " trigger
  catastrophic backtracking.
*/
const linkValueRegExp = /^(?:<[^>]*>)(?:\s*;\s*[^;"\s=]+(?:=(")?[^;"\s]*\1)?)*$/;
const linkValueForbiddenCharsRegExp = /[\r\n]/;
function validateLinkHeaderFormat(value, name: string): void {
  if (
    typeof value === "undefined" ||
    !RegExpPrototypeExec.$call(linkValueRegExp, value) ||
    RegExpPrototypeExec.$call(linkValueForbiddenCharsRegExp, value) !== null
  ) {
    throw $ERR_INVALID_ARG_VALUE(
      name,
      value,
      `must be an array or string of format "</styles.css>; rel=preload; as=style"`,
    );
  }
}

function validateLinkHeaderValue(hints: unknown): string {
  if (typeof hints === "string") {
    validateLinkHeaderFormat(hints, "hints");
    return hints;
  } else if (ArrayIsArray(hints)) {
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

function validateString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw $ERR_INVALID_ARG_TYPE(name, "string", value);
}

function validateFunction(value: unknown, name: string): asserts value is Function {
  if (typeof value !== "function") throw $ERR_INVALID_ARG_TYPE(name, "function", value);
}

function validateBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") throw $ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

/** Validate a string-or-URL path and return it resolved to an absolute path string. */
function getValidatedPath(p: any) {
  if (p instanceof URL) return Bun.fileURLToPath(p as URL);
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string or URL", p);
  if (p.startsWith("file:")) return Bun.fileURLToPath(p);
  return require("node:path").resolve(p);
}

function throwIfNullBytesInFileName(filename: string) {
  if (filename.indexOf("\u0000") !== -1) {
    throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", filename);
  }
}

/**
 * node's fs getValidatedPath (lib/internal/fs/utils.js): converts URL
 * *instances* via fileURLToPath, accepts strings and Buffers as-is (no
 * path.resolve, no "file:"-prefix string sniffing), and rejects null bytes.
 */
function getValidatedFsPath(p: any, propName: string = "path") {
  if (p instanceof URL) p = Bun.fileURLToPath(p);
  if (typeof p === "string") {
    if (p.indexOf("\u0000") !== -1) {
      throw $ERR_INVALID_ARG_VALUE(propName, p, "must be a string, Uint8Array, or URL without null bytes");
    }
    return p;
  }
  if (p instanceof Uint8Array) {
    if (p.indexOf(0) !== -1) {
      throw $ERR_INVALID_ARG_VALUE(propName, p, "must be a string, Uint8Array, or URL without null bytes");
    }
    return p;
  }
  throw $ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], p);
}

const validateObjectSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateObject", 2);
const validateIntegerSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0);
const validateNumberSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateNumber", 0);
const validateFiniteNumberSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateFiniteNumber", 0);
const checkRangesOrGetDefaultSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_checkRangesOrGetDefault", 0);
const validatePortSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validatePort", 0);
const validateAbortSignalSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateAbortSignal", 0);
const validateArraySlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateArray", 0);
const validateInt32Slow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateInt32", 0);
const validateUint32Slow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateUint32", 0);
const validateEncoding = $newCppFunction("NodeValidator.cpp", "jsFunction_validateEncoding", 0);
const validateBufferSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateBuffer", 0);
const validateOneOfSlow = $newCppFunction("NodeValidator.cpp", "jsFunction_validateOneOf", 0);

function validateObject(value: unknown, name: string, options?: unknown): asserts value is object {
  if (typeof value === "object" && value !== null && !$isProxyObject(value) && !ArrayIsArray(value)) return;
  return validateObjectSlow(value, name, options);
}

function validateInteger(value: unknown, name: string, min?: unknown, max?: unknown): asserts value is number {
  if (
    typeof value === "number" &&
    NumberIsInteger(value) &&
    (min === undefined ? value >= -9007199254740991 : typeof min === "number" && value >= min) &&
    (max === undefined ? value <= 9007199254740991 : typeof max === "number" && value <= max)
  )
    return;
  return validateIntegerSlow(value, name, min, max);
}

function validateNumber(value: unknown, name: string, min?: unknown, max?: unknown): asserts value is number {
  if (
    typeof value === "number" &&
    (min === undefined || (typeof min === "number" && value >= min)) &&
    (max === undefined || (typeof max === "number" && value <= max))
  )
    return;
  return validateNumberSlow(value, name, min, max);
}

function validateFiniteNumber(number: unknown, name: string): boolean {
  if (number === undefined) return false;
  if (typeof number === "number" && number - number === 0) return true;
  return validateFiniteNumberSlow(number, name);
}

function checkRangesOrGetDefault(number: unknown, name: string, lower: unknown, upper: unknown, def?: unknown): unknown {
  if (number === undefined) return def;
  if (
    typeof number === "number" &&
    typeof lower === "number" &&
    typeof upper === "number" &&
    number >= lower &&
    number <= upper &&
    number - number === 0
  )
    return number;
  return checkRangesOrGetDefaultSlow(number, name, lower, upper, def);
}

function validatePort(port: unknown, name?: string, allowZero?: unknown): unknown {
  if (typeof port === "number" && port > 0 && port <= 0xffff && NumberIsInteger(port)) return port;
  return validatePortSlow(port, name, allowZero);
}

function validateAbortSignal(signal: unknown, name: string): void {
  if (signal === undefined) return;
  return validateAbortSignalSlow(signal, name);
}

function validateArray(value: unknown, name: string, minLength?: unknown): asserts value is object {
  if (
    $isJSArray(value) &&
    (minLength === undefined || (typeof minLength === "number" && (value as any).length >= minLength))
  )
    return;
  return validateArraySlow(value, name, minLength);
}

function validateInt32(value: unknown, name: string, min?: unknown, max?: unknown): asserts value is number {
  if (
    typeof value === "number" &&
    (value | 0) === value &&
    (min === undefined || (typeof min === "number" && value >= min)) &&
    (max === undefined || (typeof max === "number" && value <= max))
  )
    return;
  return validateInt32Slow(value, name, min, max);
}

function validateUint32(value: unknown, name: string, positive?: unknown): asserts value is number {
  if (typeof value === "number" && value >>> 0 === value && (value !== 0 || !positive)) return;
  return validateUint32Slow(value, name, positive);
}

function validateBuffer(buffer: unknown, name?: string): void {
  if ($isTypedArrayView(buffer)) return;
  return validateBufferSlow(buffer, name);
}

function validateOneOf(value: unknown, name: string, oneOf: any): void {
  const list: unknown = oneOf;
  if (typeof value === "string" && $isJSArray(list)) {
    for (let i = 0; i < oneOf.length; i++) {
      if (oneOf[i] === value) return;
    }
  }
  return validateOneOfSlow(value, name, oneOf);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

hideFromStack(validateLinkHeaderValue);
hideFromStack(validateString, validateFunction, validateBoolean);
hideFromStack(getValidatedPath, getValidatedFsPath, throwIfNullBytesInFileName);
hideFromStack(validateObject, validateInteger, validateNumber, validateFiniteNumber, checkRangesOrGetDefault);
hideFromStack(validatePort, validateAbortSignal, validateArray, validateInt32, validateUint32, validateBuffer);
hideFromStack(validateOneOf);

// Must match jsFunction_validateObject in NodeValidator.cpp. The values are node's:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/validators.js#L224-L227
const kValidateObjectNone = 0;
const kValidateObjectAllowNullable = 1 << 0;
const kValidateObjectAllowArray = 1 << 1;
const kValidateObjectAllowFunction = 1 << 2;

export default {
  kValidateObjectNone,
  kValidateObjectAllowNullable,
  kValidateObjectAllowArray,
  kValidateObjectAllowFunction,
  /** (value, name[, kValidateObject* flags]) */
  validateObject,
  validateLinkHeaderValue: validateLinkHeaderValue,
  checkIsHttpToken: checkIsHttpToken,
  /** `(value, name, min, max)` */
  validateInteger,
  /** `(value, name, min, max)` */
  validateNumber,
  /** `(value, name)` */
  validateString,
  /** `(number, name)` */
  validateFiniteNumber,
  /** `(number, name, lower, upper, def)` */
  checkRangesOrGetDefault,
  /** `(value, name)` */
  validateFunction,
  /** `(value, name)` */
  validateBoolean,
  /** `(port, name = 'Port', allowZero = true)` */
  validatePort,
  /** `(signal, name)` */
  validateAbortSignal,
  /** `(value, name, minLength = 0)` */
  validateArray,
  /** `(value, name, min = -2147483648, max = 2147483647)` */
  validateInt32,
  /** `(value, name, positive = false)` */
  validateUint32,
  /** `(data, encoding)` */
  validateEncoding,
  /** `(buffer, name = 'buffer')` */
  validateBuffer,
  /** `(value, name, oneOf)` */
  validateOneOf,
  isUint8Array,
  /** `(path)` — accepts a string or file URL, returns it resolved to an absolute path string */
  getValidatedPath,
  getValidatedFsPath,
  /** `(filename)` */
  throwIfNullBytesInFileName,
};
