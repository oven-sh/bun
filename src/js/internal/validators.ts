const { hideFromStack } = require("internal/shared");

const RegExpPrototypeExec = RegExp.prototype.exec;
const ArrayIsArray = Array.isArray;

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
 * Verifies that the given val is a valid HTTP token
 * per the rules defined in RFC 7230
 * See https://tools.ietf.org/html/rfc7230#section-3.2.6
 */
function checkIsHttpToken(val: string): boolean {
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
function validateLinkHeaderFormat(value: string, name: string): void {
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

function validateString(value: unknown, name: string): void {
  if (typeof value !== "string") throw $ERR_INVALID_ARG_TYPE(name, "string", value);
}

function validateFunction(value: unknown, name: string): void {
  if (typeof value !== "function") throw $ERR_INVALID_ARG_TYPE(name, "function", value);
}

function validateBoolean(value: unknown, name: string): void {
  if (typeof value !== "boolean") throw $ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

/** Validate a string-or-URL path and return it resolved to an absolute path string. */
function getValidatedPath(p: string | URL): string {
  if (p instanceof URL) return Bun.fileURLToPath(p);
  if (typeof p !== "string") throw $ERR_INVALID_ARG_TYPE("path", "string or URL", p);
  if (p.startsWith("file:")) return Bun.fileURLToPath(p);
  return require("node:path").resolve(p);
}

function throwIfNullBytesInFileName(filename: string): void {
  if (filename.indexOf("\u0000") !== -1) {
    throw $ERR_INVALID_ARG_VALUE("path", "string without null bytes", filename);
  }
}

/**
 * node's fs getValidatedPath (lib/internal/fs/utils.js): converts URL
 * *instances* via fileURLToPath, accepts strings and Buffers as-is (no
 * path.resolve, no "file:"-prefix string sniffing), and rejects null bytes.
 */
function getValidatedFsPath(p: string | Uint8Array | URL, propName: string = "path"): string | Uint8Array {
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

hideFromStack(validateLinkHeaderValue);
hideFromStack(validateString, validateFunction, validateBoolean);
hideFromStack(getValidatedPath, getValidatedFsPath, throwIfNullBytesInFileName);

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
  validateObject: $bindgen("node_validators.bind.ts", "validateObject") as (
    value: unknown,
    name: string,
    options?: number,
  ) => void,
  validateLinkHeaderValue: validateLinkHeaderValue,
  checkIsHttpToken: checkIsHttpToken,
  /** `(value, name, min, max)` */
  validateInteger: $bindgen("node_validators.bind.ts", "validateInteger") as (
    value: unknown,
    name: string,
    min?: number,
    max?: number,
  ) => void,
  /** `(value, name, min, max)` */
  validateNumber: $bindgen("node_validators.bind.ts", "validateNumber") as (
    value: unknown,
    name: string,
    min?: number,
    max?: number,
  ) => void,
  /** `(value, name)` */
  validateString,
  /** `(number, name)` */
  validateFiniteNumber: $bindgen("node_validators.bind.ts", "validateFiniteNumber") as (
    number: unknown,
    name: string,
  ) => boolean,
  /** `(number, name, lower, upper, def)` */
  checkRangesOrGetDefault: $bindgen("node_validators.bind.ts", "checkRangesOrGetDefault") as {
    (number: unknown, name: string, lower: number, upper: number): number | undefined;
    <Default>(number: unknown, name: string, lower: number, upper: number, def: Default): number | Default;
  },
  /** `(value, name)` */
  validateFunction,
  /** `(value, name)` */
  validateBoolean,
  /** `(port, name = 'Port', allowZero = true)` */
  validatePort: $bindgen("node_validators.bind.ts", "validatePort") as (
    port: unknown,
    name?: string,
    allowZero?: boolean,
  ) => number,
  /** `(signal, name)` */
  validateAbortSignal: $bindgen("node_validators.bind.ts", "validateAbortSignal") as (
    signal: unknown,
    name: string,
  ) => void,
  /** `(value, name, minLength = 0)` */
  validateArray: $bindgen("node_validators.bind.ts", "validateArray") as (
    value: unknown,
    name: string,
    minLength?: number,
  ) => void,
  /** `(value, name, min = -2147483648, max = 2147483647)` */
  validateInt32: $bindgen("node_validators.bind.ts", "validateInt32") as (
    value: unknown,
    name: string,
    min?: number,
    max?: number,
  ) => void,
  /** `(value, name, positive = false)` */
  validateUint32: $bindgen("node_validators.bind.ts", "validateUint32") as (
    value: unknown,
    name: string,
    positive?: boolean,
  ) => void,
  /** `(data, encoding)` */
  validateEncoding: $bindgen("node_validators.bind.ts", "validateEncoding") as (
    data: unknown,
    encoding: unknown,
  ) => void,
  /** `(buffer, name = 'buffer')` */
  validateBuffer: $bindgen("node_validators.bind.ts", "validateBuffer") as (buffer: unknown, name?: string) => void,
  /** `(value, name, oneOf)` */
  validateOneOf: $bindgen("node_validators.bind.ts", "validateOneOf") as (
    value: unknown,
    name: string,
    oneOf: readonly unknown[],
  ) => void,
  isUint8Array: (value: unknown): value is Uint8Array => value instanceof Uint8Array,
  /** `(path)` — accepts a string or file URL, returns it resolved to an absolute path string */
  getValidatedPath,
  getValidatedFsPath,
  /** `(filename)` */
  throwIfNullBytesInFileName,
};
