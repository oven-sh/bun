//! Helpers for extracting the body content-type byte slice that
//! `bun_http_jsc::headers_jsc::from_fetch_headers` consumes. Shared by
//! `webcore::fetch`, `server::StaticRoute`, `server::FileRoute`, and
//! `bake::DevServer`.

use crate::webcore::Blob;
use crate::webcore::blob::Any as AnyBlob;

/// `Some(ct)` only when the body has a *user-set* content-type.
#[inline]
pub(crate) fn any_blob_content_type(b: &AnyBlob) -> Option<&[u8]> {
    if b.has_content_type_from_user() {
        Some(b.content_type())
    } else {
        None
    }
}

/// `Some(ct)` only when the body has a *user-set* content-type.
#[inline]
pub(crate) fn blob_content_type(b: &Blob) -> Option<&[u8]> {
    if b.has_content_type_from_user() {
        Some(b.content_type_slice())
    } else {
        None
    }
}

/// `Some(ct)` only when the body has a *user-set* content-type.
#[inline]
pub(crate) fn any_blob_content_type_opt(b: Option<&AnyBlob>) -> Option<&[u8]> {
    b.and_then(any_blob_content_type)
}

/// The `Content-Type` that a `Blob` body gives a `Response` whose header list has none: the type of the `Blob`, user-set or not.
/// `response.headers` reports it, so a reader of a `Response` that has no list yet uses this rule, not the gated one above.
#[inline]
pub(crate) fn response_body_content_type(b: &Blob) -> Option<&[u8]> {
    let content_type = b.content_type_slice();
    (!content_type.is_empty()).then_some(content_type)
}
