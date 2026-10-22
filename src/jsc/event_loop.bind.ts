import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::event_loop" });

export const getActiveTasks = b.fn({ returns: b.any, capability: "heap" });
