//! One QUIC connection to an origin. Owns its UDP endpoint via quic.c and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`. The `qsocket`
//! pointer becomes dangling after `callbacks.onConnClose`, so every accessor
//! checks `closed` first. See `src/http/H3Client.zig` for the module-level
//! overview.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::err;
use bun_string::immutable as strings;
use bun_uws::quic;

use super::client_context::ClientContext;
use super::encode;
use super::stream::Stream;
use crate::h3_client as H3;
use crate::internal_state::HTTPStage;
use crate::signals::Field as Signal;
use crate::{Encoding, HTTPClient, Protocol, ShouldContinue};
use bun_picohttp as picohttp;

bun_core::declare_scope!(h3_client, hidden);

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

    pub fn has_headroom(&self) -> bool {
        if self.closed {
            return false;
        }
        let Some(qs) = self.qsocket else {
            return self.pending.len() < 64;
        };
        // After handshake every pending entry has had make_stream called, so
        // lsquic's n_avail_streams already accounts for them — comparing
        // against pending.len would double-subtract. Before handshake nothing
        // is counted yet, so cap optimistically at the default MAX_STREAMS.
        if !self.handshake_done {
            return self.pending.len() < 64;
        }
        // SAFETY: qsocket is valid while !closed (checked above).
        unsafe { (*qs.as_ptr()).streams_avail() > 0 }
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
        // SAFETY: `stream` was just allocated by Stream::new; non-null.
        client.h3 = Some(unsafe { NonNull::new_unchecked(stream) });
        self.pending.push(stream);
        self.ref_();

        if self.handshake_done {
            // SAFETY: handshake_done implies qsocket is Some and valid.
            unsafe { (*self.qsocket.unwrap().as_ptr()).make_stream() };
        }
    }

    pub fn stream_body_by_http_id(&mut self, async_http_id: u32, ended: bool) {
        for &stream_ptr in self.pending.iter() {
            // SAFETY: pending entries are live until detach() removes + destroys them.
            let stream = unsafe { &mut *stream_ptr };
            let Some(client) = stream.client else { continue };
            // SAFETY: stream.client is a live backref while the stream is attached.
            let client = unsafe { &mut *client.as_ptr() };
            if client.async_http_id != async_http_id {
                continue;
            }
            if !client.state.original_request_body.is_stream() {
                return;
            }
            if let crate::HTTPRequestBody::Stream(s) = &mut client.state.original_request_body {
                s.ended = ended;
            }
            if let Some(qs) = stream.qstream {
                // SAFETY: qstream is a live lsquic stream handle until on_stream_close.
                encode::drain_send_body(stream, unsafe { &mut *qs.as_ptr() });
            }
            return;
        }
    }

    pub fn detach(&mut self, stream: *mut Stream) {
        // SAFETY: caller passes a live Stream that is in (or was just removed from)
        // self.pending; it remains valid until the heap::take at the bottom.
        let st = unsafe { &mut *stream };
        if let Some(cl) = st.client {
            // SAFETY: stream.client is a live backref while attached.
            unsafe { (*cl.as_ptr()).h3 = None };
        }
        st.client = None;
        if let Some(qs) = st.qstream {
            // SAFETY: qstream is a live lsquic stream handle until we null it below.
            unsafe { *(*qs.as_ptr()).ext::<Stream>() = None };
            // The success path can reach here while the request body is still
            // being written (server responded early). FIN would be a
            // content-length violation; RESET_STREAM(H3_REQUEST_CANCELLED)
            // is the correct "I'm abandoning this send half" so lsquic reaps
            // the stream instead of leaking it on the pooled session.
            if !st.request_body_done {
                // SAFETY: same as above.
                unsafe { (*qs.as_ptr()).reset() };
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
        // SAFETY: caller passes a live Stream from self.pending.
        let client = unsafe { (*stream).client };
        // SAFETY: same as above.
        unsafe { (*stream).abort() };
        self.detach(stream);
        if let Some(cl) = client {
            // SAFETY: HTTPClient outlives its h3 Stream; detach() nulled cl.h3 but cl itself is alive.
            unsafe { (*cl.as_ptr()).fail_from_h2(err) };
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
        // SAFETY: caller passes a live Stream from self.pending.
        let st = unsafe { &mut *stream };
        let Some(client_ptr) = st.client else {
            return self.fail(stream, err);
        };
        // SAFETY: stream.client is a live backref while the stream is attached.
        if unsafe { (*client_ptr.as_ptr()).flags.h3_retried } || st.is_streaming_body {
            return self.fail(stream, err);
        }
        let Some(ctx) = ClientContext::get() else {
            return self.fail(stream, err);
        };
        // SAFETY: same backref as above; short-lived write before detach().
        unsafe { (*client_ptr.as_ptr()).flags.h3_retried = true };
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
        // SAFETY: HTTPClient outlives its h3 Stream; detach() nulled client.h3 but
        // the client itself is alive. Formed only after detach() so its Unique tag
        // is not invalidated by detach()'s aliasing write.
        let client = unsafe { &mut *client_ptr.as_ptr() };
        // SAFETY: leaked Box, process-lifetime; HTTP-thread only.
        if !unsafe { (*ctx.as_ptr()).connect(client, &host, port) } {
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
            // SAFETY: pending entries are live until detach(); read-only raw
            // field access — no `&mut Stream` materialized.
            let Some(cl) = (unsafe { (*stream_ptr).client }) else { continue };
            // SAFETY: stream.client is a live backref while attached.
            if unsafe { (*cl.as_ptr()).async_http_id } == async_http_id {
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
        // SAFETY: caller passes a live Stream from self.pending.
        let st = unsafe { &mut *stream };
        let Some(client_ptr) = st.client else {
            if done {
                self.detach(stream);
            }
            return;
        };
        // SAFETY: stream.client is a live backref while the stream is attached.
        // NB: `detach()` writes `client.h3 = None` through this same raw
        // backref, which pops this `&mut`'s Unique tag under Stacked Borrows —
        // so every `self.detach(stream)` below that is followed by further
        // `client` use re-derives a fresh `&mut` from `client_ptr` first.
        let client = unsafe { &mut *client_ptr.as_ptr() };

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
                    let client = unsafe { &mut *client_ptr.as_ptr() };
                    return client.do_redirect_h3();
                }
                client.clone_metadata();
                client.state.flags.received_last_chunk = true;
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                self.detach(stream);
                // SAFETY: re-derive — detach() invalidated the prior Unique tag.
                let client = unsafe { &mut *client_ptr.as_ptr() };
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
                let client = unsafe { &mut *client_ptr.as_ptr() };
                return finish(client);
            }
            if report {
                if client.state.is_done() {
                    self.detach(stream);
                    // SAFETY: re-derive — detach() invalidated the prior Unique tag.
                    let client = unsafe { &mut *client_ptr.as_ptr() };
                    return client.progress_update_h3();
                }
                client.progress_update_h3();
            }
            return;
        }

        if done {
            self.detach(stream);
            // SAFETY: re-derive — detach() invalidated the prior Unique tag.
            let client = unsafe { &mut *client_ptr.as_ptr() };
            client.state.flags.received_last_chunk = true;
            return finish(client);
        }
    }
}

fn apply_headers(
    stream: &mut Stream,
    client: &mut HTTPClient,
) -> Result<HeaderResult, bun_core::Error> {
    let mut response = picohttp::Response {
        minor_version: 0,
        status_code: u32::from(stream.status_code),
        status: b"",
        headers: picohttp::HeaderList { list: stream.decoded_headers.as_slice() },
        bytes_read: 0,
    };
    // SAFETY: lifetime erase — `pending_response` is `Response<'static>`; the
    // borrowed header slice is deep-copied synchronously by `clone_metadata`
    // inside the same lsquic callback before lsquic frees the hset, so no
    // dangling read occurs (matches Zig semantics).
    client.state.pending_response =
        Some(unsafe { core::mem::transmute::<picohttp::Response<'_>, picohttp::Response<'static>>(response) });
    let should_continue = client.handle_response_metadata(&mut response)?;
    // SAFETY: same lifetime erase as above.
    client.state.pending_response =
        Some(unsafe { core::mem::transmute::<picohttp::Response<'_>, picohttp::Response<'static>>(response) });
    client.state.transfer_encoding = Encoding::Identity;
    if client.state.response_stage == HTTPStage::BodyChunk {
        client.state.response_stage = HTTPStage::Body;
    }
    client.state.flags.allow_keepalive = true;
    Ok(if should_continue == ShouldContinue::Finished {
        HeaderResult::Finished
    } else {
        HeaderResult::HasBody
    })
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum HeaderResult {
    HasBody,
    Finished,
}

// ported from: src/http/h3_client/ClientSession.zig
