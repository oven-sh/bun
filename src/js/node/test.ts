// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");

const kDefaultName = "<anonymous>";
const kDefaultFunction = () => {};
const kDefaultOptions = kEmptyObject;

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

/**
 * @link https://nodejs.org/api/test.html#class-suitecontext
 */
class SuiteContext {
  #name: string | undefined;
  #filePath: string | undefined;
  #abortController?: AbortController;

  constructor(name: string | undefined, filePath: string | undefined) {
    this.#name = name;
    this.#filePath = filePath || Bun.main;
  }

  get name(): string {
    return this.#name!;
  }

  get filePath(): string {
    return this.#filePath!;
  }

  get signal(): AbortSignal {
    if (this.#abortController === undefined) {
      this.#abortController = new AbortController();
    }
    return this.#abortController.signal;
  }
}

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
    const { beforeAll } = bunTest(this);
    beforeAll(fn);
  }

  after(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { afterAll } = bunTest(this);
    afterAll(fn);
  }

  beforeEach(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { beforeEach } = bunTest(this);
    beforeEach(fn);
  }

  afterEach(arg0: unknown, arg1: unknown) {
    const { fn } = createHook(arg0, arg1);
    const { afterEach } = bunTest(this);
    afterEach(fn);
  }

  waitFor(_condition: unknown, _options: { timeout?: number } = kEmptyObject) {
    throwNotImplemented("waitFor()", 5090, "Use `bun:test` in the interim.");
  }

  test(arg0: unknown, arg1: unknown, arg2: unknown) {
    const { name, fn, options } = createTest(arg0, arg1, arg2);

    if (this.#insideTest) {
      throwNotImplemented("test() inside another test()", 5090, "Use `bun:test` in the interim.");
    }

    const { test } = bunTest(this);
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

    if (this.#insideTest) {
      throwNotImplemented("describe() inside another test()", 5090, "Use `bun:test` in the interim.");
    }

    const { describe } = bunTest(this);
    describe(name, fn);
  }
}

function bunTest(ctx: SuiteContext | TestContext) {
  return jest(ctx.filePath);
}

let ctx = new TestContext(false, undefined, Bun.main, undefined);

function describe(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest(ctx);
  describe(name, fn);
}

describe.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest(ctx);
  describe.skip(name, fn);
};

describe.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest(ctx);
  describe.todo(name, fn);
};

describe.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe } = bunTest(ctx);
  describe.only(name, fn);
};

function test(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest(ctx);
  test(name, fn, options);
}

test.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest(ctx);
  test.skip(name, fn, options);
};

test.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest(ctx);
  test.todo(name, fn, options);
};

test.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test } = bunTest(ctx);
  test.only(name, fn, options);
};

function before(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { beforeAll } = bunTest(ctx);
  beforeAll(fn);
}

function after(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { afterAll } = bunTest(ctx);
  afterAll(fn);
}

function beforeEach(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { beforeEach } = bunTest(ctx);
  beforeEach(fn);
}

function afterEach(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { afterEach } = bunTest(ctx);
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

  const originalContext = ctx;
  const context = new TestContext(true, name, ctx.filePath, originalContext);

  const runTest = (done: (error?: unknown) => void) => {
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

  const originalContext = ctx;
  const context = new TestContext(false, name, ctx.filePath, originalContext);

  const runDescribe = () => {
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
