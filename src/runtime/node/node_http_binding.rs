//! `node:http` native binding — `getBunServerOpenCount`, and the `ws` package's native server
//! transport: `upgradeNodeHTTPResponseToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSValue, JsResult};
use bun_uws_sys::Opcode;
use bun_uws_sys::response::PerMessageDeflateParams;

use crate::generated_bindgen::node_http_binding::{BunServer, DeflateParams, UpgradeResponse};
use crate::server::ServerWebSocket;

/// What keeps the server open besides its listener: the connections (counted from accept), WebSockets and requests.
pub(crate) fn get_bun_server_open_count(server: BunServer<'_>) -> f64 {
    macro_rules! open_count {
        ($server:expr) => {
            $server.pending_requests.get() as f64
                + f64::from($server.active_sockets_count())
                + f64::from($server.active_connection_count.get())
        };
    }
    match server {
        BunServer::Http(server) => open_count!(server),
        BunServer::Https(server) => open_count!(server),
        BunServer::DebugHttp(server) => open_count!(server),
        BunServer::DebugHttps(server) => open_count!(server),
    }
}

/// `(response, websocket, handlers, handshake, maxPayload, flags, deflate)`: upgrades
/// `response`'s connection to a WebSocket and writes `handshake` as the response head. `deflate` is
/// the negotiated permessage-deflate parameters, or `undefined`. Returns the `ServerWebSocket`.
/// Returns `undefined` without writing anything if `response` isn't a native response or can no
/// longer be upgraded.
pub(crate) fn upgrade_node_http_response_to_web_socket<'a>(
    cx: &mut JsScope<'a>,
    response: UpgradeResponse<'a>,
    websocket: JsLocal<'a>,
    handlers: JsLocal<'a>,
    handshake: &[u8],
    max_payload: u32,
    flags: i32,
    deflate: Option<DeflateParams>,
) -> JsResult<JSValue> {
    const AUTO_PONG: i32 = 1 << 0;
    const SKIP_UTF8_VALIDATION: i32 = 1 << 1;

    let UpgradeResponse::Response(response) = response else {
        return Ok(JSValue::UNDEFINED);
    };
    let global = cx.global();

    if !handshake.ends_with(b"\r\n\r\n") {
        return Err(global
            .throw_invalid_arguments(format_args!("handshake must be a complete response head")));
    }
    let deflate_params = deflate.map(|deflate| PerMessageDeflateParams {
        server_max_window_bits: deflate.server_max_window_bits as i32,
        client_max_window_bits: deflate.client_max_window_bits as i32,
        server_no_context_takeover: deflate.server_no_context_takeover,
        client_no_context_takeover: deflate.client_no_context_takeover,
    });

    Ok(response
        .upgrade_for_ws_package(
            global,
            websocket.to_js(),
            handlers.to_js(),
            handshake,
            max_payload,
            flags & AUTO_PONG != 0,
            flags & SKIP_UTF8_VALIDATION != 0,
            deflate_params.as_ref(),
        )?
        .unwrap_or(JSValue::UNDEFINED))
}

/// `(handle, data, opcode, fin, compress)`: sends one frame on a `ServerWebSocket`. `opcode` is
/// 1 (text), 2 (binary) or 0 (continuation). Returns the same status as `ServerWebSocket.send`.
pub(crate) fn send_web_socket_frame<'a>(
    cx: &mut JsScope<'a>,
    handle: &'a ServerWebSocket,
    data: JsLocal<'a>,
    opcode: i32,
    fin: bool,
    compress: bool,
) -> JsResult<JSValue> {
    handle.send_frame(cx.global(), data.to_js(), Opcode(opcode), fin, compress)
}
