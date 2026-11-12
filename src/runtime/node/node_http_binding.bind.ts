import * as b from "../../codegen/bindgen-lib.ts";
import { webSocketDataCell } from "../../codegen/builtins/host/native-cells.ts";
import { NodeHTTPResponse } from "../server/NodeHTTPResponse.bind.ts";
import { DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, ServerWebSocket } from "../server/server.bind.ts";

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
export const getBunServerAllClosedPromise = b.fn({ args: { server: BunServer }, returns: b.any, capability: "js" });
export const getBunServerOpenCount = b.fn({ args: { server: BunServer }, returns: b.f64 });

export const DeflateParams = b.dictionary({
  serverMaxWindowBits: b.f64.loose.nullable.default(15),
  clientMaxWindowBits: b.f64.loose.nullable.default(15),
  serverNoContextTakeover: b.bool.loose.default(false),
  clientNoContextTakeover: b.bool.loose.default(false),
});
export const upgradeNodeHTTPResponseToWebSocket = b.fn({
  args: {
    /** `kInternalSocketData` of the socket given to `handleUpgrade()` of `ws`, which can be any `Duplex`. */
    response: NodeHTTPResponse.otherAsNull,
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
  // `data` of the new ServerWebSocket.
  uses: {
    websocket: [{ use: "Everything" }, { use: "Retains", in: { place: "NativeCell", cell: webSocketDataCell } }],
  },
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
