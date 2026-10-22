//! One TCP+TLS connection running the HTTP/2 protocol for `fetch()`. Owns the
//! socket, the connection-scoped HPACK tables, and a map of active `Stream`s.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::Error;
use bun_collections::{ArrayHashMap, VecExt};
use bun_core::strings;
use bun_http_types::h2::flow_control::{DEFAULT_WINDOW_SIZE, RecvWindow, SendWindow};
use bun_http_types::h2::frame::{ErrorCode, FrameHeader, FrameType, MAX_STREAM_ID};
use bun_http_types::h2::header_block::HeaderBlockAssembler;
use bun_http_types::h2::settings::DEFAULT_MAX_FRAME_SIZE;
use bun_http_types::h2::stream::State as StreamState;
use bun_ptr::RefPtr;

use super::stream::Stream;
use super::{dispatch, encode};
use crate::http_context::{HTTPSocket, PeerVerification};
use crate::http_request_body::HTTPRequestBody;
use crate::http_thread::WriteMessageType;
use crate::internal_state::HTTPStage;
use crate::lshpack;
use crate::signals;
use crate::ssl_config;
use crate::{HTTPClient, HTTPVerboseLevel, HeaderResult, NewHTTPContext, Protocol, Transport};

/// HTTP/2 only ever runs over TLS in this client (ALPN "h2").
pub type Socket = HTTPSocket<true>;

const LOCAL_INITIAL_WINDOW_SIZE: u32 = super::LOCAL_INITIAL_WINDOW_SIZE;

/// An abort sends a liveness PING only if its request waited this long with no bytes read.
const LIVENESS_GRACE: Duration = Duration::from_secs(1);
/// Cap on the idle timer while a liveness PING is unanswered, unless
/// `BUN_CONFIG_HTTP_IDLE_TIMEOUT` is shorter. Go's default `PingTimeout`.
const PING_ACK_TIMEOUT_SECONDS: core::ffi::c_uint = 15;

// 31-/24-bit wire fields stored as u32; range asserts at use sites.
#[allow(non_camel_case_types)]
type u31 = u32;
#[allow(non_camel_case_types)]
type u24 = u32;

#[derive(bun_ptr::CellRefCounted)]
pub struct ClientSession {
    /// Ref holders: the socket-ext tag while the session is the ActiveSocket
    /// (1), the context's active_h2_sessions registry while listed (1), and
    /// the keep-alive pool while parked (1). Hand-offs between socket and
    /// pool transfer a ref rather than touching the count.
    pub(crate) ref_count: Cell<u32>,
    /// Set when a `&mut self` body has torn the session down (`fail_streams`,
    /// or `maybe_release` closing an unpoolable socket) and the socket-ext ref
    /// is therefore due to be released. The body cannot release it itself: at
    /// that point it is normally the last ref, and freeing the session while a
    /// `&mut self` argument to it is live is undefined behaviour even if the
    /// reference is never used again. The [`SessionPtr`] entry point that ran
    /// the body takes the flag and releases the ref once the borrow has ended
    /// (see [`ClientSession::enter`]).
    socket_ref_owed: Cell<bool>,

    pub(crate) hpack: lshpack::Coder,
    pub(crate) socket: Socket,
    pub(crate) ctx: *mut NewHTTPContext<true>, // BACKREF: context outlives and registers this session

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

    /// Queued bytes for the socket; whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    pub(crate) write_buffer: bun_io::StreamBuffer,

    /// Inbound bytes until a full 9-byte header + declared payload is
    /// available, so frame handlers always see complete frames.
    pub(crate) read_buffer: Vec<u8>,

    pub(crate) streams: ArrayHashMap<u31, *mut Stream>,
    pub(crate) next_stream_id: u31,
    /// The inbound HEADERS + CONTINUATION sequence in progress.
    pub(crate) header_block: HeaderBlockAssembler,

    /// Cold-start coalesced requests parked until the server's first SETTINGS
    /// frame arrives so the real MAX_CONCURRENT_STREAMS cap can be honoured.
    pub(crate) pending_attach: Vec<*mut HTTPClient<'static>>, // BACKREF: client owns itself; session only borrows

    pub(crate) preface_sent: bool,
    pub(crate) settings_received: bool,
    pub(crate) goaway_received: bool,
    /// True while onData's deliver loop is running. retryFromH2/doRedirect
    /// re-dispatch may try to adopt back onto this same session; blocking
    /// that during delivery prevents `streams` mutation under iteration and
    /// the failAll → onClose → double-free path.
    pub(crate) delivering: bool,
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
    pub(crate) fatal_error: Option<Error>,
    /// Reused by `write_request`: a request's fields, and their HPACK encoding.
    pub(crate) request_fields: lshpack::HeaderBlock,
    pub(crate) encode_scratch: Vec<u8>,

    pub(crate) remote_max_frame_size: u24,
    pub(crate) remote_max_concurrent_streams: u32,
    pub(crate) remote_initial_window_size: u32,
    /// Connection-level send window. Starts at the spec default regardless of
    /// SETTINGS; only WINDOW_UPDATE on stream 0 grows it.
    pub(crate) conn_send_window: SendWindow,
    pub(crate) conn_recv_window: RecvWindow,

    /// Index in the context's active-session list while reachable for
    /// concurrent attachment; maxInt when not listed.
    pub(crate) registry_index: Cell<u32>,
}

/// A live session as its holders point at it: the socket ext slot, the
/// context's registry, the keep-alive pool, or the pointer `create` returned.
///
/// Every `pub(crate)` entry point that can leave the session released (socket
/// events, the registry / pool hand-offs in `HTTPContext::connect`, the
/// per-request wakeups from `HTTPThread`) takes one of these instead of
/// `&mut self` and goes through [`ClientSession::enter`], so the releases
/// happen through the holder's pointer after the body's `&mut` borrow has
/// ended. Callers that need the session alive across two entry points hold a
/// [`RefPtr::from_this`] guard of their own across both.
pub(crate) type SessionPtr = bun_ptr::ThisPtr<ClientSession>;

/// Upgrade a `*mut Stream` from `self.streams` to `&mut Stream`.
///
/// INVARIANT: stream pointers stored in `ClientSession.streams` are
/// `heap::alloc`-boxed allocations owned by the session, valid until removed
/// via `remove_stream`/`fail_streams`/`Drop`. They are independent heap
/// allocations, so `&mut Stream` is disjoint from `&mut ClientSession`.
/// HTTP-thread-only.
#[inline(always)]
pub(super) fn stream_mut<'a>(ptr: *mut Stream) -> &'a mut Stream {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *ptr }
}

/// Shared variant of [`stream_mut`]. Returns a [`bun_ptr::ParentRef`] so the
/// shared deref goes through the safe `Deref` impl instead of an open-coded
/// raw-ptr reborrow; same INVARIANT as [`stream_mut`] (heap-boxed, owned by
/// `streams`, HTTP-thread-only) ⇒ the stream outlives the handle. Mirrors
/// [`crate::http_context::HTTPContext::h2_session_ref`].
#[inline(always)]
fn stream_ref(ptr: *const Stream) -> bun_ptr::ParentRef<Stream> {
    bun_ptr::ParentRef::from(NonNull::new(ptr.cast_mut()).expect("streams entry is non-null"))
}

/// Upgrade a `*mut HTTPClient` from `pending_attach` to `&mut HTTPClient`.
///
/// INVARIANT: `pending_attach` entries are back-refs registered via
/// `enqueue`/`adopt` (each is `client.as_erased_ptr().as_ptr()`, hence
/// non-null); each points at a live `HTTPClient` embedded in its `AsyncHTTP`,
/// alive until its terminal callback (which removes it from the queue first).
/// Disjoint allocation from `ClientSession`. HTTP-thread-only.
#[inline(always)]
fn pending_client_mut<'a>(ptr: *mut HTTPClient<'static>) -> &'a mut HTTPClient<'static> {
    // Route through the crate-wide [`HTTPClient::from_erased_backref`] accessor;
    // `pending_attach` entries originate from `as_erased_ptr()`, never null.
    HTTPClient::from_erased_backref(NonNull::new(ptr).expect("pending_attach entries are non-null"))
}

/// Upgrade a `NonNull<HTTPClient>` taken from `Stream.client` to `&mut`.
///
/// INVARIANT: `Stream.client` is a back-ref to the live `HTTPClient` embedded
/// in its `AsyncHTTP`, set in `attach()` and cleared before the terminal
/// callback. Disjoint allocation from both `Stream` and `ClientSession`, so
/// the returned `&mut` does not alias either. HTTP-thread-only.
#[inline(always)]
pub(super) fn stream_client_mut<'a>(
    c: NonNull<HTTPClient<'static>>,
) -> &'a mut HTTPClient<'static> {
    // Route through the crate-wide [`HTTPClient::from_erased_backref`] accessor;
    // see INVARIANT above.
    HTTPClient::from_erased_backref(c)
}

/// Reclaim and drop a `Stream` previously `heap::alloc`-boxed in `attach()`.
///
/// INVARIANT (module): `stream` was removed from `ClientSession.streams`
/// immediately before this call, so the session is the sole remaining owner.
#[inline(always)]
fn drop_stream(stream: *mut Stream) {
    // SAFETY: see INVARIANT above.
    unsafe { drop(bun_core::heap::take(stream)) };
}

impl ClientSession {
    /// Wrap a holder's pointer as a [`SessionPtr`].
    ///
    /// INVARIANT: `session` is a session the caller holds a ref on (a socket
    /// ext slot's tag, a registry or pool entry, or the pointer `create`
    /// returned), so it is live for as long as the caller uses the handle.
    /// HTTP-thread-only.
    #[inline]
    pub(crate) fn this_ptr(session: NonNull<ClientSession>) -> SessionPtr {
        // SAFETY: see INVARIANT above.
        unsafe { SessionPtr::new(session.as_ptr()) }
    }

    /// Run a `&mut self` body on the session behind `this`, then perform the
    /// releases it asked for.
    ///
    /// The guard keeps the session alive while the body re-enters clients
    /// (delivering bodies, failing requests) and releases the registry ref, so
    /// no release inside the body is ever the last one. `body` receives a
    /// reborrow that ends when it returns; only then is the socket-ext ref it
    /// may have given up (`socket_ref_owed`) released, followed by the guard's
    /// own ref, both through `this`. When the body tore the session down that
    /// second release frees it, with no reference to it live anywhere.
    fn enter(this: SessionPtr, body: impl FnOnce(&mut ClientSession)) {
        let _guard = RefPtr::from_this(this);
        // SAFETY: `this` is live (see `this_ptr`; the guard above holds it for
        // the rest of this call) and HTTP-thread-only, so this is the only
        // borrow of the session for the duration of `body`.
        body(unsafe { &mut *this.as_ptr() });
        if this.socket_ref_owed.take() {
            // SAFETY: the body gave up the socket ext's ref; `_guard`
            // still holds one, so the session is live and this release is not
            // the last. No borrow of the session is live: the body's ended.
            unsafe { ClientSession::deref(this.as_ptr()) };
        }
    }

    /// Socket onData entry point; see [`Self::handle_data`].
    pub(crate) fn on_data(this: SessionPtr, incoming: &[u8]) {
        Self::enter(this, |s| s.handle_data(incoming));
    }

    /// Socket onWritable entry point; see [`Self::handle_writable`].
    pub(crate) fn on_writable(this: SessionPtr) {
        Self::enter(this, |s| s.handle_writable());
    }

    /// Socket onClose entry point. The socket is already gone, so
    /// every stream fails and the socket ext's ref is released; unless a
    /// caller holds its own guard, the session is freed before this returns.
    pub(crate) fn on_close(this: SessionPtr, err: Error) {
        Self::enter(this, |s| s.fail_streams(err));
    }

    /// Socket onTimeout entry point; see [`Self::on_close`]. When the wait for
    /// the ACK of a liveness PING ran out, the connection is lost.
    pub(crate) fn on_timeout(this: SessionPtr) {
        Self::on_close(
            this,
            if this.ping_cap_armed {
                Error::ConnectionClosed
            } else {
                Error::Timeout
            },
        );
    }

    /// Multiplex `client` onto an established (registered or pool-resumed)
    /// session; see [`Self::adopt_client`].
    pub(crate) fn adopt(this: SessionPtr, client: &mut HTTPClient) {
        Self::enter(this, |s| s.adopt_client(client));
    }

    /// Open the first stream on a session `create` just returned, for the
    /// client whose connect negotiated h2. Unlike [`Self::adopt`] this does not
    /// wait for the server's SETTINGS: the leader's stream carries the preface.
    pub(crate) fn attach_leader(this: SessionPtr, client: &mut HTTPClient) {
        Self::enter(this, |s| s.attach(client));
    }

    /// The session of a stream that a request's `Transport::H2` names.
    fn of_stream(stream: NonNull<Stream>) -> SessionPtr {
        Self::this_ptr(stream_ref(stream.as_ptr()).session)
    }

    /// The request on `stream` was aborted; see [`Self::abort_request`].
    pub(crate) fn abort_stream(stream: NonNull<Stream>) {
        Self::enter(Self::of_stream(stream), |s| {
            let opened_at = stream_ref(stream.as_ptr()).opened_at;
            s.detach_with_failure(stream.as_ptr(), crate::Error::Aborted);
            s.after_abort(s.last_read.max(opened_at));
        });
    }

    /// A request in `pending_attach` was aborted.
    pub(crate) fn abort_parked(
        session: NonNull<ClientSession>,
        client: NonNull<HTTPClient<'static>>,
    ) {
        Self::enter(Self::this_ptr(session), |s| {
            s.pending_attach.retain(|&parked| parked != client.as_ptr());
            pending_client_mut(client.as_ptr()).h2_fail(crate::Error::Aborted);
            s.after_abort(s.last_read);
        });
    }

    /// HTTP-thread wake-up from `scheduleRequestWrite`; see [`Self::on_request_body`].
    pub(crate) fn stream_request_body(stream: NonNull<Stream>, message: WriteMessageType) {
        Self::enter(Self::of_stream(stream), |s| {
            s.on_request_body(stream.as_ptr(), message)
        });
    }

    /// The consumer of the stream's response body takes bytes again.
    pub(crate) fn resume_receive(stream: NonNull<Stream>) {
        Self::enter(Self::of_stream(stream), |s| {
            s.replenish_window();
            if s.write_buffer.is_not_empty() {
                if let Err(err) = s.flush() {
                    return s.fail_all(err);
                }
            }
            // Flush body bytes that arrived between metadata delivery and `getReader()`.
            if let Some(client) = stream_mut(stream.as_ptr()).client_mut() {
                client.h2_drain_response_body(s.socket);
            }
        });
    }

    #[inline]
    pub(crate) fn registry_index(&self) -> u32 {
        self.registry_index.get()
    }
    #[inline]
    pub(crate) fn set_registry_index(&self, i: u32) {
        self.registry_index.set(i);
    }

    /// Send RST_STREAM for `stream` and mark it closed. Equivalent to
    /// `Stream::rst` but routed through `self` directly so the stream's
    /// `session` backref is not dereferenced while `&mut self` is already
    /// live on the stack — re-entering via the raw backref would form a
    /// second aliased `&mut ClientSession` (Stacked-Borrows UB).
    pub(crate) fn rst_stream(&mut self, stream: &mut Stream, code: ErrorCode) {
        if stream.rst_done || stream.state == StreamState::Closed {
            return;
        }
        stream.rst_done = true;
        stream.state = StreamState::Closed;
        let value: [u8; 4] = code.0.to_be_bytes();
        self.write_frame(FrameType::RstStream, 0, stream.id, &value);
    }

    /// Allocate a session for a socket whose ALPN just selected h2 and list it
    /// in the context's registry. The returned handle carries the socket ext's
    /// ref: the caller tags the socket with it (`tag_as_h2`) and then opens the
    /// leader's stream with [`Self::attach_leader`].
    pub(crate) fn create(
        ctx: *mut NewHTTPContext<true>,
        socket: Socket,
        client: &HTTPClient,
    ) -> SessionPtr {
        let this = bun_core::heap::into_raw(Box::new(ClientSession {
            ref_count: Cell::new(1),
            socket_ref_owed: Cell::new(false),
            hpack: lshpack::Coder::default(),
            socket,
            ctx,
            hostname: Box::<[u8]>::from(client.connected_url.hostname),
            port: client.connected_url.get_port_auto(),
            ssl_config: client.tls_props.clone(),
            did_have_handshaking_error: client.flags.did_have_handshaking_error,
            verification: client.socket_verification(),
            pool: client.pool,
            write_buffer: bun_io::StreamBuffer::default(),
            read_buffer: Vec::new(),
            streams: ArrayHashMap::default(),
            next_stream_id: 1,
            header_block: HeaderBlockAssembler::default(),
            pending_attach: Vec::new(),
            preface_sent: false,
            settings_received: false,
            goaway_received: false,
            delivering: false,
            stream_progressed: false,
            last_read: Instant::now(),
            awaiting_ping_ack: false,
            ping_cap_armed: false,
            liveness_ping_spent: false,
            fatal_error: None,
            request_fields: lshpack::HeaderBlock::default(),
            encode_scratch: Vec::new(),
            remote_max_frame_size: DEFAULT_MAX_FRAME_SIZE,
            remote_max_concurrent_streams: 100,
            remote_initial_window_size: DEFAULT_WINDOW_SIZE,
            conn_send_window: SendWindow::new(DEFAULT_WINDOW_SIZE),
            conn_recv_window: RecvWindow::new(LOCAL_INITIAL_WINDOW_SIZE),
            registry_index: Cell::new(u32::MAX),
        }));
        super::live_sessions.fetch_add(1, Ordering::Relaxed);
        // `ctx` is a live back-ref to the owning context (set-once,
        // HTTP-thread-only, no ancestor `&mut HTTPContext` on this path) —
        // route through the centralised [`HTTPClient::ssl_ctx_mut`] accessor.
        HTTPClient::ssl_ctx_mut(ctx).h2_register(this);
        Self::this_ptr(NonNull::new(this).expect("heap::into_raw is non-null"))
    }

    pub(crate) fn has_headroom(&self) -> bool {
        !self.goaway_received
            && !self.awaiting_ping_ack
            && self.fatal_error.is_none()
            && self.streams.count() < self.remote_max_concurrent_streams as usize
            && self.next_stream_id < MAX_STREAM_ID
    }

    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<*const ssl_config::SSLConfig>,
        pool_id: u64,
    ) -> bool {
        let mine: Option<*const ssl_config::SSLConfig> = self
            .ssl_config
            .as_ref()
            .map(|p| std::ptr::from_ref(p.get()));
        self.port == port
            && self.pool.id == pool_id
            && mine == ssl_config
            && strings::eql_long(&self.hostname, hostname, true)
    }

    fn adopt_client(&mut self, client: &mut HTTPClient) {
        // Park instead of attaching when (a) we're inside onData's deliver
        // loop — attach() mustn't mutate `streams` under iteration — or (b)
        // the server's first SETTINGS hasn't arrived yet, so the real
        // MAX_CONCURRENT_STREAMS isn't known and a non-replayable body
        // shouldn't risk a REFUSED_STREAM. The leader bypasses adopt() and
        // attaches directly so the preface still goes out.
        if self.delivering || !self.settings_received {
            return self.park(client);
        }
        // Belt-and-suspenders: callers gate on hasHeadroom(), but a session
        // pulled from the keep-alive pool (HTTPContext.existingSocket) may have
        // remote_max_concurrent_streams == 0 if a mid-connection SETTINGS
        // dropped it. Re-dispatch instead of asserting in attach().
        if !self.has_headroom() {
            client.h2_retry_after_coalesce();
            self.maybe_release();
            return;
        }
        self.attach(client);
        if self.streams.count() == 0 {
            // The request couldn't be encoded. `connect()` is on the stack and borrows the pool, so close instead of parking.
            self.goaway_received = true;
            self.maybe_release();
        }
    }

    /// Park a request that was coalesced onto this session's connect until the
    /// server's SETTINGS arrive; see [`Self::park`].
    pub(crate) fn enqueue(this: SessionPtr, client: &mut HTTPClient<'_>) {
        Self::enter(this, |s| s.park(client));
    }

    /// Park a coalesced request until the server's SETTINGS arrive.
    fn park(&mut self, client: &mut HTTPClient<'_>) {
        client.transport = Transport::H2Parked(NonNull::from(&mut *self));
        self.pending_attach.push(client.as_erased_ptr().as_ptr());
        self.rearm_timeout();
    }

    fn drain_pending(&mut self) {
        if !self.settings_received || self.pending_attach.is_empty() {
            return;
        }
        let waiters = core::mem::take(&mut self.pending_attach);
        for client_ptr in waiters {
            let client = pending_client_mut(client_ptr);
            if let Some(err) = self.fatal_error {
                client.h2_fail(err);
            } else if client.signals.get(signals::Field::Aborted) {
                client.h2_fail(crate::Error::Aborted);
            } else if self.has_headroom() {
                self.attach(client);
            } else {
                client.h2_retry_after_coalesce();
            }
        }
    }

    /// True when the connection can be parked in the keep-alive pool: no
    /// active streams, no GOAWAY/error, and no leftover bytes that would
    /// confuse the next request.
    pub(crate) fn can_pool(&self) -> bool {
        self.streams.count() == 0
            && !self.goaway_received
            && self.fatal_error.is_none()
            && !self.header_block.is_open()
            && self.read_buffer.is_empty()
            && self.write_buffer.is_empty()
            && self.remote_max_concurrent_streams > 0
            && self.next_stream_id < MAX_STREAM_ID
    }

    /// No request is left: the connection only waits for the ACK of its liveness PING.
    pub(crate) fn is_idle_in_pool(&self, pool_id: u64) -> bool {
        self.pool.id == pool_id && self.streams.count() == 0 && self.pending_attach.is_empty()
    }

    /// Close such a connection, which the ACK would otherwise park.
    pub(crate) fn close_idle(this: SessionPtr) {
        Self::enter(this, |s| {
            s.goaway_received = true;
            s.maybe_release();
        });
    }

    #[inline]
    pub(crate) fn queue(&mut self, bytes: &[u8]) {
        let _ = self.write_buffer.write(bytes);
    }

    pub(crate) fn write_frame(
        &mut self,
        frame_type: FrameType,
        flags: u8,
        stream_id: u32,
        payload: &[u8],
    ) {
        self.queue(&FrameHeader::new(frame_type, flags, stream_id, payload.len()).to_bytes());
        self.queue(payload);
    }

    /// Allocate a stream for `client`, serialise its request as HEADERS +
    /// DATA, and flush.
    fn attach(&mut self, client: &mut HTTPClient) {
        debug_assert!(self.has_headroom());

        let stream = bun_core::heap::into_raw(Stream::new(
            self.next_stream_id,
            NonNull::from(&mut *self),
            Some(client.as_erased_ptr()),
            SendWindow::new(self.remote_initial_window_size),
        ));
        super::live_streams.fetch_add(1, Ordering::Relaxed);
        self.next_stream_id = self.next_stream_id.saturating_add(2);
        let stream_ref = stream_mut(stream);
        let _ = self.streams.put(stream_ref.id, stream);
        client.transport = Transport::H2(NonNull::from(&mut *stream_ref));
        client.flags.protocol = Protocol::Http2;
        client.allow_retry = false;

        if !self.preface_sent {
            encode::write_preface(self);
        }

        self.rearm_timeout();
        // DATA-frame encoding may yield mid-body — compress into the Vec so the
        // cursor stays valid across event-loop ticks.
        if let Err(e) = client.compress_body_for_send(false) {
            self.remove_stream(stream);
            client.transport = Transport::None;
            client.fail(e);
            return;
        }
        let mut header_overflow = Vec::new();
        let request = client.build_request(client.body_len_for_send(), &mut header_overflow);
        if let Err(err) = encode::write_request(self, client, stream_ref, &request) {
            // No RST: the server never saw this stream id, and RST_STREAM on an idle stream is a connection error (RFC 9113 §5.1).
            self.remove_stream(stream);
            client.transport = Transport::None;
            client.h2_fail(err);
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
        client.state.request_stage = if stream_ref.local_closed() {
            HTTPStage::Done
        } else {
            HTTPStage::Body
        };
        client.state.response_stage = HTTPStage::Headers;

        if let Err(err) = self.pump_send_bodies() {
            self.fail_all(err);
            return;
        }

        if client.flags.is_streaming_request_body {
            client.h2_progress_update(self.ctx, self.socket);
        }
    }

    /// Unlink `stream` from the session map and free it.
    fn remove_stream(&mut self, stream: *mut Stream) {
        let s = stream_mut(stream);
        self.streams.swap_remove(&s.id);
        drop_stream(stream);
    }

    /// Remove `stream` from the session, RST it, and fail its client. The
    /// session and socket stay up for siblings.
    pub(crate) fn detach_with_failure(&mut self, stream: *mut Stream, err: Error) {
        let s = stream_mut(stream);
        self.rst_stream(s, ErrorCode::CANCEL);
        let _ = self.flush();
        let client = s.client.take();
        if let Some(c) = client {
            stream_client_mut(c).transport = Transport::None;
        }
        self.remove_stream(stream);
        if let Some(c) = client {
            stream_client_mut(c).h2_fail(err);
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
        for &s in self.streams.values() {
            if let Some(c) = stream_ref(s).client_ref() {
                fold(c.effective_idle_timeout_seconds());
            }
        }
        for &c in &self.pending_attach {
            fold(pending_client_mut(c).effective_idle_timeout_seconds());
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
            let mut cap = PING_ACK_TIMEOUT_SECONDS;
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

    /// New request body bytes (or end-of-body) are available in the request's
    /// ThreadSafeStreamBuffer.
    fn on_request_body(&mut self, stream: *mut Stream, message: WriteMessageType) {
        {
            let Some(client) = stream_mut(stream).client_mut() else {
                return;
            };
            let HTTPRequestBody::Stream(ref mut st) = client.state.original_request_body else {
                return;
            };
            st.ended = message == WriteMessageType::End;
        }
        if message == WriteMessageType::LengthMismatch {
            self.detach_with_failure(stream, Error::RequestBodyLengthMismatch);
            self.rearm_timeout();
            self.maybe_release();
            return;
        }
        self.rearm_timeout();
        encode::drain_send_body(self, stream_mut(stream), usize::MAX);
        if let Err(err) = self.pump_send_bodies() {
            self.fail_all(err);
        }
    }

    pub(crate) fn write_window_update(&mut self, stream_id: u32, increment: u31) {
        let bytes = increment.to_be_bytes();
        self.write_frame(FrameType::WindowUpdate, 0, stream_id, &bytes);
    }

    fn replenish_window(&mut self) {
        if self.conn_recv_window.needs_update() {
            let increment = self.conn_recv_window.take_update();
            self.write_window_update(0, increment);
        }
        // Collect (id, increment) pairs before mutating self.
        let mut updates: Vec<(u32, u32)> = Vec::new();
        for &s in self.streams.values() {
            let s = stream_mut(s);
            if !s.recv_window.needs_update() || s.remote_closed() {
                continue;
            }
            if s.client_ref()
                .is_some_and(|c| c.signals.is_receive_paused())
            {
                continue;
            }
            updates.push((s.id, s.recv_window.take_update()));
        }
        for (id, increment) in updates {
            self.write_window_update(id, increment);
        }
        // PERF: could iterate and write in one pass; profile if extra Vec matters.
    }

    pub(crate) fn flush(&mut self) -> Result<bool, Error> {
        // Captured as `bun_ptr::RawSlice` (encapsulated outlives-holder
        // invariant) so the loop can borrow `self.socket` while still
        // subslicing `write_buffer`. The buffer is not reallocated until
        // `wrote()` after the loop.
        let pending = bun_ptr::RawSlice::new(self.write_buffer.slice());
        if pending.is_empty() {
            return Ok(false);
        }
        let len = pending.len();
        let mut total: usize = 0;
        while total < len {
            let wrote = self.socket.write(&pending.slice()[total..]);
            if wrote < 0 {
                return Err(crate::Error::WriteFailed);
            }
            let n = wrote as usize;
            total += n;
            if n == 0 {
                break;
            }
        }
        self.write_buffer.wrote(total);
        if self.write_buffer.is_empty() {
            self.write_buffer.reset();
            return Ok(false);
        }
        Ok(true)
    }

    /// Parse frames into per-stream state, deliver each ready stream to its
    /// client, then pool or close if no streams remain. Structured "parse all
    /// → deliver all" because delivering may free the client.
    fn handle_data(&mut self, incoming: &[u8]) {
        self.last_read = Instant::now();
        let was_awaiting_ping_ack = self.awaiting_ping_ack;
        self.stream_progressed = false;
        if self.read_buffer.is_empty() {
            let consumed = dispatch::parse_frames(self, incoming);
            if consumed < incoming.len() && self.fatal_error.is_none() {
                self.read_buffer.extend_from_slice(&incoming[consumed..]);
            }
        } else {
            self.read_buffer.extend_from_slice(incoming);
            // `parse_frames` takes `&mut self` plus a view into
            // `self.read_buffer`, so capture the view as `bun_ptr::RawSlice`:
            // read_buffer is not reallocated during parse_frames (only
            // consumed), so the outlives-holder invariant holds for the call.
            let buf = bun_ptr::RawSlice::new(self.read_buffer.as_slice());
            let consumed = dispatch::parse_frames(self, buf.slice());
            self.read_buffer.drain_front(consumed);
        }

        if self.flush().is_err() {
            self.fatal_error = Some(crate::Error::WriteFailed);
        }

        if let Some(err) = self.fatal_error {
            return self.fail_all(err);
        }

        self.drain_pending();
        // attach()'s flush() can failAll() from inside the loop above; if so the
        // session has already torn down — bail before maybeRelease() double-derefs.
        if self.fatal_error.is_some() {
            return;
        }
        if let Err(err) = self.pump_send_bodies() {
            return self.fail_all(err);
        }

        // Deliver per-stream. Iterate by index because delivery may remove
        // entries (swapRemove keeps earlier indices stable; revisiting the
        // current index after a removal is intentional). `delivering` makes
        // adopt() park retryFromH2/doRedirect re-dispatches in pending_attach
        // so `streams` isn't mutated under this iteration.
        self.delivering = true;
        let mut i: usize = 0;
        let mut rst_any = false;
        while i < self.streams.count() {
            let stream = self.streams.values()[i];
            if self.deliver_stream(stream) {
                let s = stream_mut(stream);
                // Any detach that leaves the stream open from the server's
                // perspective (we never sent END_STREAM, *or* the server
                // never did and hasn't RST'd) must signal abandonment so the
                // server can release its concurrency slot. rst() is idempotent.
                if s.state != StreamState::Closed {
                    self.rst_stream(s, ErrorCode::CANCEL);
                    rst_any = true;
                }
                self.remove_stream(stream);
            } else {
                i += 1;
            }
        }
        self.delivering = false;
        self.replenish_window();
        if rst_any || self.write_buffer.is_not_empty() {
            let _ = self.flush();
        }
        // PING/SETTINGS-ACK alone don't reset the idle timer; only frames that
        // moved a stream (HEADERS/DATA/WINDOW_UPDATE on an active id) do. The
        // ACK of a liveness PING lifts that PING's cap.
        if self.stream_progressed || was_awaiting_ping_ack != self.awaiting_ping_ack {
            self.rearm_timeout();
        }

        // Retries/redirects that re-dispatched onto this session during the
        // loop are parked in pending_attach; attach them now that iteration
        // is finished.
        if !self.pending_attach.is_empty() {
            self.drain_pending();
            if self.fatal_error.is_some() {
                return;
            }
            if let Err(err) = self.flush() {
                return self.fail_all(err);
            }
        }

        self.maybe_release();
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

    fn handle_writable(&mut self) {
        if let Err(err) = self.pump_send_bodies() {
            return self.fail_all(err);
        }
        self.reap_aborted();
        self.rearm_timeout();
        self.maybe_release();
    }

    /// Called while the socket is parked in the pool with no clients; answers
    /// PING/SETTINGS, records GOAWAY, discards anything stream-addressed.
    pub(crate) fn on_idle_data(&mut self, incoming: &[u8]) {
        self.read_buffer.extend_from_slice(incoming);
        // See on_data note — `RawSlice` carries the outlives-holder invariant
        // (read_buffer is not reallocated during parse_frames).
        let buf = bun_ptr::RawSlice::new(self.read_buffer.as_slice());
        let consumed = dispatch::parse_frames(self, buf.slice());
        let tail = self.read_buffer.len() - consumed;
        if tail > 0 && consumed > 0 {
            self.read_buffer.copy_within(consumed.., 0);
        }
        self.read_buffer.truncate(tail);
        if self.flush().is_err() {
            self.fatal_error = Some(crate::Error::WriteFailed);
        }
    }

    /// Tear the session down once its socket is gone (or, via `fail_all`,
    /// about to be closed): leave the registry, fail every parked and attached
    /// request, and hand the socket-ext ref to the enclosing entry point for
    /// release. Runs exactly once per session: the socket is dead afterwards,
    /// so no further socket event reaches it, and every `fail_all` caller
    /// returns straight away.
    fn fail_streams(&mut self, err: Error) {
        // SAFETY: ctx back-ref is valid for the session's lifetime. This is
        // reachable synchronously from connect() → adopt() → attach() flush
        // failure → fail_all() while connect() still holds `&mut HTTPContext`,
        // so route through the raw-ptr helper instead of forming a second
        // aliased `&mut NewHTTPContext` via autoref.
        unsafe { NewHTTPContext::<true>::unregister_h2_raw(self.ctx, self) };
        for client in core::mem::take(&mut self.pending_attach) {
            pending_client_mut(client).h2_fail(err);
        }
        // `handle_data`'s deliver loop holds a stream across the callback that re-entered here.
        let deliver_loop_frees_streams = self.delivering;
        for &e in self.streams.values() {
            let client = stream_mut(e).client.take();
            if let Some(c) = client {
                stream_client_mut(c).transport = Transport::None;
            }
            if !deliver_loop_frees_streams {
                drop_stream(e);
            }
            if let Some(c) = client {
                stream_client_mut(c).h2_fail(err);
            }
        }
        if !deliver_loop_frees_streams {
            self.streams.clear_retaining_capacity();
        }
        self.give_up_socket_ref();
    }

    /// The socket-ext ref is no longer wanted; `enter` releases it once this
    /// body has returned. See `socket_ref_owed`.
    fn give_up_socket_ref(&self) {
        debug_assert!(!self.socket_ref_owed.get(), "h2 session torn down twice");
        self.socket_ref_owed.set(true);
    }

    fn fail_all(&mut self, err: Error) {
        self.fatal_error = Some(self.fatal_error.unwrap_or(err));
        let sock = self.socket;
        // RFC 9113 §5.4.1: an endpoint that encounters a connection error
        // SHOULD first send GOAWAY. Best-effort only; the socket may already
        // be dead.
        if !sock.is_closed_or_has_error() {
            let mut goaway = [0u8; 8];
            goaway[0..4].copy_from_slice(&0u32.to_be_bytes());
            goaway[4..8].copy_from_slice(&dispatch::error_code_for(err).0.to_be_bytes());
            self.write_frame(FrameType::GoAway, 0, 0, &goaway);
            let _ = self.flush();
        }
        NewHTTPContext::<true>::mark_socket_as_dead(sock);
        self.fail_streams(err);
        sock.close(bun_uws::CloseKind::Failure);
    }

    /// One request was aborted; its siblings continue. See [`Self::probe_liveness`].
    fn after_abort(&mut self, silent_since: Instant) {
        self.probe_liveness(silent_since);
        self.rearm_timeout();
        self.maybe_release();
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
        self.write_frame(FrameType::Ping, 0, 0, &[0; 8]);
        self.awaiting_ping_ack = self.flush().is_ok();
    }

    fn reap_aborted(&mut self) {
        let mut i: usize = 0;
        while i < self.streams.count() {
            let stream = self.streams.values()[i];
            let aborted = match stream_ref(stream).client_ref() {
                Some(c) => c.signals.get(signals::Field::Aborted),
                None => {
                    i += 1;
                    continue;
                }
            };
            if aborted {
                self.detach_with_failure(stream, crate::Error::Aborted);
            } else {
                i += 1;
            }
        }
    }

    /// Once the last request is gone, leave the registry and either park the
    /// connection in the keep-alive pool (which takes over the socket-ext ref)
    /// or close it and give that ref up. A connection that could be parked
    /// first waits for the ACK of its liveness PING.
    fn maybe_release(&mut self) {
        if self.streams.count() > 0 || !self.pending_attach.is_empty() {
            return;
        }
        if self.awaiting_ping_ack && self.can_pool() {
            return;
        }
        // Idempotent: a session is released exactly once. The registry index is
        // the sentinel — `registerH2` re-arms it on keep-alive resume, and any
        // path that has already unregistered (abort, a
        // `fail_all` earlier in the same entry point) leaves it at maxInt so a
        // second caller can't close the socket or give up the ref twice.
        if self.registry_index.get() == u32::MAX {
            return;
        }
        // SAFETY: ctx back-ref is valid for the session's lifetime. This path
        // is reachable re-entrantly via HTTPContext::connect() → adopt() while
        // connect() still holds `&mut HTTPContext<true>`, so we MUST NOT
        // materialise a second `&mut NewHTTPContext` from the backref —
        // unregister_h2_raw operates via raw-ptr place projection instead.
        unsafe { NewHTTPContext::<true>::unregister_h2_raw(self.ctx, self) };
        if self.can_pool() && !self.socket.is_closed_or_has_error() {
            // Pool stores the live *ClientSession so a later fetch can resume
            // the multiplexed connection; the socket ext's ref moves to it.
            // SAFETY: `self` is heap-owned and that ref is outstanding.
            let self_ref = unsafe { RefPtr::from_raw(core::ptr::from_mut(self)) };
            // ctx back-ref is valid for the session's lifetime. Unlike
            // `unregister_h2_raw` above, this branch is *not* reachable on the
            // re-entrant `connect()` → `adopt()` path: every adopt-side entry
            // into `maybe_release` has `goaway_received`, `!has_headroom()`
            // (goaway/fatal/stream-id-exhausted/unanswered PING), or `streams.count() > 0` —
            // all of which short-circuit before reaching `can_pool()`. So no
            // ancestor frame holds `&mut NewHTTPContext` here and forming one
            // from the backref is sound — route through the centralised
            // [`HTTPClient::ssl_ctx_mut`] accessor (same set-once invariant).
            HTTPClient::ssl_ctx_mut(self.ctx).release_socket(
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
                Some(self_ref),
                b"",
                self.pool,
            );
        } else {
            NewHTTPContext::<true>::close_socket(self.socket);
            self.give_up_socket_ref();
        }
    }

    /// Deliver any ready headers/body/error on `stream` to its client.
    /// Returns true when the stream is finished and should be removed.
    /// After a true return, neither `stream.client` nor the client's memory
    /// may be touched.
    fn deliver_stream(&mut self, stream_ptr: *mut Stream) -> bool {
        let stream = stream_mut(stream_ptr);
        let Some(client_ptr) = stream.client else {
            return true;
        };
        // `stream.client` is a disjoint allocation from `stream`, so this
        // `&mut HTTPClient` does not overlap the `&mut Stream` above.
        let client = stream_client_mut(client_ptr);

        if client.signals.get(signals::Field::Aborted) {
            self.rst_stream(stream, ErrorCode::CANCEL);
            let _ = self.flush();
            stream.client = None;
            client.transport = Transport::None;
            client.h2_fail(crate::Error::Aborted);
            return true;
        }

        if let Some(err) = stream.fatal_error {
            stream.client = None;
            client.transport = Transport::None;
            if stream.http1_required && stream.status_code == 0 && client.can_retry_over_http1() {
                client.retry_over_http1();
                return true;
            }
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
                client.h2_retry();
            } else {
                client.h2_fail(err);
            }
            return true;
        }

        if stream.headers_ready {
            stream.headers_ready = false;
            let (result, response) = match client
                .apply_multiplexed_headers(stream.status_code, &stream.decoded_headers)
            {
                Ok(r) => r,
                Err(err) => {
                    self.rst_stream(stream, ErrorCode::CANCEL);
                    let _ = self.flush();
                    stream.client = None;
                    client.transport = Transport::None;
                    client.h2_fail(err);
                    return true;
                }
            };
            // handleResponseMetadata set is_redirect_pending. The doRedirect
            // contract assumes the caller already detached the stream.
            // Detach + RST here unconditionally so the
            // header_progress path below can never re-enter doRedirect via
            // progressUpdate while the old Stream still points at this
            // client — that path would attach a second Stream to the same
            // HTTPClient and the first one's `stream.client` becomes a
            // dangling pointer once the request completes.
            if client.state.flags.is_redirect_pending {
                self.rst_stream(stream, ErrorCode::CANCEL);
                let _ = self.flush();
                stream.client = None;
                client.transport = Transport::None;
                client.h2_do_redirect(self.ctx, self.socket);
                return true;
            }
            // Deep-copy before detaching: `response` borrows
            // `stream.decoded_headers`.
            client.h2_clone_metadata(&response);
            // `is_done()`: Content-Length: 0 can arrive as `HasBody` (e.g. an
            // SSE content-type), which would make the headerProgress update
            // below terminal and free `client` while the stream still holds it.
            if result == HeaderResult::Finished
                || (stream.remote_closed() && stream.body_buffer.is_empty())
                || client.state.is_done()
            {
                stream.client = None;
                client.transport = Transport::None;
                client.state.flags.received_last_chunk = true;
                // .finished = HEAD/204/304: no body is expected regardless of
                // any Content-Length header, so clear it. Otherwise leave the
                // parsed value so finishStream() enforces §8.1.1 against the
                // (zero) bytes actually received.
                if result == HeaderResult::Finished {
                    client.state.content_length = Some(0);
                }
                return self.finish_stream(stream, client);
            }
            // Mirror the h1 path: deliver headers
            // to JS now so `await fetch()` resolves and `getReader()` can enable
            // response_body_streaming. Without this, a content-length response
            // buffers the entire body before the Response promise settles.
            if client.signals.get(signals::Field::HeaderProgress) {
                client.h2_progress_update(self.ctx, self.socket);
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            return false;
        }

        if !stream.body_buffer.is_empty() {
            let terminal = stream.remote_closed();
            if terminal {
                client.state.flags.received_last_chunk = true;
                stream.client = None;
                client.transport = Transport::None;
            }
            let report = match client.h2_handle_response_body(&stream.body_buffer, false) {
                Ok(r) => r,
                Err(err) => {
                    stream.body_buffer.clear();
                    self.rst_stream(stream, ErrorCode::CANCEL);
                    let _ = self.flush();
                    if !terminal {
                        stream.client = None;
                        client.transport = Transport::None;
                    }
                    client.h2_fail(err);
                    return true;
                }
            };
            stream.body_buffer.clear();
            if terminal {
                return self.finish_stream(stream, client);
            }
            if report {
                // handleResponseBody may report completion before END_STREAM
                // (Content-Length satisfied). The terminal progressUpdate
                // path frees the AsyncHTTP that owns `client`, so detach
                // first; the trailing END_STREAM/trailers land on a stream
                // we no longer track and are discarded.
                if client.state.is_done() {
                    stream.client = None;
                    client.transport = Transport::None;
                    client.h2_progress_update(self.ctx, self.socket);
                    return true;
                }
                client.h2_progress_update(self.ctx, self.socket);
            }
            return false;
        }

        if stream.remote_closed() {
            stream.client = None;
            client.transport = Transport::None;
            if let Err(err) = client.state.finalize_body_on_eof() {
                client.h2_fail(err);
                return true;
            }
            return self.finish_stream(stream, client);
        }

        false
    }

    /// Terminal delivery: enforce the announced Content-Length (RFC 9113
    /// §8.1.1 — mismatch is malformed) and hand off to progressUpdate.
    /// `total_body_received` is clamped at content_length by the body handler,
    /// so compare the raw DATA byte count instead — that catches overshoot too.
    fn finish_stream(&mut self, stream: &mut Stream, client: &mut HTTPClient) -> bool {
        if let Some(cl) = client.state.content_length {
            if stream.data_bytes_received != cl as u64 {
                client.h2_fail(crate::Error::HTTP2ContentLengthMismatch);
                return true;
            }
        }
        client.h2_progress_update(self.ctx, self.socket);
        true
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        super::live_sessions.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(self.registry_index.get() == u32::MAX);
        // hpack: HpackHandle drops automatically (lshpack_wrapper_deinit).
        // write_buffer / read_buffer / pending_attach / header_block /
        // encode_scratch / hostname / ssl_config are dropped automatically.
        for &e in self.streams.values() {
            drop_stream(e);
        }
        // streams map storage drops automatically.
        // bun.destroy(this) — handled by heap::take in `deref`.
    }
}
