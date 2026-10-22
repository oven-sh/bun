import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::color_js" });

export const color = b.fn({
  args: { input: b.any, format: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
