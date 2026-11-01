import * as b from "../../codegen/bindgen-lib.ts";
import { CallbackOrOptions, DescriptionOrCallback } from "./ScopeFunctions.bind.ts";

// Not `bun_test.bind.ts`: a release build leaves out a `*_test.bind.ts`.
export default b.module({ rustPath: "crate::test_runner::bun_test::js_fns" });

const js = { capability: "js", throws: true } as const;

/**
 * All hooks call this one function. Each hook is bound to it with `hook`, a number that identifies the hook, as the first argument.
 * The other arguments are the same as `callAsFunction`'s.
 * `this` is the `TestFixtures` of an extended `test`, if the hook is one of its members.
 */
export const hook = b.fn({
  export: "Bun__BunTest__hook",
  passThis: true,
  args: { hook: b.u8, first: DescriptionOrCallback, second: CallbackOrOptions, third: CallbackOrOptions },
  ...js,
});

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
