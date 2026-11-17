import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::toml_object" });

export const TOML = b.namespace({
  parse: {
    args: {
      input: b.bytes({
        from: ["string", "buffer", "blob"],
        otherwise: "toString",
        refuse: ["undefined", "null"],
        shared: "copied",
      }),
    },
    returns: b.any,
    capability: "heap",
    throws: true,
  },
  stringify: {
    args: { value: b.any, replacer: b.any },
    returns: b.any,
    capability: "js",
    throws: true,
    /** As for YAML and JSON5. `space` is ignored: the output is line-oriented and has no nesting indentation. */
    length: 3,
  },
});
