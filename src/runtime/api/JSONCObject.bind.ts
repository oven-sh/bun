import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api::jsonc_object" });

export const JSONC = b.namespace({
  parse: {
    /** A buffer is converted like anything else, as for `JSON.parse`. */
    args: { input: b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] }) },
    /** What the text spells: objects and arrays of the data, or a primitive at the root. */
    returns: b.any.returning(table.plainData.fresh.spec, "null", "boolean", "number", "string"),
    capability: "heap",
    throws: true,
  },
});
