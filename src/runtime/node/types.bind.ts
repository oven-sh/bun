import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::types" });

export const assertEncodingValid = b.fn({ args: { encoding: b.any }, capability: "js", throws: true });
