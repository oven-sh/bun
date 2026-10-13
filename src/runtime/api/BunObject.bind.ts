import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::bun_object" });

export const BracesOptions = b.dictionary("BracesOptions", {
  tokenize: b.bool.loose.default(false),
  parse: b.bool.loose.default(false),
});

export const braces = b.fn({
  args: {
    input: b.string.loose,
    options: BracesOptions.nullable.default({}),
  },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const gc = b.fn({
  args: {
    force: b.bool.loose.default(false),
  },
  returns: b.usize,
  capability: "js",
  rustPath: "crate::api::bun_object::gc_from_js",
});
