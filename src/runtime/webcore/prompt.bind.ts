import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::prompt" });

/** `alert()` shows a message of its own. `alert(undefined)` shows "undefined". */
const message = b.string.loose.utf8.ifPassed;

export const alert = b.fn({ args: { message }, length: 1 });
export const confirm = b.fn({ args: { message }, returns: b.bool, length: 1 });
/** An empty answer returns `defaultValue` as it is. */
export const prompt = b.fn({
  args: { message, defaultValue: b.any.ifPassed },
  returns: b.any,
  capability: "js",
  throws: true,
  length: 1,
});
