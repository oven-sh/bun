//! Helpers for extracting the body content-type byte slice that
//! `bun_http_jsc::headers_jsc::from_fetch_headers` consumes. Shared by
//! `webcore::fetch`, `server::StaticRoute`, and `bake::DevServer`.

use crate::webcore::blob::Any as AnyBlob;

/// `Some(ct)` only when the body has a non-empty user-set content-type.
#[inline]
pub(crate) fn any_blob_content_type(b: &AnyBlob) -> Option<&[u8]> {
    if b.has_content_type_from_user() {
        let ct = b.content_type();
        (!ct.is_empty()).then_some(ct)
    } else {
        None
    }
}

/// `Some(ct)` only when the body has a non-empty user-set content-type.
#[inline]
pub(crate) fn any_blob_content_type_opt(b: Option<&AnyBlob>) -> Option<&[u8]> {
    b.and_then(any_blob_content_type)
}
