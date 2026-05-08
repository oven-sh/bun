//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_http::Headers;
use bun_jsc::{CallFrame, FetchHeaders, JSGlobalObject, JSValue, JsResult};
use bun_string::{StringPointer, ZigString};

/// Build a `WebCore::FetchHeaders` from `bun.http.Headers` storage.
///
/// PORT NOTE: `FetchHeaders` (opaque C++ handle) was moved into `bun_jsc`, so
/// the prior dep-cycle on `bun_runtime` no longer applies. The C++ side
/// receives raw `StringPointer` column pointers; `bun_http_types` and
/// `bun_string` both re-export the canonical `bun_core::StringPointer`, so no
/// layout cast is needed.
pub fn to_fetch_headers(
    this: &Headers,
    global: &JSGlobalObject,
) -> JsResult<NonNull<FetchHeaders>> {
    use bun_jsc::JsError;
    if this.entries.len() == 0 {
        return Ok(FetchHeaders::create_empty());
    }
    // SAFETY: column type for both fields is `StringPointer` (see
    // `HeaderEntry::FIELD_SIZES`); `items` returns `&[F]` over live storage.
    let names: &[StringPointer] =
        unsafe { this.entries.items::<"name", StringPointer>() };
    let values: &[StringPointer] =
        unsafe { this.entries.items::<"value", StringPointer>() };
    FetchHeaders::create(
        global,
        // PORT NOTE: C++ side reads only; cast_mut() is safe (no mutation).
        names.as_ptr().cast_mut(),
        values.as_ptr().cast_mut(),
        // Spec headers_jsc.zig:12 uses `ZigString.fromBytes` (scans for
        // non-ASCII and tags UTF-8); `init` would leave the buffer Latin-1
        // and mojibake any UTF-8 header value bytes ≥0x80.
        &ZigString::from_bytes(this.buf.as_slice()),
        this.entries.len() as u32,
    )
    .ok_or(JsError::Thrown)
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

/// Free-fn aliases of [`H2TestingAPIs::live_counts`] /
/// [`H3TestingAPIs::quic_live_counts`] so `bun_runtime::dispatch::js2native`
/// can `pub use` them (associated fns aren't importable items).
#[inline]
pub fn h2_live_counts(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    H2TestingAPIs::live_counts(global, frame)
}
#[inline]
pub fn h3_quic_live_counts(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    H3TestingAPIs::quic_live_counts(global, frame)
}

// ported from: src/http_jsc/headers_jsc.zig
