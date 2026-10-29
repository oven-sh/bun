import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ini_jsc" });

export const parse = b.fn({
  args: { source: b.string.loose.utf8 },
  returns: b.object,
  capability: "heap",
  throws: true,
});

export const loadNpmrc = b.fn({
  args: { contents: b.string.loose.utf8, env: b.opaque },
  returns: b.opaque,
  capability: "js",
  throws: true,
});
