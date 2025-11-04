/**
 * Promise-related utilities for testing asynchronous behavior.
 */

/**
 * Tracks a value over time and provides async waiting until it reaches a threshold.
 * Useful for testing conditions that change asynchronously without hardcoded timeouts.
 * Supports custom comparison functions for complex types.
 *
 * @template T - Type of value being tracked
 *
 * @example
 * // Basic usage with numbers
 * const counter = new PromiseStateTracker(0);
 * setTimeout(() => counter.value = 5, 100);
 * await counter.untilValue(5); // Waits until counter reaches 5
 *
 * @example
 * // Custom comparison for objects
 * const tracker = new PromiseStateTracker({ count: 0 }, 5000, (a, b) => a.count - b.count);
 * await tracker.untilValue({ count: 10 });
 */
export class PromiseStateTracker<T> {
  #value: T;
  #timeoutMs: number;
  #activeResolvers: [T, number, (value: T | PromiseLike<T>) => void][] = [];
  #compareFn: (a: T, b: T) => number;

  /**
   * @param initialValue - Starting value for the tracker
   * @param defaultTimeoutMs - Default timeout in ms for untilValue() calls (default: 5000)
   * @param compareFn - Comparison function returning <0 if a<b, 0 if a=b, >0 if a>b (default: standard comparison)
   * @example
   * const tracker = new PromiseStateTracker(0, 10000); // 10s timeout
   * @example
   * // With custom comparison
   * const tracker = new PromiseStateTracker({ x: 0 }, 5000, (a, b) => a.x - b.x);
   */
  constructor(
    initialValue: T,
    defaultTimeoutMs: number = 5000,
    compareFn: (a: T, b: T) => number = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  ) {
    this.#value = initialValue;
    this.#timeoutMs = defaultTimeoutMs;
    this.#compareFn = compareFn;
  }

  /**
   * Gets the current tracked value.
   * @example
   * expect(tracker.value).toBe(5);
   */
  get value(): T {
    return this.#value;
  }

  /**
   * Sets a new value and resolves any waiting promises that meet their threshold.
   * Uses the compare function to determine if the new value satisfies waiting conditions.
   * @example
   * tracker.value = 10; // Resolves all untilValue() calls waiting for <= 10
   */
  set value(newValue: T) {
    this.#value = newValue;

    const toResolve = this.#activeResolvers
      .filter(([expected]) => this.#compareFn(newValue, expected) >= 0);

    toResolve.forEach(([, alarm, resolve]) => {
      clearTimeout(alarm);
      resolve(newValue);
    });

    this.#activeResolvers = this.#activeResolvers
      .filter(([expected]) => this.#compareFn(newValue, expected) < 0);
  }

  /**
   * Returns a promise that resolves when the tracked value reaches or exceeds the threshold.
   * If already at or above the threshold, resolves immediately.
   * Comparison is done using the compare function provided in the constructor.
   * @param expectedValue - Threshold value to wait for (resolves when compareFn(value, expectedValue) >= 0)
   * @param timeoutMs - Optional timeout override in ms (uses constructor default if omitted)
   * @returns Promise that resolves with the current value when condition is met
   * @example
   * await tracker.untilValue(10); // Wait until value >= 10
   * await tracker.untilValue(5, 1000); // Wait with 1s timeout
   */
  untilValue(expectedValue: T, timeoutMs: number | undefined = undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.#compareFn(this.#value, expectedValue) >= 0) {
        resolve(this.#value);
        return;
      }

      const timeout = timeoutMs !== undefined ? timeoutMs : this.#timeoutMs;
      const alarm = setTimeout(() => {
        reject(new Error(`Timeout waiting for counter to reach ${expectedValue}, current is ${this.#value}.`));
      }, timeout);

      this.#activeResolvers.push([expectedValue, alarm, resolve]);
    });
  }
};

/**
 * A specialized counter that can be awaited until it reaches a target value.
 * Extends PromiseStateTracker with numeric comparison and an increment helper.
 *
 * @example
 * const counter = new AwaitableCounter();
 * setTimeout(() => counter.increment(), 50);
 * setTimeout(() => counter.increment(), 100);
 * await counter.untilValue(2); // Waits until counter reaches 2
 */
export class AwaitableCounter extends PromiseStateTracker<number> {
  /**
   * @param initialValue - Starting counter value (default: 0)
   * @param defaultTimeoutMs - Default timeout in ms for untilValue() calls (default: 5000)
   * @example
   * const counter = new AwaitableCounter(10); // Starts at 10
   */
  constructor(initialValue: number = 0, defaultTimeoutMs: number = 5000) {
    super(initialValue, defaultTimeoutMs, (a, b) => a - b);
  }

  /**
   * Increments the counter by 1 and resolves any waiting promises.
   * @example
   * counter.increment(); // counter.value is now counter.value + 1
   */
  increment() {
    this.value += 1;
  }
}
