import * as b from "../../codegen/bindgen-lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";
import { SocketOptionsObject, SocketReloadOptions } from "./SocketConfig.bind.ts";

export default b.module({ rustPath: "crate::socket::listener" });

/** What `Bun.listen()` returns. */
export const Listener = b.class({
  rustPath: "crate::socket::Listener",
  /** The `JSSocketHandlers` cell shared with every socket this listener accepted. */
  internalFields: ["handlers"],
  proto: {
    data: { getter: b.opaque, setter: { capability: "js" }, capability: "heap" },
    fd: { getter: b.i64 },
    getsockname: { args: { out: b.object.otherAsNull }, capability: "js", throws: true, length: 1 },
    hostname: { getter: b.string.utf8.optional, cache: true },
    port: { getter: b.u16.optional },
    ref: { capability: "js", passThis: true },
    reload: { args: { options: SocketReloadOptions.otherAsNull }, capability: "js", throws: true, length: 1 },
    stop: { args: { closeActiveConnections: b.bool.otherAsNull }, capability: "js", length: 1 },
    unix: { getter: b.string.utf8.optional, cache: true },
    unref: {},
    "@@dispose": { capability: "js" },
  },
});

/** `options` is what `SocketConfig` takes. */
const fromOptions = {
  args: { options: SocketOptionsObject.otherAsNull },
  capability: "js",
  throws: true,
  length: 1,
} as const;
/** Returns a promise of the socket. */
export const connect = b.fn({ ...fromOptions, returns: b.promise, rustPath: "crate::socket::Listener::connect" });
export const listen = b.fn({ ...fromOptions, returns: Listener, rustPath: "crate::socket::Listener::listen" });

/** `options` is read as `TLSOptions`. */
export const ServerNameTLS = b.union({ context: SecureContext, options: b.opaque });
export const addServerName = b.fn({
  args: { listener: Listener, hostname: b.string.utf8, tls: ServerNameTLS },
  capability: "js",
  throws: true,
  rustPath: "crate::socket::Listener::add_server_name",
});

/** `handle` is the `_handle` of a `tls.Server`. A cluster worker's is no `Listener`: JS wraps its connections. */
export const setSecureContext = b.fn({
  args: { handle: Listener.otherAsNull, context: SecureContext.otherAsNull },
});
