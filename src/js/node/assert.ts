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

const { SafeMap, SafeSet } = require("internal/primordials");
const {
  isKeyObject,
  isPromise,
  isRegExp,
  isMap,
  isSet,
  isDate,
  isWeakSet,
  isWeakMap,
  isAnyArrayBuffer,
} = require("node:util/types");
const { innerOk } = require("internal/assert/utils");
const { validateFunction, validateOneOf } = require("internal/validators");

const ArrayFrom = Array.from;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayBufferIsView = ArrayBuffer.isView;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
// Native brand check (inherits<JSDOMURL>) — immune to prototype and
// Symbol.hasInstance tampering. The captured href getter reads the value.
const isURL = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionIsURL", 1);
// Ordered-with-gaps element containment for same-tag typed arrays,
// DataViews, and ArrayBuffers (node kPartial), in native code.
const partialTypedArrayEquiv = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionPartialTypedArrayEquiv", 2);
const URLPrototypeHrefGetter = ObjectGetOwnPropertyDescriptor(URL.prototype, "href").get;
const NumberIsNaN = Number.isNaN;
const ObjectAssign = Object.assign;
const ObjectDefineProperty = Object.defineProperty;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const NumberIsInteger = Number.isInteger;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
// Reads the real typed-array tag, immune to faked Symbol.toStringTag properties.
const TypedArrayPrototypeGetToStringTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)!.get!;
const ObjectPrototypeIsPrototypeOf = Object.prototype.isPrototypeOf;
const ObjectPrototypePropertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const ObjectPrototypeToString = Object.prototype.toString;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit = String.prototype.split;
const SymbolIterator = Symbol.iterator;

type nodeAssert = typeof import("node:assert");

const kOptions = Symbol("options");

const { isDeepStrictEqual, withCycleGuard } = require("internal/util/comparisons");

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

function isSpecial(obj) {
  return obj == null || typeof obj !== "object" || Error.isError(obj) || isRegExp(obj) || isDate(obj);
}

const SafeSetPrototypeIterator = SafeSet.prototype[SymbolIterator];
const SafeMapPrototypeIterator = SafeMap.prototype[SymbolIterator];
const SafeMapPrototypeHas = SafeMap.prototype.has;
const SafeMapPrototypeGet = SafeMap.prototype.get;

/**
 * Compares two objects or values recursively to check if they are equal.
 * @param {any} actual - The actual value to compare.
 * @param {any} expected - The expected value to compare.
 * @param {Set} [comparedObjects=new Set()] - Set to track compared objects for handling circular references.
 * @returns {boolean} - Returns `true` if the actual value matches the expected value, otherwise `false`.
 * @example
 * compareBranch({a: 1, b: 2, c: 3}, {a: 1, b: 2}); // true
 */
function compareBranch(actual, expected, comparedObjects?) {
  if (actual === expected) {
    return actual !== 0 || ObjectIs(actual, expected);
  }

  // Distinct weak collections and promises are never partially equal.
  if (
    isWeakSet(actual) ||
    isWeakMap(actual) ||
    isPromise(actual) ||
    isWeakSet(expected) ||
    isWeakMap(expected) ||
    isPromise(expected)
  ) {
    return false;
  }

  // Check for Map object equality (subset check for partialDeepStrictEqual)
  if (isMap(actual) && isMap(expected)) {
    if (expected.size > actual.size) {
      return false; // `expected` can't be a subset if it has more elements
    }

    return withCycleGuard(actual, expected, comparedObjects, compareBranchMap);
  }

  // Typed arrays / ArrayBuffers: the expected contents must appear in the
  // actual contents in order (with gaps), like node's kPartial mode.
  const actualIsView = ArrayBufferIsView(actual);
  const expectedIsView = ArrayBufferIsView(expected);
  if (actualIsView || expectedIsView) {
    if (actualIsView !== expectedIsView) {
      return false;
    }
    const tag = TypedArrayPrototypeGetToStringTag.$call(actual);
    if (tag !== TypedArrayPrototypeGetToStringTag.$call(expected)) {
      return false;
    }
    if (tag === undefined) {
      // DataViews have no indexed elements; compare raw bytes natively, then
      // any own enumerable properties on the views themselves.
      return (
        partialTypedArrayEquiv(actual, expected) &&
        withCycleGuard(actual, expected, comparedObjects, compareBranchObject)
      );
    }
    return partialTypedArrayEquiv(actual, expected);
  }
  const actualIsBuffer = isAnyArrayBuffer(actual);
  const expectedIsBuffer = isAnyArrayBuffer(expected);
  if (actualIsBuffer || expectedIsBuffer) {
    if (
      actualIsBuffer !== expectedIsBuffer ||
      ObjectPrototypeToString.$call(actual) !== ObjectPrototypeToString.$call(expected)
    ) {
      return false;
    }
    // Compare contents natively, then any own enumerable properties.
    return (
      partialTypedArrayEquiv(actual, expected) &&
      withCycleGuard(actual, expected, comparedObjects, compareBranchObject)
    );
  }

  if (isKeyObject(actual) || isKeyObject(expected)) {
    return isKeyObject(actual) && isKeyObject(expected) && actual.equals(expected);
  }

  // URLs must both be URLs with the same href.
  if (isURL(actual) || isURL(expected)) {
    if (
      !isURL(actual) ||
      !isURL(expected) ||
      URLPrototypeHrefGetter.$call(actual) !== URLPrototypeHrefGetter.$call(expected)
    ) {
      return false;
    }
    return withCycleGuard(actual, expected, comparedObjects, compareBranchObject);
  }

  // Errors compare name/message/cause/errors leniently: `undefined` (or an
  // empty expected message) on the expected side is ignored.
  if (Error.isError(actual) || Error.isError(expected)) {
    if (!Error.isError(actual) || !Error.isError(expected)) {
      return false;
    }
    for (const key of ["message", "name", "errors"]) {
      const expectedValue = expected[key];
      if (expectedValue === undefined || (key === "message" && expectedValue === "")) {
        continue;
      }
      if (!compareBranch(actual[key], expectedValue, comparedObjects)) {
        return false;
      }
    }
    // An own `cause` on the expected error (even undefined) must exist on the
    // actual error as well.
    if (ObjectPrototypeHasOwnProperty.$call(expected, "cause")) {
      if (
        !ObjectPrototypeHasOwnProperty.$call(actual, "cause") ||
        !compareBranch(actual.cause, expected.cause, comparedObjects)
      ) {
        return false;
      }
    }
    return withCycleGuard(actual, expected, comparedObjects, compareBranchObject);
  }

  // Check for Set object equality
  if (isSet(actual) && isSet(expected)) {
    if (expected.size > actual.size) {
      return false; // `expected` can't be a subset if it has more elements
    }

    const actualArray = ArrayFrom(SafeSetPrototypeIterator.$call(actual));
    const expectedIterator = SafeSetPrototypeIterator.$call(expected);
    const usedIndices = new SafeSet();

    expectedIteration: for (const expectedItem of expectedIterator) {
      for (let actualIdx = 0; actualIdx < actualArray.length; actualIdx++) {
        if (!usedIndices.has(actualIdx) && Bun.deepEquals(actualArray[actualIdx], expectedItem, true)) {
          usedIndices.add(actualIdx);
          continue expectedIteration;
        }
      }
      return false;
    }

    return true;
  }

  // The expected array must match a subsequence of the actual array, in order,
  // with each element compared partially (Node's partialArrayEquiv).
  if ($isArray(actual) !== $isArray(expected)) {
    return false;
  }
  if ($isArray(actual) && $isArray(expected)) {
    if (expected.length > actual.length) {
      return false;
    }

    return withCycleGuard(actual, expected, comparedObjects, compareBranchArray);
  }

  // Comparison done when at least one of the values is not an object
  if (isSpecial(actual) || isSpecial(expected)) {
    return Bun.deepEquals(actual, expected, true);
  }

  // Objects with different type tags (e.g. an array vs a plain object) are
  // never partially equal.
  if (ObjectPrototypeToString.$call(actual) !== ObjectPrototypeToString.$call(expected)) {
    return false;
  }

  return withCycleGuard(actual, expected, comparedObjects, compareBranchObject);
}

// A string key that is a canonical array index (0 <= i < 2**32 - 1).
function isIndexKey(key) {
  if (typeof key !== "string") return false;
  const n = +key;
  return NumberIsInteger(n) && n >= 0 && n < 4294967295 && String(n) === key;
}

// Own enumerable check on both sides, matching node's partial mode.
function compareBranchOwnProperty(actual, expected, key, comparedObjects) {
  return (
    ObjectPrototypePropertyIsEnumerable.$call(actual, key) && compareBranch(actual[key], expected[key], comparedObjects)
  );
}

function compareBranchMap(actual, expected, comparedObjects) {
  let actualEntries;
  const usedIndices = new SafeSet();
  // Keys consumed by the identity fast path; without this, one actual entry
  // could satisfy two expected entries (once by identity, once by deep
  // equality through the index loop below).
  const usedIdentityKeys = new SafeSet();
  const expectedIterator = SafeMapPrototypeIterator.$call(expected);
  entryIteration: for (const { 0: key, 1: expectedValue } of expectedIterator) {
    // Fast path: identical key present on both sides.
    if (!usedIdentityKeys.has(key) && SafeMapPrototypeHas.$call(actual, key)) {
      // The identity entry may already have been consumed by the index loop
      // below (matched by deep equality against an earlier expected entry);
      // reserve its index so neither path can double-count it, like node.
      let identityIndex = -1;
      if (actualEntries !== undefined) {
        for (let i = 0; i < actualEntries.length; i++) {
          if (actualEntries[i][0] === key) {
            identityIndex = i;
            break;
          }
        }
      }
      if (identityIndex === -1 || !usedIndices.has(identityIndex)) {
        const actualValue = SafeMapPrototypeGet.$call(actual, key);
        if (compareBranch(actualValue, expectedValue, comparedObjects)) {
          usedIdentityKeys.add(key);
          if (identityIndex !== -1) {
            usedIndices.add(identityIndex);
          }
          continue;
        }
      }
    }
    if (typeof key !== "object" || key === null) {
      return false;
    }
    // Object keys are matched by partial deep equality, like node.
    actualEntries ??= ArrayFrom(SafeMapPrototypeIterator.$call(actual));
    for (let i = 0; i < actualEntries.length; i++) {
      if (
        !usedIndices.has(i) &&
        !usedIdentityKeys.has(actualEntries[i][0]) &&
        compareBranch(actualEntries[i][0], key, comparedObjects) &&
        compareBranch(actualEntries[i][1], expectedValue, comparedObjects)
      ) {
        usedIndices.add(i);
        continue entryIteration;
      }
    }
    return false;
  }
  return true;
}

function compareBranchArray(actual, expected, comparedObjects) {
  let actualPos = 0;
  for (let i = 0; i < expected.length; i++) {
    const lastCandidate = actual.length - expected.length + i;
    while (actualPos <= lastCandidate && !compareBranch(actual[actualPos], expected[i], comparedObjects)) {
      actualPos++;
    }
    if (actualPos > lastCandidate) {
      return false;
    }
    actualPos++;
  }
  // node also compares own enumerable non-index properties.
  for (const key of ObjectKeys(expected)) {
    if (isIndexKey(key)) continue;
    if (!compareBranchOwnProperty(actual, expected, key, comparedObjects)) {
      return false;
    }
  }
  for (const key of ObjectGetOwnPropertySymbols(expected)) {
    if (!ObjectPrototypePropertyIsEnumerable.$call(expected, key)) continue;
    if (!compareBranchOwnProperty(actual, expected, key, comparedObjects)) {
      return false;
    }
  }
  return true;
}

function compareBranchObject(actual, expected, comparedObjects) {
  // Own enumerable string and symbol properties only, like node's partial mode.
  for (const key of ObjectKeys(expected)) {
    if (!compareBranchOwnProperty(actual, expected, key, comparedObjects)) {
      return false;
    }
  }
  for (const key of ObjectGetOwnPropertySymbols(expected)) {
    if (!ObjectPrototypePropertyIsEnumerable.$call(expected, key)) continue;
    if (!compareBranchOwnProperty(actual, expected, key, comparedObjects)) {
      return false;
    }
  }
  return true;
}

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

  if (!compareBranch(actual, expected)) {
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
    const fnType = stackStartFn === Assert.prototype.rejects ? "rejection" : "exception";
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
    const fnType = stackStartFn === Assert.prototype.doesNotReject ? "rejection" : "exception";
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
function rejects(block: (() => Promise<unknown>) | Promise<unknown>, message?: string | Error): Promise<void>;
function rejects(
  block: (() => Promise<unknown>) | Promise<unknown>,
  error: nodeAssert.AssertPredicate,
  message?: string | Error,
): Promise<void>;
async function rejects(block: (() => Promise<unknown>) | Promise<unknown>, ...args: any[]): Promise<void> {
  expectsError(rejects, await waitForActual(block), ...args);
}
Assert.prototype.rejects = rejects;

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
Assert.prototype.doesNotReject = async function doesNotReject(
  fn: () => Promise<unknown>,
  ...args: unknown[]
): Promise<void> {
  expectsNoError(doesNotReject, await waitForActual(fn), ...args);
};

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
