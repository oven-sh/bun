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
