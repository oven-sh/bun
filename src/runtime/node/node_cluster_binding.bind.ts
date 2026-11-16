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
/** `"udp4"` or `"udp6"`, or 4, 6 or -1 (a path). Node compares it with `===`, so anything else is IPv4. */
export const BindAddressType = b.union({ udp: b.string.utf8, family: b.f64, ignored: b.any });
/** Anything but a string is the wildcard address. */
export const BindAddress = b.union({ text: b.string.utf8, ignored: b.any });
export const BoundHandle = b.dictionary({ fd: b.u64, port: b.i32 });
/** A negative errno when nothing was bound. */
export const BindResult = b.union({ errno: b.i32, handle: BoundHandle });
export const clusterRawBind = b.fn({
  args: { addressType: BindAddressType, address: BindAddress, port: b.f64, flags: b.i32 },
  returns: BindResult,
  capability: "js",
  throws: true,
});
export const clusterValidateFd = b.fn({ args: { fd: b.f64, wantDgram: b.bool }, returns: b.i32 });
export const clusterCloseHandle = b.fn({ args: { fd: b.f64 } });

/** `process[kHandle]` of a `cluster.Worker`, which takes any object as its process. */
const processHandle = Subprocess.otherAsNull;
/** `null` when nothing was sent, `false` when the channel asks the sender to back off. */
export const sendHelperPrimary = b.fn({
  args: { processHandle, message: b.object, handle: b.object.nullable, callback: b.callable.optional },
  returns: b.bool.nullable,
  length: 4,
  capability: "js",
  throws: true,
});
export const onInternalMessagePrimary = b.fn({
  args: { handle: processHandle, worker: b.any, callback: b.any },
  capability: "js",
});
