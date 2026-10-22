import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::rare_data" });

export const setTLSDefaultCiphers = b.fn({ args: { ciphers: b.any }, capability: "js", throws: true });
export const getTLSDefaultCiphers = b.fn({ returns: b.string.utf8, capability: "heap" });
