// The whole point behind this internal module is to allow Node.js to no
// longer be forced to treat every error message change as a semver-major
// change. The NodeError classes here all expose a `code` property whose
// value statically and permanently identifies the error. While the error
// message may change, the code should not.

const {
  ArrayIsArray,
  ArrayPrototypeIncludes,
  ArrayPrototypeIndexOf,
  ArrayPrototypeJoin,
  ArrayPrototypePop,
  ArrayPrototypePush,
  ArrayPrototypeSplice,
  ErrorCaptureStackTrace,
  ObjectDefineProperty,
  ReflectApply,
  RegExpPrototypeTest,
  SafeMap,
  StringPrototypeEndsWith,
  StringPrototypeIncludes,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
} = require('../primordials');

const messages = new SafeMap();
const codes = {};

const classRegExp = /^([A-Z][a-z0-9]*)+$/;
// Sorted by a rough estimate on most frequently used entries.
const kTypes = [
  'string',
  'function',
  'number',
  'object',
  // Accept 'Function' and 'Object' as alternative to the lower cased version.
  'Function',
  'Object',
  'boolean',
  'bigint',
  'symbol',
];

let userStackTraceLimit;
const nodeInternalPrefix = '__node_internal_';

// Lazily loaded
let assert;
let internalUtilInspect = null;
function lazyInternalUtilInspect() {
  if (!internalUtilInspect) {
    internalUtilInspect = require('../inspect');
  }
  return internalUtilInspect;
}

const addCodeToName = hideStackFrames(function addCodeToName(err, name, code) {
  // Set the stack
  err = captureLargerStackTrace(err);
  // Add the error code to the name to include it in the stack trace.
  err.name = `${name} [${code}]`;
  // Access the stack to generate the error message including the error code
  // from the name.
  err.stack;
  // Reset the name to the actual name.
  delete err.name;
});

function makeNodeErrorWithCode(Base, key) {
  return function NodeError(...args) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    const error = new Base();
    // Reset the limit and setting the name property.
    Error.stackTraceLimit = limit;
    const message = getMessage(key, args, error);
    ObjectDefineProperty(error, 'message', {
      value: message,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    ObjectDefineProperty(error, 'toString', {
      value() {
        return `${this.name} [${key}]: ${this.message}`;
      },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    addCodeToName(error, Base.name, key);
    error.code = key;
    return error;
  };
}

// This function removes unnecessary frames from Node.js core errors.
function hideStackFrames(fn) {
  // We rename the functions that will be hidden to cut off the stacktrace
  // at the outermost one
  const hidden = nodeInternalPrefix + fn.name;
  ObjectDefineProperty(fn, 'name', { value: hidden });
  return fn;
}

// Utility function for registering the error codes. Only used here. Exported
// *only* to allow for testing.
function E(sym, val, def) {
  // Special case for SystemError that formats the error message differently
  // The SystemErrors only have SystemError as their base classes.
  messages.set(sym, val);
  codes[sym] = makeNodeErrorWithCode(def, sym);
}

function getMessage(key, args, self) {
  const msg = messages.get(key);

  assert ??= require('./assert');

  assert(typeof msg === 'function');
  assert(
    msg.length <= args.length, // Default options do not count.
    `Code: ${key}; The provided arguments length (${args.length}) does not ` +
      `match the required ones (${msg.length}).`,
  );
  return ReflectApply(msg, self, args);
}

const captureLargerStackTrace = hideStackFrames(
  function captureLargerStackTrace(err) {
    userStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
    ErrorCaptureStackTrace(err);
    // Reset the limit
    Error.stackTraceLimit = userStackTraceLimit;

    return err;
  });

let maxStack_ErrorName;
let maxStack_ErrorMessage;
/**
 * Returns true if `err.name` and `err.message` are equal to engine-specific
 * values indicating max call stack size has been exceeded.
 * "Maximum call stack size exceeded" in V8.
 * @param {Error} err
 * @returns {boolean}
 */
function isStackOverflowError(err) {
  if (maxStack_ErrorMessage === undefined) {
    try {
      function overflowStack() { overflowStack(); }
      overflowStack();
    } catch (err) {
      maxStack_ErrorMessage = err.message;
      maxStack_ErrorName = err.name;
    }
  }

  return err && err.name === maxStack_ErrorName &&
         err.message === maxStack_ErrorMessage;
}

export default {
  codes,
  hideStackFrames,
  isStackOverflowError,
};

E('ERR_INVALID_ARG_TYPE',
  (name, expected, actual) => {
    assert(typeof name === 'string', "'name' must be a string");
    if (!ArrayIsArray(expected)) {
      expected = [expected];
    }

    let msg = 'The ';
    if (StringPrototypeEndsWith(name, ' argument')) {
      // For cases like 'first argument'
      msg += `${name} `;
    } else {
      const type = StringPrototypeIncludes(name, '.') ? 'property' : 'argument';
      msg += `"${name}" ${type} `;
    }
    msg += 'must be ';

    const types = [];
    const instances = [];
    const other = [];

    for (const value of expected) {
      assert(typeof value === 'string',
             'All expected entries have to be of type string');
      if (ArrayPrototypeIncludes(kTypes, value)) {
        ArrayPrototypePush(types, StringPrototypeToLowerCase(value));
      } else if (RegExpPrototypeTest(classRegExp, value)) {
        ArrayPrototypePush(instances, value);
      } else {
        assert(value !== 'object',
               'The value "object" should be written as "Object"');
        ArrayPrototypePush(other, value);
      }
    }

    // Special handle `object` in case other instances are allowed to outline
    // the differences between each other.
    if (instances.length > 0) {
      const pos = ArrayPrototypeIndexOf(types, 'object');
      if (pos !== -1) {
        ArrayPrototypeSplice(types, pos, 1);
        ArrayPrototypePush(instances, 'Object');
      }
    }

    if (types.length > 0) {
      if (types.length > 2) {
        const last = ArrayPrototypePop(types);
        msg += `one of type ${ArrayPrototypeJoin(types, ', ')}, or ${last}`;
      } else if (types.length === 2) {
        msg += `one of type ${types[0]} or ${types[1]}`;
      } else {
        msg += `of type ${types[0]}`;
      }
      if (instances.length > 0 || other.length > 0)
        msg += ' or ';
    }

    if (instances.length > 0) {
      if (instances.length > 2) {
        const last = ArrayPrototypePop(instances);
        msg +=
          `an instance of ${ArrayPrototypeJoin(instances, ', ')}, or ${last}`;
      } else {
        msg += `an instance of ${instances[0]}`;
        if (instances.length === 2) {
          msg += ` or ${instances[1]}`;
        }
      }
      if (other.length > 0)
        msg += ' or ';
    }

    if (other.length > 0) {
      if (other.length > 2) {
        const last = ArrayPrototypePop(other);
        msg += `one of ${ArrayPrototypeJoin(other, ', ')}, or ${last}`;
      } else if (other.length === 2) {
        msg += `one of ${other[0]} or ${other[1]}`;
      } else {
        if (StringPrototypeToLowerCase(other[0]) !== other[0])
          msg += 'an ';
        msg += `${other[0]}`;
      }
    }

    if (actual == null) {
      msg += `. Received ${actual}`;
    } else if (typeof actual === 'function' && actual.name) {
      msg += `. Received function ${actual.name}`;
    } else if (typeof actual === 'object') {
      if (actual.constructor && actual.constructor.name) {
        msg += `. Received an instance of ${actual.constructor.name}`;
      } else {
        const inspected = lazyInternalUtilInspect()
          .inspect(actual, { depth: -1 });
        msg += `. Received ${inspected}`;
      }
    } else {
      let inspected = lazyInternalUtilInspect()
        .inspect(actual, { colors: false });
      if (inspected.length > 25)
        inspected = `${StringPrototypeSlice(inspected, 0, 25)}...`;
      msg += `. Received type ${typeof actual} (${inspected})`;
    }
    return msg;
  }, TypeError);
