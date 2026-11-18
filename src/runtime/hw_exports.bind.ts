import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::hw_exports" });

export const drainMicrotasks = b.fn({ capability: "js" });

/** The reactions to the promise that `bun --print` evaluated to. Both exit the process. */
const reaction = { args: { value: b.any }, capability: "js" } as const;
export const onResolveEntryPointResult = b.fn({ ...reaction, export: "Bun__onResolveEntryPointResult" });
export const onRejectEntryPointResult = b.fn({ ...reaction, export: "Bun__onRejectEntryPointResult" });
