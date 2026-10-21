import * as b from "../../codegen/bindgen-lib.ts";

export const FSWatcher = b.class({
  rustPath: "crate::node::node_fs_watcher::FSWatcher",
  refCounted: true,
  finalize: true,
  configurable: false,
  internalFields: ["listener"],
  proto: {
    close: { rustName: "do_close", capability: "js" },
    ref: { rustName: "do_ref" },
    unref: { rustName: "do_unref" },
  },
});
