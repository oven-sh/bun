// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");
const { validateBoolean, validateInteger, validateObject } = require("internal/validators");

const kDefaultName = "<anonymous>";
const kDefaultFunction = () => {};
const kDefaultOptions = kEmptyObject;

function run() {
  throwNotImplemented("run()", 5090, "Use `bun:test` in the interim.");
}

// https://nodejs.org/api/test.html#class-mocktracker
class MockFunctionContext {
  #calls: unknown[];
  #implementation: Function | undefined;
  #original: Function;
  #onceImplementations: Map<number, Function>;
  #restore: (() => void) | undefined;
  #times: number;

  constructor(
    original: Function,
    implementation: Function | undefined,
    restore?: () => void,
    times: number = Infinity,
  ) {
    this.#calls = [];
    this.#original = original;
    this.#implementation = implementation;
    this.#onceImplementations = new Map();
    this.#restore = restore;
    this.#times = times;
  }

  get calls() {
    return Array.from(this.#calls);
  }

  callCount(): number {
    return this.#calls.length;
  }

  mockImplementation(implementation: Function) {
    if (!$isCallable(implementation)) {
      throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
    }
    this.#implementation = implementation;
  }

  mockImplementationOnce(implementation: Function, onCall?: number) {
    if (!$isCallable(implementation)) {
      throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
    }
    // node validates the call index: an integer no earlier than the next call
    const nextCall = this.#calls.length;
    const call = onCall ?? nextCall;
    validateInteger(call, "onCall", nextCall);
    this.#onceImplementations.set(call, implementation);
  }

  resetCalls() {
    this.#calls = [];
  }

  restore() {
    this.#implementation = undefined;
    this.#onceImplementations.clear();
    const restore = this.#restore;
    this.#restore = undefined;
    restore?.();
  }

  static {
    trackMockCall = (ctx: MockFunctionContext, thisArg: unknown, args: unknown[], target: unknown) => {
      const callIndex = ctx.#calls.length;
      let implementation = ctx.#onceImplementations.get(callIndex);
      if (implementation !== undefined) {
        ctx.#onceImplementations.delete(callIndex);
      } else {
        implementation = ctx.#implementation ?? ctx.#original;
      }
      // options.times: revert to the original behavior once the mock has
      // been used `times` times (node decides this before invoking, so the
      // current call still uses the mocked implementation).
      if (callIndex + 1 === ctx.#times) {
        ctx.restore();
      }
      const call: Record<string, unknown> = {
        arguments: args,
        error: undefined,
        result: undefined,
        stack: new Error(),
        target,
        this: thisArg,
      };
      ctx.#calls.push(call);
      try {
        const result =
          target === undefined
            ? (implementation as Function).$apply(thisArg, args)
            : Reflect.construct(implementation as Function, args, target as Function);
        call.result = result;
        return result;
      } catch (error) {
        call.error = error;
        throw error;
      }
    };
  }
}

let trackMockCall: (ctx: MockFunctionContext, thisArg: unknown, args: unknown[], target: unknown) => unknown;

function createMockFunction(
  original: Function,
  implementation: Function | undefined,
  restore?: () => void,
  times: number = Infinity,
) {
  const context = new MockFunctionContext(original, implementation, restore, times);
  kMockContexts.push(context);
  function mockFunction(this: unknown, ...args: unknown[]) {
    return trackMockCall(context, this, args, new.target);
  }
  Object.defineProperty(mockFunction, "mock", {
    value: context,
    writable: false,
    enumerable: false,
  });
  Object.defineProperty(mockFunction, "length", {
    value: original.length,
    configurable: true,
  });
  Object.defineProperty(mockFunction, "name", {
    value: original.name,
    configurable: true,
  });
  return mockFunction;
}

const kMockContexts: MockFunctionContext[] = [];

function validateTimes(value: unknown, name: string) {
  if (value === Infinity) {
    return;
  }
  validateInteger(value, name, 1);
}

function mockFn(original?: Function | object, implementation?: Function | object, options?: object) {
  if (original !== null && original !== undefined && !$isCallable(original) && typeof original === "object") {
    options = implementation as object;
    implementation = original;
    original = undefined;
  }
  if (
    implementation !== null &&
    implementation !== undefined &&
    !$isCallable(implementation) &&
    typeof implementation === "object"
  ) {
    options = implementation as object;
    implementation = undefined;
  }
  if (original !== undefined && !$isCallable(original)) {
    throw $ERR_INVALID_ARG_TYPE("original", "function", original);
  }
  if (implementation !== undefined && !$isCallable(implementation)) {
    throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
  }
  if (options !== undefined) {
    validateObject(options, "options");
  }
  const { times = Infinity } = (options ?? kEmptyObject) as { times?: number };
  validateTimes(times, "options.times");
  return createMockFunction(
    (original as Function) ?? function () {},
    implementation as Function | undefined,
    undefined,
    times,
  );
}

function mockMethod(
  objectOrFunction: object | Function,
  methodName: PropertyKey,
  implementation?: Function | object,
  options?: { getter?: boolean; setter?: boolean } | object,
) {
  if (
    implementation !== null &&
    implementation !== undefined &&
    !$isCallable(implementation) &&
    typeof implementation === "object"
  ) {
    options = implementation;
    implementation = undefined;
  }
  if (implementation !== undefined && !$isCallable(implementation)) {
    throw $ERR_INVALID_ARG_TYPE("implementation", "function", implementation);
  }
  if ((typeof objectOrFunction !== "object" || objectOrFunction === null) && !$isCallable(objectOrFunction)) {
    throw $ERR_INVALID_ARG_TYPE("object", "object", objectOrFunction);
  }
  const {
    getter = false,
    setter = false,
    times = Infinity,
  } = (options ?? kEmptyObject) as {
    getter?: boolean;
    setter?: boolean;
    times?: number;
  };
  validateBoolean(getter, "options.getter");
  validateBoolean(setter, "options.setter");
  validateTimes(times, "options.times");
  if (setter && getter) {
    throw $ERR_INVALID_ARG_VALUE("options.setter", setter, "cannot be used with 'options.getter'");
  }

  // Find the descriptor on the object or its prototype chain.
  let target: object | null = objectOrFunction;
  let descriptor: PropertyDescriptor | undefined;
  while (target !== null) {
    descriptor = Object.getOwnPropertyDescriptor(target, methodName);
    if (descriptor !== undefined) break;
    target = Object.getPrototypeOf(target);
  }
  if (descriptor === undefined) {
    throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a method");
  }

  let original: Function;
  if (getter) {
    if (!$isCallable(descriptor.get)) {
      throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a getter");
    }
    original = descriptor.get;
  } else if (setter) {
    if (!$isCallable(descriptor.set)) {
      throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a setter");
    }
    original = descriptor.set;
  } else {
    if (!$isCallable(descriptor.value)) {
      throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a method");
    }
    original = descriptor.value;
  }

  const restore = () => {
    Object.defineProperty(objectOrFunction, methodName, descriptor!);
  };
  const mocked = createMockFunction(original, implementation as Function | undefined, restore, times);

  const mockDescriptor: PropertyDescriptor = {
    configurable: true,
    enumerable: descriptor.enumerable,
  };
  if (getter || setter) {
    if (getter) {
      mockDescriptor.get = mocked;
      mockDescriptor.set = descriptor.set;
    } else {
      mockDescriptor.get = descriptor.get;
      mockDescriptor.set = mocked;
    }
  } else {
    mockDescriptor.value = mocked;
    mockDescriptor.writable = descriptor.writable;
  }
  Object.defineProperty(objectOrFunction, methodName, mockDescriptor);
  return mocked;
}

const mock = {
  fn: mockFn,
  method: mockMethod,
  getter(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: object,
  ) {
    // Shift implementation -> options *before* spreading, or the shift inside
    // mockMethod would clobber the getter flag (node does the same).
    if (
      implementation !== null &&
      implementation !== undefined &&
      !$isCallable(implementation) &&
      typeof implementation === "object"
    ) {
      options = implementation;
      implementation = undefined;
    }
    const { getter = true } = (options ?? kEmptyObject) as { getter?: boolean };
    if (getter === false) {
      throw $ERR_INVALID_ARG_VALUE("options.getter", getter, "cannot be false");
    }
    return mockMethod(objectOrFunction, methodName, implementation as Function | undefined, {
      ...options,
      getter,
    });
  },
  setter(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: object,
  ) {
    if (
      implementation !== null &&
      implementation !== undefined &&
      !$isCallable(implementation) &&
      typeof implementation === "object"
    ) {
      options = implementation;
      implementation = undefined;
    }
    const { setter = true } = (options ?? kEmptyObject) as { setter?: boolean };
    if (setter === false) {
      throw $ERR_INVALID_ARG_VALUE("options.setter", setter, "cannot be false");
    }
    return mockMethod(objectOrFunction, methodName, implementation as Function | undefined, {
      ...options,
      setter,
    });
  },
  reset() {
    mock.restoreAll();
  },
  restoreAll() {
    // Restores method mocks to their original descriptor and makes bare
    // mock.fn() mocks call their original function again, like node.
    for (const ctx of kMockContexts) ctx.restore();
    kMockContexts.length = 0;
  },
  module() {
    throwNotImplemented("mock.module()", 5090, "Use `bun:test` in the interim.");
  },
};

function fileSnapshot(_value: unknown, _path: string, _options: { serializers?: Function[] } = kEmptyObject) {
  throwNotImplemented("fileSnapshot()", 5090, "Use `bun:test` in the interim.");
}

function snapshot(_value: unknown, _options: { serializers?: Function[] } = kEmptyObject) {
  throwNotImplemented("snapshot()", 5090, "Use `bun:test` in the interim.");
}

const assert = {
  ...require("node:assert"),
  fileSnapshot,
  snapshot,
  // register,
};

// Delete deprecated methods on assert (required to pass node's tests)
delete assert.AssertionError;
delete assert.CallTracker;
delete assert.strict;

let checkNotInsideTest: (ctx: TestContext | undefined, fn: string) => void;

/**
 * @link https://nodejs.org/api/test.html#class-testcontext
 */
class TestContext {
  #insideTest: boolean;
  #name: string | undefined;
  #filePath: string | undefined;
  #parent?: TestContext;
  #abortController?: AbortController;

  constructor(
    insideTest: boolean,
    name: string | undefined,
    filePath: string | undefined,
    parent: TestContext | undefined,
  ) {
    this.#insideTest = insideTest;
    this.#name = name;
    this.#filePath = filePath || parent?.filePath || kDefaultFilePath;
    this.#parent = parent;
  }

  get signal(): AbortSignal {
    if (this.#abortController === undefined) {
      this.#abortController = new AbortController();
    }
    return this.#abortController.signal;
  }

  get name(): string {
    return this.#name!;
  }

  get fullName(): string {
    let fullName = this.#name;
    let parent = this.#parent;
    while (parent && parent.name) {
      fullName = `${parent.name} > ${fullName}`;
      parent = parent.#parent;
    }
    return fullName!;
  }

  get filePath(): string {
    return this.#filePath!;
  }

  diagnostic(message: string) {
    console.log(message);
  }

  plan(_count: number, _options: { wait?: boolean } = kEmptyObject) {
    throwNotImplemented("plan()", 5090, "Use `bun:test` in the interim.");
  }

  get assert() {
    return assert;
  }

  get mock() {
    throwNotImplemented("mock", 5090, "Use `bun:test` in the interim.");
    return undefined;
  }

  runOnly(_value?: boolean) {
    throwNotImplemented("runOnly()", 5090, "Use `bun:test` in the interim.");
  }

  skip(_message?: string) {
    throwNotImplemented("skip()", 5090, "Use `bun:test` in the interim.");
  }

  todo(_message?: string) {
    throwNotImplemented("todo()", 5090, "Use `bun:test` in the interim.");
  }

  before(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { beforeAll } = bunTest();
    beforeAll(fn);
  }

  after(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { afterAll } = bunTest();
    afterAll(fn);
  }

  beforeEach(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { beforeEach } = bunTest();
    beforeEach(fn);
  }

  afterEach(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { afterEach } = bunTest();
    afterEach(fn);
  }

  waitFor(_condition: unknown, _options: { timeout?: number } = kEmptyObject) {
    throwNotImplemented("waitFor()", 5090, "Use `bun:test` in the interim.");
  }

  test(arg0: unknown, arg1: unknown, arg2: unknown) {
    const { name, fn, options } = createTest(arg0, arg1, arg2);

    this.#checkNotInsideTest("test");

    const { test } = bunTest();
    if (options.only) {
      test.only(name, fn);
    } else if (options.todo) {
      test.todo(name, fn);
    } else if (options.skip) {
      test.skip(name, fn);
    } else {
      test(name, fn);
    }
  }

  describe(arg0: unknown, arg1: unknown, arg2: unknown) {
    const { name, fn } = createDescribe(arg0, arg1, arg2);

    this.#checkNotInsideTest("describe");

    const { describe } = bunTest();
    describe(name, fn);
  }

  #checkNotInsideTest(fn: string) {
    if (this.#insideTest) {
      throwNotImplemented(`${fn}() inside another test()`, 5090, "Use `bun:test` in the interim.");
    }
  }

  static {
    // expose this function to the rest of this file without exposing it to user JS
    checkNotInsideTest = (ctx: TestContext | undefined, fn: string) => {
      if (ctx) ctx.#checkNotInsideTest(fn);
    };
  }
}

function bunTest() {
  return jest(Bun.main);
}

let ctx: TestContext | undefined = undefined;

function describe(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest();
  describe(name, fn);
}

describe.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest();
  describe.skip(name, fn);
};

describe.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest();
  describe.todo(name, fn);
};

describe.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest();
  describe.only(name, fn);
};

function test(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest();
  // Node's {only: true} is intentionally not routed to test.only() here:
  // in Node it is a no-op unless --test-only is passed, whereas bun:test's
  // test.only() unconditionally skips siblings.
  if (options.todo) {
    test.todo(name, fn, options);
  } else if (options.skip) {
    test.skip(name, fn, options);
  } else {
    test(name, fn, options);
  }
}

test.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest();
  test.skip(name, fn, options);
};

test.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest();
  test.todo(name, fn, options);
};

test.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest();
  test.only(name, fn, options);
};

function before(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { beforeAll } = bunTest();
  beforeAll(fn);
}

function after(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { afterAll } = bunTest();
  afterAll(fn);
}

function beforeEach(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { beforeEach } = bunTest();
  beforeEach(fn);
}

function afterEach(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { afterEach } = bunTest();
  afterEach(fn);
}

function parseTestOptions(arg0: unknown, arg1: unknown, arg2: unknown) {
  let name: string;
  let options: unknown;
  let fn: TestFn;

  if (typeof arg0 === "function") {
    name = arg0.name || kDefaultName;
    fn = arg0 as TestFn;
    if (typeof arg1 === "object") {
      options = (arg1 ?? kDefaultOptions) as TestOptions;
    } else {
      options = kDefaultOptions;
    }
  } else if (typeof arg0 === "string") {
    name = arg0;
    if (typeof arg1 === "object") {
      options = (arg1 ?? kDefaultOptions) as TestOptions;
      if (typeof arg2 === "function") {
        fn = arg2 as TestFn;
      } else {
        fn = kDefaultFunction;
      }
    } else if (typeof arg1 === "function") {
      fn = arg1 as TestFn;
      options = kDefaultOptions;
    } else {
      fn = kDefaultFunction;
      options = kDefaultOptions;
    }
  } else {
    name = kDefaultName;
    fn = kDefaultFunction;
    options = kDefaultOptions;
  }

  return { name, options: options as TestOptions, fn };
}

function createTest(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, options, fn } = parseTestOptions(arg0, arg1, arg2);

  checkNotInsideTest(ctx, "test");
  const context = new TestContext(true, name, Bun.main, ctx);

  const runTest = (done: (error?: unknown) => void) => {
    const originalContext = ctx;
    ctx = context;
    const endTest = (error?: unknown) => {
      try {
        done(error);
      } finally {
        ctx = originalContext;
      }
    };

    let result: unknown;
    try {
      result = fn(context);
    } catch (error) {
      endTest(error);
      return;
    }
    if (result instanceof Promise) {
      (result as Promise<unknown>).then(() => endTest()).catch(error => endTest(error));
    } else {
      endTest();
    }
  };

  return { name, options, fn: runTest };
}

function createDescribe(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = parseTestOptions(arg0, arg1, arg2);

  checkNotInsideTest(ctx, "describe");
  const context = new TestContext(false, name, Bun.main, ctx);

  const runDescribe = () => {
    const originalContext = ctx;
    ctx = context;
    const endDescribe = () => {
      ctx = originalContext;
    };

    try {
      return fn(context);
    } finally {
      endDescribe();
    }
  };

  return { name, options, fn: runDescribe };
}

function parseHookOptions(arg0: unknown, arg1: unknown) {
  let fn: HookFn | undefined;
  let options: HookOptions;

  if (typeof arg0 === "function") {
    fn = arg0 as HookFn;
  } else {
    fn = kDefaultFunction;
  }

  if (typeof arg1 === "object") {
    options = arg1 as HookOptions;
  } else {
    options = kDefaultOptions;
  }

  return { fn, options };
}

function createHook(arg0: unknown, arg1: unknown) {
  const { fn, options } = parseHookOptions(arg0, arg1);

  const runHook = (done: (error?: unknown) => void) => {
    let result: unknown;
    try {
      result = fn();
    } catch (error) {
      done(error);
      return;
    }
    if (result instanceof Promise) {
      (result as Promise<unknown>).then(() => done()).catch(error => done(error));
    } else {
      done();
    }
  };

  return { options, fn: runHook };
}

type TestFn = (ctx: TestContext) => unknown | Promise<unknown>;
type HookFn = () => unknown | Promise<unknown>;

type TestOptions = {
  concurrency?: number | boolean | null;
  only?: boolean;
  signal?: AbortSignal;
  skip?: boolean | string;
  todo?: boolean | string;
  timeout?: number;
  plan?: number;
};

type HookOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

function setDefaultSnapshotSerializer(_serializers: unknown[]) {
  throwNotImplemented("setDefaultSnapshotSerializer()", 5090, "Use `bun:test` in the interim.");
}

function setResolveSnapshotPath(_fn: unknown) {
  throwNotImplemented("setResolveSnapshotPath()", 5090, "Use `bun:test` in the interim.");
}

test.describe = describe;
test.suite = describe;
test.test = test;
test.it = test;
test.before = before;
test.after = after;
test.beforeEach = beforeEach;
test.afterEach = afterEach;
test.assert = assert;
test.snapshot = {
  setDefaultSnapshotSerializer,
  setResolveSnapshotPath,
};
test.run = run;
test.mock = mock;

export default test;
