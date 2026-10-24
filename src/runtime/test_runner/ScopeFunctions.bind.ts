import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::scope_functions" });

/** Only Vitest's `test` and `describe` take the object. */
export const RetryOptions = b.dictionary({ count: b.f64.optional }, { reportedAs: "options.retry" });
export const Retry = b.union({ count: b.f64, options: RetryOptions });

const modifier = b.bool.loose.optional;
/** What `test`, `describe` and the hooks take in place of a timeout. Only Vitest's `test` and `describe` use the modifiers. */
export const BunTestOptions = b.dictionary(
  {
    timeout: b.f64.optional,
    retry: Retry.optional,
    repeats: b.f64.optional,
    only: modifier,
    skip: modifier,
    todo: modifier,
    fails: modifier,
    shuffle: modifier,
    concurrent: modifier,
    sequential: modifier,
  },
  { allowArray: true, reportedAs: "options" },
);

/**
 * A function here is the callback if none follows it, and else what the test is named after.
 * Only Vitest's `test` and `describe` take `other`: they name a test after any value.
 */
export const DescriptionOrCallback = b.union({
  none: b.null,
  function: b.callable,
  text: b.string.utf8.owned,
  number: b.f64,
  other: b.any,
});
export const CallbackOrOptions = b.union({
  none: b.null,
  callback: b.callable,
  timeout: b.f64,
  options: BunTestOptions,
});

/**
 * What `test`, `describe` and their modifiers are bound functions of: `this` is the `ScopeFunctions`.
 * `(description?, callback, options?)`, `(description, options, callback)` or `(callback, options?)`.
 */
export const callAsFunction = b.fn({
  export: "Bun__ScopeFunctions__callAsFunction",
  passThis: true,
  args: { first: DescriptionOrCallback.withValue, second: CallbackOrOptions, third: CallbackOrOptions },
  expected: {
    second: "The second argument must be a function, number, or object",
    third: "The third argument must be a function, number, or object",
  },
  capability: "js",
  throws: true,
});
