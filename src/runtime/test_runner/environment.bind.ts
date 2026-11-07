import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::environment" });

export const isInPreload = b.fn({ returns: b.bool });
/** Takes off (`on` is false) or puts back on what fake timers and a preload's `vi.stubGlobal()` have in place of globals. */
export const moveReplacements = b.fn({ args: { on: b.bool }, capability: "js" });
