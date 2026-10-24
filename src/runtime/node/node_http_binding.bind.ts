import * as b from "../../codegen/bindgen-lib.ts";
import { DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, ServerWebSocket } from "../server/server.bind.ts";
import { SocketHandle } from "../socket/socket_body.bind.ts";

export default b.module({ rustPath: "crate::node::node_http_binding" });

export const getMaxHTTPHeaderSize = b.fn({ returns: b.usize, rustPath: "bun_http::max_http_header_size" });
/** Node has no setter for `http.maxHeaderSize`. This one takes what Node's `maxHeaderSize` option takes, but not 0. */
export const setMaxHTTPHeaderSize = b.fn({
  args: { maxHeaderSize: b.usize.validateInteger(1, Number.MAX_SAFE_INTEGER) },
  rustPath: "bun_http::set_max_http_header_size",
});
export const insecureHTTPParser = b.value({ returns: b.bool, rustPath: "bun_http::insecure_http_parser" });

export const BunServer = b.union({
  http: HTTPServer,
  https: HTTPSServer,
  debugHttp: DebugHTTPServer,
  debugHttps: DebugHTTPSServer,
});
/** `handlers` is `node:net`'s handler table for accepted sockets. Every `req.socket._handle` of `server` calls it, and starts with `data`. `alpnProtocols` is in wire format, empty for none. */
export const setBunServerSocketHandlers = b.fn({
  args: {
    server: BunServer,
    handlers: b.any,
    alpnProtocols: b.bytes({ from: ["buffer"], held: "handle" }),
    data: b.any,
  },
  capability: "js",
  throws: true,
});

/** `lenientHttpFlags`: bit 0 is llhttp's LENIENT_HEADERS, bit 1 its LENIENT_TRANSFER_ENCODING. */
const appFlags = { lenientHttpFlags: b.u8, httpAllowHalfOpen: b.bool } as const;
/** What an `http.Server` can change while it listens. */
export const setServerAppFlags = b.fn({ args: { server: BunServer, ...appFlags } });
/** 0 means the option is not set. */
export const setServerMaxHeadersCount = b.fn({ args: { server: BunServer, maxHeadersCount: b.u32 } });
/** `onClientError(socketHandle, errorCode, rawPacket)`. */
export const setServerCustomOptions = b.fn({
  args: {
    server: BunServer,
    ...appFlags,
    maxHeaderSize: b.f64.loose,
    onClientError: b.callable,
  },
  capability: "js",
});

export const DeflateParams = b.dictionary({
  serverMaxWindowBits: b.f64.loose.nullable.default(15),
  clientMaxWindowBits: b.f64.loose.nullable.default(15),
  serverNoContextTakeover: b.bool.loose.default(false),
  clientNoContextTakeover: b.bool.loose.default(false),
});
/** The HTTP side of `socket`'s connection while uWS owns it, and `undefined` for every other value. */
export const httpConnectionOf = b.fn({ args: { socket: SocketHandle }, returns: b.any, capability: "heap" });

/** Whether the WebSocket that `upgradeSocketToWebSocket()` made of `socket` has closed, and the kernel had taken everything it queued. */
export const closedWithAllDataSent = b.fn({ args: { socket: SocketHandle }, returns: b.bool });

/** `socket` is `_handle` of the socket given to `handleUpgrade()` of `ws`, after the connection has left HTTP. */
export const upgradeSocketToWebSocket = b.fn({
  args: {
    server: BunServer,
    socket: SocketHandle,
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
