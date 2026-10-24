import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::json5_object" });

export const JSON5 = b.namespace({
  parse: {
    args: {
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        refuse: ["undefined", "null"],
        held: "handle",
      }),
      reviver: b.any,
    },
    returns: b.any,
    capability: "js",
    throws: true,
  },
  stringify: {
    args: { value: b.any, replacer: b.any, space: b.any },
    returns: b.any,
    capability: "js",
    throws: true,
  },
});
