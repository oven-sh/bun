import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::jsc_hooks" });

export const hotReloadGeneration = b.fn({ returns: b.f64 });

/** The reactions to the import of a Worker's preload. `index` is its place in the Worker's list of preloads. */
const reaction = { args: { value: b.any, index: b.u32 }, capability: "js" } as const;
export const onWorkerPreloadFulfilled = b.fn({ ...reaction, export: "Bun__Worker__onPreloadFulfilled" });
export const onWorkerPreloadRejected = b.fn({ ...reaction, export: "Bun__Worker__onPreloadRejected" });
