import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::counters" });

export const CountersObject = b.dictionary({ spawnSync_blocking: b.i32, spawn_memfd: b.i32 });

export const createCountersObject = b.fn({ returns: CountersObject, capability: "heap" });
