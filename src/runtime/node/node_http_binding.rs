//! `node:http` native binding — the server's options, and the `ws` package's native server
//! transport: `upgradeSocketToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::bindgen::{Callable, JsBytes, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSValue, JsResult};
use bun_uws_sys::Opcode;
use bun_uws_sys::response::PerMessageDeflateParams;

use crate::generated_bindgen::node_http_binding::{BunServer, DeflateParams};
use crate::generated_bindgen::socket_body::SocketHandle;
use crate::server::{AnyServer, ServerWebSocket};
use crate::socket::node_http_socket::{self, WebSocketUpgrade};

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

pub(crate) fn set_server_app_flags(
    server: BunServer<'_>,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
) {
    with_server!(server, |server| server
        .set_node_http_flags(lenient_http_flags, http_allow_half_open))
}

pub(crate) fn set_server_max_headers_count(server: BunServer<'_>, max_headers_count: u32) {
    with_server!(server, |server| server
        .set_max_headers_count(max_headers_count))
}

pub(crate) fn set_server_custom_options<'a>(
    cx: &mut JsScope<'a>,
    server: BunServer<'a>,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
    max_header_size: f64,
    on_client_error: JsLocal<'a, Callable>,
) {
    // Node's static_cast<uint64_t>(double) is undefined for these: NaN or below 1 selects the default limit (0), 2^64 or more selects none.
    let max_header_size = if max_header_size >= 1.0 {
        max_header_size as u64
    } else {
        0
    };
    with_server!(server, |server| {
        server.set_node_http_flags(lenient_http_flags, http_allow_half_open);
        server.set_max_http_header_size(max_header_size);
        server.set_on_client_error(cx.global(), on_client_error.to_js());
    })
}

pub(crate) fn set_bun_server_socket_handlers<'a>(
    cx: &mut JsScope<'a>,
    server: BunServer<'a>,
    handlers: JsLocal<'a>,
    alpn_protocols: JsBytes<'a>,
    data: JsLocal<'a>,
) -> JsResult<()> {
    let alpn_protocols = alpn_protocols.get(&cx.heap);
    let alpn_protocols = (!alpn_protocols.is_empty()).then(|| Box::from(alpn_protocols));
    let (global, handlers, data) = (cx.global(), handlers.to_js(), data.to_js());
    macro_rules! apply {
        ($server:expr) => {
            $server.set_node_socket_handlers(global, handlers, alpn_protocols, data)
        };
    }
    match server {
        BunServer::Http(server) => apply!(server),
        BunServer::Https(server) => apply!(server),
        BunServer::DebugHttp(server) => apply!(server),
        BunServer::DebugHttps(server) => apply!(server),
    }
}

pub(crate) fn http_connection_of<'a>(heap: &JsHeap<'a>, socket: SocketHandle<'a>) -> JsLocal<'a> {
    let connection = match socket {
        SocketHandle::Tcp(socket) => node_http_socket::http_connection_of(socket),
        SocketHandle::Tls(socket) => node_http_socket::http_connection_of(socket),
        SocketHandle::Ignored(_) => None,
    };
    connection.map_or(JsLocal::UNDEFINED, |connection| {
        JsLocal::new(heap, connection)
    })
}

pub(crate) fn closed_with_all_data_sent(socket: SocketHandle<'_>) -> bool {
    let flags = match socket {
        SocketHandle::Tcp(socket) => socket.flags.get(),
        SocketHandle::Tls(socket) => socket.flags.get(),
        SocketHandle::Ignored(_) => return false,
    };
    flags.contains(crate::socket::SocketFlags::CLOSED_WITH_ALL_DATA_SENT)
}

/// Makes `socket`'s connection a WebSocket of `server` and writes `handshake` as the response head. Returns the `ServerWebSocket`, or `undefined` with nothing written if `socket` isn't an open connection of `server` that has left HTTP.
pub(crate) fn upgrade_socket_to_web_socket<'a>(
    cx: &mut JsScope<'a>,
    server: BunServer<'a>,
    socket: SocketHandle<'a>,
    websocket: JsLocal<'a>,
    handlers: JsLocal<'a>,
    handshake: &[u8],
    max_payload: u32,
    flags: i32,
    deflate: Option<DeflateParams>,
) -> JsResult<JSValue> {
    const AUTO_PONG: i32 = 1 << 0;
    const SKIP_UTF8_VALIDATION: i32 = 1 << 1;

    let global = cx.global();
    if !handshake.ends_with(b"\r\n\r\n") {
        return Err(global
            .throw_invalid_arguments(format_args!("handshake must be a complete response head")));
    }
    let upgrade = WebSocketUpgrade {
        websocket: websocket.to_js(),
        handlers: handlers.to_js(),
        handshake,
        max_payload_length: max_payload,
        auto_pong: flags & AUTO_PONG != 0,
        skip_utf8_validation: flags & SKIP_UTF8_VALIDATION != 0,
        deflate_params: deflate.map(|deflate| PerMessageDeflateParams {
            server_max_window_bits: deflate.server_max_window_bits as i32,
            client_max_window_bits: deflate.client_max_window_bits as i32,
            server_no_context_takeover: deflate.server_no_context_takeover,
            client_no_context_takeover: deflate.client_no_context_takeover,
        }),
    };
    macro_rules! adopt {
        ($server:expr, $socket:expr) => {
            $socket.become_web_socket(
                global,
                AnyServer::from(core::ptr::from_ref($server)),
                $server
                    .node_socket_config
                    .get()
                    .as_ref()
                    .map(|config| &config.handlers),
                &upgrade,
            )
        };
    }
    Ok(match (server, socket) {
        (BunServer::Http(server), SocketHandle::Tcp(socket)) => adopt!(server, socket),
        (BunServer::DebugHttp(server), SocketHandle::Tcp(socket)) => adopt!(server, socket),
        (BunServer::Https(server), SocketHandle::Tls(socket)) => adopt!(server, socket),
        (BunServer::DebugHttps(server), SocketHandle::Tls(socket)) => adopt!(server, socket),
        _ => Ok(None),
    }?
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
