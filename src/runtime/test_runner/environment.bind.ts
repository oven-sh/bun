import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::environment" });

export const isInPreload = b.fn({ returns: b.bool });
/** Undoes every `vi.stubGlobal()` (`on` is false), or makes the stubs of the preloads again. */
export const moveReplacements = b.fn({ args: { on: b.bool }, capability: "js" });
/** Whether `globalThis` has `name` only as a `vi.stubGlobal()` stub of a preload, with nothing under it. */
export const isOnlyAStub = b.fn({ args: { name: b.any }, returns: b.bool, capability: "js" });
