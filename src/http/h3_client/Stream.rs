//! One in-flight HTTP/3 request. Created when the request is enqueued on a
//! `ClientSession`; the lsquic stream is bound later from
//! `callbacks.onStreamOpen` (lsquic creates streams asynchronously once
//! MAX_STREAMS credit is available). Owned by the session's `pending` list
//! until `ClientSession.detach`.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_picohttp as picohttp;
use bun_uws::quic;

use super::ClientSession;
// TODO(port): `bun.http` is the crate-root struct; confirm exact type name in Phase B.
use crate::HttpClient;
// TODO(port): H3Client.zig sits at src/http/H3Client.zig alongside the h3_client/ dir;
// confirm the module path for `live_streams` once the crate layout is wired.
use crate::h3_client as h3;

pub struct Stream {
    // BACKREF: owned by `session.pending`; session outlives every Stream it holds.
    pub session: bun_ptr::BackRef<ClientSession>,
    // BACKREF: lifetime-erased — cleared on detach; never reads borrowed fields.
    pub client: Option<NonNull<HttpClient<'static>>>,
    // FFI handle into lsquic; bound from `callbacks.onStreamOpen`, closed via `abort`.
    pub qstream: Option<NonNull<quic::Stream>>,

    /// Slices into the lsquic-owned hset buffer; valid only for the duration
    /// of the `onStreamHeaders` callback that populated it. `cloneMetadata`
    /// deep-copies synchronously inside that callback, so nothing reads these
    /// after they go stale.
    pub decoded_headers: Vec<picohttp::Header>,
    pub body_buffer: Vec<u8>,
    pub status_code: u16,

    // BACKREF: borrows the request body owned by `client`; not freed here.
    // `RawSlice` carries the outlives-holder invariant.
    pub pending_body: bun_ptr::RawSlice<u8>,
    pub request_body_done: bool,
    pub is_streaming_body: bool,
    pub headers_delivered: bool,
}

impl Stream {
    /// Zig: `pub const new = bun.TrivialNew(@This());`
    /// Heap-allocates a `Stream` and returns the raw pointer; ownership is held
    /// by `ClientSession.pending` until `ClientSession::detach` reclaims it via
    /// `heap::take`.
    pub fn new(session: &mut ClientSession, client: &mut HttpClient<'_>) -> *mut Stream {
        bun_core::heap::into_raw(Box::new(Stream {
            session: bun_ptr::BackRef::new_mut(session),
            client: Some(client.as_erased_ptr()),
            qstream: None,
            decoded_headers: Vec::new(),
            body_buffer: Vec::new(),
            status_code: 0,
            pending_body: bun_ptr::RawSlice::EMPTY,
            request_body_done: false,
            is_streaming_body: false,
            headers_delivered: false,
        }))
    }

    /// Mutable access to the bound lsquic stream handle.
    ///
    /// INVARIANT: `qstream` is set in `callbacks::on_stream_open` and remains
    /// valid until `callbacks::on_stream_close` / `ClientSession::detach`
    /// nulls it. The `quic::Stream` is an FFI-owned allocation distinct from
    /// `self`, so the returned `&mut` does not alias `self`. HTTP-thread-only.
    #[inline]
    pub fn qstream_mut<'s>(&self) -> Option<&'s mut quic::Stream> {
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
    pub fn session_mut<'s>(&self) -> &'s mut ClientSession {
        // Route through the shared `client_session::session_mut` accessor
        // (one centralised unsafe); see INVARIANT above.
        super::client_session::session_mut(self.session.as_ptr())
    }

    pub fn abort(&mut self) {
        if let Some(qs) = self.qstream_mut() {
            qs.close();
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        // `decoded_headers` / `body_buffer` are Vec — freed automatically.
        // Zig `.monotonic` == LLVM monotonic == Rust `Relaxed`.
        h3::LIVE_STREAMS.fetch_sub(1, Ordering::Relaxed);
        // Zig: `bun.destroy(this)` — the Box deallocation happens at the drop site.
    }
}

// ported from: src/http/h3_client/Stream.zig
