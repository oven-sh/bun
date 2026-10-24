import * as b from "../../codegen/bindgen-lib.ts";
import { NodeHTTPResponse } from "../server/NodeHTTPResponse.bind.ts";
import {
  DebugHTTPSServer,
  DebugHTTPServer,
  HTTPSServer,
  HTTPServer,
  ServerWebSocket,
  WebSocketMessage,
} from "../server/server.bind.ts";

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
export const getBunServerAllClosedPromise = b.fn({ args: { server: BunServer }, returns: b.promise, capability: "js" });
export const getBunServerOpenCount = b.fn({ args: { server: BunServer }, returns: b.f64 });

export const DeflateParams = b.dictionary({
  serverMaxWindowBits: b.f64.loose.nullable.default(15),
  clientMaxWindowBits: b.f64.loose.nullable.default(15),
  serverNoContextTakeover: b.bool.loose.default(false),
  clientNoContextTakeover: b.bool.loose.default(false),
});
const handler = (name: string) => ({
  type: b.callable.emptyStringAsNull,
  expected: `websocket expects a function for the '${name}' option`,
});
/** The handlers of the `websocket` option of `Bun.serve`. */
export const WebSocketHandlers = b.dictionary(
  {
    error: handler("error"),
    message: handler("message"),
    open: handler("open"),
    close: handler("close"),
    drain: handler("drain"),
    ping: handler("ping"),
    pong: handler("pong"),
  },
  { allowArray: true, fromJS: true },
);
export const upgradeNodeHTTPResponseToWebSocket = b.fn({
  args: {
    /** `kInternalSocketData` of the socket given to `handleUpgrade()` of `ws`, which can be any `Duplex`. */
    response: NodeHTTPResponse.otherAsNull,
    websocket: b.opaque,
    /** A `WebSocketHandlers`, which only the first upgrade of a server reads. */
    handlers: b.object.otherAsNull,
    handshake: b.string.utf8,
    maxPayload: b.u32,
    flags: b.i32,
    deflate: DeflateParams.optional,
  },
  returns: ServerWebSocket.optional,
  capability: "js",
  throws: true,
});

export const sendWebSocketFrame = b.fn({
  args: {
    handle: ServerWebSocket,
    data: WebSocketMessage,
    opcode: b.i32.validateInteger(0, 2),
    fin: b.bool,
    compress: b.bool,
  },
  returns: b.opaque,
  capability: "js",
  throws: true,
});
