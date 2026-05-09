//! `bun_http::{FetchHeadersRef, AnyBlobRef}` link-interface impls bridging
//! concrete `FetchHeaders` / `blob::Any` / `Blob` (T6, this crate) into the
//! T5 `Headers::from()` constructor. Shared by `webcore::fetch`, `server::
//! StaticRoute`, and `server::FileRoute`.

use bun_jsc::FetchHeaders;

use crate::webcore::blob::Any as AnyBlob;
use crate::webcore::Blob;

bun_http::link_impl_FetchHeadersRef! {
    WebCore for FetchHeaders => |this| {
        count(header_count, buf_len) => (*this).count(header_count, buf_len),
        // `bun_http::headers::HeaderName` re-exports `bun_http_types::Method::HeaderName`,
        // which is `#[repr(u8)]` with discriminants identical to `bun_jsc::HTTPHeaderName`
        // (both mirror WebCore's `HTTPHeaderNames.in`); `fast_has_` takes the raw `u8`.
        fast_has(name)               => (*this).fast_has_(name as u8),
        copy_to(names, values, buf)  => (*this).copy_to(names, values, buf),
    }
}

#[inline]
pub fn fetch_headers_ref(h: &FetchHeaders) -> bun_http::FetchHeadersRef {
    // SAFETY: `h` outlives the `Headers::from()` call this handle is passed to.
    unsafe {
        bun_http::FetchHeadersRef::new(
            bun_http::FetchHeadersRefKind::WebCore,
            core::ptr::from_ref(h).cast_mut(),
        )
    }
}

bun_http::link_impl_AnyBlobRef! {
    Any for AnyBlob => |this| {
        has_content_type_from_user() => (*this).has_content_type_from_user(),
        content_type_ptr() => {
            let s = (*this).content_type();
            (s.as_ptr(), s.len())
        },
    }
}

// `server::FileRoute` wraps the blob in a stack-temporary `&.{ .Blob = blob }`
// in Zig; here it erases `&Blob` directly — `Any::content_type` /
// `has_content_type_from_user` for the `.Blob` arm just forward to the same
// Blob methods.
bun_http::link_impl_AnyBlobRef! {
    Blob for Blob => |this| {
        has_content_type_from_user() => (*this).has_content_type_from_user(),
        content_type_ptr() => {
            let s = (*this).content_type_slice();
            (s.as_ptr(), s.len())
        },
    }
}

#[inline]
pub fn any_blob_ref(b: &AnyBlob) -> bun_http::AnyBlobRef {
    // SAFETY: `b` outlives the `Headers::from()` call this handle is passed to.
    unsafe { bun_http::AnyBlobRef::new(bun_http::AnyBlobRefKind::Any, core::ptr::from_ref(b).cast_mut()) }
}

#[inline]
pub fn blob_body_ref(b: &Blob) -> bun_http::AnyBlobRef {
    // SAFETY: `b` outlives the `Headers::from()` call this handle is passed to.
    unsafe { bun_http::AnyBlobRef::new(bun_http::AnyBlobRefKind::Blob, core::ptr::from_ref(b).cast_mut()) }
}

#[inline]
pub fn any_blob_ref_opt(b: Option<&AnyBlob>) -> Option<bun_http::AnyBlobRef> {
    b.map(any_blob_ref)
}
