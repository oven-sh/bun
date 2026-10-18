//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `getBunServerOpenCount` / `{get,set}MaxHTTPHeaderSize`, and the `ws` package's native server
//! transport: `upgradeNodeHTTPResponseToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{CallFrame, ErrorCode, JSGlobalObject, JSValue, JsResult};
use bun_uws_sys::Opcode;
use bun_uws_sys::response::PerMessageDeflateParams;

use crate::generated_bindgen::node_http_binding::{BunServer, PerMessageDeflate, UpgradeResponse};
use crate::server::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, ServerWebSocket};

pub(crate) fn get_bun_server_all_closed_promise(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments(
            "getBunServerAllClosePromise",
            1,
            arguments.len(),
        ));
    }

    let value = arguments[0];

    // Try each heterogeneous server type in turn.
    macro_rules! try_server {
        ($ty:ty) => {
            if let Some(server) = value.as_::<$ty>() {
                // SAFETY: `JSValue::as_` returns a non-null pointer to the live
                // JS-owned server instance; we hold the JS thread for the duration
                // of this call so the GC cannot collect it under us.
                return Ok(unsafe { &mut *server }.get_all_closed_promise(global));
            }
        };
    }
    try_server!(HTTPServer);
    try_server!(HTTPSServer);
    try_server!(DebugHTTPServer);
    try_server!(DebugHTTPSServer);

    Err(global.throw_invalid_argument_type_value("server", "bun.Server", value))
}

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
        BunServer::DebugHTTP(server) => open_count!(server),
        BunServer::DebugHTTPS(server) => open_count!(server),
    }
}

pub(crate) fn upgrade_node_http_response_to_web_socket<'a>(
    cx: &mut JsScope<'a>,
    response: UpgradeResponse<'a>,
    websocket: JsLocal<'a>,
    handlers: JsLocal<'a>,
    handshake: &[u8],
    max_payload: u32,
    flags: i32,
    deflate: Option<PerMessageDeflate>,
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

pub(crate) fn send_web_socket_frame<'a>(
    cx: &mut JsScope<'a>,
    handle: &'a ServerWebSocket,
    data: JsLocal<'a>,
    opcode: i32,
    fin: bool,
    compress: bool,
) -> JsResult<JSValue> {
    let global = cx.global();
    if !(0..=2).contains(&opcode) {
        return Err(global.throw_invalid_arguments(format_args!("opcode must be 0, 1 or 2")));
    }
    handle.send_frame(global, data.to_js(), Opcode(opcode), fin, compress)
}

pub(crate) fn get_max_http_header_size() -> usize {
    bun_http::max_http_header_size()
}

pub(crate) fn get_insecure_http_parser() -> bool {
    bun_http::insecure_http_parser()
}

pub(crate) fn set_max_http_header_size<'a>(
    heap: &JsHeap<'a>,
    value: f64,
) -> bindgen::Result<'a, usize> {
    let num = value as i64;
    if num <= 0 {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_TYPE,
            format_args!("maxHeaderSize must be a positive integer"),
        ));
    }
    bun_http::set_max_http_header_size(num as usize);
    Ok(bun_http::max_http_header_size())
}
