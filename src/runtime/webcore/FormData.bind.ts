import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::form_data" });

export const from = b.fn({
  args: { input: b.any, boundary: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
  length: 1,
});
