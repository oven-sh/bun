// One instance for each realm: what makes values of that realm.
const types = require("node:util/types");
const copyPlainData = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmCopyPlainData", 1);
const clone = structuredClone;
const objectPrototype = Object.prototype;

function define(target: object, members: object) {
  for (const name of Object.keys(members)) {
    const enumerable = !/^[A-Z]/.test(name) && name !== "console";
    Object.defineProperty(target, name, { value: members[name], writable: true, configurable: true, enumerable });
  }
}

function named<T extends Function>(name: string, fn: T): T {
  return Object.defineProperty(fn, "name", { value: name, configurable: true });
}

const isError = (value: unknown): boolean => types.isNativeError(value);

function isCloned(value: object) {
  return (
    types.isAnyArrayBuffer(value) ||
    types.isArrayBufferView(value) ||
    types.isDate(value) ||
    types.isRegExp(value) ||
    types.isMap(value) ||
    types.isSet(value) ||
    types.isBoxedPrimitive(value)
  );
}

type Link = {
  /** The bridge of the realm that the values come from. */
  other: any;
  isShared(value: object): boolean;
  /** For the other direction. */
  back: Link | null;
};

/** For each function that another bridge has made, the one of this realm that it calls. */
const originals = new WeakMap<object, Function>();

/** The rules of Electron's `contextBridge`. */
function copy(value: any, link: Link): any {
  if (!$isObject(value)) return value;
  return copyPlainData(value) ?? copyDeeply(value, link, new Map(), 0);
}

function copyDeeply(value: any, link: Link, seen: Map<object, unknown>, depth: number, receiver?: object): any {
  if (!$isObject(value)) return value;
  if (depth >= 1000)
    throw new TypeError(
      "Electron contextBridge recursion depth exceeded.  Nested objects deeper than 1000 are not supported.",
    );
  if (seen.$has(value)) return seen.$get(value);
  if (typeof value === "function") {
    const known = originals.get(value);
    if (known !== undefined) return known;
    const back = (link.back ??= { other: api, isShared: link.isShared, back: link });
    const proxy = function (...args: unknown[]) {
      let result;
      try {
        result = (value as any).$apply(receiver, link.other.copy(args, back));
      } catch (error) {
        throw copy(error, link);
      }
      return copy(result, link);
    };
    link.other.originals.set(proxy, value);
    seen.$set(value, proxy);
    return proxy;
  }
  if ($isPromise(value)) {
    return new Promise((resolve, reject) =>
      value.$then(
        result => {
          try {
            resolve(copy(result, link));
          } catch (error) {
            reject(error);
          }
        },
        error => reject(copy(error, link)),
      ),
    );
  }
  if (isError(value)) return new Error(String(value.message));
  if ($isArray(value)) {
    const result: unknown[] = [];
    seen.$set(value, result);
    for (let i = 0; i < value.length; i++) result.push(copyDeeply(value[i], link, seen, depth + 1));
    return result;
  }
  if (isCloned(value)) return clone(value);
  if (link.isShared(value)) return value;
  const result = {};
  seen.$set(value, result);
  for (const key of Object.keys(value)) {
    $putByValDirect(result, key, copyDeeply(value[key], link, seen, depth + 1, value));
  }
  return result;
}

function deepFreeze(value: any) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value) || types.isArrayBufferView(value))
    return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

function expose(name: string, value: unknown, link: Link) {
  if (Object.hasOwn(globalThis, name)) {
    throw new Error("Cannot bind an API on top of an existing property on the window object");
  }
  Object.defineProperty(globalThis, name, { value: deepFreeze(copy(value, link)), enumerable: true });
}

/** For a promise of another realm. What it is fulfilled with is converted, and it is rejected with an error of this realm. */
function adopt<T, U>(
  promise: Promise<T>,
  convert: (value: T) => U,
  fail: (error: any) => unknown = ownError,
): Promise<U> {
  return new Promise((resolve, reject) =>
    promise.then(
      value => {
        try {
          resolve(convert(value));
        } catch (error) {
          reject(error);
        }
      },
      error => reject(fail(error)),
    ),
  );
}

function ownError(error: any) {
  const { name, message } = error;
  if (name === "Error") return new Error(message);
  if (name === "RangeError") return new RangeError(message);
  return name === "TypeError" ? new TypeError(message) : new DOMException(message, name);
}

/** `on<type>` attributes for a subclass of `EventTarget`. */
function defineHandlers(prototype: any, types: string[]) {
  const { addEventListener, removeEventListener } = prototype;
  for (const type of types) {
    const handlers = new WeakMap<object, any>();
    const listener = function (this: object, event: Event) {
      return handlers.get(this)?.$call(this, event);
    };
    Object.defineProperty(prototype, "on" + type, {
      get() {
        return handlers.get(this) ?? null;
      },
      set(handler) {
        if ($isCallable(handler)) {
          handlers.set(this, handler);
          addEventListener.$call(this, type, listener);
        } else {
          handlers.delete(this);
          removeEventListener.$call(this, type, listener);
        }
      },
      enumerable: true,
      configurable: true,
    });
  }
}

const api = { originals, define, named, isError, copy, expose, adopt, ownError, defineHandlers, objectPrototype };
export default api;
