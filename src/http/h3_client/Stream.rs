//! One in-flight HTTP/3 request. Created when the request is enqueued on a
//! `ClientSession`; the lsquic stream is bound later from
//! `callbacks.onStreamOpen` (lsquic creates streams asynchronously once
//! MAX_STREAMS credit is available). Owned by the session's `pending` list
//! until `ClientSession.detach`.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_uws::quic;

use super::ClientSession;
use crate::h3_client as h3;
use crate::{Headers, InFlightRequest};

pub struct Stream {
    // BACKREF: owned by `session.pending`; session outlives every Stream it holds.
    pub(crate) session: bun_ptr::BackRef<ClientSession, bun_ptr::Mut>,
    pub(crate) client: Option<InFlightRequest>,
    // FFI handle into lsquic; bound in `callbacks.onStreamOpen`, reset in `ClientSession::detach`.
    pub(crate) qstream: Option<NonNull<quic::Stream>>,

    pub(crate) decoded_headers: Headers,
    pub(crate) body_buffer: Vec<u8>,
    pub(crate) status_code: u16,

    // BACKREF: borrows the request body owned by `client`; not freed here.
    // `RawSlice` carries the outlives-holder invariant.
    pub(crate) pending_body: bun_ptr::RawSlice<u8>,
    pub(crate) headers_sent: bool,
    pub(crate) request_body_done: bool,
    pub(crate) is_streaming_body: bool,
    pub(crate) headers_delivered: bool,
    pub(crate) read_paused: bool,
    /// The origin did not process the request. It ended the stream with
    /// H3_REQUEST_REJECTED, or the stream is above the id in its GOAWAY.
    pub(crate) peer_rejected: bool,
}

impl Stream {
    pub(crate) fn new(session: &mut ClientSession, client: InFlightRequest) -> Stream {
        Stream {
            session: bun_ptr::BackRef::new_mut(session),
            client: Some(client),
            qstream: None,
            decoded_headers: Headers::default(),
            body_buffer: Vec::new(),
            status_code: 0,
            pending_body: bun_ptr::RawSlice::EMPTY,
            headers_sent: false,
            request_body_done: false,
            is_streaming_body: false,
            headers_delivered: false,
            read_paused: false,
            peer_rejected: false,
        }
    }

    /// Mutable access to the bound lsquic stream handle.
    ///
    /// INVARIANT: `qstream` is set in `callbacks::on_stream_open` and remains
    /// valid until `callbacks::on_stream_close` / `ClientSession::detach`
    /// nulls it. The `quic::Stream` is an FFI-owned allocation distinct from
    /// `self`, so the returned `&mut` does not alias `self`. HTTP-thread-only.
    #[inline]
    pub(crate) fn qstream_mut<'s>(&self) -> Option<&'s mut quic::Stream> {
        // Route through the shared `client_session::quic_stream_mut` accessor;
        // see INVARIANT above.
        self.qstream
            .map(|qs| super::client_session::quic_stream_mut(qs.as_ptr()))
    }

    /// Mutable access to the owning `ClientSession`.
    ///
    /// INVARIANT: `session` is a set-once `BackRef` recorded in
    /// `Stream::new`; the session owns this `Stream` (in `pending`) and
    /// strictly outlives it. The session is a distinct heap allocation from
    /// `self`, so the returned `&mut` does not alias any borrow of `self`.
    /// HTTP-thread-only — sole live `&mut ClientSession`. Centralises the
    /// `BackRef::get_mut` upgrade repeated in every lsquic callback.
    #[inline]
    pub(crate) fn session_mut<'s>(&self) -> &'s mut ClientSession {
        // Route through the shared `client_session::session_mut` accessor
        // (one centralised unsafe); see INVARIANT above.
        super::client_session::session_mut(self.session.as_ptr())
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        h3::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}
