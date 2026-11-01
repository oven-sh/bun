import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::expect_core::expect_deferred" });

const js = { capability: "js", throws: true } as const;

/** A matcher call waiting on a promise. */
export const ExpectDeferred = b.class({
  rustPath: "crate::test_runner::expect_core::expect_deferred::ExpectDeferred",
  internalFields: ["expect", "call", "promise", "callSite", "awaited", "journal"],
});

/** Called with what `awaited` settled with, and the `ExpectDeferred`. */
export const onSettled = b.fn({
  export: "Bun__ExpectDeferred__onSettled",
  args: { value: b.any, deferred: b.any },
  ...js,
});
/** One attempt of `expect.poll()`. Both arguments are bound. */
export const pollOnce = b.fn({
  export: "Bun__ExpectDeferred__pollOnce",
  args: { callback: b.any, check: b.any },
  returns: b.any,
  ...js,
});
/** Runs the matcher on what the polled function returned. `expect` and `call` are bound. */
export const checkPolled = b.fn({
  export: "Bun__ExpectDeferred__checkPolled",
  args: { expect: b.any, call: b.any, value: b.any },
  returns: b.any,
  ...js,
});
