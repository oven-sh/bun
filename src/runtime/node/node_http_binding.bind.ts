import * as b from "../../codegen/bindgen-lib.ts";
import { NodeHTTPResponse } from "../server/NodeHTTPResponse.bind.ts";
import { DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, ServerWebSocket } from "../server/server.bind.ts";

export default b.module({ rustPath: "crate::node::node_http_binding" });

export const getMaxHTTPHeaderSize = b.fn({ returns: b.usize, rustPath: "bun_http::max_http_header_size" });
/** Node has no setter for `http.maxHeaderSize`. This one takes what Node's `maxHeaderSize` option takes, but not 0. */
export const setMaxHTTPHeaderSize = b.fn({
  args: { maxHeaderSize: b.usize.validateInteger(1, Number.MAX_SAFE_INTEGER) },
  rustPath: "bun_http::set_max_http_header_size",
});
export const getInsecureHTTPParser = b.fn({ returns: b.bool, rustPath: "bun_http::insecure_http_parser" });

export const BunServer = b.union({
  http: HTTPServer,
  https: HTTPSServer,
  debugHttp: DebugHTTPServer,
  debugHttps: DebugHTTPSServer,
});
export const getBunServerOpenCount = b.fn({ args: { server: BunServer }, returns: b.f64 });

/** `lenientHttpFlags`: bit 0 is llhttp's LENIENT_HEADERS, bit 1 its LENIENT_TRANSFER_ENCODING. */
const appFlags = { requireHostHeader: b.bool.loose, lenientHttpFlags: b.u8, httpAllowHalfOpen: b.bool } as const;
/** What an `http.Server` can change while it listens. */
export const setServerAppFlags = b.fn({ args: { server: BunServer, ...appFlags } });
/** 0 means the option is not set. */
export const setServerMaxHeadersCount = b.fn({ args: { server: BunServer, maxHeadersCount: b.u32 } });
/** `onClientError(socketHandle, errorCode, rawPacket)`, `onConnection(socketHandle, secured)`. */
export const setServerCustomOptions = b.fn({
  args: {
    server: BunServer,
    ...appFlags,
    maxHeaderSize: b.f64.loose,
    onClientError: b.callable,
    onConnection: b.callable,
  },
  capability: "js",
});

export const BunTLSServer = b.union({ https: HTTPSServer, debugHttps: DebugHTTPSServer });
/** What an `https.Server`'s listener takes from its `tls.Server`: seconds (0 for none), and `(hostname, socketHandle)` that runs `SNICallback`. */
export const setTLSServerOptions = b.fn({
  args: { server: BunTLSServer, handshakeTimeout: b.u32, onServerName: b.callable.optional },
  capability: "js",
});

/** `kInternalSocketData` of the socket given to `handleUpgrade()` of `ws`, which can be any `Duplex`. */
export const UpgradeResponse = b.union({ response: NodeHTTPResponse, ignored: b.any });
export const DeflateParams = b.dictionary({
  serverMaxWindowBits: b.f64.loose.nullable.default(15),
  clientMaxWindowBits: b.f64.loose.nullable.default(15),
  serverNoContextTakeover: b.bool.loose.default(false),
  clientNoContextTakeover: b.bool.loose.default(false),
});
export const upgradeNodeHTTPResponseToWebSocket = b.fn({
  args: {
    response: UpgradeResponse,
    websocket: b.any,
    handlers: b.any,
    handshake: b.string.utf8,
    maxPayload: b.u32,
    flags: b.i32,
    deflate: DeflateParams.optional,
  },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const sendWebSocketFrame = b.fn({
  args: {
    handle: ServerWebSocket,
    data: b.any,
    opcode: b.i32.validateInteger(0, 2),
    fin: b.bool,
    compress: b.bool,
  },
  returns: b.any,
  capability: "js",
  throws: true,
});
