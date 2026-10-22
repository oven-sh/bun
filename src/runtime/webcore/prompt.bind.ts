import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::prompt" });

/** `alert()` shows a message of its own. `alert(undefined)` shows "undefined". */
const dialog = { args: { args: b.any.variadic }, capability: "js", throws: true, length: 1 } as const;

export const alert = b.fn(dialog);
export const confirm = b.fn({ ...dialog, returns: b.bool });
export const prompt = b.fn({ ...dialog, returns: b.any, rustPath: "crate::webcore::prompt::prompt::prompt" });
