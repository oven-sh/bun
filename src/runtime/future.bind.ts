import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::future" });

const reaction = {
  args: { value: b.any, context: b.nativePromiseContext("crate::future::Reaction") },
  capability: "js",
} as const;

/** The reactions to a promise that a Rust future awaits. */
export const onFulfilled = b.fn({ ...reaction, export: "Bun__Future__onFulfilled" });
export const onRejected = b.fn({ ...reaction, export: "Bun__Future__onRejected" });
