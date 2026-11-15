import * as b from "../../codegen/bindgen-lib.ts";

/** The native handle behind `fs.watchFile()`. */
export const StatWatcher = b.class({
  rustPath: "crate::node::node_fs_stat_watcher::StatWatcher",
  // As SetProtoMethod leaves the functions of Node's handle: https://github.com/nodejs/node/blob/v26.12.1/src/handle_wrap.cc#L171-L174
  configurable: true,
  refCounted: true,
  finalize: true,
  internalFields: ["listener", "prevStat"],
  proto: {
    close: {},
    ref: { rustName: "do_ref" },
    unref: { rustName: "do_unref" },
  },
});
