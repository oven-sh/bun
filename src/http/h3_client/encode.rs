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
use crate::{HTTPClient, HTTPVerboseLevel, Protocol};

/// Build pseudo-headers + user headers and send them on `qs`, then kick off
/// body transmission. Called from `callbacks.on_stream_open` once lsquic hands
/// us a stream for a pending request.
pub fn write_request(
    session: &ClientSession,
    stream: &mut Stream,
    qs: &mut quic::Stream,
) -> crate::Result<()> {
    let Some(client_ptr) = stream.client else {
        return Err(crate::Error::Aborted);
    };
    // `stream.client` is a live backref while attached — see `client_mut` doc.
    let client: &mut HTTPClient = super::client_session::client_mut(client_ptr);
    // `build_request` returns a `Request<'_>`
    // that mutably borrows `client`; capture every field we need first.
    let verbose = client.verbose;
    let href: &[u8] = client.url.href;
    let host: &[u8] = client.url.host;
    let reject_unauthorized = client.flags.reject_unauthorized;
    // h3 body bytes flow into lsquic's send buffer asynchronously — compress
    // into the Vec so the cursor stays valid across event-loop ticks.
    client.compress_body_for_send(false)?;
    let req_body: bun_ptr::RawSlice<u8> = client.state.request_body;
    let body_len = client.body_len_for_send();
    let is_streaming = client.state.original_request_body.is_stream();
    let is_bytes = matches!(
        client.state.original_request_body,
        HTTPRequestBody::Bytes(_)
    );

    let request = client.build_request(body_len);
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
    // SAFETY: capacity for `request.headers.len() + 4` was reserved above; slots
    // 0..4 are fully written below (the four pseudo-headers) before `headers`
    // is read by `send_headers`. quic::Header has no Drop.
    unsafe { headers.set_len(4) };
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
    if qs.send_headers(&headers, end_stream) != 0 {
        return Err(crate::Error::HTTP3HeaderEncodingError);
    }

    // Keep `lower` alive until after send_headers (header pointers borrow it).
    drop(lower);
    drop(headers);

    // Defer body bytes to `on_stream_writable`. `on_stream_open` can fire
    // from inside `on_hsk_done` (which lsquic invokes from `ci_tick`'s
    // crypto-read phase with `SC_BUFFER_STREAM` set) while the client's TLS
    // Finished is still only on the HSK crypto stream's frab list. A large
    // body written here fills the send controller so `write_is_possible()`
    // goes false before `process_streams_write_events` ever dispatches the
    // crypto stream, and the Finished is never packetized (the server stays
    // a mini-conn and drops every 1-RTT packet). `on_write` is dispatched
    // via lsquic's priority iterator, which serves the crypto stream first.
    // This matches lsquic's reference `http_client.c:on_new_stream`.
    if has_inline_body {
        stream.pending_body = req_body;
        qs.want_write(true);
    } else if is_streaming {
        stream.is_streaming_body = true;
        qs.want_write(true);
    } else {
        stream.request_body_done = true;
    }

    client.state.request_stage = if stream.request_body_done {
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
pub(crate) fn drain_send_body(stream: &mut Stream, qs: &mut quic::Stream) {
    if stream.request_body_done {
        return;
    }
    let Some(client_ptr) = stream.client else {
        return;
    };
    // `stream.client` is a live backref while attached — see `client_mut` doc.
    let client: &mut HTTPClient = super::client_session::client_mut(client_ptr);

    if stream.is_streaming_body {
        let HTTPRequestBody::Stream(body) = &mut client.state.original_request_body else {
            unreachable!()
        };
        let ended = body.ended;
        let Some(sb) = body.buffer_mut() else {
            return;
        };
        let buffer = sb.acquire();
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
            sb.report_drain();
        }
        sb.release();
        if stream.request_body_done {
            body.detach();
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
