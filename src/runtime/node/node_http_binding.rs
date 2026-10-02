//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `getBunServerOpenCount` / `upgradeNodeHTTPResponse` / `{get,set}MaxHTTPHeaderSize`.

use bun_core::Utf8Bytes;
use bun_jsc::{CallFrame, FetchHeaders, HTTPHeaderName, JSGlobalObject, JSValue, JsResult};

use crate::server::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, NodeHTTPResponse};

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

/// The built-in `ws`: `upgradeNodeHTTPResponse(handle, data, protocol)`. The native response of a
/// request upgrades through the server that dispatched it. False for a value that is not one,
/// and for one that cannot upgrade.
pub(crate) fn upgrade_node_http_response(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let [handle, data, protocol] = frame.arguments_as_array::<3>();
    let Some(response) = <NodeHTTPResponse as bun_jsc::JsClass>::from_js(handle) else {
        return Ok(JSValue::FALSE);
    };
    // SAFETY: `from_js` returns a live `*mut NodeHTTPResponse`, rooted by the call frame; shared —
    // its mutable state is `Cell`/`JsCell` and `upgrade` takes `&self`.
    let response = unsafe { &*response };

    let mut sec_websocket_protocol = Utf8Bytes::EMPTY;
    if !protocol.is_undefined_or_null() {
        // A response that cannot upgrade gets false, not the TypeError of its protocol.
        if !response.can_upgrade() {
            return Ok(JSValue::FALSE);
        }
        // Through `Headers`, like `server.upgrade(req, { headers })`: the same trim and TypeError.
        let protocol = protocol.to_bun_string(global)?;
        let headers = scopeguard::guard(FetchHeaders::create_empty(), |headers| {
            // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
            bun_opaque::opaque_deref_mut(headers.as_ptr()).deref();
        });
        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
        let headers = bun_opaque::opaque_deref_mut(headers.as_ptr());
        headers.put(HTTPHeaderName::SecWebSocketProtocol, &protocol, global)?;
        if let Some(value) = headers.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
            sec_websocket_protocol = value.to_utf8().into_owned();
        }
    }

    // `toString()` of the protocol ran user code: `upgrade` asks `can_upgrade` again.
    Ok(JSValue::from(
        response.upgrade(data, sec_websocket_protocol.slice()),
    ))
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
