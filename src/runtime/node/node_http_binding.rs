//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `getBunServerOpenCount`, and the `ws` package's native server
//! transport: `upgradeNodeHTTPResponseToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws_sys::Opcode;
use bun_uws_sys::response::PerMessageDeflateParams;

use crate::generated_bindgen::node_http_binding::{
    BunServer, BunTLSServer, DeflateParams, UpgradeResponse,
};
use crate::server::{AnyServer, ServerWebSocket};

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

    let Some(server) = AnyServer::from_js(value) else {
        return Err(global.throw_invalid_argument_type_value("server", "bun.Server", value));
    };
    Ok(server.get_all_closed_promise(global))
}

macro_rules! with_server {
    ($server:expr, |$s:ident| $body:expr) => {
        match $server {
            BunServer::Http($s) => $body,
            BunServer::Https($s) => $body,
            BunServer::DebugHttp($s) => $body,
            BunServer::DebugHttps($s) => $body,
        }
    };
}

/// What keeps the server open besides its listener: the connections (counted from accept), WebSockets and requests.
pub(crate) fn get_bun_server_open_count(server: BunServer<'_>) -> f64 {
    with_server!(server, |server| f64::from(server.pending_requests.get())
        + f64::from(server.active_sockets_count())
        + f64::from(server.active_connection_count.get()))
}

pub(crate) fn set_server_app_flags(
    server: BunServer<'_>,
    require_host_header: bool,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
) {
    with_server!(server, |server| server.set_node_http_flags(
        require_host_header,
        lenient_http_flags,
        http_allow_half_open
    ))
}

pub(crate) fn set_server_max_headers_count(server: BunServer<'_>, max_headers_count: u32) {
    with_server!(server, |server| server
        .set_max_headers_count(max_headers_count))
}

pub(crate) fn set_server_custom_options<'a>(
    cx: &mut JsScope<'a>,
    server: BunServer<'a>,
    require_host_header: bool,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
    max_header_size: f64,
    on_client_error: JsLocal<'a, Callable>,
    on_connection: JsLocal<'a, Callable>,
) {
    // Node's static_cast<uint64_t>(double) is undefined for these: NaN or below 1 selects the default limit (0), 2^64 or more selects none.
    let max_header_size = if max_header_size >= 1.0 {
        max_header_size as u64
    } else {
        0
    };
    with_server!(server, |server| {
        server.set_node_http_flags(
            require_host_header,
            lenient_http_flags,
            http_allow_half_open,
        );
        server.set_max_http_header_size(max_header_size);
        server.set_on_client_error(cx.global(), on_client_error.to_js());
        server.set_on_connection(cx.global(), on_connection.to_js());
    })
}

pub(crate) fn set_tls_server_options<'a>(
    cx: &mut JsScope<'a>,
    server: BunTLSServer<'a>,
    handshake_timeout: u32,
    on_server_name: Option<JsLocal<'a, Callable>>,
) {
    let on_server_name = on_server_name.map_or(JSValue::ZERO, |callback| callback.to_js());
    macro_rules! apply {
        ($server:expr) => {{
            $server.set_handshake_timeout(handshake_timeout);
            $server.set_on_server_name(cx.global(), on_server_name);
        }};
    }
    match server {
        BunTLSServer::Https(server) => apply!(server),
        BunTLSServer::DebugHttps(server) => apply!(server),
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
