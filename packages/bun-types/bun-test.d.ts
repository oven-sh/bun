/**
 *
 * To run tests, run `bun test`
 *
 * @example
 *
 * ```bash
 * $ bun test
 * ```
 *
 * @example
 * ```bash
 * $ bun test <filename>
 * ```
 */

declare module "bun:test" {
  /**
   * Describes a group of related tests.
   *
   * @example
   * function sum(a, b) {
   *   return a + b;
   * }
   * describe("sum()", () => {
   *   test("can sum two values", () => {
   *     expect(sum(1, 1)).toBe(2);
   *   });
   * });
   *
   * @param label the label for the tests
   * @param fn the function that defines the tests
   */
  export type Describe = {
    (label: string, fn: () => void): void;
    /**
     * Skips this group of tests.
     *
     * @param label the label for the tests
     * @param fn the function that defines the tests
     */
    skip: (label: string, fn: () => void) => void;
    /**
     * Skips this group of tests, if `condition` is true.
     *
     * @param condition if these tests should be skipped
     */
    skipIf: (condition: boolean) => (label: string, fn: () => void) => void;
  };
  /**
   * Describes a group of related tests.
   *
   * @example
   * function sum(a, b) {
   *   return a + b;
   * }
   * describe("sum()", () => {
   *   test("can sum two values", () => {
   *     expect(sum(1, 1)).toBe(2);
   *   });
   * });
   *
   * @param label the label for the tests
   * @param fn the function that defines the tests
   */
  export const describe: Describe;
  /**
   * Runs a function, once, before all the tests.
   *
   * This is useful for running set up tasks, like initializing
   * a global variable or connecting to a database.
   *
   * If this function throws, tests will not run in this file.
   *
   * @example
   * let database;
   * beforeAll(async () => {
   *   database = await connect("localhost");
   * });
   *
   * @param fn the function to run
   */
  export function beforeAll(
    fn:
      | (() => void | Promise<unknown>)
      | ((done: (err?: unknown) => void) => void),
  ): void;
  /**
   * Runs a function before each test.
   *
   * This is useful for running set up tasks, like initializing
   * a global variable or connecting to a database.
   *
   * If this function throws, the test will not run.
   *
   * @param fn the function to run
   */
  export function beforeEach(
    fn:
      | (() => void | Promise<unknown>)
      | ((done: (err?: unknown) => void) => void),
  ): void;
  /**
   * Runs a function, once, after all the tests.
   *
   * This is useful for running clean up tasks, like closing
   * a socket or deleting temporary files.
   *
   * @example
   * let database;
   * afterAll(async () => {
   *   if (database) {
   *     await database.close();
   *   }
   * });
   *
   * @param fn the function to run
   */
  export function afterAll(
    fn:
      | (() => void | Promise<unknown>)
      | ((done: (err?: unknown) => void) => void),
  ): void;
  /**
   * Runs a function after each test.
   *
   * This is useful for running clean up tasks, like closing
   * a socket or deleting temporary files.
   *
   * @param fn the function to run
   */
  export function afterEach(
    fn:
      | (() => void | Promise<unknown>)
      | ((done: (err?: unknown) => void) => void),
  ): void;
  export type TestOptions = {
    /**
     * Sets the timeout for the test in milliseconds.
     *
     * If the test does not complete within this time, the test will fail with:
     * ```ts
     * 'Timeout: test {name} timed out after 5000ms'
     * ```
     *
     * @default 5000 // 5 seconds
     */
    timeout?: number;
    /**
     * Sets the number of times to retry the test if it fails.
     *
     * @default 0
     */
    retry?: number;
    /**
     * Sets the number of times to repeat the test, regardless of whether it passed or failed.
     *
     * @default 0
     */
    repeats?: number;
  };
  /**
   * Runs a test.
   *
   * @example
   * test("can check if using Bun", () => {
   *   expect(Bun).toBeDefined();
   * });
   *
   * test("can make a fetch() request", async () => {
   *   const response = await fetch("https://example.com/");
   *   expect(response.ok).toBe(true);
   * });
   *
   * test("can set a timeout", async () => {
   *   await Bun.sleep(100);
   * }, 50); // or { timeout: 50 }
   *
   * @param label the label for the test
   * @param fn the test function
   * @param options the test timeout or options
   */
  export type Test = {
    (
      label: string,
      fn:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      /**
       * - If a `number`, sets the timeout for the test in milliseconds.
       * - If an `object`, sets the options for the test.
       *   - `timeout` sets the timeout for the test in milliseconds.
       *   - `retry` sets the number of times to retry the test if it fails.
       *   - `repeats` sets the number of times to repeat the test, regardless of whether it passed or failed.
       */
      options?: number | TestOptions,
    ): void;
    /**
     * Skips all other tests, except this test.
     *
     * @param label the label for the test
     * @param fn the test function
     * @param options the test timeout or options
     */
    only(
      label: string,
      fn:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      options?: number | TestOptions,
    ): void;
    /**
     * Skips this test.
     *
     * @param label the label for the test
     * @param fn the test function
     * @param options the test timeout or options
     */
    skip(
      label: string,
      fn:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      options?: number | TestOptions,
    ): void;
    /**
     * Skips this test, if `condition` is true.
     *
     * @param condition if the test should be skipped
     */
    skipIf(
      condition: boolean,
    ): (
      label: string,
      fn:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      options?: number | TestOptions,
    ) => void;
    /**
     * Runs this test, if `condition` is true.
     *
     * This is the opposite of `test.skipIf()`.
     *
     * @param condition if the test should be skipped
     */
    runIf(
      condition: boolean,
    ): (
      label: string,
      fn:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      options?: number | TestOptions,
    ) => void;
    /**
     * Indicate a test is yet to be written or implemented correctly.
     *
     * When a test function is passed, it will be marked as `todo` in the test results
     * as long the test does not pass. When the test passes, the test will be marked as
     * `fail` in the results; you will have to remove the `.todo` or check that your test
     * is implemented correctly.
     *
     * @param label the label for the test
     * @param fn the test function
     * @param options the test timeout or options
     */
    todo(
      label: string,
      fn?:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      options?: number | TestOptions,
    ): void;
  };
  /**
   * Runs a test.
   *
   * @example
   * test("can check if using Bun", () => {
   *   expect(Bun).toBeDefined();
   * });
   *
   * test("can make a fetch() request", async () => {
   *   const response = await fetch("https://example.com/");
   *   expect(response.ok).toBe(true);
   * });
   *
   * @param label the label for the test
   * @param fn the test function
   */
  export const test: Test;
  export { test as it };
  /**
   * Asserts that a value matches some criteria.
   *
   * @link https://jestjs.io/docs/expect#reference
   * @example
   * expect(1 + 1).toBe(2);
   * expect([1,2,3]).toContain(2);
   * expect(null).toBeNull();
   *
   * @param actual the actual value
   */
  export const expect: {
    (actual: unknown): Expect;
    any: (
      constructor: ((..._: any[]) => any) | { new (..._: any[]): any },
    ) => Expect;
  };
  /**
   * Asserts that a value matches some criteria.
   *
   * @link https://jestjs.io/docs/expect#reference
   * @example
   * expect(1 + 1).toBe(2);
   * expect([1,2,3]).toContain(2);
   * expect(null).toBeNull();
   *
   * @param actual the actual value
   */
  export type Expect<T = unknown> = {
    /**
     * Negates the result of a subsequent assertion.
     *
     * @example
     * expect(1).not.toBe(0);
     * expect(null).not.toBeNull();
     */
    not: Expect<unknown>;
    /**
     * Asserts that a value equals what is expected.
     *
     * - For non-primitive values, like objects and arrays,
     * use `toEqual()` instead.
     * - For floating-point numbers, use `toBeCloseTo()` instead.
     *
     * @example
     * expect(100 + 23).toBe(123);
     * expect("d" + "og").toBe("dog");
     * expect([123]).toBe([123]); // fail, use toEqual()
     * expect(3 + 0.14).toBe(3.14); // fail, use toBeCloseTo()
     *
     * @param expected the expected value
     */
    toBe(expected: T): void;
    /**
     * Asserts that value is close to the expected by floating point precision.
     *
     * For example, the following fails because arithmetic on decimal (base 10)
     * values often have rounding errors in limited precision binary (base 2) representation.
     *
     * @example
     * expect(0.2 + 0.1).toBe(0.3); // fails
     *
     * Use `toBeCloseTo` to compare floating point numbers for approximate equality.
     *
     * @example
     * expect(0.2 + 0.1).toBeCloseTo(0.3, 5); // passes
     *
     * @param expected the expected value
     * @param numDigits the number of digits to check after the decimal point. Default is `2`
     */
    toBeCloseTo(expected: number, numDigits?: number): void;
    /**
     * Asserts that a value is deeply equal to what is expected.
     *
     * @example
     * expect(100 + 23).toBe(123);
     * expect("d" + "og").toBe("dog");
     * expect([456]).toEqual([456]);
     * expect({ value: 1 }).toEqual({ value: 1 });
     *
     * @param expected the expected value
     */
    toEqual(expected: T): void;
    /**
     * Asserts that a value is deeply and strictly equal to
     * what is expected.
     *
     * There are two key differences from `toEqual()`:
     * 1. It checks that the class is the same.
     * 2. It checks that `undefined` values match as well.
     *
     * @example
     * class Dog {
     *   type = "dog";
     * }
     * const actual = new Dog();
     * expect(actual).toStrictEqual(new Dog());
     * expect(actual).toStrictEqual({ type: "dog" }); // fail
     *
     * @example
     * const actual = { value: 1, name: undefined };
     * expect(actual).toEqual({ value: 1 });
     * expect(actual).toStrictEqual({ value: 1 }); // fail
     *
     * @param expected the expected value
     */
    toStrictEqual(expected: T): void;
    /**
     * Asserts that a value contains what is expected.
     *
     * The value must be an array or iterable, which
     * includes strings.
     *
     * @example
     * expect([1, 2, 3]).toContain(1);
     * expect(new Set([true])).toContain(true);
     * expect("hello").toContain("o");
     *
     * @param expected the expected value
     */
    toContain(expected: unknown): void;
    /**
     * Asserts that a value has a `.length` property
     * that is equal to the expected length.
     *
     * @example
     * expect([]).toHaveLength(0);
     * expect("hello").toHaveLength(4);
     *
     * @param length the expected length
     */
    toHaveLength(length: number): void;
    /**
     * Asserts that a value has a property with the
     * expected name, and value, if provided.
     *
     * @example
     * expect(new Set()).toHaveProperty("size");
     * expect(new Uint8Array()).toHaveProperty("byteLength", 0);
     *
     * @param name the expected property name
     * @param value the expected property value, if provided
     */
    toHaveProperty(name: string, value?: unknown): void;
    /**
     * Asserts that a value is "truthy".
     *
     * To assert that a value equals `true`, use `toBe(true)` instead.
     *
     * @link https://developer.mozilla.org/en-US/docs/Glossary/Truthy
     * @example
     * expect(true).toBeTruthy();
     * expect(1).toBeTruthy();
     * expect({}).toBeTruthy();
     */
    toBeTruthy(): void;
    /**
     * Asserts that a value is "falsy".
     *
     * To assert that a value equals `false`, use `toBe(false)` instead.
     *
     * @link https://developer.mozilla.org/en-US/docs/Glossary/Falsy
     * @example
     * expect(true).toBeTruthy();
     * expect(1).toBeTruthy();
     * expect({}).toBeTruthy();
     */
    toBeFalsy(): void;
    /**
     * Asserts that a value is defined. (e.g. is not `undefined`)
     *
     * @example
     * expect(true).toBeDefined();
     * expect(undefined).toBeDefined(); // fail
     */
    toBeDefined(): void;
    /**
     * Asserts that the expected value is an instance of value
     *
     * @example
     * expect([]).toBeInstanceOf(Array);
     * expect(null).toBeInstanceOf(Array); // fail
     */
    toBeInstanceOf(value: unknown): void;
    /**
     * Asserts that the expected value is an instance of value
     *
     * @example
     * expect([]).toBeInstanceOf(Array);
     * expect(null).toBeInstanceOf(Array); // fail
     */
    toBeInstanceOf(value: unknown): void;
    /**
     * Asserts that a value is `undefined`.
     *
     * @example
     * expect(undefined).toBeUndefined();
     * expect(null).toBeUndefined(); // fail
     */
    toBeUndefined(): void;
    /**
     * Asserts that a value is `null`.
     *
     * @example
     * expect(null).toBeNull();
     * expect(undefined).toBeNull(); // fail
     */
    toBeNull(): void;
    /**
     * Asserts that a value can be coerced to `NaN`.
     *
     * Same as using `Number.isNaN()`.
     *
     * @example
     * expect(NaN).toBeNaN();
     * expect(Infinity).toBeNaN();
     * expect("notanumber").toBeNaN();
     */
    toBeNaN(): void;
    /**
     * Asserts that a value is a `number` and is greater than the expected value.
     *
     * @example
     * expect(1).toBeGreaterThan(0);
     * expect(3.14).toBeGreaterThan(3);
     * expect(9).toBeGreaterThan(9); // fail
     *
     * @param expected the expected number
     */
    toBeGreaterThan(expected: number | bigint): void;
    /**
     * Asserts that a value is a `number` and is greater than or equal to the expected value.
     *
     * @example
     * expect(1).toBeGreaterThanOrEqual(0);
     * expect(3.14).toBeGreaterThanOrEqual(3);
     * expect(9).toBeGreaterThanOrEqual(9);
     *
     * @param expected the expected number
     */
    toBeGreaterThanOrEqual(expected: number | bigint): void;
    /**
     * Asserts that a value is a `number` and is less than the expected value.
     *
     * @example
     * expect(-1).toBeLessThan(0);
     * expect(3).toBeLessThan(3.14);
     * expect(9).toBeLessThan(9); // fail
     *
     * @param expected the expected number
     */
    toBeLessThan(expected: number | bigint): void;
    /**
     * Asserts that a value is a `number` and is less than or equal to the expected value.
     *
     * @example
     * expect(-1).toBeLessThanOrEqual(0);
     * expect(3).toBeLessThanOrEqual(3.14);
     * expect(9).toBeLessThanOrEqual(9);
     *
     * @param expected the expected number
     */
    toBeLessThanOrEqual(expected: number | bigint): void;
    /**
     * Asserts that a function throws an error.
     *
     * - If expected is a `string` or `RegExp`, it will check the `message` property.
     * - If expected is an `Error` object, it will check the `name` and `message` properties.
     * - If expected is an `Error` constructor, it will check the class of the `Error`.
     * - If expected is not provided, it will check if anything as thrown.
     *
     * @example
     * function fail() {
     *   throw new Error("Oops!");
     * }
     * expect(fail).toThrow("Oops!");
     * expect(fail).toThrow(/oops/i);
     * expect(fail).toThrow(Error);
     * expect(fail).toThrow();
     *
     * @param expected the expected error, error message, or error pattern
     */
    toThrow(expected?: string | Error | ErrorConstructor | RegExp): void;
    /**
     * Asserts that a value matches a regular expression or includes a substring.
     *
     * @example
     * expect("dog").toMatch(/dog/);
     * expect("dog").toMatch("og");
     *
     * @param expected the expected substring or pattern.
     */
    toMatch(expected: string | RegExp): void;
    /**
     * Asserts that a value matches the most recent snapshot.
     *
     * @example
     * expect([1, 2, 3]).toMatchSnapshot();
     * expect({ a: 1, b: 2 }).toMatchSnapshot({ a: 1 });
     * expect({ c: new Date() }).toMatchSnapshot({ c: expect.any(Date) });
     *
     * @param propertyMatchers Object containing properties to match against the value.
     * @param hint Hint used to identify the snapshot in the snapshot file.
     */
    toMatchSnapshot(propertyMatchers?: Object, hint?: string): void;
    /**
     * Asserts that a value is empty.
     *
     * @example
     * expect("").toBeEmpty();
     * expect([]).toBeEmpty();
     * expect({}).toBeEmpty();
     * expect(new Set()).toBeEmpty();
     */
    toBeEmpty(): void;
  };
}

declare module "test" {
  import BunTestModule = require("bun:test");
  export = BunTestModule;
}
