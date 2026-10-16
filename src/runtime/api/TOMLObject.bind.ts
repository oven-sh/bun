import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::toml_object" });

export const TOML = b.namespace({
  parse: {
    /** The body refuses `undefined` and `null`. */
    args: { input: b.stringOrBuffer.orBlob.loose.withValue },
    returns: b.any,
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
