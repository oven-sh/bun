// The JavaScript side of the TC39 structs surface: `Atomics.Mutex`, `Atomics.Condition`, `SharedArray`,
// `Reflect.canBeShared` and the shared-struct overloads of `Atomics.load/store/exchange/compareExchange`.
//
// Nothing here runs until a program first touches one of those names: ZigGlobalObject.cpp defines them as lazy
// properties, and the first read loads this module and replaces every lazy property with the value exported below.
// The classes themselves come from `src/shared_struct_jsc` (bindgen) and `SharedStructObject.cpp`.

const ObjectDefineProperty = Object.defineProperty;

const { Mutex, Condition, SharedArray, SharedStruct } = $bindgen("shared_struct_classes.bind.ts", "classes")();
const nativeCanBeShared = $bindgen("shared_struct_classes.bind.ts", "canBeShared");
const nativeAtomicLoad = $bindgen("shared_struct_classes.bind.ts", "atomicLoad");
const nativeAtomicStore = $bindgen("shared_struct_classes.bind.ts", "atomicStore");
const nativeAtomicExchange = $bindgen("shared_struct_classes.bind.ts", "atomicExchange");
const nativeAtomicCompareExchange = $bindgen("shared_struct_classes.bind.ts", "atomicCompareExchange");

// Captured before any script can replace them. The typed-array behaviour of `Atomics` stays the engine's own.
const originalLoad = Atomics.load;
const originalStore = Atomics.store;
const originalExchange = Atomics.exchange;
const originalCompareExchange = Atomics.compareExchange;

const mutexLock = Mutex.prototype.lock;
const mutexTryLock = Mutex.prototype.tryLock;
const mutexUnlock = Mutex.prototype.unlock;
const conditionWait = Condition.prototype.wait;
const conditionNotify = Condition.prototype.notify;

/** Defines `value` as a builtin method or constructor property: writable, configurable, not enumerable. */
function define(target: object, key: PropertyKey, value: unknown) {
  ObjectDefineProperty(target, key, { value, writable: true, enumerable: false, configurable: true });
}

function assertMutex(mutex: unknown) {
  if (!(mutex instanceof Mutex)) throw new TypeError("Expected an Atomics.Mutex");
}

function assertCondition(condition: unknown) {
  if (!(condition instanceof Condition)) throw new TypeError("Expected an Atomics.Condition");
}

/** A timeout in milliseconds as the native calls take it: `undefined` waits for ever, as `NaN` and `Infinity` do. */
function timeoutArgument(timeoutMs: unknown): number | undefined {
  if (timeoutMs === undefined) return undefined;
  const ms = +(timeoutMs as number);
  return ms === ms && ms !== Infinity ? (ms < 0 ? 0 : ms) : undefined;
}

let armToken: (token: UnlockToken, mutex: unknown) => void;
let heldMutex: (token: unknown) => unknown;

/**
 * Proof that a mutex is held. `unlock()` and `[Symbol.dispose]()` release it once and then do nothing, so the token can
 * be handed on, disposed with `using`, or unlocked early. A new token is empty; `lock` fills one and a released token
 * can be filled again.
 */
class UnlockToken {
  #mutex: unknown = null;

  static {
    armToken = (token, mutex) => {
      token.#mutex = mutex;
    };
    heldMutex = token => {
      if (!(token instanceof UnlockToken)) throw new TypeError("Expected an Atomics.Mutex.UnlockToken");
      return token.#mutex;
    };
  }

  get locked() {
    return this.#mutex !== null;
  }

  /** Releases the mutex if the token holds one. Answers whether it did. */
  unlock() {
    const mutex = this.#mutex;
    if (mutex === null) return false;
    this.#mutex = null;
    mutexUnlock.$call(mutex);
    return true;
  }

  [Symbol.dispose]() {
    this.unlock();
  }
}

/** The token a lock fills: the empty one the caller passed, or a new one. */
function tokenToFill(token: unknown): UnlockToken {
  if (token === undefined) return new UnlockToken();
  if (heldMutex(token) !== null) throw new TypeError("The Atomics.Mutex.UnlockToken is already locked");
  return token as UnlockToken;
}

/** The mutex a non-empty token holds. */
function lockedMutex(token: unknown) {
  const mutex = heldMutex(token);
  if (mutex === null) throw new TypeError("The Atomics.Mutex.UnlockToken is not locked");
  return mutex;
}

const mutexStatics = {
  /** Blocks until `mutex` is held and returns the token that releases it: `token` if one is given, else a new one. */
  lock(mutex: unknown, unlockToken?: UnlockToken) {
    assertMutex(mutex);
    const token = tokenToFill(unlockToken);
    if (!mutexLock.$call(mutex, undefined)) throw new Error("Atomics.Mutex.lock was interrupted");
    armToken(token, mutex);
    return token;
  },

  /** Like `lock`, but `null` when the mutex is not taken, after `timeoutMs` if one is given and at once otherwise. */
  lockIfAvailable(mutex: unknown, timeoutMs?: number, unlockToken?: UnlockToken) {
    assertMutex(mutex);
    const token = tokenToFill(unlockToken);
    const timeout = timeoutMs === undefined ? 0 : timeoutArgument(timeoutMs);
    // A zero timeout never waits, so it must not trip over a mutex this thread already holds.
    const held = timeout === 0 ? mutexTryLock.$call(mutex) : mutexLock.$call(mutex, timeout);
    if (!held) return null;
    armToken(token, mutex);
    return token;
  },
};

define(Mutex, "lock", mutexStatics.lock);
define(Mutex, "lockIfAvailable", mutexStatics.lockIfAvailable);
define(Mutex, "UnlockToken", UnlockToken);

const conditionStatics = {
  /** Releases the mutex that `unlockToken` holds until notified, then takes it again. */
  wait(condition: unknown, unlockToken: UnlockToken) {
    assertCondition(condition);
    conditionWait.$call(condition, lockedMutex(unlockToken), undefined);
  },

  /**
   * Waits at most `timeoutMs`. With a `predicate`, keeps waiting until it returns true, checking it with the mutex held,
   * and answers whether it did; without one it answers whether it was notified before the timeout.
   */
  waitFor(condition: unknown, unlockToken: UnlockToken, timeoutMs: number, predicate?: () => unknown) {
    assertCondition(condition);
    const mutex = lockedMutex(unlockToken);
    const timeout = timeoutArgument(timeoutMs);
    if (predicate === undefined) return conditionWait.$call(condition, mutex, timeout);
    if (!$isCallable(predicate)) throw new TypeError("Atomics.Condition.waitFor: predicate must be a function");

    const deadline = timeout === undefined ? Infinity : performance.now() + timeout;
    while (!predicate()) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return false;
      if (!conditionWait.$call(condition, mutex, deadline === Infinity ? undefined : remaining)) {
        return !!predicate();
      }
    }
    return true;
  },

  /** Wakes up to `count` waiters (all of them by default) and returns how many were woken. */
  notify(condition: unknown, count?: number) {
    assertCondition(condition);
    return conditionNotify.$call(condition, count);
  },
};

define(Condition, "wait", conditionStatics.wait);
define(Condition, "waitFor", conditionStatics.waitFor);
define(Condition, "notify", conditionStatics.notify);

// Shared structs and arrays are not typed arrays, so the engine's own functions would throw for them. Everything else,
// including every error, stays the original's.
const atomicsOverloads = {
  load(target: unknown, index: unknown) {
    if ($isTypedArrayView(target)) return originalLoad.$call(this, target, index);
    return nativeAtomicLoad(target, index);
  },
  store(target: unknown, index: unknown, value: unknown) {
    if ($isTypedArrayView(target)) return originalStore.$call(this, target, index, value);
    return nativeAtomicStore(target, index, value);
  },
  exchange(target: unknown, index: unknown, value: unknown) {
    if ($isTypedArrayView(target)) return originalExchange.$call(this, target, index, value);
    return nativeAtomicExchange(target, index, value);
  },
  compareExchange(target: unknown, index: unknown, expected: unknown, replacement: unknown) {
    if ($isTypedArrayView(target)) return originalCompareExchange.$call(this, target, index, expected, replacement);
    return nativeAtomicCompareExchange(target, index, expected, replacement);
  },
};

const reflectStatics = {
  canBeShared(value: unknown) {
    return nativeCanBeShared(value);
  },
};

export default {
  Mutex,
  Condition,
  SharedArray,
  canBeShared: reflectStatics.canBeShared,
  load: atomicsOverloads.load,
  store: atomicsOverloads.store,
  exchange: atomicsOverloads.exchange,
  compareExchange: atomicsOverloads.compareExchange,
};

// The `shared struct` lowering in runtime.js builds its instances through this hook.
Object.defineProperty(globalThis, Symbol.for("bun.structs.native"), {
  value: { create: (fields: string[]) => new SharedStruct(fields) },
  configurable: true,
});
