//! One QUIC connection to an origin. Owns its UDP endpoint via quic.cpp and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`. The `qsocket`
//! pointer becomes dangling after `callbacks.onConnClose`, so every accessor
//! checks `closed` first.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::strings;
use bun_ptr::{AliasableBox, RefPtr};
use bun_uws::quic;

use super::client_context::ClientContext;
use super::encode;
use super::stream::Stream;
use crate::h3_client as H3;
use crate::http_thread::WriteMessageType;
use crate::signals::Field as Signal;
use crate::ssl_config::{SSLConfig, SharedPtr};
use crate::{Carrier, InFlightRequest, Protocol, StreamProgress};

use crate::h3_client::h3_client;

#[derive(bun_ptr::CellRefCounted)]
pub struct ClientSession {
    /// Held by the `ClientContext.sessions` registry, and by `PendingConnect` while DNS is in flight.
    ref_count: Cell<u32>,
    /// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
    // FFI handle that becomes dangling after onConnClose; raw is intentional.
    pub(crate) qsocket: Option<NonNull<quic::Socket>>,
    pub(crate) hostname: Vec<u8>,
    pub(crate) port: u16,
    pub(crate) reject_unauthorized: bool,
    /// The interned TLS options the connection was opened with, `None` for the default context.
    pub(crate) tls_props: Option<SharedPtr>,
    /// The fetch session whose requests may share this connection.
    pub(crate) pool_id: u64,
    pub(crate) handshake_done: bool,
    pub(crate) closed: bool,
    /// `close_if_idle` closed the connection, so its close says nothing about the peer.
    pub(crate) closed_by_us: bool,
    pub(crate) registry_index: u32,

    /// Requests waiting for `onStreamOpen` to hand them a stream. Order is
    /// FIFO; `lsquic_conn_make_stream` was already called once per entry.
    pub(crate) pending: Vec<AliasableBox<Stream>>,
}

impl ClientSession {
    pub(crate) fn new(
        hostname: Vec<u8>,
        port: u16,
        reject_unauthorized: bool,
        tls_props: Option<SharedPtr>,
        pool_id: u64,
    ) -> RefPtr<ClientSession> {
        H3::live_sessions.fetch_add(1, Ordering::Relaxed);
        RefPtr::new(ClientSession {
            ref_count: Cell::new(1),
            qsocket: None,
            hostname,
            port,
            reject_unauthorized,
            tls_props,
            pool_id,
            handshake_done: false,
            closed: false,
            closed_by_us: false,
            registry_index: u32::MAX,
            pending: Vec::new(),
        })
    }

    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        reject_unauthorized: bool,
        tls_props: Option<*const SSLConfig>,
        pool_id: u64,
    ) -> bool {
        !self.closed
            && self.port == port
            && self.pool_id == pool_id
            && self.reject_unauthorized == reject_unauthorized
            && SSLConfig::raw_ptr(self.tls_props.as_ref()) == tls_props
            && strings::eql_long(&self.hostname, hostname)
    }

    /// Mutable access to the live lsquic connection handle.
    ///
    /// INVARIANT: `qsocket` is set by `ClientContext::connect` once
    /// `us_quic_connect_addr` returns and remains valid until
    /// `callbacks::on_conn_close` (which sets `closed = true`). The
    /// `quic::Socket` is an FFI-owned allocation distinct from `self`, so the
    /// returned `&mut` does not alias `self`. HTTP-thread-only.
    #[inline]
    fn qsocket_mut<'s>(&self) -> Option<&'s mut quic::Socket> {
        // Route through the shared [`quic_socket_mut`] accessor; see INVARIANT.
        self.qsocket.map(|qs| quic_socket_mut(qs.as_ptr()))
    }

    /// `on_conn_close` runs from a later engine tick, so the registry is not
    /// touched from here.
    pub(crate) fn close_if_idle(&mut self, pool_id: u64) {
        if self.pool_id != pool_id || self.closed || !self.pending.is_empty() {
            return;
        }
        if let Some(qs) = self.qsocket_mut() {
            // No later request may pick a connection that is going away.
            self.closed = true;
            self.closed_by_us = true;
            qs.close();
        }
    }

    pub(crate) fn has_headroom(&self) -> bool {
        if self.closed {
            return false;
        }
        let Some(qs) = self.qsocket_mut() else {
            return self.pending.len() < 64;
        };
        // After handshake every pending entry has had make_stream called, so
        // lsquic's n_avail_streams already accounts for them — comparing
        // against pending.len would double-subtract. Before handshake nothing
        // is counted yet, so cap optimistically at the default MAX_STREAMS.
        if !self.handshake_done {
            return self.pending.len() < 64;
        }
        qs.streams_avail() > 0
    }

    /// Queue `client` for a stream on this connection. The lsquic stream is
    /// created asynchronously, so the request goes into `pending` until
    /// `onStreamOpen` pops it.
    pub(crate) fn enqueue(&mut self, mut client: InFlightRequest) {
        debug_assert!(!self.closed);
        client.flags.protocol = Protocol::Http3;
        client.allow_retry = false;

        let mut stream = AliasableBox::new(Stream::new(self));
        let _ = H3::live_streams.fetch_add(1, Ordering::Relaxed);
        client.carrier = Carrier::H3(stream.as_non_null());
        stream.client = Some(client);
        self.pending.push(stream);

        if self.handshake_done {
            // handshake_done implies qsocket is Some and valid.
            self.qsocket_mut().unwrap().make_stream();
        }
    }

    /// The request on `stream` was aborted.
    pub(crate) fn abort_stream(stream: NonNull<Stream>) {
        stream_mut(stream.as_ptr())
            .session_mut()
            .fail(stream.as_ptr(), crate::Error::Aborted);
    }

    /// The producer of the request's stream body has more bytes, or ended it.
    pub(crate) fn stream_request_body(stream_ptr: NonNull<Stream>, message: WriteMessageType) {
        let stream = stream_mut(stream_ptr.as_ptr());
        let Some(client) = &mut stream.client else {
            return;
        };
        let crate::HTTPRequestBody::Stream(body) = &mut client.state.original_request_body else {
            return;
        };
        if message == WriteMessageType::LengthMismatch {
            return stream
                .session_mut()
                .fail(stream_ptr.as_ptr(), crate::Error::RequestBodyLengthMismatch);
        }
        body.ended = message == WriteMessageType::End;
        if let Some(qs) = stream.qstream_mut() {
            encode::drain_send_body(stream, qs);
        }
    }

    /// See [`crate::HTTPClient::send_held_body`].
    pub(crate) fn resume_receive(stream_ptr: NonNull<Stream>) {
        let stream = stream_mut(stream_ptr.as_ptr());
        let Some(client) = &mut stream.client else {
            return;
        };
        if let Err(err) = client.send_held_body() {
            return stream.session_mut().fail(stream_ptr.as_ptr(), err);
        }
        let hold = client.holds_off_receiving();
        if let Some(qs) = stream.qstream_mut() {
            qs.hold_window(hold);
        }
    }

    /// Unlink and free `stream`, whose `client` the caller has taken.
    pub(super) fn detach(&mut self, stream: *mut Stream) {
        self.detach_with(stream, false);
    }

    /// `abort` kills the lsquic stream even when the request body is done (the response is not).
    fn detach_with(&mut self, stream: *mut Stream, abort: bool) {
        let st = stream_mut(stream);
        debug_assert!(core::ptr::eq(st.session.as_ptr(), self));
        let request_body_done = st.request_body_done;
        if let Some(qs) = st.qstream_mut() {
            *qs.ext::<Stream>() = None;
            // The success path can reach here while the request body is still
            // being written (server responded early). FIN would be a
            // content-length violation; RESET_STREAM(H3_REQUEST_CANCELLED)
            // is the correct "I'm abandoning this send half" so lsquic reaps
            // the stream instead of leaking it on the pooled session.
            if abort || !request_body_done {
                qs.reset();
            } else {
                // Trailers and the FIN can still arrive, and nothing else releases the hold.
                qs.hold_window(false);
            }
        }
        st.qstream = None;
        if let Some(i) = self.pending.iter().position(|s| s.as_ptr() == stream) {
            self.pending.remove(i);
        }
    }

    pub(crate) fn fail(&mut self, stream: *mut Stream, err: crate::Error) {
        let client = stream_mut(stream).client.take();
        self.detach_with(stream, true);
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
        // An Alt-Svc upgrade whose connection never came up goes back to TCP (RFC 7838 §2.4).
        if !self.handshake_done && client.flags.forced_protocol != Some(Protocol::Http3) {
            self.detach_with(stream, true);
            return client.h3_upgrade_failed(err);
        }
        // RFC 9110 §9.2.2: the origin may have acted on a request that was written.
        let replay_safe = !st.headers_sent || st.peer_rejected || client.method.is_idempotent();
        if client.flags.h3_retried || st.is_streaming_body || !replay_safe {
            self.detach_with(stream, true);
            return client.fail(err);
        }
        let Some(ctx) = ClientContext::get() else {
            self.detach_with(stream, true);
            return client.fail(err);
        };
        client.flags.h3_retried = true;
        // The end of one stream leaves the connection usable, and connect() may
        // pick it again. It must not if the connection is going, or if the
        // origin rejected the request, which it does when it shuts down.
        if st.peer_rejected || !self.qsocket_mut().is_some_and(|qs| qs.is_connected()) {
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
        self.detach_with(stream, true);
        if let Err((client, _)) = ClientContext::as_mut(ctx).connect(client, port) {
            client.h3_upgrade_failed(err);
        }
    }

    /// The stream closed without a FIN (`deliver` detaches at the FIN), so a body that already started is truncated.
    pub(crate) fn on_stream_closed(&mut self, stream: *mut Stream, peer_reset: bool) {
        let st = stream_mut(stream);
        if st
            .client
            .as_ref()
            .is_some_and(|client| client.signals.get(Signal::Aborted))
        {
            return self.fail(stream, crate::Error::Aborted);
        }
        if st.status_code == 0 {
            // A handshake failure, a reset, or a FIN that lsquic refused because no header block came first.
            return self.retry_or_fail(stream, crate::Error::HTTP3StreamReset);
        }
        self.fail(
            stream,
            if peer_reset {
                crate::Error::HTTP3StreamReset
            } else {
                crate::Error::ConnectionClosed
            },
        );
    }

    /// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
    /// `done` = the FIN of the peer arrived; deliver whatever is buffered then
    /// detach. Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
    /// machine sees the same call sequence regardless of transport.
    pub(crate) fn deliver(&mut self, stream: *mut Stream, done: bool) {
        let st = stream_mut(stream);
        let Some(mut client) = st.client.take() else {
            if done {
                self.detach(stream);
            }
            return;
        };

        if client.signals.get(Signal::Aborted) {
            self.detach_with(stream, true);
            return client.fail(crate::Error::Aborted);
        }

        if st.status_code == 0 {
            // Only interim responses so far.
            st.client = Some(client);
            if done {
                self.retry_or_fail(stream, crate::Error::HTTP3StreamReset);
            }
            return;
        }
        let head = (!core::mem::replace(&mut st.headers_delivered, true)).then(|| {
            crate::Response::from_fields(
                u32::from(st.status_code),
                core::mem::take(&mut st.decoded_headers),
            )
        });
        let progress = client.receive_from_stream(head, &st.body_buffer, done);
        st.body_buffer.clear();
        match progress {
            Ok(StreamProgress::Open) => st.client = Some(client),
            Ok(StreamProgress::Complete) => {
                self.detach(stream);
                client.deliver();
            }
            Ok(StreamProgress::Redirect) => {
                self.detach(stream);
                client.follow_redirect();
            }
            Err(err) => {
                self.detach_with(stream, true);
                client.fail(err);
            }
        }
    }
}

/// Upgrade a non-null `*mut quic::Socket` lsquic FFI handle to `&mut`.
///
/// INVARIANT: every caller passes a non-null `quic::Socket` that lsquic owns
/// and keeps live for the borrow's duration — either the socket of a callback's
/// argument (live for the callback), or a `ClientSession.qsocket` field (set
/// by `ClientContext::connect`, valid until `on_conn_close`). The handle is an
/// FFI-owned allocation distinct from any Rust struct holding it. All access
/// is HTTP-thread-only, so the returned `&mut` is the sole live borrow.
#[inline(always)]
pub(super) fn quic_socket_mut<'a>(qs: *mut quic::Socket) -> &'a mut quic::Socket {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *qs }
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

impl Drop for ClientSession {
    fn drop(&mut self) {
        H3::live_sessions.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(self.pending.is_empty());
    }
}
