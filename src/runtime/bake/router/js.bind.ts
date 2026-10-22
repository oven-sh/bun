import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bake::router::JSFrameworkRouter" });

export const parseRoutePattern = b.fn({
  args: { style: b.any, filepath: b.any },
  returns: b.any,
  length: 1,
  capability: "js",
  throws: true,
});
