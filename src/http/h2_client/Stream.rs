//! One in-flight request on a multiplexed HTTP/2 `ClientSession`. Owned by the
//! session's `streams` map; `client` is a weak back-pointer to the `HTTPClient`
//! that the request belongs to (cleared before any terminal callback so the
//! deliver loop never dereferences a freed client).

use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::time::Instant;

use crate::Error;
use bun_http_types::h2::flow_control::{RecvWindow, SendWindow};
use bun_http_types::h2::stream::{Event, State, transition};
use bun_picohttp as picohttp;

// `live_streams` lives in the parent module of `h2_client/`.
use crate::HTTPClient;

// See `Stream::new` below, which fills the
// field defaults and returns a Box. The Box is owned by `ClientSession.streams`;
// Drop runs when removed from the map.

pub struct Stream {
    // HTTP/2 stream IDs are 31-bit; the top bit must stay clear.
    pub(crate) id: u32,
    // BACKREF: the session owns the stream through its `streams` map.
    pub(crate) session: NonNull<super::ClientSession>,
    // BACKREF: weak back-pointer, cleared before terminal callbacks.
    // Lifetime-erased — the stream never reads borrowed fields through this.
    pub(crate) client: Option<NonNull<HTTPClient<'static>>>,
    pub(crate) opened_at: Instant,

    /// DATA payload accumulated across one onData() pass.
    pub(crate) body_buffer: Vec<u8>,

    /// HPACK is decoded eagerly at parse time so the dynamic table stays
    /// consistent across multiple HEADERS in one read; the resulting strings
    /// land here until `deliverStream` hands them to handleResponseMetadata.
    pub(crate) decoded_bytes: Vec<u8>,
    pub(crate) decoded_headers: Vec<picohttp::Header>,
    /// Final (non-1xx) status code; 0 until the response HEADERS arrive.
    pub(crate) status_code: u32,

    /// A `Stream` is created by sending HEADERS, so it starts `Open`.
    pub(crate) state: State,
    /// `.closed` was reached via RST_STREAM (sent or received). Kept distinct
    /// from `state` so `rst()` stays idempotent (never answers an inbound RST,
    /// per §5.4.2) and so RST(NO_ERROR) can be told apart from a clean close.
    pub(crate) rst_done: bool,
    /// Set once a non-1xx HEADERS block has been decoded and is awaiting
    /// delivery. Subsequent HEADERS are trailers and decoded-then-dropped.
    pub(crate) headers_ready: bool,
    pub(crate) headers_end_stream: bool,
    /// Expect: 100-continue is in effect: hold the request body until a 1xx
    /// or final status arrives.
    pub(crate) awaiting_continue: bool,
    pub(crate) fatal_error: Option<Error>,
    /// The server refused the stream with HTTP_1_1_REQUIRED. Separate from `fatal_error` because a later GOAWAY overwrites that.
    pub(crate) http1_required: bool,
    pub(crate) recv_window: RecvWindow,
    /// Σ DATA payload bytes (post-padding) for §8.1.1 Content-Length check —
    /// `total_body_received` is clamped at content_length so it can't catch
    /// overshoot.
    pub(crate) data_bytes_received: u64,
    pub(crate) send_window: SendWindow,
    /// Unsent suffix of a `.bytes` request body, parked while the send
    /// window is exhausted. Borrows from `client.state.request_body`.
    // BACKREF: borrows from `client.state.request_body`; `RawSlice` carries
    // the outlives-holder invariant (client outlives every Stream it owns).
    pub(crate) pending_body: bun_ptr::RawSlice<u8>,
}

impl Stream {
    /// Mutable access to the owning `HTTPClient` while `client` is `Some`.
    ///
    /// INVARIANT: `client` is a weak back-pointer set in `attach` and cleared
    /// (via `take()`) before any terminal callback that could free the
    /// `AsyncHTTP` embedding it; while `Some`, the client is alive and is a
    /// disjoint allocation from both this `Stream` and the `ClientSession`.
    /// HTTP-thread-only.
    #[inline]
    pub(crate) fn client_mut(&mut self) -> Option<&mut HTTPClient<'static>> {
        // Delegates to the shared accessor in `client_session`; see INVARIANT
        // above (identical to `stream_client_mut`'s invariant).
        self.client.map(super::client_session::stream_client_mut)
    }

    /// Shared access to the owning `HTTPClient` while `client` is `Some`.
    /// See [`Self::client_mut`] for the lifetime invariant.
    #[inline]
    pub(crate) fn client_ref(&self) -> Option<&HTTPClient<'static>> {
        // Same INVARIANT as `client_mut`; route through the shared
        // `stream_client_mut` accessor (one centralised unsafe) and reborrow
        // shared.
        self.client
            .map(|c| &*super::client_session::stream_client_mut(c))
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        let _ = super::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
        // body_buffer / decoded_bytes / decoded_headers: Vec<_> drops automatically.
        // Freeing the Box is the caller's drop; nothing to do here.
    }
}

impl Stream {
    pub(crate) fn new(
        id: u32,
        session: NonNull<super::ClientSession>,
        client: Option<NonNull<HTTPClient<'static>>>,
        send_window: SendWindow,
    ) -> Box<Self> {
        Box::new(Self {
            id,
            session,
            client,
            opened_at: Instant::now(),
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
            http1_required: false,
            recv_window: RecvWindow::new(super::LOCAL_INITIAL_WINDOW_SIZE),
            data_bytes_received: 0,
            send_window,
            pending_body: bun_ptr::RawSlice::EMPTY,
        })
    }

    // No `rst()` here: re-entering the session via the `session` backref
    // would autoref a second `&mut ClientSession` while
    // `parse_frames`' `&mut ClientSession` is still live (Stacked-Borrows UB),
    // so RST is routed through `ClientSession::rst_stream` instead — the
    // session `&mut` is already in scope at every call site.

    pub(crate) fn sent_end_stream(&mut self) {
        self.state = transition(self.state, Event::SendEndStream).unwrap_or(self.state);
    }

    pub(crate) fn recv_end_stream(&mut self) {
        self.state = transition(self.state, Event::RecvEndStream).unwrap_or(self.state);
    }

    /// We have sent END_STREAM (or RST): no more request DATA may be queued.
    #[inline]
    pub(crate) fn local_closed(&self) -> bool {
        !self.state.can_send()
    }

    /// Peer has sent END_STREAM (or RST): the response body is complete and
    /// further inbound DATA is a protocol error.
    #[inline]
    pub(crate) fn remote_closed(&self) -> bool {
        !self.state.can_receive()
    }
}
