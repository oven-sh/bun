import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::exec", feature: "Desktop" });

const reaction = { args: { value: b.any, id: b.any }, capability: "js" } as const;
export const onFulfilled = b.fn({ ...reaction, export: "Bun__Web__onFulfilled" });
export const onRejected = b.fn({ ...reaction, export: "Bun__Web__onRejected" });

/** No script of a page runs until `promise` is fulfilled. */
export const block = b.fn({ args: { promise: b.any }, returns: b.any, capability: "js" });
