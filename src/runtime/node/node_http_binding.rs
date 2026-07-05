//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `{get,set}MaxHTTPHeaderSize`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::server::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};

pub(crate) fn get_bun_server_all_closed_promise(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
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

pub(crate) fn http_server_add_server_name(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<3>();
    let arguments = arguments.slice();
    if arguments.len() < 3 {
        return Err(global.throw_not_enough_arguments("addServerName", 3, arguments.len()));
    }

    let server = arguments[0];
    let hostname = arguments[1];
    let options = arguments[2];

    let name = bun_core::OwnedString::new(hostname.to_bun_string(global)?);
    let name_utf8 = name.to_utf8_bytes();

    macro_rules! try_server {
        ($ty:ty) => {
            if let Some(this) = server.as_::<$ty>() {
                // SAFETY: `JSValue::as_` returns a non-null pointer to the live
                // JS-owned server instance; we hold the JS thread for the
                // duration of this call so the GC cannot collect it under us.
                return unsafe { &mut *this }.add_sni_context(global, &name_utf8, options);
            }
        };
    }
    try_server!(HTTPSServer);
    try_server!(DebugHTTPSServer);
    try_server!(HTTPServer);
    try_server!(DebugHTTPServer);

    Err(global.throw_invalid_argument_type_value("server", "bun.Server", server))
}

pub(crate) fn get_max_http_header_size(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::from(bun_http::max_http_header_size()))
}

pub(crate) fn set_max_http_header_size(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
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
