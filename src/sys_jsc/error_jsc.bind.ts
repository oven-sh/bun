import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::error_jsc::testing_apis" });

export const translateNtStatusToE = b.fn({ args: { status: b.f64 }, returns: b.string.utf8.optional });
export const translateUVErrorToE = b.fn({ args: { code: b.f64 }, returns: b.string.utf8.optional });

export const SigactionHandlerAndFlags = b.dictionary({ handler: b.usize, flags: b.i32 });
export const SigactionLayout = b.dictionary({
  installed: SigactionHandlerAndFlags,
  readback: SigactionHandlerAndFlags,
  sizeof: { type: b.usize, rustName: "size" },
});
export const sigactionLayout = b.fn({ returns: SigactionLayout.optional });
