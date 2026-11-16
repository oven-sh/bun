//! One TCP+TLS connection running the HTTP/2 protocol for `fetch()`. Owns the
//! socket, the connection-scoped HPACK tables, and a map of active `Stream`s.

use core::num::NonZeroU32;
use core::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::Error;
use bun_collections::{ArrayHashMap, VecExt};
use bun_core::strings;

use super::stream::{State as StreamState, Stream};
use super::{dispatch, encode};
use crate::ext_slot::{ActiveSocket, ExtSlot};
use crate::h2_frame_parser as wire;
use crate::http_context::{HTTPSocket, HttpContextId, PeerVerification};
use crate::http_request_body::HTTPRequestBody;
use crate::http_thread::WriteMessageType;
use crate::internal_state::HTTPStage;
use crate::lshpack;
use crate::registry::Registry;
use crate::signals;
use crate::ssl_config::{self, SSLConfig};
use crate::{
    HTTPClient, HTTPThread, HTTPVerboseLevel, HeaderResult, InFlightRequest, NewHTTPContext,
    PendingH2Resolution, Protocol, Reconnect, RequestBuffer,
};

/// HTTP/2 only ever runs over TLS in this client (ALPN "h2").
pub type Socket = HTTPSocket<true>;

const LOCAL_INITIAL_WINDOW_SIZE: u32 = super::LOCAL_INITIAL_WINDOW_SIZE;

/// An abort sends a liveness PING only if its request waited this long with no bytes read.
const LIVENESS_GRACE: Duration = Duration::from_secs(1);
/// Cap on the idle timer while a liveness PING is unanswered, unless
/// `BUN_CONFIG_HTTP_IDLE_TIMEOUT` is shorter. Go's default `PingTimeout`.
const PING_ACK_TIMEOUT_SECONDS: u64 = 15;

// 31-/24-bit wire fields stored as u32; range asserts at use sites.
#[allow(non_camel_case_types)]
type u31 = u32;
#[allow(non_camel_case_types)]
type u24 = u32;

/// Owned by `HTTPThread::active_h2_sessions` or by the keep-alive pool.
pub struct ClientSession {
    pub(crate) hpack: lshpack::HpackHandle, // RAII owner; Deref/DerefMut to lshpack::HPACK
    pub(crate) socket: Socket,
    context: HttpContextId,
    registry_index: u32,

    /// Pool key. Owned copy so the session can outlive the originating client.
    pub(crate) hostname: Box<[u8]>,
    pub(crate) port: u16,
    pub(crate) ssl_config: Option<ssl_config::SharedPtr>,
    pub(crate) did_have_handshaking_error: bool,
    /// How the TLS peer was authenticated; carried into the keepalive pool and
    /// checked by the coalescing path so a caller only multiplexes onto a
    /// session verified the way it would verify a fresh one.
    pub(crate) verification: PeerVerification,
    /// The fetch session whose requests may multiplex onto this connection.
    pub(crate) pool: crate::PoolOptions,

    pub(crate) writer: FrameWriter,

    /// Inbound bytes until a full 9-byte header + declared payload is
    /// available, so frame handlers always see complete frames.
    pub(crate) read_buffer: Vec<u8>,

    pub(crate) streams: ArrayHashMap<u31, Box<Stream>>,
    pub(crate) next_stream_id: u31,
    /// Stream id whose CONTINUATION sequence is in progress; 0 = none.
    pub(crate) expecting_continuation: u31,
    /// CONTINUATION frames seen so far in the current header block.
    pub(crate) continuation_count: u8,

    /// Cold-start coalesced requests parked until the server's first SETTINGS
    /// frame arrives so the real MAX_CONCURRENT_STREAMS cap can be honoured.
    pub(crate) pending_attach: Vec<InFlightRequest>,

    pub(crate) preface_sent: bool,
    pub(crate) settings_received: bool,
    pub(crate) goaway_received: bool,
    /// Set when the HPACK encoder's dynamic table has diverged from the
    /// server's view (writeRequest failed mid-encode). Existing siblings whose
    /// HEADERS already went out are unaffected, but no new stream may be
    /// opened on this connection.
    pub(crate) encoder_poisoned: bool,
    /// Set by `dispatchFrame` when the inbound batch carried a frame that
    /// advanced an active stream (HEADERS/DATA/WINDOW_UPDATE on a tracked id).
    /// `onData` only re-arms the idle timer when this is true so a server
    /// can't keep a stalled upload alive forever with bare PINGs.
    pub(crate) stream_progressed: bool,
    /// When the socket last delivered bytes.
    last_read: Instant,
    /// A liveness PING is unanswered: the session takes no new stream and is
    /// not pooled, and `rearm_timeout` bounds the wait for the ACK.
    pub(crate) awaiting_ping_ack: bool,
    /// The idle timer is armed for that wait, not for a request's own shorter timeout.
    ping_cap_armed: bool,
    /// A liveness PING went out since the last HEADERS or DATA. gRPC servers
    /// close a connection that sends several PINGs with neither in between:
    /// https://github.com/golang/go/issues/70575
    pub(crate) liveness_ping_spent: bool,
    pub(crate) goaway_last_stream_id: u31,
    pub(crate) fatal_error: Option<Error>,
    /// HEADERS/CONTINUATION fragments for a stream we no longer track (e.g.
    /// in flight when we RST'd it). RFC 9113 §4.3 still requires the block be
    /// fed to the HPACK decoder so the connection-level dynamic table stays
    /// in sync.
    pub(crate) orphan_header_block: Vec<u8>,
    /// Reused HPACK-encode scratch for `writeRequest` so each request doesn't
    /// alloc/free its own header-block buffer.
    pub(crate) encode_scratch: Vec<u8>,

    pub(crate) remote_max_concurrent_streams: u32,
    pub(crate) remote_initial_window_size: u32,
    /// SETTINGS_HEADER_TABLE_SIZE received from the peer that hasn't yet been
    /// acknowledged with a Dynamic Table Size Update (RFC 7541 §6.3) at the
    /// start of a header block. lshpack's encoder doesn't emit that opcode
    /// itself, so writeRequest must prepend it before the first encode call.
    pub(crate) pending_hpack_enc_capacity: Option<u32>,

    /// DATA bytes consumed since the last connection-level WINDOW_UPDATE.
    pub(crate) conn_unacked_bytes: u32,
}

/// What it takes to send a frame for a stream that is borrowed from `ClientSession::streams`.
pub(crate) struct FrameWriter {
    /// Queued bytes for the socket; whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    pub(crate) write_buffer: bun_io::StreamBuffer,
    pub(crate) remote_max_frame_size: u24,
    /// Connection-level send window. Starts at the spec default regardless of
    /// SETTINGS; only WINDOW_UPDATE on stream 0 grows it.
    pub(crate) conn_send_window: i32,
}

impl FrameWriter {
    /// Send RST_STREAM for `stream` and mark it closed.
    pub(crate) fn rst_stream(&mut self, stream: &mut Stream, code: wire::ErrorCode) {
        if stream.rst_done || stream.state == StreamState::Closed {
            return;
        }
        stream.rst_done = true;
        stream.state = StreamState::Closed;
        let value: [u8; 4] = code.0.to_be_bytes();
        self.write_frame(wire::FrameType::HTTP_FRAME_RST_STREAM, 0, stream.id, &value);
    }

    #[inline]
    pub(crate) fn queue(&mut self, bytes: &[u8]) {
        let _ = self.write_buffer.write(bytes);
    }

    pub(crate) fn write_frame(
        &mut self,
        frame_type: wire::FrameType,
        flags: u8,
        stream_id: u32,
        payload: &[u8],
    ) {
        // Wire format: u24 length BE, u8 type, u8 flags, u32 stream-id BE.
        let len = u32::try_from(payload.len()).expect("int cast");
        let mut header = [0u8; wire::FrameHeader::BYTE_SIZE];
        header[0..3].copy_from_slice(&len.to_be_bytes()[1..4]);
        header[3] = frame_type as u8;
        header[4] = flags;
        header[5..9].copy_from_slice(&stream_id.to_be_bytes());
        self.queue(&header);
        self.queue(payload);
    }

    pub(crate) fn write_window_update(&mut self, stream_id: u32, increment: u31) {
        let bytes = increment.to_be_bytes();
        self.write_frame(
            wire::FrameType::HTTP_FRAME_WINDOW_UPDATE,
            0,
            stream_id,
            &bytes,
        );
    }
}

impl ClientSession {
    fn ext_slot(&self) -> &ExtSlot {
        ExtSlot::of(&self.socket).expect("connected")
    }

    /// `index` is reserved in `HTTPThread::active_h2_sessions`, where `leave` puts the session.
    pub(crate) fn register(&mut self, index: u32) {
        self.registry_index = index;
        self.ext_slot().set(ActiveSocket::Session(index));
    }

    fn unregister(&self, sessions: &mut Registry<Self>) {
        sessions.release(self.registry_index);
        self.ext_slot().set(ActiveSocket::Dead);
    }

    fn leave(self: Box<Self>, thread: &mut HTTPThread) {
        if self.fatal_error.is_none() {
            thread.active_h2_sessions.put(self.registry_index, self);
        } else {
            self.terminate(thread);
        }
    }

    #[cold]
    fn terminate(self: Box<Self>, thread: &mut HTTPThread) {
        self.unregister(&mut thread.active_h2_sessions);
        NewHTTPContext::terminate_socket(self.socket);
        drop(self);
    }

    fn release_or_leave(self: Box<Self>, thread: &mut HTTPThread) {
        if self.has_requests() {
            self.leave(thread);
        } else {
            self.release(thread);
        }
    }

    /// Pools the connection (after the ACK of its liveness PING) or closes it.
    fn release(self: Box<Self>, thread: &mut HTTPThread) {
        let can_pool = self.can_pool();
        if self.fatal_error.is_some() || (self.awaiting_ping_ack && can_pool) {
            return self.leave(thread);
        }
        self.unregister(&mut thread.active_h2_sessions);
        let ctx = thread.context::<true>(self.context);
        if !can_pool || self.socket.is_closed_or_has_error() {
            NewHTTPContext::close_socket(self.socket);
        } else if let Some(pooled) = ctx.release_socket(
            self.socket,
            self.did_have_handshaking_error,
            self.verification,
            &self.hostname,
            self.port,
            self.ssl_config.as_ref(),
            None,
            b"",
            0,
            0,
            b"",
            self.pool,
        ) {
            pooled.h2_session = Some(self);
        }
    }

    /// Socket onData entry point; see [`Self::handle_data`].
    pub(crate) fn on_data(mut self: Box<Self>, thread: &mut HTTPThread, incoming: &[u8]) {
        self.handle_data(thread, incoming);
        if thread.reconnects.is_empty() {
            return self.release_or_leave(thread);
        }
        // A retry or a redirect may come back to this session.
        let socket = self.socket;
        self.leave(thread);
        thread.run_reconnects();
        if let Some(index) = ExtSlot::of(&socket).and_then(ExtSlot::session)
            && let Some(this) = thread.active_h2_sessions.take(index)
        {
            this.release_or_leave(thread);
        }
    }

    /// Socket onWritable entry point; see [`Self::handle_writable`].
    pub(crate) fn on_writable(mut self: Box<Self>, thread: &mut HTTPThread) {
        self.handle_writable(thread);
        self.release_or_leave(thread);
    }

    /// Socket onClose entry point. The socket is already gone, so
    /// every stream fails and the session is freed.
    pub(crate) fn on_close(mut self: Box<Self>, thread: &mut HTTPThread, err: Error) {
        self.fail_streams(thread, err);
        self.unregister(&mut thread.active_h2_sessions);
        drop(self);
    }

    /// Socket onTimeout entry point; see [`Self::on_close`]. When the wait for
    /// the ACK of a liveness PING ran out, the connection is lost.
    pub(crate) fn on_timeout(self: Box<Self>, thread: &mut HTTPThread) {
        let err = if self.ping_cap_armed {
            Error::ConnectionClosed
        } else {
            Error::Timeout
        };
        self.on_close(thread, err);
    }

    /// Multiplex `client` onto an established (registered or pool-resumed)
    /// session; see [`Self::adopt_client`].
    pub(crate) fn adopt(mut self: Box<Self>, thread: &mut HTTPThread, client: InFlightRequest) {
        self.adopt_client(thread, client);
        if self.has_requests() || self.can_pool() {
            self.leave(thread);
        } else {
            self.release(thread);
        }
    }

    /// Called from the HTTP thread's shutdown queue when a fetch on this
    /// session is aborted; see [`Self::abort_request`].
    pub(crate) fn abort(
        mut self: Box<Self>,
        thread: &mut HTTPThread,
        async_http_id: u32,
        stream_id: Option<NonZeroU32>,
    ) {
        self.abort_request(thread, async_http_id, stream_id);
        self.release_or_leave(thread);
    }

    /// HTTP-thread wake-up from `scheduleRequestWrite`; see
    /// [`Self::stream_request_body`].
    pub(crate) fn stream_body(
        mut self: Box<Self>,
        thread: &mut HTTPThread,
        stream_id: u31,
        message: WriteMessageType,
    ) {
        self.stream_request_body(thread, stream_id, message);
        self.release_or_leave(thread);
    }

    /// HTTP-thread wake-up from `schedule_receive_resume`.
    pub(crate) fn resume_response(mut self: Box<Self>, thread: &mut HTTPThread, stream_id: u31) {
        self.resume_receive(thread, stream_id);
        self.drain_response_body(stream_id);
        self.leave(thread);
    }

    pub(crate) fn close_idle(sessions: &mut Registry<Self>, pool_id: u64) {
        let is_idle = |s: &Self| s.pool.id == pool_id && !s.has_requests();
        let mut from = 0;
        while let Some(this) = sessions.take_first(from, is_idle) {
            from = this.registry_index;
            this.unregister(sessions);
            NewHTTPContext::close_socket(this.socket);
        }
    }

    /// For a context that is about to close its sockets.
    pub(crate) fn free_all_of(sessions: &mut Registry<Self>, context: HttpContextId) {
        let mut from = 0;
        while let Some(this) = sessions.take_first(from, |s| s.context == context) {
            from = this.registry_index;
            this.unregister(sessions);
        }
    }

    /// Registers a session for a socket whose ALPN selected h2 and opens the first stream without waiting for SETTINGS.
    pub(crate) fn start(thread: &mut HTTPThread, socket: Socket, mut client: InFlightRequest) {
        let mut this = Box::new(ClientSession {
            hpack: lshpack::HpackHandle::new(4096),
            socket,
            context: HttpContextId::of(&client),
            registry_index: 0,
            hostname: Box::<[u8]>::from(client.connected_url.hostname),
            port: client.connected_url.get_port_auto(),
            ssl_config: client.tls_props.clone(),
            did_have_handshaking_error: client.flags.did_have_handshaking_error,
            verification: client.socket_verification(),
            pool: client.pool,
            writer: FrameWriter {
                write_buffer: bun_io::StreamBuffer::default(),
                remote_max_frame_size: wire::DEFAULT_MAX_FRAME_SIZE,
                conn_send_window: wire::DEFAULT_WINDOW_SIZE as i32,
            },
            read_buffer: Vec::new(),
            streams: ArrayHashMap::default(),
            next_stream_id: 1,
            expecting_continuation: 0,
            continuation_count: 0,
            pending_attach: Vec::new(),
            preface_sent: false,
            settings_received: false,
            goaway_received: false,
            encoder_poisoned: false,
            stream_progressed: false,
            last_read: Instant::now(),
            awaiting_ping_ack: false,
            ping_cap_armed: false,
            liveness_ping_spent: false,
            goaway_last_stream_id: 0,
            fatal_error: None,
            orphan_header_block: Vec::new(),
            encode_scratch: Vec::new(),
            remote_max_concurrent_streams: 100,
            remote_initial_window_size: wire::DEFAULT_WINDOW_SIZE,
            pending_hpack_enc_capacity: None,
            conn_unacked_bytes: 0,
        });
        super::live_sessions.fetch_add(1, Ordering::Relaxed);
        this.register(thread.active_h2_sessions.reserve());
        client.resolve_pending_h2(thread, PendingH2Resolution::H2(&mut this));
        this.attach(thread, client);
        this.leave(thread);
    }

    fn has_headroom(&self) -> bool {
        !self.goaway_received
            && !self.encoder_poisoned
            && !self.awaiting_ping_ack
            && self.fatal_error.is_none()
            && self.streams.count() < self.remote_max_concurrent_streams as usize
            && self.next_stream_id < wire::MAX_STREAM_ID
    }

    pub(crate) fn accepts(&self, client: &HTTPClient<'_>, port: u16) -> bool {
        self.context == HttpContextId::of(client)
            && self.port == port
            && strings::eql_long(&self.hostname, client.connected_url.hostname)
            && self.has_headroom()
            && self.pool.id == client.pool.id
            && SSLConfig::raw_ptr(self.ssl_config.as_ref())
                == SSLConfig::raw_ptr(client.tls_props.as_ref())
            // Same guard as the pool path (`existing_socket`).
            && client.socket_verification().admits(self.verification)
    }

    fn adopt_client(&mut self, thread: &mut HTTPThread, client: InFlightRequest) {
        // Until SETTINGS arrive, MAX_CONCURRENT_STREAMS is unknown and a non-replayable body risks REFUSED_STREAM.
        if !self.settings_received {
            return self.park(thread, client);
        }
        // Belt-and-suspenders: callers gate on hasHeadroom(), but a session
        // pulled from the keep-alive pool (HTTPContext.existingSocket) may have
        // remote_max_concurrent_streams == 0 if a mid-connection SETTINGS
        // dropped it. Re-dispatch instead of asserting in attach().
        if !self.has_headroom() {
            return client.connect(thread);
        }
        self.attach(thread, client);
    }

    /// Park a coalesced request until the server's SETTINGS arrive. Abort
    /// is routed via the session socket so `abort_request` can find it.
    pub(crate) fn park(&mut self, thread: &mut HTTPThread, mut client: InFlightRequest) {
        client.register_abort_tracker::<true>(thread, self.socket, None);
        self.pending_attach.push(client);
        self.rearm_timeout();
    }

    fn drain_pending(&mut self, thread: &mut HTTPThread) {
        if !self.settings_received || self.pending_attach.is_empty() {
            return;
        }
        let waiters = core::mem::take(&mut self.pending_attach);
        for client in waiters {
            if let Some(err) = self.fatal_error {
                client.fail(thread, err);
            } else if client.signals.get(signals::Field::Aborted) {
                client.fail(thread, crate::Error::Aborted);
            } else if self.has_headroom() {
                self.attach(thread, client);
            } else {
                client.connect(thread);
            }
        }
    }

    /// True when the connection can be parked in the keep-alive pool: no
    /// active streams, no GOAWAY/error, and no leftover bytes that would
    /// confuse the next request.
    pub(crate) fn can_pool(&self) -> bool {
        self.streams.count() == 0
            && !self.goaway_received
            && !self.encoder_poisoned
            && self.fatal_error.is_none()
            && self.expecting_continuation == 0
            && self.read_buffer.is_empty()
            && self.writer.write_buffer.is_empty()
            && self.remote_max_concurrent_streams > 0
            && self.next_stream_id < wire::MAX_STREAM_ID
    }

    fn has_requests(&self) -> bool {
        self.streams.count() > 0 || !self.pending_attach.is_empty()
    }

    /// Allocate a stream for `client`, serialise its request as HEADERS +
    /// DATA, and flush.
    fn attach(&mut self, thread: &mut HTTPThread, mut client: InFlightRequest) {
        debug_assert!(self.has_headroom());

        let send_window = i32::try_from(self.remote_initial_window_size.min(wire::MAX_WINDOW_SIZE))
            .expect("int cast");
        let mut stream = Box::new(Stream::new(self.next_stream_id, send_window));
        super::live_streams.fetch_add(1, Ordering::Relaxed);
        self.next_stream_id = self.next_stream_id.saturating_add(2);
        client.register_abort_tracker::<true>(thread, self.socket, NonZeroU32::new(stream.id));
        client.flags.protocol = Protocol::Http2;
        client.allow_retry = false;

        if !self.preface_sent {
            encode::write_preface(self);
        }

        // DATA-frame encoding may yield mid-body — compress into the Vec so the
        // cursor stays valid across event-loop ticks.
        if let Err(e) = client.compress_body_for_send(false) {
            drop(stream);
            return client.fail(thread, e);
        }
        let mut buffer = RequestBuffer::default();
        let request = client.build_request(&mut buffer);
        if let Err(err) = encode::write_request(self, &mut client, &mut stream, &request) {
            // encodeHeader pushes into the HPACK encoder's dynamic table per
            // call, so a mid-encode failure leaves entries the server will
            // never see. Mark the session unusable for future streams and
            // remove without RST — from the server's view this stream id was
            // never opened (RST on an idle stream is a connection error per
            // RFC 9113 §5.1).
            self.encoder_poisoned = true;
            drop(stream);
            client.fail(thread, err);
            // The poisoned session is dead for new work; bounce any waiters
            // and let `release` drop the registration so the next fetch
            // opens a fresh connection instead of waiting for idle-timeout.
            for c in core::mem::take(&mut self.pending_attach) {
                c.connect(thread);
            }
            let _ = self.flush();
            return;
        }
        if client.verbose != HTTPVerboseLevel::None {
            crate::print_request(
                Protocol::Http2,
                &request,
                client.url.href,
                !client.flags.reject_unauthorized,
                client.state.request_body.slice(),
                client.verbose == HTTPVerboseLevel::Curl,
            );
        }
        client.state.request_stage = if stream.local_closed() {
            HTTPStage::Done
        } else {
            HTTPStage::Body
        };
        client.state.response_stage = HTTPStage::Headers;
        stream.client = Some(client);
        let index = self.streams.count();
        let _ = self.streams.put(stream.id, stream);

        self.rearm_timeout();
        if let Err(err) = self.pump_send_bodies() {
            self.fail_all(thread, err);
            return;
        }

        if let Some(client) = &mut self.streams.values_mut()[index].client
            && client.flags.is_streaming_request_body
        {
            client.send_partial_result();
        }
    }

    /// Unlink the stream at `index` from the session map and free it. If the stream was
    /// mid-CONTINUATION (HEADERS arrived without END_HEADERS), the buffered
    /// fragment is moved to `orphan_header_block` so the trailing CONTINUATION
    /// frames decode against the full block — otherwise HPACK-decoding the
    /// suffix alone desyncs the dynamic table for every sibling stream.
    fn remove_stream(&mut self, index: usize) {
        let (id, mut s) = self.streams.swap_remove_at(index);
        if self.expecting_continuation == id {
            self.orphan_header_block = core::mem::take(&mut s.header_block);
        }
    }

    /// Remove the stream at `index` from the session, RST it, and fail its client. The
    /// session and socket stay up for siblings.
    fn detach_with_failure(&mut self, thread: &mut HTTPThread, index: usize, err: Error) {
        let s = &mut *self.streams.values_mut()[index];
        self.writer.rst_stream(s, wire::ErrorCode::CANCEL);
        let client = s.client.take();
        let _ = self.flush();
        self.remove_stream(index);
        if let Some(c) = client {
            c.fail(thread, err);
        }
    }

    /// Re-arm the shared socket's idle timer based on the aggregate of every
    /// attached client. With multiplexed streams the per-request
    /// `disable_timeout` flag can't drive the socket directly (last writer
    /// would win and a `{timeout:false}` long-poll could be killed by a
    /// sibling re-arming, or strip the safety net from one that wants it),
    /// so the session disarms only when *every* attached client opted out.
    fn rearm_timeout(&mut self) {
        // The socket is shared by every stream on the session, so arm the
        // longest effective idle timeout among them (0 = every client's
        // effective deadline is "none", or no clients are attached).
        let mut want: core::ffi::c_uint = 0;
        let mut any_unbounded = false;
        let mut fold = |eff: core::ffi::c_uint| {
            any_unbounded |= eff == 0;
            want = want.max(eff);
        };
        for s in self.streams.values() {
            if let Some(c) = &s.client {
                fold(c.effective_idle_timeout_seconds());
            }
        }
        for c in &self.pending_attach {
            fold(c.effective_idle_timeout_seconds());
        }
        // A client whose effective deadline is 0 ("no timeout": explicit
        // `{timeout:false}`, or no override under global=0) contributes 0 to
        // the max, so a sibling's short explicit override would arm the
        // shared socket and kill both. Restore the pre-per-request-override
        // lower bound: floor at the global default, or disarm entirely when
        // the global is 0. When every client is unbounded `want` is already 0
        // and the timer stays disarmed.
        if any_unbounded && want != 0 {
            let global = crate::idle_timeout_seconds();
            want = if global == 0 { 0 } else { want.max(global) };
        }
        self.ping_cap_armed = false;
        if self.awaiting_ping_ack {
            let mut cap = crate::normalize_idle_timeout_seconds(PING_ACK_TIMEOUT_SECONDS);
            let global = crate::idle_timeout_seconds();
            if global != 0 {
                cap = cap.min(global);
            }
            if want == 0 || cap < want {
                want = cap;
                self.ping_cap_armed = true;
            }
        }
        self.socket.set_timeout(want);
    }

    /// A body consumer attached on the JS side: flush any body bytes that arrived between
    /// metadata delivery and `getReader()`.
    fn drain_response_body(&mut self, stream_id: u31) {
        let Some(stream) = self.streams.get_mut(&stream_id).map(Box::as_mut) else {
            return;
        };
        if let Some(client) = &mut stream.client
            && !client.state.decoded_body.list.is_empty()
        {
            client.send_partial_result();
        }
    }

    fn resume_receive(&mut self, thread: &mut HTTPThread, stream_id: u31) {
        if !self.streams.contains(&stream_id) {
            return;
        }
        self.replenish_window();
        if self.writer.write_buffer.is_not_empty() {
            if let Err(err) = self.flush() {
                self.fail_all(thread, err);
            }
        }
    }

    /// New request body bytes (or end-of-body) are available in the request's
    /// ThreadSafeStreamBuffer.
    fn stream_request_body(
        &mut self,
        thread: &mut HTTPThread,
        stream_id: u31,
        message: WriteMessageType,
    ) {
        let Some(index) = self.streams.get_index(&stream_id) else {
            return;
        };
        {
            let Some(client) = &mut self.streams.values_mut()[index].client else {
                return;
            };
            let HTTPRequestBody::Stream(ref mut st) = client.state.original_request_body else {
                return;
            };
            st.ended = message == WriteMessageType::End;
        }
        if message == WriteMessageType::LengthMismatch {
            self.detach_with_failure(thread, index, Error::RequestBodyLengthMismatch);
            self.rearm_timeout();
            return;
        }
        self.rearm_timeout();
        let stream = &mut *self.streams.values_mut()[index];
        encode::drain_send_body(&mut self.writer, stream, usize::MAX);
        if let Err(err) = self.pump_send_bodies() {
            self.fail_all(thread, err);
        }
    }

    fn replenish_window(&mut self) {
        let threshold = LOCAL_INITIAL_WINDOW_SIZE / 2;
        if self.conn_unacked_bytes >= threshold {
            self.writer.write_window_update(0, self.conn_unacked_bytes);
            self.conn_unacked_bytes = 0;
        }
        for s in self.streams.values_mut() {
            if s.unacked_bytes < threshold || s.remote_closed() {
                continue;
            }
            if s.client
                .as_ref()
                .is_some_and(|c| c.signals.is_receive_paused())
            {
                continue;
            }
            self.writer.write_window_update(s.id, s.unacked_bytes);
            s.unacked_bytes = 0;
        }
    }

    pub(crate) fn flush(&mut self) -> Result<bool, Error> {
        let pending = self.writer.write_buffer.slice();
        if pending.is_empty() {
            return Ok(false);
        }
        let len = pending.len();
        let mut total: usize = 0;
        while total < len {
            let wrote = self.socket.write(&pending[total..]);
            if wrote < 0 {
                return Err(crate::Error::WriteFailed);
            }
            let n = wrote as usize;
            total += n;
            if n == 0 {
                break;
            }
        }
        self.writer.write_buffer.wrote(total);
        if self.writer.write_buffer.is_empty() {
            self.writer.write_buffer.reset();
            return Ok(false);
        }
        Ok(true)
    }

    /// Parse frames into per-stream state, deliver each ready stream to its
    /// client. Structured "parse all
    /// → deliver all" because delivering may finish the request.
    fn handle_data(&mut self, thread: &mut HTTPThread, incoming: &[u8]) {
        self.last_read = Instant::now();
        let was_awaiting_ping_ack = self.awaiting_ping_ack;
        self.stream_progressed = false;
        if self.read_buffer.is_empty() {
            let consumed = dispatch::parse_frames(self, incoming);
            if consumed < incoming.len() && self.fatal_error.is_none() {
                self.read_buffer.extend_from_slice(&incoming[consumed..]);
            }
        } else {
            self.parse_buffered(incoming);
        }

        if self.flush().is_err() {
            self.fatal_error = Some(crate::Error::WriteFailed);
        }

        if let Some(err) = self.fatal_error {
            return self.fail_all(thread, err);
        }

        self.drain_pending(thread);
        // attach()'s flush() can failAll() from inside the loop above; if so the
        // session has already torn down.
        if self.fatal_error.is_some() {
            return;
        }
        if let Err(err) = self.pump_send_bodies() {
            return self.fail_all(thread, err);
        }

        // Deliver per-stream. Iterate by index because delivery may remove
        // entries (swapRemove keeps earlier indices stable; revisiting the
        // current index after a removal is intentional).
        let mut i: usize = 0;
        let mut rst_any = false;
        while i < self.streams.count() {
            if self.deliver_stream(thread, i) {
                let s = &mut *self.streams.values_mut()[i];
                // Any detach that leaves the stream open from the server's
                // perspective (we never sent END_STREAM, *or* the server
                // never did and hasn't RST'd) must signal abandonment so the
                // server can release its concurrency slot. rst() is idempotent.
                if s.state != StreamState::Closed {
                    self.writer.rst_stream(s, wire::ErrorCode::CANCEL);
                    rst_any = true;
                }
                self.remove_stream(i);
            } else {
                i += 1;
            }
        }
        self.replenish_window();
        if rst_any || self.writer.write_buffer.is_not_empty() {
            let _ = self.flush();
        }
        // PING/SETTINGS-ACK alone don't reset the idle timer; only frames that
        // moved a stream (HEADERS/DATA/WINDOW_UPDATE on an active id) do. The
        // ACK of a liveness PING lifts that PING's cap.
        if self.stream_progressed || was_awaiting_ping_ack != self.awaiting_ping_ack {
            self.rearm_timeout();
        }
    }

    /// Drain and flush until backpressure or nothing is left: a full flush raises no onWritable.
    fn pump_send_bodies(&mut self) -> Result<(), Error> {
        loop {
            let more = encode::drain_send_bodies(self);
            let backpressured = self.flush()?;
            if !more || backpressured {
                return Ok(());
            }
        }
    }

    fn handle_writable(&mut self, thread: &mut HTTPThread) {
        if let Err(err) = self.pump_send_bodies() {
            return self.fail_all(thread, err);
        }
        self.reap_aborted(thread);
        self.rearm_timeout();
    }

    /// Called while the socket is parked in the pool with no clients; answers
    /// PING/SETTINGS, records GOAWAY, discards anything stream-addressed.
    pub(crate) fn on_idle_data(&mut self, incoming: &[u8]) {
        self.parse_buffered(incoming);
        if self.flush().is_err() {
            self.fatal_error = Some(crate::Error::WriteFailed);
        }
    }

    fn parse_buffered(&mut self, incoming: &[u8]) {
        self.read_buffer.extend_from_slice(incoming);
        let mut buf = core::mem::take(&mut self.read_buffer);
        let consumed = dispatch::parse_frames(self, &buf);
        buf.drain_front(consumed);
        self.read_buffer = buf;
    }

    /// Fails every parked and attached request.
    fn fail_streams(&mut self, thread: &mut HTTPThread, err: Error) {
        for client in core::mem::take(&mut self.pending_attach) {
            client.fail(thread, err);
        }
        for stream in self.streams.values_mut() {
            if let Some(c) = stream.client.take() {
                c.fail(thread, err);
            }
        }
        self.streams.clear_retaining_capacity();
    }

    /// `leave` closes the socket.
    fn fail_all(&mut self, thread: &mut HTTPThread, err: Error) {
        self.fatal_error = Some(self.fatal_error.unwrap_or(err));
        // RFC 9113 §5.4.1: an endpoint that encounters a connection error
        // SHOULD first send GOAWAY. Best-effort only; the socket may already
        // be dead.
        if !self.socket.is_closed_or_has_error() {
            let mut goaway = [0u8; 8];
            goaway[0..4].copy_from_slice(&0u32.to_be_bytes());
            goaway[4..8].copy_from_slice(&dispatch::error_code_for(err).0.to_be_bytes());
            self.writer
                .write_frame(wire::FrameType::HTTP_FRAME_GOAWAY, 0, 0, &goaway);
            let _ = self.flush();
        }
        self.fail_streams(thread, err);
    }

    /// RST_STREAMs (or unparks and fails) the one aborted request; siblings
    /// continue. See [`Self::probe_liveness`].
    fn abort_request(
        &mut self,
        thread: &mut HTTPThread,
        async_http_id: u32,
        stream_id: Option<NonZeroU32>,
    ) {
        let found = self
            .pending_attach
            .iter()
            .position(|c| c.async_http_id == async_http_id);
        let mut silent_since = self.last_read;
        if let Some(i) = found {
            let client = self.pending_attach.swap_remove(i);
            client.fail(thread, crate::Error::Aborted);
        } else if let Some(index) = stream_id.and_then(|id| self.streams.get_index(&id.get())) {
            silent_since = silent_since.max(self.streams.values()[index].opened_at);
            self.detach_with_failure(thread, index, crate::Error::Aborted);
        }
        self.probe_liveness(silent_since);
        self.rearm_timeout();
    }

    /// Send a PING after an abort on a silent connection: the caller may have
    /// given up on one that died with no FIN or RST to say so, which later
    /// requests would otherwise keep joining.
    fn probe_liveness(&mut self, silent_since: Instant) {
        if self.awaiting_ping_ack || silent_since.elapsed() < LIVENESS_GRACE {
            return;
        }
        if self.liveness_ping_spent {
            // Another PING could trip that limit: take no new stream, as after a GOAWAY.
            self.goaway_received = true;
            return;
        }
        self.liveness_ping_spent = true;
        self.writer
            .write_frame(wire::FrameType::HTTP_FRAME_PING, 0, 0, &[0; 8]);
        self.awaiting_ping_ack = self.flush().is_ok();
    }

    fn reap_aborted(&mut self, thread: &mut HTTPThread) {
        let mut i: usize = 0;
        while i < self.streams.count() {
            let aborted = match &self.streams.values()[i].client {
                Some(c) => c.signals.get(signals::Field::Aborted),
                None => {
                    i += 1;
                    continue;
                }
            };
            if aborted {
                self.detach_with_failure(thread, i, crate::Error::Aborted);
            } else {
                i += 1;
            }
        }
    }

    /// Deliver any ready headers/body/error on the stream at `index` to its client.
    /// Returns true when the stream is finished and should be removed.
    fn deliver_stream(&mut self, thread: &mut HTTPThread, index: usize) -> bool {
        let stream = &mut *self.streams.values_mut()[index];
        let Some(mut client) = stream.client.take() else {
            return true;
        };

        if client.signals.get(signals::Field::Aborted) {
            self.writer.rst_stream(stream, wire::ErrorCode::CANCEL);
            let _ = self.flush();
            client.fail(thread, crate::Error::Aborted);
            return true;
        }

        if let Some(err) = stream.fatal_error {
            // Only transparently retry when the server refused the stream
            // before producing any of it (REFUSED_STREAM after HEADERS would
            // be a server bug, but retrying then re-streams a body prefix
            // into a Response that JS already holds — silent corruption).
            if err == crate::Error::HTTP2RefusedStream
                && stream.status_code == 0
                && client.h2_retries < crate::MAX_H2_RETRIES
                && matches!(
                    client.state.original_request_body,
                    HTTPRequestBody::Bytes(_)
                )
            {
                // The refused stream still counts, so a full session is not tried again.
                if !self.has_headroom() {
                    client.retry_from_h2(thread);
                    return true;
                }
                thread.reconnects.push_back((client, Reconnect::RetryH2));
                return true;
            }
            client.fail(thread, err);
            return true;
        }

        if stream.headers_ready {
            stream.headers_ready = false;
            let (result, response) = match client
                .apply_multiplexed_headers(stream.status_code, &mut stream.decoded_headers)
            {
                Ok(r) => r,
                Err(err) => {
                    self.writer.rst_stream(stream, wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    client.fail(thread, err);
                    return true;
                }
            };
            if client.state.flags.is_redirect_pending {
                self.writer.rst_stream(stream, wire::ErrorCode::CANCEL);
                let _ = self.flush();
                // Only a redirect that can come back to this session waits for it.
                if !self.has_headroom()
                    || client.remaining_redirect_count == 1
                    || self.port != client.url.get_port_auto()
                    || !strings::eql_long(&self.hostname, client.url.hostname)
                {
                    client.do_redirect_multiplexed(thread);
                    return true;
                }
                thread.reconnects.push_back((client, Reconnect::Redirect));
                return true;
            }
            client.store_metadata(response);
            // `is_done()`: Content-Length: 0 can arrive as `HasBody` (e.g. an SSE content-type).
            if result == HeaderResult::Finished
                || (stream.remote_closed() && stream.body_buffer.is_empty())
                || client.state.is_done()
            {
                client.state.flags.received_last_chunk = true;
                // .finished = HEAD/204/304: no body is expected regardless of
                // any Content-Length header, so clear it. Otherwise leave the
                // parsed value so finishStream() enforces §8.1.1 against the
                // (zero) bytes actually received.
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                Self::finish_stream(thread, stream, client);
                return true;
            }
            // Mirror the h1 path: deliver headers
            // to JS now so `await fetch()` resolves and `getReader()` can enable
            // response_body_streaming. Without this, a content-length response
            // buffers the entire body before the Response promise settles.
            if client.signals.get(signals::Field::HeaderProgress) {
                client.send_partial_result();
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            stream.client = Some(client);
            return false;
        }

        if !stream.body_buffer.is_empty() {
            let terminal = stream.remote_closed();
            if terminal {
                client.state.flags.received_last_chunk = true;
            }
            let report = match client.handle_response_body(&stream.body_buffer, false) {
                Ok(r) => r,
                Err(err) => {
                    stream.body_buffer.clear();
                    self.writer.rst_stream(stream, wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    client.fail(thread, err);
                    return true;
                }
            };
            stream.body_buffer.clear();
            if terminal {
                Self::finish_stream(thread, stream, client);
                return true;
            }
            if report {
                // handleResponseBody may report completion before END_STREAM
                // (Content-Length satisfied); the trailing END_STREAM/trailers
                // land on a stream we no longer track and are discarded.
                if client.state.is_done() {
                    client.finish(thread);
                    return true;
                }
                client.send_partial_result();
            }
            stream.client = Some(client);
            return false;
        }

        if stream.remote_closed() {
            if let Err(err) = client.state.finalize_body_on_eof() {
                client.fail(thread, err);
                return true;
            }
            Self::finish_stream(thread, stream, client);
            return true;
        }

        stream.client = Some(client);
        false
    }

    /// Terminal delivery: enforce the announced Content-Length (RFC 9113
    /// §8.1.1 — mismatch is malformed) and finish the request.
    /// `total_body_received` is clamped at content_length by the body handler,
    /// so compare the raw DATA byte count instead — that catches overshoot too.
    fn finish_stream(thread: &mut HTTPThread, stream: &Stream, client: InFlightRequest) {
        if let Some(cl) = client.state.content_length {
            if stream.data_bytes_received != cl as u64 {
                return client.fail(thread, crate::Error::HTTP2ContentLengthMismatch);
            }
        }
        client.finish(thread);
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        super::live_sessions.fetch_sub(1, Ordering::Relaxed);
    }
}
