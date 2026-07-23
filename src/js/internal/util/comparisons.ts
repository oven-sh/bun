// Deep-strict-equality helpers shared by node:assert and node:util.
"use strict";

const { SafeMap, SafeSet, SafeWeakSet } = require("internal/primordials");
const {
  isRegExp,
  isMap,
  isSet,
  isDate,
  isAnyArrayBuffer,
  isBoxedPrimitive,
  isNumberObject,
  isStringObject,
  isBooleanObject,
  isBigIntObject,
  isSymbolObject,
} = require("node:util/types");

const ArrayFrom = Array.from;
const ArrayPrototypePush = Array.prototype.push;
const ArrayBufferIsView = ArrayBuffer.isView;
const BigIntPrototypeValueOf = BigInt.prototype.valueOf;
const BooleanPrototypeValueOf = Boolean.prototype.valueOf;
const DatePrototypeGetTime = Date.prototype.getTime;
const NumberIsNaN = Number.isNaN;
const NumberPrototypeValueOf = Number.prototype.valueOf;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectPrototypePropertyIsEnumerable = Object.prototype.propertyIsEnumerable;
const ObjectPrototypeToString = Object.prototype.toString;
const StringPrototypeValueOf = String.prototype.valueOf;
const SymbolIterator = Symbol.iterator;
const SymbolPrototypeValueOf = Symbol.prototype.valueOf;

const SafeSetPrototypeIterator = SafeSet.prototype[SymbolIterator];
const SafeMapPrototypeIterator = SafeMap.prototype[SymbolIterator];
const SafeMapPrototypeHas = SafeMap.prototype.has;
const SafeMapPrototypeGet = SafeMap.prototype.get;

// Node semantics: strict deepEquals plus node's [[Prototype]] identity rule
// (Bun.deepEquals stays prototype-blind).
const nodeDeepStrictEqual = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionIsDeepStrictEqual", 2);

function isDeepStrictEqual(a, b, skipPrototype?) {
  if (skipPrototype) {
    return skipProtoDeepStrictEqual(a, b);
  }
  return nodeDeepStrictEqual(a, b);
}

// Path-scoped cycle detection tracking each side separately: a cycle is accepted
// only when actual and expected each cycle back on their own side together.
function withCycleGuard(actual, expected, comparedObjects, body) {
  comparedObjects ??= { a: new SafeWeakSet(), b: new SafeWeakSet() };
  const { a: seenActual, b: seenExpected } = comparedObjects;
  const hadActual = seenActual.has(actual);
  const hadExpected = seenExpected.has(expected);
  if (hadActual && hadExpected) return true;
  if (hadActual || hadExpected) return false;
  seenActual.add(actual);
  seenExpected.add(expected);
  const result = body(actual, expected, comparedObjects);
  seenActual.delete(actual);
  seenExpected.delete(expected);
  return result;
}

// Deep-strict-equal ignoring prototype/constructor identity (`skipPrototype` option).
// Mirrors node's kStrictWithoutPrototypes mode: identical to strict comparison except
// the prototype identity gate is skipped (type tags are still compared).
function skipProtoDeepStrictEqual(val1, val2, memos?) {
  if (val1 === val2) {
    return val1 !== 0 || ObjectIs(val1, val2);
  }
  if (typeof val1 === "number") {
    return NumberIsNaN(val1) && NumberIsNaN(val2);
  }
  if (typeof val1 !== "object" || typeof val2 !== "object" || val1 === null || val2 === null) {
    return false;
  }
  // Bun.deepEquals(strict) is prototype-blind (see header note), so a true
  // result can only short-circuit this prototype-skipping mode; inequality
  // still falls through to the node-correct body below.
  if (Bun.deepEquals(val1, val2, true)) {
    return true;
  }
  return withCycleGuard(val1, val2, memos, skipProtoObjectBody);
}

function skipProtoObjectBody(val1, val2, memos) {
  if (isDate(val1) || isDate(val2)) {
    if (!isDate(val1) || !isDate(val2)) return false;
    const time1 = DatePrototypeGetTime.$call(val1);
    const time2 = DatePrototypeGetTime.$call(val2);
    if (time1 !== time2 && !(NumberIsNaN(time1) && NumberIsNaN(time2))) return false;
  } else if (isRegExp(val1) || isRegExp(val2)) {
    if (!isRegExp(val1) || !isRegExp(val2) || val1.source !== val2.source || val1.flags !== val2.flags) {
      return false;
    }
  } else if (ArrayBufferIsView(val1) || ArrayBufferIsView(val2)) {
    if (
      !ArrayBufferIsView(val1) ||
      !ArrayBufferIsView(val2) ||
      ObjectPrototypeToString.$call(val1) !== ObjectPrototypeToString.$call(val2) ||
      val1.byteLength !== val2.byteLength ||
      !equalRawBytes(
        new Uint8Array(val1.buffer, val1.byteOffset, val1.byteLength),
        new Uint8Array(val2.buffer, val2.byteOffset, val2.byteLength),
      )
    ) {
      return false;
    }
  } else if (isAnyArrayBuffer(val1) || isAnyArrayBuffer(val2)) {
    if (
      !isAnyArrayBuffer(val1) ||
      !isAnyArrayBuffer(val2) ||
      val1.byteLength !== val2.byteLength ||
      !equalRawBytes(new Uint8Array(val1), new Uint8Array(val2))
    ) {
      return false;
    }
  } else if (isMap(val1) || isMap(val2)) {
    if (!isMap(val1) || !isMap(val2) || val1.size !== val2.size || !skipProtoMapEquiv(val1, val2, memos)) {
      return false;
    }
  } else if (isSet(val1) || isSet(val2)) {
    if (!isSet(val1) || !isSet(val2) || val1.size !== val2.size || !skipProtoSetEquiv(val1, val2, memos)) {
      return false;
    }
  } else if ($isArray(val1) || $isArray(val2)) {
    if (!$isArray(val1) || !$isArray(val2) || val1.length !== val2.length) {
      return false;
    }
  } else if (isBoxedPrimitive(val1) || isBoxedPrimitive(val2)) {
    if (!skipProtoEqualBoxedPrimitive(val1, val2)) {
      return false;
    }
  } else if (Error.isError(val1) || Error.isError(val2)) {
    if (!Error.isError(val1) || !Error.isError(val2) || val1.message !== val2.message || val1.name !== val2.name) {
      return false;
    }
  } else if (ObjectPrototypeToString.$call(val1) !== ObjectPrototypeToString.$call(val2)) {
    return false;
  }
  return skipProtoOwnProps(val1, val2, memos);
}

function equalRawBytes(u1, u2) {
  for (let i = 0; i < u1.length; i++) {
    if (u1[i] !== u2[i]) return false;
  }
  return true;
}

function skipProtoEqualBoxedPrimitive(val1, val2) {
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
  if (isSymbolObject(val1)) {
    return isSymbolObject(val2) && SymbolPrototypeValueOf.$call(val1) === SymbolPrototypeValueOf.$call(val2);
  }
  return false;
}

function skipProtoMapEquiv(map1, map2, memos) {
  const entries2 = ArrayFrom(SafeMapPrototypeIterator.$call(map2));
  const used = new SafeSet();
  const iterator1 = SafeMapPrototypeIterator.$call(map1);
  entryIteration: for (const { 0: key1, 1: value1 } of iterator1) {
    // Fast path: identical key present on both sides. Consume the matched
    // entry's index so the deep-equality loop below cannot reuse it (sizes
    // are equal, so double-consumption would leave another entry unmatched
    // and wrongly report the maps equal).
    if (SafeMapPrototypeHas.$call(map2, key1)) {
      let identityIndex = -1;
      for (let i = 0; i < entries2.length; i++) {
        if (entries2[i][0] === key1) {
          identityIndex = i;
          break;
        }
      }
      if (
        identityIndex !== -1 &&
        !used.has(identityIndex) &&
        skipProtoDeepStrictEqual(value1, entries2[identityIndex][1], memos)
      ) {
        used.add(identityIndex);
        continue;
      }
    }
    for (let i = 0; i < entries2.length; i++) {
      if (
        !used.has(i) &&
        skipProtoDeepStrictEqual(key1, entries2[i][0], memos) &&
        skipProtoDeepStrictEqual(value1, entries2[i][1], memos)
      ) {
        used.add(i);
        continue entryIteration;
      }
    }
    return false;
  }
  return true;
}

function skipProtoSetEquiv(set1, set2, memos) {
  const items2 = ArrayFrom(SafeSetPrototypeIterator.$call(set2));
  const used = new SafeSet();
  const iterator1 = SafeSetPrototypeIterator.$call(set1);
  itemIteration: for (const item1 of iterator1) {
    for (let i = 0; i < items2.length; i++) {
      if (!used.has(i) && skipProtoDeepStrictEqual(item1, items2[i], memos)) {
        used.add(i);
        continue itemIteration;
      }
    }
    return false;
  }
  return true;
}

function skipProtoOwnProps(val1, val2, memos) {
  const keys1 = ObjectKeys(val1);
  const keys2 = ObjectKeys(val2);
  if (keys1.length !== keys2.length) {
    return false;
  }
  for (const key of ObjectGetOwnPropertySymbols(val1)) {
    if (ObjectPrototypePropertyIsEnumerable.$call(val1, key)) {
      ArrayPrototypePush.$call(keys1, key);
    }
  }
  for (const key of ObjectGetOwnPropertySymbols(val2)) {
    if (ObjectPrototypePropertyIsEnumerable.$call(val2, key)) {
      ArrayPrototypePush.$call(keys2, key);
    }
  }
  if (keys1.length !== keys2.length) {
    return false;
  }
  for (let i = 0; i < keys1.length; i++) {
    const key = keys1[i];
    if (!ObjectPrototypeHasOwnProperty.$call(val2, key) || !skipProtoDeepStrictEqual(val1[key], val2[key], memos)) {
      return false;
    }
  }
  return true;
}

export default { isDeepStrictEqual, withCycleGuard };
