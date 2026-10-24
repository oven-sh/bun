import * as b from "../../codegen/bindgen-lib.ts";
import { SecureContext } from "../api/bun/SecureContext.bind.ts";
import { DebugHTTPSServer, HTTPSServer } from "../server/server.bind.ts";

export default b.module({ rustPath: "crate::socket::listener" });

/** What `Bun.listen()` returns. */
export const Listener = b.class({
  rustPath: "crate::socket::Listener",
  /** The `JSSocketHandlers` cell shared with every socket this listener accepted. */
  internalFields: ["handlers"],
  proto: {
    data: { getter: b.any, setter: { capability: "js" }, capability: "heap" },
    fd: { getter: b.any, capability: "heap" },
    getsockname: { args: { out: b.any }, capability: "js", throws: true },
    hostname: { getter: b.string.utf8.optional, cache: true },
    port: { getter: b.u16.optional },
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

/** What accepts the connections of a `tls.Server` (its `_handle`) or an `https.Server`. A cluster worker's `_handle` is neither: JS wraps its connections. */
export const TLSListener = b.union({
  listener: Listener,
  https: HTTPSServer,
  debugHttps: DebugHTTPSServer,
  ignored: b.any,
});
export const addServerName = b.fn({
  args: { listener: TLSListener, hostname: b.string.utf8, context: SecureContext },
});
export const setSecureContext = b.fn({ args: { listener: TLSListener, context: SecureContext } });
