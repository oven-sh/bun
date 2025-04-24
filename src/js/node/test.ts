// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");

const kDefaultName = "<anonymous>";
const kDefaultFunction = () => {};
const kDefaultFilePath = Bun.main; // Defined kDefaultFilePath

// Define internal types used by create* functions
type TestFnCallback = (ctx: TestContext) => unknown | Promise<unknown>;
type DescribeFnCallback = (ctx: TestContext) => unknown | Promise<unknown>;
type HookFnCallback = () => unknown | Promise<unknown>;

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

const kDefaultOptions = kEmptyObject as TestOptions; // Cast here for default

function run() {
  throwNotImplemented("run()", 5090, "Use `bun:test` in the interim.");
}

function mock() {
  throwNotImplemented("mock()", 5090, "Use `bun:test` in the interim.");
}

function fileSnapshot(_value: unknown, _path: string, _options: { serializers?: Function[] } = kEmptyObject as { serializers?: Function[] }) {
  throwNotImplemented("fileSnapshot()", 5090, "Use `bun:test` in the interim.");
}

function snapshot(_value: unknown, _options: { serializers?: Function[] } = kEmptyObject as { serializers?: Function[] }) {
  throwNotImplemented("snapshot()", 5090, "Use `bun:test` in the interim.");
}

const assert = {
  ...require("node:assert"),
  fileSnapshot,
  snapshot,
  // register,
};

// Delete deprecated methods on assert (required to pass node's tests)
delete (assert as any).AssertionError;
delete (assert as any).CallTracker;
delete (assert as any).strict;

/**
 * @link https://nodejs.org/api/test.html#class-suitecontext
 */
export class SuiteContext { // Exported
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
export class TestContext { // Exported
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

  plan(_count: number, _options: { wait?: boolean } = kEmptyObject as { wait?: boolean }) {
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

  waitFor(_condition: unknown, _options: { timeout?: number } = kEmptyObject as { timeout?: number }) {
    throwNotImplemented("waitFor()", 5090, "Use `bun:test` in the interim.");
  }

  test(arg0: unknown, arg1: unknown, arg2: unknown) {
    const { name, fn, options } = createTest(arg0, arg1, arg2);

    if (this.#insideTest) {
      throwNotImplemented("test() inside another test()", 5090, "Use `bun:test` in the interim.");
    }

    const { test: bunTestFn } = bunTest(this);
    if (options.only) {
      bunTestFn.only(name, fn);
    } else if (options.todo) {
      bunTestFn.todo(name, fn);
    } else if (options.skip) {
      bunTestFn.skip(name, fn);
    } else {
      bunTestFn(name, fn);
    }
  }

  describe(arg0: unknown, arg1: unknown, arg2: unknown) {
    const { name, fn } = createDescribe(arg0, arg1, arg2);

    if (this.#insideTest) {
      throwNotImplemented("describe() inside another test()", 5090, "Use `bun:test` in the interim.");
    }

    const { describe: bunDescribeFn } = bunTest(this);
    bunDescribeFn(name, fn);
  }
}

function bunTest(ctx: SuiteContext | TestContext) {
  return jest(ctx.filePath);
}

let ctx: TestContext | SuiteContext = new TestContext(false, undefined, Bun.main, undefined); // Use union type

function describe(arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe: bunDescribeFn } = bunTest(ctx); // Use different name
  bunDescribeFn(name, fn);
}

describe.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe: bunDescribeFn } = bunTest(ctx); // Use different name
  bunDescribeFn.skip(name, fn);
};

describe.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe: bunDescribeFn } = bunTest(ctx); // Use different name
  bunDescribeFn.todo(name, fn);
};

describe.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn } = createDescribe(arg0, arg1, arg2);
  const { describe: bunDescribeFn } = bunTest(ctx); // Use different name
  bunDescribeFn.only(name, fn);
};

function testFnWrapper(arg0: unknown, arg1: unknown, arg2: unknown) { // Renamed original test function
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test: bunTestFn } = bunTest(ctx); // Use different name
  bunTestFn(name, fn, options);
}

testFnWrapper.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test: bunTestFn } = bunTest(ctx); // Use different name
  bunTestFn.skip(name, fn, options);
};

testFnWrapper.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test: bunTestFn } = bunTest(ctx); // Use different name
  bunTestFn.todo(name, fn, options);
};

testFnWrapper.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  const { name, fn, options } = createTest(arg0, arg1, arg2);
  const { test: bunTestFn } = bunTest(ctx); // Use different name
  bunTestFn.only(name, fn, options);
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
  const { beforeEach: bunBeforeEach } = bunTest(ctx); // Use different name
  bunBeforeEach(fn);
}

function afterEach(arg0: unknown, arg1: unknown) {
  const { fn } = createHook(arg0, arg1);
  const { afterEach: bunAfterEach } = bunTest(ctx); // Use different name
  bunAfterEach(fn);
}


function parseTestOptions(arg0: unknown, arg1: unknown, arg2: unknown): { name: string; options: TestOptions; fn: TestFnCallback | DescribeFnCallback } {
  let name: string;
  let options: unknown;
  let fn: TestFnCallback | DescribeFnCallback; // Use union type

  if (typeof arg0 === "function") {
    name = arg0.name || kDefaultName;
    fn = arg0 as TestFnCallback | DescribeFnCallback;
    if (typeof arg1 === "object" && arg1 !== null) { // Check for null
      options = arg1 as TestOptions;
    } else {
      options = kDefaultOptions;
    }
  } else if (typeof arg0 === "string") {
    name = arg0;
    if (typeof arg1 === "object" && arg1 !== null) { // Check for null
      options = arg1 as TestOptions;
      if (typeof arg2 === "function") {
        fn = arg2 as TestFnCallback | DescribeFnCallback;
      } else {
        fn = kDefaultFunction as TestFnCallback | DescribeFnCallback; // Cast default
      }
    } else if (typeof arg1 === "function") {
      fn = arg1 as TestFnCallback | DescribeFnCallback;
      options = kDefaultOptions;
    } else {
      fn = kDefaultFunction as TestFnCallback | DescribeFnCallback; // Cast default
      options = kDefaultOptions;
    }
  } else {
    name = kDefaultName;
    fn = kDefaultFunction as TestFnCallback | DescribeFnCallback; // Cast default
    options = kDefaultOptions;
  }

  return { name, options: options as TestOptions, fn };
}

function createTest(arg0: unknown, arg1: unknown, arg2: unknown): { name: string; options: TestOptions; fn: (done: (error?: unknown) => void) => void } {
  const { name, options, fn: userFn } = parseTestOptions(arg0, arg1, arg2);

  const originalContext = ctx;
  const context = new TestContext(true, name, ctx.filePath, originalContext as TestContext); // Cast parent

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
      // Ensure userFn is called with the correct context type (TestContext)
      result = (userFn as TestFnCallback)(context);
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

function createDescribe(arg0: unknown, arg1: unknown, arg2: unknown): { name: string; options: TestOptions; fn: () => unknown } {
  const { name, fn: userFn, options } = parseTestOptions(arg0, arg1, arg2);

  const originalContext = ctx;
  // Describe creates a new TestContext, not SuiteContext, based on implementation
  const context = new TestContext(false, name, ctx.filePath, originalContext as TestContext); // Cast parent

  const runDescribe = () => {
    ctx = context;
    const endDescribe = () => {
      ctx = originalContext;
    };

    try {
      // Ensure userFn is called with the correct context type (TestContext)
      return (userFn as DescribeFnCallback)(context);
    } finally {
      endDescribe();
    }
  };

  return { name, options, fn: runDescribe };
}

function parseHookOptions(arg0: unknown, arg1: unknown): { fn: HookFnCallback; options: HookOptions } {
  let fn: HookFnCallback | undefined;
  let options: HookOptions;

  if (typeof arg0 === "function") {
    fn = arg0 as HookFnCallback;
  } else {
    fn = kDefaultFunction as HookFnCallback; // Cast default
  }

  if (typeof arg1 === "object" && arg1 !== null) { // Check for null
    options = arg1 as HookOptions;
  } else {
    options = kEmptyObject as HookOptions; // Use casted default
  }

  return { fn, options };
}

function createHook(arg0: unknown, arg1: unknown): { options: HookOptions; fn: (done: (error?: unknown) => void) => void } {
  const { fn: userFn, options } = parseHookOptions(arg0, arg1);

  const runHook = (done: (error?: unknown) => void) => {
    let result: unknown;
    try {
      result = userFn(); // Hook functions don't receive context in Node API
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


function setDefaultSnapshotSerializer(_serializers: unknown[]) {
  throwNotImplemented("setDefaultSnapshotSerializer()", 5090, "Use `bun:test` in the interim.");
}

function setResolveSnapshotPath(_fn: unknown) {
  throwNotImplemented("setResolveSnapshotPath()", 5090, "Use `bun:test` in the interim.");
}

// Assign functions to the export object
// Use the renamed test function wrapper
const testExport = testFnWrapper as any; // Cast to any to allow adding properties

testExport.describe = describe;
testExport.suite = describe;
testExport.test = testExport; // Alias to self
testExport.it = testExport; // Alias to self
testExport.before = before;
testExport.after = after;
testExport.beforeEach = beforeEach;
testExport.afterEach = afterEach;
testExport.assert = assert;
testExport.snapshot = {
  setDefaultSnapshotSerializer,
  setResolveSnapshotPath,
};
testExport.run = run;
testExport.mock = mock;

export default testExport;