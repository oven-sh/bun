//! One in-flight request on a multiplexed HTTP/2 `ClientSession`. Owned by the
//! session's `streams` map.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::time::Instant;

use crate::{Error, Headers};
use bun_http_types::h2::flow_control::{RecvWindow, SendWindow};
use bun_http_types::h2::stream::{Event, State, transition};

// `live_streams` lives in the parent module of `h2_client/`.
use crate::InFlightRequest;

pub struct Stream {
    // HTTP/2 stream IDs are 31-bit; the top bit must stay clear.
    pub(crate) id: u32,
    // BACKREF: the session owns the stream through its `streams` map.
    pub(crate) session: NonNull<super::ClientSession>,
    pub(crate) client: Option<InFlightRequest>,
    pub(crate) opened_at: Instant,

    /// DATA payload accumulated across one onData() pass.
    pub(crate) body_buffer: Vec<u8>,

    /// HPACK is decoded eagerly at parse time so the dynamic table stays
    /// consistent across multiple HEADERS in one read; the resulting strings
    /// land here until `deliverStream` hands them to handleResponseMetadata.
    pub(crate) decoded_headers: Headers,
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
    pub(crate) send_window: SendWindow,
    /// Unsent suffix of a `.bytes` request body, parked while the send
    /// window is exhausted. Borrows from `client.state.request_body`.
    // BACKREF: only `write_body` reads it, and it borrows that client.
    pub(crate) pending_body: bun_ptr::RawSlice<u8>,
}

impl Drop for Stream {
    fn drop(&mut self) {
        let _ = super::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}

impl Stream {
    pub(crate) fn new(
        id: u32,
        session: NonNull<super::ClientSession>,
        send_window: SendWindow,
    ) -> Self {
        Self {
            id,
            session,
            client: None,
            opened_at: Instant::now(),
            body_buffer: Vec::new(),
            decoded_headers: Headers::default(),
            status_code: 0,
            state: State::Open,
            rst_done: false,
            headers_ready: false,
            headers_end_stream: false,
            awaiting_continue: false,
            fatal_error: None,
            http1_required: false,
            recv_window: RecvWindow::new(super::LOCAL_INITIAL_WINDOW_SIZE),
            send_window,
            pending_body: bun_ptr::RawSlice::EMPTY,
        }
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
