//! Request-side framing for the HTTP/3 client: build the QPACK header list
//! from `HTTPClient.buildRequest` and drain the request body (inline bytes or
//! a JS streaming sink) onto the QUIC stream. Mirrors `h2_client/encode.rs`.

use bun_core::strings;
use bun_uws::quic;
use bun_uws::quic::Qpack;
use bun_uws::quic::header::{Class as QpackClass, field};

use super::stream::Stream;
use crate::http_request_body::HTTPRequestBody;
use crate::internal_state::HTTPStage;
use crate::{HTTPVerboseLevel, Protocol, RequestBuffer};

/// Build pseudo-headers + user headers and send them on `qs`, then kick off
/// body transmission.
// Keeps the `RequestBuffer` out of the caller's frame.
#[inline(never)]
pub(crate) fn write_request(stream: &mut Stream, qs: quic::Stream) -> crate::Result<()> {
    let Some(client) = stream.client.as_deref_mut() else {
        return Err(crate::Error::Aborted);
    };
    let verbose = client.verbose;
    let href: &[u8] = client.url.href;
    let host: &[u8] = client.url.host;
    let reject_unauthorized = client.flags.reject_unauthorized;
    // h3 body bytes flow into the send buffer asynchronously — compress
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

    let mut headers = Vec::with_capacity(request.headers.len() + 4);

    // Names not in the QPACK static table get lowercased into one buffer.
    let mut name_bytes: usize = 0;
    for h in request.headers {
        name_bytes += h.name().len();
    }
    let mut lower = vec![0u8; name_bytes];
    let mut remaining: &mut [u8] = &mut lower;

    let mut authority: &[u8] = host;
    let path = if !request.path.is_empty() {
        request.path
    } else {
        b"/"
    };
    headers.extend([
        field(b":method", request.method, Some(Qpack::MethodGet)),
        field(b":scheme", b"https", Some(Qpack::SchemeHttps)),
        field(b":authority", b"", Some(Qpack::Authority)),
        field(b":path", path, Some(Qpack::Path)),
    ]);
    for h in request.headers {
        if let Some(class) = Qpack::classify(h.name()) {
            match class {
                QpackClass::Forbidden => {}
                QpackClass::Host => authority = h.value(),
                QpackClass::Indexed { name, index } => {
                    headers.push(field(name, h.value(), Some(index)));
                }
            }
        } else if strings::eql_case_insensitive_asciii_check_length(h.name(), b"te") {
            let value = strings::trim(h.value(), b" \t");
            if strings::eql_case_insensitive_asciii_check_length(value, b"trailers") {
                headers.push(field(b"te", b"trailers", None));
            }
        } else {
            let (dst, rest) = remaining.split_at_mut(h.name().len());
            remaining = rest;
            let _ = strings::copy_lowercase(h.name(), dst);
            headers.push(field(dst, h.value(), None));
        }
    }
    if authority.is_empty() {
        authority = host;
    }
    headers[2] = field(b":authority", authority, Some(Qpack::Authority));

    let has_inline_body = is_bytes && !req_body.is_empty();

    let end_stream = !has_inline_body && !is_streaming;
    qs.send_headers(headers.into_iter(), end_stream);

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
/// from `write_request`, `StreamEvent::Writable`, and
/// `ClientSession.stream_body_by_http_id` (when the JS sink delivers more bytes).
pub(crate) fn drain_send_body(stream: &mut Stream, qs: quic::Stream) {
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
        let written = qs.write(buffer.slice());
        buffer.cursor += written;
        if written > 0 {
            stream.idle_seconds = 0;
        }
        let drained = buffer.is_empty();
        if drained {
            buffer.reset();
        }
        if drained && ended {
            stream.request_body_done = true;
            qs.finish();
            client.state.request_stage = HTTPStage::Done;
        } else if drained && data_len > 0 {
            locked.report_drain();
        }
        drop(locked);
        if stream.request_body_done {
            body.buffer = None;
        }
        return;
    }

    let body = stream.pending_body;
    stream.idle_seconds = 0;
    stream.pending_body = bun_ptr::RawSlice::new(&body.slice()[qs.write(body.slice())..]);
    if stream.pending_body.is_empty() {
        stream.request_body_done = true;
        qs.finish();
        client.state.request_stage = HTTPStage::Done;
    }
}
