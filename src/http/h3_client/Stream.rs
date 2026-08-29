//! One in-flight HTTP/3 request. Created when the request is enqueued on a
//! `ClientSession`; the lsquic stream is bound later from
//! `callbacks.onStreamOpen` (lsquic creates streams asynchronously once
//! MAX_STREAMS credit is available). Owned by the session's `pending` list
//! until `ClientSession.detach`.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_picohttp as picohttp;
use bun_ptr::{BackRef, RefPtr};
use bun_uws::quic;

use super::ClientSession;
use crate::RequestRef;
use crate::h3_client as h3;

pub struct Stream {
    /// Owned by `session.pending`; the session outlives every Stream it holds.
    pub(crate) session: BackRef<ClientSession>,
    /// The reference this entry holds on the session (see
    /// `ClientSession::enqueue`), released by `detach`.
    pub(crate) session_ref: Cell<Option<RefPtr<ClientSession>>>,
    /// Cleared on detach.
    pub(crate) client: Cell<Option<RequestRef>>,
    /// FFI handle into lsquic; bound from `callbacks.onStreamOpen`, cleared on
    /// `on_stream_close` / detach.
    pub(crate) qstream: Cell<Option<NonNull<quic::Stream>>>,

    /// Slices into the lsquic-owned hset buffer; valid only for the duration
    /// of the `onStreamHeaders` callback that populated it. `cloneMetadata`
    /// deep-copies synchronously inside that callback, so nothing reads these
    /// after they go stale.
    pub(crate) decoded_headers: RefCell<Vec<picohttp::Header>>,
    pub(crate) body_buffer: RefCell<Vec<u8>>,
    pub(crate) status_code: Cell<u16>,

    /// The unsent suffix of the request body owned by `client`.
    pub(crate) pending_body: Cell<bun_ptr::RawSlice<u8>>,
    pub(crate) headers_sent: Cell<bool>,
    pub(crate) request_body_done: Cell<bool>,
    pub(crate) is_streaming_body: Cell<bool>,
    pub(crate) headers_delivered: Cell<bool>,
    pub(crate) read_paused: Cell<bool>,
}

impl Stream {
    pub(crate) fn new(
        session: &ClientSession,
        session_ref: RefPtr<ClientSession>,
        client: RequestRef,
    ) -> Self {
        let _ = h3::LIVE_STREAMS.fetch_add(1, Ordering::Relaxed);
        Stream {
            session: BackRef::new(session),
            session_ref: Cell::new(Some(session_ref)),
            client: Cell::new(Some(client)),
            qstream: Cell::new(None),
            decoded_headers: RefCell::new(Vec::new()),
            body_buffer: RefCell::new(Vec::new()),
            status_code: Cell::new(0),
            pending_body: Cell::new(bun_ptr::RawSlice::EMPTY),
            headers_sent: Cell::new(false),
            request_body_done: Cell::new(false),
            is_streaming_body: Cell::new(false),
            headers_delivered: Cell::new(false),
            read_paused: Cell::new(false),
        }
    }

    /// The bound lsquic stream (an opaque handle lsquic keeps live until
    /// `on_stream_close`, which clears this).
    #[inline]
    pub(crate) fn qstream<'s>(&self) -> Option<&'s mut quic::Stream> {
        self.qstream
            .get()
            .map(|qs| quic::Stream::opaque_mut(qs.as_ptr()))
    }

    pub(crate) fn abort(&self) {
        if let Some(qs) = self.qstream() {
            qs.close();
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        h3::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}
