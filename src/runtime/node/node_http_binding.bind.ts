import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_http_binding" });

export const getMaxHTTPHeaderSize = b.fn({ returns: b.usize });
export const setMaxHTTPHeaderSize = b.fn({
  args: { value: b.f64.loose.allowBigInt },
  returns: b.usize,
  capability: "heap",
  throws: true,
});
export const getInsecureHTTPParser = b.fn({ returns: b.bool });

export const BunServer = b.union({
  http: b.classRef("HTTPServer", "crate::server::HTTPServer"),
  https: b.classRef("HTTPSServer", "crate::server::HTTPSServer"),
  debugHTTP: b.classRef("DebugHTTPServer", "crate::server::DebugHTTPServer"),
  debugHTTPS: b.classRef("DebugHTTPSServer", "crate::server::DebugHTTPSServer"),
});
export const getBunServerOpenCount = b.fn({ args: { server: BunServer }, returns: b.f64 });

/** What `ws` was handed as the response, which is not always one of ours. */
export const UpgradeResponse = b.union({
  response: b.classRef("NodeHTTPResponse", "crate::server::NodeHTTPResponse"),
  other: b.any,
});
export const PerMessageDeflate = b.dictionary({
  serverMaxWindowBits: b.i32.wrap.nullable.default(15),
  clientMaxWindowBits: b.i32.wrap.nullable.default(15),
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
    deflate: PerMessageDeflate.optional,
  },
  returns: b.any,
  capability: "js",
  throws: true,
});

export const sendWebSocketFrame = b.fn({
  args: {
    handle: b.classRef("ServerWebSocket", "crate::server::ServerWebSocket"),
    data: b.any,
    opcode: b.i32,
    fin: b.bool,
    compress: b.bool,
  },
  returns: b.any,
  capability: "js",
  throws: true,
});
