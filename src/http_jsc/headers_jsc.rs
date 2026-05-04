//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::sync::atomic::Ordering;

use bun_http::{h2_client, h3_client, Headers};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult};
use bun_runtime::webcore::FetchHeaders;
use bun_str::ZigString;

pub fn to_fetch_headers(
    this: &Headers,
    global: &JSGlobalObject,
) -> JsResult<*mut FetchHeaders> {
    // TODO(port): return type — FetchHeaders is an opaque C++ object; ownership semantics TBD in Phase B
    if this.entries.len() == 0 {
        return Ok(FetchHeaders::create_empty());
    }
    // TODO(port): MultiArrayList SoA column accessors (`.items(.name)` / `.items(.value)`)
    let headers = FetchHeaders::create(
        global,
        this.entries.items_name().as_ptr(),
        this.entries.items_value().as_ptr(),
        &ZigString::from_bytes(this.buf.as_slice()),
        this.entries.len() as u32,
    )
    .ok_or(JsError::Thrown)?;
    Ok(headers)
}

pub struct H2TestingAPIs;

impl H2TestingAPIs {
    #[bun_jsc::host_fn]
    pub fn live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 2);
        obj.put(
            global,
            ZigString::static_(b"sessions"),
            JSValue::js_number(h2_client::live_sessions.load(Ordering::Relaxed)),
        );
        obj.put(
            global,
            ZigString::static_(b"streams"),
            JSValue::js_number(h2_client::live_streams.load(Ordering::Relaxed)),
        );
        Ok(obj)
    }
}

pub struct H3TestingAPIs;

impl H3TestingAPIs {
    /// Named distinctly from H2's `live_counts` because generate-js2native.ts
    /// mangles `[^A-Za-z]` to `_`, so `H2Client.zig` and `H3Client.zig` produce
    /// the same path prefix and the function name has to differ.
    #[bun_jsc::host_fn]
    pub fn quic_live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 2);
        obj.put(
            global,
            ZigString::static_(b"sessions"),
            JSValue::js_number(h3_client::live_sessions.load(Ordering::Relaxed)),
        );
        obj.put(
            global,
            ZigString::static_(b"streams"),
            JSValue::js_number(h3_client::live_streams.load(Ordering::Relaxed)),
        );
        Ok(obj)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/headers_jsc.zig (45 lines)
//   confidence: medium
//   todos:      2
//   notes:      MultiArrayList column accessor API + FetchHeaders ptr ownership need Phase B resolution; Zig .monotonic → Rust Relaxed
// ──────────────────────────────────────────────────────────────────────────
