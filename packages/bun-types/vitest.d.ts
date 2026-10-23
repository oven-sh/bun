// Do not include this file in ./index.d.ts
//
// Types for the "vitest" module that's built into `bun test`. They're for projects that have uninstalled the `vitest`
// package. If the package is still installed, this declaration overrides its types.
//
// Developers load this file with the following triple-slash directive:
//
// ```ts
// /// <reference types="bun-types/vitest" />
// ```

/// <reference path="./test.d.ts" />

/**
 * The `"vitest"` module built into `bun test`.
 *
 * Covers the parts of Vitest 5 that Bun implements. If a Vitest API isn't declared here, Bun doesn't implement it.
 */
declare module "vitest" {
  import type {
    AsymmetricMatchersBuiltin,
    MatcherResult as BunMatcherResult,
    TestContext as BunTestContext,
    vi as bunVi,
    CustomMatcher,
    Expect,
    FixtureOptions,
    MatchersBuiltin,
    TestSuite,
    TestTask,
  } from "bun:test";

  export type { SnapshotSerializer, TestAnnotation } from "bun:test";
  // @ts-ignore `bun test` imports these from the project's `chai`. They're `any` if chai's types aren't installed.
  export { assert, should } from "chai";
  export { test as it, describe as suite, vi as vitest };

  type Awaitable<T> = T | PromiseLike<T>;
  type Procedure = (...args: any[]) => any;
  interface Constructable {
    new (...args: any[]): any;
  }

  // The mock types below are equivalent to the ones in `@vitest/spy`.
  // Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors. MIT license.

  export interface MockResultReturn<T> {
    type: "return";
    value: T;
  }
  export interface MockResultIncomplete {
    /** The call hasn't returned yet. */
    type: "incomplete";
    value: undefined;
  }
  export interface MockResultThrow {
    type: "throw";
    /** The thrown value. */
    value: any;
  }
  export type MockResult<T> = MockResultReturn<T> | MockResultThrow | MockResultIncomplete;

  export interface MockSettledResultIncomplete {
    /** The returned promise is still pending. */
    type: "incomplete";
    value: undefined;
  }
  export interface MockSettledResultFulfilled<T> {
    type: "fulfilled";
    value: T;
  }
  export interface MockSettledResultRejected {
    type: "rejected";
    value: any;
  }
  export type MockSettledResult<T> =
    MockSettledResultFulfilled<T> | MockSettledResultRejected | MockSettledResultIncomplete;

  type MockParameters<T extends Procedure | Constructable> = T extends Constructable
    ? ConstructorParameters<T>
    : T extends Procedure
      ? Parameters<T>
      : never;
  type MockReturnType<T extends Procedure | Constructable> = T extends Constructable
    ? InstanceType<T>
    : T extends Procedure
      ? ReturnType<T>
      : never;
  type MockThis<T extends Procedure | Constructable> = T extends Constructable ? InstanceType<T> : ThisParameterType<T>;
  type MockImplementation<T extends Procedure | Constructable> = T extends Constructable
    ? | { new (...args: ConstructorParameters<T>): InstanceType<T> }
      | { (this: InstanceType<T>, ...args: ConstructorParameters<T>): void }
    : T extends Procedure
      ? (...args: Parameters<T>) => ReturnType<T>
      : never;

  /** The calls that a mock has recorded. */
  export interface MockContext<T extends Procedure | Constructable = Procedure> {
    /** Each call's arguments. */
    calls: MockParameters<T>[];
    /** Each call's `this` value. For a call with `new`, that's the new instance. */
    instances: MockThis<T>[];
    /** Each call's `this` value. */
    contexts: MockThis<T>[];
    /** Each call's position among all mock calls in the file, starting at 1. */
    invocationCallOrder: number[];
    /** Each call's return value or thrown error. */
    results: MockResult<MockReturnType<T>>[];
    /** The settled result of the promise that each call returned. */
    settledResults: MockSettledResult<Awaited<MockReturnType<T>>>[];
    /** The last call's arguments. */
    lastCall: MockParameters<T> | undefined;
  }

  /** A mock's methods. `vi.fn()` and `vi.spyOn()` return a {@link Mock}, which is also callable. */
  export interface MockInstance<T extends Procedure | Constructable = Procedure> extends Disposable {
    getMockName(): string;
    /** Sets the name shown for this mock in failure messages. */
    mockName(name: string): this;
    mock: MockContext<T>;
    /** Clears the recorded calls. */
    mockClear(): this;
    /**
     * Clears the recorded calls and resets the implementation to the original one. That's the function passed to
     * `vi.fn()`, or the method that `vi.spyOn()` replaced.
     */
    mockReset(): this;
    /** Like `mockReset()`. A `vi.spyOn()` spy also restores the original property on the object. */
    mockRestore(): void;
    getMockImplementation(): MockImplementation<T> | undefined;
    mockImplementation(fn: MockImplementation<T>): this;
    /** Uses `fn` for the next call only. If you queue several, they run in the order you added them. */
    mockImplementationOnce(fn: MockImplementation<T>): this;
    /** Uses `fn` as the implementation while `callback` runs, or until the promise it returns settles. */
    withImplementation(fn: MockImplementation<T>, callback: () => Promise<unknown>): Promise<void>;
    withImplementation(fn: MockImplementation<T>, callback: () => unknown): this;
    mockReturnThis(): this;
    mockReturnValue(value: MockReturnType<T>): this;
    mockReturnValueOnce(value: MockReturnType<T>): this;
    mockThrow(value: unknown): this;
    mockThrowOnce(value: unknown): this;
    mockResolvedValue(value: Awaited<MockReturnType<T>>): this;
    mockResolvedValueOnce(value: Awaited<MockReturnType<T>>): this;
    mockRejectedValue(error: unknown): this;
    mockRejectedValueOnce(error: unknown): this;
  }

  /** A mock function or class, as returned by `vi.fn()` and `vi.spyOn()`. */
  export type Mock<T extends Procedure | Constructable = Procedure> = MockInstance<T> &
    (T extends Constructable
      ? T extends Procedure
        ? { new (...args: ConstructorParameters<T>): InstanceType<T>; (...args: Parameters<T>): ReturnType<T> }
        : { new (...args: ConstructorParameters<T>): InstanceType<T> }
      : { new (...args: MockParameters<T>): MockReturnType<T>; (...args: MockParameters<T>): MockReturnType<T> }) & {
      [P in keyof T]: T[P];
    };

  type Methods<T> = keyof { [K in keyof T as T[K] extends Procedure ? K : never]: T[K] };
  type Properties<T> = { [K in keyof T]: T[K] extends Procedure ? never : K }[keyof T] & (string | symbol);
  type Classes<T> = { [K in keyof T]: T[K] extends new (...args: any[]) => any ? K : never }[keyof T] &
    (string | symbol);

  type PartialMaybePromise<T> = T extends Promise<Awaited<T>> ? Promise<Partial<Awaited<T>>> : Partial<T>;
  type DeepPartial<T> = T extends Procedure
    ? T
    : T extends Array<infer U>
      ? Array<DeepPartial<U>>
      : T extends object
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T;
  type DeepPartialMaybePromise<T> = T extends Promise<Awaited<T>> ? Promise<DeepPartial<Awaited<T>>> : DeepPartial<T>;
  type ImplementationOf<T> = T extends Mock ? NonNullable<ReturnType<T["getMockImplementation"]>> : T;
  type PartialMock<T extends Procedure | Constructable> = Mock<
    ImplementationOf<T> extends infer F
      ? F extends Constructable
        ? MockImplementation<F>
        : F extends Procedure
          ? (...args: Parameters<F>) => PartialMaybePromise<ReturnType<F>>
          : never
      : never
  >;
  type DeepPartialMock<T extends Procedure | Constructable> = Mock<
    ImplementationOf<T> extends infer F
      ? F extends Constructable
        ? MockImplementation<F>
        : F extends Procedure
          ? (...args: Parameters<F>) => DeepPartialMaybePromise<ReturnType<F>>
          : never
      : never
  >;

  type MaybeMockedConstructor<T> = T extends Constructable ? Mock<T> : T;
  /** A function typed as a {@link Mock}, with its own methods typed as mocks too. */
  export type MockedFunction<T extends Procedure | Constructable> = Mock<T> & MockedObject<T>;
  type PartiallyMockedFunction<T extends Procedure | Constructable> = PartialMock<T> & MockedObject<T>;
  type MockedFunctionDeep<T extends Procedure | Constructable> = Mock<T> & MockedObjectDeep<T>;
  type PartiallyMockedFunctionDeep<T extends Procedure | Constructable> = DeepPartialMock<T> & MockedObjectDeep<T>;
  /** An object with its methods typed as mocks. Nested objects keep their types. */
  export type MockedObject<T> = MaybeMockedConstructor<T> & {
    [K in Methods<T>]: T[K] extends Procedure ? MockedFunction<T[K]> : T[K];
  } & { [K in Properties<T>]: T[K] };
  type MockedObjectDeep<T> = MaybeMockedConstructor<T> & {
    [K in Methods<T>]: T[K] extends Procedure ? MockedFunctionDeep<T[K]> : T[K];
  } & { [K in Properties<T>]: MaybeMockedDeep<T[K]> };
  type MaybeMocked<T> = T extends Procedure | Constructable
    ? MockedFunction<T>
    : T extends object
      ? MockedObject<T>
      : T;
  type MaybeMockedDeep<T> = T extends Procedure | Constructable
    ? MockedFunctionDeep<T>
    : T extends object
      ? MockedObjectDeep<T>
      : T;
  type MaybePartiallyMocked<T> = T extends Procedure | Constructable
    ? PartiallyMockedFunction<T>
    : T extends object
      ? MockedObject<T>
      : T;
  type MaybePartiallyMockedDeep<T> = T extends Procedure | Constructable
    ? PartiallyMockedFunctionDeep<T>
    : T extends object
      ? MockedObjectDeep<T>
      : T;
  /** A class typed as a mock. Its prototype's methods are typed as mocks too. */
  export type MockedClass<T extends Constructable> = MockInstance<T> & {
    prototype: T extends { prototype: any } ? Mocked<T["prototype"]> : never;
  } & T;
  /** `T` with its methods and classes typed as mocks. It's still assignable to `T`. */
  export type Mocked<T> = {
    [P in keyof T]: T[P] extends Procedure ? MockInstance<T[P]> : T[P] extends Constructable ? MockedClass<T[P]> : T[P];
  } & T;

  type SpyOnValue<T extends object, K extends keyof any> = K extends keyof Required<T>
    ? Required<T>[K]
    : (T & Record<K, unknown>)[K];

  type SharedUtils = Omit<
    typeof bunVi,
    "fn" | "spyOn" | "mocked" | "isMockFunction" | "mockObject" | "importMock" | "stubEnv" | "setTimerTickMode"
  >;
  type ReturnsVitestUtils<F> = F extends (...args: infer Args) => infer Result
    ? 0 extends 1 & Awaited<Result> // `any` would match the two below
      ? F
      : Result extends typeof bunVi
        ? (...args: Args) => VitestUtils
        : Result extends Promise<typeof bunVi>
          ? (...args: Args) => Promise<VitestUtils>
          : F
    : F;
  type VitestSharedUtils = { [K in keyof SharedUtils]: ReturnsVitestUtils<SharedUtils[K]> };

  /** The type of {@link vi}. */
  export interface VitestUtils extends VitestSharedUtils {
    /**
     * Creates a mock function or class that runs `implementation` when called. Without an implementation, it returns
     * `undefined`.
     */
    fn<T extends Procedure | Constructable = Procedure>(implementation?: T): Mock<T>;
    /**
     * Replaces a method, getter or setter on `object` with a mock that still calls the original.
     *
     * @example
     * ```ts
     * const log = vi.spyOn(console, "log").mockImplementation(() => {});
     * ```
     */
    spyOn<T extends object, S extends Properties<Required<T>>>(object: T, key: S, accessor: "get"): Mock<() => T[S]>;
    spyOn<T extends object, G extends Properties<Required<T>>>(
      object: T,
      key: G,
      accessor: "set",
    ): Mock<(arg: T[G]) => void>;
    spyOn<T extends object, M extends Classes<Required<T>> | Methods<Required<T>>>(
      object: T,
      key: M,
    ): Required<T>[M] extends Constructable | Procedure ? Mock<Required<T>[M]> : never;
    spyOn<T extends object, K extends keyof any>(
      object: T,
      key: SpyOnValue<T, K> extends Constructable | Procedure ? K : never,
    ): Mock<SpyOnValue<T, K> extends Constructable | Procedure ? SpyOnValue<T, K> : never>;
    /**
     * Returns `item`, typed as mocked. It does nothing at run time.
     *
     * With `deep`, nested objects' methods are typed as mocks too. With `partial`, mocked return values can omit
     * properties.
     */
    mocked<T>(item: T, deep?: false): MaybeMocked<T>;
    mocked<T>(item: T, deep: true): MaybeMockedDeep<T>;
    mocked<T>(item: T, options: { partial?: false; deep?: false }): MaybeMocked<T>;
    mocked<T>(item: T, options: { partial?: false; deep: true }): MaybeMockedDeep<T>;
    mocked<T>(item: T, options: { partial: true; deep?: false }): MaybePartiallyMocked<T>;
    mocked<T>(item: T, options: { partial: true; deep: true }): MaybePartiallyMockedDeep<T>;
    // Repeated because `ReturnType<typeof vi.mocked>` uses the last overload.
    mocked<T>(item: T): MaybeMocked<T>;
    isMockFunction(fn: any): fn is Mock;
    /**
     * Deeply mocks `value`, the same way `vi.mock()` mocks a module when it has no factory. Returns a copy where
     * functions and classes are mocks that return `undefined` and arrays are empty. Primitives and builtin objects are
     * kept.
     *
     * With `{ spy: true }`, functions keep their implementation, arrays keep their elements, and objects are modified
     * in place instead of copied.
     */
    mockObject<T>(value: T, options?: { spy?: boolean | undefined }): MaybeMockedDeep<T>;
    /** Imports the mocked version of the module `id`, even if it isn't mocked. */
    importMock<T = Record<string, any>>(id: string): Promise<MaybeMockedDeep<T>>;
    /**
     * Sets `process.env[name]`, which is also `import.meta.env[name]`. The stub lasts until `vi.unstubAllEnvs()` or the
     * end of the test file. Passing `undefined` deletes the variable.
     */
    stubEnv<T extends string>(
      name: T,
      value: T extends "PROD" | "DEV" | "SSR" ? boolean | undefined : string | undefined,
    ): VitestUtils;
    /**
     * Chooses how the fake clock moves when the test doesn't move it.
     * - `manual`: it doesn't move. This is the default.
     * - `nextTimerAsync`: each turn of the real event loop runs the next timer.
     * - `interval`: it advances by `interval` milliseconds (default 20) every `interval` real milliseconds.
     */
    setTimerTickMode(mode: "manual" | "nextTimerAsync"): VitestUtils;
    setTimerTickMode(mode: "interval", interval?: number): VitestUtils;
  }

  /**
   * Mocks, fake timers and the other test utilities.
   */
  export const vi: VitestUtils;

  /**
   * Declare your custom matchers here. They're then typed on `expect()`, `.not`, `.resolves` and `.rejects`, and as
   * asymmetric matchers such as `expect.toBeWithinRange()`.
   *
   * @template R The matcher's return type: `void`, or `Promise<void>` after `.resolves`, `.rejects` and
   * `expect.poll()`.
   * @template T The type of the value passed to `expect()`.
   *
   * @example
   * ```ts
   * declare module "vitest" {
   *   interface Matchers<R, T> {
   *     toBeWithinRange(floor: number, ceiling: number): R;
   *   }
   * }
   * ```
   */
  export interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {}
  /** The built-in matchers. As in Vitest, expected values aren't checked against the type passed to `expect()`. */
  export interface JestAssertion<R extends void | Promise<void>, T = unknown> extends Omit<
    MatchersBuiltin<any, R>,
    "not" | "resolves" | "rejects" | "toHaveBeenCalledBefore" | "toHaveBeenCalledAfter"
  > {
    /** @alias toHaveReturned */
    toReturn(): R;
    /**
     * Ensure that a mock function's first call came before `mock`'s first call.
     * @param mock The mock function to compare with
     * @param failIfNoFirstInvocation Fail when the received mock function was never called. Defaults to `true`.
     */
    toHaveBeenCalledBefore(mock: MockInstance, failIfNoFirstInvocation?: boolean): R;
    /**
     * Ensure that a mock function's first call came after `mock`'s first call.
     * @param mock The mock function to compare with
     * @param failIfNoFirstInvocation Fail when `mock` was never called. Defaults to `true`.
     */
    toHaveBeenCalledAfter(mock: MockInstance, failIfNoFirstInvocation?: boolean): R;
  }
  /** The return type of `expect()`. */
  export interface Assertion<R extends void | Promise<void> = void, T = unknown>
    extends JestAssertion<R, T>, Matchers<R, T> {
    /** Negates the next matcher. */
    not: Assertion<R, T>;
    /**
     * Expects a promise that resolves, or a function that returns one. The next matcher checks the resolved value and
     * returns a promise.
     *
     * @example
     * ```ts
     * await expect(Promise.resolve(1)).resolves.toBe(1);
     * ```
     */
    resolves: Assertion<Promise<void>, Awaited<T extends (...args: any[]) => infer Returned ? Returned : T>>;
    /**
     * Expects a promise that rejects, or a function that returns one. The next matcher checks the rejection reason and
     * returns a promise.
     *
     * @example
     * ```ts
     * await expect(Promise.reject(new Error("no"))).rejects.toThrow("no");
     * ```
     */
    rejects: Assertion<Promise<void>, unknown>;
  }
  /** The asymmetric matchers, such as `expect.stringContaining()`. */
  export interface AsymmetricMatchersContaining extends Matchers<any>, AsymmetricMatchersBuiltin {}
  /** The type of {@link expect}. */
  export interface ExpectStatic
    extends
      Omit<Expect, "soft" | "poll" | "extend" | "not" | keyof AsymmetricMatchersBuiltin>,
      AsymmetricMatchersContaining {
    /**
     * @param actual the value to check
     * @param message printed before the failure if the matcher fails
     */
    <T>(actual: T, message?: string): Assertion<void, T>;
    /**
     * Like `expect()`, but doesn't throw when a matcher fails. The failure is reported, the test keeps running, and it's
     * marked as failed at the end.
     */
    soft<T>(actual: T, message?: string): Assertion<void, T>;
    /**
     * Calls `fn`, awaits its result and runs the matcher on it. Retries until the matcher passes. The matcher returns a
     * promise that rejects with the last failure once `timeout` is up.
     *
     * The wait uses the real clock, even with fake timers on. Each attempt advances the fake timers by `interval`.
     *
     * @example
     * ```ts
     * await expect.poll(() => queue.length, { interval: 10, timeout: 500 }).toBe(0);
     * ```
     */
    poll<T>(
      fn: () => T,
      options?: {
        /**
         * Milliseconds between attempts.
         * @default 50
         */
        interval?: number | undefined;
        /**
         * Milliseconds before the matcher gives up and fails.
         * @default 1000
         */
        timeout?: number | undefined;
        /** Printed before the failure if the matcher fails. */
        message?: string | undefined;
      },
    ): Omit<
      Assertion<Promise<void>, Awaited<T>>,
      | "resolves"
      | "rejects"
      | "toThrow"
      | "toThrowError"
      | "toMatchSnapshot"
      | "toMatchInlineSnapshot"
      | "toThrowErrorMatchingSnapshot"
      | "toThrowErrorMatchingInlineSnapshot"
    >;
    /**
     * Registers custom matchers. Declare their types in {@link Matchers}.
     *
     * @example
     * ```ts
     * expect.extend({
     *   toBeWithinRange(received: number, floor: number, ceiling: number) {
     *     return { pass: received >= floor && received <= ceiling, message: () => `${received} is out of range` };
     *   },
     * });
     * ```
     */
    extend(matchers: MatchersObject): void;
    /** Negated asymmetric matchers. For example, `expect.not.stringContaining("a")` matches a string without an "a". */
    not: AsymmetricMatchersContaining;
  }
  /** The `this` value inside a matcher passed to `expect.extend()`. */
  export type MatcherState = ThisParameterType<CustomMatcher<unknown, []>>;
  export type SyncMatcherResult = BunMatcherResult;
  export type AsyncMatcherResult = Promise<SyncMatcherResult>;
  export type MatcherResult = SyncMatcherResult | AsyncMatcherResult;
  /** A matcher passed to `expect.extend()`. */
  export interface Matcher<T extends MatcherState = MatcherState, E extends Array<any> = Array<any>> {
    (this: T, received: any, ...expected: E): MatcherResult;
  }
  /** The object passed to `expect.extend()`. */
  export type MatchersObject<T extends MatcherState = MatcherState> = Record<string, Matcher<T>> &
    ThisType<T> & { [K in keyof Matchers]?: Matcher<T, Parameters<Matchers[K]>> };

  /**
   * Wraps a value so you can check it with a matcher.
   *
   * @example
   * ```ts
   * expect(1 + 1).toBe(2);
   * ```
   */
  export const expect: ExpectStatic;
  export const expectTypeOf: typeof import("bun:test").expectTypeOf;
  export type ExpectTypeOf<Actual, Options extends { positive: boolean }> = import("./vendor/expect-type").ExpectTypeOf<
    Actual,
    Options
  >;
  export interface AssertType {
    <T>(value: T): void;
  }
  /** Fails to compile unless `value` is assignable to `T`. It does nothing at run time. */
  export const assertType: AssertType;

  /** Declare the properties your tests store in `task.meta` here. */
  export interface TaskMeta {}
  export type RunMode = "run" | "skip" | "only" | "todo";
  export type TaskState = RunMode | "pass" | "fail";
  /** A `describe()` block. */
  export interface RunnerTestSuite extends Omit<TestSuite, "meta" | "file" | "suite"> {
    /** `fullName` without the file name. Not set on a file. */
    fullTestName?: string;
    meta: TaskMeta;
    file: RunnerTestFile;
    /** The enclosing block. */
    suite?: RunnerTestSuite;
  }
  /** A test file. */
  export interface RunnerTestFile extends RunnerTestSuite {
    /** The file's absolute path. */
    filepath: string;
  }
  /** A test. */
  export interface RunnerTestCase<ExtraContext = object> extends Omit<TestTask, "meta" | "file" | "suite" | "context"> {
    meta: TaskMeta;
    file: RunnerTestFile;
    /** The enclosing `describe()` block. */
    suite?: RunnerTestSuite;
    context: TestContext & ExtraContext;
  }
  export type RunnerTask = RunnerTestCase | RunnerTestSuite | RunnerTestFile;

  export type OnTestFailedHandler = (context: TestContext) => Awaitable<void>;
  export type OnTestFinishedHandler = (context: TestContext) => Awaitable<void>;

  /**
   * The object passed to a test and to its `beforeEach()` and `afterEach()` hooks. Declare the properties your hooks
   * add to it here.
   */
  export interface TestContext extends Omit<BunTestContext, "task" | "expect" | "onTestFinished" | "onTestFailed"> {
    /** The current test. */
    readonly task: Readonly<RunnerTestCase>;
    /**
     * An `expect` bound to this test. Its `expect.assertions()`, `expect.hasAssertions()` and snapshots belong to this
     * test even when other tests run concurrently.
     */
    readonly expect: ExpectStatic;
    /** Runs `fn` after the test, its `afterEach` hooks and its fixture teardown. The last one registered runs first. */
    onTestFinished(fn: OnTestFinishedHandler, timeout?: number): void;
    /** Like `onTestFinished()`, but only runs if the test failed. */
    onTestFailed(fn: OnTestFailedHandler, timeout?: number): void;
  }

  export interface TestOptions {
    /** Timeout in milliseconds. */
    timeout?: number | undefined;
    /**
     * Number of times to rerun the test if it fails.
     * @default 0
     */
    retry?: number | { count?: number | undefined } | undefined;
    /**
     * Number of times to rerun the test regardless of the result.
     * @default 0
     */
    repeats?: number | undefined;
    /** Run the test in parallel with other concurrent tests. */
    concurrent?: boolean | undefined;
    /** Don't run the test in parallel, even in a concurrent block. */
    sequential?: boolean | undefined;
    skip?: boolean | undefined;
    /** Skip every test that isn't marked `only`. */
    only?: boolean | undefined;
    todo?: boolean | undefined;
    /** Invert the result, so the test passes only if it fails. */
    fails?: boolean | undefined;
  }
  export interface SuiteOptions extends TestOptions {
    /** Run the block's tests in a random order. */
    shuffle?: boolean | undefined;
  }

  export type TestFunction<ExtraContext = object> = (context: TestContext & ExtraContext) => Awaitable<any> | void;

  /** Passing a function or class uses its `name`. */
  type TaskName = string | Function;
  interface Register<Args extends any[], Options> {
    (name: TaskName, fn?: (...args: Args) => Awaitable<any> | void, timeout?: number): void;
    (name: TaskName, options: Options, fn?: (...args: Args) => Awaitable<any> | void): void;
  }
  type Writable<T extends ReadonlyArray<any>> = { -readonly [K in keyof T]: T[K] };
  interface Each<Options> {
    /** Registers one test or block per row. An array row is spread into the callback's arguments. */
    <T extends any[] | [any]>(rows: ReadonlyArray<T>): Register<T, Options>;
    <T extends ReadonlyArray<any>>(rows: ReadonlyArray<T>): Register<Writable<T>, Options>;
    <T>(rows: ReadonlyArray<T>): Register<T[], Options>;
    /** Tagged template form. The first line lists the column names, and the callback receives each row as an object. */
    (headings: TemplateStringsArray, ...values: any[]): Register<any[], Options>;
  }

  type FixtureFunction<T, K extends keyof T, Context> = (
    context: Omit<T, K> & Context,
    use: (value: T[K]) => Promise<void>,
  ) => Promise<void>;
  type Fixture<T, K extends keyof T, Context> = ((...args: any) => any) extends T[K]
    ? T[K] extends any
      ? FixtureFunction<T, K, Omit<Context, Exclude<keyof T, K>>>
      : never
    : T[K] | (T[K] extends any ? FixtureFunction<T, K, Omit<Context, Exclude<keyof T, K>>> : never);
  type Fixtures<T, ExtraContext = object> = {
    [K in keyof T]:
      Fixture<T, K, ExtraContext & TestContext> | [Fixture<T, K, ExtraContext & TestContext>, FixtureOptions?];
  };
  type Extended<ExtraContext, Added> = {
    [K in keyof Added | keyof ExtraContext]: K extends keyof Added
      ? Added[K]
      : K extends keyof ExtraContext
        ? ExtraContext[K]
        : never;
  };
  type FixtureValue<Value, ExtraContext> =
    | ((
        context: TestContext & ExtraContext,
        helpers: { onCleanup(fn: () => Awaitable<unknown>): void },
      ) => Awaitable<Value>)
    | Value;

  /**
   * Runs once before all tests in the enclosing `describe()` block, or in the file. If the callback returns a function,
   * that function runs after the `afterAll` hooks.
   */
  export function beforeAll<ExtraContext = object>(
    fn: (context: ExtraContext, suite: Readonly<RunnerTestSuite | RunnerTestFile>) => Awaitable<unknown>,
    timeout?: number,
  ): void;
  /** Runs once after all tests in the enclosing `describe()` block, or in the file. */
  export function afterAll<ExtraContext = object>(
    fn: (context: ExtraContext, suite: Readonly<RunnerTestSuite | RunnerTestFile>) => Awaitable<unknown>,
    timeout?: number,
  ): void;
  /** Runs before each test. If the callback returns a function, that function runs after the `afterEach` hooks. */
  export function beforeEach<ExtraContext = object>(
    fn: (context: TestContext & ExtraContext) => Awaitable<unknown>,
    timeout?: number,
  ): void;
  /** Runs after each test. */
  export function afterEach<ExtraContext = object>(
    fn: (context: TestContext & ExtraContext) => Awaitable<unknown>,
    timeout?: number,
  ): void;
  /** Wraps each test and its `beforeEach` and `afterEach` hooks. The callback must call `runTest()`. */
  export function aroundEach<ExtraContext = object>(
    fn: (
      runTest: () => Promise<void>,
      context: TestContext & ExtraContext,
      suite: Readonly<RunnerTestSuite>,
    ) => Awaitable<unknown>,
    timeout?: number,
  ): void;
  /** Wraps the enclosing `describe()` block, or the file. The callback must call `runSuite()`. */
  export function aroundAll<ExtraContext = object>(
    fn: (
      runSuite: () => Promise<void>,
      context: ExtraContext,
      suite: Readonly<RunnerTestSuite | RunnerTestFile>,
    ) => Awaitable<unknown>,
    timeout?: number,
  ): void;

  /** The type of {@link test} and of the `test` that `test.extend()` returns. */
  export interface TestAPI<ExtraContext = object> {
    <Context extends ExtraContext>(name: TaskName, fn?: TestFunction<Context>, timeout?: number): void;
    <Context extends ExtraContext>(name: TaskName, options: TestOptions, fn?: TestFunction<Context>): void;
    /** Skips every test that isn't marked `only`. */
    only: TestAPI<ExtraContext>;
    skip: TestAPI<ExtraContext>;
    /** Marks the test as not written yet. */
    todo: TestAPI<ExtraContext>;
    /** The test passes if any part of it fails: its callback, a hook, the timeout or `expect.assertions()`. */
    fails: TestAPI<ExtraContext>;
    /** Runs the test in parallel with other concurrent tests. */
    concurrent: TestAPI<ExtraContext>;
    /** Doesn't run the test in parallel, even in a concurrent block. */
    sequential: TestAPI<ExtraContext>;
    skipIf(condition: any): TestAPI<ExtraContext>;
    runIf(condition: any): TestAPI<ExtraContext>;
    each: Each<TestOptions>;
    /**
     * Like `each()`, but an array row is passed as one argument instead of being spread, and the second argument is the
     * {@link TestContext}.
     *
     * @example
     * ```ts
     * test.for([[1, 2, 3]])("%i + %i = %i", ([a, b, sum], { expect }) => {
     *   expect(a + b).toBe(sum);
     * });
     * ```
     */
    for<T>(rows: ReadonlyArray<T>): Register<[row: T, context: TestContext & ExtraContext], TestOptions>;
    for(
      headings: TemplateStringsArray,
      ...values: any[]
    ): Register<[row: any, context: TestContext & ExtraContext], TestOptions>;
    /**
     * Returns a `test` whose callbacks receive `fixtures` on the {@link TestContext}.
     *
     * A fixture is set up for the tests and hooks that destructure it, and torn down after the test.
     *
     * @example
     * ```ts
     * const test = base.extend<{ server: Server }>({
     *   server: async ({}, use) => {
     *     const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
     *     await use(server);
     *     await server.stop();
     *   },
     * });
     * ```
     */
    extend<Added extends Record<string, any> = object>(
      fixtures: Fixtures<Added, ExtraContext>,
    ): TestAPI<Extended<ExtraContext, Added>>;
    /** Adds one fixture. `value` is the fixture's value, or a function that returns it. */
    extend<Name extends string, Value>(
      name: Name,
      value: FixtureValue<Value, ExtraContext>,
    ): TestAPI<Extended<ExtraContext, Record<Name, Value>>>;
    extend<Name extends string, Value>(
      name: Name,
      options: FixtureOptions,
      value: FixtureValue<Value, ExtraContext>,
    ): TestAPI<Extended<ExtraContext, Record<Name, Value>>>;
    /**
     * Overrides fixtures for the tests in the enclosing `describe()` block, or for the whole file when called outside one.
     */
    override(fixtures: Partial<Fixtures<ExtraContext>>): this;
    /** @deprecated Use `override()`. */
    scoped(fixtures: Partial<Fixtures<ExtraContext>>): this;
    beforeAll: typeof beforeAll<ExtraContext>;
    afterAll: typeof afterAll<ExtraContext>;
    beforeEach: typeof beforeEach<ExtraContext>;
    afterEach: typeof afterEach<ExtraContext>;
    aroundEach: typeof aroundEach<ExtraContext>;
    aroundAll: typeof aroundAll<ExtraContext>;
    describe: SuiteAPI;
  }

  /** The type of {@link describe}. */
  export interface SuiteAPI extends Register<[], SuiteOptions> {
    only: SuiteAPI;
    skip: SuiteAPI;
    todo: SuiteAPI;
    /** Runs the block's tests in parallel. */
    concurrent: SuiteAPI;
    /** Runs the block's tests one at a time, even inside a concurrent block. */
    sequential: SuiteAPI;
    /** Runs the block's tests in a random order. */
    shuffle: SuiteAPI;
    skipIf(condition: any): SuiteAPI;
    runIf(condition: any): SuiteAPI;
    each: Each<SuiteOptions>;
    /** Like `each()`, but an array row is passed as one argument instead of being spread. */
    for<T>(rows: ReadonlyArray<T>): Register<[row: T], SuiteOptions>;
    for(headings: TemplateStringsArray, ...values: any[]): Register<[row: any], SuiteOptions>;
  }

  /**
   * Runs a test. The callback receives the {@link TestContext}. Without a callback, the test is marked as todo.
   *
   * @example
   * ```ts
   * test("adds", ({ expect }) => {
   *   expect(1 + 1).toBe(2);
   * });
   * ```
   */
  export const test: TestAPI;
  /** Groups tests into a block. */
  export const describe: SuiteAPI;

  /** Runs `fn` after the current test, its `afterEach` hooks and its fixture teardown. */
  export function onTestFinished(fn: OnTestFinishedHandler, timeout?: number): void;
  /** Like `onTestFinished()`, but only runs if the test failed. */
  export function onTestFailed(fn: OnTestFailedHandler, timeout?: number): void;

  export const TestRunner: {
    /** Returns the current test's `task`, or `undefined` outside a test. */
    getCurrentTest(): RunnerTestCase | undefined;
  };

  /** The values that {@link inject} can return. */
  export interface ProvidedContext {}
  /** Always returns `undefined`, because `bun test` has no `provide` option or global setup file. */
  export function inject<T extends keyof ProvidedContext & string>(key: T): ProvidedContext[T] | undefined;
}
