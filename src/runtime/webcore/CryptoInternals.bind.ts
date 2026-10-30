import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::crypto" });

/** `random_get` of `node:wasi`, whose memory can be shared or resizable. */
export const fillRandom = b.fn({ args: { view: b.bufferSource.allowShared }, capability: "heap" });
