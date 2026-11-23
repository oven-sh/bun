import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::markdown_object" });

export const setMaxMarkdownBlockBytesForTesting = b.fn({ args: { limit: b.f64 }, returns: b.usize });
