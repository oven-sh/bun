import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_net_binding" });

export const newDetachedSocket = b.fn({ args: { isSSL: b.bool }, returns: b.any, capability: "js" });
