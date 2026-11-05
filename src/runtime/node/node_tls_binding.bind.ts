import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::cli::Arguments" });

export const CAStore = b.enumeration(["bundled", "system", "openssl"]);

export const getCAStore = b.fn({ returns: CAStore });
