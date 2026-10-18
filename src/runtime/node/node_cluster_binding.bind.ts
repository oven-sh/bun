import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_cluster_binding" });

export const onInternalMessageChild = b.fn({
  args: { worker: b.any, callback: b.any },
  capability: "js",
  throws: true,
});
/** The four methods of `Control`. `subprocess` is left out for `process.channel`. */
export const setChannelRef = b.fn({
  args: { enabled: b.bool, counted: b.bool, subprocess: b.classRef("Subprocess").optional },
});
export const startChannelWithRef = b.fn({ args: { subprocess: b.classRef("Subprocess") } });
export const channelIgnoreOneDisconnectEventListener = b.fn({});
export const clusterValidateFd = b.fn({ args: { fd: b.f64 }, returns: b.i32 });
export const clusterCloseHandle = b.fn({ args: { fd: b.f64 } });

/** `process[kHandle]` of a `cluster.Worker`, which takes any object as its process. */
export const ProcessHandle = b.union({ subprocess: b.classRef("Subprocess"), ignored: b.any });
export const onInternalMessagePrimary = b.fn({
  args: { handle: ProcessHandle, worker: b.any, callback: b.any },
  capability: "js",
});
