//! One QUIC connection to an origin. Owns its UDP endpoint via quic.c and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`. The `qsocket`
//! pointer becomes dangling after `callbacks.onConnClose`, so every accessor
//! checks `closed` first. See `src/http/H3Client.zig` for the module-level
//! overview.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::err;
use bun_core::strings;
use bun_uws::quic;

use super::client_context::ClientContext;
use super::encode;
use super::stream::Stream;
use crate::h3_client as H3;
use crate::internal_state::HTTPStage;
use crate::signals::Field as Signal;
use crate::{HTTPClient, HeaderResult, Protocol};

use crate::h3_client::h3_client;

#[derive(bun_ptr::CellRefCounted)]
pub struct ClientSession {
    /// Ref holders: the `ClientContext.sessions` registry while listed (1), the
    /// `quic.Socket` ext slot while connected (1, transferred from the registry
    /// add via `connect`), and one per entry in `pending`. `PendingConnect` holds
    /// an extra ref while DNS is in flight.
    // Intrusive refcount — see `bun_ptr::IntrusiveRc<ClientSession>`.
    ref_count: Cell<u32>,
    /// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
    // FFI handle that becomes dangling after onConnClose; raw is intentional.
    pub qsocket: Option<NonNull<quic::Socket>>,
    pub hostname: Vec<u8>,
    pub port: u16,
    pub reject_unauthorized: bool,
    pub handshake_done: bool,
    pub closed: bool,
    pub registry_index: u32,

    /// Requests waiting for `onStreamOpen` to hand them a stream. Order is
    /// FIFO; `lsquic_conn_make_stream` was already called once per entry.
    // BACKREF/INTRUSIVE: Stream is heap-allocated by Stream::new and destroyed in detach().
    pub pending: Vec<*mut Stream>,
}

impl ClientSession {
    /// `bun.TrivialNew(@This())` — heap-allocate and return raw; pointer is
    /// stashed in the `quic.Socket` ext slot and the `ClientContext` registry.
    pub fn new(hostname: Vec<u8>, port: u16, reject_unauthorized: bool) -> *mut ClientSession {
        bun_core::heap::into_raw(Box::new(ClientSession {
            ref_count: Cell::new(1),
            qsocket: None,
            hostname,
            port,
            reject_unauthorized,
            handshake_done: false,
            closed: false,
            registry_index: u32::MAX,
            pending: Vec::new(),
        }))
    }

    pub fn matches(&self, hostname: &[u8], port: u16, reject_unauthorized: bool) -> bool {
        !self.closed
            && self.port == port
            && self.reject_unauthorized == reject_unauthorized
            && strings::eql_long(&self.hostname, hostname, true)
    }

    /// Mutable access to the live lsquic connection handle.
    ///
    /// INVARIANT: `qsocket` is set by `ClientContext::connect` once
    /// `us_quic_connect_addr` returns and remains valid until
    /// `callbacks::on_conn_close` (which sets `closed = true`). The
    /// `quic::Socket` is an FFI-owned allocation distinct from `self`, so the
    /// returned `&mut` does not alias `self`. HTTP-thread-only.
    #[inline]
    pub(super) fn qsocket_mut<'s>(&self) -> Option<&'s mut quic::Socket> {
        // Route through the shared [`quic_socket_mut`] accessor; see INVARIANT.
        self.qsocket.map(|qs| quic_socket_mut(qs.as_ptr()))
    }

    pub fn has_headroom(&self) -> bool {
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
    pub fn enqueue(&mut self, client: &mut HTTPClient) {
        debug_assert!(!self.closed);
        client.h3 = None;
        client.flags.protocol = Protocol::Http3;
        client.allow_retry = false;

        let stream = Stream::new(self, client);
        let _ = H3::live_streams.fetch_add(1, Ordering::Relaxed);
        client.h3 = Some(NonNull::new(stream).expect("Stream::new returns a fresh allocation"));
        self.pending.push(stream);
        self.ref_();

        if self.handshake_done {
            // handshake_done implies qsocket is Some and valid.
            self.qsocket_mut().unwrap().make_stream();
        }
    }

    pub fn stream_body_by_http_id(&mut self, async_http_id: u32, ended: bool) {
        for &stream_ptr in self.pending.iter() {
            let stream = stream_mut(stream_ptr);
            let Some(client) = stream.client else {
                continue;
            };
            let client = client_mut(client);
            if client.async_http_id != async_http_id {
                continue;
            }
            if !client.state.original_request_body.is_stream() {
                return;
            }
            if let crate::HTTPRequestBody::Stream(s) = &mut client.state.original_request_body {
                s.ended = ended;
            }
            if let Some(qs) = stream.qstream_mut() {
                encode::drain_send_body(stream, qs);
            }
            return;
        }
    }

    pub fn detach(&mut self, stream: *mut Stream) {
        let st = stream_mut(stream);
        if let Some(cl) = st.client {
            client_mut(cl).h3 = None;
        }
        st.client = None;
        let request_body_done = st.request_body_done;
        if let Some(qs) = st.qstream_mut() {
            *qs.ext::<Stream>() = None;
            // The success path can reach here while the request body is still
            // being written (server responded early). FIN would be a
            // content-length violation; RESET_STREAM(H3_REQUEST_CANCELLED)
            // is the correct "I'm abandoning this send half" so lsquic reaps
            // the stream instead of leaking it on the pooled session.
            if !request_body_done {
                qs.reset();
            }
        }
        st.qstream = None;
        if let Some(i) = self.pending.iter().position(|&s| core::ptr::eq(s, stream)) {
            self.pending.remove(i);
        }
        // SAFETY: stream was heap-allocated by Stream::new; ownership is reclaimed
        // here. `Stream::Drop` decrements live_streams.
        unsafe { drop(bun_core::heap::take(stream)) };
        // SAFETY: `self` is a live heap allocation produced by `new`.
        unsafe { ClientSession::deref(self) };
    }

    pub fn fail(&mut self, stream: *mut Stream, err: bun_core::Error) {
        // PORT NOTE: reshaped for borrowck — capture client ptr before detach() invalidates stream.
        let client = stream_mut(stream).client;
        stream_mut(stream).abort();
        self.detach(stream);
        if let Some(cl) = client {
            // detach() nulled cl.h3 but the HTTPClient itself is alive.
            client_mut(cl).fail_from_h2(err);
        }
    }

    /// A stream closed before any response headers arrived. If the request
    /// hasn't been retried yet and the body wasn't a JS stream (which may
    /// already be consumed), re-enqueue it on a fresh session — this is the
    /// standard h2/h3 client behavior for the GOAWAY / stateless-reset /
    /// port-reuse race where a pooled session goes stale between the
    /// `matches()` check and the first stream open.
    pub fn retry_or_fail(&mut self, stream: *mut Stream, err: bun_core::Error) {
        // PORT NOTE: reshaped for Stacked Borrows like `fail` below — `detach()`
        // re-derives `&mut HTTPClient` from the same raw ptr to null `h3`, which
        // would invalidate any `&mut HTTPClient` held across it. Hold the raw
        // `client_ptr` across `detach` and only form `&mut` afterward.
        let st = stream_mut(stream);
        let Some(client_ptr) = st.client else {
            return self.fail(stream, err);
        };
        // `Stream.client` is a live backref while attached; `ParentRef::from`
        // (NonNull → shared deref) reads the Copy `flags` field without
        // forming `&mut HTTPClient` across the `detach()` below.
        if bun_ptr::ParentRef::from(client_ptr).flags.h3_retried || st.is_streaming_body {
            return self.fail(stream, err);
        }
        let Some(ctx) = ClientContext::get() else {
            return self.fail(stream, err);
        };
        // Same backref as above; short-lived write before detach().
        client_mut(client_ptr).flags.h3_retried = true;
        // The old session is dead from our perspective; make sure connect()
        // can't pick it again.
        self.closed = true;
        let port = self.port;
        let host: Vec<u8> = self.hostname.clone();
        bun_core::scoped_log!(
            h3_client,
            "retry {}:{} after {}",
            bstr::BStr::new(&host),
            port,
            bstr::BStr::new(err.name()),
        );
        st.abort();
        self.detach(stream);
        // Formed only after detach() so its Unique tag is not invalidated by
        // detach()'s aliasing write to `client.h3`.
        let client = client_mut(client_ptr);
        if !ClientContext::as_mut(ctx).connect(client, &host, port) {
            client.fail_from_h2(err);
        }
        // `host` drops here (was `defer bun.default_allocator.free(host)`).
    }

    pub fn abort_by_http_id(&mut self, async_http_id: u32) -> bool {
        // PORT NOTE: Zig iterates `pending.items` and calls `this.fail` (which
        // mutates `pending`) mid-loop. Rust borrowck forbids reborrowing
        // `&mut self` while the iterator holds `&self.pending`, and only one
        // entry can match — so locate first via raw-ptr reads, then act.
        let mut found: *mut Stream = core::ptr::null_mut();
        for &stream_ptr in self.pending.iter() {
            // pending entries are live until detach(); `stream_ref` reads the
            // Copy `client` field — no `&mut Stream` materialized.
            let Some(cl) = stream_ref(stream_ptr).client else {
                continue;
            };
            // `Stream.client` is a live backref while attached; `ParentRef`
            // reads the Copy `async_http_id` field via shared deref.
            if bun_ptr::ParentRef::from(cl).async_http_id == async_http_id {
                found = stream_ptr;
                break;
            }
        }
        if !found.is_null() {
            self.fail(found, err!(Aborted));
            return true;
        }
        false
    }

    /// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
    /// `done` = the lsquic stream is gone; deliver whatever is buffered then
    /// detach. Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
    /// machine sees the same call sequence regardless of transport.
    pub fn deliver(&mut self, stream: *mut Stream, done: bool) {
        let st = stream_mut(stream);
        let Some(client_ptr) = st.client else {
            if done {
                self.detach(stream);
            }
            return;
        };
        // NB: `detach()` writes `client.h3 = None` through this same raw
        // backref, which pops this `&mut`'s Unique tag under Stacked Borrows —
        // so every `self.detach(stream)` below that is followed by further
        // `client` use re-derives a fresh `&mut` from `client_ptr` first.
        let client = client_mut(client_ptr);

        if client.signals.get(Signal::Aborted) {
            return self.fail(stream, err!(Aborted));
        }

        if st.status_code != 0 && !st.headers_delivered {
            st.headers_delivered = true;
            let result = match apply_headers(st, client) {
                Ok(r) => r,
                Err(e) => return self.fail(stream, e),
            };
            if result == HeaderResult::Finished || (done && st.body_buffer.is_empty()) {
                if client.state.flags.is_redirect_pending {
                    self.detach(stream);
                    // SAFETY: re-derive — detach() invalidated the prior Unique tag.
                    let client = client_mut(client_ptr);
                    return client.do_redirect_h3();
                }
                client.clone_metadata();
                client.state.flags.received_last_chunk = true;
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                self.detach(stream);
                // SAFETY: re-derive — detach() invalidated the prior Unique tag.
                let client = client_mut(client_ptr);
                return finish(client);
            }
            client.clone_metadata();
            if client.signals.get(Signal::HeaderProgress) {
                client.progress_update_h3();
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            if done {
                // Stream closed before headers — handshake/reset failure.
                return self.retry_or_fail(
                    stream,
                    if st.status_code == 0 {
                        err!(HTTP3StreamReset)
                    } else {
                        err!(ConnectionClosed)
                    },
                );
            }
            return;
        }

        if !st.body_buffer.is_empty() {
            if done {
                client.state.flags.received_last_chunk = true;
            }
            let report = match client.handle_response_body(st.body_buffer.as_slice(), false) {
                Ok(r) => r,
                Err(e) => {
                    st.body_buffer.clear();
                    return self.fail(stream, e);
                }
            };
            st.body_buffer.clear();
            if done {
                self.detach(stream);
                // SAFETY: re-derive — detach() invalidated the prior Unique tag.
                let client = client_mut(client_ptr);
                return finish(client);
            }
            if report {
                if client.state.is_done() {
                    self.detach(stream);
                    // SAFETY: re-derive — detach() invalidated the prior Unique tag.
                    let client = client_mut(client_ptr);
                    return client.progress_update_h3();
                }
                client.progress_update_h3();
            }
            return;
        }

        if done {
            self.detach(stream);
            // SAFETY: re-derive — detach() invalidated the prior Unique tag.
            let client = client_mut(client_ptr);
            client.state.flags.received_last_chunk = true;
            return finish(client);
        }
    }
}

/// Upgrade a `Stream.client` backref to `&mut HTTPClient`.
///
/// INVARIANT: every `NonNull<HTTPClient>` reaching here came from a live
/// `Stream.client` — an `as_erased_ptr()` of the `HTTPClient` embedded in its
/// `AsyncHTTP`, which strictly outlives the `Stream`. All h3 callbacks run on
/// the HTTP thread, so the returned `&mut` is the sole live borrow. Per the
/// Stacked-Borrows notes in `deliver`/`retry_or_fail`, callers re-derive a
/// fresh `&mut` here after each `detach()` (which writes `client.h3 = None`
/// through this same raw backref) rather than holding one across it.
/// Routes through the crate-wide [`HTTPClient::from_erased_backref`] accessor
/// (also used by `encode.rs` / `PendingConnect.rs` for the same backref).
#[inline]
pub(super) fn client_mut<'a>(p: NonNull<HTTPClient<'static>>) -> &'a mut HTTPClient<'static> {
    HTTPClient::from_erased_backref(p)
}

/// Upgrade a non-null `*mut quic::Socket` lsquic FFI handle to `&mut`.
///
/// INVARIANT: every caller passes a non-null `quic::Socket` that lsquic owns
/// and keeps live for the borrow's duration — either an `extern "C"` callback
/// argument (live for the callback), or a `ClientSession.qsocket` field (set
/// by `ClientContext::connect`, valid until `on_conn_close`). The handle is an
/// FFI-owned allocation distinct from any Rust struct holding it. All access
/// is HTTP-thread-only, so the returned `&mut` is the sole live borrow.
/// Centralises the raw `&mut *qs` upgrade shared by `callbacks::qsocket_arg`
/// and `ClientSession::qsocket_mut`.
#[inline(always)]
pub(super) fn quic_socket_mut<'a>(qs: *mut quic::Socket) -> &'a mut quic::Socket {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *qs }
}

/// Upgrade a non-null `*mut quic::Stream` lsquic FFI handle to `&mut`.
///
/// Same INVARIANT as [`quic_socket_mut`] — lsquic-owned, live for the
/// borrow's duration (callback argument, or `Stream.qstream` set in
/// `on_stream_open` and nulled in `on_stream_close` / `detach`), FFI
/// allocation distinct from any Rust holder, HTTP-thread-only.
#[inline(always)]
pub(super) fn quic_stream_mut<'a>(s: *mut quic::Stream) -> &'a mut quic::Stream {
    // SAFETY: see [`quic_socket_mut`] INVARIANT.
    unsafe { &mut *s }
}

/// Upgrade a `*mut Stream` (a `self.pending` entry, or one just removed from
/// it) to `&mut Stream`. Entries are heap-allocated by `Stream::new` and live
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
/// for its scope. Mirrors [`client_mut`]/[`stream_mut`] — centralises the
/// `unsafe { &mut *p }` backref upgrade repeated across `ClientContext` /
/// `PendingConnect`.
#[inline]
pub(super) fn session_mut<'a>(p: *mut ClientSession) -> &'a mut ClientSession {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *p }
}

fn apply_headers(
    stream: &mut Stream,
    client: &mut HTTPClient,
) -> Result<HeaderResult, bun_core::Error> {
    // SAFETY: decoded_headers borrow the lsquic hset, which is deep-copied by
    // `clone_metadata` inside the same lsquic callback before lsquic frees it
    // — see `HTTPClient::apply_multiplexed_headers` contract.
    client.apply_multiplexed_headers(u32::from(stream.status_code), &stream.decoded_headers)
}

fn finish(client: &mut HTTPClient) {
    if let Some(cl) = client.state.content_length {
        if client.state.total_body_received != cl {
            return client.fail_from_h2(err!(HTTP3ContentLengthMismatch));
        }
    }
    client.progress_update_h3();
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        debug_assert!(self.pending.is_empty());
        // pending: Vec and hostname: Vec<u8> drop automatically.
        // `bun.destroy(this)` is handled by `deref()` via heap::take.
    }
}

// ported from: src/http/h3_client/ClientSession.zig
