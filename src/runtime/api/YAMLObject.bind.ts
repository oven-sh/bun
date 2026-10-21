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
        /** A longer input is a RangeError before the parser reads a byte of it. */
        longest: 2 ** 31 - 1,
        held: "handle",
      }),
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
