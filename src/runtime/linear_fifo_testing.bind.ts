import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::linear_fifo_testing" });

export const orderedRemoveProbe = b.fn({ args: { scenario: b.i32 }, returns: b.array(b.i32) });
