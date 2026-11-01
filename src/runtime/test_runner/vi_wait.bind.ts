import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::test_runner::vi_wait" });

const js = { capability: "js", throws: true } as const;

/** `options` is a timeout or `{ interval, timeout }`. */
const wait = { args: { callback: b.any, options: b.any }, returns: b.any, ...js } as const;
export const waitFor = b.fn({ ...wait, export: "Bun__ViWait__waitFor" });
export const waitUntil = b.fn({ ...wait, export: "Bun__ViWait__waitUntil" });
