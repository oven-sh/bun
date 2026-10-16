import * as b from "../codegen/bindgen-lib.ts";

export const _stat = b.fn({
  args: {
    str: b.string.loose.utf8,
  },
  returns: b.i32,
  rustPath: "crate::node_module_module::stat",
});
