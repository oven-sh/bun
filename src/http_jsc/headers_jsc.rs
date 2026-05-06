//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::sync::atomic::Ordering;

use bun_http::Headers;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_string::ZigString;

// TODO(b2-blocked): bun_runtime::webcore::FetchHeaders
// `bun_runtime` is a higher-tier crate (would create a dep cycle: runtime → http_jsc).
// FetchHeaders is an opaque C++ type; the bridge type needs to live in `bun_jsc` or a
// lower-tier `*_sys` crate before this fn signature can be expressed here. Whole fn
// stays gated.
#[cfg(any())]
pub fn to_fetch_headers(
    this: &Headers,
    global: &JSGlobalObject,
) -> bun_jsc::JsResult<*mut bun_runtime::webcore::FetchHeaders> {
    use bun_jsc::JsError;
    use bun_runtime::webcore::FetchHeaders;
    // TODO(port): return type — FetchHeaders is an opaque C++ object; ownership semantics TBD in Phase B
    if this.entries.len() == 0 {
        return Ok(FetchHeaders::create_empty());
    }
    // TODO(port): MultiArrayList SoA column accessors (`.items(.name)` / `.items(.value)`)
    let headers = FetchHeaders::create(
        global,
        this.entries.items_name().as_ptr(),
        this.entries.items_value().as_ptr(),
        &ZigString::init(this.buf.as_slice()),
        this.entries.len() as u32,
    )
    .ok_or(JsError::Thrown)?;
    Ok(headers)
}

pub struct H2TestingAPIs;

impl H2TestingAPIs {
    // Zig source has no attribute — generate-js2native.ts scans by signature shape.
    // TODO(port): once a `#[bun_jsc::host_fn]` proc-macro lands, annotate this so the
    // extern "C" thunk is emitted (currently no proc-macro crate exists).
    pub fn live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        use bun_http::h2_client;
        let obj = JSValue::create_empty_object(global, 2);
        // PORT NOTE: Zig `.jsNumber(i32)` → `js_number_from_int32`; h2 atomics
        // are `AtomicI32` (signed) so no widening.
        obj.put(
            global,
            b"sessions",
            JSValue::js_number_from_int32(h2_client::live_sessions.load(Ordering::Relaxed)),
        );
        obj.put(
            global,
            b"streams",
            JSValue::js_number_from_int32(h2_client::live_streams.load(Ordering::Relaxed)),
        );
        Ok(obj)
    }
}

pub struct H3TestingAPIs;

impl H3TestingAPIs {
    /// Named distinctly from H2's `live_counts` because generate-js2native.ts
    /// mangles `[^A-Za-z]` to `_`, so `H2Client.zig` and `H3Client.zig` produce
    /// the same path prefix and the function name has to differ.
    // TODO(port): once a `#[bun_jsc::host_fn]` proc-macro lands, annotate this so the
    // extern "C" thunk is emitted (currently no proc-macro crate exists).
    pub fn quic_live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        use bun_http::h3_client;
        let obj = JSValue::create_empty_object(global, 2);
        // PORT NOTE: h3 atomics are `AtomicU32`; widen to u64 for `js_number_from_uint64`.
        obj.put(
            global,
            b"sessions",
            JSValue::js_number_from_uint64(u64::from(h3_client::live_sessions.load(Ordering::Relaxed))),
        );
        obj.put(
            global,
            b"streams",
            JSValue::js_number_from_uint64(u64::from(h3_client::live_streams.load(Ordering::Relaxed))),
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
