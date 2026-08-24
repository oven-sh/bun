//! Request-side framing for the HTTP/3 client: build the QPACK header list
//! from `HTTPClient.buildRequest` and drain the request body (inline bytes or
//! a JS streaming sink) onto the lsquic stream. Mirrors `h2_client/encode.rs`.

use bun_core::strings;
use bun_uws::quic;
use bun_uws::quic::Qpack;
use bun_uws::quic::header::Class as QpackClass;

use super::client_session::ClientSession;
use super::stream::Stream;
use crate::http_request_body::Body;
use crate::internal_state::HTTPStage;
use crate::{HTTPClient, HTTPVerboseLevel, Protocol};

/// Build pseudo-headers + user headers and send them on `qs`, then kick off
/// body transmission. Called from the first `callbacks.on_stream_writable`
/// for this stream (not `on_stream_open`; see the comment there for why no
/// `lsquic_stream_write` may happen before lsquic's priority iterator has
/// served the HSK crypto stream).
pub(crate) fn write_request(
    session: &ClientSession,
    stream: &Stream,
    qs: &mut quic::Stream,
) -> crate::Result<()> {
    let Some(req) = stream.client.get() else {
        return Err(crate::Error::Aborted);
    };
    let mut client = req.client();
    let client: &mut HTTPClient = &mut client;
    let verbose = client.verbose;
    let reject_unauthorized = client.flags.reject_unauthorized;
    // h3 body bytes flow into lsquic's send buffer asynchronously — compress
    // into the Vec so the cursor stays valid across event-loop ticks.
    client.compress_body_for_send(false)?;
    let req_body: bun_ptr::RawSlice<u8> = client.state.request_body;
    let body_len = client.body_len_for_send();
    let is_streaming = client.state.original_request_body.is_stream();
    let is_bytes = matches!(
        client.state.original_request_body,
        Body::Bytes(_)
    );

    let thread = client.thread();
    let mut request_headers = thread.request_headers_buf.borrow_mut();
    let header_count = client.build_request(body_len, &mut request_headers);
    let request =
        HTTPClient::built_request(client.method, &client.url, &request_headers[..header_count]);
    if verbose != HTTPVerboseLevel::None {
        let body = req_body.slice();
        crate::print_request(
            Protocol::Http3,
            &request,
            client.url.href(),
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

    let mut authority: &[u8] = client.url.host();
    // the four pseudo-headers, filled in below once `authority` is known
    for _ in 0..4 {
        headers.push(quic::Header::init(b"", b"", None));
    }
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
    headers[0] = quic::Header::init(b":method", request.method, Some(Qpack::MethodGet));
    headers[1] = quic::Header::init(b":scheme", b"https", Some(Qpack::SchemeHttps));
    headers[2] = quic::Header::init(b":authority", authority, Some(Qpack::Authority));
    headers[3] = quic::Header::init(
        b":path",
        if !request.path.is_empty() {
            request.path
        } else {
            b"/"
        },
        Some(Qpack::Path),
    );

    let has_inline_body = is_bytes && !req_body.is_empty();

    let end_stream = !has_inline_body && !is_streaming;
    let sent = qs.send_headers(&headers, end_stream);
    // Keep `lower` / the header scratch alive until after send_headers (header
    // pointers borrow them).
    drop(headers);
    drop(lower);
    drop(request_headers);
    if sent != 0 {
        return Err(crate::Error::HTTP3HeaderEncodingError);
    }

    if has_inline_body {
        stream.pending_body.set(req_body);
        drain_send_body_for(stream, client, qs);
    } else if is_streaming {
        stream.is_streaming_body.set(true);
        drain_send_body_for(stream, client, qs);
    } else {
        stream.request_body_done.set(true);
    }

    client.state.request_stage = if stream.request_body_done.get() {
        HTTPStage::Done
    } else {
        HTTPStage::Body
    };
    client.state.response_stage = HTTPStage::Headers;

    // For streaming bodies the JS sink waits for can_stream to start
    // pumping; report progress now so it begins.
    if is_streaming {
        client.progress_update_h3();
    }
    Ok(())
}

/// Push as much of the request body onto `qs` as flow control allows. Called
/// from `write_request`, `callbacks.on_stream_writable`, and
/// `ClientSession.stream_body_by_http_id` (when the JS sink delivers more bytes).
pub(crate) fn drain_send_body(stream: &Stream, qs: &mut quic::Stream) {
    if stream.request_body_done.get() {
        return;
    }
    let Some(req) = stream.client.get() else {
        return;
    };
    let mut client = req.client();
    drain_send_body_for(stream, &mut client, qs);
}

fn drain_send_body_for(stream: &Stream, client: &mut HTTPClient, qs: &mut quic::Stream) {
    if stream.request_body_done.get() {
        return;
    }
    if stream.is_streaming_body.get() {
        let Body::Stream(body) = &mut client.state.original_request_body else {
            unreachable!()
        };
        let ended = body.ended;
        let Some(sb) = body.buffer() else {
            return;
        };
        {
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
            if drained && ended {
                stream.request_body_done.set(true);
                qs.shutdown();
                client.state.request_stage = HTTPStage::Done;
            } else if !drained {
                qs.want_write(true);
            } else if data_len > 0 {
                buffer.report_drain();
            }
        }
        if stream.request_body_done.get() {
            body.detach();
        }
        return;
    }

    let mut remaining = stream.pending_body.get();
    while !remaining.is_empty() {
        let w = qs.write(remaining.slice());
        if w <= 0 {
            break;
        }
        remaining =
            bun_ptr::RawSlice::new(&remaining.slice()[usize::try_from(w).expect("int cast")..]);
    }
    stream.pending_body.set(remaining);
    if remaining.is_empty() {
        stream.request_body_done.set(true);
        qs.shutdown();
        client.state.request_stage = HTTPStage::Done;
    } else {
        qs.want_write(true);
    }
}
