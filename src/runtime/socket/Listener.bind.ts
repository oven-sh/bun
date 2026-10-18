import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::listener" });

const Listener = b.classRef("Listener");

export const addServerName = b.fn({
  args: { listener: Listener, hostname: b.string.utf8, tls: b.any },
  capability: "js",
  throws: true,
  rustPath: "crate::socket::Listener::add_server_name",
});

/** The `_handle` of a `tls.Server`. A cluster worker's is no `Listener`: JS wraps its connections. */
export const ServerHandle = b.union({ listener: Listener, ignored: b.any });
export const ListenerContext = b.union({ secureContext: b.classRef("SecureContext"), ignored: b.any });
export const setSecureContext = b.fn({ args: { handle: ServerHandle, context: ListenerContext } });
