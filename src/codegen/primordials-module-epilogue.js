// ─── helpers layered on the generated object (mirrors Node's primordials.js) ───

primordials.uncurryThis = uncurryThis;
primordials.applyBind = applyBind;

const {
  Array: ArrayConstructor,
  ArrayPrototypeForEach,
  ArrayPrototypeMap,
  ArrayPrototypePushApply,
  ArrayPrototypeSlice,
  ArrayIteratorPrototypeNext,
  ArrayPrototypeSymbolIterator,
  FinalizationRegistry,
  FunctionPrototypeCall,
  Map,
  MapIteratorPrototypeNext,
  ObjectCreate,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectGetPrototypeOf,
  ObjectSetPrototypeOf,
  Promise,
  PromisePrototypeThen,
  PromiseResolve,
  ReflectApply,
  ReflectConstruct,
  ReflectDefineProperty,
  ReflectGet,
  ReflectGetOwnPropertyDescriptor,
  ReflectOwnKeys,
  ReflectSet,
  RegExp,
  RegExpPrototypeExec,
  RegExpPrototypeGetDotAll,
  RegExpPrototypeGetFlags,
  RegExpPrototypeGetGlobal,
  RegExpPrototypeGetHasIndices,
  RegExpPrototypeGetIgnoreCase,
  RegExpPrototypeGetMultiline,
  RegExpPrototypeGetSource,
  RegExpPrototypeGetSticky,
  RegExpPrototypeGetUnicode,
  Set,
  SetIteratorPrototypeNext,
  StringIteratorPrototypeNext,
  StringPrototypeSymbolIterator,
  SymbolIterator,
  SymbolMatch,
  SymbolMatchAll,
  SymbolReplace,
  SymbolSearch,
  SymbolSpecies,
  SymbolSplit,
  WeakMap,
  WeakRef,
  WeakSet,
} = primordials;

// An iterator user code can't intercept: its next() and Symbol.iterator are
// captured functions and its prototype is detached and frozen.
const createSafeIterator = (factory, next) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory(iterable);
    }
    next() {
      return next(this._iterator);
    }
    [SymbolIterator]() {
      return this;
    }
  }
  ObjectSetPrototypeOf(SafeIterator.prototype, null);
  ObjectFreeze(SafeIterator.prototype);
  ObjectFreeze(SafeIterator);
  return SafeIterator;
};

const SafeArrayIterator = createSafeIterator(ArrayPrototypeSymbolIterator, ArrayIteratorPrototypeNext);
primordials.SafeArrayIterator = SafeArrayIterator;
primordials.SafeStringIterator = createSafeIterator(StringPrototypeSymbolIterator, StringIteratorPrototypeNext);

const copyOwnProperties = (source, target) => {
  ArrayPrototypeForEach(ReflectOwnKeys(source), key => {
    if (!ReflectGetOwnPropertyDescriptor(target, key))
      ReflectDefineProperty(target, key, { __proto__: null, ...ReflectGetOwnPropertyDescriptor(source, key) });
  });
};

const detachAndFreeze = safe => {
  ObjectSetPrototypeOf(safe.prototype, null);
  ObjectFreeze(safe.prototype);
  ObjectFreeze(safe);
  return safe;
};

const defineFromDescriptors = (descriptors, target, mapDescriptor) => {
  ArrayPrototypeForEach(ReflectOwnKeys(descriptors), key => {
    if (!ReflectGetOwnPropertyDescriptor(target, key))
      ReflectDefineProperty(target, key, mapDescriptor({ __proto__: null, ...descriptors[key] }, key));
  });
};

// This module loads lazily, possibly after user code, so our own Safe* classes are
// built from the pristine descriptor records the generator emits rather than by
// reading the live prototypes. `iterator` = { prototype, next } (pristine): zero-arg
// methods that hand out that iterator kind are rewrapped to return safe iterators.
const makeSafeFromPristine = (unsafe, safe, prototypeDescriptors, staticDescriptors, iterator) => {
  const instance = iterator ? new unsafe() : null;
  defineFromDescriptors(prototypeDescriptors, safe.prototype, descriptor => {
    const method = descriptor.value;
    if (iterator && typeof method === "function" && method.length === 0) {
      const result = FunctionPrototypeCall(method, instance);
      if (result != null && typeof result === "object" && ObjectGetPrototypeOf(result) === iterator.prototype) {
        const SafeIterator = createSafeIterator(uncurryThis(method), iterator.next);
        descriptor.value = function () {
          return new SafeIterator(this);
        };
      }
    }
    return descriptor;
  });
  defineFromDescriptors(staticDescriptors, safe, descriptor => descriptor);
  return detachAndFreeze(safe);
};

// The exported makeSafe copies from a consumer's own classes at their call time
// (as in Node); zero-arg iterator-returning methods are rewrapped so the copies
// hand out safe iterators over a captured pristine `next`.
const makeSafe = (unsafe, safe) => {
  if (SymbolIterator in unsafe.prototype) {
    const dummy = new unsafe();
    let next; // We can reuse the same `next` method.
    ArrayPrototypeForEach(ReflectOwnKeys(unsafe.prototype), key => {
      if (ReflectGetOwnPropertyDescriptor(safe.prototype, key)) return;
      const descriptor = ReflectGetOwnPropertyDescriptor(unsafe.prototype, key);
      if (
        typeof descriptor.value === "function" &&
        descriptor.value.length === 0 &&
        SymbolIterator in (FunctionPrototypeCall(descriptor.value, dummy) ?? {})
      ) {
        const createIterator = uncurryThis(descriptor.value);
        next ??= uncurryThis(createIterator(dummy).next);
        const SafeIterator = createSafeIterator(createIterator, next);
        descriptor.value = function () {
          return new SafeIterator(this);
        };
      }
      ReflectDefineProperty(safe.prototype, key, { __proto__: null, ...descriptor });
    });
  } else {
    copyOwnProperties(unsafe.prototype, safe.prototype);
  }
  copyOwnProperties(unsafe, safe);
  return detachAndFreeze(safe);
};
primordials.makeSafe = makeSafe;

const mapIteration = { prototype: primordials.MapIteratorPrototype, next: MapIteratorPrototypeNext };
const setIteration = { prototype: primordials.SetIteratorPrototype, next: SetIteratorPrototypeNext };
primordials.SafeMap = makeSafeFromPristine(
  Map,
  class SafeMap extends Map {},
  pristineDescriptors.MapPrototype,
  pristineDescriptors.MapConstructor,
  mapIteration,
);
primordials.SafeWeakMap = makeSafeFromPristine(
  WeakMap,
  class SafeWeakMap extends WeakMap {},
  pristineDescriptors.WeakMapPrototype,
  pristineDescriptors.WeakMapConstructor,
);
primordials.SafeSet = makeSafeFromPristine(
  Set,
  class SafeSet extends Set {},
  pristineDescriptors.SetPrototype,
  pristineDescriptors.SetConstructor,
  setIteration,
);
primordials.SafeWeakSet = makeSafeFromPristine(
  WeakSet,
  class SafeWeakSet extends WeakSet {},
  pristineDescriptors.WeakSetPrototype,
  pristineDescriptors.WeakSetConstructor,
);
primordials.SafeFinalizationRegistry = makeSafeFromPristine(
  FinalizationRegistry,
  class SafeFinalizationRegistry extends FinalizationRegistry {},
  pristineDescriptors.FinalizationRegistryPrototype,
  pristineDescriptors.FinalizationRegistryConstructor,
);
primordials.SafeWeakRef = makeSafeFromPristine(
  WeakRef,
  class SafeWeakRef extends WeakRef {},
  pristineDescriptors.WeakRefPrototype,
  pristineDescriptors.WeakRefConstructor,
);

const SafePromise = makeSafeFromPristine(
  Promise,
  class SafePromise extends Promise {},
  pristineDescriptors.PromisePrototype,
  pristineDescriptors.PromiseConstructor,
);

// The Safe* promise combinators wrap results in a plain Promise so the SafePromise
// prototype never reaches user code, and wrap each input so a tampered .then on
// a user promise cannot observe the combinator.
const SafePromisePrototypeFinallyOfSafe = uncurryThis(SafePromise.prototype.finally);
const SafePromisePrototypeThenOfSafe = uncurryThis(SafePromise.prototype.then);
primordials.SafePromisePrototypeFinally = (thisPromise, onFinally) =>
  new Promise((resolve, reject) => {
    const wrapped = new SafePromise((resolveInner, rejectInner) =>
      PromisePrototypeThen(thisPromise, resolveInner, rejectInner),
    );
    SafePromisePrototypeThenOfSafe(SafePromisePrototypeFinallyOfSafe(wrapped, onFinally), resolve, reject);
  });

const arrayToSafePromiseIterable = (promises, mapFn) =>
  new SafeArrayIterator(
    ArrayPrototypeMap(
      promises,
      (promise, i) =>
        new SafePromise((resolve, reject) =>
          PromisePrototypeThen(mapFn == null ? promise : mapFn(promise, i), resolve, reject),
        ),
    ),
  );

const safePromiseCombinator = combinator => (promises, mapFn) =>
  new Promise((resolve, reject) =>
    SafePromisePrototypeThenOfSafe(
      FunctionPrototypeCall(combinator, SafePromise, arrayToSafePromiseIterable(promises, mapFn)),
      resolve,
      reject,
    ),
  );

primordials.SafePromiseAll = safePromiseCombinator(SafePromise.all);
primordials.SafePromiseAllSettled = safePromiseCombinator(SafePromise.allSettled);
primordials.SafePromiseAny = safePromiseCombinator(SafePromise.any);
primordials.SafePromiseRace = safePromiseCombinator(SafePromise.race);

// The *ReturnArrayLike/*ReturnVoid variants avoid Promise.all entirely: no
// prototype lookups, and the array-like result has no Array.prototype.
primordials.SafePromiseAllReturnArrayLike = (promises, mapFn) =>
  new Promise((resolve, reject) => {
    const { length } = promises;
    const results = ArrayConstructor(length);
    ObjectSetPrototypeOf(results, null);
    if (length === 0) resolve(results);
    let pending = length;
    for (let i = 0; i < length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(
        PromiseResolve(promise),
        result => {
          results[i] = result;
          if (--pending === 0) resolve(results);
        },
        reject,
      );
    }
  });

primordials.SafePromiseAllReturnVoid = (promises, mapFn) =>
  new Promise((resolve, reject) => {
    let pending = promises.length;
    if (pending === 0) resolve();
    const onFulfilled = () => {
      if (--pending === 0) resolve();
    };
    for (let i = 0; i < promises.length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(PromiseResolve(promise), onFulfilled, reject);
    }
  });

primordials.SafePromiseAllSettledReturnVoid = (promises, mapFn) =>
  new Promise(resolve => {
    let pending = promises.length;
    if (pending === 0) resolve();
    const onSettled = () => {
      if (--pending === 0) resolve();
    };
    for (let i = 0; i < promises.length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(PromiseResolve(promise), onSettled, onSettled);
    }
  });

// The raw (this-taking) originals: hardenRegExp installs them on the pattern
// itself. They come from the pristine constants, not the live RegExp.prototype,
// because this module can load after user code has replaced those properties.
const OriginalRegExpPrototypeExec = $RegExpPrototypeExec;
const OriginalRegExpPrototypeSymbolMatch = $RegExpPrototypeSymbolMatch;
const OriginalRegExpPrototypeSymbolMatchAll = $RegExpPrototypeSymbolMatchAll;
const OriginalRegExpPrototypeSymbolReplace = $RegExpPrototypeSymbolReplace;
const OriginalRegExpPrototypeSymbolSearch = $RegExpPrototypeSymbolSearch;
const OriginalRegExpPrototypeSymbolSplit = $RegExpPrototypeSymbolSplit;

// The species String.prototype.split uses on a hardened pattern: only lastIndex
// and exec are ever consulted, and the inner pattern is a real, private RegExp.
class RegExpLikeForStringSplitting {
  #regex;
  constructor() {
    this.#regex = ReflectConstruct(RegExp, arguments);
  }
  get lastIndex() {
    return ReflectGet(this.#regex, "lastIndex");
  }
  set lastIndex(value) {
    ReflectSet(this.#regex, "lastIndex", value);
  }
  exec() {
    return ReflectApply(OriginalRegExpPrototypeExec, this.#regex, arguments);
  }
}
ObjectSetPrototypeOf(RegExpLikeForStringSplitting.prototype, null);

// Freezes a pattern's observable protocol (Symbol.match/replace/..., exec, flags,
// species) to the original algorithms so String methods can use it after user code ran.
primordials.hardenRegExp = function hardenRegExp(pattern) {
  ObjectDefineProperties(pattern, {
    [SymbolMatch]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolMatch },
    [SymbolMatchAll]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolMatchAll },
    [SymbolReplace]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolReplace },
    [SymbolSearch]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolSearch },
    [SymbolSplit]: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeSymbolSplit },
    constructor: { __proto__: null, configurable: true, value: { [SymbolSpecies]: RegExpLikeForStringSplitting } },
    dotAll: { __proto__: null, configurable: true, value: RegExpPrototypeGetDotAll(pattern) },
    exec: { __proto__: null, configurable: true, value: OriginalRegExpPrototypeExec },
    global: { __proto__: null, configurable: true, value: RegExpPrototypeGetGlobal(pattern) },
    hasIndices: { __proto__: null, configurable: true, value: RegExpPrototypeGetHasIndices(pattern) },
    ignoreCase: { __proto__: null, configurable: true, value: RegExpPrototypeGetIgnoreCase(pattern) },
    multiline: { __proto__: null, configurable: true, value: RegExpPrototypeGetMultiline(pattern) },
    source: { __proto__: null, configurable: true, value: RegExpPrototypeGetSource(pattern) },
    sticky: { __proto__: null, configurable: true, value: RegExpPrototypeGetSticky(pattern) },
    unicode: { __proto__: null, configurable: true, value: RegExpPrototypeGetUnicode(pattern) },
  });
  ObjectDefineProperty(pattern, "flags", {
    __proto__: null,
    configurable: true,
    value: RegExpPrototypeGetFlags(pattern),
  });
  return pattern;
};

primordials.SafeStringPrototypeSearch = (str, regexp) => {
  regexp.lastIndex = 0;
  const match = RegExpPrototypeExec(regexp, str);
  return match ? match.index : -1;
};

// Chunked push.apply so arbitrarily large arrays don't exhaust the stack.
primordials.SafeArrayPrototypePushApply = (array, items) => {
  let end = 0x10000;
  if (end < items.length) {
    let start = 0;
    do {
      ArrayPrototypePushApply(array, ArrayPrototypeSlice(items, start, (start = end)));
      end += 0x10000;
    } while (end < items.length);
    items = ArrayPrototypeSlice(items, start);
  }
  return ArrayPrototypePushApply(array, items);
};

ObjectSetPrototypeOf(primordials, null);
ObjectFreeze(primordials);
