import * as b from "../../codegen/bindgen-lib.ts";
import { SocketHandle } from "../socket/socket_body.bind.ts";

export default b.module({ rustPath: "crate::node::node_net_binding" });

export const getDefaultAutoSelectFamily = b.fn({ returns: b.bool });
export const setDefaultAutoSelectFamily = b.fn({
  args: { value: b.bool },
  expected: { value: ["boolean"] },
  returns: b.bool,
});

const INT32_MAX = 2 ** 31 - 1;
export const getDefaultAutoSelectFamilyAttemptTimeout = b.fn({ returns: b.u32 });
export const setDefaultAutoSelectFamilyAttemptTimeout = b.fn({
  args: { value: b.u32.validateInteger(1, INT32_MAX) },
  returns: b.u32,
});

/** Returns a `TCPSocket` or a `TLSSocket`. */
export const newDetachedSocket = b.fn({ args: { isSSL: b.bool }, returns: b.object, capability: "js" });
export const doConnect = b.fn({
  args: { socket: SocketHandle, options: b.opaque },
  returns: b.promise,
  capability: "js",
  throws: true,
});
