import type { BunExpect } from "bun-test";
import type { Assert } from "./qunit.d";

export { $Assert as Assert };

class $Assert implements Assert {
  #$expect: BunExpect;
  #assertions = 0;
  #assertionsExpected: number | undefined;
  #asyncs = 0;
  #asyncsExpected: number | undefined;
  #promises: Promise<unknown>[] | undefined;
  #steps: string[] | undefined;
  #timeout: number | undefined;
  #abort: AbortController | undefined;

  constructor(expect: BunExpect) {
    this.#$expect = expect;
  }

  get #expect() {
    this.#assertions++;
    return this.#$expect;
  }

  async(count?: number): () => void {
    const expected = Math.max(0, count ?? 1);
    if (this.#asyncsExpected === undefined) {
      this.#asyncsExpected = expected;
    } else {
      this.#asyncsExpected += expected;
    }
    let actual = 0;
    return () => {
      this.#asyncs++;
      if (actual++ > expected) {
        throw new Error(`Expected ${expected} calls to async(), but got ${actual} instead`);
      }
    };
  }

  deepEqual<T>(actual: T, expected: T, message?: string): void {
    this.#expect(actual).toStrictEqual(expected);
  }

  equal(actual: any, expected: any, message?: string): void {
    this.#expect(actual == expected).toBe(true);
  }

  expect(amount: number): void {
    // If falsy, then the test can pass without any assertions.
    this.#assertionsExpected = Math.max(0, amount);
  }

  false(state: any, message?: string): void {
    this.#expect(state).toBe(false);
  }

  notDeepEqual(actual: any, expected: any, message?: string): void {
    this.#expect(actual).not.toStrictEqual(expected);
  }

  notEqual(actual: any, expected: any, message?: string): void {
    this.#expect(actual == expected).toBe(false);
  }

  notOk(state: any, message?: string): void {
    this.#expect(state).toBeFalsy();
  }

  notPropContains(actual: any, expected: any, message?: string): void {
    throw new Error("Method not implemented.");
  }

  notPropEqual(actual: any, expected: any, message?: string): void {
    throw new Error("Method not implemented.");
  }

  notStrictEqual(actual: any, expected: any, message?: string): void {
    this.#expect(actual).not.toBe(expected);
  }

  ok(state: any, message?: string): void {
    this.#expect(state).toBeTruthy();
  }

  propContains(actual: any, expected: any, message?: string): void {
    throw new Error("Method not implemented.");
  }

  propEqual(actual: any, expected: any, message?: string): void {
    throw new Error("Method not implemented.");
  }

  pushResult(assertResult: { result: boolean; actual: any; expected: any; message?: string; source?: string }): void {
    throw new Error("Method not implemented.");
  }

  async rejects(promise: unknown, expectedMatcher?: unknown, message?: unknown): Promise<void> {
    if (!(promise instanceof Promise)) {
      throw new Error(`Expected a promise, but got ${promise} instead`);
    }
    let passed = true;
    const result = promise
      .then(value => {
        passed = false;
        throw new Error(`Expected promise to reject, but it resolved with ${value}`);
      })
      .catch(error => {
        if (passed && expectedMatcher !== undefined) {
          // @ts-expect-error
          this.#$expect(() => {
            throw error;
          }).toThrow(expectedMatcher);
        }
      })
      .finally(() => {
        this.#assertions++;
      });
    if (this.#promises === undefined) {
      this.#promises = [result];
    } else {
      this.#promises.push(result);
    }
  }

  timeout(duration: number): void {
    if (this.#timeout !== undefined) {
      clearTimeout(this.#timeout);
    }
    if (this.#abort === undefined) {
      this.#abort = new AbortController();
    }
    const error = new Error(`Test timed out after ${duration}ms`);
    const onAbort = () => {
      this.#abort!.abort(error);
    };
    hideFromStack(onAbort);
    this.#timeout = +setTimeout(onAbort, Math.max(0, duration));
  }

  step(value: string): void {
    if (this.#steps) {
      this.#steps.push(value);
    } else {
      this.#steps = [value];
    }
  }

  strictEqual<T>(actual: T, expected: T, message?: string): void {
    this.#expect(actual).toBe(expected);
  }

  throws(block: () => void, expected?: any, message?: any): void {
    if (expected === undefined) {
      this.#expect(block).toThrow();
    } else {
      this.#expect(block).toThrow(expected);
    }
  }

  raises(block: () => void, expected?: any, message?: any): void {
    if (expected === undefined) {
      this.#expect(block).toThrow();
    } else {
      this.#expect(block).toThrow(expected);
    }
  }

  true(state: any, message?: string): void {
    this.#expect(state).toBe(true);
  }

  verifySteps(steps: string[], message?: string): void {
    const actual = this.#steps ?? [];
    try {
      this.#expect(actual).toStrictEqual(steps);
    } finally {
      this.#steps = undefined;
    }
  }

  async close(timeout: number): Promise<void> {
    const newError = (reason: string) => {
      const message = this.#abort?.signal?.aborted ? `${reason} (timed out after ${timeout}ms)` : reason;
      return new Error(message);
    };
    hideFromStack(newError);
    const assert = () => {
      if (this.#assertions === 0 && this.#assertionsExpected !== 0) {
        throw newError("Test completed without any assertions");
      }
      if (this.#assertionsExpected && this.#assertionsExpected !== this.#assertions) {
        throw newError(`Expected ${this.#assertionsExpected} assertions, but got ${this.#assertions} instead`);
      }
      if (this.#asyncsExpected && this.#asyncsExpected !== this.#asyncs) {
        throw newError(`Expected ${this.#asyncsExpected} calls to async(), but got ${this.#asyncs} instead`);
      }
    };
    hideFromStack(assert);
    if (this.#promises === undefined && this.#asyncsExpected === undefined) {
      assert();
      return;
    }
    if (this.#timeout === undefined) {
      this.timeout(timeout);
    }
    const { signal } = this.#abort!;
    const onTimeout = new Promise((_, reject) => {
      signal.onabort = () => {
        reject(signal.reason);
      };
    });
    await Promise.race([onTimeout, Promise.all(this.#promises ?? [])]);
    assert();
  }
}

function hideFromStack(object: any): void {
  if (typeof object === "function") {
    Object.defineProperty(object, "name", {
      value: "::bunternal::",
    });
    return;
  }
  for (const name of Object.getOwnPropertyNames(object)) {
    Object.defineProperty(object[name], "name", {
      value: "::bunternal::",
    });
  }
}

hideFromStack($Assert.prototype);
