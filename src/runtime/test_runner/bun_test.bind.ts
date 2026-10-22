import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::bun_test::js_fns::generic_hook" });

const js = { capability: "js", throws: true } as const;

/** The arguments come in any of the orders that `parse_arguments` takes. */
const hook = (name: string) =>
  b.fn({
    export: `Bun__BunTest__${name}`,
    args: { description: b.any, callback: b.any, options: b.any },
    length: 1,
    ...js,
  });
export const beforeAll = hook("beforeAll");
export const beforeEach = hook("beforeEach");
export const afterEach = hook("afterEach");
export const afterAll = hook("afterAll");
export const onTestFinished = hook("onTestFinished");

/** The reactions to the promise that a test or a hook returns. `context` is its `RefData`. */
const reaction = { args: { value: b.any, context: b.any }, ...js } as const;
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
