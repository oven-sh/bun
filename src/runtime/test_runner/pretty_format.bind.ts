import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::pretty_format::JestPrettyFormat" });

const js = { returns: b.any, capability: "js", throws: true } as const;

/** What a snapshot serializer's `serialize()` gets as `printer`. */
export const printer = b.fn({
  export: "Bun__JestPrettyFormat__printer",
  args: { value: b.any, config: b.any, indentation: b.any, depth: b.any, refs: b.any, hasCalledToJSON: b.bool.loose },
  ...js,
});
/** What a snapshot serializer's `print()` gets as `print` and `indent`. All but the last argument of each are bound. */
export const printChild = b.fn({
  export: "Bun__JestPrettyFormat__printChild",
  args: { config: b.any, indentation: b.any, refs: b.any, value: b.any },
  ...js,
});
export const indent = b.fn({
  export: "Bun__JestPrettyFormat__indent",
  args: { indentation: b.any, text: b.any },
  ...js,
});
