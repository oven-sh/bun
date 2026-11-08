import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::environment" });

export const isInPreload = b.fn({ returns: b.bool });
/** Takes off (`on` is false) or puts back on what a preload's `vi.stubGlobal()` has in place of globals. `coveredStubs` is what the last call returned. */
export const moveReplacements = b.fn({ args: { on: b.bool, coveredStubs: b.any }, returns: b.any, capability: "js" });
