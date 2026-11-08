import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api::json5_object" });

export const JSON5 = b.namespace({
  parse: {
    args: {
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        refuse: ["undefined", "null"],
      }),
    },
    /** What the text spells: objects and arrays of the data, or a primitive at the root. */
    returns: b.any.returning(table.plainData.fresh.spec, "null", "boolean", "number", "string"),
    capability: "heap",
    throws: true,
  },
  stringify: {
    args: { value: b.any, replacer: b.any, space: b.any },
    returns: b.any,
    capability: "js",
    throws: true,
  },
});
