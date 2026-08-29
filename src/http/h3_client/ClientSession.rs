//! One QUIC connection to an origin. Owns its UDP endpoint via quic.c and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`. The `qsocket`
//! handle becomes dangling after `callbacks.onConnClose`, so it is cleared
//! there and every accessor checks `closed` first.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::rc::Rc;

use bun_core::strings;
use bun_ptr::{RefPtr, SelfRoot, ThisPtr};
use bun_uws::quic;

use super::client_context::ClientContext;
use super::encode;
use super::stream::Stream;
use crate::h3_client as H3;
use crate::http_thread::ThreadState;
use crate::internal_state::HTTPStage;
use crate::signals::Field as Signal;
use crate::{HTTPClient, HeaderResult, Protocol};

use crate::h3_client::h3_client;

#[derive(bun_ptr::CellRefCounted)]
pub struct ClientSession {
    /// Ref holders: the `ClientContext.sessions` registry while listed, the
    /// connection itself until `on_conn_close` / `close_with` (`conn_ref`),
    /// one per entry in `pending`, and a DNS `PendingConnect` while a lookup
    /// is in flight.
    ref_count: Cell<u32>,
    self_root: SelfRoot<ClientSession>,
    /// The connection's own reference, released when it closes.
    conn_ref: Cell<Option<RefPtr<ClientSession>>>,
    /// A reference a body gave up, released by [`ClientSession::enter`] once no
    /// borrow of the session is live.
    released_ref: Cell<Option<RefPtr<ClientSession>>>,
    pub(crate) thread: &'static ThreadState,
    /// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
    pub(crate) qsocket: Cell<Option<NonNull<quic::Socket>>>,
    pub(crate) hostname: Vec<u8>,
    pub(crate) port: u16,
    pub(crate) reject_unauthorized: bool,
    pub(crate) handshake_done: Cell<bool>,
    pub(crate) closed: Cell<bool>,
    pub(crate) registry_index: Cell<u32>,

    /// Requests waiting for `onStreamOpen` to hand them a stream. Order is
    /// FIFO; `lsquic_conn_make_stream` was already called once per entry.
    pub(crate) pending: RefCell<Vec<Rc<Stream>>>,
}

impl ClientSession {
    pub(crate) fn new(
        thread: &'static ThreadState,
        hostname: Vec<u8>,
        port: u16,
        reject_unauthorized: bool,
    ) -> RefPtr<ClientSession> {
        let session = RefPtr::new_cyclic(|self_root| ClientSession {
            ref_count: Cell::new(1),
            self_root,
            conn_ref: Cell::new(None),
            released_ref: Cell::new(None),
            thread,
            qsocket: Cell::new(None),
            hostname,
            port,
            reject_unauthorized,
            handshake_done: Cell::new(false),
            closed: Cell::new(false),
            registry_index: Cell::new(u32::MAX),
            pending: RefCell::new(Vec::new()),
        });
        let _ = H3::live_sessions.fetch_add(1, Ordering::Relaxed);
        // `session` becomes the connection's own reference; hand the caller
        // another.
        let callers = session.clone();
        callers.conn_ref.set(Some(session));
        callers
    }

    #[inline]
    pub(crate) fn this_ptr(&self) -> ThisPtr<ClientSession> {
        self.self_root.this_ptr(self)
    }

    /// Run `body`, then release whatever reference it gave up
    /// (`released_ref`) once no borrow of the session is live.
    pub(crate) fn enter(this: ThisPtr<ClientSession>, body: impl FnOnce(&ClientSession)) {
        let _keep_alive = RefPtr::from_this(this);
        body(&this);
        drop(this.released_ref.take());
    }

    /// The live lsquic connection handle (an opaque handle lsquic owns until
    /// `on_conn_close`, which clears this).
    #[inline]
    pub(crate) fn qsocket<'s>(&self) -> Option<&'s mut quic::Socket> {
        self.qsocket
            .get()
            .map(|qs| quic::Socket::opaque_mut(qs.as_ptr()))
    }

    pub(crate) fn matches(&self, hostname: &[u8], port: u16, reject_unauthorized: bool) -> bool {
        !self.closed.get()
            && self.port == port
            && self.reject_unauthorized == reject_unauthorized
            && strings::eql_long(&self.hostname, hostname, true)
    }

    pub(crate) fn has_headroom(&self) -> bool {
        if self.closed.get() {
            return false;
        }
        let pending = self.pending.borrow().len();
        let Some(qs) = self.qsocket() else {
            return pending < 64;
        };
        // After handshake every pending entry has had make_stream called, so
        // lsquic's n_avail_streams already accounts for them — comparing
        // against pending.len would double-subtract. Before handshake nothing
        // is counted yet, so cap optimistically at the default MAX_STREAMS.
        if !self.handshake_done.get() {
            return pending < 64;
        }
        qs.streams_avail() > 0
    }

    /// Queue `client` for a stream on this connection. The lsquic stream is
    /// created asynchronously, so the request goes into `pending` until
    /// `onStreamOpen` pops it.
    pub(crate) fn enqueue(&self, client: &mut HTTPClient) {
        debug_assert!(!self.closed.get());
        client.flags.protocol = Protocol::Http3;
        client.allow_retry = false;

        let entry_ref = RefPtr::from_this(self.this_ptr());
        let stream = Rc::new(Stream::new(self, entry_ref, client.req()));
        self.pending.borrow_mut().push(stream);

        if self.handshake_done.get() {
            // handshake_done implies qsocket is Some and valid. lsquic may call
            // `on_stream_open` from inside `make_stream()`, so no `pending`
            // borrow may be held across it.
            self.qsocket().unwrap().make_stream();
        }
    }

    /// This session's own hold on `stream` (one of its `pending` entries).
    pub(crate) fn stream_rc(&self, stream: &Stream) -> Option<Rc<Stream>> {
        self.pending
            .borrow()
            .iter()
            .find(|s| core::ptr::eq(&raw const ***s, stream))
            .cloned()
    }

    fn stream_for_http_id(&self, async_http_id: u32) -> Option<Rc<Stream>> {
        self.pending
            .borrow()
            .iter()
            .find(|stream| {
                stream
                    .client
                    .get()
                    .is_some_and(|req| req.async_http_id() == async_http_id)
            })
            .cloned()
    }

    pub(crate) fn stream_body_by_http_id(&self, async_http_id: u32, ended: bool) -> bool {
        let Some(stream) = self.stream_for_http_id(async_http_id) else {
            return false;
        };
        let Some(req) = stream.client.get() else {
            return false;
        };
        let is_stream = {
            let mut client = req.client();
            if let crate::Body::Stream(s) = &mut client.state.original_request_body {
                s.ended = ended;
                true
            } else {
                false
            }
        };
        if is_stream {
            if let Some(qs) = stream.qstream() {
                encode::drain_send_body(&stream, qs);
            }
        }
        true
    }

    pub(crate) fn resume_receive_by_http_id(&self, async_http_id: u32) -> bool {
        let Some(stream) = self.stream_for_http_id(async_http_id) else {
            return false;
        };
        if stream.read_paused.take() {
            if let Some(qs) = stream.qstream() {
                qs.want_read(true);
            }
        }
        true
    }

    /// Unlink and free `stream`, releasing the ref `enqueue` took for it.
    ///
    /// That release is never the session's last one: the connection's own
    /// ref is released only by `close_with` (from `callbacks::on_conn_close`,
    /// a DNS failure or a refused connect), which empties `pending` through here
    /// first. So the session outlives this call and `&self` stays valid.
    pub(super) fn detach(&self, stream: &Stream) {
        debug_assert!(core::ptr::eq(stream.session.get(), self));
        stream.client.set(None);
        let request_body_done = stream.request_body_done.get();
        if let Some(qs) = stream.qstream() {
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
        stream.qstream.set(None);
        let entry_ref = stream.session_ref.take();
        {
            let mut pending = self.pending.borrow_mut();
            if let Some(i) = pending
                .iter()
                .position(|s| core::ptr::eq(&raw const **s, stream))
            {
                pending.remove(i);
            }
        }
        drop(entry_ref);
    }

    /// [`detach`](Self::detach) for a stream whose request the caller is
    /// already working on.
    pub(super) fn detach_busy(&self, stream: &Stream, client: &mut HTTPClient) {
        let _ = client;
        stream.client.set(None);
        self.detach(stream);
    }

    pub(crate) fn fail(&self, stream: &Stream, err: crate::Error) {
        let client = stream.client.get();
        stream.abort();
        self.detach(stream);
        if let Some(req) = client {
            // detach() cleared h3 but the request itself is alive.
            req.client().fail_from_h2(err);
        }
    }

    fn fail_busy(&self, stream: &Stream, client: &mut HTTPClient, err: crate::Error) {
        stream.abort();
        self.detach_busy(stream, client);
        client.fail_from_h2(err);
    }

    /// A stream closed before any response headers arrived. If the request
    /// hasn't been retried yet and the body wasn't a JS stream (which may
    /// already be consumed), re-enqueue it on a fresh session — this is the
    /// standard h2/h3 client behavior for the GOAWAY / stateless-reset /
    /// port-reuse race where a pooled session goes stale between the
    /// `matches()` check and the first stream open.
    pub(crate) fn retry_or_fail(&self, stream: &Stream, err: crate::Error) {
        let Some(req) = stream.client.get() else {
            return self.fail(stream, err);
        };
        let mut client = req.client();
        self.retry_or_fail_busy(stream, &mut client, err);
    }

    pub(crate) fn abort_by_http_id(&self, async_http_id: u32) -> bool {
        let Some(stream) = self.stream_for_http_id(async_http_id) else {
            return false;
        };
        self.fail(&stream, crate::Error::Aborted);
        true
    }

    /// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
    /// `done` = the lsquic stream is gone; deliver whatever is buffered then
    /// detach. Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
    /// machine sees the same call sequence regardless of transport.
    pub(crate) fn deliver(&self, stream: &Stream, done: bool) {
        let Some(req) = stream.client.get() else {
            if done {
                self.detach(stream);
            }
            return;
        };
        let mut client = req.client();
        let client = &mut *client;

        if client.signals.get(Signal::Aborted) {
            return self.fail_busy(stream, client, crate::Error::Aborted);
        }

        if stream.status_code.get() != 0 && !stream.headers_delivered.get() {
            stream.headers_delivered.set(true);
            let decoded_headers = stream.decoded_headers.borrow();
            let (result, response) = match client
                .apply_multiplexed_headers(u32::from(stream.status_code.get()), &decoded_headers)
            {
                Ok(r) => r,
                Err(e) => {
                    drop(decoded_headers);
                    return self.fail_busy(stream, client, e);
                }
            };
            // `is_done()`: Content-Length: 0 can arrive as `HasBody` (e.g. an
            // SSE content-type), which would make the headerProgress update
            // below terminal and finish `client` while the stream still holds it.
            if result == HeaderResult::Finished
                || (done && stream.body_buffer.borrow().is_empty())
                || client.state.is_done()
            {
                if client.state.flags.is_redirect_pending {
                    drop(decoded_headers);
                    self.detach_busy(stream, client);
                    return client.do_redirect_h3();
                }
                client.clone_metadata(&response);
                drop(decoded_headers);
                client.state.flags.received_last_chunk = true;
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                self.detach_busy(stream, client);
                return finish(client);
            }
            client.clone_metadata(&response);
            drop(decoded_headers);
            if client.signals.get(Signal::HeaderProgress) {
                client.progress_update_h3();
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            if done {
                let err = if stream.status_code.get() == 0 {
                    crate::Error::HTTP3StreamReset
                } else {
                    crate::Error::ConnectionClosed
                };
                // Stream closed before headers — handshake/reset failure.
                return self.retry_or_fail_busy(stream, client, err);
            }
            return;
        }

        if !stream.body_buffer.borrow().is_empty() {
            if done {
                client.state.flags.received_last_chunk = true;
            }
            let body_buffer = core::mem::take(&mut *stream.body_buffer.borrow_mut());
            let report = match client.handle_response_body(body_buffer.as_slice(), false) {
                Ok(r) => r,
                Err(e) => {
                    return self.fail_busy(stream, client, e);
                }
            };
            {
                let mut slot = stream.body_buffer.borrow_mut();
                if slot.is_empty() {
                    *slot = body_buffer;
                    slot.clear();
                }
            }
            if done {
                self.detach_busy(stream, client);
                return finish(client);
            }
            if report {
                if client.state.is_done() {
                    self.detach_busy(stream, client);
                    return client.progress_update_h3();
                }
                client.progress_update_h3();
            }
            return;
        }

        if done {
            self.detach_busy(stream, client);
            if let Err(err) = client.state.finalize_body_on_eof() {
                return client.fail_from_h2(err);
            }
            finish(client);
        }
    }

    /// [`retry_or_fail`](Self::retry_or_fail) with the stream's client
    /// already borrowed.
    fn retry_or_fail_busy(&self, stream: &Stream, client: &mut HTTPClient, err: crate::Error) {
        if client.flags.h3_retried || stream.is_streaming_body.get() {
            return self.fail_busy(stream, client, err);
        }
        let Some(ctx) = ClientContext::get(self.thread) else {
            return self.fail_busy(stream, client, err);
        };
        client.flags.h3_retried = true;
        // The old session is dead from our perspective; make sure connect()
        // can't pick it again.
        self.closed.set(true);
        let port = self.port;
        let host: Vec<u8> = self.hostname.clone();
        bun_core::scoped_log!(
            h3_client,
            "retry {}:{} after {}",
            bstr::BStr::new(&host),
            port,
            bstr::BStr::new(err.name()),
        );
        stream.abort();
        self.detach_busy(stream, client);
        if !ctx.connect(client, &host, port) {
            client.fail_from_h2(err);
        }
    }

    /// Tear down a session that never reached `on_conn_close` (DNS failure or
    /// every waiter aborted while DNS was in flight), or whose connection is
    /// gone: leave the registry, fail every waiter with `err`, and give up the
    /// connection's reference.
    pub(crate) fn close_with(&self, err: impl Fn(&ClientSession) -> crate::Error, retry: bool) {
        self.closed.set(true);
        if let Some(ctx) = ClientContext::get(self.thread) {
            ctx.unregister(self);
        }
        loop {
            let Some(stream) = self.pending.borrow().first().cloned() else {
                break;
            };
            if retry {
                self.retry_or_fail(&stream, err(self));
            } else {
                self.fail(&stream, err(self));
            }
        }
        let _ = H3::LIVE_SESSIONS.fetch_sub(1, Ordering::Relaxed);
        let conn_ref = self.conn_ref.take();
        debug_assert!(conn_ref.is_some(), "h3 session closed twice");
        self.released_ref.set(conn_ref);
    }
}

fn finish(client: &mut HTTPClient) {
    if let Some(cl) = client.state.content_length {
        if client.state.total_body_received != cl {
            return client.fail_from_h2(crate::Error::HTTP3ContentLengthMismatch);
        }
    }
    client.progress_update_h3();
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        debug_assert!(self.pending.borrow().is_empty());
    }
}
