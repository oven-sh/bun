export type Fn = (assert: Assert) => Promise<void> | void;
export type TestFn = (name: string, fn?: Fn) => void;
export type EachFn = (assert: Assert, value: unknown) => Promise<void> | void;
export type TestEachFn = (name: string, data: DataInit, fn?: EachFn) => void;
export type TestOrEachFn = TestFn & { each: TestEachFn };
export type ModuleFn = (name: string, hooks?: Hooks | HooksFn, fn?: HooksFn) => void;

/**
 * @link https://api.qunitjs.com/
 */
export type QUnit = {
  start(): void;
  config: {
    [key: string]: unknown;
  };
  test: TestOrEachFn & {
    skip: TestOrEachFn;
    todo: TestOrEachFn;
    only: TestOrEachFn;
  };
  skip: TestFn;
  todo: TestFn;
  only: TestFn;
  module: ModuleFn & {
    skip: ModuleFn;
    todo: ModuleFn;
    only: ModuleFn;
  };
  hooks: {
    beforeEach(fn: Fn): void;
    afterEach(fn: Fn): void;
  };
  assert: Assert;
  begin(fn: UnknownFn): void;
  done(fn: UnknownFn): void;
  log(fn: UnknownFn): void;
  moduleDone(fn: UnknownFn): void;
  moduleStart(fn: UnknownFn): void;
  on(fn: UnknownFn): void;
  testDone(fn: UnknownFn): void;
  testStart(fn: UnknownFn): void;
  extend(target: unknown, mixin: unknown): unknown;
  push(result: ResultInit): void;
  stack(offset?: number): string;
  onUncaughtException(fn: ErrorFn): void;
  equiv(a: unknown, b: unknown): boolean;
  dump: {
    maxDepth: number;
    parse(value: unknown): string;
  };
};

/**
 * @link https://api.qunitjs.com/QUnit/module/#options-object
 */
export type Hooks = {
  before?: Fn;
  beforeEach?: Fn;
  after?: Fn;
  afterEach?: Fn;
};

export type NestedHooks = {
  before: (fn: Fn) => void;
  beforeEach: (fn: Fn) => void;
  after: (fn: Fn) => void;
  afterEach: (fn: Fn) => void;
};

export type HooksFn = (hooks: NestedHooks) => void;

/**
 * @link https://api.qunitjs.com/assert/
 */
export type Assert = {
  async(count?: number): EmptyFn;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  expect(count: number): void;
  false(actual: unknown, message?: string): void;
  notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  notOk(actual: unknown, message?: string): void;
  notPropContains(actual: unknown, prop: string, expected: unknown, message?: string): void;
  notPropEqual(actual: unknown, prop: string, expected: unknown, message?: string): void;
  notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
  ok(actual: unknown, message?: string): void;
  propContains(actual: unknown, prop: string, expected: unknown, message?: string): void;
  propEqual(actual: unknown, prop: string, expected: unknown, message?: string): void;
  pushResult(result: ResultInit): void;
  rejects(promise: Promise<unknown>, expected?: ErrorInit, message?: string): Promise<void>;
  step(message: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
  throws(fn: () => unknown, expected?: ErrorInit, message?: string): void;
  timeout(ms: number): void;
  true(actual: unknown, message?: string): void;
  verifySteps(steps: string[], message?: string): void;
};

export type ResultInit = {
  result: boolean;
  actual: unknown;
  expected: unknown;
  message?: string;
};

export type DataInit = unknown[] | Record<string, unknown>;

export type ErrorInit = Error | string | RegExp | ErrorConstructor;

export type EmptyFn = () => void;

export type ErrorFn = (error?: unknown) => void;

export type UnknownFn = (...args: unknown[]) => unknown;
