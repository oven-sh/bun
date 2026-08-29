//! One in-flight request on a multiplexed HTTP/2 `ClientSession`. Owned by the
//! session's `streams` map (as an `Rc`, so frame handlers can hold one while
//! the session's other state is in use); `client` is a back-reference to the
//! request the stream belongs to (cleared before any terminal callback so the
//! deliver loop never touches a finished request).

use core::cell::{Cell, RefCell};
use core::sync::atomic::Ordering;

use crate::Error;
use crate::RequestRef;
use bun_picohttp as picohttp;

pub struct Stream {
    // HTTP/2 stream IDs are 31-bit; the top bit must stay clear.
    pub(crate) id: u32,
    /// Snapshot of `client.async_http_id` at attach time. Stored so the
    /// session's `by_http_id` index can be maintained after `client` has been
    /// cleared (terminal delivery nulls `client` before `remove_stream`).
    /// `None` for clients without an abort-signal store (not indexed).
    pub(crate) async_http_id: Option<u32>,
    /// Cleared before terminal callbacks.
    pub(crate) client: Cell<Option<RequestRef>>,

    /// HEADERS + CONTINUATION fragments, decoded once END_HEADERS arrives.
    pub(crate) header_block: RefCell<Vec<u8>>,
    /// DATA payload accumulated across one onData() pass.
    pub(crate) body_buffer: RefCell<Vec<u8>>,

    /// HPACK is decoded eagerly at parse time so the dynamic table stays
    /// consistent across multiple HEADERS in one read; the resulting strings
    /// land here until `deliverStream` hands them to handleResponseMetadata.
    pub(crate) decoded_bytes: RefCell<Vec<u8>>,
    /// Each header points into `decoded_bytes`, which is not touched again
    /// once these are built.
    pub(crate) decoded_headers: RefCell<Vec<picohttp::Header>>,
    /// Final (non-1xx) status code; 0 until the response HEADERS arrive.
    pub(crate) status_code: Cell<u32>,

    pub(crate) state: Cell<State>,
    /// `.closed` was reached via RST_STREAM (sent or received). Kept distinct
    /// from `state` so `rst()` stays idempotent (never answers an inbound RST,
    /// per §5.4.2) and so RST(NO_ERROR) can be told apart from a clean close.
    pub(crate) rst_done: Cell<bool>,
    /// Set once a non-1xx HEADERS block has been decoded and is awaiting
    /// delivery. Subsequent HEADERS are trailers and decoded-then-dropped.
    pub(crate) headers_ready: Cell<bool>,
    pub(crate) headers_end_stream: Cell<bool>,
    /// Expect: 100-continue is in effect: hold the request body until a 1xx
    /// or final status arrives.
    pub(crate) awaiting_continue: Cell<bool>,
    pub(crate) fatal_error: Cell<Option<Error>>,
    /// DATA bytes consumed since the last WINDOW_UPDATE for this stream.
    pub(crate) unacked_bytes: Cell<u32>,
    /// Σ DATA payload bytes (post-padding) for §8.1.1 Content-Length check —
    /// `total_body_received` is clamped at content_length so it can't catch
    /// overshoot.
    pub(crate) data_bytes_received: Cell<u64>,
    /// Per-stream send window (server's INITIAL_WINDOW_SIZE plus any
    /// WINDOW_UPDATEs minus DATA bytes already framed).
    pub(crate) send_window: Cell<i32>,
    /// Unsent suffix of a `.bytes` request body, parked while the send
    /// window is exhausted. Points into `client.state.request_body`'s
    /// backing, which the request keeps alive while the stream is attached.
    pub(crate) pending_body: Cell<bun_ptr::RawSlice<u8>>,
}

/// RFC 9113 §5.1. A `Stream` is created by sending HEADERS, so it starts
/// `.open`; `idle`/`reserved` are never represented as objects. END_STREAM
/// half-closes one side; both, or any RST_STREAM, transitions to `.closed`.
#[repr(u8)]
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
        let _ = super::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}

impl Stream {
    pub(crate) fn new(
        id: u32,
        async_http_id: Option<u32>,
        client: Option<RequestRef>,
        send_window: i32,
    ) -> Self {
        let _ = super::LIVE_STREAMS.fetch_add(1, Ordering::Relaxed);
        Self {
            id,
            async_http_id,
            client: Cell::new(client),
            header_block: RefCell::new(Vec::new()),
            body_buffer: RefCell::new(Vec::new()),
            decoded_bytes: RefCell::new(Vec::new()),
            decoded_headers: RefCell::new(Vec::new()),
            status_code: Cell::new(0),
            state: Cell::new(State::Open),
            rst_done: Cell::new(false),
            headers_ready: Cell::new(false),
            headers_end_stream: Cell::new(false),
            awaiting_continue: Cell::new(false),
            fatal_error: Cell::new(None),
            unacked_bytes: Cell::new(0),
            data_bytes_received: Cell::new(0),
            send_window: Cell::new(send_window),
            pending_body: Cell::new(bun_ptr::RawSlice::EMPTY),
        }
    }

    #[inline]
    pub(crate) fn set_fatal_error(&self, err: Error) {
        self.fatal_error.set(Some(err));
    }

    pub(crate) fn sent_end_stream(&self) {
        self.state.set(match self.state.get() {
            State::Open => State::HalfClosedLocal,
            State::HalfClosedRemote => State::Closed,
            other => other,
        });
    }

    pub(crate) fn recv_end_stream(&self) {
        self.state.set(match self.state.get() {
            State::Open => State::HalfClosedRemote,
            State::HalfClosedLocal => State::Closed,
            other => other,
        });
    }

    /// We have sent END_STREAM (or RST): no more request DATA may be queued.
    #[inline]
    pub(crate) fn local_closed(&self) -> bool {
        let state = self.state.get();
        state == State::HalfClosedLocal || state == State::Closed
    }

    /// Peer has sent END_STREAM (or RST): the response body is complete and
    /// further inbound DATA is a protocol error.
    #[inline]
    pub(crate) fn remote_closed(&self) -> bool {
        let state = self.state.get();
        state == State::HalfClosedRemote || state == State::Closed
    }
}
