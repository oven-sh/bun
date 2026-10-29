// What the compiler reads in place of src/js/internal/primordials.js. A stack trace shows the places of that file: a line that both
// files have stands for the line there, and a comment `as:` in front of a word quotes that file up to the word it stands for.
// Written against that file with the SHA-256 1707be69cea78abd175b76624ec9b7f6845993ca22b53f3405095b7e654e113e.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectFreeze = Object.freeze;
// Reflect lists a member from when it is first read: the four that the other text reads, in its order.
const {
  getPrototypeOf: _ReflectGetPrototypeOf,
  ownKeys: _ReflectOwnKeys,
  getOwnPropertyDescriptor: ReflectGetOwnPropertyDescriptor,
  defineProperty: ReflectDefineProperty,
} = Reflect;
const SymbolIterator = Symbol.iterator;
const SymbolSpecies = Symbol.species;
const SymbolToStringTag = Symbol.toStringTag;

// Intrinsics do not have `call` as a valid identifier, so this cannot be `Function.prototype.call.bind`.
const FunctionPrototypeCall = $getByIdDirect(Function.prototype, "call");

function uncurryThis(func) {
  return FunctionPrototypeCall.bind(func);
}

const callOwnFunctionsWithoutParameters = $newCppFunction(
  "BunCompiledModules.cpp",
  "jsFunctionCallOwnFunctionsWithoutParameters",
  3,
);

const defineOwnPropertiesLeftOut = $newCppFunction("BunCompiledModules.cpp", "jsFunctionDefineOwnPropertiesLeftOut", 3);

const sealClass = constructor => {
  const prototype = constructor.prototype;
  ObjectSetPrototypeOf(prototype, null);
  ObjectFreeze(prototype);
  ObjectFreeze(constructor);
};

const createSafeIterator = (factory, next_) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory./* as: this._iterator = factory */ $call(iterable);
    }
    next() {
      return next_./* as: return next_ */ $call(this._iterator);
    }
    [SymbolIterator]() {
      return this;
    }
  }
  sealClass(SafeIterator);
  return SafeIterator;
};

// `makers`: a key and a function that makes an iterator, and so on. What it answers holds under each key a function that makes a safe iterator, but for the four keys that are written out below.
const wrapMakersOfIterators = (makers, next) => {
  const wrapped = {};
  for (let i = 0; i < makers.length; i += 2) {
    const key = makers[i];
    if (key === "entries" || key === "keys" || key === "values" || key === SymbolIterator) continue;
    const SafeIterator = createSafeIterator(makers[i + 1], next);
    wrapped[key] = function () {
      return new SafeIterator(this);
    };
  }
  return wrapped;
};

const makeSafe = (unsafePrototype, safePrototype, dummy, next) =>
  wrapMakersOfIterators(
    /* as: desc.value.$call */ callOwnFunctionsWithoutParameters(unsafePrototype, safePrototype, dummy),
    next,
  );

const ArrayPrototypeSymbolIterator = Array.prototype[SymbolIterator];
const ArrayIteratorPrototypeNext = ArrayPrototypeSymbolIterator.$call([]).next;
const StringPrototypeSymbolIterator = String.prototype[SymbolIterator];
const StringIteratorPrototypeNext = StringPrototypeSymbolIterator.$call("").next;

const SafeArrayIterator = createSafeIterator(ArrayPrototypeSymbolIterator, ArrayIteratorPrototypeNext);
const SafeStringIterator = createSafeIterator(StringPrototypeSymbolIterator, StringIteratorPrototypeNext);

const MapPrototype = Map.prototype;
const MapPrototypeEntries = MapPrototype.entries;
const MapPrototypeKeys = MapPrototype.keys;
const MapPrototypeValues = MapPrototype.values;
const MapIteratorPrototypeNext = MapPrototypeEntries.$call(new Map()).next;

// A method that makes an iterator has a class of its own, also where two names hold one method.
const SafeMapEntries = createSafeIterator(MapPrototypeEntries, MapIteratorPrototypeNext);
const SafeMapKeys = createSafeIterator(MapPrototypeKeys, MapIteratorPrototypeNext);
const SafeMapValues = createSafeIterator(MapPrototypeValues, MapIteratorPrototypeNext);
const SafeMapSymbolIterator = createSafeIterator(MapPrototypeEntries, MapIteratorPrototypeNext);

class SafeMap extends Map {
  constructor(i) {
    super(i);
  }
}
const SafeMapPrototype = SafeMap.prototype;
const makersOfSafeIteratorsOfMap = /* as: SafeMap: makeSafe */ makeSafe(
  MapPrototype,
  SafeMapPrototype,
  new Map(),
  MapIteratorPrototypeNext,
);
ReflectDefineProperty(SafeMapPrototype, "clear", {
  value: MapPrototype.clear,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMapPrototype, "delete", {
  value: MapPrototype.delete,
  writable: true,
  enumerable: false,
  configurable: true,
});
const safeMapEntries = { value: undefined, writable: true, enumerable: false, configurable: true };
safeMapEntries.value = function () {
  return new /* as: return new SafeIterator */ SafeMapEntries(this);
};
ReflectDefineProperty(SafeMapPrototype, "entries", safeMapEntries);
ReflectDefineProperty(SafeMapPrototype, "forEach", {
  value: MapPrototype.forEach,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMapPrototype, "get", {
  value: MapPrototype.get,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMapPrototype, "has", {
  value: MapPrototype.has,
  writable: true,
  enumerable: false,
  configurable: true,
});
const safeMapKeys = { value: undefined, writable: true, enumerable: false, configurable: true };
safeMapKeys.value = function () {
  return new /* as: return new SafeIterator */ SafeMapKeys(this);
};
ReflectDefineProperty(SafeMapPrototype, "keys", safeMapKeys);
ReflectDefineProperty(SafeMapPrototype, "set", {
  value: MapPrototype.set,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMapPrototype, "getOrInsert", {
  value: MapPrototype.getOrInsert,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMapPrototype, "getOrInsertComputed", {
  value: MapPrototype.getOrInsertComputed,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMapPrototype, "size", ReflectGetOwnPropertyDescriptor(MapPrototype, "size"));
const safeMapValues = { value: undefined, writable: true, enumerable: false, configurable: true };
safeMapValues.value = function () {
  return new /* as: return new SafeIterator */ SafeMapValues(this);
};
ReflectDefineProperty(SafeMapPrototype, "values", safeMapValues);
const safeMapSymbolIterator = { value: undefined, writable: true, enumerable: false, configurable: true };
safeMapSymbolIterator.value = function () {
  return new /* as: return new SafeIterator */ SafeMapSymbolIterator(this);
};
ReflectDefineProperty(SafeMapPrototype, SymbolIterator, safeMapSymbolIterator);
ReflectDefineProperty(SafeMapPrototype, SymbolToStringTag, {
  value: MapPrototype[SymbolToStringTag],
  writable: false,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMap, "groupBy", {
  value: Map.groupBy,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeMap, SymbolSpecies, ReflectGetOwnPropertyDescriptor(Map, SymbolSpecies));
defineOwnPropertiesLeftOut(SafeMapPrototype, MapPrototype, makersOfSafeIteratorsOfMap);
defineOwnPropertiesLeftOut(SafeMap, Map, undefined);
sealClass(SafeMap);

const SetPrototype = Set.prototype;
const SetPrototypeEntries = SetPrototype.entries;
const SetPrototypeValues = SetPrototype.values;
const SetIteratorPrototypeNext = SetPrototypeEntries.$call(new Set()).next;

const SafeSetEntries = createSafeIterator(SetPrototypeEntries, SetIteratorPrototypeNext);
const SafeSetKeys = createSafeIterator(SetPrototypeValues, SetIteratorPrototypeNext);
const SafeSetValues = createSafeIterator(SetPrototypeValues, SetIteratorPrototypeNext);
const SafeSetSymbolIterator = createSafeIterator(SetPrototypeValues, SetIteratorPrototypeNext);

class SafeSet extends Set {
  constructor(i) {
    super(i);
  }
}
const SafeSetPrototype = SafeSet.prototype;
const makersOfSafeIteratorsOfSet = /* as: SafeSet: makeSafe */ makeSafe(
  SetPrototype,
  SafeSetPrototype,
  new Set(),
  SetIteratorPrototypeNext,
);
ReflectDefineProperty(SafeSetPrototype, "add", {
  value: SetPrototype.add,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "clear", {
  value: SetPrototype.clear,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "delete", {
  value: SetPrototype.delete,
  writable: true,
  enumerable: false,
  configurable: true,
});
const safeSetEntries = { value: undefined, writable: true, enumerable: false, configurable: true };
safeSetEntries.value = function () {
  return new /* as: return new SafeIterator */ SafeSetEntries(this);
};
ReflectDefineProperty(SafeSetPrototype, "entries", safeSetEntries);
ReflectDefineProperty(SafeSetPrototype, "forEach", {
  value: SetPrototype.forEach,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "has", {
  value: SetPrototype.has,
  writable: true,
  enumerable: false,
  configurable: true,
});
const safeSetKeys = { value: undefined, writable: true, enumerable: false, configurable: true };
safeSetKeys.value = function () {
  return new /* as: return new SafeIterator */ SafeSetKeys(this);
};
ReflectDefineProperty(SafeSetPrototype, "keys", safeSetKeys);
ReflectDefineProperty(SafeSetPrototype, "size", ReflectGetOwnPropertyDescriptor(SetPrototype, "size"));
const safeSetValues = { value: undefined, writable: true, enumerable: false, configurable: true };
safeSetValues.value = function () {
  return new /* as: return new SafeIterator */ SafeSetValues(this);
};
ReflectDefineProperty(SafeSetPrototype, "values", safeSetValues);
ReflectDefineProperty(SafeSetPrototype, "union", {
  value: SetPrototype.union,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "intersection", {
  value: SetPrototype.intersection,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "difference", {
  value: SetPrototype.difference,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "symmetricDifference", {
  value: SetPrototype.symmetricDifference,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "isSubsetOf", {
  value: SetPrototype.isSubsetOf,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "isSupersetOf", {
  value: SetPrototype.isSupersetOf,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSetPrototype, "isDisjointFrom", {
  value: SetPrototype.isDisjointFrom,
  writable: true,
  enumerable: false,
  configurable: true,
});
const safeSetSymbolIterator = { value: undefined, writable: true, enumerable: false, configurable: true };
safeSetSymbolIterator.value = function () {
  return new /* as: return new SafeIterator */ SafeSetSymbolIterator(this);
};
ReflectDefineProperty(SafeSetPrototype, SymbolIterator, safeSetSymbolIterator);
ReflectDefineProperty(SafeSetPrototype, SymbolToStringTag, {
  value: SetPrototype[SymbolToStringTag],
  writable: false,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSet, SymbolSpecies, ReflectGetOwnPropertyDescriptor(Set, SymbolSpecies));
defineOwnPropertiesLeftOut(SafeSetPrototype, SetPrototype, makersOfSafeIteratorsOfSet);
defineOwnPropertiesLeftOut(SafeSet, Set, undefined);
sealClass(SafeSet);

const WeakMapPrototype = WeakMap.prototype;

class SafeWeakMap extends WeakMap {
  constructor(i) {
    super(i);
  }
}
const SafeWeakMapPrototype = SafeWeakMap.prototype;
ReflectDefineProperty(SafeWeakMapPrototype, "delete", {
  value: WeakMapPrototype.delete,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeWeakMapPrototype, "get", {
  value: WeakMapPrototype.get,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeWeakMapPrototype, "has", {
  value: WeakMapPrototype.has,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeWeakMapPrototype, "set", {
  value: WeakMapPrototype.set,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeWeakMapPrototype, "getOrInsert", {
  value: WeakMapPrototype.getOrInsert,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeWeakMapPrototype, "getOrInsertComputed", {
  value: WeakMapPrototype.getOrInsertComputed,
  writable: true,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeWeakMapPrototype, SymbolToStringTag, {
  value: WeakMapPrototype[SymbolToStringTag],
  writable: false,
  enumerable: false,
  configurable: true,
});
defineOwnPropertiesLeftOut(SafeWeakMapPrototype, WeakMapPrototype, undefined);
defineOwnPropertiesLeftOut(SafeWeakMap, WeakMap, undefined);
sealClass(SafeWeakMap);

const PromisePrototypeThen = $Promise.prototype.$then;
const PromiseResolve = Promise.$resolve.bind(Promise);
// Shared scheduler for SafePromiseAllReturnVoid/ReturnArrayLike: `returnVal` is null for the void variant (no result bookkeeping, resolves with nothing).
const safePromiseAllCollect = (promises, mapFn, returnVal) =>
  new Promise((resolve, reject) => {
    const { length } = promises;

    if (length === 0) resolve(returnVal ?? undefined);

    let pendingPromises = length;
    for (let i = 0; i < length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen.$call(
        PromiseResolve(promise),
        result => {
          if (returnVal !== null) returnVal[i] = result;
          if (--pendingPromises === 0) resolve(returnVal ?? undefined);
        },
        reject,
      );
    }
  });
const SafePromiseAllReturnVoid = (promises, mapFn) => safePromiseAllCollect(promises, mapFn, null);
const SafePromiseAllReturnArrayLike = (promises, mapFn) => {
  const returnVal = Array(promises.length);
  ObjectSetPrototypeOf(returnVal, null);
  return safePromiseAllCollect(promises, mapFn, returnVal);
};

export default {
  SafeArrayIterator,
  // TODO: __lookupGetter__ is deprecated, but Object.getOwnPropertyDescriptor doesn't work on built-ins like Typed Arrays.
  MapPrototypeGetSize: FunctionPrototypeCall.bind(MapPrototype.__lookupGetter__("size")),
  SafeStringIterator,
  SafeMap,
  SafePromiseAllReturnArrayLike,
  SafePromiseAllReturnVoid,
  SafeSet,
  SafeWeakMap,
  SetPrototypeGetSize: FunctionPrototypeCall.bind(SetPrototype.__lookupGetter__("size")),
  TypedArrayPrototypeGetBuffer: FunctionPrototypeCall.bind(Uint8Array.prototype.__lookupGetter__("buffer")),
  TypedArrayPrototypeGetByteLength: FunctionPrototypeCall.bind(Uint8Array.prototype.__lookupGetter__("byteLength")),
  TypedArrayPrototypeGetByteOffset: FunctionPrototypeCall.bind(Uint8Array.prototype.__lookupGetter__("byteOffset")),
  TypedArrayPrototypeGetLength: FunctionPrototypeCall.bind(Uint8Array.prototype.__lookupGetter__("length")),
  TypedArrayPrototypeGetSymbolToStringTag: FunctionPrototypeCall.bind(
    Uint8Array.prototype.__lookupGetter__(SymbolToStringTag),
  ),
  uncurryThis,
};
