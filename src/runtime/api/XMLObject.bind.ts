import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::xml_object" });

export const XML = b.namespace({
  parse: {
    args: {
      /** A string is parsed in its own encoding, and not as UTF-8. */
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        refuse: ["undefined", "null"],
        string: "asIs",
        held: "handle",
      }),
      options: b.opaque,
    },
    returns: b.opaque,
    capability: "js",
    throws: true,
  },
  stringify: {
    args: { value: b.opaque, replacer: b.opaque, space: b.opaque },
    returns: b.opaque,
    capability: "js",
    throws: true,
  },
});
