const { hideFromStack } = require("internal/shared");

const RegExpPrototypeExec = RegExp.prototype.exec;
const ArrayIsArray = Array.isArray;

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val) {
  return RegExpPrototypeExec.$call(tokenRegExp, val) !== null;
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
function validateLinkHeaderFormat(value, name) {
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

function validateLinkHeaderValue(hints) {
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

function validateString(value, name) {
  if (typeof value !== "string") throw $ERR_INVALID_ARG_TYPE(name, "string", value);
}

function validateFunction(value, name) {
  if (typeof value !== "function") throw $ERR_INVALID_ARG_TYPE(name, "function", value);
}

function validateBoolean(value, name) {
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

const validateInt32 = $newCppFunction("NodeValidator.cpp", "jsFunction_validateInt32", 0);
const validateUint32 = $newCppFunction("NodeValidator.cpp", "jsFunction_validateUint32", 0);

/**
 * The options check of `rmdir(path, { recursive: true })` in Node 16 to 24. It fills in the
 * `rm` defaults and pins `force` to false, because rmdir never honored it. Call it before the
 * path is read, so that a bad option wins over ENOENT. Returns the new options object.
 */
function validateRmdirRecursiveOptions(options) {
  options = { recursive: false, retryDelay: 100, maxRetries: 0, ...options, force: false };
  validateBoolean(options.recursive, "options.recursive");
  validateInt32(options.retryDelay, "options.retryDelay", 0);
  validateUint32(options.maxRetries, "options.maxRetries");
  return options;
}

hideFromStack(validateLinkHeaderValue);
hideFromStack(validateString, validateFunction, validateBoolean);
hideFromStack(getValidatedPath, getValidatedFsPath, throwIfNullBytesInFileName, validateRmdirRecursiveOptions);

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
  validateObject: $newCppFunction("NodeValidator.cpp", "jsFunction_validateObject", 2),
  validateLinkHeaderValue: validateLinkHeaderValue,
  checkIsHttpToken: checkIsHttpToken,
  /** `(value, name, min, max)` */
  validateInteger: $newCppFunction("NodeValidator.cpp", "jsFunction_validateInteger", 0),
  /** `(value, name, min, max)` */
  validateNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateNumber", 0),
  /** `(value, name)` */
  validateString,
  /** `(number, name)` */
  validateFiniteNumber: $newCppFunction("NodeValidator.cpp", "jsFunction_validateFiniteNumber", 0),
  /** `(number, name, lower, upper, def)` */
  checkRangesOrGetDefault: $newCppFunction("NodeValidator.cpp", "jsFunction_checkRangesOrGetDefault", 0),
  /** `(value, name)` */
  validateFunction,
  /** `(value, name)` */
  validateBoolean,
  /** `(port, name = 'Port', allowZero = true)` */
  validatePort: $newCppFunction("NodeValidator.cpp", "jsFunction_validatePort", 0),
  /** `(signal, name)` */
  validateAbortSignal: $newCppFunction("NodeValidator.cpp", "jsFunction_validateAbortSignal", 0),
  /** `(value, name, minLength = 0)` */
  validateArray: $newCppFunction("NodeValidator.cpp", "jsFunction_validateArray", 0),
  /** `(value, name, min = -2147483648, max = 2147483647)` */
  validateInt32,
  /** `(value, name, positive = false)` */
  validateUint32,
  /** `(data, encoding)` */
  validateEncoding: $newCppFunction("NodeValidator.cpp", "jsFunction_validateEncoding", 0),
  /** `(buffer, name = 'buffer')` */
  validateBuffer: $newCppFunction("NodeValidator.cpp", "jsFunction_validateBuffer", 0),
  /** `(value, name, oneOf)` */
  validateOneOf: $newCppFunction("NodeValidator.cpp", "jsFunction_validateOneOf", 0),
  isUint8Array: value => value instanceof Uint8Array,
  /** `(path)` — accepts a string or file URL, returns it resolved to an absolute path string */
  getValidatedPath,
  getValidatedFsPath,
  /** `(filename)` */
  throwIfNullBytesInFileName,
  /** `(options)`: returns the options with the defaults filled in */
  validateRmdirRecursiveOptions,
};
