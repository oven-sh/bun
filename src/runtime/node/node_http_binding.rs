//! `node:http` native binding — `getBunServerAllClosedPromise` /
//! `{get,set}MaxHTTPHeaderSize`.
//
// ─── gated: no standalone type defs to hoist. Every fn body is a JSC host fn
//     that dispatches on `crate::api::{HTTPServer,HTTPSServer,DebugHTTP*}` (whose
//     `.as_::<T>()` / `.get_all_closed_promise()` method surface is still gated)
//     or reads/writes `bun_http::max_http_header_size` (accessor not yet
//     exported by `bun_http`). Same shape as `node_process.rs`.
// TODO(b2-blocked): un-gate once `bun_http::{max_http_header_size,set_max_http_header_size}`
// land and `crate::server::*Server::get_all_closed_promise` is real.
#[cfg(any())]
mod _impl {
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

// TODO(port): jsc.API.* server types are re-exported via bun.jsc but defined in
// src/runtime/api/server/ — same crate. Phase B: fix module path if needed.
use crate::api::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};

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
pub fn get_max_http_header_size(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let _ = global; // autofix
    let _ = frame; // autofix
    // TODO(port): bun.http.max_http_header_size is a mutable global in Zig;
    // in Rust this should be an Atomic* or accessor fn in bun_http.
    Ok(JSValue::js_number(bun_http::max_http_header_size()))
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
    // TODO(port): mutable global write — see note in get_max_http_header_size.
    bun_http::set_max_http_header_size(u64::try_from(num).unwrap());
    Ok(JSValue::js_number(bun_http::max_http_header_size()))
}
} // mod _impl

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_http_binding.zig (44 lines)
//   confidence: medium
//   todos:      3
//   notes:      bun_http::max_http_header_size mutable global needs Atomic/accessor; server type paths via crate::api may need adjustment
// ──────────────────────────────────────────────────────────────────────────
