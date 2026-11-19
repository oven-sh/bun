import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::simd_testing" });

export const SimdSearch = b.enumeration([
  "indexOfChar",
  "lastIndexOfChar",
  "indexOfNotChar",
  "countChar",
  "indexOfAny",
  "lastIndexOfAny",
  "indexOfUntidySlash",
  "indexOfUntidySlashOrNonAscii",
  "lastIndexOfSlash",
  "lastIndexOfSlashOrDot",
  "commonPrefixLength",
  "countSlashes",
  "memmem",
  "memrmem",
  "memrmem16",
  "byteSetPrefixLength",
]);
export const SimdSharedSearch = b.enumeration([
  "indexOfChar",
  "lastIndexOfChar",
  "memmem",
  "memrmem",
  "memmem16",
  "memrmem16",
]);

const plain = b.bytes({ from: ["buffer"], shared: "copied" });
const shared = b.bytes({ from: ["buffer"], shared: "atomic" });

export const search = b.fn({ args: { kernel: SimdSearch, haystack: plain, needle: plain }, returns: b.f64 });
export const searchShared = b.fn({
  args: { kernel: SimdSharedSearch, haystack: shared, needle: shared },
  returns: b.f64,
});
export const scannerRunStops = b.fn({
  args: { text: plain },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
});
export const lineStarts = b.fn({ args: { text: plain }, returns: b.array(b.u32) });
export const byteBits = b.fn({ args: { text: plain, byte: b.u8 }, returns: b.array(b.u8) });
export const oddBlocks = b.fn({ args: { text: plain }, returns: b.array(b.u8) });
export const xxHash3 = b.fn({
  args: { bytes: shared, seed: b.any },
  returns: b.u64.asBigInt,
  capability: "heap",
  throws: true,
  length: 1,
});
