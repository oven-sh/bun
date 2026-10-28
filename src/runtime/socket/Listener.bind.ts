import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";

export default b.module({ rustPath: "crate::socket::listener" });

/** What `Bun.listen()` returns. */
export const Listener = b.class({
  rustPath: "crate::socket::Listener",
  types: [table.exactType("$Node.ListenerHandle"), table.exactType("$Bindgen.Listener")],
  /** The `JSSocketHandlers` cell shared with every socket this listener accepted. */
  internalFields: ["handlers"],
  proto: {
    data: { getter: b.any, setter: { capability: "js" }, capability: "heap" },
    fd: { getter: b.any.returning("number"), capability: "heap" },
    getsockname: { args: { out: b.any }, capability: "js", throws: true },
    hostname: { getter: b.string.utf8.optional, cache: true },
    port: { getter: b.u16.optional, pure: true },
    ref: { capability: "js", passThis: true },
    reload: { args: { options: b.any }, capability: "js", throws: true },
    stop: { args: { closeActiveConnections: b.any }, capability: "js" },
    unix: { getter: b.string.utf8.optional, cache: true },
    unref: {},
    "@@dispose": { capability: "js" },
  },
});

/** `options` is what `SocketConfig` takes. */
const fromOptions = { args: { options: b.any }, capability: "js", throws: true } as const;
/** Returns a promise of the socket. */
export const connect = b.fn({ ...fromOptions, returns: b.any, rustPath: "crate::socket::Listener::connect" });
export const listen = b.fn({ ...fromOptions, returns: Listener, rustPath: "crate::socket::Listener::listen" });

export const addServerName = b.fn({
  args: { listener: Listener, hostname: b.string.utf8, tls: b.any },
  capability: "js",
  throws: true,
  rustPath: "crate::socket::Listener::add_server_name",
});

/** `handle` is the `_handle` of a `tls.Server`. A cluster worker's is no `Listener`: JS wraps its connections. */
export const setSecureContext = b.fn({
  args: { handle: Listener.otherAsNull, context: SecureContext.otherAsNull },
});
