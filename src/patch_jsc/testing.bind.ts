import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::testing::TestingAPIs" });

export const parse = b.fn({
  args: { patchfile: b.string.loose.utf8 },
  returns: b.string.utf8,
  capability: "heap",
  throws: true,
});

/** `dir` is converted before `patchfile`. */
export const apply = b.fn({
  args: { patchfile: b.any, dir: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});

export const makeDiff = b.fn({
  args: { oldFolder: b.string.loose.utf8, newFolder: b.string.loose.utf8 },
  returns: b.string.utf8,
  capability: "js",
  throws: true,
});
