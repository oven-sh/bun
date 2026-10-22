import * as b from "../../codegen/bindgen-lib.ts";

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
