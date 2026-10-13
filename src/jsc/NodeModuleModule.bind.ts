import * as b from "../codegen/bindgen-lib.ts";

export const _stat = b.fn({
  args: {
    str: b.string.utf8.loose,
  },
  returns: b.i32,
  rustPath: "crate::node_module_module::stat",
});
