import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ffi::ffi_object_draft" });

/** `(ptr, byteOffset?, byteLength?, deallocatorContext?, deallocator?)`, or with four arguments the last is the deallocator. */
const view = { args: { ptr: b.any, rest: b.any.variadic }, returns: b.any, capability: "js", throws: true } as const;

export const toBuffer = b.fn({ ...view, export: "Bun__FFIObject__toBuffer" });
export const toArrayBuffer = b.fn({ ...view, export: "Bun__FFIObject__toArrayBuffer" });
