// Hardcoded module "node:test"
// This follows the Node.js API as described in: https://nodejs.org/api/test.html
//
// Top-level tests and suites are scheduled through bun:test (Bun.jest), while
// subtests created inside a running test are executed inline by this module so
// that Node's TestContext semantics (subtests, hooks, plan, mock tracker,
// getTestContext) are observable without a separate runner process.

const { jest } = Bun;
const { kEmptyObject, throwNotImplemented } = require("internal/shared");
const {
  validateBoolean,
  validateInteger,
  validateObject,
  validateNumber,
  validateFunction,
  validateString,
  validateArray,
  validateAbortSignal,
  validateUint32,
} = require("internal/validators");

const kDefaultName = "<anonymous>";
const kRootName = "<root>";
const kDefaultFunction = () => {};
// The runner's own timers must keep working while `mock.timers` replaces the
// globals, so capture them at module load like Node's runner does.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const kDefaultOptions = kEmptyObject;
// Matches Node's internal/timers TIMEOUT_MAX.
const kTimeoutMax = 2 ** 31 - 1;
// Matches bun:test's default per-test timeout.
const kBunTestDefaultTimeoutMs = 5_000;
const kJoinSeparator = " > ";

function run() {
  throwNotImplemented("run()", 5090, "Use `bun:test` in the interim.");
}

// -----------------------------------------------------------------------------
// MockTracker
//
// Port of Node.js lib/internal/test_runner/mock/mock.js (v26.3.0):
//   https://github.com/nodejs/node/blob/50c35fea9e64d50ab3bb5f359e8523de89d6c798/lib/internal/test_runner/mock/mock.js
// API reference: https://nodejs.org/api/test.html#class-mocktracker
// -----------------------------------------------------------------------------
let trackMockCall: (ctx: MockFunctionContext, thisArg: unknown, args: unknown[], target: unknown) => unknown;

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
    this.#onceImplementations.$set(call, implementation);
  }

  resetCalls() {
    this.#calls = [];
  }

  restore() {
    // node semantics: a method mock reinstalls the original descriptor but the
    // context keeps its implementation (calling the detached mock function
    // still uses it); a bare fn mock reverts to calling the original. Queued
    // once-implementations survive, and restore() stays re-runnable so a
    // still-tracked context can be restored again by reset().
    if (this.#restore !== undefined) {
      this.#restore();
    } else {
      this.#implementation = undefined;
    }
  }

  static {
    trackMockCall = function trackMockCall(
      ctx: MockFunctionContext,
      thisArg: unknown,
      args: unknown[],
      target: unknown,
    ) {
      const callIndex = ctx.#calls.length;
      let implementation = ctx.#onceImplementations.$get(callIndex);
      if (implementation !== undefined) {
        ctx.#onceImplementations.$delete(callIndex);
      } else {
        implementation = ctx.#implementation ?? ctx.#original;
      }
      // options.times: revert to the original behavior once the mock has
      // been used `times` times (node decides this before invoking, so the
      // current call still uses the mocked implementation).
      if (callIndex + 1 === ctx.#times) {
        ctx.restore();
      }
      // node records the call in a finally *after* invoking, so a reentrant
      // implementation observes callCount() === N (not N+1), recursive calls
      // record in completion order, and the stack is captured post-invoke.
      let result: unknown;
      let error: unknown;
      const isConstruct = target !== undefined;
      try {
        result = !isConstruct
          ? (implementation as Function).$apply(thisArg, args)
          : Reflect.construct(implementation as Function, args, target as Function);
        return result;
      } catch (e) {
        error = e;
        throw e;
      } finally {
        // node's mock is a Proxy over the original, so its construct trap
        // records the proxy's target (the original) and the new instance.
        ctx.#calls.push({
          arguments: args,
          error,
          result,
          stack: new Error(),
          target: isConstruct ? ctx.#original : undefined,
          this: isConstruct ? result : thisArg,
        });
      }
    };
  }
}

class MockPropertyContext {
  #object: object;
  #propertyName: PropertyKey;
  #value: unknown;
  #originalValue: unknown;
  #descriptor: PropertyDescriptor;
  #accesses: unknown[];
  #onceValues: Map<number, unknown>;

  constructor(object: object, propertyName: PropertyKey, value?: unknown) {
    this.#onceValues = new Map();
    this.#accesses = [];
    this.#object = object;
    this.#propertyName = propertyName;
    this.#originalValue = object[propertyName];
    this.#value = arguments.length > 2 ? value : this.#originalValue;
    const descriptor = Object.getOwnPropertyDescriptor(object, propertyName);
    if (!descriptor) {
      throw $ERR_INVALID_ARG_VALUE("propertyName", propertyName, "is not a property of the object");
    }
    this.#descriptor = descriptor;

    const { configurable, enumerable } = descriptor;
    Object.defineProperty(object, propertyName, {
      // @ts-ignore
      __proto__: null,
      configurable,
      enumerable,
      get: () => {
        const nextValue = this.#getAccessValue(this.#value);
        this.#accesses.push({
          type: "get",
          value: nextValue,
          stack: new Error(),
        });
        return nextValue;
      },
      set: this.mockImplementation.bind(this),
    });
  }

  get accesses() {
    return this.#accesses.slice(0);
  }

  accessCount(): number {
    return this.#accesses.length;
  }

  mockImplementation(value: unknown) {
    if (!this.#descriptor.writable) {
      throw $ERR_INVALID_ARG_VALUE("propertyName", this.#propertyName, "cannot be set");
    }
    const nextValue = this.#getAccessValue(value);
    this.#accesses.push({
      type: "set",
      value: nextValue,
      stack: new Error(),
    });
    this.#value = nextValue;
  }

  #getAccessValue(value: unknown) {
    const accessIndex = this.#accesses.length;
    if (this.#onceValues.$has(accessIndex)) {
      const accessValue = this.#onceValues.$get(accessIndex);
      this.#onceValues.$delete(accessIndex);
      return accessValue;
    }
    return value;
  }

  mockImplementationOnce(value: unknown, onAccess?: number) {
    const nextAccess = this.#accesses.length;
    const accessIndex = onAccess ?? nextAccess;
    validateInteger(accessIndex, "onAccess", nextAccess);
    this.#onceValues.$set(accessIndex, value);
  }

  resetAccesses() {
    this.#accesses = [];
  }

  restore() {
    Object.defineProperty(this.#object, this.#propertyName, {
      // @ts-ignore
      __proto__: null,
      ...this.#descriptor,
      value: this.#originalValue,
    });
  }
}

function validateTimes(value: unknown, name: string) {
  if (value === Infinity) {
    return;
  }
  validateInteger(value, name, 1);
}

function validateStringOrSymbol(value: unknown, name: string) {
  if (typeof value !== "string" && typeof value !== "symbol") {
    throw $ERR_INVALID_ARG_TYPE(name, ["string", "symbol"], value);
  }
}

// Functions declared inside bun's builtins get no `prototype`, but node's
// default original is a plain `function () {}`, so give it one explicitly.
function createDefaultOriginal(): Function {
  const original = function () {};
  Object.defineProperty(original, "prototype", {
    // @ts-ignore
    __proto__: null,
    value: {},
    writable: true,
    enumerable: false,
    configurable: false,
  });
  return original;
}

class MockTracker {
  #mocks: { ctx: { restore: () => void } }[] = [];
  #timers: unknown;
  // Set on the module-level tracker: registering into it from a new file's
  // module scope must run the file-boundary reset (getRootNode) first.
  #isFileScoped: boolean = false;

  static createFileScoped(): MockTracker {
    const tracker = new MockTracker();
    tracker.#isFileScoped = true;
    return tracker;
  }

  // File-scoped registrations must run the file-boundary reset (getRootNode)
  // BEFORE capturing any state, or a new file's module-scope mock.method()
  // would snapshot the previous file's still-installed mock as the original.
  #syncEntryFile(): void {
    if (this.#isFileScoped) getRootNode();
  }

  #createMockFunction(
    original: Function,
    implementation: Function | undefined,
    restore?: () => void,
    times: number = Infinity,
  ) {
    const context = new MockFunctionContext(original, implementation, restore, times);
    this.#mocks.push({ ctx: context });
    function mockFunction(this: unknown, ...args: unknown[]) {
      return trackMockCall(context, this, args, new.target);
    }
    Object.defineProperty(mockFunction, "mock", {
      // @ts-ignore
      __proto__: null,
      value: context,
      writable: false,
      enumerable: false,
    });
    Object.defineProperty(mockFunction, "length", {
      // @ts-ignore
      __proto__: null,
      value: original.length,
      configurable: true,
    });
    Object.defineProperty(mockFunction, "name", {
      // @ts-ignore
      __proto__: null,
      value: original.name,
      configurable: true,
    });
    // node's mock proxies the original, so `.prototype` reads through to it:
    // mirror the value and its writability (a class's prototype is read-only,
    // and a method/arrow original has no prototype at all).
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(original, "prototype");
    Object.defineProperty(mockFunction, "prototype", {
      // @ts-ignore
      __proto__: null,
      value: prototypeDescriptor?.value,
      writable: prototypeDescriptor?.writable ?? true,
    });
    return mockFunction;
  }

  fn(original?: Function | object, implementation?: Function | object, options?: object) {
    this.#syncEntryFile();
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
    return this.#createMockFunction(
      (original as Function) ?? createDefaultOriginal(),
      implementation as Function | undefined,
      undefined,
      times,
    );
  }

  method(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: { getter?: boolean; setter?: boolean } | object,
  ) {
    this.#syncEntryFile();
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
    if (typeof methodName !== "string" && typeof methodName !== "symbol") {
      throw $ERR_INVALID_ARG_TYPE("methodName", ["string", "symbol"], methodName);
    }
    if (options !== undefined) {
      validateObject(options, "options");
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
      original = descriptor.get!;
    } else if (setter) {
      if (!$isCallable(descriptor.set)) {
        throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a setter");
      }
      original = descriptor.set!;
    } else {
      if (!$isCallable(descriptor.value)) {
        throw $ERR_INVALID_ARG_VALUE("methodName", methodName, "must be a method");
      }
      original = descriptor.value;
    }

    const restore = function restore() {
      // @ts-ignore
      Object.defineProperty(objectOrFunction, methodName, { __proto__: null, ...descriptor! });
    };
    const mocked = this.#createMockFunction(original, implementation as Function | undefined, restore, times);

    const mockDescriptor: PropertyDescriptor = {
      // @ts-ignore
      __proto__: null,
      configurable: descriptor.configurable,
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

  getter(
    objectOrFunction: object | Function,
    methodName: PropertyKey,
    implementation?: Function | object,
    options?: object,
  ) {
    // Shift implementation -> options *before* spreading, or the shift inside
    // method() would clobber the getter flag (node does the same).
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
    return this.method(objectOrFunction, methodName, implementation as Function | undefined, {
      ...options,
      getter,
    });
  }

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
    return this.method(objectOrFunction, methodName, implementation as Function | undefined, {
      ...options,
      setter,
    });
  }

  property(object: object, propertyName: PropertyKey, value?: unknown) {
    this.#syncEntryFile();
    validateObject(object, "object");
    validateStringOrSymbol(propertyName, "propertyName");

    const ctx =
      arguments.length > 2
        ? new MockPropertyContext(object, propertyName, value)
        : new MockPropertyContext(object, propertyName);
    this.#mocks.push({ ctx });

    return new Proxy(object, {
      get(target, property, receiver) {
        if (property === "mock") {
          return ctx;
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  get timers() {
    this.#syncEntryFile();
    if (this.#timers === undefined) {
      const { MockTimers } = require("internal/test_runner/mock_timers");
      this.#timers = new MockTimers();
    }
    return this.#timers;
  }

  reset() {
    // restoreAll() plus disassociating the mocks from the tracker, like node.
    this.restoreAll();
    (this.#timers as { reset: () => void } | undefined)?.reset();
    this.#mocks = [];
  }

  restoreAll() {
    // Restores method mocks to their original descriptor and makes bare
    // mock.fn() mocks call their original function again, like node. Unlike
    // reset(), the mocks stay associated with the tracker.
    for (const { ctx } of this.#mocks) ctx.restore();
  }

  module() {
    throwNotImplemented("mock.module()", 5090, "Use `bun:test` in the interim.");
  }
}

// The module-level tracker is reset automatically at each test-file boundary
// (see getRootNode), matching Node's per-process module state.
const mock = MockTracker.createFileScoped();

// -----------------------------------------------------------------------------
// Assertions (t.assert + custom assertion registry)
// -----------------------------------------------------------------------------

function fileSnapshot(_value: unknown, _path: string, _options: { serializers?: Function[] } = kEmptyObject) {
  throwNotImplemented("fileSnapshot()", 5090, "Use `bun:test` in the interim.");
}

function snapshot(_value: unknown, _options: { serializers?: Function[] } = kEmptyObject) {
  throwNotImplemented("snapshot()", 5090, "Use `bun:test` in the interim.");
}

const nodeAssert = require("node:assert");
const { innerOk } = require("internal/assert/utils");

// Custom assertions registered through `require("node:test").assert.register()`.
// They become part of every TestContext's `t.assert` built afterwards.
// Prototype-less so lookups never go through user-reachable Map/Object methods.
let customAssertions: Record<string, Function> = { __proto__: null } as unknown as Record<string, Function>;

function registerCustomAssertion(name: string, fn: Function) {
  validateString(name, "name");
  validateFunction(fn, "fn");
  // Run the file-boundary reset first so a registration made at module scope,
  // before the file's first test, is not wiped by that test's registration.
  getRootNode();
  customAssertions[name] = fn;
}

const assert = {
  ...nodeAssert,
  fileSnapshot,
  snapshot,
  register: registerCustomAssertion,
};

// Delete deprecated methods on assert (required to pass node's tests)
delete assert.AssertionError;
delete assert.CallTracker;
delete assert.strict;

function buildContextAssert(node: TestNode, ctx: TestContext) {
  // Per-context assert namespace, prototype-less like Node's: node:assert
  // methods (minus the uncopied ones), snapshot/fileSnapshot, and custom
  // assertions; each call counts the plan and binds the TestContext.
  const result: Record<string, Function> = { __proto__: null } as unknown as Record<string, Function>;
  // Node captures `plan` once at first `t.assert` access and closes over it,
  // so `t.assert; t.plan(2); t.assert.ok(1)` counts 0 (nodejs/node
  // lib/internal/test_runner/test.js:331). Match that.
  const { plan } = node;
  const add = (name: string, method: Function) => {
    const wrapper = function (...args: unknown[]) {
      plan?.count();
      return method.$apply(ctx, args);
    };
    // @ts-ignore
    Object.defineProperty(wrapper, "name", { __proto__: null, value: name, configurable: true });
    result[name] = wrapper;
  };
  for (const key of Object.keys(nodeAssert)) {
    // CallTracker is also excluded: bun's node:assert still ships it (Node 26
    // does not), and copying it would trigger its deprecation accessor.
    // `ok` is installed below, outside the generic wrapper.
    if (key === "AssertionError" || key === "strict" || key === "CallTracker" || key === "ok") continue;
    const value = nodeAssert[key];
    if (!$isCallable(value)) continue;
    add(key, value);
  }
  add("snapshot", snapshot);
  add("fileSnapshot", fileSnapshot);
  for (const name of Object.keys(customAssertions)) {
    add(name, customAssertions[name]);
  }
  // `ok` is its own stackStartFn so the trace starts at the caller instead of a
  // node:test wrapper frame; a registered `ok` still wins (nodejs/node@028c5864).
  if (customAssertions.ok === undefined) {
    result.ok = function ok(...args: unknown[]) {
      plan?.count();
      innerOk(ok, args.length, ...args);
    };
  }
  return result;
}

// -----------------------------------------------------------------------------
// Test plan
// -----------------------------------------------------------------------------

function makeTestFailure(message: string) {
  const error = new Error(message);
  (error as { code?: string }).code = "ERR_TEST_FAILURE";
  return error;
}

class TestPlan {
  expected: number;
  actual = 0;
  wait: boolean | number;
  #pending:
    | { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> | undefined }
    | undefined;

  constructor(count: number, options: { wait?: boolean | number } = kEmptyObject) {
    validateUint32(count, "count");
    validateObject(options, "options");
    const { wait = false } = options;
    if (typeof wait === "number") {
      validateNumber(wait, "options.wait", 0, kTimeoutMax);
    } else if (typeof wait !== "boolean" && wait !== undefined) {
      throw $ERR_INVALID_ARG_TYPE("options.wait", ["boolean", "number"], wait);
    }
    this.expected = count;
    this.wait = wait ?? false;
  }

  count() {
    this.actual++;
    if (this.#pending !== undefined && this.actual >= this.expected) {
      const pending = this.#pending;
      this.#pending = undefined;
      const { timer } = pending;
      if (timer !== undefined) realClearTimeout(timer);
      pending.resolve();
    }
  }

  check(): undefined | Promise<void> {
    const { actual, expected, wait } = this;
    if (actual === expected) {
      return;
    }
    if (wait === false || wait === undefined || actual > expected) {
      throw makeTestFailure(`plan expected ${expected} assertions but received ${actual}`);
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (typeof wait === "number") {
        timer = realSetTimeout(() => {
          this.#pending = undefined;
          reject(
            makeTestFailure(`plan timed out after ${wait}ms with ${this.actual} assertions when expecting ${expected}`),
          );
        }, wait);
        // Not unref'd: count()/cancel()/the timer callback always clear it, and
        // on Windows an unref'd timer alone under bun:test busy-spins (8664279d).
      }
      this.#pending = { resolve, reject, timer };
    });
  }

  // Mirrors count()'s cleanup for the stop-wins-race path: if the test-level
  // timeout fires before a numeric {wait: K} is fulfilled, the ref'd plan
  // timer must not stay armed for K - N more ms after the test reported.
  cancel() {
    const pending = this.#pending;
    if (pending === undefined) return;
    this.#pending = undefined;
    const { timer } = pending;
    if (timer !== undefined) realClearTimeout(timer);
  }
}

// t.test() counts against the parent's plan; only t.assert.* uses the
// captured-at-first-access snapshot (Node reads this.#test.plan fresh here).
function planCount(node: TestNode) {
  node.plan?.count();
}

// -----------------------------------------------------------------------------
// Tags
// -----------------------------------------------------------------------------

const kEmptyTags: string[] = Object.freeze([]) as string[];
let tagsExperimentalWarningEmitted = false;

function canonicalizeTags(tags: unknown, name: string): string[] {
  validateArray(tags, name);
  const seen = new Set<string>();
  for (let i = 0; i < (tags as unknown[]).length; i++) {
    const tag = (tags as unknown[])[i];
    validateString(tag, `${name}[${i}]`);
    if (tag === "") {
      throw $ERR_INVALID_ARG_VALUE(`${name}[${i}]`, tag, "must not be an empty string");
    }
    seen.add((tag as string).toLowerCase());
  }
  if (seen.size > 0 && !tagsExperimentalWarningEmitted) {
    tagsExperimentalWarningEmitted = true;
    process.emitWarning("Test tags is an experimental feature and might change at any time", "ExperimentalWarning");
  }
  return Array.from(seen);
}

// -----------------------------------------------------------------------------
// Async context tracking for getTestContext()
// -----------------------------------------------------------------------------

let asyncLocalStorage: { getStore(): TestNode | undefined; run<T>(store: TestNode, fn: () => T): T } | undefined;

function getAsyncLocalStorage() {
  if (asyncLocalStorage === undefined) {
    const { AsyncLocalStorage } = require("node:async_hooks");
    asyncLocalStorage = new AsyncLocalStorage();
  }
  return asyncLocalStorage;
}

function currentNode(): TestNode | undefined {
  return asyncLocalStorage?.getStore();
}

function runWithNode<T>(node: TestNode, fn: () => T): T {
  return getAsyncLocalStorage().run(node, fn);
}

function getTestContext(): TestContext | SuiteContext | undefined {
  const node = currentNode();
  if (node === undefined) return undefined;
  // The root has isSuite=true but parent=undefined; Node's root is a Test,
  // so match hookArgFor() and give it a TestContext.
  return node.isSuite && node.parent !== undefined ? node.getSuiteCtx() : node.getCtx();
}

// -----------------------------------------------------------------------------
// TestNode: internal runner state shared by TestContext/SuiteContext
// -----------------------------------------------------------------------------

// `timeout`/`signal` are snapshotted at creation (Node validates and stores them
// on the TestHook). `result` memoizes a before hook's one run, like Node's
// runOnce(): every replay observes the same outcome, including the failure.
type Hook = { fn: Function; timeout: number | undefined; signal: AbortSignal | undefined; result?: Promise<void> };
type HookSets = { before: Hook[]; after: Hook[]; beforeEach: Hook[]; afterEach: Hook[] };

class TestNode {
  name: string;
  parent: TestNode | undefined;
  isSuite: boolean;
  // "collection" nodes register with bun:test; "execution" nodes run inline as subtests.
  isExecutionPhase: boolean;
  filePath: string | undefined;
  options: TestOptions;
  ownTags: string[] | undefined;
  hooks: HookSets = { before: [], after: [], beforeEach: [], afterEach: [] };
  plan: TestPlan | null = null;
  mockTracker: MockTracker | null = null;
  skipped = false;
  todoFlag = false;
  started = false;
  finished = false;
  passed = false;
  error: unknown = null;
  // Inline subtests are serialized through this chain. `concurrency` is
  // validated for Node-compat error codes but subtests always run serially.
  subtestChain: Promise<void> = Promise.resolve();
  // True when no subtest step is in flight on the chain; appendSubtestStep()
  // starts the next step inline (Node starts a subtest's body synchronously
  // at the t.test() call when the parent has a free concurrency slot).
  subtestChainIdle = true;
  failedSubtests = 0;
  firstSubtestError: unknown = undefined;
  // First failure from a before hook created while this test was running.
  hookFailure: unknown = undefined;
  #ctx: TestContext | undefined;
  #suiteCtx: SuiteContext | undefined;
  #tags: string[] | undefined;

  constructor(
    name: string,
    parent: TestNode | undefined,
    options: TestOptions,
    isSuite: boolean,
    isExecutionPhase: boolean,
  ) {
    this.name = name;
    this.parent = parent;
    this.options = options;
    this.isSuite = isSuite;
    this.isExecutionPhase = isExecutionPhase;
    // Direct children of the root capture the entry file at declaration time
    // (under `bun test` with multiple files, Bun.main is the file currently
    // being collected); nested tests inherit their parent's file.
    this.filePath = parent !== undefined && parent.parent !== undefined ? parent.filePath : Bun.main;
    this.skipped = !!options.skip;
    this.todoFlag = !!options.todo;
  }

  get tags(): string[] {
    if (this.#tags === undefined) {
      const parentTags = this.parent?.tags ?? kEmptyTags;
      const own = this.ownTags ?? kEmptyTags;
      if (parentTags.length === 0 && own.length === 0) {
        this.#tags = kEmptyTags;
      } else {
        const merged = new Set<string>(parentTags);
        for (const tag of own) merged.add(tag);
        this.#tags = Object.freeze(Array.from(merged)) as string[];
      }
    }
    return this.#tags;
  }

  get fullName(): string {
    const names: string[] = [];
    let node: TestNode | undefined = this;
    while (node !== undefined && node.parent !== undefined) {
      names.unshift(node.name);
      node = node.parent;
    }
    if (names.length === 0) {
      return this.name;
    }
    return names.join(kJoinSeparator);
  }

  getCtx(): TestContext {
    this.#ctx ??= new TestContext(this);
    return this.#ctx;
  }

  getSuiteCtx(): SuiteContext {
    this.#suiteCtx ??= new SuiteContext(this);
    return this.#suiteCtx;
  }

  // True while user code reached from this node should treat new tests as
  // inline subtests instead of bun:test registrations.
  isRunning(): boolean {
    return (this.started && !this.finished) || this.isExecutionPhase;
  }
}

// Bumped by the runner's enter_file. Bound privately rather than read off the
// bun:test module object, which is public API.
const fileGeneration = $newRustFunction("jest.rs", "jsFileGeneration", 0);
// Overrides the running bun:test sequence result: `false` → skip, `true` → todo.
// `done` binds the intended sequence so a late call after the bun:test watchdog
// moved on cannot write onto the currently-running test.
const markCurrentResult = $newRustFunction("jest.rs", "jsNodeTestMarkResult", 2);

let rootNode: TestNode | undefined;
let rootGeneration = -1;

function getRootNode(): TestNode {
  // Fresh root on each runner enter_file (per file AND per --rerun-each
  // iteration) so file-level hooks/state never leak between them; Bun.main
  // alone can't detect a rerun of the same file.
  const generation = fileGeneration();
  if (rootNode === undefined || rootGeneration !== generation) {
    const oldRoot = rootNode;
    rootGeneration = generation;
    // Publish the new root before resetting so re-entrant calls (user code run
    // by a mock's restore) see an up-to-date root and don't reset again.
    rootNode = new TestNode(kRootName, undefined, kDefaultOptions, true, false);
    if (oldRoot !== undefined) {
      // Node also scopes these per process: drop the previous file's
      // module-level mocks and assert.register() additions with its root.
      // The root's own mockTracker (reachable via a file-level before hook's
      // `t.mock`) is distinct from the module-level `mock` export.
      oldRoot.mockTracker?.reset();
      mock.reset();
      customAssertions = { __proto__: null } as unknown as Record<string, Function>;
      tagsExperimentalWarningEmitted = false;
    }
  }
  return rootNode;
}

// -----------------------------------------------------------------------------
// Contexts
// -----------------------------------------------------------------------------

/**
 * @link https://nodejs.org/api/test.html#class-testcontext
 */
class TestContext {
  #node: TestNode;
  #abortController?: AbortController;
  #assert: Record<string, Function> | undefined;

  constructor(node: TestNode) {
    this.#node = node;
  }

  get signal(): AbortSignal {
    if (this.#abortController === undefined) {
      this.#abortController = new AbortController();
    }
    return this.#abortController.signal;
  }

  get name(): string {
    return this.#node.name;
  }

  get fullName(): string {
    return this.#node.fullName;
  }

  get filePath(): string {
    return this.#node.filePath!;
  }

  get error(): unknown {
    return this.#node.error;
  }

  get passed(): boolean {
    return this.#node.passed;
  }

  get attempt(): number {
    return 0;
  }

  get workerId(): number | undefined {
    return Number(process.env.NODE_TEST_WORKER_ID) || undefined;
  }

  get tags(): string[] {
    return this.#node.tags;
  }

  diagnostic(message: string) {
    console.log(message);
  }

  plan(count: number, options: { wait?: boolean | number } = kEmptyObject) {
    const node = this.#node;
    if (node.plan !== null) {
      throw makeTestFailure("cannot set plan more than once");
    }
    node.plan = new TestPlan(count, options);
  }

  get assert() {
    this.#assert ??= buildContextAssert(this.#node, this);
    return this.#assert;
  }

  get mock(): MockTracker {
    const node = this.#node;
    node.mockTracker ??= new MockTracker();
    return node.mockTracker;
  }

  runOnly(_value?: boolean) {
    throwNotImplemented("runOnly()", 5090, "Use `bun:test` in the interim.");
  }

  skip(_message?: string) {
    this.#node.skipped = true;
  }

  todo(_message?: string) {
    this.#node.todoFlag = true;
  }

  before(arg0: unknown, arg1: unknown) {
    const hook = createHook(arg0, arg1);
    const node = this.#node;
    node.hooks.before.push(hook);
    if (node.started && !node.finished) {
      // Node runs before hooks created on an already-started test immediately.
      scheduleImmediateBeforeHook(node, hook, this);
    }
  }

  after(arg0: unknown, arg1: unknown) {
    this.#node.hooks.after.push(createHook(arg0, arg1));
  }

  beforeEach(arg0: unknown, arg1: unknown) {
    this.#node.hooks.beforeEach.push(createHook(arg0, arg1));
  }

  afterEach(arg0: unknown, arg1: unknown) {
    this.#node.hooks.afterEach.push(createHook(arg0, arg1));
  }

  waitFor(condition: unknown, options: { interval?: number; timeout?: number } = kEmptyObject) {
    validateFunction(condition, "condition");
    validateObject(options, "options");
    const { interval = 50, timeout = 1000 } = options;
    validateNumber(interval, "options.interval", 0, kTimeoutMax);
    validateNumber(timeout, "options.timeout", 0, kTimeoutMax);

    return new Promise((resolve, reject) => {
      let cause: unknown;
      let hasCause = false;
      let timedOut = false;
      let retry: ReturnType<typeof realSetTimeout> | undefined;
      const timer = realSetTimeout(() => {
        timedOut = true;
        // Cancel a pending retry so condition() is not invoked again after
        // reject (Node clears its pollerId in done()).
        if (retry !== undefined) realClearTimeout(retry);
        const error = new Error("waitFor() timed out");
        if (hasCause) {
          (error as { cause?: unknown }).cause = cause;
        }
        reject(error);
      }, timeout);

      const poll = async () => {
        try {
          const result = await (condition as Function)();
          if (timedOut) return;
          realClearTimeout(timer);
          resolve(result);
        } catch (err) {
          if (timedOut) return;
          cause = err;
          hasCause = true;
          retry = realSetTimeout(poll, interval);
        }
      };
      poll();
    });
  }

  test(arg0: unknown, arg1: unknown, arg2: unknown) {
    const node = this.#node;
    planCount(node);
    return addTest(arg0, arg1, arg2, node);
  }

  describe(arg0: unknown, arg1: unknown, arg2: unknown) {
    return addSuite(arg0, arg1, arg2, this.#node);
  }
}

/**
 * @link https://nodejs.org/api/test.html#class-suitecontext
 */
class SuiteContext {
  #node: TestNode;
  #abortController?: AbortController;

  constructor(node: TestNode) {
    this.#node = node;
  }

  get signal(): AbortSignal {
    if (this.#abortController === undefined) {
      this.#abortController = new AbortController();
    }
    return this.#abortController.signal;
  }

  get name(): string {
    return this.#node.name;
  }

  get fullName(): string {
    return this.#node.fullName;
  }

  get filePath(): string {
    return this.#node.filePath!;
  }

  get passed(): boolean {
    return this.#node.passed;
  }

  get attempt(): number {
    return 0;
  }

  diagnostic(message: string) {
    console.log(message);
  }
}

// -----------------------------------------------------------------------------
// Option parsing & validation
// -----------------------------------------------------------------------------

type TestFn = (ctx: TestContext | SuiteContext) => unknown | Promise<unknown>;
type HookFn = (ctx?: unknown) => unknown | Promise<unknown>;

type TestOptions = {
  concurrency?: number | boolean | null;
  only?: boolean;
  signal?: AbortSignal;
  skip?: boolean | string;
  todo?: boolean | string;
  timeout?: number;
  plan?: number;
  tags?: string[];
};

type HookOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

function parseTestArgs(arg0: unknown, arg1: unknown, arg2: unknown) {
  let name: string;
  let options: TestOptions;
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
  } else if (typeof arg0 === "object" && arg0 !== null) {
    options = arg0 as TestOptions;
    if (typeof arg1 === "function") {
      fn = arg1 as TestFn;
      name = fn.name || kDefaultName;
    } else {
      fn = kDefaultFunction;
      name = kDefaultName;
    }
  } else {
    name = kDefaultName;
    fn = kDefaultFunction;
    options = kDefaultOptions;
  }

  return { name, options, fn };
}

// Shared by test and hook options: Node validates both the same way.
function validateTimeoutAndSignal(options: TestOptions | HookOptions) {
  const { timeout, signal } = options;
  if (signal !== undefined) {
    validateAbortSignal(signal, "options.signal");
  }
  if (timeout != null && timeout !== Infinity) {
    validateNumber(timeout, "options.timeout", 0, kTimeoutMax);
  }
}

function validateTestOptions(options: TestOptions): { ownTags: string[] | undefined } {
  const { concurrency, tags, plan } = options;

  // signal and concurrency are validated for Node's error contract but not yet
  // enforced (t.signal never aborts; subtests always run serially).
  validateTimeoutAndSignal(options);
  if (concurrency != null && typeof concurrency !== "boolean") {
    if (typeof concurrency === "number") {
      validateUint32(concurrency, "options.concurrency", true);
    } else {
      throw $ERR_INVALID_ARG_TYPE("options.concurrency", ["boolean", "number"], concurrency);
    }
  }
  if (plan !== undefined) {
    validateUint32(plan, "options.plan");
  }

  let ownTags: string[] | undefined;
  if (tags !== undefined) {
    ownTags = canonicalizeTags(tags, "options.tags");
  }

  return { ownTags };
}

function parseHookArgs(arg0: unknown, arg1: unknown) {
  let fn: HookFn;
  let options: HookOptions;

  if (typeof arg0 === "function") {
    fn = arg0 as HookFn;
  } else {
    fn = kDefaultFunction;
  }

  if (typeof arg1 === "object" && arg1 !== null) {
    options = arg1 as HookOptions;
  } else {
    options = kDefaultOptions;
  }

  return { fn, options };
}

function createHook(arg0: unknown, arg1: unknown): Hook {
  const { fn, options } = parseHookArgs(arg0, arg1);
  // Node validates hook options in the TestHook constructor and snapshots them.
  validateTimeoutAndSignal(options);
  const { signal, timeout } = options;
  return { fn, timeout, signal, result: undefined };
}

// -----------------------------------------------------------------------------
// Execution engine
// -----------------------------------------------------------------------------

function ancestorChain(node: TestNode): TestNode[] {
  // Returns [root, ..., parent] (outermost first), excluding `node` itself.
  const chain: TestNode[] = [];
  let current = node.parent;
  while (current !== undefined) {
    chain.unshift(current);
    current = current.parent;
  }
  return chain;
}

function invokeWithDoneCallback(fn: Function, arg: unknown) {
  return new Promise<void>((resolve, reject) => {
    let returned = false;
    let returnedPromise = false;
    let doneCalled = false;
    let doneError: unknown;
    const done = (err?: unknown) => {
      if (doneCalled) {
        // Node throws into the caller when the callback is invoked again.
        throw makeTestFailure("callback invoked multiple times");
      }
      doneCalled = true;
      // A done() call made before the function returned is deferred, and one
      // made after a promise was returned is ignored: returning a promise from
      // a callback function always fails, like Node.
      if (!returned) {
        doneError = err;
        return;
      }
      if (returnedPromise) {
        return;
      }
      if (err) reject(err);
      else resolve();
    };
    const result = fn(arg, done);
    returned = true;
    if ($isPromise(result)) {
      // Node fails the test but still awaits the returned promise, so hooks
      // and later tests never race a still-running body.
      returnedPromise = true;
      const fail = () => reject(makeTestFailure("passed a callback but also returned a Promise"));
      (result as Promise<unknown>).then(fail, fail);
      return;
    }
    if (doneCalled) {
      if (doneError) reject(doneError);
      else resolve();
    }
  });
}

// Node passes a `done` callback when a test or hook function declares exactly
// two parameters; completion is then done()'s call, not the returned value.
function invokeTestFn(fn: Function, arg: unknown) {
  if (fn.length === 2) {
    return invokeWithDoneCallback(fn, arg);
  }
  return fn(arg);
}

// A single timeout armed once per test and raced against both the body and
// plan.check(), matching Node's stopTest()/stopPromise. `promise` never
// resolves; it only rejects with the timeout error. Callers must dispose().
function createStopController(timeout: number | undefined) {
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    return undefined;
  }
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    // Not unref'd: dispose() always clears it, and on Windows an unref'd timer
    // alone under bun:test leaves the uws loop inactive so auto_tick busy-spins.
    timer = realSetTimeout(() => reject(makeTestFailure(`test timed out after ${timeout}ms`)), timeout);
  });
  // Swallow the rejection when nothing is racing it anymore.
  promise.catch(() => {});
  return { promise, dispose: () => realClearTimeout(timer) };
}

// Runs `run` racing Node's test timeout; the timer starts before the body so a
// long synchronous prefix counts against the timeout, like Node.
function awaitWithTimeout(run: () => unknown, timeout: number | undefined) {
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
    return run();
  }
  return raceWithTimeoutAndSignal(run, timeout, undefined);
}

let addAbortListener;

async function raceWithTimeoutAndSignal(
  run: () => unknown,
  timeout: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener;
  try {
    const racers: unknown[] = [];
    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      racers.push(
        new Promise<never>((_, reject) => {
          timer = realSetTimeout(() => reject(makeTestFailure(`test timed out after ${timeout}ms`)), timeout);
        }),
      );
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        throw signal.reason;
      }
      addAbortListener ??= require("internal/abort_listener").addAbortListener;
      racers.push(
        new Promise<never>((_, reject) => {
          abortListener = addAbortListener(signal, () => reject(signal.reason));
        }),
      );
    }
    racers.push(run());
    await Promise.race(racers);
  } finally {
    // If run() settled first the loser promises stay pending forever, which is
    // harmless; only the timer and the abort listener need to be released.
    if (timer !== undefined) realClearTimeout(timer);
    abortListener?.[Symbol.dispose]();
  }
}

async function runHook(hook: Hook, owner: TestNode, arg: unknown) {
  const { timeout, signal } = hook;
  const run = () => runWithNode(owner, () => invokeTestFn(hook.fn as Function, arg));
  try {
    if (signal === undefined) {
      await awaitWithTimeout(run, timeout);
    } else {
      await raceWithTimeoutAndSignal(run, timeout, signal);
    }
  } catch (err) {
    // A hook that throws a nullish value must still fail the owning test.
    throw err ?? makeTestFailure("hook failed");
  }
}

// Node runs each before hook at most once (runOnce) and memoizes the outcome:
// after a failure, every later subtest observes the same rejection.
function runBeforeHookOnce(hook: Hook, owner: TestNode, arg: unknown): Promise<void> {
  return (hook.result ??= runHook(hook, owner, arg));
}

// Appends an async step to a node's subtest chain. When nothing is in flight
// the step is started inline so its synchronous prefix runs before this
// function returns, matching Node's Test.start() calling run() directly when
// the parent has a free concurrency slot.
function appendSubtestStep(owner: TestNode, step: () => Promise<void>): Promise<void> {
  let link: Promise<void>;
  if (owner.subtestChainIdle) {
    owner.subtestChainIdle = false;
    // Publish a pending tail before starting inline so a reentrant call on
    // this owner during step()'s synchronous prefix (the body using the
    // parent's captured `t`) chains behind the in-flight step instead of the
    // stale resolved tail.
    const gate = Promise.withResolvers<void>();
    owner.subtestChain = gate.promise;
    link = step();
    gate.resolve(link);
    // A reentrant call moved the tail past the gate; keep it.
    if (owner.subtestChain !== gate.promise) return link;
  } else {
    link = owner.subtestChain.then(step);
  }
  owner.subtestChain = link;
  link.then(() => {
    if (owner.subtestChain === link) owner.subtestChainIdle = true;
  });
  return link;
}

// Failures fail the owning test (Node: hook.error -> test.fail) instead of
// poisoning the subtest chain, so they are reported even when nothing awaits.
function scheduleImmediateBeforeHook(node: TestNode, hook: Hook, arg: unknown) {
  appendSubtestStep(node, async () => {
    try {
      await runBeforeHookOnce(hook, node, arg);
    } catch (err) {
      node.hookFailure ??= err;
    }
  });
}

function runOwnBeforeHooks(node: TestNode): Promise<void> | undefined {
  // Node runs suites strictly sequentially, so a subtest is gated on the before
  // hooks of every enclosing inline suite and the owning test, outermost first;
  // runBeforeHookOnce memoizes each, so the racing siblings share one result.
  const owners: TestNode[] = [];
  let any = false;
  for (let owner: TestNode | undefined = node; owner !== undefined; owner = owner.parent) {
    owners.unshift(owner);
    if (owner.hooks.before.length > 0) any = true;
    // Stop at the owning collection-phase test/suite: hooks above it were
    // registered through bun:test's own beforeAll and are not run by the shim.
    if (!owner.isExecutionPhase) break;
  }
  // With no hooks return undefined, not a promise: an `await` here would cost
  // the synchronous start of the subtest body that Node provides.
  if (!any) return undefined;
  return (async () => {
    for (const owner of owners) {
      const { before } = owner.hooks;
      if (before.length === 0) continue;
      const arg = owner.isSuite ? owner.getSuiteCtx() : owner.getCtx();
      for (const hook of before) {
        await runBeforeHookOnce(hook, owner, arg);
      }
    }
  })();
}

async function executeTestNode(node: TestNode, fn: TestFn): Promise<unknown> {
  // Runs a single test (top-level or subtest): inherited beforeEach hooks, the
  // body, pending subtests, the plan check, inherited afterEach hooks, and the
  // test's own after hooks. Returns the failure (if any) instead of throwing.
  node.started = true;
  const ctx = node.getCtx();
  const ancestors = ancestorChain(node);
  let failure: unknown;

  // Node applies the plan option before the beforeEach hooks run, and only for a
  // truthy count, so `{ plan: 0 }` installs no plan at all (test.js:1313-1315).
  // `t.assert` snapshots the plan at first access, so hooks must see it already.
  const { plan: planOption } = node.options;
  if (planOption && node.plan === null) {
    node.plan = new TestPlan(planOption);
  }

  try {
    for (const ancestor of ancestors) {
      for (const hook of ancestor.hooks.beforeEach) {
        await runHook(hook, ancestor, ctx);
      }
    }
  } catch (err) {
    failure = err;
  }

  if (failure === undefined) {
    // Node arms one stopPromise (timeout + signal) and races both the body
    // AND the plan wait against it. Arm timeout once here so plan({wait:true})
    // is bounded by the same test timeout, not left unbounded.
    const stop = createStopController(node.options.timeout);
    try {
      const runBody = async () => {
        await runWithNode(node, () => invokeTestFn(fn, ctx));
        // Wait for inline subtests created during the body (awaited or not),
        // including ones scheduled while earlier subtests were running.
        await drainSubtestChain(node);
      };

      try {
        await (stop === undefined ? runBody() : Promise.race([stop.promise, runBody()]));
      } catch (err) {
        // A body that throws or rejects with a nullish value must still fail.
        failure = err ?? makeTestFailure("test failed");
      }

      // A before hook created while the test was running failed (Node fails the
      // test with the hook's error).
      failure ??= node.hookFailure;

      const { plan } = node;
      if (failure === undefined && plan !== null) {
        try {
          const pending = plan.check();
          if (pending !== undefined) {
            // Defuse: if stop wins the race, plan's own wait-timeout may still
            // reject `pending` afterward with no one listening.
            pending.catch(() => {});
            await (stop === undefined ? pending : Promise.race([stop.promise, pending]));
            // A t.test() that fulfilled the plan from an async callback was
            // scheduled onto subtestChain during the wait; drain again so its
            // failure reaches failedSubtests below (Node fails the parent).
            const drain = drainSubtestChain(node);
            await (stop === undefined ? drain : Promise.race([stop.promise, drain]));
          }
        } catch (err) {
          failure = err;
        }
      }
    } finally {
      stop?.dispose();
      node.plan?.cancel();
    }

    const { failedSubtests, firstSubtestError } = node;
    if (failure === undefined && failedSubtests > 0) {
      const error = makeTestFailure(`${failedSubtests} subtest${failedSubtests > 1 ? "s" : ""} failed`);
      if (firstSubtestError !== undefined) {
        (error as { cause?: unknown }).cause = firstSubtestError;
      }
      failure = error;
    }
  }

  // Node sets passed/error before running afterEach/after so hooks can
  // introspect the outcome (nodejs/node lib/internal/test_runner/test.js
  // pass()/fail() precede afterEach).
  node.passed = failure === undefined;
  node.error = failure ?? null;
  // Mark finished before hooks so a late t.test() from an after/afterEach
  // hook hits addTest()'s parentAlreadyFinished path (Node cancels these).
  node.finished = true;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    for (const hook of ancestor.hooks.afterEach) {
      try {
        await runHook(hook, ancestor, ctx);
      } catch (err) {
        failure ??= err;
      }
    }
  }

  for (const hook of node.hooks.after) {
    try {
      await runHook(hook, node, ctx);
    } catch (err) {
      failure ??= err;
    }
  }

  try {
    node.mockTracker?.reset();
  } catch (err) {
    failure ??= err;
  }

  node.passed = failure === undefined;
  node.error = failure ?? null;
  return failure;
}

function scheduleSubtest(parent: TestNode, child: TestNode, fn: TestFn): Promise<undefined> {
  const run = async () => {
    if (child.options.skip) {
      child.finished = true;
      child.passed = true;
      return;
    }
    let failure: unknown;
    try {
      // Only await when there are hooks: executeTestNode() is called as the
      // operand of the next await, so its synchronous prefix (which reaches
      // the test body when no beforeEach hooks exist) runs before this
      // function first suspends.
      const beforeHooks = runOwnBeforeHooks(parent);
      if (beforeHooks !== undefined) await beforeHooks;
      failure = await executeTestNode(child, fn);
    } catch (err) {
      failure = err;
    }
    if (failure !== undefined && !child.todoFlag && !child.skipped) {
      parent.failedSubtests++;
      parent.firstSubtestError ??= failure;
    }
  };
  return appendSubtestStep(parent, run).then(() => undefined);
}

function recordSuiteFailure(suite: TestNode, err: unknown) {
  suite.failedSubtests++;
  suite.firstSubtestError ??= err ?? makeTestFailure("suite failed");
}

// Awaits a node's subtest chain, including links appended while waiting.
async function drainSubtestChain(node: TestNode) {
  let chain;
  do {
    chain = node.subtestChain;
    try {
      await chain;
    } catch {
      // Failures are tracked through failedSubtests.
    }
  } while (chain !== node.subtestChain);
}

function scheduleSuiteSubtest(parent: TestNode, suite: TestNode, build: unknown): Promise<undefined> {
  // A describe()/suite() created while a test is running becomes a suite
  // subtest: its children were collected eagerly when the callback ran and are
  // already chained on the suite's own subtestChain; failures roll up here.
  const run = async () => {
    if (build !== undefined) {
      try {
        // An async describe() callback that rejects fails the suite (Node
        // awaits the suite build).
        await build;
      } catch (err) {
        recordSuiteFailure(suite, err);
      }
    }
    try {
      await runOwnBeforeHooks(suite);
    } catch (err) {
      // A failing suite-level before hook fails the suite, like Node.
      recordSuiteFailure(suite, err);
    }
    // Wait for children created during the callback and any they schedule.
    await drainSubtestChain(suite);
    for (const hook of suite.hooks.after) {
      try {
        await runHook(hook, suite, suite.getSuiteCtx());
      } catch (err) {
        recordSuiteFailure(suite, err);
      }
    }
    suite.finished = true;
    suite.passed = suite.failedSubtests === 0;
    // A todo suite's failures do not fail the owning test (Node).
    if (suite.failedSubtests > 0 && !suite.todoFlag) {
      parent.failedSubtests++;
      parent.firstSubtestError ??= suite.firstSubtestError;
    }
  };
  return appendSubtestStep(parent, run).then(() => undefined);
}

// -----------------------------------------------------------------------------
// Registration with bun:test
// -----------------------------------------------------------------------------

function bunTest() {
  return jest(Bun.main);
}

function bunTestOptions(options: TestOptions) {
  // The node-style timeout is enforced by executeTestNode itself so that a
  // tiny timeout (e.g. 1ms) with a synchronous body still passes like in Node.
  // bun:test's own watchdog measures the whole wrapper, so it is only told
  // about timeouts that extend past its 5s default.
  const { timeout } = options;
  if (timeout === Infinity) {
    // Node's "no timeout" must override bun:test's default (bun saturates it).
    return { timeout };
  }
  if (typeof timeout === "number" && Number.isFinite(timeout)) {
    // Keep bun:test's watchdog at or above both the node-style timeout and
    // bun's default so a lower `--timeout` cannot cut a node timeout short.
    return { timeout: Math.max(timeout, kBunTestDefaultTimeoutMs) };
  }
  return undefined;
}

function currentCollectionParent(): TestNode {
  const node = currentNode();
  if (node !== undefined && !node.isExecutionPhase && node.isSuite) {
    return node;
  }
  return getRootNode();
}

function createTopLevelTestRunner(node: TestNode, fn: TestFn, declaredTodo = false) {
  // bun:test invokes this with a `done` callback because the function declares
  // one parameter.
  return (done: (error?: unknown) => void) => {
    executeTestNode(node, fn).then(
      failure => {
        // A runtime t.skip()/t.todo() overrides bun:test's pass/fail accounting
        // (Node counts these as skip/todo even when the body threw); a declared
        // todo body's failure must reach bun:test's own todo accounting instead.
        if (node.skipped) {
          markCurrentResult(false, done);
        } else if (node.todoFlag && !declaredTodo) {
          markCurrentResult(true, done);
        } else {
          done(failure);
          return;
        }
        done(undefined);
      },
      err => done(err),
    );
  };
}

function addTest(
  arg0: unknown,
  arg1: unknown,
  arg2: unknown,
  executionParent: TestNode | undefined,
  mode?: "skip" | "todo",
): Promise<undefined> {
  const { name, options, fn } = parseTestArgs(arg0, arg1, arg2);
  const { ownTags } = validateTestOptions(options);

  const runningNode = executionParent ?? currentNode();
  if (runningNode !== undefined) {
    if (runningNode.finished) {
      // t.test() escaped its parent: Node fails the late subtest but resolves
      // the promise; don't fall through to bun:test's internal-phase throw.
      return Promise.resolve(undefined);
    }
    if (runningNode.isRunning()) {
      // Subtest of a running test (or of an inline suite created inside one).
      if (mode === "skip" || options.skip) {
        return Promise.resolve(undefined);
      }
      const child = new TestNode(name, runningNode, options, false, true);
      child.ownTags = ownTags;
      if (mode === "todo") child.todoFlag = true;
      return scheduleSubtest(runningNode, child, fn);
    }
  }

  // Collection phase: register with bun:test.
  const parent = currentCollectionParent();
  const node = new TestNode(name, parent, options, false, false);
  node.ownTags = ownTags;

  const { test } = bunTest();
  const passOptions = bunTestOptions(options);

  const effectiveMode = mode ?? (options.todo ? "todo" : options.skip ? "skip" : undefined);

  if (effectiveMode === "todo" || effectiveMode === "skip") {
    const register = effectiveMode === "todo" ? test.todo : test.skip;
    // Node runs todo bodies; bun:test only does so under --todo.
    const body = effectiveMode === "todo" ? createTopLevelTestRunner(node, fn, true) : kDefaultFunction;
    if (passOptions !== undefined) {
      register(name, body, passOptions);
    } else {
      register(name, body);
    }
    return Promise.resolve(undefined);
  }

  // Node's `only` (the option and the test.only()/describe.only() spellings)
  // is a no-op unless --test-only is passed, so it registers an ordinary
  // test/suite; bun:test's only() would skip siblings and is rejected in CI.
  const runner = createTopLevelTestRunner(node, fn);
  if (passOptions !== undefined) {
    test(name, runner, passOptions);
  } else {
    test(name, runner);
  }

  // Resolved eagerly rather than when the runner settles: bun:test never invokes
  // the runner for a test `--test-name-pattern` filters out, so a deferred tied
  // to it would hang an awaiting caller forever. Node resolves those too, and
  // the timing is unobservable under bun:test's collect-then-execute model.
  return Promise.resolve(undefined);
}

function addSuite(
  arg0: unknown,
  arg1: unknown,
  arg2: unknown,
  executionParent?: TestNode,
  mode?: "skip" | "todo",
): Promise<undefined> {
  const { name, options, fn } = parseTestArgs(arg0, arg1, arg2);
  const { ownTags } = validateTestOptions(options);

  const runningNode = executionParent ?? currentNode();
  if (runningNode !== undefined && runningNode.finished) {
    return Promise.resolve(undefined);
  }
  if (runningNode !== undefined && runningNode.isRunning()) {
    const suite = new TestNode(name, runningNode, options, true, true);
    suite.ownTags = ownTags;
    if (mode === "skip" || options.skip) {
      return Promise.resolve(undefined);
    }
    if (mode === "todo") suite.todoFlag = true;
    // The suite's children must run after the parent's previously scheduled
    // subtests AND after the describe callback's own returned promise settles
    // (Node's Suite.run awaits buildPromise before iterating subtests). The
    // callback has not returned yet so its promise does not exist; seed the
    // chain through a gate the callback's settlement opens.
    const gate = Promise.withResolvers<void>();
    suite.subtestChain = runningNode.subtestChain.then(() => gate.promise);
    suite.subtestChainIdle = false;
    // Build the suite eagerly (Node also runs describe callbacks immediately),
    // collecting children onto the suite's own subtest chain.
    let build: unknown;
    try {
      build = runWithNode(suite, () => fn(suite.getSuiteCtx()));
    } catch (err) {
      // The callback threw after possibly registering children: fail the suite
      // but still schedule it so those children are awaited and rolled up.
      recordSuiteFailure(suite, err);
    }
    if (build != null && typeof (build as PromiseLike<unknown>).then === "function") {
      // Attach a handler now: the real await happens when the suite's turn
      // comes, which can be many ticks later (no unhandled rejection).
      (build as Promise<unknown>).then(gate.resolve, gate.resolve);
    } else {
      gate.resolve();
      build = undefined;
    }
    return scheduleSuiteSubtest(runningNode, suite, build);
  }

  const parent = currentCollectionParent();
  const suiteNode = new TestNode(name, parent, options, true, false);
  suiteNode.ownTags = ownTags;

  const { describe } = bunTest();
  const wrapped = () => {
    return runWithNode(suiteNode, () => fn(suiteNode.getSuiteCtx()));
  };

  const effectiveMode = mode ?? (options.todo ? "todo" : options.skip ? "skip" : undefined);
  const passOptions = bunTestOptions(options);

  let register: Function = describe;
  if (effectiveMode === "skip") register = describe.skip;
  else if (effectiveMode === "todo") register = describe.todo;

  if (passOptions !== undefined) {
    register(name, wrapped, passOptions);
  } else {
    register(name, wrapped);
  }
  return Promise.resolve(undefined);
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

function test(arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined);
}

test.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined, "skip");
};

test.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined, "todo");
};

test.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addTest(arg0, arg1, arg2, undefined);
};

function describe(arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined);
}

describe.skip = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined, "skip");
};

describe.todo = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined, "todo");
};

describe.only = function (arg0: unknown, arg1: unknown, arg2: unknown) {
  return addSuite(arg0, arg1, arg2, undefined);
};

function hookOwner(): TestNode {
  const node = currentNode();
  if (node !== undefined) {
    return node;
  }
  return getRootNode();
}

function hookArgFor(node: TestNode) {
  return node.isSuite && node.parent !== undefined ? node.getSuiteCtx() : node.getCtx();
}

function before(arg0: unknown, arg1: unknown) {
  const hook = createHook(arg0, arg1);
  const owner = hookOwner();
  if (owner.isRunning()) {
    owner.hooks.before.push(hook);
    if (owner.started && !owner.finished) {
      scheduleImmediateBeforeHook(owner, hook, hookArgFor(owner));
    }
    return;
  }
  const { beforeAll } = bunTest();
  beforeAll((done: (error?: unknown) => void) => {
    Promise.resolve(runHook(hook, owner, hookArgFor(owner))).then(
      () => done(),
      err => done(err ?? new Error("before hook failed")),
    );
  });
}

function after(arg0: unknown, arg1: unknown) {
  const hook = createHook(arg0, arg1);
  const owner = hookOwner();
  if (owner.isRunning()) {
    owner.hooks.after.push(hook);
    return;
  }
  const { afterAll } = bunTest();
  afterAll((done: (error?: unknown) => void) => {
    Promise.resolve(runHook(hook, owner, hookArgFor(owner))).then(
      () => done(),
      err => done(err ?? new Error("after hook failed")),
    );
  });
}

function beforeEach(arg0: unknown, arg1: unknown) {
  hookOwner().hooks.beforeEach.push(createHook(arg0, arg1));
}

function afterEach(arg0: unknown, arg1: unknown) {
  hookOwner().hooks.afterEach.push(createHook(arg0, arg1));
}

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
test.getTestContext = getTestContext;

export default test;
