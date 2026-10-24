import * as b from "../../codegen/bindgen-lib.ts";
import { SocketHandle } from "../socket/socket_body.bind.ts";

export default b.module({ rustPath: "crate::node::node_net_binding" });

export const newDetachedSocket = b.fn({ args: { isSSL: b.bool }, returns: b.any, capability: "js" });
export const doConnect = b.fn({
  args: { socket: SocketHandle, options: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});
