import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::yaml_object" });

export const YAML = b.namespace({
  parse: {
    /** A key that is a sequence or a mapping is converted to a string, which can run JavaScript, once the input is parsed. */
    args: {
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        shared: "copied",
        held: "handle",
      }),
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
