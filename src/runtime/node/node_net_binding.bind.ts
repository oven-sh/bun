import * as b from "../../codegen/bindgen-lib.ts";
import { newSocket, socket, socketOptions } from "../../codegen/builtins/host/socket-options.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { SocketHandle } from "../socket/socket_body.bind.ts";

export default b.module({ rustPath: "crate::node::node_net_binding" });

export const newDetachedSocket = b.fn({
  args: { isSSL: b.bool },
  returns: b.any.returning(newSocket.spec),
  capability: "js",
});
const promiseOfSocket = table
  .instance("Promise")
  .holding({ value: table.union(table.instance("TCPSocket"), table.instance("TLSSocket")), reason: table.any }).fresh;
/** `Bun.connect()` with a socket that is there already: `Listener::connect_inner`. The handlers of the options get that socket. Undefined if the socket can't drop the connection it has. */
export const doConnect = b.fn({
  args: { socket: SocketHandle, options: b.any },
  returns: b.any.returning(table.union(promiseOfSocket, table.undefined).spec),
  capability: "js",
  throws: true,
  uses: { socket: [...table.retainedByNativeCode, table.storedIn(socket)], options: socketOptions },
});
