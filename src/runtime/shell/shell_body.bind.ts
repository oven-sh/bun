import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shell::shell_body::testing_apis" });

/** `strings` and `templateArgs` are array-likes that are read in turn, one element of each at a time. */
const template = {
  args: { strings: b.any, templateArgs: b.any },
  returns: b.string.utf8,
  capability: "js",
  throws: true,
} as const;

export const disabledOnThisPlatform = b.fn({ args: { builtin: b.string.loose.utf8 }, returns: b.bool });
export const shellLex = b.fn(template);
export const shellParse = b.fn(template);
