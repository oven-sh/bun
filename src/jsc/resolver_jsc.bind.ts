import * as b from "../codegen/bindgen-lib.ts";

export const _nodeModulePaths = b.fn({
  args: { path: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
  rustPath: "crate::resolver_jsc::node_module_paths",
});
