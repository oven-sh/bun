// Copied from Node.js (src/lib/assert.js)
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

const { isPromise, isRegExp } = require("node:util/types");
const { innerOk } = require("internal/assert/utils");
const { validateFunction, validateOneOf } = require("internal/validators");

const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
// node's kPartial comparison, fully native (NodeUtilTypesModule.cpp).
const nodePartialDeepStrictEqual = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionPartialDeepStrictEqual", 2);
const NumberIsNaN = Number.isNaN;
const ObjectAssign = Object.assign;
const ObjectDefineProperty = Object.defineProperty;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectPrototypeIsPrototypeOf = Object.prototype.isPrototypeOf;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;

type nodeAssert = typeof import("node:assert");

const kOptions = Symbol("options");

const { isDeepStrictEqual } = require("internal/util/comparisons");

function isDeepEqual(a, b) {
  return Bun.deepEquals(a, b, false);
}

var _inspect;
function lazyInspect() {
  if (_inspect === undefined) {
    _inspect = require("internal/util/inspect").inspect;
  }
  return _inspect;
}

var AssertionError;
function loadAssertionError() {
  if (AssertionError === undefined) {
    AssertionError = require("internal/assert/assertion_error");
  }
}

let warned = false;

// The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

const assert: nodeAssert = ok as any;
export default assert;

const NO_EXCEPTION_SENTINEL = {};

/**
 * @class Assert
 * @param {object} [options] - `diff` ('simple'|'full'), `strict` (default true),
 *   `skipPrototype` (default false).
 * @throws {ERR_CONSTRUCT_CALL_REQUIRED} If not called with `new`.
 */
function Assert(options) {
  if (!new.target) {
    throw $ERR_CONSTRUCT_CALL_REQUIRED("Class constructor Assert cannot be invoked without `new`");
  }

  options = ObjectAssign({ __proto__: null, strict: true, skipPrototype: false }, options);

  const { diff } = options;
  if (diff !== undefined) {
    validateOneOf(diff, "options.diff", ["simple", "full"]);
  }

  loadAssertionError();
  this.AssertionError = AssertionError;
  ObjectDefineProperty(this, kOptions, {
    __proto__: null,
    value: options,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  if (options.strict) {
    this.equal = this.strictEqual;
    this.deepEqual = this.deepStrictEqual;
    this.notEqual = this.notStrictEqual;
    this.notDeepEqual = this.notDeepStrictEqual;
  }
}

// Functions compiled as builtins have no automatic `.prototype`; assign one
// explicitly (same pattern as EventEmitter in node/events.ts).
Assert.prototype = {};
ObjectDefineProperty(Assert.prototype, "constructor", {
  __proto__: null,
  value: Assert,
  writable: true,
  enumerable: false,
  configurable: true,
});

// All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided. All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

// DESTRUCTURING WARNING: All Assert.prototype methods use optional chaining
// (this?.[kOptions]) so that methods destructured from an Assert instance
// (losing their `this`) fall back to default behavior.

function innerFail(obj) {
  const objMessage = obj.message;
  if (objMessage instanceof Error) throw objMessage;

  throw new AssertionError(obj);
}

function fail(message?: string | Error): never;
/** @deprecated since v10.0.0 - use fail([message]) or other assert functions instead. */
function fail(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
  operator?: string,
  // eslint-disable-next-line @typescript-eslint/ban-types
  stackStartFn?: Function,
): never;
function fail(
  actual: unknown,
  expected: unknown,
  message?: string | Error,
  operator?: string,
  stackStartFn?: Function,
) {
  const argsLen = arguments.length;

  let internalMessage = false;
  if (actual == null && argsLen <= 1) {
    internalMessage = true;
    message = "Failed";
  } else if (argsLen === 1) {
    message = actual;
    actual = undefined;
  } else {
    if (warned === false) {
      warned = true;
      process.emitWarning(
        "assert.fail() with more than one argument is deprecated. " +
          "Please use assert.strictEqual() instead or only pass a message.",
        "DeprecationWarning",
        "DEP0094",
      );
    }
    if (argsLen === 2) operator = "!=";
  }

  if (message instanceof Error) throw message;

  const errArgs = {
    actual,
    expected,
    operator: operator === undefined ? "fail" : operator,
    stackStartFn: stackStartFn || fail,
    message,
    diff: this?.[kOptions]?.diff,
  };
  if (AssertionError === undefined) loadAssertionError();
  const err = new AssertionError(errArgs);
  if (internalMessage) {
    err.generatedMessage = true;
  }
  throw err;
}

Assert.prototype.fail = fail;

// The AssertionError is defined in internal/error.
Object.defineProperty(assert, "AssertionError", {
  get() {
    loadAssertionError();
    return AssertionError;
  },
  set(value) {
    AssertionError = value;
  },
  configurable: true,
  enumerable: true,
});

/**
 * Pure assertion tests whether a value is truthy, as determined
 * by !!value.
 * @param {...any} args
 * @returns {void}
 */

function ok(value: unknown, message?: string | Error): asserts value;
function ok(...args: unknown[]): void {
  innerOk(ok, args.length, ...args);
}

Assert.prototype.ok = function ok(...args) {
  innerOk(ok, args.length, ...args);
};

/**
 * The equality assertion tests shallow, coercive equality with ==.
 * @param actual
 * @param expected
 * @param  message
 * @returns {void}
 */
/* eslint-disable no-restricted-properties */
Assert.prototype.equal = function equal(actual: unknown, expected: unknown, message?: string | Error) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }

  if (actual != expected && (!NumberIsNaN(actual) || !NumberIsNaN(expected))) {
    innerFail({
      actual,
      expected,
      message,
      operator: "==",
      stackStartFn: equal,
      diff: this?.[kOptions]?.diff,
    });
  }
};

/**
 * The non-equality assertion tests for whether two objects are not
 * equal with !=.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.notEqual = function notEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  // eslint-disable-next-line eqeqeq
  if (actual == expected || (NumberIsNaN(actual) && NumberIsNaN(expected))) {
    innerFail({
      actual,
      expected,
      message,
      operator: "!=",
      stackStartFn: notEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};

/**
 * The deep equivalence assertion tests a deep equality relation.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.deepEqual = function deepEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  if (!isDeepEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "deepEqual",
      stackStartFn: deepEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};

/**
 * The deep non-equivalence assertion tests for any deep inequality.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  if (isDeepEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "notDeepEqual",
      stackStartFn: notDeepEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};
/* eslint-enable */

/**
 * The deep strict equivalence assertion tests a deep strict equality
 * relation.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  if (!isDeepStrictEqual(actual, expected, this?.[kOptions]?.skipPrototype)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "deepStrictEqual",
      stackStartFn: deepStrictEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};

/**
 * The deep strict non-equivalence assertion tests for any deep strict
 * inequality.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.notDeepStrictEqual = notDeepStrictEqual;
function notDeepStrictEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  if (isDeepStrictEqual(actual, expected, this?.[kOptions]?.skipPrototype)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "notDeepStrictEqual",
      stackStartFn: notDeepStrictEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
}

/**
 * The strict equivalence assertion tests a strict equality relation.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.strictEqual = function strictEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  if (!ObjectIs(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "strictEqual",
      stackStartFn: strictEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};

/**
 * The strict non-equivalence assertion tests for any strict inequality.
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }
  if (ObjectIs(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "notStrictEqual",
      stackStartFn: notStrictEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};

/**
 * The strict equivalence assertion test between two objects
 * @param {any} actual
 * @param {any} expected
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.partialDeepStrictEqual = function partialDeepStrictEqual(actual, expected, message) {
  // emitExperimentalWarning("assert.partialDeepStrictEqual");
  if (arguments.length < 2) {
    throw $ERR_MISSING_ARGS("actual", "expected");
  }

  if (!nodePartialDeepStrictEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "partialDeepStrictEqual",
      stackStartFn: partialDeepStrictEqual,
      diff: this?.[kOptions]?.diff,
    });
  }
};

class Comparison {
  constructor(obj, keys, actual) {
    for (const key of keys) {
      if (key in obj) {
        if (
          actual !== undefined &&
          typeof actual[key] === "string" &&
          isRegExp(obj[key]) &&
          RegExpPrototypeExec.$call(obj[key], actual[key]) !== null
        ) {
          this[key] = actual[key];
        } else {
          this[key] = obj[key];
        }
      }
    }
  }
}

function compareExceptionKey(actual, expected, key, message, keys, fn) {
  if (!(key in actual) || !isDeepStrictEqual(actual[key], expected[key])) {
    if (!message) {
      // Create placeholder objects to create a nice output.
      const a = new Comparison(actual, keys);
      const b = new Comparison(expected, keys, actual);

      if (AssertionError === undefined) loadAssertionError();
      const err = new AssertionError({
        actual: a,
        expected: b,
        operator: "deepStrictEqual",
        stackStartFn: fn,
      });
      err.actual = actual;
      err.expected = expected;
      err.operator = fn.name;
      throw err;
    }
    innerFail({
      actual,
      expected,
      message,
      operator: fn.name,
      stackStartFn: fn,
    });
  }
}

function expectedException(actual, expected, message, fn) {
  let generatedMessage = false;
  let throwError = false;

  if (typeof expected !== "function") {
    // Handle regular expressions.
    if (isRegExp(expected)) {
      const str = String(actual);
      if (RegExpPrototypeExec.$call(expected, str) !== null) return;
      const inspect = lazyInspect();

      if (!message) {
        generatedMessage = true;
        message =
          "The input did not match the regular expression " + `${inspect(expected)}. Input:\n\n${inspect(str)}\n`;
      }
      throwError = true;
      // Handle primitives properly.
    } else if (typeof actual !== "object" || actual === null) {
      if (AssertionError === undefined) loadAssertionError();
      const err = new AssertionError({
        actual,
        expected,
        message,
        operator: "deepStrictEqual",
        stackStartFn: fn,
      });
      err.operator = fn.name;
      throw err;
    } else {
      // Handle validation objects.
      const keys = ObjectKeys(expected);
      // Special handle errors to make sure the name and the message are
      // compared as well.
      if (expected instanceof Error) {
        ArrayPrototypePush.$call(keys, "name", "message");
      } else if (keys.length === 0) {
        throw $ERR_INVALID_ARG_VALUE("error", expected, "may not be an empty object");
      }
      for (const key of keys) {
        if (
          typeof actual[key] === "string" &&
          isRegExp(expected[key]) &&
          RegExpPrototypeExec.$call(expected[key], actual[key]) !== null
        ) {
          continue;
        }
        compareExceptionKey(actual, expected, key, message, keys, fn);
      }
      return;
    }
    // Guard instanceof against arrow functions as they don't have a prototype.
    // Check for matching Error classes.
  } else if (expected.prototype !== undefined && actual instanceof expected) {
    return;
  } else if (ObjectPrototypeIsPrototypeOf.$call(Error, expected)) {
    if (!message) {
      generatedMessage = true;
      message = "The error is expected to be an instance of " + `"${expected.name}". Received `;
      if (Error.isError(actual)) {
        const name = actual.constructor?.name || actual.name;
        if (expected.name === name) {
          message += "an error with identical name but a different prototype.";
        } else {
          message += `"${name}"`;
        }
        const actualMessage = actual.message;
        if (actualMessage) {
          message += `\n\nError message:\n\n${actualMessage}`;
        }
      } else {
        message += `"${lazyInspect()(actual, { depth: -1 })}"`;
      }
    }
    throwError = true;
  } else {
    // Check validation functions return value.
    const res = expected.$apply({}, [actual]);
    if (res !== true) {
      if (!message) {
        generatedMessage = true;
        const name = expected.name ? `"${expected.name}" ` : "";
        const inspect = lazyInspect();
        message = `The ${name}validation function is expected to return` + ` "true". Received ${inspect(res)}`;

        if (Error.isError(actual)) {
          message += `\n\nCaught error:\n\n${actual}`;
        }
      }
      throwError = true;
    }
  }

  if (throwError) {
    if (AssertionError === undefined) loadAssertionError();
    const err = new AssertionError({
      actual,
      expected,
      message,
      operator: fn.name,
      stackStartFn: fn,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

function getActual(fn) {
  validateFunction(fn, "fn");
  try {
    fn();
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION_SENTINEL;
}

function checkIsPromise(obj): obj is Promise<unknown> {
  // Accept native ES6 promises and promises that are implemented in a similar
  // way. Do not accept thenables that use a function as `obj` and that have no
  // `catch` handler.
  return (
    isPromise(obj) ||
    (obj !== null && typeof obj === "object" && typeof obj.then === "function" && typeof obj.catch === "function")
  );
}

async function waitForActual(promiseFn) {
  let resultPromise;
  if (typeof promiseFn === "function") {
    // Return a rejected promise if `promiseFn` throws synchronously.
    resultPromise = promiseFn();
    // Fail in case no promise is returned.
    if (!checkIsPromise(resultPromise)) {
      throw $ERR_INVALID_RETURN_VALUE("instance of Promise", "promiseFn", resultPromise);
    }
  } else if (checkIsPromise(promiseFn)) {
    resultPromise = promiseFn;
  } else {
    throw $ERR_INVALID_ARG_TYPE("promiseFn", ["Function", "Promise"], promiseFn);
  }

  try {
    await resultPromise;
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION_SENTINEL;
}

function expectsError(stackStartFn: Function, actual: unknown, error: unknown, message?: string | Error) {
  if (typeof error === "string") {
    if (arguments.length === 4) {
      throw $ERR_INVALID_ARG_TYPE("error", ["Object", "Error", "Function", "RegExp"], error);
    }
    if (typeof actual === "object" && actual !== null) {
      if ((actual as { message?: unknown }).message === error) {
        throw $ERR_AMBIGUOUS_ARGUMENT("error/message", `The error message "${(actual as { message?: unknown }).message}" is identical to the message.`); // prettier-ignore
      }
      if (Object.keys(error).length === 0) {
        throw $ERR_INVALID_ARG_VALUE("error", error, "may not be an empty object");
      }
    } else if (actual === error) {
      throw $ERR_AMBIGUOUS_ARGUMENT("error/message", `The error "${actual}" is identical to the message.`);
    }
    message = error;
    error = undefined;
  } else if (error != null && typeof error !== "object" && typeof error !== "function") {
    throw $ERR_INVALID_ARG_TYPE("error", ["Object", "Error", "Function", "RegExp"], error);
  }

  if (actual === NO_EXCEPTION_SENTINEL) {
    let details = "";
    if ((error as Error | undefined)?.name) {
      details += ` (${(error as Error).name})`;
    }
    details += message ? `: ${message}` : ".";
    const fnType = stackStartFn === kQualifiedStackNames["assert.rejects"] ? "rejection" : "exception";
    innerFail({
      actual: undefined,
      expected: error,
      operator: stackStartFn.name,
      message: `Missing expected ${fnType}${details}`,
      stackStartFn,
    });
  }

  if (!error) return;

  expectedException(actual, error, message, stackStartFn);
}

function hasMatchingError(actual, expected) {
  if (typeof expected !== "function") {
    if (isRegExp(expected)) {
      const str = String(actual);
      return RegExpPrototypeExec.$call(expected, str) !== null;
    }
    throw $ERR_INVALID_ARG_TYPE("expected", ["Function", "RegExp"], expected);
  }
  // Guard instanceof against arrow functions as they don't have a prototype.
  if (expected.prototype !== undefined && actual instanceof expected) {
    return true;
  }
  if (ObjectPrototypeIsPrototypeOf.$call(Error, expected)) {
    return false;
  }
  return expected.$apply({}, [actual]) === true;
}

function expectsNoError(stackStartFn, actual, error, message) {
  if (actual === NO_EXCEPTION_SENTINEL) return;

  if (typeof error === "string") {
    message = error;
    error = undefined;
  }

  if (!error || hasMatchingError(actual, error)) {
    const details = message ? `: ${message}` : ".";
    const fnType = stackStartFn === kQualifiedStackNames["assert.doesNotReject"] ? "rejection" : "exception";
    innerFail({
      actual,
      expected: error,
      operator: stackStartFn.name,
      message: `Got unwanted ${fnType}${details}\n` + `Actual message: "${actual?.message}"`,
      stackStartFn,
    });
  }
  throw actual;
}

/**
 * Expects the function `promiseFn` to throw an error.
 * @param {() => any} promiseFn
 * @param {...any} [args]
 * @returns {void}
 */
Assert.prototype.throws = function throws(
  promiseFn: () => Promise<unknown> | Promise<unknown>,
  ...args: unknown[]
): void {
  expectsError(throws, getActual(promiseFn), ...args);
};

/**
 * Expects `promiseFn` function or its value to reject.
 * @param {() => Promise<any>} promiseFn
 * @param {...any} [args]
 * @returns {Promise<void>}
 */
// The method-shorthand string keys bake the qualified names into the parse-time
// (executable) names, which is what async stack frames render; V8 infers the
// same qualified name from the call site, so node prints
// "at async assert.rejects" where a plain `function rejects` gives "rejects"
// under JSC. `.name` is then restored to match node's.
const kQualifiedStackNames = {
  async "assert.rejects"(block: (() => Promise<unknown>) | Promise<unknown>, ...args: any[]): Promise<void> {
    // The captured binding, not `assert.rejects`: node's implementation keeps
    // working (and reporting operator "rejects") after the property is replaced.
    expectsError(kQualifiedStackNames["assert.rejects"], await waitForActual(block), ...args);
  },
  async "assert.doesNotReject"(fn: (() => Promise<unknown>) | Promise<unknown>, ...args: unknown[]): Promise<void> {
    expectsNoError(kQualifiedStackNames["assert.doesNotReject"], await waitForActual(fn), ...args);
  },
};
Assert.prototype.rejects = kQualifiedStackNames["assert.rejects"];
Object.defineProperty(Assert.prototype.rejects, "name", { value: "rejects", configurable: true });

/**
 * Asserts that the function `fn` does not throw an error.
 * @param {() => any} fn
 * @param {...any} [args]
 * @returns {void}
 */
Assert.prototype.doesNotThrow = function doesNotThrow(fn: () => Promise<unknown>, ...args: unknown[]): void {
  expectsNoError(doesNotThrow, getActual(fn), ...args);
};

/**
 * Expects `fn` or its value to not reject.
 * @param {() => Promise<any>} fn
 * @param {...any} [args]
 * @returns {Promise<void>}
 */
Assert.prototype.doesNotReject = kQualifiedStackNames["assert.doesNotReject"];
Object.defineProperty(Assert.prototype.doesNotReject, "name", { value: "doesNotReject", configurable: true });

/**
 * Throws `value` if the value is not `null` or `undefined`.
 * @param {any} err
 * @returns {void}
 */
Assert.prototype.ifError = function ifError(err: unknown): void {
  if (err !== null && err !== undefined) {
    let message = "ifError got unwanted exception: ";
    const errMessage = typeof err === "object" ? err.message : undefined;
    if (typeof errMessage === "string") {
      let errConstructor;
      if (errMessage.length === 0 && (errConstructor = err.constructor)) {
        message += errConstructor.name;
      } else {
        message += errMessage;
      }
    } else {
      const inspect = lazyInspect();
      message += inspect(err);
    }

    if (AssertionError === undefined) loadAssertionError();
    const newErr = new AssertionError({
      actual: err,
      expected: null,
      operator: "ifError",
      message,
      stackStartFn: ifError,
      diff: this?.[kOptions]?.diff,
    });

    // Make sure we actually have a stack trace!
    const origStack = err.stack;

    if (typeof origStack === "string") {
      // This will remove any duplicated frames from the error frames taken
      // from within `ifError` and add the original error frames to the newly
      // created ones.
      const origStackStart = StringPrototypeIndexOf.$call(origStack, "\n    at");
      if (origStackStart !== -1) {
        const originalFrames = StringPrototypeSplit.$call(
          StringPrototypeSlice.$call(origStack, origStackStart + 1),
          "\n",
        );
        // Filter all frames existing in err.stack.
        let newFrames = StringPrototypeSplit.$call(newErr.stack, "\n");
        for (const errFrame of originalFrames) {
          // Find the first occurrence of the frame.
          const pos = ArrayPrototypeIndexOf.$call(newFrames, errFrame);
          if (pos !== -1) {
            // Only keep new frames.
            newFrames = ArrayPrototypeSlice.$call(newFrames, 0, pos);
            break;
          }
        }
        const stackStart = ArrayPrototypeJoin.$call(newFrames, "\n");
        const stackEnd = ArrayPrototypeJoin.$call(originalFrames, "\n");
        newErr.stack = `${stackStart}\n${stackEnd}`;
      }
    }

    throw newErr;
  }
};

function internalMatch(string, regexp, message, fn) {
  if (!isRegExp(regexp)) {
    // List form so the message renders "an instance of RegExp" like node.
    throw $ERR_INVALID_ARG_TYPE("regexp", ["RegExp"], regexp);
  }
  const match = fn === Assert.prototype.match;
  if (typeof string !== "string" || (RegExpPrototypeExec.$call(regexp, string) !== null) !== match) {
    if (message instanceof Error) {
      throw message;
    }

    const generatedMessage = !message;
    const inspect = lazyInspect();

    // 'The input was expected to not match the regular expression ' +
    message ||=
      typeof string !== "string"
        ? 'The "string" argument must be of type string. Received type ' + `${typeof string} (${inspect(string)})`
        : (match
            ? "The input did not match the regular expression "
            : "The input was expected to not match the regular expression ") +
          `${inspect(regexp)}. Input:\n\n${inspect(string)}\n`;
    if (AssertionError === undefined) loadAssertionError();
    const err = new AssertionError({
      actual: string,
      expected: regexp,
      message,
      operator: fn.name,
      stackStartFn: fn,
    });
    err.generatedMessage = generatedMessage;
    throw err;
  }
}

/**
 * Expects the `string` input to match the regular expression.
 * @param {string} string
 * @param {RegExp} regexp
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.match = function match(string, regexp, message) {
  internalMatch(string, regexp, message, match);
};

/**
 * Expects the `string` input not to match the regular expression.
 * @param {string} string
 * @param {RegExp} regexp
 * @param {string | Error} [message]
 * @returns {void}
 */
Assert.prototype.doesNotMatch = function doesNotMatch(string, regexp, message) {
  internalMatch(string, regexp, message, doesNotMatch);
};

var CallTracker;
Object.defineProperty(assert, "CallTracker", {
  get() {
    if (CallTracker === undefined) {
      const { deprecate } = require("internal/util/deprecate");
      CallTracker = deprecate(require("internal/assert/calltracker"), "assert.CallTracker is deprecated.", "DEP0173");
    }
    return CallTracker;
  },
  set(value) {
    CallTracker = value;
  },
  configurable: true,
  enumerable: true,
});
// assert.CallTracker = CallTracker

/**
 * Expose a strict only variant of assert.
 * @param {...any} args
 * @returns {void}
 */
function strict(...args) {
  innerOk(strict, args.length, ...args);
}

for (const name of [
  "ok",
  "fail",
  "equal",
  "notEqual",
  "deepEqual",
  "notDeepEqual",
  "deepStrictEqual",
  "notDeepStrictEqual",
  "strictEqual",
  "notStrictEqual",
  "partialDeepStrictEqual",
  "match",
  "doesNotMatch",
  "throws",
  "rejects",
  "doesNotThrow",
  "doesNotReject",
  "ifError",
]) {
  assert[name] = Assert.prototype[name];
}

assert.strict = ObjectAssign(strict, assert, {
  equal: assert.strictEqual,
  deepEqual: assert.deepStrictEqual,
  notEqual: assert.notStrictEqual,
  notDeepEqual: assert.notDeepStrictEqual,
});

assert.strict.Assert = Assert;
assert.strict.strict = assert.strict;

assert.Assert = Assert;
