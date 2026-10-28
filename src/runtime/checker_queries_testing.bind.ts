import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::checker_queries_testing" });

/** `undefined` in a Bun without the compiler. */
export const describeCheckerQueries = b.fn({
  args: { entryPoint: b.string.loose.utf8, threads: b.i32.optional },
  returns: b.string.utf8.optional,
  capability: "js",
  throws: true,
});
