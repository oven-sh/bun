import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::hw_exports" });

export const drainMicrotasks = b.fn({ capability: "js" });
