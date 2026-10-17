//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `getBunServerOpenCount` / `{get,set}MaxHTTPHeaderSize`, and the `ws` package's native server
//! transport: `upgradeNodeHTTPResponseToWebSocket` / `sendWebSocketFrame`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws_sys::Opcode;
use bun_uws_sys::response::PerMessageDeflateParams;

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

/// `(response, websocket, handlers, handshake, maxPayload, flags, deflate)`: upgrades
/// `response`'s connection to a WebSocket and writes `handshake` as the response head. `deflate` is
/// the negotiated permessage-deflate parameters, or `undefined`. Returns the `ServerWebSocket`.
/// Returns `undefined` without writing anything if `response` isn't a native response or can no
/// longer be upgraded.
pub(crate) fn upgrade_node_http_response_to_web_socket(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    const AUTO_PONG: i32 = 1 << 0;
    const SKIP_UTF8_VALIDATION: i32 = 1 << 1;

    let [
        response,
        websocket,
        handlers,
        handshake,
        max_payload,
        flags,
        deflate,
    ] = frame.arguments_as_array::<7>();
    let Some(response) = response.as_class_ref::<NodeHTTPResponse>() else {
        return Ok(JSValue::UNDEFINED);
    };

    // Encode as UTF-8, like `socket.write(string)` does in npm ws and on the stream transport.
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
    let deflate_params = if deflate.is_object() {
        Some(PerMessageDeflateParams {
            server_max_window_bits: deflate
                .get_optional(global, "serverMaxWindowBits")?
                .unwrap_or(15),
            client_max_window_bits: deflate
                .get_optional(global, "clientMaxWindowBits")?
                .unwrap_or(15),
            server_no_context_takeover: deflate
                .get_boolean_loose(global, "serverNoContextTakeover")?
                .unwrap_or(false),
            client_no_context_takeover: deflate
                .get_boolean_loose(global, "clientNoContextTakeover")?
                .unwrap_or(false),
        })
    } else {
        None
    };

    Ok(response
        .upgrade_for_ws_package(
            global,
            websocket,
            handlers,
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
