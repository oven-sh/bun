import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::resolver_jsc" });

export const _nodeModulePaths = b.fn({ args: { path: b.string.allowStringObject }, returns: b.array(b.string) });
