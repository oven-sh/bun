import * as b from "../codegen/bindgen-lib.ts";

export const _stat = b.fn({
  args: {
    str: b.string.loose.utf8,
  },
  returns: b.i32,
  rustPath: "crate::node_module_module::stat",
});

export const setGlobalFolders = b.fn({
  args: { folders: b.array(b.string.utf8.owned) },
  capability: "heap",
  rustPath: "crate::node_module_module::set_global_folders",
});
