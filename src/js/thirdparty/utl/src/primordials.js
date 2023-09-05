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

function getGetter(cls, getter) {
  // TODO: __lookupGetter__ is deprecated, but Object.getOwnPropertyDescriptor doesn't work on built-ins like Typed Arrays.
  return Function.prototype.call.bind(cls.prototype.__lookupGetter__(getter));
}

function getterCaller(getter) {
  return (val) => {
    return val.constructor.prototype.__lookupGetter__(getter).call(val);
  };
}

function uncurryThis(func) {
  return Function.prototype.call.bind(func);
}

const copyProps = (src, dest) => {
  Array.prototype.forEach.call(Reflect.ownKeys(src), (key) => {
    if (!Reflect.getOwnPropertyDescriptor(dest, key)) {
      Reflect.defineProperty(
        dest,
        key,
        Reflect.getOwnPropertyDescriptor(src, key));
    }
  });
};

const makeSafe = (unsafe, safe) => {
  if (Symbol.iterator in unsafe.prototype) {
    const dummy = new unsafe();
    let next; // We can reuse the same `next` method.

    Array.prototype.forEach.call(Reflect.ownKeys(unsafe.prototype), (key) => {
      if (!Reflect.getOwnPropertyDescriptor(safe.prototype, key)) {
        const desc = Reflect.getOwnPropertyDescriptor(unsafe.prototype, key);
        if (
          typeof desc.value === 'function' &&
          desc.value.length === 0 &&
          Symbol.iterator in (Function.prototype.call.call(desc.value, dummy) || {})
        ) {
          const createIterator = uncurryThis(desc.value);
          next ??= uncurryThis(createIterator(dummy).next);
          const SafeIterator = createSafeIterator(createIterator, next);
          desc.value = function() {
            return new SafeIterator(this);
          };
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

const StringIterator = Function.prototype.call.bind(String.prototype[Symbol.iterator]);
const StringIteratorPrototype = Reflect.getPrototypeOf(StringIterator(''));

function ErrorCaptureStackTrace(targetObject) {
  const stack = new Error().stack;
  // Remove the second line, which is this function
  targetObject.stack = stack.replace(/.*\n.*/, '$1');
}

export default {
  makeSafe, // exported for testing
  Array,
  ArrayFrom: Array.from,
  ArrayIsArray: Array.isArray,
  ArrayPrototypeFlat: Function.prototype.call.bind(Array.prototype.flat),
  ArrayPrototypeFilter: Function.prototype.call.bind(Array.prototype.filter),
  ArrayPrototypeForEach: Function.prototype.call.bind(Array.prototype.forEach),
  ArrayPrototypeIncludes: Function.prototype.call.bind(Array.prototype.includes),
  ArrayPrototypeIndexOf: Function.prototype.call.bind(Array.prototype.indexOf),
  ArrayPrototypeJoin: Function.prototype.call.bind(Array.prototype.join),
  ArrayPrototypeMap: Function.prototype.call.bind(Array.prototype.map),
  ArrayPrototypePop: Function.prototype.call.bind(Array.prototype.pop),
  ArrayPrototypePush: Function.prototype.call.bind(Array.prototype.push),
  ArrayPrototypePushApply: Function.apply.bind(Array.prototype.push),
  ArrayPrototypeSlice: Function.prototype.call.bind(Array.prototype.slice),
  ArrayPrototypeSort: Function.prototype.call.bind(Array.prototype.sort),
  ArrayPrototypeSplice: Function.prototype.call.bind(Array.prototype.splice),
  ArrayPrototypeUnshift: Function.prototype.call.bind(Array.prototype.unshift),
  BigIntPrototypeValueOf: Function.prototype.call.bind(BigInt.prototype.valueOf),
  BooleanPrototypeValueOf: Function.prototype.call.bind(Boolean.prototype.valueOf),
  DatePrototypeGetTime: Function.prototype.call.bind(Date.prototype.getTime),
  DatePrototypeToISOString: Function.prototype.call.bind(Date.prototype.toISOString),
  DatePrototypeToString: Function.prototype.call.bind(Date.prototype.toString),
  ErrorCaptureStackTrace,
  ErrorPrototypeToString: Function.prototype.call.bind(Error.prototype.toString),
  FunctionPrototypeBind: Function.prototype.call.bind(Function.prototype.bind),
  FunctionPrototypeCall: Function.prototype.call.bind(Function.prototype.call),
  FunctionPrototypeToString: Function.prototype.call.bind(Function.prototype.toString),
  JSONStringify: JSON.stringify,
  MapPrototypeGetSize: getGetter(Map, 'size'),
  MapPrototypeEntries: Function.prototype.call.bind(Map.prototype.entries),
  MapPrototypeValues: Function.prototype.call.bind(Map.prototype.values),
  MapPrototypeKeys: Function.prototype.call.bind(Map.prototype.keys),
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
  NumberPrototypeToString: Function.prototype.call.bind(Number.prototype.toString),
  NumberPrototypeValueOf: Function.prototype.call.bind(Number.prototype.valueOf),
  Object,
  ObjectAssign: Object.assign,
  ObjectCreate: Object.create,
  ObjectDefineProperty: Object.defineProperty,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectGetOwnPropertySymbols: Object.getOwnPropertySymbols,
  ObjectGetPrototypeOf: Object.getPrototypeOf,
  ObjectIs: Object.is,
  ObjectKeys: Object.keys,
  ObjectPrototypeHasOwnProperty: Function.prototype.call.bind(Object.prototype.hasOwnProperty),
  ObjectPrototypePropertyIsEnumerable: Function.prototype.call.bind(Object.prototype.propertyIsEnumerable),
  ObjectSeal: Object.seal,
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  ReflectApply: Reflect.apply,
  ReflectOwnKeys: Reflect.ownKeys,
  RegExp,
  RegExpPrototypeExec: Function.prototype.call.bind(RegExp.prototype.exec),
  RegExpPrototypeSymbolReplace: Function.prototype.call.bind(RegExp.prototype[Symbol.replace]),
  RegExpPrototypeSymbolSplit: Function.prototype.call.bind(RegExp.prototype[Symbol.split]),
  RegExpPrototypeTest: Function.prototype.call.bind(RegExp.prototype.test),
  RegExpPrototypeToString: Function.prototype.call.bind(RegExp.prototype.toString),
  SafeStringIterator: createSafeIterator(
    StringIterator,
    Function.prototype.call.bind(StringIteratorPrototype.next),
  ),
  SafeMap: makeSafe(
    Map,
    class SafeMap extends Map {
      constructor(i) { super(i); }
    }),
  SafeSet: makeSafe(
    Set,
    class SafeSet extends Set {
      constructor(i) { super(i); }
    }),
  SetPrototypeGetSize: getGetter(Set, 'size'),
  SetPrototypeEntries: Function.prototype.call.bind(Set.prototype.entries),
  SetPrototypeValues: Function.prototype.call.bind(Set.prototype.values),
  String,
  StringPrototypeCharCodeAt: Function.prototype.call.bind(String.prototype.charCodeAt),
  StringPrototypeCodePointAt: Function.prototype.call.bind(String.prototype.codePointAt),
  StringPrototypeEndsWith: Function.prototype.call.bind(String.prototype.endsWith),
  StringPrototypeIncludes: Function.prototype.call.bind(String.prototype.includes),
  StringPrototypeIndexOf: Function.prototype.call.bind(String.prototype.indexOf),
  StringPrototypeLastIndexOf: Function.prototype.call.bind(String.prototype.lastIndexOf),
  StringPrototypeMatch: Function.prototype.call.bind(String.prototype.match),
  StringPrototypeNormalize: Function.prototype.call.bind(String.prototype.normalize),
  StringPrototypePadEnd: Function.prototype.call.bind(String.prototype.padEnd),
  StringPrototypePadStart: Function.prototype.call.bind(String.prototype.padStart),
  StringPrototypeRepeat: Function.prototype.call.bind(String.prototype.repeat),
  StringPrototypeReplace: Function.prototype.call.bind(String.prototype.replace),
  StringPrototypeReplaceAll: Function.prototype.call.bind(String.prototype.replaceAll),
  StringPrototypeSlice: Function.prototype.call.bind(String.prototype.slice),
  StringPrototypeSplit: Function.prototype.call.bind(String.prototype.split),
  StringPrototypeStartsWith: Function.prototype.call.bind(String.prototype.startsWith),
  StringPrototypeToLowerCase: Function.prototype.call.bind(String.prototype.toLowerCase),
  StringPrototypeTrim: Function.prototype.call.bind(String.prototype.trim),
  StringPrototypeValueOf: Function.prototype.call.bind(String.prototype.valueOf),
  SymbolPrototypeToString: Function.prototype.call.bind(Symbol.prototype.toString),
  SymbolPrototypeValueOf: Function.prototype.call.bind(Symbol.prototype.valueOf),
  SymbolIterator: Symbol.iterator,
  SymbolFor: Symbol.for,
  SymbolToStringTag: Symbol.toStringTag,
  TypedArrayPrototypeGetLength: getGetter(Uint8Array, 'length'),
  TypedArrayPrototypeGetSymbolToStringTag: getGetter(Uint8Array, Symbol.toStringTag),
  Uint8ClampedArray,
  Uint8Array, Uint16Array, Uint32Array,
  Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array,
  BigUint64Array, BigInt64Array,
  uncurryThis,
};
