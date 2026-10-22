import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::scope_functions" });

/** What `test`, `describe` and their modifiers are bound functions of: `this` is the `ScopeFunctions`. */
export const callAsFunction = b.fn({
  export: "Bun__ScopeFunctions__callAsFunction",
  passThis: true,
  args: { description: b.any, callback: b.any, options: b.any },
  length: 1,
  capability: "js",
  throws: true,
});
