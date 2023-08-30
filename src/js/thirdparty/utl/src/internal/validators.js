const {
  ArrayIsArray,
} = require('../primordials');

const {
  hideStackFrames,
  codes: {
    ERR_INVALID_ARG_TYPE,
  },
} = require('./errors');

/**
 * @param {unknown} value
 * @param {string} name
 * @param {{
 *   allowArray?: boolean,
 *   allowFunction?: boolean,
 *   nullable?: boolean
 * }} [options]
 */
const validateObject = hideStackFrames(
  (value, name, options) => {
    const useDefaultOptions = options == null;
    const allowArray = useDefaultOptions ? false : options.allowArray;
    const allowFunction = useDefaultOptions ? false : options.allowFunction;
    const nullable = useDefaultOptions ? false : options.nullable;
    if (
      (!nullable && value === null) ||
      (!allowArray && ArrayIsArray(value)) ||
      (typeof value !== 'object' && (!allowFunction || typeof value !== 'function'))
    ) {
      throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
    }
  }
);

function validateString(value, name) {
  if (typeof value !== 'string')
    throw new ERR_INVALID_ARG_TYPE(name, 'string', value);
}

export default {
  validateObject,
  validateString,
};
