import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::counters" });

export const createCountersObject = b.fn({ returns: b.any, capability: "heap", throws: true });
