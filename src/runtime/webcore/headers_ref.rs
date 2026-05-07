//! Vtable adapters bridging concrete `FetchHeaders` / `blob::Any` (T6, this
//! crate) into the cycle-break vtable refs `bun_http::headers::{FetchHeadersRef,
//! AnyBlobRef}` (T5). Shared by `webcore::fetch` and `server::StaticRoute`.
//!
//! `bun_http::Headers::from()` can't name `bun_jsc::FetchHeaders` /
//! `runtime::webcore::blob::Any` without a dep cycle, so it accepts a manual
//! vtable; this module supplies the static instances.

use bun_http::headers::api::StringPointer;
use bun_jsc::{FetchHeaders, HTTPHeaderName};

use crate::webcore::blob::Any as AnyBlob;

// ─── FetchHeaders vtable ────────────────────────────────────────────────────

unsafe fn fh_count(owner: *const (), header_count: &mut u32, buf_len: &mut u32) {
    // SAFETY: `owner` is `&FetchHeaders` erased; `count` mutates only internal
    // scratch state on the C++ side, hence the const→mut cast.
    unsafe { (*owner.cast::<FetchHeaders>().cast_mut()).count(header_count, buf_len) }
}
unsafe fn fh_fast_has(owner: *const (), _name: bun_http::headers::HeaderName) -> bool {
    // SAFETY: see `fh_count`. `Headers::from` only ever queries Content-Type.
    unsafe { (*owner.cast::<FetchHeaders>().cast_mut()).fast_has(HTTPHeaderName::ContentType) }
}
unsafe fn fh_copy_to(
    owner: *const (),
    names: *mut StringPointer,
    values: *mut StringPointer,
    buf: *mut u8,
) {
    // SAFETY: see `fh_count`. `bun_http_types::ETag::StringPointer` and
    // `bun_string::StringPointer` are both `#[repr(C)] {u32,u32}`.
    unsafe { (*owner.cast::<FetchHeaders>().cast_mut()).copy_to(names.cast(), values.cast(), buf) }
}

static FETCH_HEADERS_VTABLE: bun_http::headers::FetchHeadersVTable =
    bun_http::headers::FetchHeadersVTable {
        count: fh_count,
        fast_has: fh_fast_has,
        copy_to: fh_copy_to,
    };

#[inline]
pub fn fetch_headers_ref(h: &FetchHeaders) -> bun_http::headers::FetchHeadersRef<'_> {
    bun_http::headers::FetchHeadersRef {
        owner: std::ptr::from_ref::<FetchHeaders>(h).cast::<()>(),
        vtable: &FETCH_HEADERS_VTABLE,
        _phantom: core::marker::PhantomData,
    }
}

// ─── AnyBlob vtable ─────────────────────────────────────────────────────────

unsafe fn ab_has_content_type_from_user(owner: *const ()) -> bool {
    // SAFETY: `owner` is `&AnyBlob` erased.
    unsafe { (*owner.cast::<AnyBlob>()).has_content_type_from_user() }
}
unsafe fn ab_content_type(owner: *const ()) -> (*const u8, usize) {
    // SAFETY: `owner` is `&AnyBlob` erased; the returned slice borrows blob
    // storage that outlives the `AnyBlobRef`.
    let s = unsafe { (*owner.cast::<AnyBlob>()).content_type() };
    (s.as_ptr(), s.len())
}

static ANY_BLOB_VTABLE: bun_http::headers::AnyBlobVTable = bun_http::headers::AnyBlobVTable {
    has_content_type_from_user: ab_has_content_type_from_user,
    content_type: ab_content_type,
};

#[inline]
pub fn any_blob_ref(b: &AnyBlob) -> bun_http::headers::AnyBlobRef<'_> {
    bun_http::headers::AnyBlobRef {
        owner: std::ptr::from_ref::<AnyBlob>(b).cast::<()>(),
        vtable: &ANY_BLOB_VTABLE,
        _phantom: core::marker::PhantomData,
    }
}

#[inline]
pub fn any_blob_ref_opt(b: Option<&AnyBlob>) -> Option<bun_http::headers::AnyBlobRef<'_>> {
    b.map(any_blob_ref)
}
