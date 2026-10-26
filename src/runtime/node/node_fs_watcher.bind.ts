import * as b from "../../codegen/bindgen-lib.ts";

export const FSWatcher = b.class({
  rustPath: "crate::node::node_fs_watcher::FSWatcher",
  refCounted: true,
  finalize: true,
  internalFields: ["listener"],
  proto: {
    close: { capability: "js", rustName: "do_close" },
    ref: {},
    unref: {},
  },
});
