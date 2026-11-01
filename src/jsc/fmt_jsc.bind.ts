import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::fmt_jsc::js_bindings" });

export const Formatter = b.enumeration(["highlight-javascript", "highlight-javascript-redacted", "escape-powershell"]);

export const fmtString = b.fn({
  args: {
    code: b.string.loose.utf8,
    formatter: Formatter,
  },
  returns: b.string,
  throws: true,
});
