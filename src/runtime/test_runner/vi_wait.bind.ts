import * as b from "../../codegen/bindgen-lib.ts";

/** A `vi.waitFor()` or `vi.waitUntil()` that hasn't settled. */
export const ViWait = b.class({
  rustPath: "crate::test_runner::vi_wait::ViWait",
  internalFields: ["callback", "promise", "lastError", "timeoutError"],
});
