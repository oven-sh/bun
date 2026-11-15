//! One QUIC connection to an origin. Owns its UDP endpoint via quic.c and
//! multiplexes `Stream`s, each bound 1:1 to an `HTTPClient`.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::collections::VecDeque;

use bun_core::strings;
use bun_uws::quic;

use super::encode;
use super::stream::{Stream, StreamSlot};
use crate::h3_client as H3;
use crate::internal_state::HTTPStage;
use crate::signals::Field as Signal;
use crate::{HTTPThread, HeaderResult, InFlightRequest, Protocol, Reconnect};

use crate::h3_client::h3_client;

/// Owned by `ClientContext.sessions`.
pub struct ClientSession {
    /// Null while DNS is in flight; set once `us_quic_connect_addr` returns.
    /// Its ext slot holds `registry_index + 1`.
    qsocket: Option<NonNull<quic::Socket>>,
    pub(crate) hostname: Vec<u8>,
    pub(crate) port: u16,
    pub(crate) reject_unauthorized: bool,
    /// The fetch session whose requests may share this connection.
    pub(crate) pool_id: u64,
    pub(crate) handshake_done: bool,
    pub(crate) closed: bool,
    registry_index: u32,

    /// Requests waiting for `bind_stream` to hand them a stream. Order is
    /// FIFO; `lsquic_conn_make_stream` was already called once per entry.
    pub(crate) pending: VecDeque<Stream>,
    /// Requests that got one.
    pub(crate) streams: Vec<Stream>,
}

impl ClientSession {
    pub(crate) fn new(
        registry_index: u32,
        hostname: Vec<u8>,
        port: u16,
        reject_unauthorized: bool,
        pool_id: u64,
    ) -> Box<ClientSession> {
        H3::live_sessions.fetch_add(1, Ordering::Relaxed);
        Box::new(ClientSession {
            qsocket: None,
            hostname,
            port,
            reject_unauthorized,
            pool_id,
            handshake_done: false,
            closed: false,
            registry_index,
            pending: VecDeque::new(),
            streams: Vec::new(),
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

    pub(super) fn bind_socket(&mut self, qs: &mut quic::Socket) {
        qs.ext().set(u64::from(self.registry_index) + 1);
        self.qsocket = Some(NonNull::from(qs));
    }

    pub(super) fn unbind_socket(&mut self) {
        self.qsocket = None;
    }

    pub(super) fn registry_index_of(qs: &quic::Socket) -> Option<u32> {
        (qs.ext().get() as u32).checked_sub(1)
    }

    /// Mutable access to the live lsquic connection handle.
    #[inline]
    fn qsocket_mut(&mut self) -> Option<&mut quic::Socket> {
        // SAFETY: lsquic frees a connection after `on_conn_close`, which finds `self` through the
        // ext slot and unbinds it. The handle is zero-sized.
        self.qsocket.as_mut().map(|qs| unsafe { qs.as_mut() })
    }

    /// `on_conn_close` runs from a later engine tick, so the registry is not
    /// touched from here.
    pub(crate) fn close_if_idle(&mut self, pool_id: u64) {
        if self.pool_id != pool_id
            || self.closed
            || !self.pending.is_empty()
            || !self.streams.is_empty()
        {
            return;
        }
        if let Some(qs) = self.qsocket_mut() {
            qs.close();
            // No later request may pick a connection that is going away.
            self.closed = true;
        }
    }

    pub(crate) fn has_headroom(&mut self) -> bool {
        if self.closed {
            return false;
        }
        // After handshake every pending entry has had make_stream called, so
        // lsquic's n_avail_streams already accounts for them — comparing
        // against pending.len would double-subtract. Before handshake nothing
        // is counted yet, so cap optimistically at the default MAX_STREAMS.
        if !self.handshake_done {
            return self.pending.len() < 64;
        }
        self.qsocket_mut().is_some_and(|qs| qs.streams_avail() > 0)
    }

    /// Queue `client` for a stream on this connection. The request is in
    /// `pending` until lsquic has a stream for it and `bind_stream` pops it.
    pub(crate) fn enqueue(&mut self, mut client: InFlightRequest) {
        debug_assert!(!self.closed);
        client.flags.protocol = Protocol::Http3;
        client.allow_retry = false;

        let _ = H3::live_streams.fetch_add(1, Ordering::Relaxed);
        self.pending.push_back(Stream::new(client));

        if self.handshake_done {
            self.make_stream();
        }
    }

    /// For one entry of `pending`, once the handshake is done.
    pub(super) fn make_stream(&mut self) {
        let mut qsocket = self.qsocket.expect("handshake done");
        // SAFETY: as in `qsocket_mut`; only an engine tick calls `on_conn_close`.
        if let Some(qs) = unsafe { qsocket.as_mut() }.make_stream() {
            self.bind_stream(qs);
        }
    }

    /// Bind the next pending request to `qs`.
    pub(super) fn bind_stream(&mut self, qs: &mut quic::Stream) {
        let Some(mut stream) = self.pending.pop_front() else {
            return qs.close();
        };
        stream.bind(qs, self.stream_slot(self.streams.len()));
        self.streams.push(stream);
        bun_core::scoped_log!(h3_client, "stream_open");
        // Headers and body go out from `on_stream_writable`, not here.
        // This can run from inside `on_hsk_done`, which lsquic
        // invokes from `ci_tick`'s crypto-read phase with `SC_BUFFER_STREAM` set
        // while the client's TLS Finished is still only on the HSK crypto
        // stream's frab list. Any `lsquic_stream_write` here fills the send
        // controller so `write_is_possible()` goes false before
        // `process_streams_write_events` ever dispatches the crypto stream, and
        // the Finished is never packetized (the server stays a mini-conn and
        // drops every 1-RTT packet). `on_write` is dispatched via lsquic's
        // priority iterator, which serves the crypto stream first. This mirrors
        // lsquic's reference `bin/http_client.c`, whose `on_new_stream` only
        // calls `lsquic_stream_wantwrite(stream, 1)`.
        qs.want_write(true);
    }

    fn stream_slot(&self, index: usize) -> StreamSlot {
        StreamSlot {
            session_index: self.registry_index,
            index,
        }
    }

    fn stream_by_http_id(&mut self, async_http_id: u32) -> Option<&mut Stream> {
        (self.streams.iter_mut().chain(&mut self.pending))
            .find(|stream| stream.is_for(async_http_id))
    }

    pub(crate) fn stream_body_by_http_id(&mut self, async_http_id: u32, ended: bool) -> bool {
        let Some(stream) = self.stream_by_http_id(async_http_id) else {
            return false;
        };
        if let Some(client) = &mut stream.client
            && let crate::HTTPRequestBody::Stream(s) = &mut client.state.original_request_body
        {
            s.ended = ended;
            stream.with_qstream(encode::drain_send_body);
        }
        true
    }

    /// [`Self::detach_by_http_id`], unless the request has dropped its stream body.
    pub(crate) fn detach_streaming_by_http_id(
        &mut self,
        async_http_id: u32,
    ) -> Option<InFlightRequest> {
        let client = self.stream_by_http_id(async_http_id)?.client.as_ref()?;
        if !client.state.original_request_body.is_stream() {
            return None;
        }
        self.detach_by_http_id(async_http_id)
    }

    pub(crate) fn resume_receive_by_http_id(&mut self, async_http_id: u32) -> bool {
        let Some(stream) = self.stream_by_http_id(async_http_id) else {
            return false;
        };
        if core::mem::take(&mut stream.read_paused) {
            if let Some(qs) = stream.qstream_mut() {
                qs.want_read(true);
            }
        }
        true
    }

    /// Unlink and free the stream at `index`, whose `client` the caller has taken.
    fn detach(&mut self, index: usize) {
        self.detach_with(index, false);
    }

    /// `abort` kills the lsquic stream even when the request body is done (the response is not).
    fn detach_with(&mut self, index: usize, abort: bool) -> Stream {
        let mut st = self.streams.swap_remove(index);
        // The success path can reach here while the request body is still
        // being written (server responded early). FIN would be a
        // content-length violation; RESET_STREAM(H3_REQUEST_CANCELLED)
        // is the correct "I'm abandoning this send half" so lsquic reaps
        // the stream instead of leaking it on the pooled session.
        st.unbind(abort || !st.request_body_done);
        let slot = self.stream_slot(index);
        if let Some(qs) = self.streams.get_mut(index).and_then(Stream::qstream_mut) {
            slot.store_in(qs);
        }
        st
    }

    pub(crate) fn fail(&mut self, thread: &mut HTTPThread, index: usize, err: crate::Error) {
        let client = self.detach_with(index, true).client.take();
        if let Some(client) = client {
            client.fail(thread, err);
        }
    }

    /// Tear down a session that never got a socket.
    pub(super) fn fail_pending(&mut self, thread: &mut HTTPThread, err: crate::Error) {
        while let Some(client) = self.pending.pop_front().map(|mut st| st.client.take()) {
            client.expect("set by enqueue").fail(thread, err);
        }
    }

    /// A stream closed before any response headers arrived. If the request
    /// hasn't been retried yet and the body wasn't a JS stream (which may
    /// already be consumed), re-enqueue it — this is the standard h2/h3 client
    /// behavior for the GOAWAY / stateless-reset / port-reuse race where a
    /// pooled session goes stale between the `matches()` check and the first
    /// stream open. `st` has left the session.
    pub(crate) fn retry_or_fail(
        &mut self,
        thread: &mut HTTPThread,
        mut st: Stream,
        err: crate::Error,
    ) {
        let Some(mut client) = st.client.take() else {
            return;
        };
        // RFC 9110 §9.2.2: the origin may have acted on a request that was written.
        let replay_safe = !st.headers_sent || st.peer_rejected || client.method.is_idempotent();
        if client.flags.h3_retried || st.is_streaming_body || !replay_safe {
            drop(st);
            return client.fail(thread, err);
        }
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
        (thread.reconnects).push_back((client, Reconnect::RetryH3 { port, err }));
    }

    /// Takes the request off this session, for the caller to fail.
    pub(crate) fn detach_by_http_id(&mut self, async_http_id: u32) -> Option<InFlightRequest> {
        let is_match = |stream: &Stream| stream.is_for(async_http_id);
        match self.streams.iter().position(is_match) {
            Some(index) => self.detach_with(index, true).client.take(),
            None => {
                let index = self.pending.iter().position(is_match)?;
                self.pending.remove(index)?.client.take()
            }
        }
    }

    /// Runs from inside lsquic's process_conns via on_stream_{headers,data,close}.
    /// `done` = the lsquic stream is gone; deliver whatever is buffered then
    /// detach. Mirrors H2's `ClientSession.deliverStream` so the HTTPClient state
    /// machine sees the same call sequence regardless of transport.
    pub(crate) fn deliver(&mut self, thread: &mut HTTPThread, index: usize, done: bool) {
        let st = &mut self.streams[index];
        let Some(mut client) = st.client.take() else {
            if done {
                self.detach(index);
            }
            return;
        };

        if client.signals.get(Signal::Aborted) {
            self.detach_with(index, true);
            return client.fail(thread, crate::Error::Aborted);
        }

        if st.status_code != 0 && !st.headers_delivered {
            st.headers_delivered = true;
            let (result, response) = match client.apply_multiplexed_headers(
                thread,
                u32::from(st.status_code),
                &st.decoded_headers,
            ) {
                Ok(r) => r,
                Err(e) => {
                    self.detach_with(index, true);
                    return client.fail(thread, e);
                }
            };
            // `is_done()`: Content-Length: 0 can arrive as `HasBody` (e.g. an SSE content-type).
            if result == HeaderResult::Finished
                || (done && st.body_buffer.is_empty())
                || client.state.is_done()
            {
                if client.state.flags.is_redirect_pending {
                    self.detach(index);
                    return thread.reconnects.push_back((client, Reconnect::Redirect));
                }
                client.clone_metadata(&response);
                client.state.flags.received_last_chunk = true;
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                self.detach(index);
                return finish(thread, client);
            }
            client.clone_metadata(&response);
            if client.signals.get(Signal::HeaderProgress) {
                client.send_partial_result();
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            st.client = Some(client);
            if done {
                // Stream closed before headers — handshake/reset failure.
                let err = if st.status_code == 0 {
                    crate::Error::HTTP3StreamReset
                } else {
                    crate::Error::ConnectionClosed
                };
                let st = self.detach_with(index, true);
                return self.retry_or_fail(thread, st, err);
            }
            return;
        }

        if !st.body_buffer.is_empty() {
            if done {
                client.state.flags.received_last_chunk = true;
            }
            let report = match client.handle_response_body(thread, st.body_buffer.as_slice(), false)
            {
                Ok(r) => r,
                Err(e) => {
                    st.body_buffer.clear();
                    self.detach_with(index, true);
                    return client.fail(thread, e);
                }
            };
            st.body_buffer.clear();
            if done {
                self.detach(index);
                return finish(thread, client);
            }
            if report {
                if client.state.is_done() {
                    self.detach(index);
                    return client.finish(thread);
                }
                client.send_partial_result();
            }
            st.client = Some(client);
            return;
        }

        if done {
            self.detach(index);
            if let Err(err) = client
                .state
                .finalize_body_on_eof(&mut thread.lazy_libdeflater)
            {
                return client.fail(thread, err);
            }
            return finish(thread, client);
        }

        st.client = Some(client);
    }
}

fn finish(thread: &mut HTTPThread, client: InFlightRequest) {
    if let Some(cl) = client.state.content_length {
        if client.state.total_body_received != cl {
            return client.fail(thread, crate::Error::HTTP3ContentLengthMismatch);
        }
    }
    client.finish(thread);
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        H3::live_sessions.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(self.pending.is_empty() && self.streams.is_empty());
    }
}
