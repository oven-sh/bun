//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `getBunServerOpenCount`, and the `ws` package's native server
//! transport: `upgradeNodeHTTPResponseToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws_sys::Opcode;
use bun_uws_sys::response::PerMessageDeflateParams;

use crate::api::bun_secure_context::SecureContext;
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

/// What keeps the server open besides its listener: the connections (counted from accept), WebSockets and requests.
pub(crate) fn get_bun_server_open_count(server: BunServer<'_>) -> f64 {
    macro_rules! open_count {
        ($server:expr) => {
            f64::from($server.pending_requests.get())
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

/// `None` once the server has stopped listening.
fn tls_listen_socket(server: BunTLSServer<'_>) -> Option<&mut bun_uws_sys::ListenSocket> {
    let listener = match server {
        BunTLSServer::Https(server) => server.listener.get()?.cast::<bun_uws_sys::ListenSocket>(),
        BunTLSServer::DebugHttps(server) => {
            server.listener.get()?.cast::<bun_uws_sys::ListenSocket>()
        }
    };
    Some(bun_opaque::opaque_deref_mut(listener))
}

pub(crate) fn set_secure_context(server: BunTLSServer<'_>, context: &SecureContext) {
    if let Some(listener) = tls_listen_socket(server) {
        listener.set_default_ssl_ctx(&context.ctx);
    }
}

pub(crate) fn dispatch_server_names(server: BunTLSServer<'_>) {
    if let Some(listener) = tls_listen_socket(server) {
        listener.on_server_name(crate::socket::listener::us_dispatch_server_name);
    }
}

pub(crate) fn add_server_name(server: BunTLSServer<'_>, hostname: &[u8], context: &SecureContext) {
    // No ClientHello can carry a NUL, so this pattern matches nothing, as in Node.
    if bun_core::strings::contains_char(hostname, 0) {
        return;
    }
    if let Some(listener) = tls_listen_socket(server) {
        let hostname = bun_core::ZBox::from_bytes(hostname);
        listener.add_server_name(hostname.as_zstr().as_cstr(), context.ctx.as_ptr());
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
