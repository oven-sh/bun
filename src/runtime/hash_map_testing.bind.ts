import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::hash_map_testing" });

export const ChurnProbeResult = b.dictionary({
  capacity: b.usize,
  length: b.usize,
  maxComparisons: b.usize,
});

export const churnProbe = b.fn({
  args: { live: b.u32.enforceRange(0, 1 << 20), cycles: b.u32.enforceRange(0, 1 << 24) },
  returns: ChurnProbeResult,
});
