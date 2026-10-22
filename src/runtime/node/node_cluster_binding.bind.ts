import * as b from "../../codegen/bindgen-lib.ts";
import { Subprocess } from "../api/bun/subprocess.bind.ts";

export default b.module({ rustPath: "crate::node::node_cluster_binding" });

export const onInternalMessageChild = b.fn({
  args: { worker: b.any, callback: b.any },
  capability: "js",
  throws: true,
});
export const setRef = b.fn({ args: { enabled: b.bool } });
export const channelIgnoreOneDisconnectEventListener = b.fn({});
export const clusterRawBind = b.fn({
  args: { addressType: b.any, address: b.any, port: b.any, flags: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
export const clusterValidateFd = b.fn({ args: { fd: b.f64, wantDgram: b.bool }, returns: b.i32 });
export const clusterCloseHandle = b.fn({ args: { fd: b.f64 } });

/** `process[kHandle]` of a `cluster.Worker`, which takes any object as its process. */
export const ProcessHandle = b.union({ subprocess: Subprocess, ignored: b.any });
/** `null` when nothing was sent, `false` when the channel asks the sender to back off. */
export const sendHelperPrimary = b.fn({
  args: { processHandle: ProcessHandle, message: b.any, handle: b.any, callback: b.any },
  returns: b.bool.nullable,
  capability: "js",
  throws: true,
});
export const onInternalMessagePrimary = b.fn({
  args: { handle: ProcessHandle, worker: b.any, callback: b.any },
  capability: "js",
});
