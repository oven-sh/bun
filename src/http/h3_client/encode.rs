//! Request-side framing for the HTTP/3 client: build the QPACK header list
//! from `HTTPClient.buildRequest` and drain the request body (inline bytes or
//! a JS streaming sink) onto the lsquic stream. Mirrors `h2_client/encode.rs`.

use bun_core::err;
use bun_str::strings;
use bun_uws::quic;

use super::client_session::ClientSession;
use super::stream::Stream;

/// Build pseudo-headers + user headers and send them on `qs`, then kick off
/// body transmission. Called from `callbacks.on_stream_open` once lsquic hands
/// us a stream for a pending request.
pub fn write_request(
    session: &ClientSession,
    stream: &mut Stream,
    qs: &mut quic::Stream,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let Some(client) = stream.client.as_mut() else {
        return Err(err!("Aborted"));
    };
    let request = client.build_request(client.state.original_request_body.len());
    if client.verbose != bun_http::Verbose::None {
        bun_http::print_request(
            bun_http::Protocol::Http3,
            &request,
            client.url.href,
            !client.flags.reject_unauthorized,
            client.state.request_body,
            client.verbose == bun_http::Verbose::Curl,
        );
    }

    // PERF(port): was stack-fallback (std.heap.stackFallback(2048)) — profile in Phase B
    let mut headers: Vec<quic::Header> = Vec::new();
    headers.reserve_exact(request.headers.len() + 4);

    // Names not in the QPACK static table get lowercased into one
    // pre-sized buffer so the pointers stay stable across the batch.
    let mut name_bytes: usize = 0;
    for h in request.headers {
        name_bytes += h.name.len();
    }
    let mut lower = vec![0u8; name_bytes];
    let mut lower_len: usize = 0;

    let mut authority: &[u8] = client.url.host;
    // SAFETY: capacity for `request.headers.len() + 4` was reserved above; slots
    // 0..4 are fully written below (the four pseudo-headers) before `headers`
    // is read by `send_headers`. quic::Header has no Drop.
    unsafe {
        headers.set_len(4);
    }
    // TODO(port): borrowck — `lower` is sliced disjointly and the slices are
    // stored in `headers`; may need split_at_mut or a raw-ptr reshape.
    for h in request.headers {
        if let Some(class) = quic::Qpack::classify(h.name) {
            match class {
                quic::Qpack::Class::Forbidden => {}
                quic::Qpack::Class::Host => authority = h.value,
                quic::Qpack::Class::Indexed(i) => {
                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                    headers.push(quic::Header::init(i.name, h.value, Some(i.index)));
                }
            }
        } else {
            let dst = &mut lower[lower_len..][..h.name.len()];
            let _ = strings::copy_lowercase(h.name, dst);
            lower_len += h.name.len();
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            headers.push(quic::Header::init(dst, h.value, None));
        }
    }
    if authority.is_empty() {
        authority = session.hostname;
    }
    headers[0] = quic::Header::init(b":method", request.method, Some(quic::Qpack::Index::MethodGet));
    headers[1] = quic::Header::init(b":scheme", b"https", Some(quic::Qpack::Index::SchemeHttps));
    headers[2] = quic::Header::init(b":authority", authority, Some(quic::Qpack::Index::Authority));
    headers[3] = quic::Header::init(
        b":path",
        if !request.path.is_empty() { request.path } else { b"/" },
        Some(quic::Qpack::Index::Path),
    );

    let body = client.state.request_body;
    let has_inline_body =
        matches!(client.state.original_request_body, bun_http::OriginalRequestBody::Bytes(_))
            && !body.is_empty();
    let is_streaming =
        matches!(client.state.original_request_body, bun_http::OriginalRequestBody::Stream(_));

    let end_stream = !has_inline_body && !is_streaming;
    if qs.send_headers(&headers, end_stream) != 0 {
        return Err(err!("HTTP3HeaderEncodingError"));
    }

    if has_inline_body {
        stream.pending_body = body;
        drain_send_body(stream, qs);
    } else if is_streaming {
        stream.is_streaming_body = true;
        drain_send_body(stream, qs);
    } else {
        stream.request_body_done = true;
    }

    client.state.request_stage = if stream.request_body_done {
        bun_http::RequestStage::Done
    } else {
        bun_http::RequestStage::Body
    };
    client.state.response_stage = bun_http::ResponseStage::Headers;

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
    let Some(client) = stream.client.as_mut() else {
        return;
    };

    if stream.is_streaming_body {
        let bun_http::OriginalRequestBody::Stream(body) = &mut client.state.original_request_body
        else {
            unreachable!()
        };
        let Some(sb) = body.buffer.as_mut() else {
            return;
        };
        let buffer = sb.acquire();
        let data = buffer.slice();
        let mut written: usize = 0;
        while written < data.len() {
            let w = qs.write(&data[written..]);
            if w <= 0 {
                break;
            }
            written += usize::try_from(w).unwrap();
        }
        buffer.cursor += written;
        let drained = buffer.is_empty();
        if drained {
            buffer.reset();
        }
        if drained && body.ended {
            stream.request_body_done = true;
            qs.shutdown();
            client.state.request_stage = bun_http::RequestStage::Done;
        } else if !drained {
            qs.want_write(true);
        } else if !data.is_empty() {
            sb.report_drain();
        }
        sb.release();
        if stream.request_body_done {
            body.detach();
        }
        return;
    }

    while !stream.pending_body.is_empty() {
        let w = qs.write(stream.pending_body);
        if w <= 0 {
            break;
        }
        stream.pending_body = &stream.pending_body[usize::try_from(w).unwrap()..];
    }
    if stream.pending_body.is_empty() {
        stream.request_body_done = true;
        qs.shutdown();
        client.state.request_stage = bun_http::RequestStage::Done;
    } else {
        qs.want_write(true);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/encode.zig (132 lines)
//   confidence: medium
//   todos:      2
//   notes:      Cross-file enum/type names (Verbose, OriginalRequestBody, RequestStage, quic::Qpack::Class/Index) are guessed; `lower` disjoint-slice borrow into `headers` will need reshaping; `stream.client` deref depends on Stream field rust_type.
// ──────────────────────────────────────────────────────────────────────────
