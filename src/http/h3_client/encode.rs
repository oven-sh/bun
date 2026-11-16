//! Request-side framing for the HTTP/3 client: build the QPACK header list
//! from `HTTPClient.buildRequest` and drain the request body (inline bytes or
//! a JS streaming sink) onto the lsquic stream. Mirrors `h2_client/encode.rs`.

use bun_core::fmt::ItoaBuf;
use bun_core::strings;
use bun_uws::quic;
use bun_uws::quic::Qpack;
use bun_uws::quic::header::Class as QpackClass;

use super::stream::Stream;
use crate::http_request_body::HTTPRequestBody;
use crate::internal_state::HTTPStage;
use crate::{HTTPThread, HTTPVerboseLevel, Protocol, RequestHeaders};

/// Build pseudo-headers + user headers and send them on `qs`, then kick off
/// body transmission. Called from the first `callbacks.on_stream_writable`
/// for this stream (not `bind_stream`; see the comment there for why no
/// `lsquic_stream_write` may happen before lsquic's priority iterator has
/// served the HSK crypto stream).
// Keeps the array of headers out of the frame of `on_stream_writable`.
#[inline(never)]
pub(crate) fn write_request(
    thread: &mut HTTPThread,
    session_hostname: &[u8],
    stream: &mut Stream,
    qs: &mut quic::Stream,
) -> crate::Result<()> {
    let Some(client) = stream.client.as_deref_mut() else {
        return Err(crate::Error::Aborted);
    };
    let verbose = client.verbose;
    let href: &[u8] = client.url.href;
    let host: &[u8] = client.url.host;
    let reject_unauthorized = client.flags.reject_unauthorized;
    // h3 body bytes flow into lsquic's send buffer asynchronously — compress
    // into the Vec so the cursor stays valid across event-loop ticks.
    client.compress_body_for_send(thread)?;
    let body_len = client.body_len_for_send();
    let is_streaming = client.state.original_request_body.is_stream();
    let is_bytes = matches!(
        client.state.original_request_body,
        HTTPRequestBody::Bytes(_)
    );

    let mut content_length = ItoaBuf::new();
    let mut request_headers = RequestHeaders::new();
    let request = client.build_request(body_len, &mut content_length, &mut request_headers);
    if verbose != HTTPVerboseLevel::None {
        let body = client.request_body();
        crate::print_request(
            Protocol::Http3,
            &request,
            href,
            !reject_unauthorized,
            body,
            verbose == HTTPVerboseLevel::Curl,
        );
    }

    let mut headers: Vec<quic::Header> = Vec::with_capacity(request.headers.len() + 4);

    // Names not in the QPACK static table get lowercased into one
    // pre-sized buffer so the pointers stay stable across the batch.
    let mut name_bytes: usize = 0;
    for h in request.headers {
        name_bytes += h.name().len();
    }
    let mut lower = vec![0u8; name_bytes];
    // Carve disjoint sub-slices out of `lower` via `split_at_mut`; `quic::Header`
    // stores raw pointers (no lifetime), so each `dst` borrow ends at `init` and
    // the running `remaining` tail never overlaps a stored header.
    let mut remaining: &mut [u8] = &mut lower;

    let mut authority: &[u8] = host;
    let path = if !request.path.is_empty() {
        request.path
    } else {
        b"/"
    };
    headers.extend([
        quic::Header::init(b":method", request.method, Some(Qpack::MethodGet)),
        quic::Header::init(b":scheme", b"https", Some(Qpack::SchemeHttps)),
        quic::Header::init(b":authority", b"", Some(Qpack::Authority)),
        quic::Header::init(b":path", path, Some(Qpack::Path)),
    ]);
    for h in request.headers {
        if let Some(class) = Qpack::classify(h.name()) {
            match class {
                QpackClass::Forbidden => {}
                QpackClass::Host => authority = h.value(),
                QpackClass::Indexed { name, index } => {
                    headers.push(quic::Header::init(name, h.value(), Some(index)));
                }
            }
        } else {
            let (dst, rest) = remaining.split_at_mut(h.name().len());
            remaining = rest;
            let _ = strings::copy_lowercase(h.name(), dst);
            headers.push(quic::Header::init(dst, h.value(), None));
        }
    }
    if authority.is_empty() {
        authority = session_hostname;
    }
    headers[2] = quic::Header::init(b":authority", authority, Some(Qpack::Authority));

    let has_inline_body = is_bytes && !client.request_body().is_empty();

    let end_stream = !has_inline_body && !is_streaming;
    if qs.send_headers(&headers, end_stream) != 0 {
        return Err(crate::Error::HTTP3HeaderEncodingError);
    }

    // Keep `lower` alive until after send_headers (header pointers borrow it).
    drop(lower);
    drop(headers);

    if has_inline_body {
        drain_send_body(stream, qs);
    } else if is_streaming {
        stream.is_streaming_body = true;
        drain_send_body(stream, qs);
    } else {
        stream.request_body_done = true;
    }

    let Some(client) = stream.client.as_deref_mut() else {
        return Err(crate::Error::Aborted);
    };
    client.state.request_stage = if stream.request_body_done {
        HTTPStage::Done
    } else {
        HTTPStage::Body
    };
    client.state.response_stage = HTTPStage::Headers;

    // For streaming bodies the JS sink waits for can_stream to start
    // pumping; report progress now so it begins.
    if is_streaming {
        client.send_partial_result();
    }
    Ok(())
}

/// Push as much of the request body onto `qs` as flow control allows. Called
/// from `write_request`, `callbacks.on_stream_writable`, and
/// `ClientSession.stream_body_by_http_id` (when the JS sink delivers more bytes).
pub(crate) fn drain_send_body(stream: &mut Stream, qs: &mut quic::Stream) {
    if stream.request_body_done {
        return;
    }
    let Some(client) = stream.client.as_deref_mut() else {
        return;
    };

    if stream.is_streaming_body {
        let HTTPRequestBody::Stream(body) = &mut client.state.original_request_body else {
            unreachable!()
        };
        let ended = body.ended;
        let Some(sb) = body.buffer else {
            return;
        };
        let mut buffer = sb.lock();
        let data_len = buffer.slice().len();
        let mut written: usize = 0;
        while written < data_len {
            let w = qs.write(&buffer.slice()[written..]);
            if w <= 0 {
                break;
            }
            written += usize::try_from(w).expect("int cast");
        }
        buffer.cursor += written;
        let drained = buffer.is_empty();
        if drained {
            buffer.reset();
        }
        drop(buffer);
        if drained && ended {
            stream.request_body_done = true;
            qs.shutdown();
            client.state.request_stage = HTTPStage::Done;
        } else if !drained {
            qs.want_write(true);
        } else if data_len > 0 {
            client.result_callback.report_drain();
        }
        if stream.request_body_done {
            body.buffer = None;
        }
        return;
    }

    let body = client.request_body();
    let mut remaining = &body[stream.body_sent..];
    while !remaining.is_empty() {
        let w = qs.write(remaining);
        if w <= 0 {
            break;
        }
        remaining = &remaining[usize::try_from(w).expect("int cast")..];
    }
    stream.body_sent = body.len() - remaining.len();
    if remaining.is_empty() {
        stream.request_body_done = true;
        qs.shutdown();
        client.state.request_stage = HTTPStage::Done;
    } else {
        qs.want_write(true);
    }
}
