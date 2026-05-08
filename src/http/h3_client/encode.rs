//! Request-side framing for the HTTP/3 client: build the QPACK header list
//! from `HTTPClient.buildRequest` and drain the request body (inline bytes or
//! a JS streaming sink) onto the lsquic stream. Mirrors `h2_client/encode.rs`.

use bun_core::err;
use bun_string::immutable as strings;
use bun_uws::quic;
use bun_uws::quic::header::Class as QpackClass;
use bun_uws::quic::Qpack;

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
) -> Result<(), bun_core::Error> {
    let Some(client_ptr) = stream.client else {
        return Err(err!(Aborted));
    };
    // SAFETY: stream.client is a live backref while the stream is attached.
    let client: &mut HTTPClient = unsafe { &mut *client_ptr.as_ptr() };
    // PORT NOTE: reshaped for borrowck — `build_request` returns a `Request<'_>`
    // that mutably borrows `client`; capture every field we need first.
    let verbose = client.verbose;
    let href: &[u8] = client.url.href;
    let host: &[u8] = client.url.host;
    let reject_unauthorized = client.flags.reject_unauthorized;
    let req_body_ptr: *const [u8] = client.state.request_body;
    let body_len = client.state.original_request_body.len();
    let is_streaming = client.state.original_request_body.is_stream();
    let is_bytes = matches!(client.state.original_request_body, HTTPRequestBody::Bytes(_));

    let request = client.build_request(body_len);
    if verbose != HTTPVerboseLevel::None {
        // SAFETY: request_body is set from a live owned slice (Zig: `[]const u8`).
        let body = unsafe { &*req_body_ptr };
        crate::print_request(
            Protocol::Http3,
            &request,
            href,
            !reject_unauthorized,
            body,
            verbose == HTTPVerboseLevel::Curl,
        );
    }

    // PERF(port): was stack-fallback (std.heap.stackFallback(2048)).
    let mut headers: Vec<quic::Header> = Vec::with_capacity(request.headers.len() + 4);

    // Names not in the QPACK static table get lowercased into one
    // pre-sized buffer so the pointers stay stable across the batch.
    let mut name_bytes: usize = 0;
    for h in request.headers {
        name_bytes += h.name().len();
    }
    let mut lower = vec![0u8; name_bytes];
    let lower_base = lower.as_mut_ptr();
    let mut lower_len: usize = 0;

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
            // PORT NOTE: reshaped for borrowck — `lower` is sliced disjointly
            // and the slices' pointers are stored in `headers`; raw-ptr index
            // avoids holding overlapping &mut borrows of `lower`.
            // SAFETY: `lower_base` points to a buffer of `name_bytes` bytes;
            // `lower_len + h.name().len() <= name_bytes` by construction above.
            let dst = unsafe {
                core::slice::from_raw_parts_mut(lower_base.add(lower_len), h.name().len())
            };
            let _ = strings::copy_lowercase(h.name(), dst);
            lower_len += h.name().len();
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
        if !request.path.is_empty() { request.path } else { b"/" },
        Some(Qpack::Path),
    );

    // SAFETY: request_body is set from a live owned slice.
    let body: &[u8] = unsafe { &*req_body_ptr };
    let has_inline_body = is_bytes && !body.is_empty();

    let end_stream = !has_inline_body && !is_streaming;
    if qs.send_headers(&headers, end_stream) != 0 {
        return Err(err!(HTTP3HeaderEncodingError));
    }

    // Keep `lower` alive until after send_headers (header pointers borrow it).
    drop(lower);
    drop(headers);

    if has_inline_body {
        stream.pending_body = req_body_ptr;
        drain_send_body(stream, qs);
    } else if is_streaming {
        stream.is_streaming_body = true;
        drain_send_body(stream, qs);
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
pub fn drain_send_body(stream: &mut Stream, qs: &mut quic::Stream) {
    if stream.request_body_done {
        return;
    }
    let Some(client_ptr) = stream.client else {
        return;
    };
    // SAFETY: stream.client is a live backref while the stream is attached.
    let client: &mut HTTPClient = unsafe { &mut *client_ptr.as_ptr() };

    if stream.is_streaming_body {
        let HTTPRequestBody::Stream(body) = &mut client.state.original_request_body else {
            unreachable!()
        };
        let Some(sb) = body.buffer else {
            return;
        };
        // SAFETY: ThreadSafeStreamBuffer is intrusive-refcounted; this side holds a ref.
        let sb = unsafe { &mut *sb.as_ptr() };
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
        if drained && body.ended {
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

    // SAFETY: pending_body is set from a live owned slice (request_body).
    let mut remaining = unsafe { &*stream.pending_body };
    while !remaining.is_empty() {
        let w = qs.write(remaining);
        if w <= 0 {
            break;
        }
        remaining = &remaining[usize::try_from(w).expect("int cast")..];
    }
    stream.pending_body = std::ptr::from_ref::<[u8]>(remaining);
    if remaining.is_empty() {
        stream.request_body_done = true;
        qs.shutdown();
        client.state.request_stage = HTTPStage::Done;
    } else {
        qs.want_write(true);
    }
}

// ported from: src/http/h3_client/encode.zig
