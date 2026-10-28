import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::util::parse_args" });

export const parseArgs = b.fn({ args: { config: b.opaque }, returns: b.opaque, capability: "js", throws: true });
