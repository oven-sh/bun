// This file subclasses and stores the JS built-ins that come from the VM
// so that Node.js's built-in modules do not need to later look these up from
// the global proxy, which can be mutated by users.

// Use of primordials have sometimes a dramatic impact on performance, please
// benchmark all changes made in performance-sensitive areas of the codebase.
// See: https://github.com/nodejs/node/pull/38248

const primordials = $Object.$create(null);

const {
  $asyncIterator: SymbolAsyncIterator,
  $for: SymbolFor,
  $hasInstance: SymbolHasInstance,
  $isConcatSpreadable: SymbolIsConcatSpreadable,
  $iterator: SymbolIterator,
  $match: SymbolMatch,
  $matchAll: SymbolMatchAll,
  $replace: SymbolReplace,
  $search: SymbolSearch,
  $species: SymbolSpecies,
  $split: SymbolSplit,
  $toPrimitive: SymbolToPrimitive,
  $toStringTag: SymbolToStringTag,
  $unscopables: SymbolUnscopables,
} = $Symbol;

const { $defineProperty: ObjectDefineProperty, $freeze: ObjectFreeze } = $Object;

const defineProps = (object, thruples) => {
  for (let i = 0, { $length: length } = thruples; i < length; i += 3) {
    const key = thruples[i];
    const kind = thruples[i + 1];
    const value = thruples[i + 2];
    ObjectDefineProperty(object, key, $createObjectWithoutPrototype(kind, value));
  }
  return object;
};

const finishSafeCtor = SafeCtor => {
  $setPrototypeDirect.$call(SafeCtor.prototype, null);
  ObjectFreeze(SafeCtor.prototype);
  ObjectFreeze(SafeCtor);
  return SafeCtor;
};

const defineSafeCtor = (SafeCtor, { ctor, proto }) => {
  if (ctor) {
    defineProps(SafeCtor, ctor);
  }
  if (proto) {
    defineProps(SafeCtor.prototype, proto);
  }
  return finishSafeCtor(SafeCtor);
};

/**
 * Creates a class that can be safely iterated over.
 *
 * Because these functions are used by `makeSafe`, which is exposed on the
 * `primordials` object, it's important to use const references to the
 * primordials that they use.
 * @template {Iterable} T
 * @template {*} TReturn
 * @template {*} TNext
 * @param {(self: T) => IterableIterator<T>} factory
 * @param {(...args: [] | [TNext]) => IteratorResult<T, TReturn>} next
 * @returns {Iterator<T, TReturn, TNext>}
 */
const createSafeIterator = (factory, next) => {
  return finishSafeCtor(
    class SafeIterator {
      #iterator;
      constructor(iterable) {
        this.#iterator = factory(iterable);
      }
      next() {
        return next(this.#iterator);
      }
      [$$iterator]() {
        return this;
      }
    },
  );
};

const { $prototype: FinalizationRegistryPrototype } = $FinalizationRegistry;
const {
  $register: FinalizationRegistryPrototypeRegisterRaw,
  $unregister: FinalizationRegistryPrototypeUnregisterRaw,
  $$toStringTag: FinalizationRegistryPrototypeSymbolToStringTag,
} = FinalizationRegistryPrototype;

const MapGetSymbolSpeciesRaw = $Map.$__lookupGetter__($$species);

const { $prototype: MapPrototype } = $Map;

const MapPrototypeGetSizeRaw = MapPrototype.$__lookupGetter__($size);
const {
  $clear: MapPrototypeClearRaw,
  $delete: MapPrototypeDeleteRaw,
  $forEach: MapPrototypeForEachRaw,
  $get: MapPrototypeGetRaw,
  $has: MapPrototypeHasRaw,
  $keys: MapPrototypeKeysRaw,
  $set: MapPrototypeSetRaw,
  $values: MapPrototypeValuesRaw,
  // $Map.$prototype.$entries === $Map.$prototype.$$iterator
  $$toStringTag: MapPrototypeSymbolToStringTag,
} = MapPrototype;

const {
  $all: PromiseAllRaw,
  $allSettled: PromiseAllSettledRaw,
  $any: PromiseAnyRaw,
  $race: PromiseRaceRaw,
  $reject: PromiseRejectRaw,
  $resolve: PromiseResolveRaw,
  $withResolvers: PromiseWithResolversRaw,
} = $Promise;

const PromiseGetSymbolSpeciesRaw = $Promise.$__lookupGetter__($$species);

const { $prototype: PromisePrototype } = $Promise;
const PromisePrototypeThenRaw = $defaultPromiseThen;
const { $catch: PromisePrototypeCatchRaw, $finally: PromisePrototypeFinallyRaw } = PromisePrototype;

const SetGetSymbolSpeciesRaw = $Set.$__lookupGetter__($$species);

const { $prototype: SetPrototype } = $Set;
const SetPrototypeGetSizeRaw = SetPrototype.$__lookupGetter__($size);
const {
  $add: SetPrototypeAddRaw,
  $clear: SetPrototypeClearRaw,
  $delete: SetPrototypeDeleteRaw,
  $difference: SetPrototypeDifferenceRaw,
  $forEach: SetPrototypeForEachRaw,
  $has: SetPrototypeHasRaw,
  $intersection: SetPrototypeIntersectionRaw,
  $isDisjointFrom: SetPrototypeIsDisjointFromRaw,
  $isSubsetOf: SetPrototypeIsSubsetOfRaw,
  $isSupersetOf: SetPrototypeIsSupersetOfRaw,
  $keys: SetPrototypeKeysRaw,
  $symmetricDifference: SetPrototypeSymmetricDifferenceRaw,
  $union: SetPrototypeUnionRaw,
  $values: SetPrototypeValuesRaw,
  // $Set.$prototype.$values === $Set.$prototype.$$iterator
  $$toStringTag: SetPrototypeSymbolToStringTag,
} = SetPrototype;

const { $prototype: RegExpPrototype } = $RegExp;
const {
  $exec: RegExpPrototypeExecRaw,
  $$match: RegExpPrototypeSymbolMatchRaw,
  $$matchAll: RegExpPrototypeSymbolMatchAllRaw,
  $$replace: RegExpPrototypeSymbolReplaceRaw,
  $$search: RegExpPrototypeSymbolSearchRaw,
  $$split: RegExpPrototypeSymbolSplitRaw,
} = RegExpPrototype;

const { $prototype: WeakMapPrototype } = $WeakMap;
const {
  $delete: WeakMapPrototypeDeleteRaw,
  $get: WeakMapPrototypeGetRaw,
  $has: WeakMapPrototypeHasRaw,
  $set: WeakMapPrototypeSetRaw,
  $$toStringTag: WeakMapPrototypeSymbolToStringTag,
} = WeakMapPrototype;

const { $prototype: WeakRefPrototype } = $WeakRef;
const { $deref: WeakRefPrototypeDerefRaw, $$toStringTag: WeakRefPrototypeSymbolToStringTag } = WeakRefPrototype;

const { $prototype: WeakSetPrototype } = $WeakSet;
const {
  $add: WeakSetPrototypeAddRaw,
  $delete: WeakSetPrototypeDeleteRaw,
  $has: WeakSetPrototypeHasRaw,
  $$toStringTag: WeakSetPrototypeSymbolToStringTag,
} = WeakSetPrototype;

// `uncurryNArgs` is equivalent to `func => Function.prototype.call.bind(func)`.
const uncurryNArgs =
  fn =>
  (thisArg, ...args) =>
    fn.$apply(thisArg, args);
primordials.uncurryThis = uncurryNArgs;

const uncurry0Args = fn => thisArg => fn.$call(thisArg);
const uncurry1Args = fn => (thisArg, a) => fn.$call(thisArg, a);
const uncurry2Args = fn => (thisArg, a, b) => fn.$call(thisArg, a, b);
const uncurry3Args = fn => (thisArg, a, b, c) => fn.$call(thisArg, a, b, c);
const uncurry4Args = fn => (thisArg, a, b, c, d) => fn.$call(thisArg, a, b, c, d);

// `applyBind` is equivalent to `func => Function.prototype.apply.bind(func)`.
const applyBind = (fn, maybeThisArg) =>
  $argumentCount() === 1 ? (thisArg, args) => fn.$apply(thisArg, args) : args => fn.$apply(maybeThisArg, args);
primordials.applyBind = applyBind;

// Create copies of configurable value properties of the global object
primordials.globalThis = $globalThis;

// Create copies of URI handling functions
primordials.decodeURI = $decodeURI;
primordials.decodeURIComponent = $decodeURIComponent;
primordials.encodeURI = $encodeURI;
primordials.encodeURIComponent = $encodeURIComponent;

// Create copies of legacy functions
primordials.escape = $escape;
// Cannot access `eval` in compiled built-in modules because it's an evaluation sink.
// primordials.eval = eval;
primordials.unescape = $unescape;

// Create copies of the namespace objects
primordials.AtomicsLoad = $Atomics.$load;
primordials.AtomicsStore = $Atomics.$store;
primordials.AtomicsAdd = $Atomics.$add;
primordials.AtomicsSub = $Atomics.$sub;
primordials.AtomicsAnd = $Atomics.$and;
primordials.AtomicsOr = $Atomics.$or;
primordials.AtomicsXor = $Atomics.$xor;
primordials.AtomicsExchange = $Atomics.$exchange;
primordials.AtomicsCompareExchange = $Atomics.$compareExchange;
primordials.AtomicsIsLockFree = $Atomics.$isLockFree;
primordials.AtomicsWait = $Atomics.$wait;
primordials.AtomicsWaitAsync = $Atomics.$waitAsync;
primordials.AtomicsNotify = $Atomics.$notify;

primordials.JSONParse = $JSON.$parse;
// Cannot use the @jsonStringify private method because
// it returns '' for unsupported values instead of `undefined`.
primordials.JSONStringify = $JSON.$stringify;

primordials.MathAbs = $Math.$abs;
primordials.MathAcos = $Math.$acos;
primordials.MathAcosh = $Math.$acosh;
primordials.MathAsin = $Math.$asin;
primordials.MathAsinh = $Math.$asinh;
primordials.MathAtan = $Math.$atan;
primordials.MathAtanh = $Math.$atanh;
primordials.MathAtan2 = $Math.$atan2;
primordials.MathCeil = $Math.$ceil;
primordials.MathCbrt = $Math.$cbrt;
primordials.MathExpm1 = $Math.$expm1;
primordials.MathClz32 = $Math.$clz32;
primordials.MathCos = $Math.$cos;
primordials.MathCosh = $Math.$cosh;
primordials.MathExp = $Math.$exp;
primordials.MathFloor = $Math.$floor;
primordials.MathFround = $Math.$fround;
primordials.MathHypot = $Math.$hypot;
primordials.MathImul = $Math.$imul;
primordials.MathLog = $Math.$log;
primordials.MathLog1p = $Math.$log1p;
primordials.MathLog2 = $Math.$log2;
primordials.MathLog10 = $Math.$log10;
primordials.MathMax = $Math.$max;
// Cannot use the @min private method because it only supports
// two parameters and Math.min supports any number of parameters.
primordials.MathMin = $Math.$min;
primordials.MathPow = $Math.$pow;
primordials.MathRandom = $Math.$random;
primordials.MathRound = $Math.$round;
primordials.MathSign = $Math.$sign;
primordials.MathSin = $Math.$sin;
primordials.MathSinh = $Math.$sinh;
primordials.MathSqrt = $Math.$sqrt;
primordials.MathTan = $Math.$tan;
primordials.MathTanh = $Math.$tanh;
primordials.MathTrunc = $Math.$trunc;
primordials.MathE = $Math.$E;
primordials.MathLN10 = $Math.$LN10;
primordials.MathLN2 = $Math.$LN2;
primordials.MathLOG10E = $Math.$LOG10E;
primordials.MathLOG2E = $Math.$LOG2E;
primordials.MathPI = $Math.$PI;
primordials.MathSQRT1_2 = $Math.$SQRT1_2;
primordials.MathSQRT2 = $Math.$SQRT2;

primordials.ReflectApply = $Reflect.$apply;
primordials.ReflectConstruct = $Reflect.$construct;
primordials.ReflectDefineProperty = $Reflect.$defineProperty;
primordials.ReflectDeleteProperty = $Reflect.$deleteProperty;
primordials.ReflectGet = $Reflect.$get;
primordials.ReflectGetOwnPropertyDescriptor = $Reflect.$getOwnPropertyDescriptor;
primordials.ReflectGetPrototypeOf = $Reflect.getPrototypeOf;
primordials.ReflectHas = $Reflect.$has;
primordials.ReflectIsExtensible = $Reflect.$isExtensible;
primordials.ReflectOwnKeys = $Reflect.$ownKeys;
primordials.ReflectPreventExtensions = $Reflect.$preventExtensions;
primordials.ReflectSet = $Reflect.$set;
primordials.ReflectSetPrototypeOf = $Reflect.$setPrototypeOf;

// Create copies of intrinsic objects

// Skipped the following AggregateError properties:
// - length
// - name
primordials.AggregateError = $AggregateError;

// Skipped the following AggregateError.prototype properties:
// - message
// - name
const { $prototype: AggregateErrorPrototype } = $AggregateError;
primordials.AggregateErrorPrototype = AggregateErrorPrototype;

// Skipped the following Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Array = $Array;
// Cannot use the @arrayFromFast private method because it requires
// an object check and doesn't support iterables.
primordials.ArrayFrom = $Array.$from;
primordials.ArrayIsArray = $Array.$isArray;
primordials.ArrayOf = $Array.$of;
primordials.ArrayOfApply = applyBind($Array.$of, $Array);

// Skipped the following Array.prototype properties:
// - length
// - SymbolToStringTag
const { $prototype: ArrayPrototype } = $Array;
primordials.ArrayPrototype = ArrayPrototype;
primordials.ArrayPrototypeAt = uncurry1Args(ArrayPrototype.$at);
primordials.ArrayPrototypeConcat = uncurryNArgs(ArrayPrototype.$concat);
primordials.ArrayPrototypeCopyWithin = uncurry3Args(ArrayPrototype.$copyWithin);
primordials.ArrayPrototypeEntries = uncurry0Args(ArrayPrototype.$entries);
primordials.ArrayPrototypeEvery = uncurry2Args(ArrayPrototype.$every);
primordials.ArrayPrototypeFill = uncurry3Args(ArrayPrototype.$fill);
primordials.ArrayPrototypeFilter = uncurry2Args(ArrayPrototype.$filter);
primordials.ArrayPrototypeFind = uncurry2Args(ArrayPrototype.$find);
primordials.ArrayPrototypeFindIndex = uncurry2Args(ArrayPrototype.$findIndex);
primordials.ArrayPrototypeFindLast = uncurry2Args(ArrayPrototype.$findLast);
primordials.ArrayPrototypeFindLastIndex = uncurry2Args(ArrayPrototype.$findLastIndex);
primordials.ArrayPrototypeFlat = uncurry1Args(ArrayPrototype.$flat);
primordials.ArrayPrototypeFlatMap = uncurry2Args(ArrayPrototype.$flatMap);
primordials.ArrayPrototypeForEach = uncurry2Args(ArrayPrototype.$forEach);
primordials.ArrayPrototypeIncludes = uncurry2Args(ArrayPrototype.$includes);
primordials.ArrayPrototypeIndexOf = uncurry2Args(ArrayPrototype.$indexOf);
primordials.ArrayPrototypeJoin = uncurry1Args(ArrayPrototype.$join);
primordials.ArrayPrototypeKeys = uncurry0Args(ArrayPrototype.$keys);
primordials.ArrayPrototypeLastIndexOf = uncurry2Args(ArrayPrototype.$lastIndexOf);
primordials.ArrayPrototypeMap = uncurry2Args(ArrayPrototype.$map);
primordials.ArrayPrototypePop = uncurry0Args(ArrayPrototype.$pop);
primordials.ArrayPrototypePush = uncurryNArgs(ArrayPrototype.$push);
primordials.ArrayPrototypePushApply = applyBind(ArrayPrototype.$push);
primordials.ArrayPrototypeReduce = uncurry2Args(ArrayPrototype.$reduce);
primordials.ArrayPrototypeReduceRight = uncurry2Args(ArrayPrototype.$reduceRight);
primordials.ArrayPrototypeReverse = uncurry0Args(ArrayPrototype.$reverse);
primordials.ArrayPrototypeShift = uncurry0Args(ArrayPrototype.$shift);
primordials.ArrayPrototypeSlice = uncurry2Args(ArrayPrototype.$slice);
primordials.ArrayPrototypeSome = uncurry2Args(ArrayPrototype.$some);
primordials.ArrayPrototypeSort = uncurry1Args(ArrayPrototype.$sort);
primordials.ArrayPrototypeSplice = uncurryNArgs(ArrayPrototype.$splice);
primordials.ArrayPrototypeToLocaleString = uncurry2Args(ArrayPrototype.$toLocaleString);
primordials.ArrayPrototypeToReversed = uncurry0Args(ArrayPrototype.$toReversed);
primordials.ArrayPrototypeToSorted = uncurry1Args(ArrayPrototype.$toSorted);
primordials.ArrayPrototypeToString = uncurry0Args(ArrayPrototype.$toString);
primordials.ArrayPrototypeUnshift = uncurryNArgs(ArrayPrototype.$unshift);
primordials.ArrayPrototypeUnshiftApply = applyBind(ArrayPrototype.$unshift);
primordials.ArrayPrototypeValues = uncurry0Args(ArrayPrototype.$values);
primordials.ArrayPrototypeSymbolIterator = primordials.ArrayPrototypeValues;
primordials.ArrayPrototypeSymbolUnscopables = ArrayPrototype.$$unscopables;

const ArrayIteratorPrototype = ArrayPrototype.$$iterator().$__proto__;
primordials.ArrayIteratorPrototype = ArrayIteratorPrototype;
primordials.ArrayIteratorPrototypeNext = uncurry0Args(ArrayIteratorPrototype.$next);

primordials.SafeArrayIterator = createSafeIterator(
  primordials.ArrayPrototypeSymbolIterator,
  primordials.ArrayIteratorPrototypeNext,
);

// Skipped the following ArrayBuffer properties:
// - length
// - name
// - SymbolSpecies
primordials.ArrayBuffer = $ArrayBuffer;
primordials.ArrayBufferIsView = $ArrayBuffer.$isView;

// Skipped the following ArrayBuffer.prototype properties:
// - SymbolToStringTag
const { $prototype: ArrayBufferPrototype } = $ArrayBuffer;
primordials.ArrayBufferPrototype = ArrayBufferPrototype;
primordials.ArrayBufferPrototypeGetByteLength = uncurry0Args(ArrayBufferPrototype.$__lookupGetter__($byteLength));
primordials.ArrayBufferPrototypeSlice = uncurry2Args(ArrayBufferPrototype.$slice);

// Skipped the following BigInt properties:
// - length
// - name
primordials.BigInt = $BigInt;
primordials.BigIntAsIntN = $BigInt.$asIntN;
primordials.BigIntAsUintN = $BigInt.$asUintN;

// Skipped the following BigInt.prototype properties:
// - SymbolToStringTag
const { $prototype: BigIntPrototype } = $BigInt;
primordials.BigIntPrototype = BigIntPrototype;
primordials.BigIntPrototypeToLocaleString = uncurry2Args(BigIntPrototype.$toLocaleString);
primordials.BigIntPrototypeToString = uncurry0Args(BigIntPrototype.$toString);
primordials.BigIntPrototypeValueOf = uncurry0Args(BigIntPrototype.$valueOf);

// Skipped the following BigInt64Array properties:
// - length
// - name
// - SymbolSpecies
primordials.BigInt64Array = $BigInt64Array;
primordials.BigInt64ArrayBYTES_PER_ELEMENT = $BigInt64Array.$BYTES_PER_ELEMENT;

const { $prototype: BigInt64ArrayPrototype } = $BigInt64Array;
primordials.BigInt64ArrayPrototype = BigInt64ArrayPrototype;
primordials.BigInt64ArrayPrototypeBYTES_PER_ELEMENT = BigInt64ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following BigInt64Array properties:
// - length
// - name
// - SymbolSpecies
primordials.BigUint64Array = $BigUint64Array;
primordials.BigUint64ArrayBYTES_PER_ELEMENT = $BigUint64Array.$BYTES_PER_ELEMENT;

const { $prototype: BigUint64ArrayPrototype } = $BigUint64Array;
primordials.BigUint64ArrayPrototype = BigUint64ArrayPrototype;
primordials.BigUint64ArrayPrototypeBYTES_PER_ELEMENT = BigUint64ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Boolean properties:
// - length
// - name
primordials.Boolean = $Boolean;

const { $prototype: BooleanPrototype } = $Boolean;
primordials.BooleanPrototype = BooleanPrototype;
primordials.BooleanPrototypeToString = uncurry0Args(BooleanPrototype.$toString);
primordials.BooleanPrototypeValueOf = uncurry0Args(BooleanPrototype.$valueOf);

// Skipped the following DataView properties:
// - length
// - name
primordials.DataView = $DataView;

// Skipped the following DataView.prototype properties:
// - SymbolToStringTag
const { $prototype: DataViewPrototype } = $DataView;
primordials.DataViewPrototype = DataViewPrototype;
primordials.DataViewPrototypeGetBuffer = uncurry0Args(DataViewPrototype.$__lookupGetter__($buffer));
primordials.DataViewPrototypeGetByteLength = uncurry0Args(DataViewPrototype.$__lookupGetter__($byteLength));
primordials.DataViewPrototypeGetByteOffset = uncurry0Args(DataViewPrototype.$__lookupGetter__($byteOffset));
primordials.DataViewPrototypeGetBigInt64 = uncurry2Args(DataViewPrototype.$getBigInt64);
primordials.DataViewPrototypeGetBigUint64 = uncurry2Args(DataViewPrototype.$getBigUint64);
primordials.DataViewPrototypeGetFloat32 = uncurry2Args(DataViewPrototype.$getFloat32);
primordials.DataViewPrototypeGetFloat64 = uncurry2Args(DataViewPrototype.$getFloat64);
primordials.DataViewPrototypeGetInt8 = uncurry1Args(DataViewPrototype.$getInt8);
primordials.DataViewPrototypeGetInt16 = uncurry2Args(DataViewPrototype.$getInt16);
primordials.DataViewPrototypeGetInt32 = uncurry2Args(DataViewPrototype.$getInt32);
primordials.DataViewPrototypeGetUint8 = uncurry1Args(DataViewPrototype.$getUint8);
primordials.DataViewPrototypeGetUint16 = uncurry2Args(DataViewPrototype.$getUint16);
primordials.DataViewPrototypeGetUint32 = uncurry2Args(DataViewPrototype.$getUint32);
primordials.DataViewPrototypeSetBigInt64 = uncurry3Args(DataViewPrototype.$setBigInt64);
primordials.DataViewPrototypeSetBigUint64 = uncurry3Args(DataViewPrototype.$setBigUint64);
primordials.DataViewPrototypeSetFloat32 = uncurry3Args(DataViewPrototype.$setFloat32);
primordials.DataViewPrototypeSetFloat64 = uncurry3Args(DataViewPrototype.$setFloat64);
primordials.DataViewPrototypeSetInt8 = uncurry2Args(DataViewPrototype.$setInt8);
primordials.DataViewPrototypeSetInt16 = uncurry3Args(DataViewPrototype.$setInt16);
primordials.DataViewPrototypeSetInt32 = uncurry3Args(DataViewPrototype.$setInt32);
primordials.DataViewPrototypeSetUint8 = uncurry2Args(DataViewPrototype.$setUint8);
primordials.DataViewPrototypeSetUint16 = uncurry3Args(DataViewPrototype.$setUint16);
primordials.DataViewPrototypeSetUint32 = uncurry3Args(DataViewPrototype.$setUint32);

// Skipped the following Date properties:
// - length
// - name
primordials.Date = $Date;
primordials.DateNow = $Date.$now;
primordials.DateParse = $Date.$parse;
primordials.DateUTC = $Date.$UTC;

// Skipped the following Date.prototype properties:
// - getYear (deprecated)
// - setYear (deprecated)
// - toGMTString (alias of toUTCString)
const { $prototype: DatePrototype } = $Date;
primordials.DatePrototype = DatePrototype;
primordials.DatePrototypeGetDate = uncurry0Args(DatePrototype.$getDate);
primordials.DatePrototypeGetDay = uncurry0Args(DatePrototype.$getDay);
primordials.DatePrototypeGetFullYear = uncurry0Args(DatePrototype.$getFullYear);
primordials.DatePrototypeGetHours = uncurry0Args(DatePrototype.$getHours);
primordials.DatePrototypeGetMilliseconds = uncurry0Args(DatePrototype.$getMilliseconds);
primordials.DatePrototypeGetMinutes = uncurry0Args(DatePrototype.$getMinutes);
primordials.DatePrototypeGetMonth = uncurry0Args(DatePrototype.$getMonth);
primordials.DatePrototypeGetSeconds = uncurry0Args(DatePrototype.$getSeconds);
primordials.DatePrototypeGetTime = uncurry0Args(DatePrototype.$getTime);
primordials.DatePrototypeGetTimezoneOffset = uncurry0Args(DatePrototype.$getTimezoneOffset);
primordials.DatePrototypeGetUTCDate = uncurry0Args(DatePrototype.$getUTCDate);
primordials.DatePrototypeGetUTCDay = uncurry0Args(DatePrototype.$getUTCDay);
primordials.DatePrototypeGetUTCFullYear = uncurry0Args(DatePrototype.$getUTCFullYear);
primordials.DatePrototypeGetUTCHours = uncurry0Args(DatePrototype.$getUTCHours);
primordials.DatePrototypeGetUTCMilliseconds = uncurry0Args(DatePrototype.$getUTCMilliseconds);
primordials.DatePrototypeGetUTCMinutes = uncurry0Args(DatePrototype.$getUTCMinutes);
primordials.DatePrototypeGetUTCMonth = uncurry0Args(DatePrototype.$getUTCMonth);
primordials.DatePrototypeGetUTCSeconds = uncurry0Args(DatePrototype.$getUTCSeconds);
primordials.DatePrototypeSetDate = uncurry1Args(DatePrototype.$setDate);
primordials.DatePrototypeSetFullYear = uncurry3Args(DatePrototype.$setFullYear);
primordials.DatePrototypeSetHours = uncurry4Args(DatePrototype.$setHours);
primordials.DatePrototypeSetMilliseconds = uncurry1Args(DatePrototype.$setMilliseconds);
primordials.DatePrototypeSetMinutes = uncurry3Args(DatePrototype.$setMinutes);
primordials.DatePrototypeSetMonth = uncurry2Args(DatePrototype.$setMonth);
primordials.DatePrototypeSetSeconds = uncurry2Args(DatePrototype.$setSeconds);
primordials.DatePrototypeSetTime = uncurry1Args(DatePrototype.$setTime);
primordials.DatePrototypeSetUTCDate = uncurry1Args(DatePrototype.$setUTCDate);
primordials.DatePrototypeSetUTCFullYear = uncurry3Args(DatePrototype.$setUTCFullYear);
primordials.DatePrototypeSetUTCHours = uncurry4Args(DatePrototype.$setUTCHours);
primordials.DatePrototypeSetUTCMilliseconds = uncurry1Args(DatePrototype.$setUTCMilliseconds);
primordials.DatePrototypeSetUTCMinutes = uncurry3Args(DatePrototype.$setUTCMinutes);
primordials.DatePrototypeSetUTCMonth = uncurry2Args(DatePrototype.$setUTCMonth);
primordials.DatePrototypeSetUTCSeconds = uncurry2Args(DatePrototype.$setUTCSeconds);
primordials.DatePrototypeSymbolToPrimitive = uncurry1Args(DatePrototype.$$toPrimitive);
primordials.DatePrototypeToDateString = uncurry0Args(DatePrototype.$toDateString);
primordials.DatePrototypeToISOString = uncurry0Args(DatePrototype.$toISOString);
primordials.DatePrototypeToJSON = uncurry0Args(DatePrototype.$toJSON);
primordials.DatePrototypeToLocaleDateString = uncurry2Args(DatePrototype.$toLocaleDateString);
primordials.DatePrototypeToLocaleString = uncurry2Args(DatePrototype.$toLocaleString);
primordials.DatePrototypeToLocaleTimeString = uncurry2Args(DatePrototype.$toLocaleTimeString);
primordials.DatePrototypeToString = uncurry0Args(DatePrototype.$toString);
primordials.DatePrototypeToTimeString = uncurry0Args(DatePrototype.$toTimeString);
primordials.DatePrototypeToUTCString = uncurry0Args(DatePrototype.$toUTCString);
primordials.DatePrototypeValueOf = uncurry0Args(DatePrototype.$valueOf);

// Skipped the following Error properties:
// - length
// - name
primordials.Error = $Error;
primordials.ErrorCaptureStackTrace = $Error.captureStackTrace;
primordials.ErrorStackTraceLimit = $Error.stackTraceLimit;

// Skipped the following Error.prototype properties:
// - message
// - name
const { $prototype: ErrorPrototype } = $Error;
primordials.ErrorPrototype = ErrorPrototype;
primordials.ErrorPrototypeToString = uncurry0Args(ErrorPrototype.$toString);

// Skipped the following EvalError properties:
// - length
// - name
primordials.EvalError = $EvalError;

// Skipped the following EvalError.prototype properties:
// - message
// - name
const { $prototype: EvalErrorPrototype } = $EvalError;
primordials.EvalErrorPrototype = EvalErrorPrototype;

primordials.FinalizationRegistry = FinalizationRegistry;

// Skipped the following FinalizationRegistry.prototype properties:
// - SymbolToStringTag
primordials.FinalizationRegistryPrototype = FinalizationRegistryPrototype;
primordials.FinalizationRegistryPrototypeRegister = uncurry3Args(FinalizationRegistryPrototypeRegisterRaw);
primordials.FinalizationRegistryPrototypeUnregister = uncurry1Args(FinalizationRegistryPrototypeUnregisterRaw);

// Skipped the following Float32Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Float32Array = $Float32Array;
primordials.Float32ArrayBYTES_PER_ELEMENT = $Float32Array.$BYTES_PER_ELEMENT;

const { $prototype: Float32ArrayPrototype } = $Float32Array;
primordials.Float32ArrayPrototype = Float32ArrayPrototype;
primordials.Float32ArrayPrototypeBYTES_PER_ELEMENT = Float32ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Float64Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Float64Array = $Float64Array;
primordials.Float64ArrayBYTES_PER_ELEMENT = $Float64Array.$BYTES_PER_ELEMENT;

const { $prototype: Float64ArrayPrototype } = $Float64Array;
primordials.Float64ArrayPrototype = Float64ArrayPrototype;
primordials.Float64ArrayPrototypeBYTES_PER_ELEMENT = Float64ArrayPrototype.$BYTES_PER_ELEMENT;

// Cannot access `Function` in compiled built-in modules because it's an evaluation sink.
// primordials.Function = Function;

// Skipped the following Function.prototype properties:
// - arguments
// - caller
// - length
// - name
const { $prototype: FunctionPrototype } = $Function;
primordials.FunctionPrototype = FunctionPrototype;
primordials.FunctionPrototypeApply = (f, t, a) => f.$apply(t, a);
primordials.FunctionPrototypeBind = uncurryNArgs(FunctionPrototype.$bind);
primordials.FunctionPrototypeCall = (f, t, ...a) => f.$apply(t, a);
primordials.FunctionPrototypeToString = uncurry0Args(FunctionPrototype.$toString);
primordials.FunctionPrototypeSymbolHasInstance = uncurry1Args(FunctionPrototype.$$hasInstance);

// Skipped the following Int16Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Int16Array = $Int16Array;
primordials.Int16ArrayBYTES_PER_ELEMENT = $Int16Array.$BYTES_PER_ELEMENT;

const Int16ArrayPrototype = $Int16Array.prototype;
primordials.Int16ArrayPrototype = Int16ArrayPrototype;
primordials.Int16ArrayPrototypeBYTES_PER_ELEMENT = Int16ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Int32Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Int32Array = $Int32Array;
primordials.Int32ArrayBYTES_PER_ELEMENT = $Int32Array.$BYTES_PER_ELEMENT;

const Int32ArrayPrototype = $Int32Array.prototype;
primordials.Int32ArrayPrototype = Int32ArrayPrototype;
primordials.Int32ArrayPrototypeBYTES_PER_ELEMENT = Int32ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Int8Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Int8Array = $Int8Array;
primordials.Int8ArrayBYTES_PER_ELEMENT = $Int8Array.$BYTES_PER_ELEMENT;

const Int8ArrayPrototype = $Int8Array.prototype;
primordials.Int8ArrayPrototype = Int8ArrayPrototype;
primordials.Int8ArrayPrototypeBYTES_PER_ELEMENT = Int8ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Map properties:
// - length
// - name
primordials.Map = $Map;
primordials.MapGroupBy = $Map.groupBy;
primordials.MapGetSymbolSpecies = uncurry0Args(MapGetSymbolSpeciesRaw);

primordials.MapPrototype = MapPrototype;
primordials.MapPrototypeClear = uncurry0Args(MapPrototypeClearRaw);
primordials.MapPrototypeDelete = uncurry1Args(MapPrototypeDeleteRaw);
primordials.MapPrototypeEntries = uncurry0Args(MapPrototype.$entries);
primordials.MapPrototypeForEach = uncurry2Args(MapPrototypeForEachRaw);
primordials.MapPrototypeGet = uncurry1Args(MapPrototypeGetRaw);
primordials.MapPrototypeHas = uncurry1Args(MapPrototypeHasRaw);
primordials.MapPrototypeKeys = uncurry0Args(MapPrototypeKeysRaw);
primordials.MapPrototypeSet = uncurry2Args(MapPrototypeSetRaw);
primordials.MapPrototypeGetSize = uncurry0Args(MapPrototypeGetSizeRaw);
primordials.MapPrototypeValues = uncurry0Args(MapPrototypeValuesRaw);
primordials.MapPrototypeSymbolIterator = primordials.MapPrototypeEntries;
primordials.MapPrototypeSymbolToStringTag = MapPrototypeSymbolToStringTag;

const MapIteratorPrototype = new $Map().$$iterator().$__proto__;
primordials.MapIteratorPrototype = MapIteratorPrototype;
primordials.MapIteratorPrototypeNext = uncurry0Args(MapIteratorPrototype.next);

const SafeMapIterator = createSafeIterator(
  primordials.MapPrototypeSymbolIterator,
  primordials.MapIteratorPrototypeNext,
);
primordials.SafeMapIterator = SafeMapIterator;

const SafeMapPrototypeEntriesRaw = function () {
  return new SafeMapIterator(this.$entries());
};

const SafeMapPrototypeValuesRaw = function () {
  return new SafeMapIterator(this.$values());
};

// Skipped the following Number properties:
// - length
// - name
primordials.Number = $Number;
primordials.NumberEPSILON = $Number.$EPSILON;
primordials.NumberIsFinite = $Number.$isFinite;
primordials.NumberIsInteger = $Number.$isInteger;
primordials.NumberIsNaN = $Number.$isNaN;
primordials.NumberIsSafeInteger = $Number.$isSafeInteger;
primordials.NumberMAX_SAFE_INTEGER = $Number.$MAX_SAFE_INTEGER;
primordials.NumberMAX_VALUE = $Number.$MAX_VALUE;
primordials.NumberMIN_SAFE_INTEGER = $Number.$MIN_SAFE_INTEGER;
primordials.NumberMIN_VALUE = $Number.$MIN_VALUE;
primordials.NumberNaN = $Number.$NaN;
primordials.NumberNEGATIVE_INFINITY = $Number.$NEGATIVE_INFINITY;
primordials.NumberParseFloat = $Number.$parseFloat;
primordials.NumberParseInt = $Number.$parseInt;
primordials.NumberPOSITIVE_INFINITY = $Number.$POSITIVE_INFINITY;

const { $prototype: NumberPrototype } = $Number;
primordials.NumberPrototype = NumberPrototype;
primordials.NumberPrototypeToExponential = uncurry1Args(NumberPrototype.$toExponential);
primordials.NumberPrototypeToFixed = uncurry1Args(NumberPrototype.$toFixed);
primordials.NumberPrototypeToLocaleString = uncurry2Args(NumberPrototype.$toLocaleString);
primordials.NumberPrototypeToPrecision = uncurry1Args(NumberPrototype.$toPrecision);
primordials.NumberPrototypeToString = uncurry1Args(NumberPrototype.$toString);
primordials.NumberPrototypeValueOf = uncurry0Args(NumberPrototype.$valueOf);

// Skipped the following Object properties:
// - length
// - name
primordials.Object = $Object;
primordials.ObjectAssign = $Object.$assign;
primordials.ObjectCreate = $Object.$create;
primordials.ObjectDefineProperties = $Object.defineProperties;
primordials.ObjectDefineProperty = ObjectDefineProperty;
primordials.ObjectEntries = $Object.$entries;
primordials.ObjectFreeze = ObjectFreeze;
primordials.ObjectFromEntries = $Object.$fromEntries;
primordials.ObjectGetOwnPropertyDescriptor = $Object.$getOwnPropertyDescriptor;
primordials.ObjectGetOwnPropertyDescriptors = $Object.$getOwnPropertyDescriptors;
primordials.ObjectGetOwnPropertyNames = $Object.$getOwnPropertyNames;
primordials.ObjectGetOwnPropertySymbols = $Object.$getOwnPropertySymbols;
primordials.ObjectGetPrototypeOf = $Object.$getPrototypeOf;
primordials.ObjectGroupBy = $Object.$groupBy;
primordials.ObjectHasOwn = $Object.$hasOwn;
primordials.ObjectIs = $Object.$is;
primordials.ObjectIsExtensible = $Object.$isExtensible;
primordials.ObjectIsFrozen = $Object.$isFrozen;
primordials.ObjectIsSealed = $Object.$isSealed;
primordials.ObjectKeys = $Object.$keys;
primordials.ObjectPreventExtensions = $Object.$preventExtensions;
primordials.ObjectSeal = $Object.$seal;
primordials.ObjectSetPrototypeOf = $Object.$setPrototypeOf;
primordials.ObjectValues = $Object.$values;

// Skipped the following Object.prototype properties:
// - __defineGetter__
// - __defineSetter__
// - __lookupGetter__
// - __lookupSetter__
// - __proto__
// - constructor
const { $prototype: ObjectPrototype } = $Object;
primordials.ObjectPrototype = ObjectPrototype;
primordials.ObjectPrototypeHasOwnProperty = $Object.$hasOwn;
primordials.ObjectPrototypeIsPrototypeOf = uncurry1Args(ObjectPrototype.$isPrototypeOf);
primordials.ObjectPrototypePropertyIsEnumerable = uncurry1Args(ObjectPrototype.$propertyIsEnumerable);
primordials.ObjectPrototypeToLocaleString = uncurry0Args(ObjectPrototype.$toLocaleString);
primordials.ObjectPrototypeToString = uncurry0Args(ObjectPrototype.$toString);
primordials.ObjectPrototypeValueOf = uncurry0Args(ObjectPrototype.$valueOf);

// Skipped the following Proxy properties:
// - length
// - name
primordials.ProxyRevocable = $Proxy.$revocable;

// Skipped the following RangeError properties:
// - length
// - name
primordials.RangeError = $RangeError;

// Skipped the following RangeError.prototype properties:
// - message
// - name
const { $prototype: RangeErrorPrototype } = $RangeError;
primordials.RangeErrorPrototype = RangeErrorPrototype;

primordials.ReferenceError = $ReferenceError;

// Skipped the following ReferenceError.prototype properties:
// - message
// - name
const { $prototype: ReferenceErrorPrototype } = $ReferenceError;
primordials.ReferenceErrorPrototype = ReferenceErrorPrototype;

// Skipped the following RegExp properties:
// - length
// - name
// - SymbolSpecies
primordials.RegExp = $RegExp;

// Skipped the following RegExp.prototype properties:
// - $_
// - $&
// - $`
// - $+
// - $1
// - $2
// - $3
// - $4
// - $5
// - $6
// - $7
// - $8
// - $9
// - compile (deprecated)
// - input
// - lastMatch
// - lastParen
// - leftContext
// - rightContext
primordials.RegExpPrototype = RegExpPrototype;
primordials.RegExpPrototypeGetDotAll = uncurry0Args(RegExpPrototype.$__lookupGetter__($dotAll));
primordials.RegExpPrototypeExec = uncurry1Args(RegExpPrototypeExecRaw);
primordials.RegExpPrototypeGetFlags = uncurry0Args(RegExpPrototype.$__lookupGetter__($flags));
primordials.RegExpPrototypeGetGlobal = uncurry0Args(RegExpPrototype.$__lookupGetter__($global));
primordials.RegExpPrototypeGetHasIndices = uncurry0Args(RegExpPrototype.$__lookupGetter__($hasIndices));
primordials.RegExpPrototypeGetIgnoreCase = uncurry0Args(RegExpPrototype.$__lookupGetter__($ignoreCase));
primordials.RegExpPrototypeGetMultiline = uncurry0Args(RegExpPrototype.$__lookupGetter__($multiline));
primordials.RegExpPrototypeGetSource = uncurry0Args(RegExpPrototype.$__lookupGetter__($source));
primordials.RegExpPrototypeGetSticky = uncurry0Args(RegExpPrototype.$__lookupGetter__($sticky));
primordials.RegExpPrototypeTest = uncurry1Args(RegExpPrototype.$test);
primordials.RegExpPrototypeToString = uncurry0Args(RegExpPrototype.$toString);
primordials.RegExpPrototypeGetUnicode = uncurry0Args(RegExpPrototype.$__lookupGetter__($unicode));
primordials.RegExpPrototypeSymbolMatch = uncurry1Args(RegExpPrototypeSymbolMatchRaw);
primordials.RegExpPrototypeSymbolMatchAll = uncurry1Args(RegExpPrototypeSymbolMatchAllRaw);
primordials.RegExpPrototypeSymbolReplace = uncurry2Args(RegExpPrototypeSymbolReplaceRaw);
primordials.RegExpPrototypeSymbolSearch = uncurry1Args(RegExpPrototypeSymbolSearchRaw);
primordials.RegExpPrototypeSymbolSplit = uncurry2Args(RegExpPrototypeSymbolSplitRaw);

// Skipped the following Set properties:
// - length
// - name
primordials.Set = $Set;
primordials.SetGetSymbolSpecies = uncurry0Args(SetGetSymbolSpeciesRaw);

primordials.SetPrototype = SetPrototype;
primordials.SetPrototypeAdd = uncurry1Args(SetPrototypeAddRaw);
primordials.SetPrototypeClear = uncurry0Args(SetPrototypeClearRaw);
primordials.SetPrototypeDelete = uncurry1Args(SetPrototypeDeleteRaw);
primordials.SetPrototypeDifference = uncurry1Args(SetPrototypeDifferenceRaw);
primordials.SetPrototypeEntries = uncurry0Args(SetPrototype.$entries);
primordials.SetPrototypeForEach = uncurry2Args(SetPrototypeForEachRaw);
primordials.SetPrototypeHas = uncurry1Args(SetPrototypeHasRaw);
primordials.SetPrototypeIntersection = uncurry1Args(SetPrototypeIntersectionRaw);
primordials.SetPrototypeIsDisjointFrom = uncurry1Args(SetPrototypeIsDisjointFromRaw);
primordials.SetPrototypeIsSubsetOf = uncurry1Args(SetPrototypeIsSubsetOfRaw);
primordials.SetPrototypeIsSupersetOf = uncurry1Args(SetPrototypeIsSupersetOfRaw);
primordials.SetPrototypeKeys = uncurry0Args(SetPrototypeKeysRaw);
primordials.SetPrototypeGetSize = uncurry0Args(SetPrototypeGetSizeRaw);
primordials.SetPrototypeSymmetricDifference = uncurry1Args(SetPrototypeSymmetricDifferenceRaw);
primordials.SetPrototypeUnion = uncurry1Args(SetPrototypeUnionRaw);
primordials.SetPrototypeValues = uncurry0Args(SetPrototypeValuesRaw);
primordials.SetPrototypeSymbolIterator = primordials.SetPrototypeValues;
primordials.SetPrototypeSymbolToStringTag = SetPrototypeSymbolToStringTag;

const SetIteratorPrototype = new $Set().$$iterator().$__proto__;
primordials.SetIteratorPrototype = SetIteratorPrototype;
primordials.SetIteratorPrototypeNext = uncurry0Args(SetIteratorPrototype.$next);

const SafeSetIterator = createSafeIterator(
  primordials.SetPrototypeSymbolIterator,
  primordials.SetIteratorPrototypeNext,
);
primordials.SafeSetIterator = SafeSetIterator;

const SafeSetPrototypeEntriesRaw = function () {
  return new SafeSetIterator(this.$entries());
};
const SafeSetPrototypeValuesRaw = function () {
  return new SafeSetIterator(this.$values());
};

// Skipped the following String properties:
// - length
// - name
primordials.String = $String;
primordials.StringFromCharCode = $String.$fromCharCode;
primordials.StringFromCharCodeApply = applyBind($String.$fromCharCode, $String);
primordials.StringFromCodePoint = $String.$fromCodePoint;
primordials.StringFromCodePointApply = applyBind($String.$fromCodePoint, $String);
primordials.StringRaw = $String.$raw;

// Skipped the following String.prototype properties:
// - anchor
// - big
// - blink
// - bold
// - fixed
// - fontcolor
// - fontsize
// - italics
// - length
// - link
// - small
// - strike
// - sub
// - substr
// - sup
// - trimLeft (alias of trimStart)
// - trimRight (alias of trimEnd)
const { $prototype: StringPrototype } = $String;
const { $split: StringPrototypeSplitRaw, $replace: StringPrototypeReplaceRaw } = StringPrototype;
primordials.StringPrototype = StringPrototype;
primordials.StringPrototypeAt = uncurry1Args(StringPrototype.$at);
primordials.StringPrototypeCharAt = uncurry1Args(StringPrototype.$charAt);
primordials.StringPrototypeCharCodeAt = uncurry1Args(StringPrototype.$charCodeAt);
primordials.StringPrototypeCodePointAt = uncurry1Args(StringPrototype.$codePointAt);
primordials.StringPrototypeConcat = uncurryNArgs(StringPrototype.$concat);
primordials.StringPrototypeConcatApply = applyBind(StringPrototype.$concat);
primordials.StringPrototypeEndsWith = uncurry2Args(StringPrototype.$endsWith);
// Cannot use the $stringIncludesInternal.$call(s, f, p) method because
// String.prototype` methods are `this` generic.
primordials.StringPrototypeIncludes = uncurry2Args(StringPrototype.$includes);
primordials.StringPrototypeIndexOf = uncurry2Args(StringPrototype.$indexOf);
primordials.StringPrototypeLastIndexOf = uncurry2Args(StringPrototype.$lastIndexOf);
primordials.StringPrototypeLocaleCompare = uncurry3Args(StringPrototype.$localeCompare);
primordials.StringPrototypeMatch = (s, r) => RegExpPrototypeSymbolMatchRaw.$call(r, s);
primordials.StringPrototypeMatchAll = (s, r) => RegExpPrototypeSymbolMatchAllRaw.$call(r, s);
primordials.StringPrototypeNormalize = uncurry1Args(StringPrototype.$normalize);
primordials.StringPrototypePadEnd = uncurry2Args(StringPrototype.$padEnd);
primordials.StringPrototypePadStart = uncurry2Args(StringPrototype.$padStart);
primordials.StringPrototypeRepeat = uncurry1Args(StringPrototype.$repeat);
primordials.StringPrototypeReplace = (s, r) =>
  $isRegExpObject(r) ? RegExpPrototypeSymbolReplaceRaw.$call(r, s) : StringPrototypeReplaceRaw.$call(s, r);
primordials.StringPrototypeReplaceAll = uncurry2Args(StringPrototype.$replaceAll);
primordials.StringPrototypeSearch = (s, r) => RegExpPrototypeSymbolSearchRaw.$call(r, s);
primordials.StringPrototypeSlice = uncurry2Args(StringPrototype.$slice);
primordials.StringPrototypeSplit = (s, r) =>
  $isRegExpObject(r) ? RegExpPrototypeSymbolSplitRaw.$call(r, s) : StringPrototypeSplitRaw.$call(s, r);
primordials.StringPrototypeStartsWith = uncurry2Args(StringPrototype.$startsWith);
primordials.StringPrototypeSubstring = uncurry2Args(StringPrototype.$substring);
primordials.StringPrototypeSymbolIterator = uncurry0Args(StringPrototype.$$iterator);
primordials.StringPrototypeToLocaleLowerCase = uncurry1Args(StringPrototype.$toLocaleLowerCase);
primordials.StringPrototypeToLocaleUpperCase = uncurry1Args(StringPrototype.$toLocaleUpperCase);
primordials.StringPrototypeToLowerCase = uncurry0Args(StringPrototype.$toLowerCase);
primordials.StringPrototypeToString = uncurry0Args(StringPrototype.$toString);
primordials.StringPrototypeToUpperCase = uncurry0Args(StringPrototype.$toUpperCase);
primordials.StringPrototypeToWellFormed = uncurry0Args(StringPrototype.$toWellFormed);
primordials.StringPrototypeTrim = uncurry0Args(StringPrototype.$trim);
primordials.StringPrototypeTrimEnd = uncurry0Args(StringPrototype.$trimEnd);
primordials.StringPrototypeTrimStart = uncurry0Args(StringPrototype.$trimStart);
primordials.StringPrototypeValueOf = uncurry0Args(StringPrototype.$valueOf);

const StringIteratorPrototype = StringPrototype.$$iterator().$__proto__;
primordials.StringIteratorPrototype = StringIteratorPrototype;
primordials.StringIteratorPrototypeNext = uncurry0Args(StringIteratorPrototype.$next);

primordials.SafeStringIterator = createSafeIterator(
  primordials.StringPrototypeSymbolIterator,
  primordials.StringIteratorPrototypeNext,
);

// Skipped the following Symbol properties:
// - length
// - name
primordials.Symbol = $Symbol;
primordials.SymbolAsyncDispose = $Symbol.$asyncDispose;
primordials.SymbolAsyncIterator = SymbolAsyncIterator;
primordials.SymbolDispose = $Symbol.$dispose;
primordials.SymbolFor = SymbolFor;
primordials.SymbolHasInstance = SymbolHasInstance;
primordials.SymbolIsConcatSpreadable = SymbolIsConcatSpreadable;
primordials.SymbolIterator = SymbolIterator;
primordials.SymbolKeyFor = $Symbol.$keyFor;
primordials.SymbolMatch = SymbolMatch;
primordials.SymbolMatchAll = SymbolMatchAll;
primordials.SymbolReplace = SymbolReplace;
primordials.SymbolSearch = SymbolSearch;
primordials.SymbolSpecies = SymbolSpecies;
primordials.SymbolSplit = SymbolSplit;
primordials.SymbolToPrimitive = SymbolToPrimitive;
primordials.SymbolToStringTag = SymbolToStringTag;
primordials.SymbolUnscopables = SymbolUnscopables;

// Skipped the following Symbol.prototype properties:
// - SymbolToStringTag
const { $prototype: SymbolPrototype } = $Symbol;
primordials.SymbolPrototype = SymbolPrototype;
primordials.SymbolPrototypeGetDescription = uncurry0Args(SymbolPrototype.$__lookupGetter__($description));
primordials.SymbolPrototypeSymbolToPrimitive = uncurry1Args(SymbolPrototype.$$toPrimitive);
primordials.SymbolPrototypeToString = uncurry0Args(SymbolPrototype.$toString);
primordials.SymbolPrototypeValueOf = uncurry0Args(SymbolPrototype.$valueOf);

// Skipped the following SyntaxError properties:
// - length
// - name
primordials.SyntaxError = $SyntaxError;

// Skipped the following SyntaxError.prototype properties:
// - message
// - name
const { $prototype: SyntaxErrorPrototype } = $SyntaxError;
primordials.SyntaxErrorPrototype = SyntaxErrorPrototype;

// Skipped the following TypeError properties:
// - length
// - name
primordials.TypeError = $TypeError;

// Skipped the following TypeError.prototype properties:
// - message
// - name
const { $prototype: TypeErrorPrototype } = $TypeError;
primordials.TypeErrorPrototype = TypeErrorPrototype;

// Skipped the following URIError properties:
// - length
// - name
primordials.URIError = $URIError;

// Skipped the following URIError.prototype properties:
// - message
// - name
const { $prototype: URIErrorPrototype } = $URIError;
primordials.URIErrorPrototype = URIErrorPrototype;

// Skipped the following Uint16Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Uint16Array = $Uint16Array;
primordials.Uint16ArrayBYTES_PER_ELEMENT = $Uint16Array.$BYTES_PER_ELEMENT;

const { $prototype: Uint16ArrayPrototype } = $Uint16Array;
primordials.Uint16ArrayPrototype = Uint16ArrayPrototype;
primordials.Uint16ArrayPrototypeBYTES_PER_ELEMENT = Uint16ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Uint32Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Uint32Array = $Uint32Array;
primordials.Uint32ArrayBYTES_PER_ELEMENT = $Uint32Array.$BYTES_PER_ELEMENT;

const { $prototype: Uint32ArrayPrototype } = $Uint32Array;
primordials.Uint32ArrayPrototype = Uint32ArrayPrototype;
primordials.Uint32ArrayPrototypeBYTES_PER_ELEMENT = Uint32ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Uint8Array properties:
// - length
// - name
// - SymbolSpecies
primordials.Uint8Array = $Uint8Array;
primordials.Uint8ArrayBYTES_PER_ELEMENT = $Uint8Array.$BYTES_PER_ELEMENT;

const { $prototype: Uint8ArrayPrototype } = $Uint8Array;
primordials.Uint8ArrayPrototype = Uint8ArrayPrototype;
primordials.Uint8ArrayPrototypeBYTES_PER_ELEMENT = Uint8ArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following Uint8ClampedArray properties:
// - length
// - name
// - SymbolSpecies
primordials.Uint8ClampedArray = $Uint8ClampedArray;
primordials.Uint8ClampedArrayBYTES_PER_ELEMENT = $Uint8ClampedArray.$BYTES_PER_ELEMENT;

const { $prototype: Uint8ClampedArrayPrototype } = $Uint8ClampedArray;
primordials.Uint8ClampedArrayPrototype = Uint8ClampedArrayPrototype;
primordials.Uint8ClampedArrayPrototypeBYTES_PER_ELEMENT = Uint8ClampedArrayPrototype.$BYTES_PER_ELEMENT;

// Skipped the following WeakMap properties:
// - length
// - name
primordials.WeakMap = $WeakMap;

primordials.WeakMapPrototype = WeakMapPrototype;
primordials.WeakMapPrototypeDelete = uncurry1Args(WeakMapPrototypeDeleteRaw);
primordials.WeakMapPrototypeGet = uncurry1Args(WeakMapPrototypeGetRaw);
primordials.WeakMapPrototypeHas = uncurry1Args(WeakMapPrototypeHasRaw);
primordials.WeakMapPrototypeSet = uncurry2Args(WeakMapPrototypeSetRaw);
primordials.WeakMapPrototypeSymbolToStringTag = WeakMapPrototypeSymbolToStringTag;

// Skipped the following WeakRef properties:
// - length
// - name
primordials.WeakRef = $WeakRef;

primordials.WeakRefPrototype = WeakRefPrototype;
primordials.WeakRefPrototypeDeref = uncurry0Args(WeakRefPrototypeDerefRaw);
primordials.WeakRefPrototypeSymbolToStringTag = WeakRefPrototypeSymbolToStringTag;

// Skipped the following WeakSet properties:
// - length
// - name
primordials.WeakSet = $WeakSet;

primordials.WeakSetPrototype = WeakSetPrototype;
primordials.WeakSetPrototypeAdd = uncurry1Args(WeakSetPrototypeAddRaw);
primordials.WeakSetPrototypeDelete = uncurry1Args(WeakSetPrototypeDeleteRaw);
primordials.WeakSetPrototypeHas = uncurry1Args(WeakSetPrototypeHasRaw);
primordials.WeakSetPrototypeSymbolToStringTag = WeakSetPrototypeSymbolToStringTag;

// Skipped the following Promise properties:
// - length
// - name
primordials.Promise = $Promise;
primordials.PromiseGetSymbolSpeciesRaw = uncurry0Args(PromiseGetSymbolSpeciesRaw);

// Create copies of intrinsic objects that require a valid `this` to call
// static methods.
// Refs: https://www.ecma-international.org/ecma-262/#sec-promise.all
primordials.PromiseAll = v => $Promise.$all(v);
primordials.PromiseAllSettled = v => $Promise.$allSettled(v);
primordials.PromiseAny = v => $Promise.$any(v);
primordials.PromiseRace = v => $Promise.$race(v);
primordials.PromiseReject = v => $Promise.$reject(v);
primordials.PromiseResolve = v => $Promise.$resolve(v);
primordials.PromiseWithResolvers = () => $newPromiseCapability($Promise);

primordials.PromisePrototype = PromisePrototype;
primordials.PromisePrototypeCatch = uncurry1Args(PromisePrototypeCatchRaw);
primordials.PromisePrototypeFinally = uncurry1Args(PromisePrototypeFinallyRaw);
primordials.PromisePrototypeThen = uncurry2Args(PromisePrototypeThenRaw);

// Create copies of abstract intrinsic objects that are not directly exposed
// on the global object.
// Refs: https://tc39.es/ecma262/#sec-%typedarray%-intrinsic-object

// Skipped the following TypedArray properties:
// - SymbolSpecies
const TypedArray = $Uint8Array.$__proto__;
primordials.TypedArray = TypedArray;
primordials.TypedArrayFrom = (a, c, t) =>
  $argumentCount() === 1 ? $typedArrayFromFast(TypedArray, a) : TypedArray.$from(a, c, t);
primordials.TypedArrayOf = TypedArray.$of;
primordials.TypedArrayOfApply = applyBind(TypedArray.$of, TypedArray);

const { $prototype: TypedArrayPrototype } = TypedArray;
primordials.TypedArrayPrototype = TypedArrayPrototype;
primordials.TypedArrayPrototypeAt = uncurry1Args(TypedArrayPrototype.$at);
primordials.TypedArrayPrototypeGetBuffer = uncurry0Args(TypedArrayPrototype.$__lookupGetter__($buffer));
primordials.TypedArrayPrototypeGetByteLength = uncurry0Args(TypedArrayPrototype.$__lookupGetter__($byteLength));
primordials.TypedArrayPrototypeGetByteOffset = uncurry0Args(TypedArrayPrototype.$__lookupGetter__($byteOffset));
primordials.TypedArrayPrototypeCopyWithin = uncurry3Args(TypedArrayPrototype.$copyWithin);
primordials.TypedArrayPrototypeEntries = uncurry0Args(TypedArrayPrototype.$entries);
primordials.TypedArrayPrototypeEvery = uncurry2Args(TypedArrayPrototype.$every);
primordials.TypedArrayPrototypeFill = uncurry3Args(TypedArrayPrototype.$fill);
primordials.TypedArrayPrototypeFilter = uncurry2Args(TypedArrayPrototype.$filter);
primordials.TypedArrayPrototypeFind = uncurry2Args(TypedArrayPrototype.$find);
primordials.TypedArrayPrototypeFindIndex = uncurry2Args(TypedArrayPrototype.$findIndex);
primordials.TypedArrayPrototypeFindLast = uncurry2Args(TypedArrayPrototype.$findLast);
primordials.TypedArrayPrototypeFindLastIndex = uncurry2Args(TypedArrayPrototype.$findLastIndex);
primordials.TypedArrayPrototypeForEach = uncurry2Args(TypedArrayPrototype.$forEach);
primordials.TypedArrayPrototypeIncludes = uncurry2Args(TypedArrayPrototype.$includes);
primordials.TypedArrayPrototypeIndexOf = uncurry2Args(TypedArrayPrototype.$indexOf);
primordials.TypedArrayPrototypeJoin = uncurry1Args(TypedArrayPrototype.$join);
primordials.TypedArrayPrototypeKeys = uncurry0Args(TypedArrayPrototype.$keys);
primordials.TypedArrayPrototypeLastIndexOf = uncurry2Args(TypedArrayPrototype.$lastIndexOf);
// The @typedArrayLength private method is roughly equivalent to TypedArrayPrototype length getter.
primordials.TypedArrayPrototypeGetLength = a => $typedArrayLength(a);
primordials.TypedArrayPrototypeMap = uncurry2Args(TypedArrayPrototype.$map);
primordials.TypedArrayPrototypeReduce = uncurry2Args(TypedArrayPrototype.$reduce);
primordials.TypedArrayPrototypeReduceRight = uncurry2Args(TypedArrayPrototype.$reduceRight);
primordials.TypedArrayPrototypeReverse = uncurry0Args(TypedArrayPrototype.$reverse);
primordials.TypedArrayPrototypeSet = uncurry2Args(TypedArrayPrototype.$set);
primordials.TypedArrayPrototypeSlice = uncurry2Args(TypedArrayPrototype.$slice);
primordials.TypedArrayPrototypeSome = uncurry2Args(TypedArrayPrototype.$some);
primordials.TypedArrayPrototypeSort = uncurry1Args(TypedArrayPrototype.$sort);
primordials.TypedArrayPrototypeSubarray = uncurry2Args(TypedArrayPrototype.$subarray);
primordials.TypedArrayPrototypeSymbolIterator = uncurry0Args(TypedArrayPrototype.$$iterator);
primordials.TypedArrayPrototypeToLocaleString = uncurry2Args(TypedArrayPrototype.$toLocaleString);
primordials.TypedArrayPrototypeToReversed = uncurry0Args(TypedArrayPrototype.$toReversed);
primordials.TypedArrayPrototypeToSorted = uncurry1Args(TypedArrayPrototype.$toSorted);
primordials.TypedArrayPrototypeToString = uncurry0Args(TypedArrayPrototype.$toString);
primordials.TypedArrayPrototypeGetSymbolToStringTag = uncurry0Args(
  TypedArrayPrototype.$__lookupGetter__($$toStringTag),
);
primordials.TypedArrayPrototypeValues = uncurry0Args(TypedArrayPrototype.$values);

primordials.AsyncIteratorPrototype = async function* () {}.$prototype.$__proto__.$__proto__;
primordials.IteratorPrototype = ArrayIteratorPrototype.$__proto__;

const arrayToSafePromiseIterable = (promises, mapFn) => {
  const { $length: length } = promises;
  const mapped = $newArrayWithSize(length);
  if ($isCallable(mapFn)) {
    for (let i = 0; i < length; i += 1) {
      // JSInternalPromise is completely separated instance from the JSPromise.
      // Since its prototype and constructor are different from the exposed Promises' ones,
      // all the user modification onto the exposed Promise does not have effect on JSInternalPromise.
      //
      // e.g.
      //     Replacing Promise.prototype.then with the user-customized one does not effect on JSInternalPromise.
      //
      // CAUTION: Must not leak the JSInternalPromise to the user space to keep its integrity.
      const {
        promise: promiseInternal,
        resolve: resolveInternal,
        reject: rejectInternal,
      } = $newPromiseCapability($InternalPromise);
      mapFn(promises[i], i).$then(resolveInternal, rejectInternal);
      $putByValDirect(mapped[i], promiseInternal);
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      const {
        promise: promiseInternal,
        resolve: resolveInternal,
        reject: rejectInternal,
      } = $newPromiseCapability($InternalPromise);
      promises[i].$then(resolveInternal, rejectInternal);
      $putByValDirect(mapped[i], promiseInternal);
    }
  }
  return new SafeArrayIterator(mapped);
};

// Subclass the constructors because we need to use their prototype
// methods later.
// Defining the `constructor` is necessary here to avoid the default
// constructor which uses the user-mutable `%ArrayIteratorPrototype%.next`.

primordials.SafeFinalizationRegistry = defineSafeCtor(
  class SafeFinalizationRegistry extends FinalizationRegistry {
    constructor(cleanupCallback) {
      super(cleanupCallback);
    }
  },
  {
    proto: [
      "register",
      "value",
      FinalizationRegistryPrototypeRegisterRaw,
      "unregister",
      "value",
      FinalizationRegistryPrototypeUnregisterRaw,
      SymbolToStringTag,
      "value",
      FinalizationRegistryPrototypeSymbolToStringTag,
    ],
  },
);

primordials.SafeMap = defineSafeCtor(
  class SafeMap extends $Map {
    constructor(i) {
      super(i);
    }
  },
  {
    ctor: [SymbolSpecies, "get", MapGetSymbolSpeciesRaw],
    proto: [
      "clear",
      "value",
      MapPrototypeClearRaw,
      "delete",
      "value",
      MapPrototypeDeleteRaw,
      "entries",
      "value",
      SafeMapPrototypeEntriesRaw,
      "forEach",
      "value",
      MapPrototypeForEachRaw,
      "get",
      "value",
      MapPrototypeGetRaw,
      "has",
      "value",
      MapPrototypeHasRaw,
      "keys",
      "value",
      MapPrototypeKeysRaw,
      "set",
      "value",
      MapPrototypeSetRaw,
      "size",
      "get",
      MapPrototypeGetSizeRaw,
      "values",
      "value",
      SafeMapPrototypeValuesRaw,
      SymbolIterator,
      "value",
      SafeMapPrototypeEntriesRaw,
      SymbolToStringTag,
      "value",
      MapPrototypeSymbolToStringTag,
    ],
  },
);

primordials.SafePromise = defineSafeCtor(
  class SafePromise extends $Promise {
    constructor(e) {
      super(e);
    }
  },
  {
    ctor: [
      "all",
      "value",
      PromiseAllRaw,
      "allSettled",
      "value",
      PromiseAllSettledRaw,
      "any",
      "value",
      PromiseAnyRaw,
      "race",
      "value",
      PromiseRaceRaw,
      "reject",
      "value",
      PromiseRejectRaw,
      "resolve",
      "value",
      PromiseResolveRaw,
      "withResolvers",
      "value",
      PromiseWithResolversRaw,
      SymbolSpecies,
      "get",
      PromiseGetSymbolSpeciesRaw,
    ],
    proto: [
      "catch",
      "value",
      PromisePrototypeCatchRaw,
      "finally",
      "value",
      PromisePrototypeFinallyRaw,
      "then",
      "value",
      PromisePrototypeThenRaw,
    ],
  },
);

primordials.SafeSet = defineSafeCtor(
  class SafeSet extends $Set {
    constructor(i) {
      super(i);
    }
  },
  {
    ctor: [SymbolSpecies, "get", SetGetSymbolSpeciesRaw],
    proto: [
      "add",
      "value",
      SetPrototypeAddRaw,
      "clear",
      "value",
      SetPrototypeClearRaw,
      "delete",
      "value",
      SetPrototypeDeleteRaw,
      "entries",
      "value",
      SafeSetPrototypeEntriesRaw,
      "forEach",
      "value",
      SetPrototypeForEachRaw,
      "has",
      "value",
      SetPrototypeHasRaw,
      "keys",
      "value",
      SetPrototypeKeysRaw,
      "size",
      "get",
      SetPrototypeGetSizeRaw,
      "values",
      "value",
      SafeSetPrototypeValuesRaw,
      SymbolIterator,
      "value",
      SafeSetPrototypeValuesRaw,
      SymbolToStringTag,
      "value",
      SetPrototypeSymbolToStringTag,
    ],
  },
);

primordials.SafeWeakMap = defineSafeCtor(
  class SafeWeakMap extends $WeakMap {
    constructor(i) {
      super(i);
    }
  },
  {
    proto: [
      "delete",
      "value",
      WeakMapPrototypeDeleteRaw,
      "get",
      "value",
      WeakMapPrototypeGetRaw,
      "has",
      "value",
      WeakMapPrototypeHasRaw,
      "set",
      "value",
      WeakMapPrototypeSetRaw,
      SymbolToStringTag,
      "value",
      WeakMapPrototypeSymbolToStringTag,
    ],
  },
);

primordials.SafeWeakRef = defineSafeCtor(
  class SafeWeakRef extends $WeakRef {
    constructor(i) {
      super(i);
    }
  },
  {
    proto: ["deref", "value", WeakRefPrototypeDerefRaw, SymbolToStringTag, "value", WeakRefPrototypeSymbolToStringTag],
  },
);

primordials.SafeWeakSet = defineSafeCtor(
  class SafeWeakSet extends $WeakSet {
    constructor(i) {
      super(i);
    }
  },
  {
    proto: [
      "add",
      "value",
      WeakSetPrototypeAddRaw,
      "delete",
      "value",
      WeakSetPrototypeDeleteRaw,
      "has",
      "value",
      WeakSetPrototypeHasRaw,
      SymbolToStringTag,
      "value",
      WeakSetPrototypeSymbolToStringTag,
    ],
  },
);

/**
 * Attaches a callback that is invoked when the Promise is settled (fulfilled or
 * rejected). The resolved value cannot be modified from the callback.
 * Prefer using async functions when possible.
 * @param {Promise<any>} thisPromise
 * @param {() => void) | undefined | null} onFinally The callback to execute
 *        when the Promise is settled (fulfilled or rejected).
 * @returns {Promise} A Promise for the completion of the callback.
 */
primordials.SafePromisePrototypeFinally = (thisPromise, onFinally) => {
  // JSInternalPromise is completely separated instance from the JSPromise.
  // Since its prototype and constructor are different from the exposed Promises' ones,
  // all the user modification onto the exposed Promise does not have effect on JSInternalPromise.
  //
  // e.g.
  //     Replacing Promise.prototype.then with the user-customized one does not effect on JSInternalPromise.
  //
  // CAUTION: Must not leak the JSInternalPromise to the user space to keep its integrity.
  const {
    promise: promiseInternal,
    resolve: resolveInternal,
    reject: rejectInternal,
  } = $newPromiseCapability($InternalPromise);
  const {
    promise: promiseUserland,
    resolve: resolveUserland,
    reject: rejectUserland,
  } = $newPromiseCapability($Promise);
  promiseInternal.finally(onFinally).then(resolveUserland, rejectUserland);
  thisPromise.$then(resolveInternal, rejectInternal);
  // Wrapping on a new Promise is necessary to not expose the SafePromise
  // prototype to user-land.
  return promiseUserland;
};

/**
 * @template T,U
 * @param {Array<T | PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<Awaited<U>[]>}
 */
primordials.SafePromiseAll = (promises, mapFn) => {
  // Wrapping on a new Promise is necessary to not expose the InternalPromise
  // to user-land.
  try {
    return $Promise.$all(arrayToSafePromiseIterable(promises, mapFn));
  } catch (e) {
    return $Promise.$reject(e);
  }
};

/**
 * Should only be used for internal functions, this would produce similar
 * results as `Promise.all` but without prototype pollution, and the return
 * value is not a genuine Array but an array-like object.
 * @template T,U
 * @param {ArrayLike<T | PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<ArrayLike<Awaited<U>>>}
 */
primordials.SafePromiseAllReturnArrayLike = (promises, mapFn) => {
  const { $length: length } = promises;
  const returnVal = $newArrayWithSize(length);
  $setPrototypeDirect.$call(returnVal, null);
  if (length === 0) return $Promise.$resolve(returnVal);

  let pendingPromises = length;
  const { promise, resolve, reject } = $newPromiseCapability($Promise);
  const resolveForIndex = i => result => {
    returnVal[i] = result;
    if (--pendingPromises === 0) resolve(returnVal);
  };
  try {
    if ($isCallable(mapFn)) {
      for (let i = 0; i < length; i += 1) {
        $Promise.$resolve(mapFn(promises[i], i)).$then(resolveForIndex(i), reject);
      }
    } else {
      for (let i = 0; i < length; i += 1) {
        $Promise.$resolve(promises[i]).$then(resolveForIndex(i), reject);
      }
    }
  } catch (e) {
    reject(e);
  }
  return promise;
};

/**
 * Should only be used when we only care about waiting for all the promises to
 * resolve, not what value they resolve to.
 * @template T,U
 * @param {ArrayLike<T | PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<void>}
 */
primordials.SafePromiseAllReturnVoid = (promises, mapFn) => {
  const { $length: length } = promises;
  if (length === 0) return $Promise.$resolve();

  let pendingPromises = length;
  const { promise, resolve, reject } = $newPromiseCapability($Promise);
  const onFulfilled = () => {
    if (--pendingPromises === 0) resolve();
  };
  try {
    if ($isCallable(mapFn)) {
      for (let i = 0; i < length; i += 1) {
        $Promise.$resolve(mapFn(promises[i], i)).$then(onFulfilled, reject);
      }
    } else {
      for (let i = 0; i < length; i += 1) {
        $Promise.$resolve(promises[i]).$then(onFulfilled, reject);
      }
    }
  } catch (e) {
    reject(e);
  }
  return promise;
};

/**
 * @template T,U
 * @param {Array<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<PromiseSettledResult<any>[]>}
 */
primordials.SafePromiseAllSettled = (promises, mapFn) => {
  // Wrapping on a new Promise is necessary to not expose the InternalPromise
  // to user-land.
  try {
    return $Promise.$allSettled(arrayToSafePromiseIterable(promises, mapFn));
  } catch (e) {
    return $Promise.$reject(e);
  }
};

/**
 * Should only be used when we only care about waiting for all the promises to
 * settle, not what value they resolve or reject to.
 * @template T,U
 * @param {ArrayLike<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<void>}
 */
primordials.SafePromiseAllSettledReturnVoid = (promises, mapFn) => {
  const { $length: length } = promises;
  if (length === 0) return $Promise.$resolve();

  let pendingPromises = length;
  const { promise, resolve, reject } = $newPromiseCapability($Promise);
  const onSettle = () => {
    if (--pendingPromises === 0) resolve();
  };
  try {
    if ($isCallable(mapFn)) {
      for (let i = 0; i < length; i += 1) {
        $Promise.$resolve(mapFn(promises[i], i)).$then(onSettle, onSettle);
      }
    } else {
      for (let i = 0; i < length; i += 1) {
        $Promise.$resolve(promises[i]).$then(onSettle, onSettle);
      }
    }
  } catch (e) {
    reject(e);
  }
  return promise;
};

/**
 * @template T,U
 * @param {Array<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<Awaited<U>>}
 */
primordials.SafePromiseAny = (promises, mapFn) => {
  // Wrapping on a new Promise is necessary to not expose the InternalPromise
  // to user-land.
  try {
    return $Promise.$any(arrayToSafePromiseIterable(promises, mapFn));
  } catch (e) {
    return $Promise.$reject(e);
  }
};

/**
 * @template T,U
 * @param {Array<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<Awaited<U>>}
 */
primordials.SafePromiseRace = (promises, mapFn) => {
  // Wrapping on a new Promise is necessary to not expose the InternalPromise
  // to user-land.
  try {
    return $Promise.$race(arrayToSafePromiseIterable(promises, mapFn));
  } catch (e) {
    return $Promise.$reject(e);
  }
};

class RegExpLikeForStringSplitting {
  #regex;
  constructor(pattern, flags) {
    this.#regex = $regExpCreate(pattern, flags);
  }
  exec(string) {
    return RegExpPrototypeExecRaw.$call(this.#regex, string);
  }
  get lastIndex() {
    return this.#regex.lastIndex;
  }
  set lastIndex(value) {
    $putByValDirect(this.#regex, "lastIndex", value);
  }
}
$setPrototypeDirect.$call(RegExpLikeForStringSplitting.prototype, null);

/**
 * @param {RegExp} pattern
 * @returns {RegExp}
 */
primordials.hardenRegExp = pattern => {
  $putByValDirect(pattern, SymbolMatch, RegExpPrototypeSymbolMatchRaw);
  $putByValDirect(pattern, SymbolMatchAll, RegExpPrototypeSymbolMatchAllRaw);
  $putByValDirect(pattern, SymbolReplace, RegExpPrototypeSymbolReplaceRaw);
  $putByValDirect(pattern, SymbolSearch, RegExpPrototypeSymbolSearchRaw);
  $putByValDirect(pattern, SymbolSplit, RegExpPrototypeSymbolSplitRaw);
  $putByValDirect(pattern, "constructor", $createObjectWithoutPrototype(SymbolSpecies, RegExpLikeForStringSplitting));
  $putByValDirect(pattern, "dotAll", pattern.$dotAll);
  $putByValDirect(pattern, "exec", RegExpPrototypeExecRaw);
  $putByValDirect(pattern, "flags", pattern.$flags);
  $putByValDirect(pattern, "global", pattern.$global);
  $putByValDirect(pattern, "hasIndices", pattern.$hasIndices);
  $putByValDirect(pattern, "ignoreCase", pattern.$ignoreCase);
  $putByValDirect(pattern, "multiline", pattern.$multiline);
  $putByValDirect(pattern, "source", pattern.$source);
  $putByValDirect(pattern, "sticky", pattern.$sticky);
  $putByValDirect(pattern, "unicode", pattern.$unicode);
  return pattern;
};

/**
 * @param {string} string
 * @param {RegExp} regexp
 * @returns {number}
 */
primordials.SafeStringPrototypeSearch = primordials.StringPrototypeSearch;

ObjectFreeze(primordials);

export default primordials;
