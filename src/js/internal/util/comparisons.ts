// Ported from Node.js lib/internal/util/comparisons.js (v26.3.0).
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/comparisons.js
//
// This implements the comparison algorithm documented for
// `assert.deepEqual()`, `assert.deepStrictEqual()` and
// `assert.partialDeepStrictEqual()`. It intentionally does not share code with
// `Bun.deepEquals()` (the Jest `expect().toEqual()` algorithm): the two differ
// on prototype identity, `RegExp#lastIndex`, `Error#cause` / `errors`,
// objects with unobservable state (Promise, WeakMap, WeakSet), boxed
// primitives, sparse arrays and the `==` coercion used by the legacy
// `assert.deepEqual()`.
"use strict";

const {
  SafeSet,
  TypedArrayPrototypeGetByteLength,
  TypedArrayPrototypeGetSymbolToStringTag,
} = require("internal/primordials");

const {
  isAnyArrayBuffer,
  isArrayBufferView,
  isBigIntObject,
  isBooleanObject,
  isBoxedPrimitive,
  isCryptoKey,
  isDate,
  isFloat16Array,
  isFloat32Array,
  isFloat64Array,
  isKeyObject,
  isMap,
  isNativeError,
  isNumberObject,
  isPromise,
  isRegExp,
  isSet,
  isStringObject,
  isSymbolObject,
  isWeakMap,
  isWeakSet,
} = require("node:util/types");

const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const BigIntPrototypeValueOf = BigInt.prototype.valueOf;
const BooleanPrototypeValueOf = Boolean.prototype.valueOf;
const BufferCompare = Buffer.compare;
const DatePrototypeGetTime = Date.prototype.getTime;
const ErrorIsError = Error.isError;
const NumberPrototypeValueOf = Number.prototype.valueOf;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectPrototypePropertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const ObjectPrototypeToString = Object.prototype.toString;
const StringPrototypeValueOf = String.prototype.valueOf;
const SymbolPrototypeValueOf = Symbol.prototype.valueOf;
const SymbolToStringTag = Symbol.toStringTag;
const URLConstructor = URL;

// Node's `internalBinding('util').getOwnNonIndexProperties`: the own property
// keys of `obj` excluding array indices, honoring the PropertyFilter bits
// below. Implemented natively so large arrays and typed arrays do not pay for
// materializing every index key.
const getOwnNonIndexProperties: (obj: object, filter: number) => PropertyKey[] = $newCppFunction(
  "UtilInspect.cpp",
  "jsFunctionGetOwnNonIndexProperties",
  2,
);

// Matches V8's `PropertyFilter` values used by Node's
// `internalBinding('util').getOwnNonIndexProperties`.
const ONLY_ENUMERABLE = 2;
const SKIP_SYMBOLS = 16;

const wellKnownConstructors = new SafeSet()
  .add(Array)
  .add(ArrayBuffer)
  .add(BigInt)
  .add(BigInt64Array)
  .add(BigUint64Array)
  .add(Boolean)
  .add(Buffer)
  .add(DataView)
  .add(Date)
  .add(Error)
  .add(Float16Array)
  .add(Float32Array)
  .add(Float64Array)
  .add(Function)
  .add(Int16Array)
  .add(Int32Array)
  .add(Int8Array)
  .add(Map)
  .add(Number)
  .add(Object)
  .add(Promise)
  .add(RegExp)
  .add(Set)
  .add(String)
  .add(Symbol)
  .add(Uint16Array)
  .add(Uint32Array)
  .add(Uint8Array)
  .add(Uint8ClampedArray)
  .add(WeakMap)
  .add(WeakSet);

const kStrict = 2;
const kStrictWithoutPrototypes = 3;
const kLoose = 0;
const kPartial = 1;

const kNoIterator = 0;
const kIsArray = 1;
const kIsSet = 2;
const kIsMap = 3;

// `node:crypto` is only loaded once a KeyObject or CryptoKey is compared.
let KeyObject;

function areEqualKeyObjects(a, b) {
  KeyObject ??= require("node:crypto").KeyObject;
  // KeyObject#equals compares the key type and the underlying key material.
  return KeyObject.prototype.equals.$call(a, b);
}

function areEqualCryptoKeys(a, b, mode, memos) {
  KeyObject ??= require("node:crypto").KeyObject;
  return (
    a.type === b.type &&
    a.extractable === b.extractable &&
    innerDeepEqual(a.algorithm, b.algorithm, mode, memos) &&
    innerDeepEqual(a.usages, b.usages, mode, memos) &&
    KeyObject.from(a).equals(KeyObject.from(b))
  );
}

function hasOwn(obj, key) {
  return ObjectPrototypeHasOwnProperty.$call(obj, key);
}

function hasEnumerable(obj, key) {
  return ObjectPrototypePropertyIsEnumerable.$call(obj, key);
}

// `isError` from Node's `internal/util`: native errors (including cross-realm
// ones) or anything inheriting from `Error`.
function isError(e) {
  return ErrorIsError(e) || e instanceof Error;
}

// `isURL` from Node's `internal/url`.
function isURL(value) {
  return value instanceof URLConstructor;
}

// `internalBinding('buffer').compare` equivalent: a byte-wise memcmp of two
// ArrayBufferViews (not necessarily Uint8Arrays).
function compareViewBytes(a, b) {
  return BufferCompare(
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
    new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );
}

// Check if they have the same source and flags
function areSimilarRegExps(a, b) {
  return a.source === b.source && a.flags === b.flags && a.lastIndex === b.lastIndex;
}

function isPartialUint8Array(a, b) {
  const lenA = TypedArrayPrototypeGetByteLength(a);
  const lenB = TypedArrayPrototypeGetByteLength(b);
  if (lenA < lenB) {
    return false;
  }
  let offsetA = 0;
  for (let offsetB = 0; offsetB < lenB; offsetB++) {
    while (a[offsetA] !== b[offsetB]) {
      offsetA++;
      if (offsetA > lenA - lenB + offsetB) {
        return false;
      }
    }
    offsetA++;
  }
  return true;
}

function isPartialArrayBufferView(a, b) {
  if (a.byteLength < b.byteLength) {
    return false;
  }
  return isPartialUint8Array(
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
    new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );
}

function areSimilarFloatArrays(a, b) {
  const len = TypedArrayPrototypeGetByteLength(a);
  if (len !== TypedArrayPrototypeGetByteLength(b)) {
    return false;
  }
  for (let offset = 0; offset < len; offset++) {
    if (a[offset] !== b[offset]) {
      return false;
    }
  }
  return true;
}

function areSimilarTypedArrays(a, b) {
  return a.byteLength === b.byteLength && compareViewBytes(a, b) === 0;
}

function areEqualArrayBuffers(buf1, buf2) {
  return buf1.byteLength === buf2.byteLength && BufferCompare(new Uint8Array(buf1), new Uint8Array(buf2)) === 0;
}

function isEqualBoxedPrimitive(val1, val2) {
  if (isNumberObject(val1)) {
    return isNumberObject(val2) && ObjectIs(NumberPrototypeValueOf.$call(val1), NumberPrototypeValueOf.$call(val2));
  }
  if (isStringObject(val1)) {
    return isStringObject(val2) && StringPrototypeValueOf.$call(val1) === StringPrototypeValueOf.$call(val2);
  }
  if (isBooleanObject(val1)) {
    return isBooleanObject(val2) && BooleanPrototypeValueOf.$call(val1) === BooleanPrototypeValueOf.$call(val2);
  }
  if (isBigIntObject(val1)) {
    return isBigIntObject(val2) && BigIntPrototypeValueOf.$call(val1) === BigIntPrototypeValueOf.$call(val2);
  }
  // The caller already verified `isBoxedPrimitive(val1)`, so a Symbol object
  // is the only case left.
  return isSymbolObject(val2) && SymbolPrototypeValueOf.$call(val1) === SymbolPrototypeValueOf.$call(val2);
}

function isEnumerableOrIdentical(val1, val2, prop, mode, memos) {
  return (
    hasEnumerable(val2, prop) || // This is handled by Object.keys()
    (mode === kPartial && (val2[prop] === undefined || (prop === "message" && val2[prop] === ""))) ||
    innerDeepEqual(val1[prop], val2[prop], mode, memos)
  );
}

function innerDeepEqual(val1, val2, mode, memos) {
  // All identical values are equivalent, as determined by ===.
  if (val1 === val2) {
    return val1 !== 0 || ObjectIs(val1, val2) || mode === kLoose;
  }

  // Check more closely if val1 and val2 are equal.
  if (mode !== kLoose) {
    if (typeof val1 === "number") {
      // Check for NaN
      return val1 !== val1 && val2 !== val2;
    }
    if (typeof val2 !== "object" || typeof val1 !== "object" || val1 === null || val2 === null) {
      return false;
    }
  } else {
    if (val1 === null || typeof val1 !== "object") {
      return (
        (val2 === null || typeof val2 !== "object") &&
        // Check for NaN
        // eslint-disable-next-line eqeqeq
        (val1 == val2 || (val1 !== val1 && val2 !== val2))
      );
    }
    if (val2 === null || typeof val2 !== "object") {
      return false;
    }
  }
  return objectComparisonStart(val1, val2, mode, memos);
}

function hasUnequalTag(val1, val2) {
  return val1[SymbolToStringTag] !== val2[SymbolToStringTag];
}

function slowHasUnequalTag(val1Tag, val1, val2) {
  if (val1[SymbolToStringTag] !== undefined && val2[SymbolToStringTag] !== undefined) {
    return val1[SymbolToStringTag] !== val2[SymbolToStringTag];
  }
  return val1Tag !== ObjectPrototypeToString.$call(val2);
}

function objectComparisonStart(val1, val2, mode, memos) {
  if (mode === kStrict) {
    const constructor1 = val1.constructor;
    if (wellKnownConstructors.has(constructor1) || (constructor1 !== undefined && !hasOwn(val1, "constructor"))) {
      if (constructor1 !== val2.constructor) {
        return false;
      }
    } else if (ObjectGetPrototypeOf(val1) !== ObjectGetPrototypeOf(val2)) {
      return false;
    }
  }

  if (ArrayIsArray(val1)) {
    if (
      !ArrayIsArray(val2) ||
      (val1.length !== val2.length && (mode !== kPartial || val1.length < val2.length)) ||
      hasUnequalTag(val1, val2)
    ) {
      return false;
    }

    const filter = mode !== kLoose ? ONLY_ENUMERABLE : ONLY_ENUMERABLE | SKIP_SYMBOLS;
    const keys2 = getOwnNonIndexProperties(val2, filter);
    if (mode !== kPartial && keys2.length !== getOwnNonIndexProperties(val1, filter).length) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, kIsArray, keys2);
  }

  let val1Tag;
  if (val1[SymbolToStringTag] === undefined && (val1Tag = ObjectPrototypeToString.$call(val1)) === "[object Object]") {
    if (slowHasUnequalTag(val1Tag, val1, val2)) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, kNoIterator);
  } else if (isSet(val1)) {
    if (
      !isSet(val2) ||
      (val1.size !== val2.size && (mode !== kPartial || val1.size < val2.size)) ||
      hasUnequalTag(val1, val2)
    ) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, kIsSet);
  } else if (isMap(val1)) {
    if (
      !isMap(val2) ||
      (val1.size !== val2.size && (mode !== kPartial || val1.size < val2.size)) ||
      hasUnequalTag(val1, val2)
    ) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, kIsMap);
  } else if (isArrayBufferView(val1)) {
    if (TypedArrayPrototypeGetSymbolToStringTag(val1) !== TypedArrayPrototypeGetSymbolToStringTag(val2)) {
      return false;
    }
    if (mode === kPartial && val1.byteLength !== val2.byteLength) {
      if (!isPartialArrayBufferView(val1, val2)) {
        return false;
      }
    } else if (mode === kLoose && (isFloat32Array(val1) || isFloat64Array(val1) || isFloat16Array(val1))) {
      if (!areSimilarFloatArrays(val1, val2)) {
        return false;
      }
    } else if (!areSimilarTypedArrays(val1, val2)) {
      return false;
    }
    // Buffer.compare returns true, so val1.length === val2.length. If they both
    // only contain numeric keys, we don't need to exam further than checking
    // the symbols.
    const filter = mode !== kLoose ? ONLY_ENUMERABLE : ONLY_ENUMERABLE | SKIP_SYMBOLS;
    const keys2 = getOwnNonIndexProperties(val2, filter);
    if (mode !== kPartial && keys2.length !== getOwnNonIndexProperties(val1, filter).length) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, kNoIterator, keys2);
  } else if (isDate(val1)) {
    if (!isDate(val2) || hasUnequalTag(val1, val2)) {
      return false;
    }
    const time1 = DatePrototypeGetTime.$call(val1);
    const time2 = DatePrototypeGetTime.$call(val2);
    if (time1 !== time2 && (time1 === time1 || time2 === time2)) {
      return false;
    }
  } else if (isRegExp(val1)) {
    if (!isRegExp(val2) || !areSimilarRegExps(val1, val2) || hasUnequalTag(val1, val2)) {
      return false;
    }
  } else if (isAnyArrayBuffer(val1)) {
    if (!isAnyArrayBuffer(val2) || hasUnequalTag(val1, val2)) {
      return false;
    }
    if (mode !== kPartial || val1.byteLength === val2.byteLength) {
      if (!areEqualArrayBuffers(val1, val2)) {
        return false;
      }
    } else if (!isPartialUint8Array(new Uint8Array(val1), new Uint8Array(val2))) {
      return false;
    }
  } else if (
    slowHasUnequalTag(val1Tag ?? ObjectPrototypeToString.$call(val1), val1, val2) ||
    ArrayIsArray(val2) ||
    isArrayBufferView(val2) ||
    isSet(val2) ||
    isMap(val2) ||
    isDate(val2) ||
    isRegExp(val2) ||
    isAnyArrayBuffer(val2)
  ) {
    return false;
  } else if (isError(val1)) {
    // Do not compare the stack as it might differ even though the error itself
    // is otherwise identical.
    if (
      !isError(val2) ||
      !isEnumerableOrIdentical(val1, val2, "message", mode, memos) ||
      !isEnumerableOrIdentical(val1, val2, "name", mode, memos) ||
      !isEnumerableOrIdentical(val1, val2, "cause", mode, memos) ||
      !isEnumerableOrIdentical(val1, val2, "errors", mode, memos)
    ) {
      return false;
    }
    const hasOwnVal2Cause = hasOwn(val2, "cause");
    if (hasOwnVal2Cause !== hasOwn(val1, "cause") && (mode !== kPartial || hasOwnVal2Cause)) {
      return false;
    }
  } else if (isBoxedPrimitive(val1)) {
    if (!isEqualBoxedPrimitive(val1, val2)) {
      return false;
    }
  } else if (isURL(val1)) {
    if (!isURL(val2) || val1.href !== val2.href) {
      return false;
    }
  } else if (isKeyObject(val1)) {
    if (!isKeyObject(val2) || !areEqualKeyObjects(val1, val2)) {
      return false;
    }
  } else if (isCryptoKey(val1)) {
    if (!isCryptoKey(val2) || !areEqualCryptoKeys(val1, val2, mode, memos)) {
      return false;
    }
  } else if (
    isBoxedPrimitive(val2) ||
    isNativeError(val2) ||
    val2 instanceof Error ||
    isWeakMap(val1) ||
    isWeakSet(val1) ||
    isPromise(val1)
  ) {
    return false;
  }

  return keyCheck(val1, val2, mode, memos, kNoIterator);
}

function partialSymbolEquiv(val1, val2, keys2) {
  const symbolKeys = ObjectGetOwnPropertySymbols(val2);
  if (symbolKeys.length !== 0) {
    for (const key of symbolKeys) {
      if (hasEnumerable(val2, key)) {
        ArrayPrototypePush.$call(keys2, key);
      }
    }
  }
  return true;
}

function keyCheck(val1, val2, mode, memos, iterationType, keys2?) {
  // For all remaining Object pairs, including Array, objects and Maps,
  // equivalence is determined by having:
  // a) The same number of owned enumerable properties
  // b) The same set of keys/indexes (although not necessarily the same order)
  // c) Equivalent values for every corresponding key/index
  // d) For Sets and Maps, equal contents
  // Note: this accounts for both named and indexed properties on Arrays.
  const isArrayLikeObject = keys2 !== undefined;

  if (keys2 === undefined) {
    keys2 = ObjectKeys(val2);
  }
  let keys1;

  if (!isArrayLikeObject) {
    // The pair must have the same number of owned properties.
    if (mode === kPartial) {
      if (!partialSymbolEquiv(val1, val2, keys2)) {
        return false;
      }
    } else if (keys2.length !== (keys1 = ObjectKeys(val1)).length) {
      return false;
    } else if (mode === kStrict || mode === kStrictWithoutPrototypes) {
      for (const key of ObjectGetOwnPropertySymbols(val1)) {
        if (hasEnumerable(val1, key)) {
          ArrayPrototypePush.$call(keys1, key);
        }
      }
      for (const key of ObjectGetOwnPropertySymbols(val2)) {
        if (hasEnumerable(val2, key)) {
          ArrayPrototypePush.$call(keys2, key);
        }
      }
      if (keys1.length !== keys2.length) {
        return false;
      }
    }
  }

  if (
    keys2.length === 0 &&
    (iterationType === kNoIterator || (iterationType === kIsArray && val2.length === 0) || val2.size === 0)
  ) {
    return true;
  }

  if (memos === null) {
    return objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  }
  return handleCycles(val1, val2, mode, keys1, keys2, memos, iterationType);
}

function handleCycles(val1, val2, mode, keys1, keys2, memos, iterationType) {
  // Use memos to handle cycles.
  if (memos === undefined) {
    memos = {
      set: undefined,
      a: val1,
      b: val2,
      c: undefined,
      d: undefined,
      deep: false,
    };
    return objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  }

  if (memos.set === undefined) {
    if (memos.deep === false) {
      if (memos.a === val1) {
        return memos.b === val2;
      }
      if (memos.b === val2) {
        return false;
      }
      memos.c = val1;
      memos.d = val2;
      memos.deep = true;
      const result = objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
      memos.deep = false;
      // objEquiv may have created the set in a deeper recursive call.
      const { set } = memos;
      if (set !== undefined) {
        set.delete(memos.c);
        set.delete(memos.d);
      }
      return result;
    }
    memos.set = new SafeSet();
    memos.set.add(memos.a);
    memos.set.add(memos.b);
    memos.set.add(memos.c);
    memos.set.add(memos.d);
  }

  const { set } = memos;

  const originalSize = set.size;
  set.add(val1);
  set.add(val2);
  const newSize = set.size;
  if (originalSize !== newSize - 2) {
    return originalSize === newSize;
  }

  const areEq = objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);

  set.delete(val1);
  set.delete(val2);

  return areEq;
}

// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness#Loose_equality_using
// Sadly it is not possible to detect corresponding values properly in case the
// type is a string, number, bigint or boolean. The reason is that those values
// can match lots of different string values (e.g., 1n == '+00001').
function findLooseMatchingPrimitives(prim) {
  switch (typeof prim) {
    case "undefined":
      return null;
    case "object": // Only pass in null as object!
      return undefined;
    case "symbol":
      return false;
    case "string":
    case "number":
      // Loose equal entries exist only if the value is possible to convert to
      // a regular number and not NaN.
      prim = +prim;
      if (prim !== prim) {
        return false;
      }
  }
  return true;
}

function setMightHaveLoosePrim(a, b, prim) {
  const altValue = findLooseMatchingPrimitives(prim);
  if (altValue != null) return altValue;

  return !b.has(altValue) && a.has(altValue);
}

function mapMightHaveLoosePrim(a, b, prim, item2, memo) {
  const altValue = findLooseMatchingPrimitives(prim);
  if (altValue != null) {
    return altValue;
  }
  const item1 = a.get(altValue);
  if ((item1 === undefined && !a.has(altValue)) || !innerDeepEqual(item1, item2, kLoose, memo)) {
    return false;
  }
  return !b.has(altValue) && innerDeepEqual(item1, item2, kLoose, memo);
}

function partialObjectSetEquiv(array, a, b, mode, memo) {
  let aPos = 0;
  let direction = 1;
  let start = 0;
  let end = array.length - 1;
  for (const val1 of a) {
    aPos++;
    if (!b.has(val1)) {
      let innerStart = start;
      if (direction === 1) {
        if (innerDeepEqual(val1, array[start], mode, memo)) {
          if (start === end) {
            return true;
          }
          start += 1;
          continue;
        }
        if (start === end) {
          // The last element of set b might match a later element in set a.
          continue;
        }
        direction = -1;
        innerStart += 1;
      }
      let matched = true;
      if (!innerDeepEqual(val1, array[end], mode, memo)) {
        direction = 1;
        matched = arrayHasEqualElement(array, val1, mode, memo, innerDeepEqual, innerStart, end);
      }
      if (matched) {
        if (start === end) {
          return true;
        }
        end -= 1;
      }
    }
    if (a.size - aPos <= end - start) {
      return false;
    }
  }
  return false;
}

function arrayHasEqualElement(array, val1, mode, memo, comparator, start, end) {
  for (let i = end - 1; i >= start; i--) {
    if (comparator(val1, array[i], mode, memo)) {
      // Move the matching element to make sure we do not check that again.
      array[i] = array[end];
      return true;
    }
  }
  return false;
}

function setObjectEquiv(array, a, b, mode, memo) {
  let direction = 1;
  let start = 0;
  let end = array.length - 1;
  const comparator = mode !== kLoose ? objectComparisonStart : innerDeepEqual;
  const extraChecks = mode === kLoose || array.length !== a.size;
  for (const val1 of a) {
    if (extraChecks) {
      if (typeof val1 === "object") {
        if (b.has(val1)) {
          continue;
        }
      } else if (b.has(val1)) {
        continue;
      } else if (mode !== kLoose) {
        return false;
      }
    }

    let innerStart = start;
    if (direction === 1) {
      if (comparator(val1, array[start], mode, memo)) {
        start += 1;
        continue;
      }
      if (start === end) {
        return false;
      }
      direction = -1;
      innerStart += 1;
    }
    if (!comparator(val1, array[end], mode, memo)) {
      direction = 1;
      if (!arrayHasEqualElement(array, val1, mode, memo, comparator, innerStart, end)) {
        return false;
      }
    }
    end -= 1;
  }
  return true;
}

function compareSmallSets(a, b, val, iteratorB, mode, memo) {
  const iteratorA = a.values();
  const firstA = iteratorA.next().value;
  const first = innerDeepEqual(firstA, val, mode, memo);
  if (first) {
    if (b.size === 1) {
      // Partial mode && a.size === 1 || b.size === 1
      return true;
    }
    const secondA = iteratorA.next().value;
    return b.has(secondA) || innerDeepEqual(secondA, iteratorB.next().value, mode, memo);
  }
  return (
    a.size !== 1 &&
    innerDeepEqual(iteratorA.next().value, val, mode, memo) &&
    (b.size === 1 || // Partial mode
      b.has(firstA) || // Primitive or reference equal
      innerDeepEqual(firstA, iteratorB.next().value, mode, memo))
  );
}

function setEquiv(a, b, mode, memo) {
  // This is a lazily initiated Set of entries which have to be compared
  // pairwise.
  let array;

  const iteratorB = b.values();
  for (const val of iteratorB) {
    if (!a.has(val)) {
      if ((typeof val !== "object" || val === null) && (mode !== kLoose || !setMightHaveLoosePrim(a, b, val))) {
        return false;
      }

      if (array === undefined) {
        if (a.size < 3) {
          return compareSmallSets(a, b, val, iteratorB, mode, memo);
        }
        array = [];
      }
      // If the specified value doesn't exist in the second set it's a object
      // (or in loose mode: a non-matching primitive). Find the
      // deep-(mode-)equal element in a set copy to reduce duplicate checks.
      ArrayPrototypePush.$call(array, val);
    }
  }

  if (array === undefined) {
    return true;
  }
  if (mode === kPartial) {
    return partialObjectSetEquiv(array, a, b, mode, memo);
  }
  return setObjectEquiv(array, a, b, mode, memo);
}

function partialObjectMapEquiv(array, a, b, mode, memo) {
  let aPos = 0;
  let direction = 1;
  let start = 0;
  let end = array.length - 1;
  for (const { 0: key1, 1: item1 } of a) {
    aPos++;
    if (typeof key1 === "object" && key1 !== null) {
      let innerStart = start;
      if (direction === 1) {
        const key2 = array[start];
        if (objectComparisonStart(key1, key2, mode, memo) && innerDeepEqual(item1, b.get(key2), mode, memo)) {
          if (start === end) {
            return true;
          }
          start += 1;
          continue;
        }
        if (start === end) {
          // The last element of map b might match a later element in map a.
          continue;
        }
        direction = -1;
        innerStart += 1;
      }
      let matched = true;
      const key2 = array[end];
      if (!objectComparisonStart(key1, key2, mode, memo) || !innerDeepEqual(item1, b.get(key2), mode, memo)) {
        direction = 1;
        matched = arrayHasEqualMapElement(array, key1, item1, b, mode, memo, objectComparisonStart, innerStart, end);
      }
      if (matched) {
        if (start === end) {
          return true;
        }
        end -= 1;
      }
    }
    if (a.size - aPos <= end - start) {
      return false;
    }
  }
  return false;
}

function arrayHasEqualMapElement(array, key1, item1, b, mode, memo, comparator, start, end) {
  for (let i = end - 1; i >= start; i--) {
    const key2 = array[i];
    if (comparator(key1, key2, mode, memo) && innerDeepEqual(item1, b.get(key2), mode, memo)) {
      // Move the matching element to make sure we do not check that again.
      array[i] = array[end];
      return true;
    }
  }
  return false;
}

function mapObjectEquiv(array, a, b, mode, memo) {
  let direction = 1;
  let start = 0;
  let end = array.length - 1;
  const comparator = mode !== kLoose ? objectComparisonStart : innerDeepEqual;
  const extraChecks = mode === kLoose || array.length !== a.size;

  for (const { 0: key1, 1: item1 } of a) {
    if (extraChecks && (typeof key1 !== "object" || key1 === null)) {
      if (b.has(key1)) {
        if (mode !== kLoose || innerDeepEqual(item1, b.get(key1), mode, memo)) {
          continue;
        }
      } else if (mode !== kLoose) {
        return false;
      }
    }

    let innerStart = start;
    if (direction === 1) {
      const key2 = array[start];
      if (comparator(key1, key2, mode, memo) && innerDeepEqual(item1, b.get(key2), mode, memo)) {
        start += 1;
        continue;
      }
      if (start === end) {
        return false;
      }
      direction = -1;
      innerStart += 1;
    }
    const key2 = array[end];
    if (!comparator(key1, key2, mode, memo) || !innerDeepEqual(item1, b.get(key2), mode, memo)) {
      direction = 1;
      if (!arrayHasEqualMapElement(array, key1, item1, b, mode, memo, comparator, innerStart, end)) {
        return false;
      }
    }
    end -= 1;
  }
  return true;
}

function mapEquiv(a, b, mode, memo) {
  let array;

  for (const { 0: key2, 1: item2 } of b) {
    if (typeof key2 === "object" && key2 !== null) {
      if (array === undefined) {
        if (a.size === 1) {
          const { 0: key1, 1: item1 } = a.entries().next().value;
          return innerDeepEqual(key1, key2, mode, memo) && innerDeepEqual(item1, item2, mode, memo);
        }
        array = [];
      }
      ArrayPrototypePush.$call(array, key2);
    } else {
      // By directly retrieving the value we prevent another b.has(key2) check in
      // almost all possible cases.
      const item1 = a.get(key2);
      if ((item1 === undefined && !a.has(key2)) || !innerDeepEqual(item1, item2, mode, memo)) {
        if (mode !== kLoose) return false;
        // Fast path to detect missing string, symbol, undefined and null
        // keys.
        if (!mapMightHaveLoosePrim(a, b, key2, item2, memo)) return false;
        if (array === undefined) {
          array = [];
        }
        ArrayPrototypePush.$call(array, key2);
      }
    }
  }

  if (array === undefined) {
    return true;
  }

  if (mode === kPartial) {
    return partialObjectMapEquiv(array, a, b, mode, memo);
  }

  return mapObjectEquiv(array, a, b, mode, memo);
}

function partialSparseArrayEquiv(a, b, mode, memos, startA, startB) {
  let aPos = startA;
  const keysA = ObjectKeys(a);
  const keysB = ObjectKeys(b);
  const lenA = keysA.length - startA;
  const lenB = keysB.length - startB;
  if (lenA < lenB) {
    return false;
  }
  for (let i = 0; i < lenB; i++) {
    const keyB = keysB[startB + i];
    while (!innerDeepEqual(a[keysA[aPos]], b[keyB], mode, memos)) {
      aPos++;
      if (aPos > keysA.length - lenB + i) {
        return false;
      }
    }
    aPos++;
  }
  return true;
}

function partialArrayEquiv(a, b, mode, memos) {
  let aPos = 0;
  for (let i = 0; i < b.length; i++) {
    let isSparse = b[i] === undefined && !hasOwn(b, i);
    if (isSparse) {
      return partialSparseArrayEquiv(a, b, mode, memos, aPos, i);
    }
    while (!(isSparse = a[aPos] === undefined && !hasOwn(a, aPos)) && !innerDeepEqual(a[aPos], b[i], mode, memos)) {
      aPos++;
      if (aPos > a.length - b.length + i) {
        return false;
      }
    }
    if (isSparse) {
      return partialSparseArrayEquiv(a, b, mode, memos, aPos, i);
    }
    aPos++;
  }
  return true;
}

function sparseArrayEquiv(a, b, mode, memos, i) {
  const keysA = ObjectKeys(a);
  const keysB = ObjectKeys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (; i < keysB.length; i++) {
    const key = keysB[i];
    if ((a[key] === undefined && !hasOwn(a, key)) || !innerDeepEqual(a[key], b[key], mode, memos)) {
      return false;
    }
  }
  return true;
}

function objEquiv(a, b, mode, keys1, keys2, memos, iterationType) {
  const keys2Length = keys2.length;
  // The pair must have equivalent values for every corresponding key.
  if (keys2Length > 0) {
    let i = 0;
    // Ordered keys
    if (keys1 !== undefined) {
      for (; i < keys2Length; i++) {
        const key = keys2[i];
        if (keys1[i] !== key) {
          break;
        }
        if (!innerDeepEqual(a[key], b[key], mode, memos)) {
          return false;
        }
      }
    }
    // Unordered keys
    for (; i < keys2Length; i++) {
      const key = keys2[i];
      // It is faster to get the whole descriptor and to check it's enumerable
      // property in V8 13.0 compared to calling Object.propertyIsEnumerable()
      // and accessing the property regularly.
      const descriptor = ObjectGetOwnPropertyDescriptor(a, key);
      if (descriptor === undefined || descriptor.enumerable !== true) {
        return false;
      }
      const value = descriptor.writable !== undefined ? descriptor.value : a[key];
      if (!innerDeepEqual(value, b[key], mode, memos)) {
        return false;
      }
    }
  }

  if (iterationType === kIsArray) {
    if (mode === kPartial) {
      return partialArrayEquiv(a, b, mode, memos);
    }
    for (let i = 0; i < a.length; i++) {
      if (b[i] === undefined) {
        if (!hasOwn(b, i)) return sparseArrayEquiv(a, b, mode, memos, i);
        if ((a[i] !== undefined || !hasOwn(a, i)) && (mode !== kLoose || a[i] !== null)) return false;
      } else if (
        (a[i] === undefined || !innerDeepEqual(a[i], b[i], mode, memos)) &&
        (mode !== kLoose || b[i] !== null)
      ) {
        return false;
      }
    }
  } else if (iterationType === kIsSet) {
    if (!setEquiv(a, b, mode, memos)) {
      return false;
    }
  } else if (iterationType === kIsMap) {
    if (!mapEquiv(a, b, mode, memos)) {
      return false;
    }
  }

  return true;
}

// Only handle cycles when they are detected.
let detectCycles: (val1: unknown, val2: unknown, mode: number, memos?: unknown) => boolean = function (
  val1,
  val2,
  mode,
) {
  try {
    return innerDeepEqual(val1, val2, mode, null);
  } catch {
    // Stack overflow: the values (probably) contain cycles. Switch to the
    // slower, memoized comparison permanently.
    detectCycles = innerDeepEqual;
    return innerDeepEqual(val1, val2, mode, undefined);
  }
};

export default {
  isDeepEqual(val1, val2) {
    return detectCycles(val1, val2, kLoose);
  },
  isDeepStrictEqual(val1, val2, skipPrototype?) {
    return detectCycles(val1, val2, skipPrototype ? kStrictWithoutPrototypes : kStrict);
  },
  isPartialStrictEqual(val1, val2) {
    return detectCycles(val1, val2, kPartial);
  },
};
