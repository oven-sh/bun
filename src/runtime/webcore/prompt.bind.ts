import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::prompt" });

/** `alert()` shows a message of its own. `alert(undefined)` shows "undefined". */
const message = b.string.loose.utf8.ifPassed;

export const alert = b.fn({ args: { message } });
export const confirm = b.fn({ args: { message }, returns: b.bool });
/** `null` is the end of the input. An empty answer is `defaultValue`, and "" without one. */
export const prompt = b.fn({
  args: { message, defaultValue: b.string.loose.optional },
  returns: b.string.nullable,
});
