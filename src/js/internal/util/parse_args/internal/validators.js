// TODO: Should these be centralized? They are duplicated lots of times in the `js` folder.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function () {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

const requireValidators = __commonJS({
  "node_modules/@pkgjs/parseargs/internal/validators.js"(exports) {
    "use strict";

    // This file is a proxy of the original file located at:
    // https://github.com/nodejs/node/blob/main/lib/internal/validators.js
    // Every addition or modification to this file must be evaluated
    // during the PR review.

    const { ArrayIsArray, ArrayPrototypeIncludes, ArrayPrototypeJoin } = require("./primordials").default;

    const {
      codes: { ERR_INVALID_ARG_TYPE },
    } = require("./errors").default;

    function validateString(value, name) {
      if (typeof value !== "string") {
        throw new ERR_INVALID_ARG_TYPE(name, "String", value);
      }
    }

    function validateUnion(value, name, union) {
      if (!ArrayPrototypeIncludes(union, value)) {
        throw new ERR_INVALID_ARG_TYPE(name, `('${ArrayPrototypeJoin(union, "|")}')`, value);
      }
    }

    function validateBoolean(value, name) {
      if (typeof value !== "boolean") {
        throw new ERR_INVALID_ARG_TYPE(name, "Boolean", value);
      }
    }

    function validateArray(value, name) {
      if (!ArrayIsArray(value)) {
        throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
      }
    }

    function validateStringArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++) {
        validateString(value[i], `${name}[${i}]`);
      }
    }

    function validateBooleanArray(value, name) {
      validateArray(value, name);
      for (let i = 0; i < value.length; i++) {
        validateBoolean(value[i], `${name}[${i}]`);
      }
    }

    /**
     * @param {unknown} value
     * @param {string} name
     * @param {{
     *   allowArray?: boolean,
     *   allowFunction?: boolean,
     *   nullable?: boolean
     * }} [options]
     */
    function validateObject(value, name, options) {
      const useDefaultOptions = options == null;
      const allowArray = useDefaultOptions ? false : options.allowArray;
      const allowFunction = useDefaultOptions ? false : options.allowFunction;
      const nullable = useDefaultOptions ? false : options.nullable;
      if (
        (!nullable && value === null) ||
        (!allowArray && ArrayIsArray(value)) ||
        (typeof value !== "object" && (!allowFunction || typeof value !== "function"))
      ) {
        throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
      }
    }

    exports.validateArray = validateArray;
    exports.validateObject = validateObject;
    exports.validateString = validateString;
    exports.validateStringArray = validateStringArray;
    exports.validateUnion = validateUnion;
    exports.validateBoolean = validateBoolean;
    exports.validateBooleanArray = validateBooleanArray;
  },
});

export default requireValidators();
