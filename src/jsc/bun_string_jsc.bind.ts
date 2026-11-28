import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bun_string_jsc" });

export const escapeRegExp = b.fn({ args: { input: b.string.allowStringObject }, returns: b.string.utf8, throws: true });
export const escapeRegExpForPackageNameMatching = b.fn({
  args: { input: b.string.allowStringObject },
  returns: b.string.utf8,
  throws: true,
});
export const toUTF16AllocSentinel = b.fn({
  args: { bytes: b.bytes({ from: ["buffer"] }) },
  returns: b.string,
  capability: "heap",
  throws: true,
});
/** The ranges that `bun_core::strings::index_of_line_ranges` gives, as `[start, end, start, end, ..]`. `count` is how many lines at most: 1 (a CSS error's line) or 6 (the code frame of a printed error). */
export const indexOfLineRanges = b.fn({
  args: { text: b.bytes({ from: ["buffer"] }), targetLine: b.u32, count: b.u32 },
  returns: b.array(b.u32),
});
