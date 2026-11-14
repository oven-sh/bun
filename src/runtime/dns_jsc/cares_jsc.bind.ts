import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::cares_jsc" });

/** An address that is already canonical is returned as it was given. */
export const canonicalizeIP = b.fn({
  args: { address: b.string.loose.utf8.withValue },
  returns: b.any,
  capability: "js",
  throws: true,
});
