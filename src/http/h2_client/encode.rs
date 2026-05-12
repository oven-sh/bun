//! Outbound request encoding for the fetch() HTTP/2 client: connection
//! preface, HEADERS/CONTINUATION serialisation via HPACK, and DATA framing
//! under both flow-control windows. Free functions over `&mut ClientSession`.

use super::client_session::ClientSession;
use super::stream::Stream;
use super::{LOCAL_INITIAL_WINDOW_SIZE, LOCAL_MAX_HEADER_LIST_SIZE, WRITE_BUFFER_HIGH_WATER};
use crate::HTTPClient;
use crate::h2_frame_parser as wire;
use crate::http_request_body::HTTPRequestBody;
use crate::internal_state::HTTPStage;
use bun_core::strings;
use bun_picohttp as picohttp;

pub fn write_preface(session: &mut ClientSession) {
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
    session.preface_sent = true;
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

// PORT NOTE: Zig used a comptime case-insensitive map. The first pass below
// pre-lowercases the probe so a case-sensitive match suffices.
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

pub fn write_request(
    session: &mut ClientSession,
    client: &mut HTTPClient,
    stream: &mut Stream,
    request: &picohttp::Request<'_>,
) -> Result<(), bun_core::Error> {
    // PORT NOTE: reshaped for borrowck — `encode_scratch` is borrowed mutably
    // alongside `&mut *session` below; pull the Vec out, push it back at the end.
    let mut encoded = core::mem::take(&mut session.encode_scratch);
    encoded.clear();

    if let Some(cap) = session.pending_hpack_enc_capacity {
        session.pending_hpack_enc_capacity = None;
        session.hpack.set_encoder_max_capacity(cap);
        encoded.reserve(8);
        encode_hpack_table_size_update(&mut encoded, cap);
    }

    let mut authority: &[u8] = client.url.host;
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
    let has_inline_body = matches!(
        client.state.original_request_body,
        HTTPRequestBody::Bytes(_)
    ) && !body.is_empty();
    let is_streaming = matches!(
        client.state.original_request_body,
        HTTPRequestBody::Stream(_)
    );

    if has_expect_continue && (has_inline_body || is_streaming) {
        stream.awaiting_continue = true;
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
    session.encode_scratch = encoded;
    if has_inline_body {
        stream.pending_body = body;
        drain_send_body(session, stream, usize::MAX);
    } else if !is_streaming {
        stream.sent_end_stream();
    }
    Ok(())
}

pub fn write_header_block(
    session: &mut ClientSession,
    stream_id: u32,
    block: &[u8],
    end_stream: bool,
) {
    let max: usize = session.remote_max_frame_size as usize;
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
pub fn write_data_windowed(
    session: &mut ClientSession,
    stream: &mut Stream,
    data: &[u8],
    end_stream: bool,
    cap: usize,
) -> usize {
    let mut remaining = data;
    let mut consumed: usize = 0;
    loop {
        let window: usize =
            usize::try_from(stream.send_window.min(session.conn_send_window).max(0))
                .expect("int cast");
        if !remaining.is_empty() && window == 0 {
            break;
        }
        // Socket-side backpressure: don't keep memcpy'ing into write_buffer
        // once it's past the high-water mark — onWritable resumes us.
        if !remaining.is_empty() && session.write_buffer.size() >= WRITE_BUFFER_HIGH_WATER {
            break;
        }
        if consumed >= cap && !remaining.is_empty() {
            break;
        }
        let chunk_len = remaining
            .len()
            .min(session.remote_max_frame_size as usize)
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
        stream.send_window -= i32::try_from(chunk_len).expect("int cast");
        session.conn_send_window -= i32::try_from(chunk_len).expect("int cast");
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
pub fn drain_send_body(session: &mut ClientSession, stream: &mut Stream, cap: usize) {
    if stream.local_closed() || stream.awaiting_continue || stream.fatal_error.is_some() {
        return;
    }
    let Some(client_ptr) = stream.client else {
        return;
    };
    let client = super::client_session::stream_client_mut(client_ptr);
    match &mut client.state.original_request_body {
        HTTPRequestBody::Bytes(_) => {
            let pending = stream.pending_body;
            let sent = write_data_windowed(session, stream, pending.slice(), true, cap);
            // pending_body[sent..] is a suffix of the original slice.
            stream.pending_body = bun_ptr::RawSlice::new(&pending.slice()[sent..]);
            if stream.pending_body.is_empty() {
                stream.sent_end_stream();
                client.state.request_stage = HTTPStage::Done;
            }
        }
        HTTPRequestBody::Stream(body) => {
            let ended = body.ended;
            let Some(sb) = body.buffer_mut() else {
                return;
            };
            let buffer = sb.acquire();
            let data_ptr = buffer.list.as_ptr();
            let data_len = buffer.size();
            let cursor = buffer.cursor;
            if data_len == 0 && !ended {
                sb.release();
                return;
            }
            // SAFETY: data_ptr[cursor..cursor+data_len] is the readable slice.
            let data = unsafe { bun_core::ffi::slice(data_ptr.add(cursor), data_len) };
            let sent = write_data_windowed(session, stream, data, ended, cap);
            // We still hold the lock from `acquire()` above; `sb` is the sole
            // live borrow, so reborrowing `&mut sb.buffer` is a child access.
            let buffer = &mut sb.buffer;
            buffer.cursor += sent;
            let drained = buffer.is_empty();
            if drained {
                buffer.reset();
            }
            if drained && ended {
                stream.sent_end_stream();
                client.state.request_stage = HTTPStage::Done;
            } else if drained && data_len > 0 {
                sb.report_drain();
            }
            sb.release();
            if stream.local_closed() {
                body.detach();
            }
        }
        HTTPRequestBody::Sendfile(_) => unreachable!(),
    }
}

pub fn drain_send_bodies(session: &mut ClientSession) {
    // Round-robin: each pass gives every uploader at most one
    // remote_max_frame_size slice before the next stream gets a turn, so
    // the lowest-index stream can't monopolise conn_send_window.
    let slice: usize = session.remote_max_frame_size as usize;
    while session.conn_send_window > 0 && session.write_buffer.size() < WRITE_BUFFER_HIGH_WATER {
        let mut progressed = false;
        // PORT NOTE: reshaped for borrowck — Zig iterates `session.streams.values()`
        // while passing `session` mutably to `drain_send_body`. Iterate by index
        // and re-borrow each pass.
        let mut i = 0usize;
        while i < session.streams.count() {
            let stream = session.streams.values()[i];
            let s = super::client_session::stream_mut(stream);
            i += 1;
            if s.local_closed() || s.send_window <= 0 {
                continue;
            }
            let before = session.conn_send_window;
            drain_send_body(session, s, slice);
            if session.conn_send_window != before || s.local_closed() {
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
}

pub fn encode_header(
    session: &mut ClientSession,
    encoded: &mut Vec<u8>,
    name: &[u8],
    value: &[u8],
    never_index: bool,
) -> Result<(), bun_core::Error> {
    let required = encoded.len() + name.len() + value.len() + 32;
    encoded.reserve(required.saturating_sub(encoded.len()));
    // Zig passed `encoded.allocatedSlice()` (ptr[0..capacity]) + current len as
    // offset; mirror with the raw buffer and set_len after.
    // SAFETY: `hpack.encode` writes only into `[len..len+written]`, which is
    // within the just-reserved capacity; bytes in `[0..len]` are initialized.
    let len = encoded.len();
    let buf = unsafe { bun_core::vec::allocated_bytes_mut(encoded) };
    let written = session
        .hpack
        .encode(name, value, never_index, buf, len)
        .map_err(|e| bun_core::err!(from e))?;
    // SAFETY: hpack wrote `written` bytes at offset `len`; new_len <= capacity.
    unsafe { bun_core::vec::commit_spare(encoded, written) };
    Ok(())
}

/// RFC 7541 §6.3 Dynamic Table Size Update: `001` prefix, 5-bit-prefix
/// integer. Must be the first opcode in a header block. Caller guarantees
/// at least 6 bytes of capacity (max for a u32).
pub fn encode_hpack_table_size_update(encoded: &mut Vec<u8>, value: u32) {
    if value < 31 {
        // PERF(port): was assume_capacity
        encoded.push(0x20 | u8::try_from(value).expect("int cast"));
        return;
    }
    // PERF(port): was assume_capacity
    encoded.push(0x20 | 31);
    let mut rest = value - 31;
    while rest >= 128 {
        // PERF(port): was assume_capacity
        encoded.push((rest as u8) | 0x80);
        rest >>= 7;
    }
    // PERF(port): was assume_capacity
    encoded.push(rest as u8);
}

// ported from: src/http/h2_client/encode.zig
