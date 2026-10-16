import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::xml_object" });

export const XML = b.namespace({
  parse: {
    /** A string is parsed in its own encoding, Latin-1 or UTF-16, and not as UTF-8. */
    args: { input: b.any, options: b.any },
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
