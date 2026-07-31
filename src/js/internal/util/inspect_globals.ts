// Built-ins captured for internal/util/inspect. node:util loads this eagerly (before user code
// can monkey-patch them); the large inspect implementation itself loads on first use.
const primordials = require("internal/primordials");
const { uncurryThis } = primordials;
const {
  MapPrototypeGetSize,
  SafeMap,
  SafeSet,
  SetPrototypeGetSize,
  TypedArrayPrototypeGetLength,
  TypedArrayPrototypeGetSymbolToStringTag,
} = primordials;

const ArrayFrom = Array.from;
const ArrayPrototypeFilter = uncurryThis(Array.prototype.filter);
const ArrayPrototypeFlat = uncurryThis(Array.prototype.flat);
const ArrayPrototypeForEach = uncurryThis(Array.prototype.forEach);
const ArrayPrototypeIncludes = uncurryThis(Array.prototype.includes);
const ArrayPrototypeIndexOf = uncurryThis(Array.prototype.indexOf);
const ArrayPrototypeJoin = uncurryThis(Array.prototype.join);
const ArrayPrototypeMap = uncurryThis(Array.prototype.map);
const ArrayPrototypePop = uncurryThis(Array.prototype.pop);
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = uncurryThis(Array.prototype.slice);
const ArrayPrototypeSplice = uncurryThis(Array.prototype.splice);
const ArrayPrototypeSort = uncurryThis(Array.prototype.sort);
const ArrayPrototypeUnshift = uncurryThis(Array.prototype.unshift);
const BigIntPrototypeValueOf = uncurryThis(BigInt.prototype.valueOf);
const BooleanPrototypeValueOf = uncurryThis(Boolean.prototype.valueOf);
const DatePrototypeGetTime = uncurryThis(Date.prototype.getTime);
const DatePrototypeToISOString = uncurryThis(Date.prototype.toISOString);
const DatePrototypeToString = uncurryThis(Date.prototype.toString);
const ErrorCaptureStackTrace = Error.captureStackTrace;
const ErrorPrototypeToString = uncurryThis(Error.prototype.toString);
const FunctionPrototypeBind = uncurryThis(Function.prototype.bind);
const FunctionPrototypeToString = uncurryThis(Function.prototype.toString);
const JSONStringify = JSON.stringify;
const MapPrototypeEntries = uncurryThis(Map.prototype.entries);
const MapPrototypeValues = uncurryThis(Map.prototype.values);
const MapPrototypeKeys = uncurryThis(Map.prototype.keys);
const MathFloor = Math.floor;
const MathMax = Math.max;
const MathRound = Math.round;
const MathSqrt = Math.sqrt;
const MathTrunc = Math.trunc;
const NumberIsFinite = Number.isFinite;
const NumberIsNaN = Number.isNaN;
const NumberParseFloat = Number.parseFloat;
const NumberParseInt = Number.parseInt;
const NumberPrototypeToString = uncurryThis(Number.prototype.toString);
const NumberPrototypeValueOf = uncurryThis(Number.prototype.valueOf);
const ObjectAssign = Object.assign;
const ObjectDefineProperty = Object.defineProperty;
const ObjectEntries = Object.entries;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIs = Object.is;
const ObjectKeys = Object.keys;
const ObjectPrototypeHasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);
const ObjectPrototypePropertyIsEnumerable = uncurryThis(Object.prototype.propertyIsEnumerable);
const ObjectPrototypeToString = uncurryThis(Object.prototype.toString);
const ObjectSeal = Object.seal;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ReflectOwnKeys = Reflect.ownKeys;
const RegExpPrototypeExec = uncurryThis(RegExp.prototype.exec);
const RegExpPrototypeSymbolReplace = uncurryThis(RegExp.prototype[Symbol.replace]);
const RegExpPrototypeSymbolSplit = uncurryThis(RegExp.prototype[Symbol.split]);
const RegExpPrototypeTest = uncurryThis(RegExp.prototype.test);
const RegExpPrototypeToString = uncurryThis(RegExp.prototype.toString);
const SetPrototypeEntries = uncurryThis(Set.prototype.entries);
const SetPrototypeValues = uncurryThis(Set.prototype.values);
const StringPrototypeCharCodeAt = uncurryThis(String.prototype.charCodeAt);
const StringPrototypeIncludes = uncurryThis(String.prototype.includes);
const StringPrototypeIndexOf = uncurryThis(String.prototype.indexOf);
const StringPrototypeLastIndexOf = uncurryThis(String.prototype.lastIndexOf);
const StringPrototypeMatch = uncurryThis(String.prototype.match);
const StringPrototypeNormalize = uncurryThis(String.prototype.normalize);
const StringPrototypePadEnd = uncurryThis(String.prototype.padEnd);
const StringPrototypePadStart = uncurryThis(String.prototype.padStart);
const StringPrototypeRepeat = uncurryThis(String.prototype.repeat);
const StringPrototypeReplaceAll = uncurryThis(String.prototype.replaceAll);
const StringPrototypeSlice = uncurryThis(String.prototype.slice);
const StringPrototypeSplit = uncurryThis(String.prototype.split);
const StringPrototypeEndsWith = uncurryThis(String.prototype.endsWith);
const StringPrototypeStartsWith = uncurryThis(String.prototype.startsWith);
const StringPrototypeToLowerCase = uncurryThis(String.prototype.toLowerCase);
const StringPrototypeTrim = uncurryThis(String.prototype.trim);
const StringPrototypeValueOf = uncurryThis(String.prototype.valueOf);
const SymbolPrototypeToString = uncurryThis(Symbol.prototype.toString);
const SymbolPrototypeValueOf = uncurryThis(Symbol.prototype.valueOf);
const SymbolIterator = Symbol.iterator;
const SymbolToStringTag = Symbol.toStringTag;

const builtInObjects = new SafeSet(
  ArrayPrototypeFilter(
    ObjectGetOwnPropertyNames(globalThis),
    e => RegExpPrototypeExec(/^[A-Z][a-zA-Z0-9]+$/, e) !== null,
  ),
);

const customInspectSymbol = Symbol.for("nodejs.util.inspect.custom");

let impl;
function loadImpl() {
  return (impl ??= require("internal/util/inspect"));
}
// The public `util.inspect`: a thin wrapper so node:util does not load the (large)
// inspect implementation eagerly; internal callers hand this same function to
// `[util.inspect.custom]` hooks so `arg === require("util").inspect` holds.
function publicInspect(_value, _opts) {
  return loadImpl().inspect.$apply(this, arguments);
}
Object.defineProperty(publicInspect, "name", { value: "inspect" });
publicInspect.custom = customInspectSymbol;
for (const key of ["defaultOptions", "replDefaults"] as const) {
  Object.defineProperty(publicInspect, key, {
    __proto__: null,
    get() {
      return loadImpl().inspect[key];
    },
    set(options) {
      loadImpl().inspect[key] = options;
    },
  });
}
for (const key of ["colors", "styles"] as const) {
  Object.defineProperty(publicInspect, key, {
    __proto__: null,
    get() {
      return loadImpl().inspect[key];
    },
    set(v) {
      loadImpl().inspect[key] = v;
    },
    enumerable: true,
    configurable: true,
  });
}

export default {
  builtInObjects,
  publicInspect,
  primordials,
  uncurryThis,
  ArrayFrom,
  ArrayPrototypeFilter,
  ArrayPrototypeFlat,
  ArrayPrototypeForEach,
  ArrayPrototypeIncludes,
  ArrayPrototypeIndexOf,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePop,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ArrayPrototypeSplice,
  ArrayPrototypeSort,
  ArrayPrototypeUnshift,
  BigIntPrototypeValueOf,
  BooleanPrototypeValueOf,
  DatePrototypeGetTime,
  DatePrototypeToISOString,
  DatePrototypeToString,
  ErrorCaptureStackTrace,
  ErrorPrototypeToString,
  FunctionPrototypeBind,
  FunctionPrototypeToString,
  JSONStringify,
  MapPrototypeEntries,
  MapPrototypeValues,
  MapPrototypeKeys,
  MathFloor,
  MathMax,
  MathRound,
  MathSqrt,
  MathTrunc,
  NumberIsFinite,
  NumberIsNaN,
  NumberParseFloat,
  NumberParseInt,
  NumberPrototypeToString,
  NumberPrototypeValueOf,
  ObjectAssign,
  ObjectDefineProperty,
  ObjectEntries,
  ObjectGetOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors,
  ObjectGetOwnPropertyNames,
  ObjectGetOwnPropertySymbols,
  ObjectGetPrototypeOf,
  ObjectIs,
  ObjectKeys,
  ObjectPrototypeHasOwnProperty,
  ObjectPrototypePropertyIsEnumerable,
  ObjectPrototypeToString,
  ObjectSeal,
  ObjectSetPrototypeOf,
  ReflectOwnKeys,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeSymbolSplit,
  RegExpPrototypeTest,
  RegExpPrototypeToString,
  SetPrototypeEntries,
  SetPrototypeValues,
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeMatch,
  StringPrototypeNormalize,
  StringPrototypePadEnd,
  StringPrototypePadStart,
  StringPrototypeRepeat,
  StringPrototypeReplaceAll,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeEndsWith,
  StringPrototypeStartsWith,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
  StringPrototypeValueOf,
  SymbolPrototypeToString,
  SymbolPrototypeValueOf,
  SymbolIterator,
  SymbolToStringTag,
  MapPrototypeGetSize,
  SafeMap,
  SafeSet,
  SetPrototypeGetSize,
  TypedArrayPrototypeGetLength,
  TypedArrayPrototypeGetSymbolToStringTag,
};
