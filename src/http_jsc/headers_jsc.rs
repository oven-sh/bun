//! JSC bridges for `bun.http.{Headers,H2Client,H3Client}`. Keeps `src/http/`
//! free of JSC types.

use core::sync::atomic::Ordering;

use bun_http::Headers;
use bun_http::headers::{EntryList, api};
use bun_http_types::ETag::HeaderEntryColumns as _;
use bun_jsc::{FetchHeaders, HTTPHeaderName, JSGlobalObject, JsError, JsResult};

use crate::generated_bindgen::headers_jsc::{H2LiveCounts, H3LiveCounts};

/// `Headers` indexes its buffer with `u32` `StringPointer`s, so the total size can't exceed `u32::MAX`.
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
    headers.buf.reserve_exact(buf_len as usize);
    // SAFETY: capacity reserved above; bytes are fully initialized by copyTo / the copy below.
    unsafe { headers.buf.set_len(buf_len as usize) };
    // Zeroed, so that a slot which `copy_to` does not write is an empty slice.
    bun_core::handle_oom(headers.entries.reset_to_zeroed(header_count as usize));
    let entries = headers.entries.split_mut();
    if let Some(h) = fetch_headers {
        h.copy_to(
            &mut entries.name[..fetch_header_count as usize],
            &mut entries.value[..fetch_header_count as usize],
            &mut headers.buf[..buf_len_before_content_type as usize],
        );
    }

    // TODO: maybe we should send Content-Type header first instead of last?
    if needs_content_type {
        let body_ct = body_content_type.unwrap();
        let ct = b"Content-Type";
        headers.buf[buf_len_before_content_type as usize..][..ct.len()].copy_from_slice(ct);
        entries.name[fetch_header_count as usize] = api::StringPointer {
            offset: buf_len_before_content_type,
            length: u32::try_from(ct.len()).unwrap(),
        };

        headers.buf[buf_len_before_content_type as usize + ct.len()..][..body_ct.len()]
            .copy_from_slice(body_ct);
        entries.value[fetch_header_count as usize] = api::StringPointer {
            offset: buf_len_before_content_type + u32::try_from(ct.len()).unwrap(),
            length: u32::try_from(body_ct.len()).unwrap(),
        };
    }

    Ok(headers)
}

pub(crate) fn h2_live_counts() -> H2LiveCounts {
    use bun_http::h2_client;
    H2LiveCounts {
        sessions: h2_client::live_sessions.load(Ordering::Relaxed),
        streams: h2_client::live_streams.load(Ordering::Relaxed),
    }
}

pub(crate) fn h3_live_counts() -> H3LiveCounts {
    use bun_http::h3_client;
    H3LiveCounts {
        sessions: h3_client::live_sessions.load(Ordering::Relaxed),
        streams: h3_client::live_streams.load(Ordering::Relaxed),
    }
}
