//! One in-flight request on a multiplexed HTTP/2 `ClientSession`. Owned by the
//! session's `streams` map; `client` is a weak back-pointer to the `HTTPClient`
//! that the request belongs to (cleared before any terminal callback so the
//! deliver loop never dereferences a freed client).

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::Error;
use bun_picohttp as picohttp;

use crate::h2_frame_parser as wire;
// `H2Client.zig` is the parent module of `h2_client/`; `live_streams` lives there.
use super as h2;
use super::ClientSession;
// TODO(port): `bun.http` is the crate-root struct in Zig; confirm Rust path.
use crate::HTTPClient;

// `pub const new = bun.TrivialNew(@This());` — in Rust callers use `Box::new(Stream { .. })`.
// The Box is owned by `ClientSession.streams`; Drop runs when removed from the map.

pub struct Stream {
    // TODO(port): was u31 (HTTP/2 stream IDs are 31-bit); top bit must stay clear.
    pub id: u32,
    // BACKREF: this Stream is owned by `session.streams`; raw ptr per LIFETIMES class BACKREF.
    pub session: *mut ClientSession,
    // BACKREF: weak back-pointer, cleared before terminal callbacks.
    pub client: Option<NonNull<HTTPClient>>,

    /// HEADERS + CONTINUATION fragments, decoded once END_HEADERS arrives.
    pub header_block: Vec<u8>,
    /// DATA payload accumulated across one onData() pass.
    pub body_buffer: Vec<u8>,

    /// HPACK is decoded eagerly at parse time so the dynamic table stays
    /// consistent across multiple HEADERS in one read; the resulting strings
    /// land here until `deliverStream` hands them to handleResponseMetadata.
    pub decoded_bytes: Vec<u8>,
    pub decoded_headers: Vec<picohttp::Header>,
    /// Final (non-1xx) status code; 0 until the response HEADERS arrive.
    pub status_code: u32,

    pub state: State,
    /// `.closed` was reached via RST_STREAM (sent or received). Kept distinct
    /// from `state` so `rst()` stays idempotent (never answers an inbound RST,
    /// per §5.4.2) and so RST(NO_ERROR) can be told apart from a clean close.
    pub rst_done: bool,
    /// Set once a non-1xx HEADERS block has been decoded and is awaiting
    /// delivery. Subsequent HEADERS are trailers and decoded-then-dropped.
    pub headers_ready: bool,
    pub headers_end_stream: bool,
    /// Expect: 100-continue is in effect: hold the request body until a 1xx
    /// or final status arrives.
    pub awaiting_continue: bool,
    pub fatal_error: Option<Error>,
    /// DATA bytes consumed since the last WINDOW_UPDATE for this stream.
    pub unacked_bytes: u32,
    /// Σ DATA payload bytes (post-padding) for §8.1.1 Content-Length check —
    /// `total_body_received` is clamped at content_length so it can't catch
    /// overshoot.
    pub data_bytes_received: u64,
    /// Per-stream send window (server's INITIAL_WINDOW_SIZE plus any
    /// WINDOW_UPDATEs minus DATA bytes already framed).
    pub send_window: i32,
    /// Unsent suffix of a `.bytes` request body, parked while the send
    /// window is exhausted. Borrows from `client.state.request_body`.
    // TODO(port): lifetime — borrows from client.state.request_body; using &'static as Phase-A placeholder.
    pub pending_body: &'static [u8],
}

/// RFC 9113 §5.1. A `Stream` is created by sending HEADERS, so it starts
/// `.open`; `idle`/`reserved` are never represented as objects. END_STREAM
/// half-closes one side; both, or any RST_STREAM, transitions to `.closed`.
#[repr(u8)] // TODO(port): was enum(u2)
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum State {
    Open,
    /// We have written END_STREAM; no more DATA may be queued.
    HalfClosedLocal,
    /// Peer has sent END_STREAM; further DATA is STREAM_CLOSED.
    HalfClosedRemote,
    Closed,
}

impl Drop for Stream {
    fn drop(&mut self) {
        // Zig .monotonic == LLVM monotonic == Rust Relaxed.
        let _ = h2::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
        // header_block / body_buffer / decoded_bytes / decoded_headers: Vec<_> drops automatically.
        // bun.destroy(this): freeing the Box is the caller's drop; nothing to do here.
    }
}

impl Stream {
    pub fn rst(&mut self, code: wire::ErrorCode) {
        if self.rst_done || self.state == State::Closed {
            return;
        }
        self.rst_done = true;
        self.state = State::Closed;
        let value: u32 = (code as u32).swap_bytes();
        // SAFETY: `session` is a live backref while this Stream is in `session.streams`.
        unsafe {
            (*self.session).write_frame(
                wire::FrameType::HTTP_FRAME_RST_STREAM,
                0,
                self.id,
                &value.to_ne_bytes(),
            );
        }
    }

    pub fn sent_end_stream(&mut self) {
        self.state = match self.state {
            State::Open => State::HalfClosedLocal,
            State::HalfClosedRemote => State::Closed,
            other => other,
        };
    }

    pub fn recv_end_stream(&mut self) {
        self.state = match self.state {
            State::Open => State::HalfClosedRemote,
            State::HalfClosedLocal => State::Closed,
            other => other,
        };
    }

    /// We have sent END_STREAM (or RST): no more request DATA may be queued.
    #[inline]
    pub fn local_closed(&self) -> bool {
        self.state == State::HalfClosedLocal || self.state == State::Closed
    }

    /// Peer has sent END_STREAM (or RST): the response body is complete and
    /// further inbound DATA is a protocol error.
    #[inline]
    pub fn remote_closed(&self) -> bool {
        self.state == State::HalfClosedRemote || self.state == State::Closed
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h2_client/Stream.zig (114 lines)
//   confidence: medium
//   todos:      3
//   notes:      session/client are raw backrefs (no TSV row); pending_body borrows client.state.request_body — needs real lifetime in Phase B; u31 id widened to u32.
// ──────────────────────────────────────────────────────────────────────────
