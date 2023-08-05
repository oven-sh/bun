const {
  ERR_CHILD_PROCESS_STDIO_MAXBUFFER,
  ERR_CHILD_PROCESS_IPC_REQUIRED,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_OPT_VALUE,
  ERR_OUT_OF_RANGE,
  ERR_UNKNOWN_SIGNAL,
} = require("./errors");

function validateMaxBuffer(maxBuffer) {
  if (maxBuffer != null && !(typeof maxBuffer === "number" && maxBuffer >= 0)) {
    throw new ERR_OUT_OF_RANGE("options.maxBuffer", "a positive number", maxBuffer);
  }
}

function validateArgumentNullCheck(arg, propName) {
  if (typeof arg === "string" && StringPrototypeIncludes.call(arg, "\u0000")) {
    throw new ERR_INVALID_ARG_VALUE(propName, arg, "must be a string without null bytes");
  }
}

function validateArgumentsNullCheck(args, propName) {
  for (let i = 0; i < args.length; ++i) {
    validateArgumentNullCheck(args[i], `${propName}[${i}]`);
  }
}

function validateTimeout(timeout) {
  if (timeout != null && !(NumberIsInteger(timeout) && timeout >= 0)) {
    throw new ERR_OUT_OF_RANGE("timeout", "an unsigned integer", timeout);
  }
}

function validateBoolean(value, name) {
  if (typeof value !== "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

/**
 * @callback validateString
 * @param {*} value
 * @param {string} name
 * @returns {asserts value is string}
 */

/** @type {validateString} */
function validateString(value, name) {
  if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}

/**
 * @callback validateInt32
 * @param {*} value
 * @param {string} name
 * @param {number} [min]
 * @param {number} [max]
 * @returns {asserts value is number}
 */

/** @type {validateInt32} */
const validateInt32 = (value, name, min = -2147483648, max = 2147483647) => {
  // The defaults for min and max correspond to the limits of 32-bit integers.
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isInteger(value)) {
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
};

/**
 * @callback validateBuffer
 * @param {*} buffer
 * @param {string} [name='buffer']
 * @returns {asserts buffer is ArrayBufferView}
 */

/** @type {validateBuffer} */
const validateBuffer = (buffer, name = "buffer") => {
  if (!ArrayBuffer.isView(buffer)) {
    throw new ERR_INVALID_ARG_TYPE(name, ["Buffer", "TypedArray", "DataView"], buffer);
  }
};

/**
 * @callback validateObject
 * @param {*} value
 * @param {string} name
 * @param {{
 *   allowArray?: boolean,
 *   allowFunction?: boolean,
 *   nullable?: boolean
 * }} [options]
 */

/**
 * @callback validateObject
 * @param {*} value
 * @param {string} name
 * @param {{
 *   allowArray?: boolean,
 *   allowFunction?: boolean,
 *   nullable?: boolean
 * }} [options]
 */

/** @type {validateObject} */
const validateObject = (value, name, options = null) => {
  // const validateObject = hideStackFrames((value, name, options = null) => {
  const allowArray = options?.allowArray ?? false;
  const allowFunction = options?.allowFunction ?? false;
  const nullable = options?.nullable ?? false;
  if (
    (!nullable && value === null) ||
    (!allowArray && Array.isArray.call(value)) ||
    (typeof value !== "object" && (!allowFunction || typeof value !== "function"))
  ) {
    throw new ERR_INVALID_ARG_TYPE(name, "object", value);
  }
};

/**
 * @callback validateOneOf
 * @template T
 * @param {T} value
 * @param {string} name
 * @param {T[]} oneOf
 */

/** @type {validateOneOf} */
const validateOneOf = (value, name, oneOf) => {
  // const validateOneOf = hideStackFrames((value, name, oneOf) => {
  if (!ArrayPrototypeIncludes.call(oneOf, value)) {
    const allowed = ArrayPrototypeJoin.call(
      ArrayPrototypeMap.call(oneOf, v => (typeof v === "string" ? `'${v}'` : String(v))),
      ", ",
    );
    const reason = "must be one of: " + allowed;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
  }
};

/**
 * @callback validateFunction
 * @param {*} value
 * @param {string} name
 * @returns {asserts value is Function}
 */

/** @type {validateFunction} */
function validateFunction(value, name) {
  if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
}

/**
 * @callback validateAbortSignal
 * @param {*} signal
 * @param {string} name
 */

/** @type {validateAbortSignal} */
const validateAbortSignal = (signal, name) => {
  if (signal !== undefined && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
    throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
  }
};

/**
 * @callback validateArray
 * @param {*} value
 * @param {string} name
 * @param {number} [minLength]
 * @returns {asserts value is any[]}
 */

/** @type {validateArray} */
const validateArray = (value, name, minLength = 0) => {
  // const validateArray = hideStackFrames((value, name, minLength = 0) => {
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
  }
  if (value.length < minLength) {
    const reason = `must be longer than ${minLength}`;
    throw new ERR_INVALID_ARG_VALUE(name, value, reason);
  }
};

/**
 * @callback validateUint32
 * @param {*} value
 * @param {string} name
 * @param {number|boolean} [positive=false]
 * @returns {asserts value is number}
 */

/** @type {validateUint32} */
const validateUint32 = (value, name, positive = false) => {
  if (typeof value !== "number") {
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  }
  if (!Number.isInteger(value)) {
    throw new ERR_OUT_OF_RANGE(name, "an integer", value);
  }
  const min = positive ? 1 : 0;
  // 2 ** 32 === 4294967296
  const max = 4_294_967_295;
  if (value < min || value > max) {
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
};

function nullCheck(path, propName, throwError = true) {
  const pathIsString = typeof path === "string";
  const pathIsUint8Array = isUint8Array(path);

  // We can only perform meaningful checks on strings and Uint8Arrays.
  if (
    (!pathIsString && !pathIsUint8Array) ||
    (pathIsString && !StringPrototypeIncludes.call(path, "\u0000")) ||
    (pathIsUint8Array && !Uint8ArrayPrototypeIncludes.call(path, 0))
  ) {
    return;
  }

  const err = new ERR_INVALID_ARG_VALUE(propName, path, "must be a string or Uint8Array without null bytes");
  if (throwError) {
    throw err;
  }
  return err;
}

function validatePath(path, propName = "path") {
  if (typeof path !== "string" && !isUint8Array(path)) {
    throw new ERR_INVALID_ARG_TYPE(propName, ["string", "Buffer", "URL"], path);
  }

  const err = nullCheck(path, propName, false);

  if (err !== undefined) {
    throw err;
  }
}

function getValidatedPath(fileURLOrPath, propName = "path") {
  const path = toPathIfFileURL(fileURLOrPath);
  validatePath(path, propName);
  return path;
}

function isUint8Array(value) {
  return typeof value === "object" && value !== null && value instanceof Uint8Array;
}

export default {
  validateMaxBuffer,
  validateArgumentNullCheck,
  validateArgumentsNullCheck,
  validateTimeout,
  validateBoolean,
  validateString,
  validateInt32,
  validateBuffer,
  validateObject,
  validateFunction,
  validateAbortSignal,
  validateUint32,
  validateOneOf,
  validateArray,
  getValidatedPath,
};
