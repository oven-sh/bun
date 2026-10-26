import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::stat" });

/** A number is converted as `JSValue::to_uint64_no_truncate` does. */
export const Ino = b.union({ number: b.f64, bigint: b.u64.allowBigInt });
export const createStatsForIno = b.fn({
  args: { ino: Ino, big: b.bool.loose },
  returns: b.any,
  capability: "js",
  throws: true,
});
