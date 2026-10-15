//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `getBunServerOpenCount` / `{get,set}MaxHTTPHeaderSize`, and the server transport of the `ws`
//! package: `upgradeNodeHTTPResponseToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws_sys::Opcode;

use crate::server::{
    DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, NodeHTTPResponse, ServerWebSocket,
};

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
pub(crate) fn get_bun_server_open_count(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments("getBunServerOpenCount", 1, arguments.len()));
    }

    let value = arguments[0];

    macro_rules! try_server {
        ($ty:ty) => {
            if let Some(server) = value.as_::<$ty>() {
                // SAFETY: `JSValue::as_` returns a non-null pointer to the live
                // JS-owned server instance; we hold the JS thread for the duration
                // of this call so the GC cannot collect it under us.
                let server = unsafe { &*server };
                return Ok(JSValue::js_number(
                    server.pending_requests.get() as f64
                        + f64::from(server.active_sockets_count())
                        + f64::from(server.active_connection_count.get()),
                ));
            }
        };
    }
    try_server!(HTTPServer);
    try_server!(HTTPSServer);
    try_server!(DebugHTTPServer);
    try_server!(DebugHTTPSServer);

    Err(global.throw_invalid_argument_type_value("server", "bun.Server", value))
}

/// uWS `CompressOptions` that zlib can be set up with: a compressor (`window << 4 | memLevel`) in the low byte
/// and a decompressor (its window) in bits 8-11, or 1 in either place for the one the event loop shares.
/// Bit 12 (`COMPRESSOR_NO_CONTEXT_TAKEOVER`) goes with a compressor of its own.
fn is_compress_options(options: i32) -> bool {
    let (compressor, decompressor) = (options & 0xFF, (options >> 8) & 0xF);
    options & !0x1FFF == 0
        && (if compressor == 1 {
            options & 0x1000 == 0
        } else {
            (9..=15).contains(&(compressor >> 4)) && (1..=9).contains(&(compressor & 0xF))
        })
        && (decompressor == 1 || (8..=15).contains(&decompressor))
}

/// `(response, websocket, handlers, handshake, maxPayload, flags, compression, head)`: makes the connection of
/// `response` a WebSocket that answers with `handshake`. Returns its `ServerWebSocket`, or `undefined` with
/// nothing written when `response` is not a native response or can no longer be upgraded.
pub(crate) fn upgrade_node_http_response_to_web_socket(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    const AUTO_PONG: i32 = 1 << 0;
    const SKIP_UTF8_VALIDATION: i32 = 1 << 1;

    // `head`: inside the request's dispatch `HttpContext::onData` still owns those bytes and gives them
    // to the WebSocket when the dispatch returns.
    let [
        response,
        websocket,
        handlers,
        handshake,
        max_payload,
        flags,
        compression,
        _head,
    ] = frame.arguments_as_array::<8>();
    let Some(response) = response.as_class_ref::<NodeHTTPResponse>() else {
        return Ok(JSValue::UNDEFINED);
    };

    // As `socket.write(string)` sends it, in npm ws and over a stream.
    let handshake = handshake.to_js_string_view(global)?;
    let handshake = handshake.to_utf8();
    let handshake: &[u8] = handshake.slice();
    if !handshake.ends_with(b"\r\n\r\n") {
        return Err(global
            .throw_invalid_arguments(format_args!("handshake must be a complete response head")));
    }
    let max_payload = if max_payload.is_number() {
        max_payload.to_u32()
    } else {
        0
    };
    let flags = flags.coerce_to_i32(global)?;
    let compression = compression.coerce_to_i32(global)?;
    if compression != 0 && !is_compress_options(compression) {
        return Err(global.throw_invalid_arguments(format_args!(
            "compression must be 0 or the uWS CompressOptions of a compressor and a decompressor"
        )));
    }
    let mut server = response.server;
    server.keep_ws_package_handlers(global, handlers)?;

    Ok(response
        .upgrade_for_ws_package(
            websocket,
            handshake,
            max_payload,
            flags & AUTO_PONG != 0,
            flags & SKIP_UTF8_VALIDATION != 0,
            compression,
        )
        .unwrap_or(JSValue::UNDEFINED))
}

/// `(handle, data, opcode, fin, compress)`: one frame on a `ServerWebSocket`. `opcode` is 1, 2, or 0 to continue
/// a message. Returns what `ServerWebSocket.send` returns.
pub(crate) fn send_web_socket_frame(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let [handle, data, opcode, fin, compress] = frame.arguments_as_array::<5>();
    let Some(socket) = handle.as_class_ref::<ServerWebSocket>() else {
        return Err(global.throw_invalid_argument_type_value("handle", "ServerWebSocket", handle));
    };
    let opcode = opcode.coerce_to_i32(global)?;
    if !(0..=2).contains(&opcode) {
        return Err(global.throw_invalid_arguments(format_args!("opcode must be 0, 1 or 2")));
    }
    socket.send_frame(
        global,
        data,
        Opcode(opcode),
        fin.to_boolean(),
        compress.to_boolean(),
    )
}

pub(crate) fn get_max_http_header_size(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::from(bun_http::max_http_header_size()))
}

pub(crate) fn get_insecure_http_parser(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_boolean(bun_http::insecure_http_parser()))
}

pub(crate) fn set_max_http_header_size(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments("setMaxHTTPHeaderSize", 1, arguments.len()));
    }
    let value = arguments[0];
    let num = value.coerce_to_int64(global)?;
    if num <= 0 {
        return Err(global.throw_invalid_argument_type_value(
            "maxHeaderSize",
            "non-negative integer",
            value,
        ));
    }
    bun_http::set_max_http_header_size(num as usize);
    Ok(JSValue::from(bun_http::max_http_header_size()))
}
