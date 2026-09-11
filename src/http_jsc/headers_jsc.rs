//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::{EncodedSlice, StringPointer};
use bun_http::Headers;
use bun_http::headers::{EntryList, api};
use bun_jsc::{
    CallFrame, FetchHeaders, HTTPHeaderName, JSGlobalObject, JSValue, JsError, JsResult,
};

fn throw_headers_too_large(global: &JSGlobalObject) -> JsError {
    global.throw_value(global.create_range_error_instance(format_args!(
        "Headers exceed the maximum total size of {} bytes",
        u32::MAX
    )))
}

/// Moved up from `bun_http` so it can
/// name `FetchHeaders` directly instead of dispatching through a vtable.
///
/// `body_content_type` is `Some(ct)` only when the body has a *user-set*
/// content-type (callers gate on `has_content_type_from_user()` before passing
/// `content_type()`); `None` means no body or no user-set content-type.
///
/// Throws a `RangeError` when the total passes `u32::MAX` bytes, the range of a `StringPointer`.
pub fn from_fetch_headers(
    global: &JSGlobalObject,
    fetch_headers: Option<&FetchHeaders>,
    body_content_type: Option<&[u8]>,
) -> JsResult<Headers> {
    let (fetch_header_count, buf_len_before_content_type) =
        match fetch_headers.map(FetchHeaders::count) {
            None => (0, 0),
            Some(Some(counts)) => counts,
            Some(None) => return Err(throw_headers_too_large(global)),
        };
    let (mut header_count, mut buf_len) = (fetch_header_count, buf_len_before_content_type);
    let mut headers = Headers {
        entries: EntryList::default(),
        buf: Vec::new(),
    };
    let needs_content_type = 'brk: {
        if let Some(body_ct) = body_content_type {
            let has_ct_header =
                fetch_headers.is_some_and(|h| h.fast_has_(HTTPHeaderName::ContentType as u8));
            if !has_ct_header {
                let Some((new_count, new_len)) = header_count.checked_add(1).zip(
                    u32::try_from(b"Content-Type".len() + body_ct.len())
                        .ok()
                        .and_then(|ct_len| buf_len.checked_add(ct_len)),
                ) else {
                    return Err(throw_headers_too_large(global));
                };
                header_count = new_count;
                buf_len = new_len;
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
    // `Slice::items` returns `&mut [F]` from `&self`; the two columns are
    // disjoint allocations so simultaneous access is sound, but borrowck can't see
    // that. Take raw column pointers up front and slice in scoped blocks.
    let sliced = headers.entries.slice();
    // SAFETY: `Name`/`Value` columns are both `StringPointer`; `Slice::items_raw`
    // contract is satisfied. Disjoint backing memory ⇒ no aliasing.
    let names_ptr: *mut api::StringPointer = sliced.items_raw::<"name", api::StringPointer>();
    // SAFETY: same `items_raw` contract as above; `value` column is a disjoint allocation.
    let values_ptr: *mut api::StringPointer = sliced.items_raw::<"value", api::StringPointer>();
    // Zero-init so any slot `copy_to` fails to write (iterator skip, count
    // desync) reads as `{0, 0}` — a valid empty slice — rather than garbage.
    // SAFETY: both columns hold exactly `header_count` `StringPointer` slots.
    unsafe {
        core::ptr::write_bytes(names_ptr, 0, header_count as usize);
        core::ptr::write_bytes(values_ptr, 0, header_count as usize);
    }
    if let Some(h) = fetch_headers {
        // SAFETY: each column holds `header_count >= fetch_header_count` zeroed, unborrowed slots.
        let (names, values) = unsafe {
            (
                core::slice::from_raw_parts_mut(names_ptr, fetch_header_count as usize),
                core::slice::from_raw_parts_mut(values_ptr, fetch_header_count as usize),
            )
        };
        h.copy_to(
            names,
            values,
            &mut headers.buf[..buf_len_before_content_type as usize],
        );
    }

    // TODO: maybe we should send Content-Type header first instead of last?
    if needs_content_type {
        let body_ct = body_content_type.unwrap();
        let ct = b"Content-Type";
        headers.buf[buf_len_before_content_type as usize..][..ct.len()].copy_from_slice(ct);
        // SAFETY: header_count >= 1 (incremented above); names_ptr points to a
        // live column of `header_count` slots.
        unsafe {
            *names_ptr.add(header_count as usize - 1) = api::StringPointer {
                offset: buf_len_before_content_type,
                length: u32::try_from(ct.len()).unwrap(),
            };
        }

        headers.buf[buf_len_before_content_type as usize + ct.len()..][..body_ct.len()]
            .copy_from_slice(body_ct);
        // SAFETY: see above.
        unsafe {
            *values_ptr.add(header_count as usize - 1) = api::StringPointer {
                offset: buf_len_before_content_type + u32::try_from(ct.len()).unwrap(),
                length: u32::try_from(body_ct.len()).unwrap(),
            };
        }
    }

    Ok(headers)
}

/// Build a `WebCore::FetchHeaders` from `bun.http.Headers` storage.
///
/// `FetchHeaders` (opaque C++ handle) was moved into `bun_jsc`, so
/// the prior dep-cycle on `bun_runtime` no longer applies. The C++ side
/// receives raw `StringPointer` column pointers; `bun_http_types` and
/// `bun_string` both re-export the canonical `bun_core::StringPointer`, so no
/// layout cast is needed.
pub fn to_fetch_headers(
    this: &Headers,
    global: &JSGlobalObject,
) -> JsResult<NonNull<FetchHeaders>> {
    use bun_http_types::ETag::HeaderEntryColumns;
    if this.entries.len() == 0 {
        return Ok(FetchHeaders::create_empty());
    }
    let names: &[StringPointer] = this.entries.items_name();
    let values: &[StringPointer] = this.entries.items_value();
    // SAFETY: `names`/`values` point into live slices of `this.entries.len()`
    // entries; C++ reads exactly `count_` of each and does not retain the pointers.
    FetchHeaders::create(
        global,
        // C++ side reads only; cast_mut() is safe (no mutation).
        names.as_ptr().cast_mut(),
        values.as_ptr().cast_mut(),
        // `from_bytes` scans for
        // non-ASCII and tags UTF-8; `init` would leave the buffer Latin-1
        // and mojibake any UTF-8 header value bytes ≥0x80.
        &EncodedSlice::from_bytes(this.buf.as_slice()),
        this.entries.len() as u32,
    )
}

struct H2TestingAPIs;

impl H2TestingAPIs {
    // No attribute needed — generate-js2native.ts scans by signature shape.
    fn live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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

struct H3TestingAPIs;

impl H3TestingAPIs {
    /// Named distinctly from H2's `live_counts` because generate-js2native.ts
    /// mangles `[^A-Za-z]` to `_`, so the H2 and H3 client paths produce
    /// the same path prefix and the function name has to differ.
    fn quic_live_counts(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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
