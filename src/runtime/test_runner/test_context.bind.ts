import * as b from "../../codegen/bindgen-lib.ts";
import { CallbackOrOptions, DescriptionOrCallback } from "./ScopeFunctions.bind.ts";

export default b.module({ rustPath: "crate::test_runner::test_context" });

const js = { capability: "js", throws: true } as const;
const member = { getter: b.any, cache: true, passThis: true, capability: "js", throws: true } as const;

/** Vitest's test context. */
export const TestContext = b.class({
  rustPath: "crate::test_runner::test_context::TestContext",
  /** For a Jest-style `done()` call, which throws. */
  callInstance: { returns: b.any, capability: "js", throws: true },
  internalFields: ["result", "errors", "annotations", "fixtures", "asyncContext"],
  proto: {
    task: member,
    expect: member,
    signal: member,
    skip: member,
    onTestFinished: member,
    onTestFailed: member,
    annotate: member,
  },
});

/** A running `aroundEach` or `aroundAll` hook. */
export const AroundHook = b.class({
  rustPath: "crate::test_runner::test_context_around::AroundHook",
  internalFields: ["context", "outerAsyncContext", "ready", "release", "done"],
});

/** Fixtures defined by `test.extend()`. */
export const TestFixtures = b.class({
  rustPath: "crate::test_runner::test_context_fixtures::TestFixtures",
  internalFields: ["values", "scoped"],
});

/** A fixture between its setup and its teardown. */
export const ActiveFixture = b.class({
  rustPath: "crate::test_runner::test_context_fixtures::ActiveFixture",
  internalFields: ["fixtures", "context", "value", "ready", "release", "returned", "cleanup"],
});

/** What a member of the test context is a bound function of: `this` is the `TestContext`. */
const ofContext = (name: string) => ({ export: `Bun__TestContext__${name}`, passThis: true, ...js }) as const;
export const expect = b.fn({ ...ofContext("expect"), args: { received: b.any, message: b.any }, returns: b.any });
export const soft = b.fn({ ...ofContext("soft"), args: { received: b.any, message: b.any }, returns: b.any });
export const poll = b.fn({ ...ofContext("poll"), args: { callback: b.any, options: b.any }, returns: b.any });
export const assertions = b.fn({ ...ofContext("assertions"), args: { count: b.any } });
export const hasAssertions = b.fn(ofContext("hasAssertions"));
export const getState = b.fn({ ...ofContext("getState"), returns: b.any });
export const setState = b.fn({ ...ofContext("setState"), args: { state: b.any } });
/** `skip(note?)` or `skip(condition, note?)` */
export const skip = b.fn({ ...ofContext("skip"), args: { condition: b.any, note: b.any } });
/** `onTestFinished` and `onTestFailed` are both bound to this, with `onlyIfFailed` as the first argument. The other arguments are a hook's. */
export const deferHook = b.fn({
  ...ofContext("deferHook"),
  args: { onlyIfFailed: b.bool, first: DescriptionOrCallback, second: CallbackOrOptions, third: CallbackOrOptions },
});
/** `annotate(message, type?, attachment?)` or `annotate(message, attachment?)` */
export const annotate = b.fn({
  ...ofContext("annotate"),
  args: { message: b.any, kind: b.any, attachment: b.any },
  returns: b.any,
});

/** `TestRunner.getCurrentTest()` */
export const getCurrentTest = b.fn({ export: "Bun__TestContext__getCurrentTest", returns: b.any, ...js });
/** `this` is the reason. */
export const rejectWithThis = b.fn({
  export: "Bun__TestContext__rejectWithThis",
  passThis: true,
  returns: b.any,
  capability: "js",
});

const around = (name: string, rustName: string) =>
  ({
    export: `Bun__AroundHook__${name}`,
    rustPath: `crate::test_runner::test_context_around::${rustName}`,
    ...js,
  }) as const;
/** What it is a bound function of: `this` is the `AroundHook`. */
const ofAround = (name: string, rustName: string) => ({ ...around(name, rustName), passThis: true }) as const;
/** The setup entry's callback. `context` and `suite` are the hook's last two arguments. */
export const aroundSetUp = b.fn({
  ...around("setUp", "set_up"),
  args: { aroundHook: b.any, hook: b.any, context: b.any, suite: b.any },
  returns: b.any,
});
export const aroundOnFulfilled = b.fn(ofAround("onFulfilled", "on_fulfilled"));
export const aroundOnRejected = b.fn({ ...ofAround("onRejected", "on_rejected"), args: { reason: b.any } });
/** `runTest()` or `runSuite()` */
export const aroundRun = b.fn({ ...ofAround("run", "run"), returns: b.any });
/** The teardown entry's callback. */
export const aroundTearDown = b.fn({ ...ofAround("tearDown", "tear_down"), returns: b.any });
/** Returns its argument, bound to the async context it's called in. */
export const adoptAsyncContext = b.fn({
  export: "Bun__AroundHook__adoptAsyncContext",
  rustPath: "crate::test_runner::test_context_around::adopt_async_context",
  args: { callback: b.any },
  returns: b.any,
  capability: "js",
});

/** What it is a bound function of: `this` is the `ActiveFixture`. */
const ofFixture = (name: string, rustName: string) =>
  ({
    export: `Bun__ActiveFixture__${name}`,
    rustPath: `crate::test_runner::test_context_fixtures::${rustName}`,
    passThis: true,
    ...js,
  }) as const;
export const fixtureSetUp = b.fn({ ...ofFixture("setUp", "set_up"), returns: b.any });
export const fixtureOnFulfilled = b.fn({ ...ofFixture("onFulfilled", "on_fulfilled"), args: { returned: b.any } });
export const fixtureOnRejected = b.fn({ ...ofFixture("onRejected", "on_rejected"), args: { reason: b.any } });
export const useFixture = b.fn({ ...ofFixture("useFixture", "use_fixture"), args: { value: b.any }, returns: b.any });
export const fixtureOnCleanup = b.fn({ ...ofFixture("onCleanup", "on_cleanup"), args: { cleanup: b.any } });
export const fixtureTearDown = b.fn({ ...ofFixture("tearDown", "tear_down"), returns: b.any });
