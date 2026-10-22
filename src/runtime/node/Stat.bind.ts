import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::stat" });

export const createStatsForIno = b.fn({
  args: { ino: b.any, big: b.bool.loose },
  returns: b.any,
  capability: "js",
  throws: true,
});
