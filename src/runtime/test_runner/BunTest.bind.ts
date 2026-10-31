import * as b from "../../codegen/bindgen-lib.ts";
import { CallbackOrOptions, DescriptionOrCallback } from "./ScopeFunctions.bind.ts";

// Not `bun_test.bind.ts`: a release build leaves out a `*_test.bind.ts`.
export default b.module({ rustPath: "crate::test_runner::bun_test::js_fns::generic_hook" });

const js = { capability: "js", throws: true } as const;

/** Takes what `callAsFunction` does. */
const hook = (name: string) =>
  b.fn({
    export: `Bun__BunTest__${name}`,
    args: { first: DescriptionOrCallback, second: CallbackOrOptions, third: CallbackOrOptions },
    expected: {
      first: `${name}() expects a function as the first argument`,
      second: `${name}() expects a number or object as the second argument`,
      third: `${name}() expects a number or object as the third argument`,
    },
    ...js,
  });
export const beforeAll = hook("beforeAll");
export const beforeEach = hook("beforeEach");
export const afterEach = hook("afterEach");
export const afterAll = hook("afterAll");
export const onTestFinished = hook("onTestFinished");

/** The reactions to the promise that a test or a hook returns. */
const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::test_runner::bun_test::RefData") },
  ...js,
} as const;
export const bunTestThen = b.fn({
  ...reaction,
  export: "Bun__TestScope__Describe2__bunTestThen",
  rustPath: "crate::test_runner::bun_test::BunTest::bun_test_then",
});
export const bunTestCatch = b.fn({
  ...reaction,
  export: "Bun__TestScope__Describe2__bunTestCatch",
  rustPath: "crate::test_runner::bun_test::BunTest::bun_test_catch",
});

/** What the `done` of a test callback is a bound function of. `this` is the `DoneCallback`. */
export const bunTestDoneCallback = b.fn({
  export: "Bun__BunTest__bunTestDoneCallback",
  rustPath: "crate::test_runner::bun_test::BunTest::bun_test_done_callback",
  passThis: true,
  args: { error: b.any },
  ...js,
});
