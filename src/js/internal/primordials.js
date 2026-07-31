// TODO: Use native code and JSC intrinsics for everything in this file.
// Do not use this file for new code, many things here will be slow especailly when intrinsics for these operations is available.
// It is primarily used for `internal/util`

const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectFreeze = Object.freeze;

const createSafeIterator = (factory, next_) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory(iterable);
    }
    next() {
      return next_(this._iterator);
    }
    [Symbol.iterator]() {
      return this;
    }
  }
  ObjectSetPrototypeOf(SafeIterator.prototype, null);
  ObjectFreeze(SafeIterator.prototype);
  ObjectFreeze(SafeIterator);
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

const ArrayPrototypeForEach = uncurryThis(Array.prototype.forEach);
const ArrayPrototypeMap = uncurryThis(Array.prototype.map);
const ArrayPrototypeSymbolIterator = uncurryThis(Array.prototype[Symbol.iterator]);
const ArrayIteratorPrototypeNext = uncurryThis(Array.prototype[Symbol.iterator]().next);
const StringPrototypeSymbolIterator = uncurryThis(String.prototype[Symbol.iterator]);
const StringIteratorPrototypeNext = uncurryThis(
  Reflect.getPrototypeOf(String.prototype[Symbol.iterator].$call("")).next,
);
const PromiseAll = Promise.all;
const PromiseResolve = Promise.$resolve.bind(Promise);

const copyProps = (src, dest) => {
  ArrayPrototypeForEach(Reflect.ownKeys(src), key => {
    if (!Reflect.getOwnPropertyDescriptor(dest, key)) {
      Reflect.defineProperty(dest, key, Reflect.getOwnPropertyDescriptor(src, key));
    }
  });
};

const makeSafe = (unsafe, safe) => {
  const unsafePrototype = unsafe.prototype;
  const safePrototype = safe.prototype;
  if (Symbol.iterator in unsafePrototype) {
    const dummy = new unsafe();
    let next; // We can reuse the same `next` method.

    ArrayPrototypeForEach(Reflect.ownKeys(unsafePrototype), key => {
      if (!Reflect.getOwnPropertyDescriptor(safePrototype, key)) {
        const desc = Reflect.getOwnPropertyDescriptor(unsafePrototype, key);
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
        Reflect.defineProperty(safePrototype, key, desc);
      }
    });
  } else copyProps(unsafePrototype, safePrototype);
  copyProps(unsafe, safe);

  Object.setPrototypeOf(safePrototype, null);
  Object.freeze(safePrototype);
  Object.freeze(safe);
  return safe;
};

let SafeArrayIterator;
function getSafeArrayIterator() {
  return (SafeArrayIterator ??= createSafeIterator(ArrayPrototypeSymbolIterator, ArrayIteratorPrototypeNext));
}

const PromisePrototypeThen = $Promise.prototype.$then;

const arrayToSafePromiseIterable = (promises, mapFn) => {
  const SafeArrayIterator = getSafeArrayIterator();
  return new SafeArrayIterator(
    ArrayPrototypeMap(
      promises,
      (promise, i) =>
        new Promise((a, b) => PromisePrototypeThen.$call(mapFn == null ? promise : mapFn(promise, i), a, b)),
    ),
  );
};
const SafePromiseAll = (promises, mapFn) => PromiseAll(arrayToSafePromiseIterable(promises, mapFn));
// Shared scheduler for SafePromiseAllReturnVoid/ReturnArrayLike: `returnVal`
// is null for the void variant (no result bookkeeping, resolves with nothing).
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

const primordials = {
  Array,
  Number,
  Object,
  RegExp,
  SafePromiseAll,
  SafePromiseAllReturnArrayLike,
  SafePromiseAllReturnVoid,
  String,
  Uint8ClampedArray,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float16Array,
  Float32Array,
  Float64Array,
  BigUint64Array,
  BigInt64Array,
  uncurryThis,
};

function defineLazy(name, initialize) {
  Object.defineProperty(primordials, name, {
    get() {
      const value = initialize();
      Reflect.defineProperty(primordials, name, { value, writable: true, enumerable: true, configurable: true });
      return value;
    },
    enumerable: true,
    configurable: true,
  });
}

defineLazy("SafeArrayIterator", getSafeArrayIterator);
defineLazy("MapPrototypeGetSize", () => getGetter(Map, "size"));
defineLazy("SetPrototypeGetSize", () => getGetter(Set, "size"));
defineLazy("TypedArrayPrototypeGetLength", () => getGetter(Uint8Array, "length"));
defineLazy("TypedArrayPrototypeGetSymbolToStringTag", () => getGetter(Uint8Array, Symbol.toStringTag));
defineLazy("SafeStringIterator", () => createSafeIterator(StringPrototypeSymbolIterator, StringIteratorPrototypeNext));
defineLazy("SafeMap", () =>
  makeSafe(
    Map,
    class SafeMap extends Map {
      constructor(i) {
        super(i);
      }
    },
  ),
);
defineLazy("SafeSet", () =>
  makeSafe(
    Set,
    class SafeSet extends Set {
      constructor(i) {
        super(i);
      }
    },
  ),
);
defineLazy("SafeWeakSet", () =>
  makeSafe(
    WeakSet,
    class SafeWeakSet extends WeakSet {
      constructor(i) {
        super(i);
      }
    },
  ),
);
defineLazy("SafeWeakMap", () =>
  makeSafe(
    WeakMap,
    class SafeWeakMap extends WeakMap {
      constructor(i) {
        super(i);
      }
    },
  ),
);

export default primordials;
