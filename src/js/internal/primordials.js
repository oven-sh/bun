// TODO: Use native code and JSC intrinsics for everything in this file.
// Do not use this file for new code, many things here will be slow especailly when intrinsics for these operations is available.
// It is primarily used for `internal/util`

const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectFreeze = Object.freeze;

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

const ArrayPrototypeSymbolIterator = uncurryThis(Array.prototype[Symbol.iterator]);
const ArrayIteratorPrototypeNext = uncurryThis(ArrayPrototypeSymbolIterator.next);

export default {
  Array,
  SafeArrayIterator: createSafeIterator(ArrayPrototypeSymbolIterator, ArrayIteratorPrototypeNext),
  MapPrototypeGetSize: getGetter(Map, "size"),
  Number,
  Object,
  RegExp,
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
  SafeWeakSet: makeSafe(
    WeakSet,
    class SafeWeakSet extends WeakSet {
      constructor(i) {
        super(i);
      }
    },
  ),
  SetPrototypeGetSize: getGetter(Set, "size"),
  String,
  TypedArrayPrototypeGetLength: getGetter(Uint8Array, "length"),
  TypedArrayPrototypeGetSymbolToStringTag: getGetter(Uint8Array, Symbol.toStringTag),
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
