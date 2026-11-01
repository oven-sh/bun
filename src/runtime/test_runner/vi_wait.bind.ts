import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::vi_wait" });

const js = { capability: "js", throws: true } as const;

/** A `vi.waitFor()` or `vi.waitUntil()` that hasn't settled. */
export const ViWait = b.class({
  rustPath: "crate::test_runner::vi_wait::ViWait",
  internalFields: ["callback", "promise", "lastError", "timeoutError"],
});

/** `options` is a timeout or `{ interval, timeout }`. */
const wait = { args: { callback: b.any, options: b.any }, returns: b.any, ...js } as const;
export const waitFor = b.fn({ ...wait, export: "Bun__ViWait__waitFor" });
export const waitUntil = b.fn({ ...wait, export: "Bun__ViWait__waitUntil" });

/** The reactions to a thenable that the callback returned. `this` is the `ViWait`. */
export const onFulfilled = b.fn({ export: "Bun__ViWait__onFulfilled", passThis: true, args: { value: b.any }, ...js });
export const onRejected = b.fn({ export: "Bun__ViWait__onRejected", passThis: true, args: { reason: b.any }, ...js });
