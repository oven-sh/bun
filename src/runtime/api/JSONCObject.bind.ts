import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::jsonc_object" });

export const JSONC = b.namespace({
  parse: {
    /** A buffer is converted like anything else, as for `JSON.parse`. */
    args: { input: b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] }) },
    returns: b.any,
    capability: "heap",
    throws: true,
  },
});
