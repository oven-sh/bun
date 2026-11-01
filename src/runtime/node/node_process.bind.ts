import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_process" });

/** `process.stdout._handle.setBlocking(blocking)`. Returns 0 or a negative errno. */
export const setStdioBlocking = b.fn({ args: { fd: b.i32, blocking: b.bool }, returns: b.i32 });
