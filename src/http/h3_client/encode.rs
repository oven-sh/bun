//! Request-side framing for the HTTP/3 client: build the QPACK header list
//! from `HTTPClient.buildRequest` and drain the request body (inline bytes or
//! a JS streaming sink) onto the lsquic stream. Mirrors `h2_client/encode.rs`.

use bun_core::strings;
use bun_uws::quic;
use bun_uws::quic::Qpack;
use bun_uws::quic::header::Class as QpackClass;

use super::client_session::ClientSession;
use super::stream::Stream;
use crate::http_request_body::HTTPRequestBody;
use crate::internal_state::HTTPStage;
use crate::{HTTPVerboseLevel, Protocol, RequestBuffer};

/// Build pseudo-headers + user headers and send them on `qs`, then kick off
/// body transmission. Called from the first `callbacks.on_stream_writable`
/// for this stream (not `on_stream_open`; see the comment there for why no
/// `lsquic_stream_write` may happen before lsquic's priority iterator has
/// served the HSK crypto stream).
// Keeps the `RequestBuffer` out of `on_stream_writable`'s frame.
#[inline(never)]
pub(crate) fn write_request(
    session: &ClientSession,
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
    client.compress_body_for_send(false)?;
    let req_body: bun_ptr::RawSlice<u8> = client.state.request_body;
    let is_streaming = client.state.original_request_body.is_stream();
    let is_bytes = matches!(
        client.state.original_request_body,
        HTTPRequestBody::Bytes(_)
    );

    let mut buffer = RequestBuffer::default();
    let request = client.build_request(&mut buffer);
    if verbose != HTTPVerboseLevel::None {
        let body = req_body.slice();
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
        authority = session.hostname.as_slice();
    }
    headers[2] = quic::Header::init(b":authority", authority, Some(Qpack::Authority));

    let has_inline_body = is_bytes && !req_body.is_empty();

    let end_stream = !has_inline_body && !is_streaming;
    if qs.send_headers(&headers, end_stream) != 0 {
        return Err(crate::Error::HTTP3HeaderEncodingError);
    }

    // Keep `lower` alive until after send_headers (header pointers borrow it).
    drop(lower);
    drop(headers);

    if has_inline_body {
        stream.pending_body = req_body;
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
        let Some(sb) = body.buffer.as_deref() else {
            return;
        };
        let mut locked = sb.lock();
        let buffer = &mut locked.buffer;
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
        if drained && ended {
            stream.request_body_done = true;
            qs.shutdown();
            client.state.request_stage = HTTPStage::Done;
        } else if !drained {
            qs.want_write(true);
        } else if data_len > 0 {
            locked.report_drain();
        }
        drop(locked);
        if stream.request_body_done {
            body.buffer = None;
        }
        return;
    }

    let mut remaining = stream.pending_body;
    while !remaining.is_empty() {
        let w = qs.write(remaining.slice());
        if w <= 0 {
            break;
        }
        remaining =
            bun_ptr::RawSlice::new(&remaining.slice()[usize::try_from(w).expect("int cast")..]);
    }
    stream.pending_body = remaining;
    if remaining.is_empty() {
        stream.request_body_done = true;
        qs.shutdown();
        client.state.request_stage = HTTPStage::Done;
    } else {
        qs.want_write(true);
    }
}
