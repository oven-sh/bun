import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ini_jsc" });

export const parse = b.fn({
  args: { source: b.string.loose.utf8 },
  returns: b.any,
  capability: "heap",
  throws: true,
});

export const loadNpmrc = b.fn({
  args: { contents: b.string.loose.utf8, env: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
