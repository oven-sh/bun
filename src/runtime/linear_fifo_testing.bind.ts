import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::linear_fifo_testing" });

export const orderedRemoveProbe = b.fn({ args: { scenario: b.any }, returns: b.array(b.i32) });
