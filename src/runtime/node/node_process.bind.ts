import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::process" });

export const setStdioBlocking = b.fn({ args: { fd: b.i32, blocking: b.bool }, returns: b.i32 });
