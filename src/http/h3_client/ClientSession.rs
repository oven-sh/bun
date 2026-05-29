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

    pub(super) fn detach(&mut self, stream: *mut Stream) {
        let st = stream_mut(stream);
        if let Some(cl) = st.client {
            client_mut(cl).h3 = None;
        }
        st.client = None;
        let request_body_done = st.request_body_done;
        if let Some(qs) = st.qstream_mut() {
            *qs.ext::<Stream>() = None;
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

    pub fn retry_or_fail(&mut self, stream: *mut Stream, err: bun_core::Error) {
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

    pub fn deliver(&mut self, stream: *mut Stream, done: bool) {
        let st = stream_mut(stream);
        let Some(client_ptr) = st.client else {
            if done {
                self.detach(stream);
            }
            return;
        };
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

#[inline]
pub(super) fn client_mut<'a>(p: NonNull<HTTPClient<'static>>) -> &'a mut HTTPClient<'static> {
    HTTPClient::from_erased_backref(p)
}

#[inline(always)]
pub(super) fn quic_socket_mut<'a>(qs: *mut quic::Socket) -> &'a mut quic::Socket {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *qs }
}

#[inline(always)]
pub(super) fn quic_stream_mut<'a>(s: *mut quic::Stream) -> &'a mut quic::Stream {
    // SAFETY: see [`quic_socket_mut`] INVARIANT.
    unsafe { &mut *s }
}

#[inline]
pub(super) fn stream_mut<'a>(p: *mut Stream) -> &'a mut Stream {
    // SAFETY: see fn doc.
    unsafe { &mut *p }
}

#[inline]
pub(super) fn stream_ref(p: *mut Stream) -> bun_ptr::ParentRef<Stream> {
    bun_ptr::ParentRef::from(NonNull::new(p).expect("pending entry is non-null"))
}

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
