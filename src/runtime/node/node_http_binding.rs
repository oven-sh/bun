//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `{get,set}MaxHTTPHeaderSize`.

use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::server::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};

#[bun_jsc::host_fn]
pub fn get_bun_server_all_closed_promise(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(1).slice();
    if arguments.len() < 1 {
        return global.throw_not_enough_arguments("getBunServerAllClosePromise", 1, arguments.len());
    }

    let value = arguments[0];

    // Zig: `inline for` over heterogeneous server types — unrolled manually.
    if let Some(server) = value.as_::<HTTPServer>() {
        return server.get_all_closed_promise(global);
    }
    if let Some(server) = value.as_::<HTTPSServer>() {
        return server.get_all_closed_promise(global);
    }
    if let Some(server) = value.as_::<DebugHTTPServer>() {
        return server.get_all_closed_promise(global);
    }
    if let Some(server) = value.as_::<DebugHTTPSServer>() {
        return server.get_all_closed_promise(global);
    }

    global.throw_invalid_argument_type_value("server", "bun.Server", value)
}

#[bun_jsc::host_fn]
pub fn get_max_http_header_size(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // Zig: `bun.http.max_http_header_size` is a process-wide mutable global.
    // SAFETY: read-only access to a `static mut` written only at startup or
    // via `set_max_http_header_size` below — both JS-thread only.
    let v = unsafe { bun_http::MAX_HTTP_HEADER_SIZE };
    Ok(JSValue::js_number(v as f64))
}

#[bun_jsc::host_fn]
pub fn set_max_http_header_size(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(1).slice();
    if arguments.len() < 1 {
        return global.throw_not_enough_arguments("setMaxHTTPHeaderSize", 1, arguments.len());
    }
    let value = arguments[0];
    let num = value.coerce_to_int64(global)?;
    if num <= 0 {
        return global.throw_invalid_argument_type_value("maxHeaderSize", "non-negative integer", value);
    }
    // SAFETY: see `get_max_http_header_size` above.
    unsafe {
        bun_http::MAX_HTTP_HEADER_SIZE = num as usize;
    }
    let v = unsafe { bun_http::MAX_HTTP_HEADER_SIZE };
    Ok(JSValue::js_number(v as f64))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_http_binding.zig (44 lines)
//   notes:      bun_http::MAX_HTTP_HEADER_SIZE static mut accessed directly
//               (single-thread JS contract); server types resolved via crate::server.
// ──────────────────────────────────────────────────────────────────────────
