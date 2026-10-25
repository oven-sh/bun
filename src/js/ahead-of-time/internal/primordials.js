// What the compiler reads in place of src/js/internal/primordials.js.

const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectFreeze = Object.freeze;
const ReflectDefineProperty = Reflect.defineProperty;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const SymbolIterator = Symbol.iterator;
const SymbolSpecies = Symbol.species;
const SymbolToStringTag = Symbol.toStringTag;

// Intrinsics do not have `call` as a valid identifier, so this cannot be `Function.prototype.call.bind`.
const FunctionPrototypeCall = $getByIdDirect(Function.prototype, "call");

function uncurryThis(func) {
  return FunctionPrototypeCall.bind(func);
}

const sealClass = constructor => {
  const prototype = constructor.prototype;
  ObjectSetPrototypeOf(prototype, null);
  ObjectFreeze(prototype);
  ObjectFreeze(constructor);
};

const createSafeIterator = (factory, next_) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory.$call(iterable);
    }
    next() {
      return next_.$call(this._iterator);
    }
    [SymbolIterator]() {
      return this;
    }
  }
  sealClass(SafeIterator);
  return SafeIterator;
};

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
  return new SafeMapEntries(this);
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
  return new SafeMapKeys(this);
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
  return new SafeMapValues(this);
};
ReflectDefineProperty(SafeMapPrototype, "values", safeMapValues);
const safeMapSymbolIterator = { value: undefined, writable: true, enumerable: false, configurable: true };
safeMapSymbolIterator.value = function () {
  return new SafeMapSymbolIterator(this);
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
  return new SafeSetEntries(this);
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
  return new SafeSetKeys(this);
};
ReflectDefineProperty(SafeSetPrototype, "keys", safeSetKeys);
ReflectDefineProperty(SafeSetPrototype, "size", ReflectGetOwnPropertyDescriptor(SetPrototype, "size"));
const safeSetValues = { value: undefined, writable: true, enumerable: false, configurable: true };
safeSetValues.value = function () {
  return new SafeSetValues(this);
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
  return new SafeSetSymbolIterator(this);
};
ReflectDefineProperty(SafeSetPrototype, SymbolIterator, safeSetSymbolIterator);
ReflectDefineProperty(SafeSetPrototype, SymbolToStringTag, {
  value: SetPrototype[SymbolToStringTag],
  writable: false,
  enumerable: false,
  configurable: true,
});
ReflectDefineProperty(SafeSet, SymbolSpecies, ReflectGetOwnPropertyDescriptor(Set, SymbolSpecies));
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
