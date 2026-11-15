import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ffi::ffi_object_draft" });

/** With four arguments the last is the deallocator. */
const view = {
  args: {
    ptr: b.any,
    byteOffset: b.any.ifPassed,
    byteLength: b.any.ifPassed,
    deallocatorContext: b.any.ifPassed,
    deallocator: b.any.ifPassed,
  },
  returns: b.any,
  feature: "Ffi",
  capability: "js",
  throws: true,
} as const;

export const toBuffer = b.fn({ ...view, export: "Bun__FFIObject__toBuffer" });
export const toArrayBuffer = b.fn({ ...view, export: "Bun__FFIObject__toArrayBuffer" });
