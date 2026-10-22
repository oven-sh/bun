import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::shell::shell_body::testing_apis" });

const template = {
  args: { strings: b.any, templateArgs: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
} as const;

export const disabledOnThisPlatform = b.fn({
  args: { builtin: b.any },
  returns: b.bool,
  capability: "js",
  throws: true,
});
export const shellLex = b.fn(template);
export const shellParse = b.fn(template);
