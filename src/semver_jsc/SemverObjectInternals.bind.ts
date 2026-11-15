import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::SemverObject" });

export const intersects = b.fn({
  args: { left: b.string.loose.utf8, right: b.string.loose.utf8 },
  returns: b.bool,
  throws: true,
});
