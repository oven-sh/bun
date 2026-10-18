import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::socket::listener" });

const Listener = b.classRef("Listener", "crate::socket::Listener");

export const addServerName = b.fn({
  args: { listener: Listener, hostname: b.any, tls: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
});

/** The `_handle` of a `tls.Server`, which is not always one of ours. */
export const ServerHandle = b.union({ listener: Listener, other: b.any });
export const ServerContext = b.union({
  secureContext: b.classRef("SecureContext", "crate::api::bun_secure_context::SecureContext"),
  other: b.any,
});
export const setSecureContext = b.fn({ args: { listener: ServerHandle, secureContext: ServerContext } });
