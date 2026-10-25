// Types for the TC39 structs proposal (https://github.com/tc39/proposal-structs).
// The `struct` and `shared struct` syntax itself is parsed by Bun and not modelled here:
// a declaration produces an ordinary class type, and shared structs may only hold
// values accepted by `Reflect.canBeShared`.

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
  // Brands the type, so that a typed array does not match the SharedArray overloads of `Atomics`.
  readonly [Symbol.toStringTag]: "SharedArray";
  readonly length: number;
  [index: number]: SharedValue;
}

interface SharedArrayConstructor {
  new (length: number): SharedArray;
  readonly prototype: SharedArray;
}

declare var SharedArray: SharedArrayConstructor;

declare namespace Reflect {
  /** Whether `value` can be stored in a shared struct field or sent to another worker by reference. */
  function canBeShared(value: unknown): value is SharedValue;
}

/** A non-recursive lock that can be shared between workers. Use `Atomics.Mutex.lock` to take it. */
interface AtomicsMutex {
  readonly [Symbol.toStringTag]: "Atomics.Mutex";
}

interface AtomicsMutexConstructor {
  new (): AtomicsMutex;
  readonly prototype: AtomicsMutex;

  /** Blocks until the lock is held. Fills `unlockToken` if one is given (it must be empty), else returns a new token. */
  lock(mutex: AtomicsMutex, unlockToken?: AtomicsUnlockToken): AtomicsUnlockToken;

  /** Takes the lock if it is free, or within `timeout` milliseconds. Returns `null` otherwise. */
  lockIfAvailable(mutex: AtomicsMutex, timeout?: number, unlockToken?: AtomicsUnlockToken): AtomicsUnlockToken | null;
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
  readonly [Symbol.toStringTag]: "Atomics.Condition";
}

interface AtomicsConditionConstructor {
  new (): AtomicsCondition;
  readonly prototype: AtomicsCondition;

  /** Releases the mutex that `unlockToken` holds, waits to be notified, and relocks it. */
  wait(condition: AtomicsCondition, unlockToken: AtomicsUnlockToken): undefined;

  /**
   * Like `wait`, but gives up after `timeout` milliseconds. Without a `predicate` it returns whether it was notified;
   * with one it loops until the predicate returns true and returns whether it did.
   */
  waitFor(condition: AtomicsCondition, unlockToken: AtomicsUnlockToken, timeout: number, predicate?: () => boolean): boolean;

  /** Wakes up to `count` waiters (all if omitted). Returns how many were woken. */
  notify(condition: AtomicsCondition, count?: number): number;
}

// `Atomics` is an interface plus a var in lib.es2017.sharedmemory.d.ts, so it cannot be
// re-declared as a namespace. These members merge into that interface instead.
interface Atomics {
  readonly Mutex: AtomicsMutexConstructor;
  readonly UnlockToken: AtomicsUnlockTokenConstructor;
  readonly Condition: AtomicsConditionConstructor;

  load<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K): T[K];
  load(array: SharedArray, index: number): SharedValue;
  store<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K, value: T[K]): T[K];
  store(array: SharedArray, index: number, value: SharedValue): SharedValue;
  exchange<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K, value: T[K]): T[K];
  exchange(array: SharedArray, index: number, value: SharedValue): SharedValue;
  compareExchange<T extends SharedStructObject, K extends keyof T & string>(
    struct: T,
    field: K,
    expected: T[K],
    replacement: T[K],
  ): T[K];
  compareExchange(array: SharedArray, index: number, expected: SharedValue, replacement: SharedValue): SharedValue;
}
