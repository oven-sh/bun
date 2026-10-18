import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::jsc_hooks" });

export const hotReloadGeneration = b.fn({ returns: b.f64 });
