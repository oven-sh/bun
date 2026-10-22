import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::hosted_git_info_jsc" });

export const parseUrl = b.fn({
  args: { url: b.string },
  returns: b.string,
  capability: "heap",
  throws: true,
});

export const fromUrl = b.fn({
  args: { url: b.string },
  returns: b.any,
  capability: "heap",
  throws: true,
});
