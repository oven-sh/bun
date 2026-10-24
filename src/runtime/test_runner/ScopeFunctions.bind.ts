import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::scope_functions" });

/** What `test`, `describe` and the hooks take in place of a timeout. */
export const BunTestOptions = b.dictionary(
  { timeout: b.f64.optional, retry: b.f64.optional, repeats: b.f64.optional },
  { allowArray: true, reportedAs: "options" },
);

/** A function here is the callback if none follows it, and else what the test is named after. */
export const DescriptionOrCallback = b.union({
  none: b.null,
  function: b.callable,
  text: b.string.utf8.owned,
  number: b.f64,
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
  args: { first: DescriptionOrCallback, second: CallbackOrOptions, third: CallbackOrOptions },
  expected: {
    first: "The first argument must be a named class, named function, number, or string",
    second: "The second argument must be a function, number, or object",
    third: "The third argument must be a function, number, or object",
  },
  capability: "js",
  throws: true,
});
