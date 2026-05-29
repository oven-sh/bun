//! One in-flight request on a multiplexed HTTP/2 `ClientSession`. Owned by the
//! session's `streams` map; `client` is a weak back-pointer to the `HTTPClient`
//! that the request belongs to (cleared before any terminal callback so the
//! deliver loop never dereferences a freed client).

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::Error;
use bun_picohttp as picohttp;

// `H2Client.zig` is the parent module of `h2_client/`; `live_streams` lives there.
use super::client_session::ClientSession;
use crate::HTTPClient;

// `pub const new = bun.TrivialNew(@This());` — see `Stream::new` below, which fills the
// Zig field defaults and returns a Box. The Box is owned by `ClientSession.streams`;
// Drop runs when removed from the map.

pub struct Stream {
    // PORT NOTE: was u31 (HTTP/2 stream IDs are 31-bit); top bit must stay clear.
    pub id: u32,
    // BACKREF: this Stream is owned by `session.streams`; raw ptr per LIFETIMES class BACKREF.
    pub session: *mut ClientSession,
    // BACKREF: weak back-pointer, cleared before terminal callbacks.
    // Lifetime-erased — the stream never reads borrowed fields through this.
    pub client: Option<NonNull<HTTPClient<'static>>>,

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
    pub pending_body: bun_ptr::RawSlice<u8>,
}

impl Stream {
    #[inline]
    pub fn client_mut(&mut self) -> Option<&mut HTTPClient<'static>> {
        // Delegates to the shared accessor in `client_session`; see INVARIANT
        // above (identical to `stream_client_mut`'s invariant).
        self.client.map(super::client_session::stream_client_mut)
    }

    /// Shared access to the owning `HTTPClient` while `client` is `Some`.
    /// See [`Self::client_mut`] for the lifetime invariant.
    #[inline]
    pub fn client_ref(&self) -> Option<&HTTPClient<'static>> {
        // Same INVARIANT as `client_mut`; route through the shared
        // `stream_client_mut` accessor (one centralised unsafe) and reborrow
        // shared.
        self.client
            .map(|c| &*super::client_session::stream_client_mut(c))
    }
}

/// RFC 9113 §5.1. A `Stream` is created by sending HEADERS, so it starts
/// `.open`; `idle`/`reserved` are never represented as objects. END_STREAM
/// half-closes one side; both, or any RST_STREAM, transitions to `.closed`.
#[repr(u8)] // PORT NOTE: was enum(u2)
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
        let _ = super::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
        // header_block / body_buffer / decoded_bytes / decoded_headers: Vec<_> drops automatically.
        // bun.destroy(this): freeing the Box is the caller's drop; nothing to do here.
    }
}

impl Stream {
    /// Mirrors `bun.TrivialNew(@This())` + Zig struct field defaults: callers in Zig
    /// write `Stream.new(.{ .id, .session, .client, .send_window })` and the rest
    /// default to `.{}` / `0` / `false` / `""`.
    pub fn new(
        id: u32,
        session: *mut ClientSession,
        client: Option<NonNull<HTTPClient<'static>>>,
        send_window: i32,
    ) -> Box<Self> {
        Box::new(Self {
            id,
            session,
            client,
            header_block: Vec::new(),
            body_buffer: Vec::new(),
            decoded_bytes: Vec::new(),
            decoded_headers: Vec::new(),
            status_code: 0,
            state: State::Open,
            rst_done: false,
            headers_ready: false,
            headers_end_stream: false,
            awaiting_continue: false,
            fatal_error: None,
            unacked_bytes: 0,
            data_bytes_received: 0,
            send_window,
            pending_body: bun_ptr::RawSlice::EMPTY,
        })
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

// ported from: src/http/h2_client/Stream.zig
