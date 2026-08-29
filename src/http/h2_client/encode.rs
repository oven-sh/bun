//! Outbound request encoding for the fetch() HTTP/2 client: connection
//! preface, HEADERS/CONTINUATION serialisation via HPACK, and DATA framing
//! under both flow-control windows. Free functions over `&ClientSession`.

use super::client_session::ClientSession;
use super::stream::Stream;
use super::{LOCAL_INITIAL_WINDOW_SIZE, LOCAL_MAX_HEADER_LIST_SIZE, WRITE_BUFFER_HIGH_WATER};
use crate::HTTPClient;
use crate::h2_frame_parser as wire;
use crate::http_request_body::Body;
use crate::internal_state::HTTPStage;
use bun_core::strings;
use bun_picohttp as picohttp;

pub(crate) fn write_preface(session: &ClientSession) {
    session.queue(wire::CLIENT_PREFACE);

    let mut settings = [0u8; 3 * wire::SettingsPayloadUnit::BYTE_SIZE];
    encode_setting(
        &mut settings[0..6],
        wire::SettingsType::SETTINGS_ENABLE_PUSH,
        0,
    );
    encode_setting(
        &mut settings[6..12],
        wire::SettingsType::SETTINGS_INITIAL_WINDOW_SIZE,
        LOCAL_INITIAL_WINDOW_SIZE,
    );
    encode_setting(
        &mut settings[12..18],
        wire::SettingsType::SETTINGS_MAX_HEADER_LIST_SIZE,
        LOCAL_MAX_HEADER_LIST_SIZE,
    );
    session.write_frame(wire::FrameType::HTTP_FRAME_SETTINGS, 0, 0, &settings);

    // Connection-level window starts at 64 KiB regardless of SETTINGS;
    // open it to match the per-stream window so the first response isn't
    // throttled before our first WINDOW_UPDATE.
    session.write_window_update(0, LOCAL_INITIAL_WINDOW_SIZE - wire::DEFAULT_WINDOW_SIZE);
    session.preface_sent.set(true);
}

#[inline]
fn encode_setting(dst: &mut [u8], setting: wire::SettingsType, value: u32) {
    dst[0..2].copy_from_slice(&setting.0.to_be_bytes());
    dst[2..6].copy_from_slice(&value.to_be_bytes());
}

/// One classification pass per request header replaces a dozen case-insensitive
/// string compares. Names are lowercased once (required for the wire anyway),
/// then dispatched by length+content.
#[derive(Copy, Clone, Eq, PartialEq)]
enum RequestHeader {
    /// RFC 9113 §8.2.2 hop-by-hop: never forwarded.
    Drop,
    /// Promoted to `:authority`, then dropped.
    Host,
    /// Forwarded only if value is exactly "trailers".
    Te,
    /// Dropped under Expect: 100-continue (body may be abandoned).
    ContentLength,
    /// Triggers awaiting_continue when value is "100-continue".
    Expect,
    /// Forwarded with HPACK never-index so they don't enter the dynamic table.
    Sensitive,
}

// The match is case-sensitive; the first pass below pre-lowercases the probe
// so that suffices (header name matching must be case-insensitive).
fn classify_request_header(name: &[u8]) -> Option<RequestHeader> {
    Some(match name {
        b"connection" => RequestHeader::Drop,
        b"keep-alive" => RequestHeader::Drop,
        b"proxy-connection" => RequestHeader::Drop,
        b"transfer-encoding" => RequestHeader::Drop,
        b"upgrade" => RequestHeader::Drop,
        b"host" => RequestHeader::Host,
        b"te" => RequestHeader::Te,
        b"content-length" => RequestHeader::ContentLength,
        b"expect" => RequestHeader::Expect,
        b"authorization" => RequestHeader::Sensitive,
        b"cookie" => RequestHeader::Sensitive,
        b"set-cookie" => RequestHeader::Sensitive,
        _ => return None,
    })
}

pub(crate) fn write_request(
    session: &ClientSession,
    client: &mut HTTPClient,
    stream: &Stream,
    request: &picohttp::Request<'_>,
) -> crate::Result<()> {
    // Pull the scratch out so nothing else can observe it mid-encode; pushed
    // back at the end.
    let mut encoded = core::mem::take(&mut *session.encode_scratch.borrow_mut());
    encoded.clear();

    if let Some(cap) = session.pending_hpack_enc_capacity.take() {
        session.hpack.borrow_mut().set_encoder_max_capacity(cap);
        encoded.reserve(8);
        encode_hpack_table_size_update(&mut encoded, cap);
    }

    let mut authority: &[u8] = client.url.host();
    let mut has_expect_continue = false;
    let mut lower_buf = [0u8; 256];
    for h in request.headers {
        // Pre-lowercase for the case-insensitive lookup.
        let lname: &[u8] = if h.name().len() <= lower_buf.len() {
            strings::copy_lowercase_if_needed(h.name(), &mut lower_buf)
        } else {
            continue; // long names can't match any of the short keys above
        };
        let Some(kind) = classify_request_header(lname) else {
            continue;
        };
        match kind {
            RequestHeader::Host => authority = h.value(),
            RequestHeader::Expect => {
                has_expect_continue =
                    strings::eql_case_insensitive_asciii_check_length(h.value(), b"100-continue");
            }
            _ => {}
        }
    }

    encode_header(session, &mut encoded, b":method", request.method, false)?;
    encode_header(session, &mut encoded, b":scheme", b"https", false)?;
    encode_header(session, &mut encoded, b":authority", authority, false)?;
    encode_header(
        session,
        &mut encoded,
        b":path",
        if !request.path.is_empty() {
            request.path
        } else {
            b"/"
        },
        false,
    )?;

    for h in request.headers {
        // §8.2.1: field names MUST be lowercase on the wire. copy_lowercase_if_needed
        // returns the input slice unchanged when it's already lowercase, so
        // the common (Fetch-normalised) case is zero-copy. lshpack rejects
        // names+values >64KiB anyway, so the heap fallback only ever holds a
        // few hundred bytes.
        let mut heap: Vec<u8>;
        let name: &[u8] = if h.name().len() <= lower_buf.len() {
            strings::copy_lowercase_if_needed(h.name(), &mut lower_buf)
        } else {
            heap = vec![0u8; h.name().len()];
            strings::copy_lowercase_if_needed(h.name(), &mut heap)
        };
        let mut never_index = false;
        if let Some(kind) = classify_request_header(name) {
            match kind {
                RequestHeader::Drop | RequestHeader::Host => continue,
                RequestHeader::Te => {
                    if !strings::eql_case_insensitive_asciii_check_length(
                        strings::trim(h.value(), b" \t"),
                        b"trailers",
                    ) {
                        continue;
                    }
                }
                RequestHeader::ContentLength => {
                    if has_expect_continue {
                        continue;
                    }
                }
                RequestHeader::Sensitive => never_index = true,
                RequestHeader::Expect => {}
            }
        }
        encode_header(session, &mut encoded, name, h.value(), never_index)?;
    }

    // request_body points into original_request_body.bytes (lives in client.state).
    let body = client.state.request_body;
    let has_inline_body =
        matches!(client.state.original_request_body, Body::Bytes(_)) && !body.is_empty();
    let is_streaming = matches!(client.state.original_request_body, Body::Stream(_));

    if has_expect_continue && (has_inline_body || is_streaming) {
        stream.awaiting_continue.set(true);
    }

    write_header_block(
        session,
        stream.id,
        &encoded,
        !has_inline_body && !is_streaming,
    );
    if encoded.capacity() > 64 * 1024 {
        encoded = Vec::new();
    }
    *session.encode_scratch.borrow_mut() = encoded;
    if has_inline_body {
        stream.pending_body.set(body);
        drain_send_body_for(session, stream, client, usize::MAX);
    } else if !is_streaming {
        stream.sent_end_stream();
    }
    Ok(())
}

pub(crate) fn write_header_block(
    session: &ClientSession,
    stream_id: u32,
    block: &[u8],
    end_stream: bool,
) {
    let max: usize = session.remote_max_frame_size.get() as usize;
    let mut remaining = block;
    let mut first = true;
    loop {
        let chunk = &remaining[0..remaining.len().min(max)];
        remaining = &remaining[chunk.len()..];
        let last = remaining.is_empty();
        let mut flags: u8 = 0;
        if last {
            flags |= wire::HeadersFrameFlags::END_HEADERS as u8;
        }
        if first && end_stream {
            flags |= wire::HeadersFrameFlags::END_STREAM as u8;
        }
        session.write_frame(
            if first {
                wire::FrameType::HTTP_FRAME_HEADERS
            } else {
                wire::FrameType::HTTP_FRAME_CONTINUATION
            },
            flags,
            stream_id,
            chunk,
        );
        first = false;
        if last {
            break;
        }
    }
}

/// Frame `data` into DATA frames respecting `remote_max_frame_size` and
/// both flow-control windows. Returns bytes consumed; END_STREAM is set
/// on the final frame only when `end_stream` and all of `data` fit.
pub(crate) fn write_data_windowed(
    session: &ClientSession,
    stream: &Stream,
    data: &[u8],
    end_stream: bool,
    cap: usize,
) -> usize {
    let mut remaining = data;
    let mut consumed: usize = 0;
    loop {
        let window: usize = usize::try_from(
            stream
                .send_window
                .get()
                .min(session.conn_send_window.get())
                .max(0),
        )
        .expect("int cast");
        if !remaining.is_empty() && window == 0 {
            break;
        }
        // Socket-side backpressure: don't keep memcpy'ing into write_buffer
        // once it's past the high-water mark — onWritable resumes us.
        if !remaining.is_empty() && session.write_buffer_size() >= WRITE_BUFFER_HIGH_WATER {
            break;
        }
        if consumed >= cap && !remaining.is_empty() {
            break;
        }
        let chunk_len = remaining
            .len()
            .min(session.remote_max_frame_size.get() as usize)
            .min(window);
        let last = chunk_len == remaining.len();
        let flags: u8 = if last && end_stream {
            wire::DataFrameFlags::END_STREAM as u8
        } else {
            0
        };
        session.write_frame(
            wire::FrameType::HTTP_FRAME_DATA,
            flags,
            stream.id,
            &remaining[0..chunk_len],
        );
        let chunk = i32::try_from(chunk_len).expect("int cast");
        stream.send_window.set(stream.send_window.get() - chunk);
        session
            .conn_send_window
            .set(session.conn_send_window.get() - chunk);
        consumed += chunk_len;
        remaining = &remaining[chunk_len..];
        if last {
            break;
        }
    }
    consumed
}

/// Push as much of `stream`'s request body as the send windows allow.
/// Buffers into `write_buffer`; caller flushes.
pub(crate) fn drain_send_body(session: &ClientSession, stream: &Stream, cap: usize) {
    let Some(req) = stream.client.get() else {
        return;
    };
    let mut client = req.client();
    drain_send_body_for(session, stream, &mut client, cap);
}

/// [`drain_send_body`] for a stream whose request the caller is already
/// working on.
pub(crate) fn drain_send_body_for(
    session: &ClientSession,
    stream: &Stream,
    client: &mut HTTPClient,
    cap: usize,
) {
    if stream.local_closed() || stream.awaiting_continue.get() || stream.fatal_error.get().is_some()
    {
        return;
    }
    match &mut client.state.original_request_body {
        Body::Bytes(_) => {
            let pending = stream.pending_body.get();
            let sent = write_data_windowed(session, stream, pending.slice(), true, cap);
            // pending_body[sent..] is a suffix of the original slice.
            stream
                .pending_body
                .set(bun_ptr::RawSlice::new(&pending.slice()[sent..]));
            if stream.pending_body.get().is_empty() {
                stream.sent_end_stream();
                client.state.request_stage = HTTPStage::Done;
            }
        }
        Body::Stream(body) => {
            let ended = body.ended;
            let Some(sb) = body.buffer() else {
                return;
            };
            {
                let mut buffer = sb.lock();
                let data_len = buffer.size();
                if data_len == 0 && !ended {
                    return;
                }
                let sent = write_data_windowed(session, stream, buffer.slice(), ended, cap);
                buffer.cursor += sent;
                let drained = buffer.is_empty();
                if drained {
                    buffer.reset();
                }
                if drained && ended {
                    stream.sent_end_stream();
                    client.state.request_stage = HTTPStage::Done;
                } else if drained && data_len > 0 {
                    buffer.report_drain();
                }
            }
            if stream.local_closed() {
                body.detach();
            }
        }
        Body::Sendfile(_) => unreachable!(),
    }
}

/// Push every stream's request body, round-robin. `busy` is the stream whose
/// request the caller is already working on, with that request's client.
/// True if it stopped at `WRITE_BUFFER_HIGH_WATER` with body bytes still sendable.
pub(crate) fn drain_send_bodies(
    session: &ClientSession,
    mut busy: Option<(&Stream, &mut HTTPClient)>,
) -> bool {
    // Round-robin: each pass gives every uploader at most one
    // remote_max_frame_size slice before the next stream gets a turn, so
    // the lowest-index stream can't monopolise conn_send_window.
    let slice: usize = session.remote_max_frame_size.get() as usize;
    loop {
        if session.conn_send_window.get() <= 0 {
            return false;
        }
        if session.write_buffer_size() >= WRITE_BUFFER_HIGH_WATER {
            return true;
        }
        let mut progressed = false;
        let mut i = 0usize;
        loop {
            let Some(stream) = session.streams.borrow().values().get(i).cloned() else {
                break;
            };
            i += 1;
            if stream.local_closed() || stream.send_window.get() <= 0 {
                continue;
            }
            let before = session.conn_send_window.get();
            match &mut busy {
                Some((busy_stream, client)) if busy_stream.id == stream.id => {
                    drain_send_body_for(session, &stream, client, slice)
                }
                _ => drain_send_body(session, &stream, slice),
            }
            if session.conn_send_window.get() != before || stream.local_closed() {
                progressed = true;
            }
        }
        if !progressed {
            return false;
        }
    }
}

fn encode_header(
    session: &ClientSession,
    encoded: &mut Vec<u8>,
    name: &[u8],
    value: &[u8],
    never_index: bool,
) -> crate::Result<()> {
    let len = encoded.len();
    let required = len + name.len() + value.len() + 32;
    encoded.resize(required, 0);
    let written = session
        .hpack
        .borrow_mut()
        .encode(name, value, never_index, encoded, len)
        .map_err(crate::Error::from);
    match written {
        Ok(written) => {
            encoded.truncate(len + written);
            Ok(())
        }
        Err(err) => {
            encoded.truncate(len);
            Err(err)
        }
    }
}

/// RFC 7541 §6.3 Dynamic Table Size Update: `001` prefix, 5-bit-prefix
/// integer. Must be the first opcode in a header block. Caller guarantees
/// at least 6 bytes of capacity (max for a u32).
fn encode_hpack_table_size_update(encoded: &mut Vec<u8>, value: u32) {
    if value < 31 {
        encoded.push(0x20 | u8::try_from(value).expect("int cast"));
        return;
    }
    encoded.push(0x20 | 31);
    let mut rest = value - 31;
    while rest >= 128 {
        encoded.push((rest as u8) | 0x80);
        rest >>= 7;
    }
    encoded.push(rest as u8);
}
