// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");

const kDefaultName = "<anonymous>";
const kDefaultFunction = () => {};
const kDefaultOptions = kEmptyObject;
const kDefaultFilePath = "";

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

function createDeferredCallback() {
  let calledCount = 0;
  let resolve: (value?: unknown) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const cb = (err?: unknown) => {
    calledCount++;

    // If the callback is called a second time, let the user know, but
    // don't let them know more than once.
    if (calledCount > 1) {
      if (calledCount === 2) {
        throw new Error("callback invoked multiple times");
      }
      return;
    }

    if (err) {
      return reject(err);
    }

    resolve();
  };

  return { promise, cb };
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

    // Check if the test function expects a done callback
    // fn.length >= 2 means it expects (context, done)
    if (fn.length >= 2) {
      // This test is using legacy Node.js error-first callbacks.
      const { promise, cb } = createDeferredCallback();

      let result: unknown;
      try {
        result = fn(context, cb);
      } catch (error) {
        endTest(error);
        return;
      }

      if (result instanceof Promise) {
        // Test returned a promise AND accepted a callback - this is an error
        endTest(new Error("passed a callback but also returned a Promise"));
        return;
      }

      // Wait for the callback to be called
      promise.then(() => endTest()).catch(error => endTest(error));
    } else {
      // This test is synchronous or using Promises.
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
    // Check if the hook function expects a done callback
    // fn.length >= 1 means it expects (done)
    if (fn.length >= 1) {
      // This hook is using legacy Node.js error-first callbacks.
      const { promise, cb } = createDeferredCallback();

      let result: unknown;
      try {
        result = fn(cb);
      } catch (error) {
        done(error);
        return;
      }

      if (result instanceof Promise) {
        // Hook returned a promise AND accepted a callback - this is an error
        done(new Error("passed a callback but also returned a Promise"));
        return;
      }

      // Wait for the callback to be called
      promise.then(() => done()).catch(error => done(error));
    } else {
      // This hook is synchronous or using Promises.
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
    }
  };

  return { options, fn: runHook };
}

type TestFn =
  | ((ctx: TestContext) => unknown | Promise<unknown>)
  | ((ctx: TestContext, done: (err?: unknown) => void) => void);
type HookFn = (() => unknown | Promise<unknown>) | ((done: (err?: unknown) => void) => void);

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
