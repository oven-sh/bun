// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");

const kDefaultName = "<anonymous>";
const kDefaultFunction = () => {};
const kDefaultOptions = kEmptyObject;
const kDefaultFilePath = undefined;

function run() {
  throwNotImplemented("run()", 5090, "Use `bun:test` in the interim.");
}

function mock() {
  throwNotImplemented("mock()", 5090, "Use `bun:test` in the interim.");
}

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
let getTestContextHooks: (ctx: TestContext) => {
  beforeHooks: Array<() => unknown | Promise<unknown>>;
  afterHooks: Array<() => unknown | Promise<unknown>>;
  beforeEachHooks: Array<() => unknown | Promise<unknown>>;
  afterEachHooks: Array<() => unknown | Promise<unknown>>;
  runHooks: (hooks: Array<() => unknown | Promise<unknown>>) => Promise<void>;
};

/**
 * @link https://nodejs.org/api/test.html#class-testcontext
 */
class TestContext {
  #insideTest: boolean;
  #name: string | undefined;
  #filePath: string | undefined;
  #parent?: TestContext;
  #abortController?: AbortController;
  #afterHooks: Array<() => unknown | Promise<unknown>> = [];
  #beforeHooks: Array<() => unknown | Promise<unknown>> = [];
  #beforeEachHooks: Array<() => unknown | Promise<unknown>> = [];
  #afterEachHooks: Array<() => unknown | Promise<unknown>> = [];

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
    const { fn, fnInsideTest } = createHook(arg0, arg1);
    if (this.#insideTest) {
      // When called inside a test, store the hook to run at the appropriate time
      this.#beforeHooks.push(fnInsideTest);
    } else {
      const { beforeAll } = bunTest();
      beforeAll(fn);
    }
  }

  after(arg0: unknown, arg1: unknown) {
    const { fn, fnInsideTest } = createHook(arg0, arg1);
    if (this.#insideTest) {
      // When called inside a test, store the hook to run at the end of the test
      this.#afterHooks.push(fnInsideTest);
    } else {
      const { afterAll } = bunTest();
      afterAll(fn);
    }
  }

  beforeEach(arg0: unknown, arg1: unknown) {
    const { fn, fnInsideTest } = createHook(arg0, arg1);
    if (this.#insideTest) {
      // When called inside a test, store the hook to run for each subtest
      this.#beforeEachHooks.push(fnInsideTest);
    } else {
      const { beforeEach } = bunTest();
      beforeEach(fn);
    }
  }

  afterEach(arg0: unknown, arg1: unknown) {
    const { fn, fnInsideTest } = createHook(arg0, arg1);
    if (this.#insideTest) {
      // When called inside a test, store the hook to run after each subtest
      this.#afterEachHooks.push(fnInsideTest);
    } else {
      const { afterEach } = bunTest();
      afterEach(fn);
    }
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

  async #runHooks(hooks: Array<() => unknown | Promise<unknown>>) {
    for (const hook of hooks) {
      const result = hook();
      if (result instanceof Promise) {
        await result;
      }
    }
  }

  #checkNotInsideTest(fn: string) {
    if (this.#insideTest) {
      throwNotImplemented(`${fn}() inside another test()`, 5090, "Use `bun:test` in the interim.");
    }
  }

  static {
    // expose these functions to the rest of this file without exposing them to user JS
    checkNotInsideTest = (ctx: TestContext | undefined, fn: string) => {
      if (ctx) ctx.#checkNotInsideTest(fn);
    };

    getTestContextHooks = (ctx: TestContext) => {
      return {
        beforeHooks: ctx.#beforeHooks,
        afterHooks: ctx.#afterHooks,
        beforeEachHooks: ctx.#beforeEachHooks,
        afterEachHooks: ctx.#afterEachHooks,
        runHooks: (hooks: Array<() => unknown | Promise<unknown>>) => ctx.#runHooks(hooks),
      };
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
  test(name, fn, options);
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
      options = arg1 as TestOptions;
    } else {
      options = kDefaultOptions;
    }
  } else if (typeof arg0 === "string") {
    name = arg0;
    if (typeof arg1 === "object") {
      options = arg1 as TestOptions;
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

  const runTest = async (done: (error?: unknown) => void) => {
    const originalContext = ctx;
    ctx = context;
    const hooks = getTestContextHooks(context);

    const endTest = async (error?: unknown) => {
      try {
        // Run after hooks before ending the test
        if (!error && hooks.afterHooks.length > 0) {
          try {
            await hooks.runHooks(hooks.afterHooks);
          } catch (hookError) {
            done(hookError);
            return;
          }
        }
        done(error);
      } finally {
        ctx = originalContext;
      }
    };

    let result: unknown;
    try {
      // Run before hooks before running the test
      if (hooks.beforeHooks.length > 0) {
        await hooks.runHooks(hooks.beforeHooks);
      }
      result = fn(context);
    } catch (error) {
      await endTest(error);
      return;
    }
    if (result instanceof Promise) {
      (result as Promise<unknown>).then(() => endTest()).catch(error => endTest(error));
    } else {
      await endTest();
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

  // When used inside a test context, we don't have done callback
  const runHookInsideTest = async () => {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
  };

  // When used at module level, we have done callback
  const runHookWithDone = (done: (error?: unknown) => void) => {
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

  return { options, fn: runHookWithDone, fnInsideTest: runHookInsideTest };
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
