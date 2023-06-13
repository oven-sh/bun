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
  type AnyFunction = (...args: any) => any;
  /**
   * -- Mocks --
   */
  export interface Mock<T extends AnyFunction>
    extends JestMock.MockInstance<T> {
    (...args: Parameters<T>): ReturnType<T>;
  }
  type _Mock<T extends AnyFunction> = Mock<T>;

  export const mock: {
    <T extends AnyFunction>(Function: T): Mock<T>;

    mockClear(): typeof mock;
    mockReset(): typeof mock;
    mockRestore(): void;
    mockReturnValue<T extends JestMock.FunctionLike = JestMock.UnknownFunction>(
      value: ReturnType<T>,
    ): JestMock.MockInstance<T>;
    mockReturnValueOnce<
      T extends JestMock.FunctionLike = JestMock.UnknownFunction,
    >(
      value: ReturnType<T>,
    ): JestMock.MockInstance<T>;
    mockResolvedValue<
      T extends JestMock.FunctionLike = JestMock.UnknownFunction,
    >(
      value: JestMock.ResolveType<T>,
    ): JestMock.MockInstance<T>;
    mockResolvedValueOnce<
      T extends JestMock.FunctionLike = JestMock.UnknownFunction,
    >(
      value: JestMock.ResolveType<T>,
    ): JestMock.MockInstance<T>;
    mockRejectedValue<
      T extends JestMock.FunctionLike = JestMock.UnknownFunction,
    >(
      value: JestMock.RejectType<T>,
    ): JestMock.MockInstance<T>;
    mockRejectedValueOnce<
      T extends JestMock.FunctionLike = JestMock.UnknownFunction,
    >(
      value: JestMock.RejectType<T>,
    ): JestMock.MockInstance<T>;
  };

  interface Jest {
    restoreAllMocks(): void;
    fn<T extends AnyFunction>(func?: T): Mock<T>;
  }
  export const jest: Jest;
  export namespace jest {
    /**
     * Constructs the type of a mock function, e.g. the return type of `jest.fn()`.
     */
    type Mock<T extends AnyFunction = AnyFunction> = _Mock<T>;
    /**
     * Wraps a class, function or object type with Jest mock type definitions.
     */
    // type Mocked<T extends object> = JestMock.Mocked<T>;
    /**
     * Wraps a class type with Jest mock type definitions.
     */
    // type MockedClass<T extends JestMock.ClassLike> = JestMock.MockedClass<T>;
    /**
     * Wraps a function type with Jest mock type definitions.
     */
    // type MockedFunction<T extends AnyFunction> = JestMock.MockedFunction<T>;
    /**
     * Wraps an object type with Jest mock type definitions.
     */
    // type MockedObject<T extends object> = JestMock.MockedObject<T>;
    /**
     * Constructs the type of a replaced property.
     */
    type Replaced<T> = JestMock.Replaced<T>;
    /**
     * Constructs the type of a spied class or function.
     */
    type Spied<T extends JestMock.ClassLike | AnyFunction> = JestMock.Spied<T>;
    /**
     * Constructs the type of a spied class.
     */
    type SpiedClass<T extends JestMock.ClassLike> = JestMock.SpiedClass<T>;
    /**
     * Constructs the type of a spied function.
     */
    type SpiedFunction<T extends AnyFunction> = JestMock.SpiedFunction<T>;
    /**
     * Constructs the type of a spied getter.
     */
    type SpiedGetter<T> = JestMock.SpiedGetter<T>;
    /**
     * Constructs the type of a spied setter.
     */
    type SpiedSetter<T> = JestMock.SpiedSetter<T>;
  }

  export function spyOn<T extends object, K extends keyof T>(
    obj: T,
    methodOrPropertyValue: K,
  ): Mock<() => T[K]>;

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
     * Skips all other tests, except this group of tests.
     *
     * @param label the label for the tests
     * @param fn the function that defines the tests
     */
    only(label: string, fn: () => void): void;
    /**
     * Skips this group of tests.
     *
     * @param label the label for the tests
     * @param fn the function that defines the tests
     */
    skip(label: string, fn: () => void): void;
    /**
     * Marks this group of tests as to be written or to be fixed.
     *
     * @param label the label for the tests
     * @param fn the function that defines the tests
     */
    todo(label: string, fn?: () => void): void;
    /**
     * Runs this group of tests, only if `condition` is true.
     *
     * This is the opposite of `describe.skipIf()`.
     *
     * @param condition if these tests should run
     */
    if(condition: boolean): (label: string, fn: () => void) => void;
    /**
     * Skips this group of tests, if `condition` is true.
     *
     * @param condition if these tests should be skipped
     */
    skipIf(condition: boolean): (label: string, fn: () => void) => void;
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
     * Marks this test as to be written or to be fixed.
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
    /**
     * Runs this test, if `condition` is true.
     *
     * This is the opposite of `test.skipIf()`.
     *
     * @param condition if the test should run
     */
    if(
      condition: boolean,
    ): (
      label: string,
      fn:
        | (() => void | Promise<unknown>)
        | ((done: (err?: unknown) => void) => void),
      options?: number | TestOptions,
    ) => void;
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
    anything: () => Expect;
    stringContaining: (str: string) => Expect;
    stringMatching: (regex: RegExp | string) => Expect;
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
     * Asserts that an object matches a subset of properties.
     *
     * @example
     * expect({ a: 1, b: 2 }).toMatchObject({ b: 2 });
     * expect({ c: new Date(), d: 2 }).toMatchObject({ d: 2 });
     *
     * @param subset Subset of properties to match with.
     */
    toMatchObject(subset: Object): void;
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
    /**
     * Asserts that a value is `null` or `undefined`.
     *
     * @example
     * expect(null).toBeNil();
     * expect(undefined).toBeNil();
     */
    toBeNil(): void;
    /**
     * Asserts that a value is a `boolean`.
     *
     * @example
     * expect(true).toBeBoolean();
     * expect(false).toBeBoolean();
     * expect(null).not.toBeBoolean();
     * expect(0).not.toBeBoolean();
     */
    toBeBoolean(): void;
    /**
     * Asserts that a value is `true`.
     *
     * @example
     * expect(true).toBeTrue();
     * expect(false).not.toBeTrue();
     * expect(1).not.toBeTrue();
     */
    toBeTrue(): void;
    /**
     * Asserts that a value is `false`.
     *
     * @example
     * expect(false).toBeFalse();
     * expect(true).not.toBeFalse();
     * expect(0).not.toBeFalse();
     */
    toBeFalse(): void;
    /**
     * Asserts that a value is a `number`.
     *
     * @example
     * expect(1).toBeNumber();
     * expect(3.14).toBeNumber();
     * expect(NaN).toBeNumber();
     * expect(BigInt(1)).not.toBeNumber();
     */
    toBeNumber(): void;
    /**
     * Asserts that a value is a `number`, and is an integer.
     *
     * @example
     * expect(1).toBeInteger();
     * expect(3.14).not.toBeInteger();
     * expect(NaN).not.toBeInteger();
     */
    toBeInteger(): void;
    /**
     * Asserts that a value is a `number`, and is not `NaN` or `Infinity`.
     *
     * @example
     * expect(1).toBeFinite();
     * expect(3.14).toBeFinite();
     * expect(NaN).not.toBeFinite();
     * expect(Infinity).not.toBeFinite();
     */
    toBeFinite(): void;
    /**
     * Asserts that a value is a positive `number`.
     *
     * @example
     * expect(1).toBePositive();
     * expect(-3.14).not.toBePositive();
     * expect(NaN).not.toBePositive();
     */
    toBePositive(): void;
    /**
     * Asserts that a value is a negative `number`.
     *
     * @example
     * expect(-3.14).toBeNegative();
     * expect(1).not.toBeNegative();
     * expect(NaN).not.toBeNegative();
     */
    toBeNegative(): void;
    /**
     * Asserts that a value is a number between a start and end value.
     *
     * @param start the start number (inclusive)
     * @param end the end number (exclusive)
     */
    toBeWithin(start: number, end: number): void;
    /**
     * Asserts that a value is a `symbol`.
     *
     * @example
     * expect(Symbol("foo")).toBeSymbol();
     * expect("foo").not.toBeSymbol();
     */
    toBeSymbol(): void;
    /**
     * Asserts that a value is a `function`.
     *
     * @example
     * expect(() => {}).toBeFunction();
     */
    toBeFunction(): void;
    /**
     * Asserts that a value is a `Date` object.
     *
     * To check if a date is valid, use `toBeValidDate()` instead.
     *
     * @example
     * expect(new Date()).toBeDate();
     * expect(new Date(null)).toBeDate();
     * expect("2020-03-01").not.toBeDate();
     */
    toBeDate(): void;
    /**
     * Asserts that a value is a valid `Date` object.
     *
     * @example
     * expect(new Date()).toBeValidDate();
     * expect(new Date(null)).not.toBeValidDate();
     * expect("2020-03-01").not.toBeValidDate();
     */
    toBeValidDate(): void;
    /**
     * Asserts that a value is a `string`.
     *
     * @example
     * expect("foo").toBeString();
     * expect(new String("bar")).toBeString();
     * expect(123).not.toBeString();
     */
    toBeString(): void;
    /**
     * Asserts that a value includes a `string`.
     *
     * For non-string values, use `toContain()` instead.
     *
     * @param expected the expected substring
     */
    toInclude(expected: string): void;
    /**
     * Asserts that a value starts with a `string`.
     *
     * @param expected the string to start with
     */
    toStartWith(expected: string): void;
    /**
     * Asserts that a value ends with a `string`.
     *
     * @param expected the string to end with
     */
    toEndWith(expected: string): void;
    /**
     * Ensures that a mock function is called.
     */
    toHaveBeenCalled(): void;
    /**
     * Ensures that a mock function is called an exact number of times.
     */
    toHaveBeenCalledTimes(expected: number): void;
    /**
     * Ensure that a mock function is called with specific arguments.
     */
    // toHaveBeenCalledWith(...expected: Array<unknown>): void;
  };
}

declare module "test" {
  import BunTestModule = require("bun:test");
  export = BunTestModule;
}

declare namespace JestMock {
  /**
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   */
  export type ClassLike = {
    new (...args: any): any;
  };

  export type ConstructorLikeKeys<T> = keyof {
    [K in keyof T as Required<T>[K] extends ClassLike ? K : never]: T[K];
  };

  // export const fn: <T extends FunctionLike = UnknownFunction>(
  //   implementation?: T | undefined,
  // ) => Mock<T>;

  export type FunctionLike = (...args: any) => any;

  export type MethodLikeKeys<T> = keyof {
    [K in keyof T as Required<T>[K] extends FunctionLike ? K : never]: T[K];
  };

  /**
   * All what the internal typings need is to be sure that we have any-function.
   * `FunctionLike` type ensures that and helps to constrain the type as well.
   * The default of `UnknownFunction` makes sure that `any`s do not leak to the
   * user side. For instance, calling `fn()` without implementation will return
   * a mock of `(...args: Array<unknown>) => unknown` type. If implementation
   * is provided, its typings are inferred correctly.
   */
  // export interface Mock<T extends FunctionLike = UnknownFunction>
  //   extends Function,
  //     MockInstance<T> {
  //   new (...args: Parameters<T>): ReturnType<T>;
  //   (...args: Parameters<T>): ReturnType<T>;
  // }

  // export type Mocked<T> = T extends ClassLike
  //   ? MockedClass<T>
  //   : T extends FunctionLike
  //   ? MockedFunction<T>
  //   : T extends object
  //   ? MockedObject<T>
  //   : T;

  // export const mocked: {
  //   <T extends object>(
  //     source: T,
  //     options?: {
  //       shallow: false;
  //     },
  //   ): Mocked<T>;
  //   <T_1 extends object>(
  //     source: T_1,
  //     options: {
  //       shallow: true;
  //     },
  //   ): MockedShallow<T_1>;
  // };

  // export type MockedClass<T extends ClassLike> = MockInstance<
  //   (...args: ConstructorParameters<T>) => Mocked<InstanceType<T>>
  // > &
  //   MockedObject<T>;

  // export type MockedFunction<T extends FunctionLike> = MockInstance<T> &
  //   MockedObject<T>;

  // type MockedFunctionShallow<T extends FunctionLike> = MockInstance<T> & T;

  // export type MockedObject<T extends object> = {
  //   [K in keyof T]: T[K] extends ClassLike
  //     ? MockedClass<T[K]>
  //     : T[K] extends FunctionLike
  //     ? MockedFunction<T[K]>
  //     : T[K] extends object
  //     ? MockedObject<T[K]>
  //     : T[K];
  // } & T;

  // type MockedObjectShallow<T extends object> = {
  //   [K in keyof T]: T[K] extends ClassLike
  //     ? MockedClass<T[K]>
  //     : T[K] extends FunctionLike
  //     ? MockedFunctionShallow<T[K]>
  //     : T[K];
  // } & T;

  // export type MockedShallow<T> = T extends ClassLike
  //   ? MockedClass<T>
  //   : T extends FunctionLike
  //   ? MockedFunctionShallow<T>
  //   : T extends object
  //   ? MockedObjectShallow<T>
  //   : T;

  // export type MockFunctionMetadata<
  //   T = unknown,
  //   MetadataType = MockMetadataType,
  // > = MockMetadata<T, MetadataType>;

  // export type MockFunctionMetadataType = MockMetadataType;

  type MockFunctionResult<T extends FunctionLike = UnknownFunction> =
    | MockFunctionResultIncomplete
    | MockFunctionResultReturn<T>
    | MockFunctionResultThrow;

  type MockFunctionResultIncomplete = {
    type: "incomplete";
    /**
     * Result of a single call to a mock function that has not yet completed.
     * This occurs if you test the result from within the mock function itself,
     * or from within a function that was called by the mock.
     */
    value: undefined;
  };

  type MockFunctionResultReturn<T extends FunctionLike = UnknownFunction> = {
    type: "return";
    /**
     * Result of a single call to a mock function that returned.
     */
    value: ReturnType<T>;
  };

  type MockFunctionResultThrow = {
    type: "throw";
    /**
     * Result of a single call to a mock function that threw.
     */
    value: unknown;
  };

  type MockFunctionState<T extends FunctionLike = FunctionLike> = {
    /**
     * List of the call arguments of all calls that have been made to the mock.
     */
    calls: Array<Parameters<T>>;
    /**
     * List of all the object instances that have been instantiated from the mock.
     */
    instances: Array<ReturnType<T>>;
    /**
     * List of all the function contexts that have been applied to calls to the mock.
     */
    contexts: Array<ThisParameterType<T>>;
    /**
     * List of the call order indexes of the mock. Jest is indexing the order of
     * invocations of all mocks in a test file. The index is starting with `1`.
     */
    // invocationCallOrder: Array<number>;
    /**
     * List of the call arguments of the last call that was made to the mock.
     * If the function was not called, it will return `undefined`.
     */
    // lastCall?: Parameters<T>;
    /**
     * List of the results of all calls that have been made to the mock.
     */
    results: Array<MockFunctionResult<T>>;
  };

  export interface MockInstance<T extends FunctionLike = UnknownFunction> {
    _isMockFunction: true;
    _protoImpl: Function;
    getMockImplementation(): T | undefined;
    getMockName(): string;
    mock: MockFunctionState<T>;
    mockClear(): this;
    mockReset(): this;
    mockRestore(): void;
    mockImplementation(fn: T): this;
    mockImplementationOnce(fn: T): this;
    withImplementation(fn: T, callback: () => Promise<unknown>): Promise<void>;
    withImplementation(fn: T, callback: () => void): void;
    mockName(name: string): this;
    mockReturnThis(): this;
    mockReturnValue(value: ReturnType<T>): this;
    mockReturnValueOnce(value: ReturnType<T>): this;
    mockResolvedValue(value: ResolveType<T>): this;
    mockResolvedValueOnce(value: ResolveType<T>): this;
    mockRejectedValue(value: RejectType<T>): this;
    mockRejectedValueOnce(value: RejectType<T>): this;
  }

  // export type MockMetadata<T, MetadataType = MockMetadataType> = {
  //   ref?: number;
  //   members?: Record<string, MockMetadata<T>>;
  //   mockImpl?: T;
  //   name?: string;
  //   refID?: number;
  //   type?: MetadataType;
  //   value?: T;
  //   length?: number;
  // };

  // export type MockMetadataType =
  //   | "object"
  //   | "array"
  //   | "regexp"
  //   | "function"
  //   | "constant"
  //   | "collection"
  //   | "null"
  //   | "undefined";

  // export class ModuleMocker {
  //   private readonly _environmentGlobal;
  //   private _mockState;
  //   private _mockConfigRegistry;
  //   private _spyState;
  //   private _invocationCallCounter;
  //   /**
  //    * @see README.md
  //    * @param global Global object of the test environment, used to create
  //    * mocks
  //    */
  //   constructor(global: typeof globalThis);
  //   private _getSlots;
  //   private _ensureMockConfig;
  //   private _ensureMockState;
  //   private _defaultMockConfig;
  //   private _defaultMockState;
  //   private _makeComponent;
  //   private _createMockFunction;
  //   private _generateMock;
  //   /**
  //    * Check whether the given property of an object has been already replaced.
  //    */
  //   private _findReplacedProperty;
  //   /**
  //    * @see README.md
  //    * @param metadata Metadata for the mock in the schema returned by the
  //    * getMetadata method of this module.
  //    */
  //   generateFromMetadata<T>(metadata: MockMetadata<T>): Mocked<T>;
  //   /**
  //    * @see README.md
  //    * @param component The component for which to retrieve metadata.
  //    */
  //   getMetadata<T = unknown>(
  //     component: T,
  //     _refs?: Map<T, number>,
  //   ): MockMetadata<T> | null;
  //   isMockFunction<T extends FunctionLike = UnknownFunction>(
  //     fn: MockInstance<T>,
  //   ): fn is MockInstance<T>;
  //   isMockFunction<P extends Array<unknown>, R>(
  //     fn: (...args: P) => R,
  //   ): fn is Mock<(...args: P) => R>;
  //   isMockFunction(fn: unknown): fn is Mock<UnknownFunction>;
  //   fn<T extends FunctionLike = UnknownFunction>(implementation?: T): Mock<T>;
  //   private _attachMockImplementation;
  //   spyOn<
  //     T extends object,
  //     K extends PropertyLikeKeys<T>,
  //     A extends "get" | "set",
  //   >(
  //     object: T,
  //     methodKey: K,
  //     accessType: A,
  //   ): A extends "get"
  //     ? SpiedGetter<T[K]>
  //     : A extends "set"
  //     ? SpiedSetter<T[K]>
  //     : never;
  //   spyOn<
  //     T extends object,
  //     K extends ConstructorLikeKeys<T> | MethodLikeKeys<T>,
  //     V extends Required<T>[K],
  //   >(
  //     object: T,
  //     methodKey: K,
  //   ): V extends ClassLike | FunctionLike ? Spied<V> : never;
  //   private _spyOnProperty;
  //   replaceProperty<
  //     T extends object,
  //     K extends PropertyLikeKeys<T>,
  //     V extends T[K],
  //   >(object: T, propertyKey: K, value: V): Replaced<T[K]>;
  //   clearAllMocks(): void;
  //   resetAllMocks(): void;
  //   restoreAllMocks(): void;
  //   private _typeOf;
  //   mocked<T extends object>(
  //     source: T,
  //     options?: {
  //       shallow: false;
  //     },
  //   ): Mocked<T>;
  //   mocked<T extends object>(
  //     source: T,
  //     options: {
  //       shallow: true;
  //     },
  //   ): MockedShallow<T>;
  // }

  export type PropertyLikeKeys<T> = Exclude<
    keyof T,
    ConstructorLikeKeys<T> | MethodLikeKeys<T>
  >;

  export type RejectType<T extends FunctionLike> =
    ReturnType<T> extends PromiseLike<any> ? unknown : never;

  export interface Replaced<T = unknown> {
    /**
     * Restore property to its original value known at the time of mocking.
     */
    restore(): void;
    /**
     * Change the value of the property.
     */
    replaceValue(value: T): this;
  }

  export const replaceProperty: <
    T extends object,
    K_2 extends Exclude<
      keyof T,
      | keyof {
          [K in keyof T as Required<T>[K] extends ClassLike ? K : never]: T[K];
        }
      | keyof {
          [K_1 in keyof T as Required<T>[K_1] extends FunctionLike
            ? K_1
            : never]: T[K_1];
        }
    >,
    V extends T[K_2],
  >(
    object: T,
    propertyKey: K_2,
    value: V,
  ) => Replaced<T[K_2]>;

  export type ResolveType<T extends FunctionLike> =
    ReturnType<T> extends PromiseLike<infer U> ? U : never;

  export type Spied<T extends ClassLike | FunctionLike> = T extends ClassLike
    ? SpiedClass<T>
    : T extends FunctionLike
    ? SpiedFunction<T>
    : never;

  export type SpiedClass<T extends ClassLike = UnknownClass> = MockInstance<
    (...args: ConstructorParameters<T>) => InstanceType<T>
  >;

  export type SpiedFunction<T extends FunctionLike = UnknownFunction> =
    MockInstance<(...args: Parameters<T>) => ReturnType<T>>;

  export type SpiedGetter<T> = MockInstance<() => T>;

  export type SpiedSetter<T> = MockInstance<(arg: T) => void>;

  export interface SpyInstance<T extends FunctionLike = UnknownFunction>
    extends MockInstance<T> {}

  export const spyOn: {
    <
      T extends object,
      K_2 extends Exclude<
        keyof T,
        | keyof {
            [K in keyof T as Required<T>[K] extends ClassLike
              ? K
              : never]: T[K];
          }
        | keyof {
            [K_1 in keyof T as Required<T>[K_1] extends FunctionLike
              ? K_1
              : never]: T[K_1];
          }
      >,
      V extends Required<T>[K_2],
      A extends "set" | "get",
    >(
      object: T,
      methodKey: K_2,
      accessType: A,
    ): A extends "get"
      ? SpiedGetter<V>
      : A extends "set"
      ? SpiedSetter<V>
      : never;
    <
      T_1 extends object,
      K_5 extends
        | keyof {
            [K_3 in keyof T_1 as Required<T_1>[K_3] extends ClassLike
              ? K_3
              : never]: T_1[K_3];
          }
        | keyof {
            [K_4 in keyof T_1 as Required<T_1>[K_4] extends FunctionLike
              ? K_4
              : never]: T_1[K_4];
          },
      V_1 extends Required<T_1>[K_5],
    >(
      object: T_1,
      methodKey: K_5,
    ): V_1 extends ClassLike | FunctionLike ? Spied<V_1> : never;
  };

  export type UnknownClass = {
    new (...args: Array<unknown>): unknown;
  };

  export type UnknownFunction = (...args: Array<unknown>) => unknown;

  export {};
}
