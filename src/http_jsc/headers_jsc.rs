//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::{StringPointer, ZigString};
use bun_http::Headers;
use bun_http::headers::{EntryList, api};
use bun_jsc::{CallFrame, FetchHeaders, HTTPHeaderName, JSGlobalObject, JSValue, JsResult};

/// Port of `Headers.from` (Headers.zig). Moved up from `bun_http` so it can
/// name `FetchHeaders` directly instead of dispatching through a vtable.
///
/// `body_content_type` is `Some(ct)` only when the body has a *user-set*
/// content-type (callers gate on `has_content_type_from_user()` before passing
/// `content_type()`); `None` means no body or no user-set content-type.
pub fn from_fetch_headers(
    fetch_headers: Option<&FetchHeaders>,
    body_content_type: Option<&[u8]>,
) -> Headers {
    // PORT NOTE: `FetchHeaders::{count,fast_has_,copy_to}` take `&mut self` but
    // are read-only FFI shims; cast through `*mut` (matching the prior
    // `link_interface!` impl which did `from_ref(h).cast_mut()`).
    let h_ptr: Option<*mut FetchHeaders> = fetch_headers.map(|h| core::ptr::from_ref(h).cast_mut());

    let mut header_count: u32 = 0;
    let mut buf_len: u32 = 0;
    if let Some(h) = h_ptr {
        // SAFETY: `h` is a valid `&FetchHeaders` for the call; FFI is read-only.
        unsafe { (*h).count(&mut header_count, &mut buf_len) };
    }
    let mut headers = Headers {
        entries: EntryList::default(),
        buf: Vec::new(),
    };
    let buf_len_before_content_type = buf_len;
    let needs_content_type = 'brk: {
        if let Some(body_ct) = body_content_type {
            // SAFETY: see `count` above.
            let has_ct_header = h_ptr
                .map(|h| unsafe { (*h).fast_has_(HTTPHeaderName::ContentType as u8) })
                .unwrap_or(false);
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
    // PORT NOTE: reshaped for borrowck — Zig took two column slices off one `sliced` view.
    // The Rust `Slice::items` returns `&mut [F]` from `&self`; the two columns are
    // disjoint allocations so simultaneous access is sound, but borrowck can't see
    // that. Take raw column pointers up front and slice in scoped blocks.
    let sliced = headers.entries.slice();
    // SAFETY: `Name`/`Value` columns are both `StringPointer`; `Slice::items_raw`
    // contract is satisfied. Disjoint backing memory ⇒ no aliasing.
    let names_ptr: *mut api::StringPointer =
        unsafe { sliced.items_raw::<"name", api::StringPointer>() };
    let values_ptr: *mut api::StringPointer =
        unsafe { sliced.items_raw::<"value", api::StringPointer>() };
    if let Some(h) = h_ptr {
        // SAFETY: `h` is a valid `&FetchHeaders` for the call; columns sized by `count` above.
        unsafe { (*h).copy_to(names_ptr, values_ptr, headers.buf.as_mut_ptr()) };
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

    headers
}

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
    use bun_http_types::ETag::HeaderEntryColumns;
    use bun_jsc::JsError;
    if this.entries.len() == 0 {
        return Ok(FetchHeaders::create_empty());
    }
    let names: &[StringPointer] = this.entries.items_name();
    let values: &[StringPointer] = this.entries.items_value();
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

// ported from: src/http_jsc/headers_jsc.zig
