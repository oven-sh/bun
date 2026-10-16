import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::json5_object" });

export const JSON5 = b.namespace({
  parse: {
    /** `undefined` and `null` are refused, not converted. */
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
