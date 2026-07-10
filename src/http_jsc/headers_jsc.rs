//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::sync::atomic::Ordering;

use bun_core::{StringPointer, ZigString};
use bun_http::Headers;
use bun_http::headers::{EntryList, api};
use bun_jsc::{CallFrame, FetchHeaders, HTTPHeaderName, JSGlobalObject, JSValue, JsResult};

/// Moved up from `bun_http` so it can
/// name `FetchHeaders` directly instead of dispatching through a vtable.
///
/// `body_content_type` is `Some(ct)` only when the body has a *user-set*
/// content-type (callers gate on `has_content_type_from_user()` before passing
/// `content_type()`); `None` means no body or no user-set content-type.
pub fn from_fetch_headers(
    fetch_headers: Option<&FetchHeaders>,
    body_content_type: Option<&[u8]>,
) -> Headers {
    let (mut header_count, mut buf_len) = fetch_headers.map_or((0, 0), FetchHeaders::count);

    let mut headers = Headers {
        entries: EntryList::default(),
        buf: Vec::new(),
    };
    let buf_len_before_content_type = buf_len;
    let needs_content_type = 'brk: {
        if let Some(body_ct) = body_content_type {
            let has_ct_header =
                fetch_headers.is_some_and(|h| h.fast_has(HTTPHeaderName::ContentType));
            if !has_ct_header {
                header_count += 1;
                buf_len += u32::try_from(body_ct.len() + b"Content-Type".len()).unwrap();
                break 'brk true;
            }
        }
        false
    };
    if headers
        .entries
        .ensure_total_capacity(header_count as usize)
        .is_err()
    {
        bun_alloc::out_of_memory();
    }
    // SAFETY: capacity reserved above; columns are `StringPointer` (POD) and fully
    // overwritten by `copy_to` / the explicit writes below before any read.
    unsafe { headers.entries.set_len(header_count as usize) };
    headers.buf.reserve_exact(buf_len as usize);
    // SAFETY: capacity reserved above; bytes are fully initialized by copyTo / the copy below.
    unsafe { headers.buf.set_len(buf_len as usize) };
    // `Slice::items` returns `&mut [F]` from `&self`; the two columns are disjoint
    // allocations so simultaneous access is sound, but borrowck can't see that.
    let sliced = headers.entries.slice();
    // SAFETY: `name`/`value` are disjoint columns of exactly `header_count`
    // `StringPointer` slots each; `Slice::items_raw`'s contract is satisfied.
    let (names, values) = unsafe {
        (
            core::slice::from_raw_parts_mut(
                sliced.items_raw::<"name", api::StringPointer>(),
                header_count as usize,
            ),
            core::slice::from_raw_parts_mut(
                sliced.items_raw::<"value", api::StringPointer>(),
                header_count as usize,
            ),
        )
    };
    // Zero-init so any slot `copy_to` fails to write (iterator skip, count
    // desync) reads as `{0, 0}` — a valid empty slice — rather than garbage.
    names.fill(api::StringPointer::default());
    values.fill(api::StringPointer::default());

    if let Some(h) = fetch_headers {
        h.copy_to(names, values, &mut headers.buf);
    }

    // TODO: maybe we should send Content-Type header first instead of last?
    if needs_content_type {
        let body_ct = body_content_type.unwrap();
        let ct = b"Content-Type";
        let off = buf_len_before_content_type as usize;
        headers.buf[off..][..ct.len()].copy_from_slice(ct);
        headers.buf[off + ct.len()..][..body_ct.len()].copy_from_slice(body_ct);

        // `header_count` was incremented for this slot above.
        let last = header_count as usize - 1;
        names[last] = api::StringPointer {
            offset: buf_len_before_content_type,
            length: u32::try_from(ct.len()).unwrap(),
        };
        values[last] = api::StringPointer {
            offset: buf_len_before_content_type + u32::try_from(ct.len()).unwrap(),
            length: u32::try_from(body_ct.len()).unwrap(),
        };
    }

    headers
}

/// Build a `WebCore::FetchHeaders` from `bun.http.Headers` storage.
///
/// `FetchHeaders` (opaque C++ handle) was moved into `bun_jsc`, so
/// the prior dep-cycle on `bun_runtime` no longer applies. The C++ side
/// receives raw `StringPointer` column pointers; `bun_http_types` and
/// `bun_string` both re-export the canonical `bun_core::StringPointer`, so no
/// layout cast is needed.
pub fn to_fetch_headers(this: &Headers, global: &JSGlobalObject) -> JsResult<FetchHeaders> {
    use bun_http_types::ETag::HeaderEntryColumns;
    use bun_jsc::JsError;
    if this.entries.len() == 0 {
        return Ok(FetchHeaders::create_empty());
    }
    let names: &[StringPointer] = this.entries.items_name();
    let values: &[StringPointer] = this.entries.items_value();
    FetchHeaders::create(
        global,
        names,
        values,
        // `from_bytes` scans for non-ASCII and tags UTF-8; `init` would leave the
        // buffer Latin-1 and mojibake any UTF-8 header value bytes ≥0x80.
        &ZigString::from_bytes(this.buf.as_slice()),
    )
    .ok_or(JsError::Thrown)
}

pub(crate) struct H2TestingAPIs;

impl H2TestingAPIs {
    // No attribute needed — generate-js2native.ts scans by signature shape.
    pub(crate) fn live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        use bun_http::h2_client;
        let obj = JSValue::create_empty_object(global, 2);
        // h2 atomics
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

pub(crate) struct H3TestingAPIs;

impl H3TestingAPIs {
    /// Named distinctly from H2's `live_counts` because generate-js2native.ts
    /// mangles `[^A-Za-z]` to `_`, so the H2 and H3 client paths produce
    /// the same path prefix and the function name has to differ.
    pub(crate) fn quic_live_counts(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        use bun_http::h3_client;
        let obj = JSValue::create_empty_object(global, 2);
        // h3 atomics are `AtomicU32`; widen to u64 for `js_number_from_uint64`.
        obj.put(
            global,
            b"sessions",
            JSValue::js_number_from_uint64(u64::from(
                h3_client::live_sessions.load(Ordering::Relaxed),
            )),
        );
        obj.put(
            global,
            b"streams",
            JSValue::js_number_from_uint64(u64::from(
                h3_client::live_streams.load(Ordering::Relaxed),
            )),
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
