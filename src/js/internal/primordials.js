// TODO: Use native code and JSC intrinsics for everything in this file.
// Do not use this file for new code, many things here will be slow especailly when intrinsics for these operations is available.
// It is primarily used for `internal/util`

const createSafeIterator = (factory, next) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory(iterable);
    }
    next() {
      return next(this._iterator);
    }
    [Symbol.iterator]() {
      return this;
    }
  }
  Object.setPrototypeOf(SafeIterator.prototype, null);
  Object.freeze(SafeIterator.prototype);
  Object.freeze(SafeIterator);
  return SafeIterator;
};

// Intrinsics do not have `call` as a valid identifier, so this cannot be `Function.prototype.call.bind`.
const FunctionPrototypeCall = $getByIdDirect(Function.prototype, "call");

function getGetter(cls, getter) {
  // TODO: __lookupGetter__ is deprecated, but Object.getOwnPropertyDescriptor doesn't work on built-ins like Typed Arrays.
  return FunctionPrototypeCall.bind(cls.prototype.__lookupGetter__(getter));
}

function uncurryThis(func) {
  // Intrinsics do not have `call` as a valid identifier, so this cannot be `Function.prototype.call.bind`.
  return FunctionPrototypeCall.bind(func);
}

const copyProps = (src, dest) => {
  ArrayPrototypeForEach(Reflect.ownKeys(src), key => {
    if (!Reflect.getOwnPropertyDescriptor(dest, key)) {
      Reflect.defineProperty(dest, key, Reflect.getOwnPropertyDescriptor(src, key));
    }
  });
};

const makeSafe = (unsafe, safe) => {
  if (Symbol.iterator in unsafe.prototype) {
    const dummy = new unsafe();
    let next; // We can reuse the same `next` method.

    ArrayPrototypeForEach(Reflect.ownKeys(unsafe.prototype), key => {
      if (!Reflect.getOwnPropertyDescriptor(safe.prototype, key)) {
        const desc = Reflect.getOwnPropertyDescriptor(unsafe.prototype, key);
        if (typeof desc.value === "function" && desc.value.length === 0) {
          const called = desc.value.$call(dummy) || {};
          if (Symbol.iterator in (typeof called === "object" ? called : {})) {
            const createIterator = uncurryThis(desc.value);
            next ??= uncurryThis(createIterator(dummy).next);
            const SafeIterator = createSafeIterator(createIterator, next);
            desc.value = function () {
              return new SafeIterator(this);
            };
          }
        }
        Reflect.defineProperty(safe.prototype, key, desc);
      }
    });
  } else copyProps(unsafe.prototype, safe.prototype);
  copyProps(unsafe, safe);

  Object.setPrototypeOf(safe.prototype, null);
  Object.freeze(safe.prototype);
  Object.freeze(safe);
  return safe;
};

const StringIterator = uncurryThis(String.prototype[Symbol.iterator]);
const StringIteratorPrototype = Reflect.getPrototypeOf(StringIterator(""));
const ArrayPrototypeForEach = uncurryThis(Array.prototype.forEach);

function ErrorCaptureStackTrace(targetObject) {
  const stack = new Error().stack;
  // Remove the second line, which is this function
  targetObject.stack = stack.replace(/.*\n.*/, "$1");
}

const arrayProtoPush = Array.prototype.push;

export default {
  makeSafe, // exported for testing
  Array,
  ArrayFrom: Array.from,
  ArrayPrototypeFlat: uncurryThis(Array.prototype.flat),
  ArrayPrototypeFilter: uncurryThis(Array.prototype.filter),
  ArrayPrototypeForEach,
  ArrayPrototypeIncludes: uncurryThis(Array.prototype.includes),
  ArrayPrototypeIndexOf: uncurryThis(Array.prototype.indexOf),
  ArrayPrototypeJoin: uncurryThis(Array.prototype.join),
  ArrayPrototypeMap: uncurryThis(Array.prototype.map),
  ArrayPrototypePop: uncurryThis(Array.prototype.pop),
  ArrayPrototypePush: uncurryThis(arrayProtoPush),
  ArrayPrototypePushApply: (a, b) => arrayProtoPush.$apply(a, b),
  ArrayPrototypeSlice: uncurryThis(Array.prototype.slice),
  ArrayPrototypeSort: uncurryThis(Array.prototype.sort),
  ArrayPrototypeSplice: uncurryThis(Array.prototype.splice),
  ArrayPrototypeUnshift: uncurryThis(Array.prototype.unshift),
  BigIntPrototypeValueOf: uncurryThis(BigInt.prototype.valueOf),
  BooleanPrototypeValueOf: uncurryThis(Boolean.prototype.valueOf),
  DatePrototypeGetTime: uncurryThis(Date.prototype.getTime),
  DatePrototypeToISOString: uncurryThis(Date.prototype.toISOString),
  DatePrototypeToString: uncurryThis(Date.prototype.toString),
  ErrorCaptureStackTrace,
  ErrorPrototypeToString: uncurryThis(Error.prototype.toString),
  FunctionPrototypeToString: uncurryThis(Function.prototype.toString),
  JSONStringify: JSON.stringify,
  MapPrototypeGetSize: getGetter(Map, "size"),
  MapPrototypeEntries: uncurryThis(Map.prototype.entries),
  MapPrototypeValues: uncurryThis(Map.prototype.values),
  MapPrototypeKeys: uncurryThis(Map.prototype.keys),
  MathFloor: Math.floor,
  MathMax: Math.max,
  MathMin: Math.min,
  MathRound: Math.round,
  MathSqrt: Math.sqrt,
  MathTrunc: Math.trunc,
  Number,
  NumberIsFinite: Number.isFinite,
  NumberIsNaN: Number.isNaN,
  NumberParseFloat: Number.parseFloat,
  NumberParseInt: Number.parseInt,
  NumberPrototypeToString: uncurryThis(Number.prototype.toString),
  NumberPrototypeValueOf: uncurryThis(Number.prototype.valueOf),
  Object,
  ObjectAssign: Object.assign,
  ObjectCreate: Object.create,
  ObjectDefineProperty: Object.defineProperty,
  ObjectEntries: Object.entries,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectGetOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectGetOwnPropertySymbols: Object.getOwnPropertySymbols,
  ObjectGetPrototypeOf: Object.getPrototypeOf,
  ObjectIs: Object.is,
  ObjectKeys: Object.keys,
  ObjectPrototypeHasOwnProperty: uncurryThis(Object.prototype.hasOwnProperty),
  ObjectPrototypePropertyIsEnumerable: uncurryThis(Object.prototype.propertyIsEnumerable),
  ObjectPrototypeToString: uncurryThis(Object.prototype.toString),
  ObjectSeal: Object.seal,
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  ReflectOwnKeys: Reflect.ownKeys,
  RegExp,
  RegExpPrototypeExec: uncurryThis(RegExp.prototype.exec),
  RegExpPrototypeSymbolReplace: uncurryThis(RegExp.prototype[Symbol.replace]),
  RegExpPrototypeSymbolSplit: uncurryThis(RegExp.prototype[Symbol.split]),
  RegExpPrototypeTest: uncurryThis(RegExp.prototype.test),
  RegExpPrototypeToString: uncurryThis(RegExp.prototype.toString),
  SafeStringIterator: createSafeIterator(StringIterator, uncurryThis(StringIteratorPrototype.next)),
  SafeMap: makeSafe(
    Map,
    class SafeMap extends Map {
      constructor(i) {
        super(i);
      }
    },
  ),
  SafeSet: makeSafe(
    Set,
    class SafeSet extends Set {
      constructor(i) {
        super(i);
      }
    },
  ),
  SetPrototypeGetSize: getGetter(Set, "size"),
  SetPrototypeEntries: uncurryThis(Set.prototype.entries),
  SetPrototypeValues: uncurryThis(Set.prototype.values),
  String,
  StringPrototypeCharCodeAt: uncurryThis(String.prototype.charCodeAt),
  StringPrototypeCodePointAt: uncurryThis(String.prototype.codePointAt),
  StringPrototypeEndsWith: uncurryThis(String.prototype.endsWith),
  StringPrototypeIncludes: uncurryThis(String.prototype.includes),
  StringPrototypeIndexOf: uncurryThis(String.prototype.indexOf),
  StringPrototypeLastIndexOf: uncurryThis(String.prototype.lastIndexOf),
  StringPrototypeMatch: uncurryThis(String.prototype.match),
  StringPrototypeNormalize: uncurryThis(String.prototype.normalize),
  StringPrototypePadEnd: uncurryThis(String.prototype.padEnd),
  StringPrototypePadStart: uncurryThis(String.prototype.padStart),
  StringPrototypeRepeat: uncurryThis(String.prototype.repeat),
  StringPrototypeReplace: uncurryThis(String.prototype.replace),
  StringPrototypeReplaceAll: uncurryThis(String.prototype.replaceAll),
  StringPrototypeSlice: uncurryThis(String.prototype.slice),
  StringPrototypeSplit: uncurryThis(String.prototype.split),
  StringPrototypeStartsWith: uncurryThis(String.prototype.startsWith),
  StringPrototypeToLowerCase: uncurryThis(String.prototype.toLowerCase),
  StringPrototypeTrim: uncurryThis(String.prototype.trim),
  StringPrototypeValueOf: uncurryThis(String.prototype.valueOf),
  SymbolPrototypeToString: uncurryThis(Symbol.prototype.toString),
  SymbolPrototypeValueOf: uncurryThis(Symbol.prototype.valueOf),
  FunctionPrototypeToString: uncurryThis(Function.prototype.toString),
  FunctionPrototypeBind: uncurryThis(Function.prototype.bind),
  SymbolIterator: Symbol.iterator,
  SymbolFor: Symbol.for,
  SymbolToStringTag: Symbol.toStringTag,
  TypedArrayPrototypeGetLength: getGetter(Uint8Array, "length"),
  TypedArrayPrototypeGetSymbolToStringTag: getGetter(Uint8Array, Symbol.toStringTag),
  Uint8ClampedArray,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
  BigUint64Array,
  BigInt64Array,
  uncurryThis,
};
