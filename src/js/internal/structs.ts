// The JavaScript side of the TC39 structs surface: `Atomics.Mutex`, `Atomics.Condition`, `SharedArray`,
// `Reflect.canBeShared` and the shared-struct overloads of `Atomics.load/store/exchange/compareExchange`.
//
// Nothing here runs until a program first touches one of those names or a realm is handed a shared struct: ZigGlobalObject.cpp
// defines the names as lazy properties, and the first read (or the first shared struct a realm receives) loads this module and
// replaces every lazy property with the value exported below.
// The classes themselves come from `src/shared_struct_jsc` (bindgen) and `SharedStructObject.cpp`.

const ObjectDefineProperty = Object.defineProperty;

const { Mutex, Condition, SharedArray, SharedStruct, MutexClass, ConditionClass } = $bindgen(
  "shared_struct_classes.bind.ts",
  "classes",
)();
const nativeCanBeShared = $bindgen("shared_struct_classes.bind.ts", "canBeShared");
const nativeIsSharedObject = $bindgen("shared_struct_classes.bind.ts", "isSharedObject");
const nativeIsMutex = $bindgen("shared_struct_classes.bind.ts", "isMutex");
const nativeIsCondition = $bindgen("shared_struct_classes.bind.ts", "isCondition");
const nativeAtomicLoad = $bindgen("shared_struct_classes.bind.ts", "atomicLoad");
const nativeAtomicStore = $bindgen("shared_struct_classes.bind.ts", "atomicStore");
const nativeAtomicExchange = $bindgen("shared_struct_classes.bind.ts", "atomicExchange");
const nativeAtomicCompareExchange = $bindgen("shared_struct_classes.bind.ts", "atomicCompareExchange");

// Captured before any script can replace them. The typed-array behaviour of `Atomics` stays the engine's own.
const originalLoad = Atomics.load;
const originalStore = Atomics.store;
const originalExchange = Atomics.exchange;
const originalCompareExchange = Atomics.compareExchange;

// A Mutex or a Condition has no prototype; the operations live on the prototypes of the generated classes behind them.
const mutexLock = MutexClass.prototype.lock;
const mutexUnlock = MutexClass.prototype.unlock;
const conditionWait = ConditionClass.prototype.wait;
const conditionNotify = ConditionClass.prototype.notify;

/** Defines `value` as a builtin method or constructor property: writable, configurable, not enumerable. */
function define(target: object, key: PropertyKey, value: unknown) {
  ObjectDefineProperty(target, key, { value, writable: true, enumerable: false, configurable: true });
}

/** Sets the `length` of a builtin function, which counts the parameters before the first optional one. */
function lengthOf<T extends Function>(fn: T, length: number): T {
  ObjectDefineProperty(fn, "length", { value: length, writable: false, enumerable: false, configurable: true });
  return fn;
}

function assertMutex(mutex: unknown) {
  if (!nativeIsMutex(mutex)) throw new TypeError("Expected an Atomics.Mutex");
}

function assertCondition(condition: unknown) {
  if (!nativeIsCondition(condition)) throw new TypeError("Expected an Atomics.Condition");
}

/**
 * A timeout in milliseconds as the native calls take it. It has to be a Number. `NaN` and `+Infinity` wait for ever (`undefined`);
 * `-Infinity` and anything below zero do not wait at all.
 */
function timeoutMillis(timeout: unknown): number | undefined {
  if (typeof timeout !== "number") throw new TypeError("The timeout must be a Number");
  if (timeout !== timeout || timeout === Infinity) return undefined;
  return timeout < 0 ? 0 : timeout;
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

  constructor() {
    // The prototype of a token is always this one, whatever `new.target` says.
    if (new.target !== UnlockToken) return new UnlockToken();
  }

  static {
    armToken = (token, mutex) => {
      token.#mutex = mutex;
    };
    heldMutex = token => {
      if (!(#mutex in (token as object))) throw new TypeError("Expected an Atomics.Mutex.UnlockToken");
      return (token as UnlockToken).#mutex;
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
    const mutex = this.#mutex;
    if (mutex === null) return;
    this.#mutex = null;
    mutexUnlock.$call(mutex);
  }
}
// The prototype of the proposal's UnlockToken has `locked`, `unlock` and `[Symbol.dispose]` and nothing else.
Reflect.deleteProperty(UnlockToken.prototype, "constructor");

/** Checks that `token` is an empty UnlockToken, which a lock may fill. */
function assertEmptyToken(token: unknown) {
  if (heldMutex(token) !== null) throw new TypeError("The Atomics.Mutex.UnlockToken is already locked");
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
    if (unlockToken !== undefined) assertEmptyToken(unlockToken);
    const token = unlockToken ?? new UnlockToken();
    // A mutex this thread already holds is a deadlock, which the native lock refuses with a TypeError.
    if (!mutexLock.$call(mutex, undefined)) throw new Error("Atomics.Mutex.lock was interrupted");
    armToken(token, mutex);
    return token;
  },

  /** Like `lock`, but `null` when the mutex is not taken within `timeout` milliseconds. */
  lockIfAvailable(mutex: unknown, timeout: number, unlockToken?: UnlockToken) {
    assertMutex(mutex);
    if (unlockToken !== undefined) assertEmptyToken(unlockToken);
    const timeoutMs = timeoutMillis(timeout);
    const token = unlockToken ?? new UnlockToken();
    // Even with no wait at all, a mutex this thread already holds is a TypeError, not a null.
    if (!mutexLock.$call(mutex, timeoutMs)) return null;
    armToken(token, mutex);
    return token;
  },
};

define(Mutex, "lock", lengthOf(mutexStatics.lock, 1));
define(Mutex, "lockIfAvailable", lengthOf(mutexStatics.lockIfAvailable, 2));
define(Mutex, "UnlockToken", UnlockToken);

const conditionStatics = {
  /** Releases the mutex that `unlockToken` holds until notified, then takes it again. */
  wait(condition: unknown, unlockToken: UnlockToken) {
    assertCondition(condition);
    conditionWait.$call(condition, lockedMutex(unlockToken), undefined);
  },

  /**
   * Waits at most `timeout` milliseconds. With a `predicate`, keeps waiting until it returns true, checking it with the mutex held,
   * and answers whether it did; without one it answers whether it was notified before the timeout.
   */
  waitFor(condition: unknown, unlockToken: UnlockToken, timeout: number, predicate?: () => unknown) {
    assertCondition(condition);
    const mutex = lockedMutex(unlockToken);
    const timeoutMs = timeoutMillis(timeout);
    if (predicate !== undefined && !$isCallable(predicate)) {
      throw new TypeError("Atomics.Condition.waitFor: predicate must be a function");
    }
    if (predicate === undefined) {
      // No time at all: report the timeout without giving the mutex up.
      if (timeoutMs === 0) return false;
      return conditionWait.$call(condition, mutex, timeoutMs);
    }

    const deadline = timeoutMs === undefined ? Infinity : performance.now() + timeoutMs;
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
    if (count === undefined) count = Infinity;
    if (typeof count !== "number" || (count !== Infinity && !Number.isInteger(count))) {
      throw new TypeError("Atomics.Condition.notify: count must be an integral Number or Infinity");
    }
    return conditionNotify.$call(condition, count === Infinity ? undefined : count < 1 ? 0 : count);
  },
};

define(Condition, "wait", lengthOf(conditionStatics.wait, 2));
define(Condition, "waitFor", lengthOf(conditionStatics.waitFor, 3));
define(Condition, "notify", lengthOf(conditionStatics.notify, 1));

/** A shared struct field is named by a property key: a string or a symbol, never a number or an object that converts to one. */
function assertPropertyKey(key: unknown) {
  if (typeof key !== "string" && typeof key !== "symbol") {
    throw new TypeError("A shared struct field is named by a string or a symbol");
  }
}

/** A field that is not there is a RangeError (a shared array's elements and `length` are fields, a Mutex has none). */
function assertField(target: object, key: PropertyKey) {
  if (!Reflect.has(target, key)) throw new RangeError("The shared struct has no such field");
}

function assertShareable(value: unknown) {
  if (!nativeCanBeShared(value))
    throw new TypeError("Only primitives and shared structs can be stored in a shared struct");
}

// Shared structs, arrays, mutexes and conditions are not typed arrays, so the engine's own functions would throw for them.
// Everything else, including every error, stays the original's. The checks follow the order of the proposal.
const atomicsOverloads = {
  load(target: unknown, index: unknown) {
    if ($isTypedArrayView(target) || !nativeIsSharedObject(target)) return originalLoad.$call(this, target, index);
    assertPropertyKey(index);
    assertField(target as object, index as PropertyKey);
    return nativeAtomicLoad(target, index);
  },
  store(target: unknown, index: unknown, value: unknown) {
    if ($isTypedArrayView(target) || !nativeIsSharedObject(target)) {
      return originalStore.$call(this, target, index, value);
    }
    assertPropertyKey(index);
    assertShareable(value);
    assertField(target as object, index as PropertyKey);
    return nativeAtomicStore(target, index, value);
  },
  exchange(target: unknown, index: unknown, value: unknown) {
    if ($isTypedArrayView(target) || !nativeIsSharedObject(target)) {
      return originalExchange.$call(this, target, index, value);
    }
    assertPropertyKey(index);
    assertShareable(value);
    assertField(target as object, index as PropertyKey);
    return nativeAtomicExchange(target, index, value);
  },
  compareExchange(target: unknown, index: unknown, expected: unknown, replacement: unknown) {
    if ($isTypedArrayView(target) || !nativeIsSharedObject(target)) {
      return originalCompareExchange.$call(this, target, index, expected, replacement);
    }
    assertPropertyKey(index);
    assertShareable(replacement);
    assertField(target as object, index as PropertyKey);
    return nativeAtomicCompareExchange(target, index, expected, replacement);
  },
};

const reflectStatics = {
  canBeShared(value: unknown) {
    return nativeCanBeShared(value);
  },
};

// `struct` / `shared struct` declarations in sources that `node:vm` compiles. JavaScriptCore does not know the syntax and
// vm sources do not pass through Bun's transpiler, so the vm entry points (NodeVM.cpp) hand a source that might declare a
// struct to `lowerStructSyntax` first. The lowered text calls `__structBase`, which the entry point installs in the target
// realm (`structBase`).

/** Text that starts a lowered source; the vm entry points look for it to know the target realm needs `__structBase`. */
const loweredMarker = "/*bun:structs*/";

// A declaration starts a statement: `struct Name`, `shared struct Name`, optionally after `export`.
const structDeclaration =
  /(?:^|[\n\r;{}:]|\*\/)[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:shared[ \t]+)?struct(?:[ \t]*\{|[ \t]+[\p{L}$_\\])/u;
const runtimeImport = /^import[ \t]*\{([^}]*)\}[ \t]*from[ \t]*["']bun:wrap["'];?[ \t]*\r?\n?/m;
const functionBodyName = "__bunVmFunctionBody__";

let transpiler: Bun.Transpiler | undefined;
let structBaseHelper: unknown;

/** The helper that lowered struct declarations call: the one the main realm's `bun:wrap` defines. */
function structBase() {
  return (structBaseHelper ??= $requireESM("bun:wrap").__structBase);
}

/**
 * Returns `source` with its struct declarations lowered to plain classes, or `source` itself when it has none.
 * `kind`: 0 a script, 1 the body of a function (`vm.compileFunction`), 2 a module. A declaration that is not valid
 * throws a SyntaxError.
 */
function lowerStructSyntax(source: string, kind: number): string {
  if (!structDeclaration.test(source)) return source;
  transpiler ??= new Bun.Transpiler({ loader: "js", deadCodeElimination: false });
  let lowered: string;
  try {
    // A function body is not a program (`return` is allowed in it), so it is transpiled inside a function.
    lowered = transpiler.transformSync(kind === 1 ? `function ${functionBodyName}() {${source}\n}` : source);
  } catch (error) {
    const first = (error as { errors?: { message?: string }[] })?.errors?.[0] ?? (error as { message?: string });
    throw new SyntaxError(first?.message ?? String(error));
  }
  // The printer imports the helper under a unique alias (`__structBase as __structBase_x1y2`); the lowered code calls it
  // by its own name instead, which the realm that runs it has.
  const aliases: string[][] = [];
  lowered = lowered.replace(runtimeImport, (_, names: string) => {
    for (const part of names.split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (name && alias) aliases.push([alias, name]);
    }
    return "";
  });
  for (const [alias, name] of aliases) lowered = lowered.replaceAll(alias, name);
  if (kind === 1) {
    const start = lowered.indexOf("{", lowered.indexOf(functionBodyName));
    lowered = lowered.slice(start + 1, lowered.lastIndexOf("}"));
  }
  return loweredMarker + lowered;
}

export default {
  lowerStructSyntax,
  structBase,
  Mutex,
  Condition,
  SharedArray,
  canBeShared: reflectStatics.canBeShared,
  load: atomicsOverloads.load,
  store: atomicsOverloads.store,
  exchange: atomicsOverloads.exchange,
  compareExchange: atomicsOverloads.compareExchange,
};

// The `shared struct` lowering in runtime.js builds its instances through this hook. Only the first call takes effect, so a
// script cannot stand in for the native structs by defining a property of the global object.
$requireESM("bun:wrap").__structBase.n({ create: (fields: string[]) => new SharedStruct(fields) });
