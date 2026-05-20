//! Helpers for extracting the body content-type byte slice that
//! `bun_http_jsc::headers_jsc::from_fetch_headers` consumes. Shared by
//! `webcore::fetch`, `server::StaticRoute`, `server::FileRoute`, and
//! `bake::DevServer`.

use crate::webcore::Blob;
use crate::webcore::blob::Any as AnyBlob;

/// `Some(ct)` only when the body has a *user-set* content-type.
#[inline]
pub fn any_blob_content_type(b: &AnyBlob) -> Option<&[u8]> {
    if b.has_content_type_from_user() {
        Some(b.content_type())
    } else {
        None
    }
}

/// `Some(ct)` only when the body has a *user-set* content-type.
#[inline]
pub fn blob_content_type(b: &Blob) -> Option<&[u8]> {
    if b.has_content_type_from_user() {
        Some(b.content_type_slice())
    } else {
        None
    }
}

/// `Some(ct)` only when the body has a *user-set* content-type.
#[inline]
pub fn any_blob_content_type_opt(b: Option<&AnyBlob>) -> Option<&[u8]> {
    b.and_then(any_blob_content_type)
}
