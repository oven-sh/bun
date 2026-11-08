import * as b from "../../codegen/bindgen-lib.ts";

export const StatWatcher = b.class({
  rustPath: "crate::node::node_fs_stat_watcher::StatWatcher",
  refCounted: true,
  finalize: true,
  internalFields: ["listener", "prevStat"],
  proto: {
    close: {},
    ref: { rustName: "do_ref" },
    unref: { rustName: "do_unref" },
  },
});
