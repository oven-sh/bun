import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::testing" });

export const parse = b.fn({
  args: { patchfile: b.string.loose.utf8 },
  returns: b.string.utf8,
  capability: "heap",
  throws: true,
});

export const apply = b.fn({
  args: { patchfile: b.string.loose.utf8, dir: b.string.loose.utf8.optional },
  returns: b.bool,
  capability: "js",
  throws: true,
  length: 2,
});

export const makeDiff = b.fn({
  args: { oldFolder: b.string.loose.utf8, newFolder: b.string.loose.utf8 },
  returns: b.string.utf8,
  capability: "js",
  throws: true,
});
