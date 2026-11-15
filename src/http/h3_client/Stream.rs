//! One in-flight HTTP/3 request. Created when the request is enqueued on a
//! `ClientSession`; the lsquic stream is bound later from
//! `ClientSession::bind_stream` (lsquic creates streams once
//! MAX_STREAMS credit is available). Owned by the session's `pending` list
//! until then, and by `streams` until `ClientSession.detach`.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_picohttp as picohttp;
use bun_uws::quic;

use crate::InFlightRequest;
use crate::h3_client as h3;

pub struct Stream {
    pub(crate) client: Option<InFlightRequest>,
    /// Its ext slot holds the [`StreamSlot`] of `self`.
    qstream: Option<NonNull<quic::Stream>>,

    /// Slices into the lsquic-owned hset buffer; valid only for the duration
    /// of the `onStreamHeaders` callback that populated it. `cloneMetadata`
    /// deep-copies synchronously inside that callback, so nothing reads these
    /// after they go stale.
    pub(crate) decoded_headers: Vec<picohttp::Header>,
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
    pub(crate) fn new(client: InFlightRequest) -> Stream {
        Stream {
            client: Some(client),
            qstream: None,
            decoded_headers: Vec::new(),
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

    pub(super) fn is_for(&self, async_http_id: u32) -> bool {
        (self.client.as_ref()).is_some_and(|client| client.async_http_id == async_http_id)
    }

    /// `slot` is where the caller keeps `self`.
    pub(super) fn bind(&mut self, qs: &mut quic::Stream, slot: StreamSlot) {
        slot.store_in(qs);
        self.qstream = Some(NonNull::from(qs));
    }

    pub(super) fn unbind(&mut self, reset: bool) {
        if let Some(qs) = self.qstream_mut() {
            qs.ext().set(0);
            if reset {
                qs.reset();
            }
        }
        self.qstream = None;
    }

    /// Mutable access to the bound lsquic stream handle.
    #[inline]
    pub(super) fn qstream_mut(&mut self) -> Option<&mut quic::Stream> {
        // SAFETY: lsquic frees a stream after `on_stream_close`, which finds `self` through the
        // ext slot and unbinds it. The handle is zero-sized.
        self.qstream.as_mut().map(|qs| unsafe { qs.as_mut() })
    }

    /// For a caller that goes on to use the other fields of `self`.
    pub(super) fn with_qstream(&mut self, f: impl FnOnce(&mut Stream, &mut quic::Stream)) {
        if let Some(mut qs) = self.qstream {
            // SAFETY: as in `qstream_mut`; only an engine tick calls `on_stream_close`.
            f(self, unsafe { qs.as_mut() });
        }
    }
}

/// An entry of `ClientSession::streams`.
#[derive(Clone, Copy)]
pub(super) struct StreamSlot {
    /// `ClientSession::registry_index`.
    pub(super) session_index: u32,
    pub(super) index: usize,
}

impl StreamSlot {
    pub(super) fn store_in(self, qs: &quic::Stream) {
        qs.ext()
            .set((u64::from(self.session_index) + 1) << u32::BITS | self.index as u64);
    }

    pub(super) fn load_from(qs: &quic::Stream) -> Option<Self> {
        let ext = qs.ext().get();
        Some(Self {
            session_index: ((ext >> u32::BITS) as u32).checked_sub(1)?,
            index: ext as u32 as usize,
        })
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        h3::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}
