import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::cares_jsc" });

export const canonicalizeIP = b.fn({ args: { address: b.any }, returns: b.any, capability: "js", throws: true });
