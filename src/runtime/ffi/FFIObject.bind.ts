import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::ffi::ffi_object_draft" });

/** An address, an offset or a length. Which kinds each takes, and its range, is for the function to say. */
export const FFINumber = b.union({ missing: b.null, number: b.jsNumber, bigInt: b.bigInt, other: b.ignored });

/** With four arguments the last is the deallocator. */
const view = {
  args: {
    ptr: FFINumber,
    byteOffset: FFINumber,
    byteLength: FFINumber,
    deallocatorContext: FFINumber,
    deallocator: FFINumber.ifPassed,
  },
  feature: "Ffi",
  returns: b.bufferSource,
  capability: "js",
  throws: true,
} as const;

export const toBuffer = b.fn({ ...view, export: "Bun__FFIObject__toBuffer" });
export const toArrayBuffer = b.fn({ ...view, export: "Bun__FFIObject__toArrayBuffer" });
