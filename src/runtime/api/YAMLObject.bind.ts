import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::yaml_object" });

export const YAML = b.namespace({
  parse: {
    /** A key that is a sequence or a mapping is converted to a string, which can run JavaScript. `undefined` and `null` are converted like anything else. */
    args: { input: b.any },
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
