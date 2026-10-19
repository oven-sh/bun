import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::jest" });

export const fileGeneration = b.fn({ returns: b.u32 });
export const nodeTestMarkResult = b.fn({ args: { todo: b.bool, done: b.any } });
