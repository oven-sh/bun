// Types for the TC39 structs proposal (https://github.com/tc39/proposal-structs).
// The `struct` and `shared struct` syntax itself is parsed by Bun and not modelled here:
// a declaration produces an ordinary class type, and shared structs may only hold
// values accepted by `Reflect.canBeShared`.
//
// Instances of shared structs, SharedArray, Atomics.Mutex and Atomics.Condition have no prototype, so none of
// them has a `Symbol.toStringTag` or any method: the operations are functions of `Atomics` (and `SharedArray` has `length`).

/** A value that can be stored in a shared struct field. */
type SharedValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | bigint
  | SharedStructObject
  | SharedArray
  | AtomicsMutex
  | AtomicsCondition;

/** Any instance of a `shared struct`. */
interface SharedStructObject {
  readonly [field: string]: SharedValue;
}

/** A fixed-length array that can be shared between workers without copying. */
interface SharedArray {
  // A typed array has a `buffer`, a shared array has none. This keeps a typed array from matching the SharedArray overloads of `Atomics`.
  readonly buffer?: undefined;
  readonly length: number;
  [index: number]: SharedValue;
}

interface SharedArrayConstructor {
  /** An empty shared array. */
  new (): SharedArray;
  /** A shared array of `length` elements, all `undefined`. `length` must be an integral Number. */
  new (length: number): SharedArray;
  /** A shared array of these elements (two or more, as one argument is a length). */
  new (...values: [SharedValue, SharedValue, ...SharedValue[]]): SharedArray;
}

declare var SharedArray: SharedArrayConstructor;

declare namespace Reflect {
  /** Whether `value` can be stored in a shared struct field or sent to another worker by reference. */
  function canBeShared(value: unknown): value is SharedValue;
}

/** A non-recursive lock that can be shared between workers. Use `Atomics.Mutex.lock` to take it. */
interface AtomicsMutex {
  // Type-level brand: no Atomics.Mutex has a property of this name, so it always reads as undefined.
  readonly "bun:structs:Mutex"?: never;
}

interface AtomicsMutexConstructor {
  new (): AtomicsMutex;

  /** The type of the token that `lock` returns. `new Atomics.Mutex.UnlockToken()` is an empty one that `lock` can fill. */
  readonly UnlockToken: AtomicsUnlockTokenConstructor;

  /**
   * Blocks until the lock is held. Fills `unlockToken` if one is given (it must be empty), else returns a new token.
   * Throws a TypeError if this thread already holds the lock.
   */
  lock(mutex: AtomicsMutex, unlockToken?: AtomicsUnlockToken): AtomicsUnlockToken;

  /**
   * Takes the lock if it is free, or within `timeout` milliseconds (`NaN` and `Infinity` wait for ever, zero and below not
   * at all). Returns `null` otherwise. Throws a TypeError if this thread already holds the lock.
   */
  lockIfAvailable(mutex: AtomicsMutex, timeout: number, unlockToken?: AtomicsUnlockToken): AtomicsUnlockToken | null;
}

/** Proof that a mutex is held. The only way to release it. */
interface AtomicsUnlockToken {
  /** Whether the token holds a mutex. */
  readonly locked: boolean;
  /** Releases the mutex if the token holds one. Returns whether it did. */
  unlock(): boolean;
  [Symbol.dispose](): void;
}

interface AtomicsUnlockTokenConstructor {
  new (): AtomicsUnlockToken;
  readonly prototype: AtomicsUnlockToken;
}

/** A condition variable that can be shared between workers. */
interface AtomicsCondition {
  // Type-level brand: no Atomics.Condition has a property of this name, so it always reads as undefined.
  readonly "bun:structs:Condition"?: never;
}

interface AtomicsConditionConstructor {
  new (): AtomicsCondition;

  /** Releases the mutex that `unlockToken` holds, waits to be notified, and relocks it. */
  wait(condition: AtomicsCondition, unlockToken: AtomicsUnlockToken): undefined;

  /**
   * Like `wait`, but gives up after `timeout` milliseconds. Without a `predicate` it returns whether it was notified;
   * with one it loops until the predicate returns a truthy value and returns whether it did.
   */
  waitFor(
    condition: AtomicsCondition,
    unlockToken: AtomicsUnlockToken,
    timeout: number,
    predicate?: () => unknown,
  ): boolean;

  /** Wakes up to `count` waiters (all if omitted or `Infinity`). `count` must be an integral Number or `Infinity`. Returns how many were woken. */
  notify(condition: AtomicsCondition, count?: number): number;
}

/** The name of an element of a shared array as `Atomics` takes it: a property key, so a string. */
type SharedArrayIndex = `${number}`;

// `Atomics` is an interface plus a var in lib.es2017.sharedmemory.d.ts, so it cannot be
// re-declared as a namespace. These members merge into that interface instead.
interface Atomics {
  readonly Mutex: AtomicsMutexConstructor;
  readonly Condition: AtomicsConditionConstructor;

  load<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K): T[K];
  load(array: SharedArray, index: SharedArrayIndex): SharedValue;
  load(array: SharedArray, index: "length"): number;
  store<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K, value: T[K]): T[K];
  store(array: SharedArray, index: SharedArrayIndex, value: SharedValue): SharedValue;
  exchange<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K, value: T[K]): T[K];
  exchange(array: SharedArray, index: SharedArrayIndex, value: SharedValue): SharedValue;
  compareExchange<T extends SharedStructObject, K extends keyof T & string>(
    struct: T,
    field: K,
    expected: T[K],
    replacement: T[K],
  ): T[K];
  compareExchange(
    array: SharedArray,
    index: SharedArrayIndex,
    expected: SharedValue,
    replacement: SharedValue,
  ): SharedValue;
}
