import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::file_sink" });

/** A `FileSink` with no poll on a duplicate of `fd`, or `undefined` if `fd` is not a terminal. Always `undefined` on Windows. */
export const openUnwatchedTerminal = b.fn({ args: { fd: b.i32 }, returns: b.any, capability: "js" });
