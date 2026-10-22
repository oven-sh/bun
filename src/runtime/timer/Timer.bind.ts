import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::timer::timer::internal_bindings" });

export const monotonicNowMs = b.fn({ returns: b.f64 });
