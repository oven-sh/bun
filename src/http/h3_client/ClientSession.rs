//! One QUIC connection to an origin. Multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::strings;
use bun_ptr::{AliasableBox, RefPtr};
use bun_quic::http3_code;
use bun_uws::quic;

use super::client_context::ClientContext;
use super::encode;
use super::stream::Stream;
use crate::h3_client as H3;
use crate::http_thread::WriteMessageType;
use crate::internal_state::{HTTPStage, TransportEnd};
use crate::signals::Field as Signal;
use crate::{HeaderResult, InFlightRequest, Protocol};

use crate::h3_client::h3_client;

/// For how long a connection is kept without a request, whatever the server does to keep it alive.
const MAX_IDLE_SECONDS: u32 = 5 * 60;
/// The same for one on which the server allows no more streams.
const MAX_SPENT_SECONDS: u32 = 8;

#[derive(bun_ptr::CellRefCounted)]
pub struct ClientSession {
    /// Held by the `ClientContext.sessions` registry, and by `PendingConnect` while DNS is in flight.
    ref_count: Cell<u32>,
    /// `None` while DNS is in flight, and once it is closed.
    pub(crate) connection: Option<quic::Connection>,
    pub(crate) hostname: Vec<u8>,
    pub(crate) port: u16,
    pub(crate) reject_unauthorized: bool,
    /// The fetch session whose requests may share this connection.
    pub(crate) pool_id: u64,
    pub(crate) handshake_done: bool,
    pub(crate) closed: bool,
    pub(crate) registry_index: u32,
    idle_seconds: u32,
    /// Since the last sweep, with any of the requests. The others may be waiting for their turn.
    pub(crate) made_progress: bool,

    /// The requests that are in flight or wait for a stream, oldest first.
    pub(crate) pending: Vec<AliasableBox<Stream>>,
}

/// How far the response has got.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Progress {
    Partial,
    Complete,
    Aborted,
}

impl ClientSession {
    pub(crate) fn new(
        hostname: Vec<u8>,
        port: u16,
        reject_unauthorized: bool,
        pool_id: u64,
    ) -> RefPtr<ClientSession> {
        H3::live_sessions.fetch_add(1, Ordering::Relaxed);
        RefPtr::new(ClientSession {
            ref_count: Cell::new(1),
            connection: None,
            hostname,
            port,
            reject_unauthorized,
            pool_id,
            handshake_done: false,
            closed: false,
            registry_index: u32::MAX,
            idle_seconds: 0,
            made_progress: false,
            pending: Vec::new(),
        })
    }

    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        reject_unauthorized: bool,
        pool_id: u64,
    ) -> bool {
        !self.closed
            && self.port == port
            && self.pool_id == pool_id
            && self.reject_unauthorized == reject_unauthorized
            && strings::eql_long(&self.hostname, hostname)
    }

    pub(crate) fn origin(&self) -> quic::client::Origin<'_> {
        quic::client::Origin {
            hostname: &self.hostname,
            port: self.port,
            reject_unauthorized: self.reject_unauthorized,
        }
    }

    /// `Event::Closed` comes in a later turn, so the registry is not touched from here.
    pub(crate) fn close_if_idle(&mut self) {
        if let Some(connection) = self.connection.filter(|_| self.pending.is_empty()) {
            // No later request may pick a connection that is going away.
            self.closed = true;
            connection.close();
        }
    }

    pub(crate) fn has_headroom(&self) -> bool {
        match self.connection {
            _ if self.closed => false,
            Some(connection) if self.handshake_done => {
                let newest_first = self.pending.iter().rev();
                let unopened = newest_first.take_while(|it| it.qstream.is_none());
                connection.available_streams() > unopened.count() as u64
            }
            // The limit of the server is not known yet.
            _ => self.pending.len() < 64,
        }
    }

    pub(crate) fn enqueue(&mut self, mut client: InFlightRequest) {
        debug_assert!(!self.closed);
        client.flags.protocol = Protocol::Http3;
        client.allow_retry = false;

        let stream = AliasableBox::new(Stream::new(self, client));
        let _ = H3::live_streams.fetch_add(1, Ordering::Relaxed);
        self.pending.push(stream);
        self.idle_seconds = 0;

        if self.handshake_done {
            self.open_streams();
        }
    }

    pub(crate) fn first_unopened(&self) -> Option<*mut Stream> {
        (self.pending.iter().map(AliasableBox::as_ptr)).find(|&it| stream_ref(it).qstream.is_none())
    }

    /// The requests are written when their streams are reported as writable.
    pub(crate) fn open_streams(&mut self) {
        while let Some(stream) = self.first_unopened()
            && let Some(client) = &stream_ref(stream).client
            && let can_be_repeated =
                (client.method.is_idempotent() && !client.state.original_request_body.is_stream())
            && let Some(connection) = self.connection
            && let Some(qstream) = connection.open(stream.cast(), can_be_repeated)
        {
            stream_mut(stream).qstream = Some(qstream);
            qstream.want_write();
        }
    }

    pub(crate) fn stream_body_by_http_id(
        &mut self,
        async_http_id: u32,
        message: WriteMessageType,
    ) -> bool {
        for stream_ptr in self.pending.iter().map(AliasableBox::as_ptr) {
            let stream = stream_mut(stream_ptr);
            let Some(client) = &mut stream.client else {
                continue;
            };
            if client.async_http_id != async_http_id {
                continue;
            }
            if let crate::HTTPRequestBody::Stream(s) = &mut client.state.original_request_body {
                if message == WriteMessageType::LengthMismatch {
                    self.fail(stream_ptr, crate::Error::RequestBodyLengthMismatch);
                    return true;
                }
                s.ended = message == WriteMessageType::End;
                if let Some(qs) = stream.qstream.filter(|_| stream.headers_sent) {
                    encode::drain_send_body(stream, qs);
                }
            }
            return true;
        }
        false
    }

    pub(crate) fn resume_receive_by_http_id(&mut self, async_http_id: u32) -> bool {
        for stream_ptr in self.pending.iter().map(AliasableBox::as_ptr) {
            let stream = stream_mut(stream_ptr);
            let Some(client) = &mut stream.client else {
                continue;
            };
            if client.async_http_id != async_http_id {
                continue;
            }
            match client.pump_held_body() {
                Ok(true) => client.send_partial_result(),
                Ok(false) => {}
                Err(err) => {
                    self.fail(stream_ptr, err);
                    return true;
                }
            }
            if !client.holds_off_receiving() && core::mem::take(&mut stream.read_paused) {
                if let Some(qs) = stream.qstream {
                    qs.set_paused(false);
                }
            }
            return true;
        }
        false
    }

    /// Unlink and free `stream`, whose `client` the caller has taken.
    pub(super) fn detach(&mut self, stream: *mut Stream) {
        let st = stream_mut(stream);
        debug_assert!(core::ptr::eq(st.session.as_ptr(), self));
        if let Some(qs) = st.qstream.take() {
            qs.set_context(core::ptr::null_mut());
            // The server can respond before it has got the whole request.
            qs.reset_unfinished(http3_code::REQUEST_CANCELLED);
        }
        if let Some(i) = self.pending.iter().position(|s| s.as_ptr() == stream) {
            self.pending.remove(i);
        }
        if self.closed {
            self.close_if_idle();
        }
    }

    /// For when the rest of the response is of no interest.
    fn cancel(&mut self, stream: *mut Stream) {
        if let Some(qs) = stream_ref(stream).qstream {
            // A server that has responded may be about to read what is left of the request.
            if stream_ref(stream).status_code == 0 {
                qs.reset_unless_delivered(http3_code::REQUEST_CANCELLED);
            }
            qs.stop(http3_code::REQUEST_CANCELLED);
        }
        self.detach(stream);
    }

    pub(crate) fn fail(&mut self, stream: *mut Stream, err: crate::Error) {
        let client = stream_mut(stream).client.take();
        self.cancel(stream);
        if let Some(client) = client {
            client.fail(err);
        }
    }

    /// A stream closed before any response headers arrived. If the request
    /// hasn't been retried yet and the body wasn't a JS stream (which may
    /// already be consumed), re-enqueue it — this is the standard h2/h3 client
    /// behavior for the GOAWAY / stateless-reset / port-reuse race where a
    /// pooled session goes stale between the `matches()` check and the first
    /// stream open.
    pub(crate) fn retry_or_fail(&mut self, stream: *mut Stream, err: crate::Error) {
        let st = stream_mut(stream);
        let Some(mut client) = st.client.take() else {
            return self.fail(stream, err);
        };
        // RFC 9110 §9.2.2: the origin may have acted on a request that was written.
        let replay_safe = !st.headers_sent || st.peer_rejected || client.method.is_idempotent();
        if client.flags.h3_retried || st.is_streaming_body || st.headers_delivered || !replay_safe {
            self.cancel(stream);
            return client.fail(err);
        }
        let Some(ctx) = ClientContext::get() else {
            self.cancel(stream);
            return client.fail(err);
        };
        client.flags.h3_retried = true;
        // The end of one stream leaves the connection usable, and connect() may
        // pick it again. It must not if the connection is going, or if the
        // origin rejected the request, which it does when it shuts down.
        if st.peer_rejected || !self.connection.is_some_and(|it| it.is_usable()) {
            self.closed = true;
        }
        let port = self.port;
        bun_core::scoped_log!(
            h3_client,
            "retry {}:{} after {}",
            bstr::BStr::new(&self.hostname),
            port,
            bstr::BStr::new(err.name()),
        );
        self.cancel(stream);
        if let Err(client) = ClientContext::as_mut(ctx).connect(client, port) {
            client.fail(err);
        }
    }

    pub(crate) fn sweep(&mut self, elapsed_seconds: u32) {
        if self.pending.is_empty() {
            self.idle_seconds = self.idle_seconds.saturating_add(elapsed_seconds);
            let max_seconds = match self.has_headroom() {
                true => MAX_IDLE_SECONDS,
                false => MAX_SPENT_SECONDS,
            };
            if self.idle_seconds >= max_seconds {
                self.close_if_idle();
            }
        }
        if let Some(connection) = self.connection {
            // Their end is long in coming.
            connection.stop_streams_without_context(http3_code::REQUEST_CANCELLED);
        }
        let made_progress = core::mem::take(&mut self.made_progress);
        let streams: Vec<_> = self.pending.iter().map(AliasableBox::as_ptr).collect();
        for stream in streams {
            let st = stream_mut(stream);
            if made_progress {
                st.idle_seconds = 0;
            }
            let Some(client) = st.client.as_ref().filter(|_| !st.read_paused) else {
                continue;
            };
            st.idle_seconds = st.idle_seconds.saturating_add(elapsed_seconds);
            if (1..=st.idle_seconds).contains(&client.effective_idle_timeout_seconds()) {
                self.fail(stream, crate::Error::Timeout);
            }
        }
    }

    pub(crate) fn abort_by_http_id(&mut self, async_http_id: u32) -> bool {
        // `fail` mutates `pending`, so it cannot be called while the iterator
        // holds `&self.pending`, and only one entry can match — so locate
        // first via raw-ptr reads, then act.
        let mut found: *mut Stream = core::ptr::null_mut();
        for stream_ptr in self.pending.iter().map(AliasableBox::as_ptr) {
            if let Some(client) = &stream_ref(stream_ptr).client
                && client.async_http_id == async_http_id
            {
                found = stream_ptr;
                break;
            }
        }
        if !found.is_null() {
            self.fail(found, crate::Error::Aborted);
            return true;
        }
        false
    }

    /// Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
    /// machine sees the same call sequence regardless of transport.
    pub(crate) fn deliver(&mut self, stream: *mut Stream, progress: Progress) {
        let st = stream_mut(stream);
        let done = progress != Progress::Partial;
        let Some(mut client) = st.client.take() else {
            if done {
                self.detach(stream);
            }
            return;
        };

        if client.signals.get(Signal::Aborted) {
            self.cancel(stream);
            return client.fail(crate::Error::Aborted);
        }

        if st.status_code != 0 && !st.headers_delivered {
            st.headers_delivered = true;
            let (result, response) = match client
                .apply_multiplexed_headers(u32::from(st.status_code), &mut st.decoded_headers)
            {
                Ok(r) => r,
                Err(e) => {
                    self.cancel(stream);
                    return client.fail(e);
                }
            };
            // `is_done()`: Content-Length: 0 can arrive as `HasBody` (e.g. an SSE content-type).
            if result == HeaderResult::Finished || client.state.is_done() {
                if client.state.flags.is_redirect_pending {
                    self.detach(stream);
                    return client.do_redirect_multiplexed();
                }
                client.store_metadata(response);
                client.state.flags.received_last_chunk = true;
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                self.detach(stream);
                return finish(client);
            }
            client.store_metadata(response);
            if client.signals.get(Signal::HeaderProgress) {
                client.send_partial_result();
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            st.client = Some(client);
            if done {
                // Stream closed before headers — handshake/reset failure.
                return self.retry_or_fail(
                    stream,
                    if st.status_code == 0 {
                        crate::Error::HTTP3StreamReset
                    } else {
                        crate::Error::ConnectionClosed
                    },
                );
            }
            return;
        }

        if progress == Progress::Aborted {
            self.cancel(stream);
            let err = match client.state.content_length {
                Some(_) => crate::Error::HTTP3ContentLengthMismatch,
                None => crate::Error::ConnectionClosed,
            };
            return client.fail(err);
        }

        if !st.body_buffer.is_empty() {
            if done {
                client.state.end_body(TransportEnd::Clean);
            }
            let report = match client.handle_response_body(st.body_buffer.as_slice(), false) {
                Ok(r) => r,
                Err(e) => {
                    st.body_buffer.clear();
                    self.cancel(stream);
                    return client.fail(e);
                }
            };
            st.body_buffer.clear();
            if done {
                self.detach(stream);
                return finish(client);
            }
            if client.state.is_done() {
                self.detach(stream);
                return client.finish();
            }
            if report {
                client.send_partial_result();
            }
            if client.holds_off_receiving()
                && let Some(qs) = st.qstream
            {
                st.read_paused = true;
                qs.set_paused(true);
            }
            st.client = Some(client);
            return;
        }

        if done {
            self.detach(stream);
            if let Err(err) = client.finalize_body_on_eof(TransportEnd::Clean) {
                return client.fail(err);
            }
            return finish(client);
        }

        st.client = Some(client);
    }
}

/// Upgrade a `*mut Stream` (a `self.pending` entry) to `&mut Stream`. Entries live
/// until `detach()` reclaims them; HTTP-thread only, so the `&mut` is the sole
/// live borrow.
#[inline]
pub(super) fn stream_mut<'a>(p: *mut Stream) -> &'a mut Stream {
    // SAFETY: see fn doc.
    unsafe { &mut *p }
}

/// Shared-borrow a `*mut Stream` (a live `session.pending` entry) to read
/// `Copy` fields without forming `&mut Stream`. Same liveness invariant as
/// [`stream_mut`]; used where the caller holds an iterator over `pending` and
/// only needs a read.
///
/// Returns a [`bun_ptr::ParentRef`] (the session owns the stream ⇒ it
/// outlives the handle) so the shared deref goes through the safe `Deref`
/// impl instead of an open-coded raw-ptr reborrow.
#[inline]
pub(super) fn stream_ref(p: *mut Stream) -> bun_ptr::ParentRef<Stream> {
    bun_ptr::ParentRef::from(NonNull::new(p).expect("pending entry is non-null"))
}

/// Upgrade a `*mut ClientSession` (a `ClientContext.sessions` registry entry,
/// or a freshly `ClientSession::new`-allocated handle) to `&mut ClientSession`.
///
/// INVARIANT: the registry only holds live intrusive-refcounted sessions
/// (removed via `ClientContext::unregister` before destroy); a fresh `new()`
/// result is the sole reference to its allocation. Either way the session is a
/// `heap::into_raw`-boxed allocation disjoint from `ClientContext`, and all
/// access is HTTP-thread-only, so the returned `&mut` is the sole live borrow
/// for its scope. Mirrors [`stream_mut`] — centralises the
/// `unsafe { &mut *p }` backref upgrade repeated across `ClientContext` /
/// `PendingConnect`.
#[inline]
pub(super) fn session_mut<'a>(p: *mut ClientSession) -> &'a mut ClientSession {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *p }
}

fn finish(client: InFlightRequest) {
    if let Some(cl) = client.state.content_length {
        if client.state.total_body_received != cl {
            return client.fail(crate::Error::HTTP3ContentLengthMismatch);
        }
    }
    client.finish();
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        H3::live_sessions.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(self.pending.is_empty());
    }
}
