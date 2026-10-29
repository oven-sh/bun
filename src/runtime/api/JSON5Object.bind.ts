import * as b from "../../codegen/bindgen-lib.ts";

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
    returns: b.opaque,
    capability: "heap",
    throws: true,
  },
  stringify: {
    args: { value: b.opaque, replacer: b.opaque, space: b.opaque },
    returns: b.opaque,
    capability: "js",
    throws: true,
  },
});
