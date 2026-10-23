import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::bake::router::JSFrameworkRouter" });

export const RoutePatternKind = b.enumeration(["page", "layout", "extra"]);
export const RoutePattern = b.dictionary({ kind: RoutePatternKind, pattern: b.string.utf8 });

export const parseRoutePattern = b.fn({
  args: { style: b.any, filepath: b.string.loose.utf8 },
  returns: RoutePattern.nullable,
  length: 1,
  capability: "js",
  throws: true,
});
