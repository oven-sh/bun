// Types for the TC39 structs proposal (https://github.com/tc39/proposal-structs).
// The `struct` and `shared struct` syntax itself is parsed by Bun and not modelled here:
// a declaration produces an ordinary class type, and shared structs may only hold
// values accepted by `Reflect.canBeShared`.

/** A value that can be stored in a shared struct field. */
type SharedValue = undefined | null | boolean | number | string | bigint | SharedStructObject | SharedArray | Atomics.Mutex | Atomics.Condition;

/** Any instance of a `shared struct`. */
interface SharedStructObject {
  readonly [field: string]: SharedValue;
}

/** A fixed-length array that can be shared between workers without copying. */
interface SharedArray {
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

declare namespace Atomics {
  /** A non-recursive lock that can be shared between workers. */
  class Mutex {
    constructor();

    /** Blocks until the lock is held. */
    static lock(mutex: Mutex, timeout?: number): Mutex.UnlockToken;

    /** Takes the lock if it is free, or within `timeout` milliseconds. Returns `null` otherwise. */
    static lockIfAvailable(mutex: Mutex, timeout?: number): Mutex.UnlockToken | null;
  }

  namespace Mutex {
    /** Proof that a mutex is held. The only way to release it. */
    class UnlockToken {
      constructor();
      unlock(): void;
      [Symbol.dispose](): void;
    }
  }

  /** A condition variable that can be shared between workers. */
  class Condition {
    constructor();

    /** Releases `mutex`, waits to be notified, and relocks it. Returns `false` on timeout. */
    static wait(condition: Condition, mutex: Mutex, timeout?: number): boolean;

    /** Like `wait`, but loops until `predicate` returns true or `timeout` elapses. */
    static waitFor(condition: Condition, mutex: Mutex, timeout: number, predicate?: () => boolean): boolean;

    /** Wakes up to `count` waiters (all if omitted). Returns how many were woken. */
    static notify(condition: Condition, count?: number): number;
  }

  function load<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K): T[K];
  function load(array: SharedArray, index: number): SharedValue;
  function store<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K, value: T[K]): T[K];
  function store(array: SharedArray, index: number, value: SharedValue): SharedValue;
  function exchange<T extends SharedStructObject, K extends keyof T & string>(struct: T, field: K, value: T[K]): T[K];
  function exchange(array: SharedArray, index: number, value: SharedValue): SharedValue;
  function compareExchange<T extends SharedStructObject, K extends keyof T & string>(
    struct: T,
    field: K,
    expected: T[K],
    replacement: T[K],
  ): T[K];
  function compareExchange(array: SharedArray, index: number, expected: SharedValue, replacement: SharedValue): SharedValue;
}
