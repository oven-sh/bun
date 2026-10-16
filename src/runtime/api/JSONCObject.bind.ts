import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::jsonc_object" });

export const JSONC = b.namespace({
  parse: {
    /** A buffer is converted like anything else, as for `JSON.parse`. The body refuses `undefined` and `null`. */
    args: { input: b.string.loose.utf8.withValue },
    returns: b.any,
    capability: "js",
    throws: true,
  },
});
