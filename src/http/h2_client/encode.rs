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
use std::collections::VecDeque;

pub(crate) fn write_preface(session: &mut ClientSession) {
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
    session: &mut ClientSession,
    client: &mut HTTPClient,
    stream: &mut Stream,
    request: &picohttp::Request<'_>,
) -> crate::Result<()> {
    // `encode_scratch` would be borrowed mutably
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
        send_body(session, stream);
    } else if !is_streaming {
        stream.sent_end_stream();
    }
    Ok(())
}

pub(crate) fn write_header_block(
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
fn write_data_windowed(
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

/// Why `drain_send_body` stopped.
enum Drain {
    /// END_STREAM is sent, or the stream can no longer send.
    Closed,
    /// A streamed body with nothing buffered that has not ended. `send_body`
    /// runs again when it is fed.
    Idle,
    /// Bytes are left and the connection holds them: its send window is used
    /// up, or `write_buffer` is at `WRITE_BUFFER_HIGH_WATER`.
    ConnBlocked,
    /// Bytes are left and the stream holds them: it framed `cap`, its own
    /// send window is used up, or it waits for a 100 Continue.
    Yield,
}

/// Frame at most `cap` bytes of `stream`'s request body, as far as the send
/// windows allow. Buffers into `write_buffer`; caller flushes. The END_STREAM
/// of a body with no bytes left needs no window and goes out at any `cap`.
fn drain_send_body(session: &mut ClientSession, stream: &mut Stream, cap: usize) -> Drain {
    if stream.local_closed() || stream.fatal_error.is_some() {
        return Drain::Closed;
    }
    let Some(client_ptr) = stream.client else {
        return Drain::Closed;
    };
    if stream.awaiting_continue {
        return Drain::Yield;
    }
    let client = super::client_session::stream_client_mut(client_ptr);
    let sent = match &mut client.state.original_request_body {
        HTTPRequestBody::Bytes(_) => {
            let pending = stream.pending_body;
            let sent = write_data_windowed(session, stream, pending.slice(), true, cap);
            // pending_body[sent..] is a suffix of the original slice.
            stream.pending_body = bun_ptr::RawSlice::new(&pending.slice()[sent..]);
            if stream.pending_body.is_empty() {
                stream.sent_end_stream();
                client.state.request_stage = HTTPStage::Done;
                return Drain::Closed;
            }
            sent
        }
        HTTPRequestBody::Stream(body) => {
            let ended = body.ended;
            let Some(sb) = body.buffer_mut() else {
                return Drain::Idle;
            };
            let buffer = sb.acquire();
            let data_ptr = buffer.list.as_ptr();
            let data_len = buffer.size();
            let cursor = buffer.cursor;
            if data_len == 0 && !ended {
                sb.release();
                return Drain::Idle;
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
                return Drain::Closed;
            }
            if drained {
                return Drain::Idle;
            }
            sent
        }
        HTTPRequestBody::Sendfile(_) => unreachable!(),
    };
    if sent < cap && stream.send_window > 0 {
        Drain::ConnBlocked
    } else {
        Drain::Yield
    }
}

/// The streams whose request body has bytes left that could not be framed,
/// in the order they take turns at the connection window and the write
/// buffer. It holds ids, not pointers, so an id that outlives its stream
/// matches nothing.
#[derive(Default)]
pub(crate) struct SendQueue {
    ids: VecDeque<u32>,
    /// What is left of the front stream's slice after the connection cut its
    /// turn short. 0: its next turn is a whole slice.
    turn_left: u32,
}

impl SendQueue {
    fn pop(&mut self) {
        self.ids.pop_front();
        self.turn_left = 0;
    }

    /// The stream with this id is removed while it waits.
    pub(crate) fn remove(&mut self, id: u32) {
        match self.ids.iter().position(|&queued| queued == id) {
            Some(0) => self.pop(),
            Some(at) => {
                self.ids.remove(at);
            }
            None => {}
        }
    }

    /// Round robin: the stream at the front frames one `remote_max_frame_size`
    /// slice and goes to the back. The order outlives the call, so a window
    /// grant of any size goes to the stream after the one that used the last
    /// grant. True if it stopped at `WRITE_BUFFER_HIGH_WATER`.
    fn serve(&mut self, session: &mut ClientSession) -> bool {
        // Streams in a row that framed nothing. A full lap of them ends the
        // pass, so streams that wait for their own window cannot spin it.
        let mut stalled: usize = 0;
        while stalled < self.ids.len() {
            if session.conn_send_window <= 0 {
                return false;
            }
            if session.write_buffer.size() >= WRITE_BUFFER_HIGH_WATER {
                return true;
            }
            let Some(&stream) = session.streams.get(&self.ids[0]) else {
                self.pop();
                continue;
            };
            let stream = super::client_session::stream_mut(stream);
            let turn = match self.turn_left {
                0 => session.remote_max_frame_size,
                left => left,
            };
            // With nobody to take turns with, a slice boundary only adds laps.
            let cap = if self.ids.len() == 1 {
                usize::MAX
            } else {
                turn as usize
            };
            let before = session.conn_send_window;
            let drain = if stream.send_window <= 0 && !stream.local_closed() {
                Drain::Yield
            } else {
                drain_send_body(session, stream, cap)
            };
            let sent = u32::try_from(before - session.conn_send_window).expect("int cast");
            if sent != 0 {
                stalled = 0;
            }
            match drain {
                Drain::Closed | Drain::Idle => {
                    stream.queued = false;
                    self.pop();
                }
                // It keeps the front and the rest of its slice. The checks at
                // the top of the loop end the pass.
                Drain::ConnBlocked => self.turn_left = turn.saturating_sub(sent),
                Drain::Yield => {
                    self.turn_left = 0;
                    self.ids.rotate_left(1);
                    if sent == 0 {
                        stalled += 1;
                    }
                }
            }
        }
        false
    }
}

/// `stream` has request-body bytes, or the end of its body, to send: at
/// attach, and each time a streamed body is fed. With no stream waiting it
/// frames what the windows allow. Behind waiting streams it frames nothing
/// and joins the queue, so it takes no window ahead of them.
pub(crate) fn send_body(session: &mut ClientSession, stream: &mut Stream) {
    if stream.queued {
        return;
    }
    let cap = match &session.send_queue {
        Some(queue) if !queue.ids.is_empty() => 0,
        _ => usize::MAX,
    };
    if matches!(
        drain_send_body(session, stream, cap),
        Drain::ConnBlocked | Drain::Yield
    ) {
        stream.queued = true;
        session
            .send_queue
            .get_or_insert_default()
            .ids
            .push_back(stream.id);
    }
}

/// True if it stopped at `WRITE_BUFFER_HIGH_WATER` with body bytes still sendable.
pub(crate) fn drain_send_bodies(session: &mut ClientSession) -> bool {
    // `drain_send_body` takes the whole session, so the queue leaves it for
    // the pass.
    let more = match session.send_queue.take() {
        Some(mut queue) => {
            let more = queue.serve(session);
            session.send_queue = Some(queue);
            more
        }
        None => false,
    };
    #[cfg(debug_assertions)]
    for &stream in session.streams.values() {
        let s = super::client_session::stream_mut(stream);
        debug_assert!(
            s.queued
                || s.pending_body.is_empty()
                || s.local_closed()
                || s.fatal_error.is_some()
                || s.client.is_none(),
            "h2 stream {} has unsent body bytes and is not in the send queue",
            s.id
        );
    }
    more
}

fn encode_header(
    session: &mut ClientSession,
    encoded: &mut Vec<u8>,
    name: &[u8],
    value: &[u8],
    never_index: bool,
) -> crate::Result<()> {
    let required = encoded.len() + name.len() + value.len() + 32;
    encoded.reserve(required.saturating_sub(encoded.len()));
    let len = encoded.len();
    // Write through the raw buffer and set_len after.
    // SAFETY: `hpack.encode` writes only into `[len..len+written]`, which is
    // within the just-reserved capacity; bytes in `[0..len]` are initialized.
    let buf = unsafe { bun_core::vec::allocated_bytes_mut(encoded) };
    let written = session
        .hpack
        .encode(name, value, never_index, buf, len)
        .map_err(crate::Error::from)?;
    // SAFETY: hpack wrote `written` bytes at offset `len`; new_len <= capacity.
    unsafe { bun_core::vec::commit_spare(encoded, written) };
    Ok(())
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
