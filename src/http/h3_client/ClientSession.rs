//! One QUIC connection to an origin. Owns its UDP endpoint via quic.c and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`. The `qsocket`
//! pointer becomes dangling after `callbacks.onConnClose`, so every accessor
//! checks `closed` first. See `src/http/H3Client.zig` for the module-level
//! overview.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::err;
use bun_str::strings;
use bun_uws::quic;

use crate::h3_client::client_context::ClientContext;
use crate::h3_client::encode;
use crate::h3_client::stream::Stream;
use crate::H3Client as H3;
// TODO(port): `const HTTPClient = bun.http;` — the Zig http.zig file *is* the struct.
// In Rust the crate root can't be a struct; assume `crate::HttpClient`.
use crate::HttpClient;
use bun_picohttp as picohttp;

bun_output::declare_scope!(h3_client, hidden);

pub struct ClientSession {
    /// Ref holders: the `ClientContext.sessions` registry while listed (1), the
    /// `quic.Socket` ext slot while connected (1, transferred from the registry
    /// add via `connect`), and one per entry in `pending`. `PendingConnect` holds
    /// an extra ref while DNS is in flight.
    // Intrusive refcount — see `bun_ptr::IntrusiveRc<ClientSession>`.
    ref_count: Cell<u32>, // default: 1
    /// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
    // TODO(port): lifetime — FFI handle that becomes dangling after onConnClose; raw is intentional.
    pub qsocket: Option<NonNull<quic::Socket>>,
    pub hostname: Box<[u8]>,
    pub port: u16,
    pub reject_unauthorized: bool,
    pub handshake_done: bool, // default: false
    pub closed: bool,         // default: false
    pub registry_index: u32,  // default: u32::MAX

    /// Requests waiting for `onStreamOpen` to hand them a stream. Order is
    /// FIFO; `lsquic_conn_make_stream` was already called once per entry.
    // BACKREF/INTRUSIVE: Stream is Box::into_raw'd by Stream::new and destroyed in detach().
    pub pending: Vec<*mut Stream>, // default: Vec::new()
}

impl ClientSession {
    /// `bun.TrivialNew(@This())` — heap-allocate and return raw; pointer is
    /// stashed in the `quic.Socket` ext slot and the `ClientContext` registry.
    pub fn new(init: ClientSession) -> *mut ClientSession {
        Box::into_raw(Box::new(init))
    }

    // `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
    // TODO(port): wire to bun_ptr::IntrusiveRc<ClientSession>; `ref` is a Rust keyword so `ref_`.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: every live ClientSession was created by `new` (Box::into_raw);
            // ref_count hitting 0 means no other alias remains.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
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
        unsafe { qs.as_ref() }.streams_avail() > 0
    }

    /// Queue `client` for a stream on this connection. The lsquic stream is
    /// created asynchronously, so the request goes into `pending` until
    /// `onStreamOpen` pops it.
    pub fn enqueue(&mut self, client: &mut HttpClient) {
        debug_assert!(!self.closed);
        client.h3 = None;
        client.flags.protocol = crate::Protocol::Http3; // TODO(port): enum path for `.http3`
        client.allow_retry = false;

        // TODO(port): Stream::new signature — Zig used `Stream.new(.{ .session = this, .client = client })`.
        let stream: *mut Stream = Stream::new(self, client);
        let _ = H3::live_streams().fetch_add(1, Ordering::Relaxed);
        client.h3 = Some(stream);
        self.pending.push(stream);
        self.ref_();

        if self.handshake_done {
            // SAFETY: handshake_done implies qsocket is Some and valid.
            unsafe { self.qsocket.unwrap().as_ref() }.make_stream();
        }
    }

    pub fn stream_body_by_http_id(&mut self, async_http_id: u32, ended: bool) {
        for &stream_ptr in self.pending.iter() {
            // SAFETY: pending entries are live until detach() removes + destroys them.
            let stream = unsafe { &mut *stream_ptr };
            let Some(client) = stream.client_mut() else { continue };
            if client.async_http_id != async_http_id {
                continue;
            }
            if !client.state.original_request_body.is_stream() {
                return;
            }
            client.state.original_request_body.stream_mut().ended = ended;
            if let Some(qs) = stream.qstream {
                encode::drain_send_body(stream, qs);
            }
            return;
        }
    }

    pub fn detach(&mut self, stream: &mut Stream) {
        if let Some(cl) = stream.client_mut() {
            cl.h3 = None;
        }
        stream.client = None;
        if let Some(qs) = stream.qstream {
            // SAFETY: qstream is a live lsquic stream handle until we null it below.
            unsafe { *qs.as_ref().ext::<Stream>() = None };
            // The success path can reach here while the request body is still
            // being written (server responded early). FIN would be a
            // content-length violation; RESET_STREAM(H3_REQUEST_CANCELLED)
            // is the correct "I'm abandoning this send half" so lsquic reaps
            // the stream instead of leaking it on the pooled session.
            if !stream.request_body_done {
                // SAFETY: same as above.
                unsafe { qs.as_ref() }.reset();
            }
        }
        stream.qstream = None;
        if let Some(i) = self
            .pending
            .iter()
            .position(|&s| core::ptr::eq(s, stream as *mut Stream))
        {
            self.pending.remove(i);
        }
        // TODO(port): Stream::deinit destroys the heap allocation (Box::from_raw);
        // `stream` is dangling after this call.
        Stream::deinit(stream);
        self.deref();
    }

    pub fn fail(&mut self, stream: &mut Stream, err: bun_core::Error) {
        // PORT NOTE: reshaped for borrowck — capture client ptr before detach() invalidates stream.
        let client: Option<*mut HttpClient> = stream.client;
        stream.abort();
        self.detach(stream);
        if let Some(cl) = client {
            // SAFETY: HttpClient outlives its h3 Stream; detach() nulled cl.h3 but cl itself is alive.
            unsafe { &mut *cl }.fail_from_h2(err);
        }
    }

    /// A stream closed before any response headers arrived. If the request
    /// hasn't been retried yet and the body wasn't a JS stream (which may
    /// already be consumed), re-enqueue it on a fresh session — this is the
    /// standard h2/h3 client behavior for the GOAWAY / stateless-reset /
    /// port-reuse race where a pooled session goes stale between the
    /// `matches()` check and the first stream open.
    pub fn retry_or_fail(&mut self, stream: &mut Stream, err: bun_core::Error) {
        let Some(client_ptr) = stream.client else {
            return self.fail(stream, err);
        };
        // SAFETY: stream.client is a live backref while the stream is attached.
        let client = unsafe { &mut *client_ptr };
        if client.flags.h3_retried || stream.is_streaming_body {
            return self.fail(stream, err);
        }
        let Some(ctx) = ClientContext::get() else {
            return self.fail(stream, err);
        };
        client.flags.h3_retried = true;
        // The old session is dead from our perspective; make sure connect()
        // can't pick it again.
        self.closed = true;
        let port = self.port;
        let host: Box<[u8]> = Box::from(&*self.hostname);
        bun_output::scoped_log!(
            h3_client,
            "retry {}:{} after {}",
            bstr::BStr::new(&host),
            port,
            err.name()
        );
        stream.abort();
        self.detach(stream);
        if !ctx.connect(client, &host, port) {
            client.fail_from_h2(err);
        }
        // `host` drops here (was `defer bun.default_allocator.free(host)`).
    }

    pub fn abort_by_http_id(&mut self, async_http_id: u32) -> bool {
        for &stream_ptr in self.pending.iter() {
            // SAFETY: pending entries are live until detach().
            let stream = unsafe { &mut *stream_ptr };
            let Some(cl) = stream.client_mut() else { continue };
            if cl.async_http_id == async_http_id {
                // PORT NOTE: reshaped for borrowck — re-borrow stream after dropping the iterator.
                // SAFETY: pending entries are live until detach(); stream_ptr captured before iterator is dropped.
                let stream = unsafe { &mut *stream_ptr };
                self.fail(stream, err!("Aborted"));
                return true;
            }
        }
        false
    }

    /// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
    /// `done` = the lsquic stream is gone; deliver whatever is buffered then
    /// detach. Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
    /// machine sees the same call sequence regardless of transport.
    pub fn deliver(&mut self, stream: &mut Stream, done: bool) {
        let Some(client_ptr) = stream.client else {
            if done {
                self.detach(stream);
            }
            return;
        };
        // SAFETY: stream.client is a live backref while the stream is attached.
        let client = unsafe { &mut *client_ptr };

        if client.signals.get(crate::Signal::Aborted) {
            // TODO(port): Signal enum path
            return self.fail(stream, err!("Aborted"));
        }

        if stream.status_code != 0 && !stream.headers_delivered {
            stream.headers_delivered = true;
            let result = match self.apply_headers(stream, client) {
                Ok(r) => r,
                Err(e) => return self.fail(stream, e),
            };
            if result == HeaderResult::Finished || (done && stream.body_buffer.is_empty()) {
                if client.state.flags.is_redirect_pending {
                    self.detach(stream);
                    return client.do_redirect_h3();
                }
                client.clone_metadata();
                client.state.flags.received_last_chunk = true;
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                self.detach(stream);
                return finish(client);
            }
            client.clone_metadata();
            if client.signals.get(crate::Signal::HeaderProgress) {
                // TODO(port): Signal enum path
                client.progress_update_h3();
            }
        }

        if client.state.response_stage != crate::ResponseStage::Body {
            // TODO(port): ResponseStage enum path
            if done {
                // Stream closed before headers — handshake/reset failure.
                return self.retry_or_fail(
                    stream,
                    if stream.status_code == 0 {
                        err!("HTTP3StreamReset")
                    } else {
                        err!("ConnectionClosed")
                    },
                );
            }
            return;
        }

        if !stream.body_buffer.is_empty() {
            if done {
                client.state.flags.received_last_chunk = true;
            }
            let report = match client.handle_response_body(stream.body_buffer.as_slice(), false) {
                Ok(r) => r,
                Err(e) => {
                    stream.body_buffer.clear();
                    return self.fail(stream, e);
                }
            };
            stream.body_buffer.clear();
            if done {
                self.detach(stream);
                return finish(client);
            }
            if report {
                if client.state.is_done() {
                    self.detach(stream);
                    return client.progress_update_h3();
                }
                client.progress_update_h3();
            }
            return;
        }

        if done {
            self.detach(stream);
            client.state.flags.received_last_chunk = true;
            return finish(client);
        }
    }

    // TODO(port): narrow error set
    fn apply_headers(
        &mut self,
        stream: &mut Stream,
        client: &mut HttpClient,
    ) -> Result<HeaderResult, bun_core::Error> {
        let mut response = picohttp::Response {
            minor_version: 0,
            status_code: stream.status_code,
            status: b"",
            headers: picohttp::Headers {
                list: stream.decoded_headers.as_slice(),
            },
            bytes_read: 0,
        };
        client.state.pending_response = Some(response.clone());
        let should_continue = client.handle_response_metadata(&mut response)?;
        client.state.pending_response = Some(response);
        client.state.transfer_encoding = crate::TransferEncoding::Identity; // TODO(port): enum path
        if client.state.response_stage == crate::ResponseStage::BodyChunk {
            client.state.response_stage = crate::ResponseStage::Body;
        }
        client.state.flags.allow_keepalive = true;
        Ok(if should_continue == crate::ShouldContinue::Finished {
            // TODO(port): enum path for handleResponseMetadata return
            HeaderResult::Finished
        } else {
            HeaderResult::HasBody
        })
    }
}

fn finish(client: &mut HttpClient) {
    if let Some(cl) = client.state.content_length {
        if client.state.total_body_received != cl {
            return client.fail_from_h2(err!("HTTP3ContentLengthMismatch"));
        }
    }
    client.progress_update_h3();
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        debug_assert!(self.pending.is_empty());
        // pending: Vec and hostname: Box<[u8]> drop automatically.
        // `bun.destroy(this)` is handled by `deref()` via Box::from_raw.
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HeaderResult {
    HasBody,
    Finished,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/ClientSession.zig (268 lines)
//   confidence: medium
//   todos:      11
//   notes:      intrusive RefCount + raw *mut Stream backrefs; several crate::* enum paths (Signal/ResponseStage/Protocol/TransferEncoding/ShouldContinue) guessed — Phase B must resolve against bun_http lib.rs
// ──────────────────────────────────────────────────────────────────────────
