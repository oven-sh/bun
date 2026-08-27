//! One TCP+TLS connection running the HTTP/2 protocol for `fetch()`. Owns the
//! socket, the connection-scoped HPACK tables, and a map of active `Stream`s.
//!
//! Every piece of state is individually interior-mutable and every method
//! takes `&self`: frame handling re-enters requests, and requests re-enter
//! sessions (a redirect or retry re-dispatching onto this very connection),
//! so no caller can hold the session exclusively.

use core::cell::{Cell, RefCell};
use core::sync::atomic::Ordering;
use std::rc::Rc;

use crate::Error;
use bun_collections::{ArrayHashMap, VecExt};
use bun_core::strings;
use bun_ptr::{RefPtr, SelfRoot};

use super::stream::{State as StreamState, Stream};
use super::{dispatch, encode};
use crate::h2_frame_parser as wire;
use crate::http_context::{HTTPSocket, PeerVerification};
use crate::http_request_body::Body;
use crate::internal_state::HTTPStage;
use crate::lshpack;
use crate::signals;
use crate::ssl_config;
use crate::{
    CtxRef, HTTPClient, HTTPVerboseLevel, HeaderResult, NewHTTPContext, Protocol, RequestRef,
};

/// HTTP/2 only ever runs over TLS in this client (ALPN "h2").
pub type Socket = HTTPSocket<true>;

const LOCAL_INITIAL_WINDOW_SIZE: u32 = super::LOCAL_INITIAL_WINDOW_SIZE;

// 31-/24-bit wire fields stored as u32; range asserts at use sites.
#[allow(non_camel_case_types)]
type u31 = u32;
#[allow(non_camel_case_types)]
type u24 = u32;

#[derive(bun_ptr::CellRefCounted)]
pub struct ClientSession {
    /// Ref holders: the socket-ext tag while the session is the ActiveSocket
    /// (`socket_ref`), the context's active_h2_sessions registry while listed,
    /// and the keep-alive pool while parked. Hand-offs between socket and
    /// pool move `socket_ref` rather than touching the count.
    pub(crate) ref_count: Cell<u32>,
    self_root: SelfRoot<ClientSession>,
    /// The socket tag's reference while this session is the socket's
    /// `ActiveSocket`.
    socket_ref: Cell<Option<RefPtr<ClientSession>>>,
    /// Set when a body has torn the session down (`fail_streams`, or
    /// `maybe_release` closing an unpoolable socket) and the socket tag's
    /// reference is therefore due to be released. The body cannot release it
    /// itself: at that point it is normally the last one, and freeing the
    /// session while a `&self` argument to it is live is undefined behaviour
    /// even if the reference is never used again. The [`SessionPtr`] entry
    /// point that ran the body releases it once the borrow has ended (see
    /// [`ClientSession::enter`]).
    released_ref: Cell<Option<RefPtr<ClientSession>>>,

    pub(crate) hpack: RefCell<lshpack::HpackHandle>,
    pub(crate) socket: Cell<Socket>,
    /// The context that registers this session; it outlives every session on
    /// its sockets.
    pub(crate) ctx: CtxRef<true>,

    /// Pool key. Owned copy so the session can outlive the originating client.
    pub(crate) hostname: Box<[u8]>,
    pub(crate) port: u16,
    pub(crate) ssl_config: Option<ssl_config::SharedPtr>,
    pub(crate) did_have_handshaking_error: bool,
    /// How the TLS peer was authenticated; carried into the keepalive pool and
    /// checked by the coalescing path so a caller only multiplexes onto a
    /// session verified the way it would verify a fresh one.
    pub(crate) verification: PeerVerification,

    /// Queued bytes for the socket; whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    pub(crate) write_buffer: RefCell<bun_io::StreamBuffer>,

    /// Inbound bytes until a full 9-byte header + declared payload is
    /// available, so frame handlers always see complete frames.
    pub(crate) read_buffer: RefCell<Vec<u8>>,

    pub(crate) streams: RefCell<ArrayHashMap<u31, Rc<Stream>>>,
    /// Secondary index over `streams` keyed by the owning client's
    /// `async_http_id`, so the per-chunk wakeups from the JS thread
    /// (`stream_body_by_http_id` / `resume_receive_by_http_id` /
    /// `drain_response_body_by_http_id` / `abort_by_http_id`) resolve in O(1)
    /// instead of scanning every live stream on the session.
    pub(crate) by_http_id: RefCell<ArrayHashMap<u32, Rc<Stream>>>,
    pub(crate) next_stream_id: Cell<u31>,
    /// Stream id whose CONTINUATION sequence is in progress; 0 = none.
    pub(crate) expecting_continuation: Cell<u31>,
    /// CONTINUATION frames seen so far in the current header block.
    pub(crate) continuation_count: Cell<u8>,

    /// Cold-start coalesced requests parked until the server's first SETTINGS
    /// frame arrives so the real MAX_CONCURRENT_STREAMS cap can be honoured.
    /// Each unparks (or is failed) before its terminal callback.
    pub(crate) pending_attach: RefCell<Vec<RequestRef>>,

    pub(crate) preface_sent: Cell<bool>,
    pub(crate) settings_received: Cell<bool>,
    pub(crate) goaway_received: Cell<bool>,
    /// Set when the HPACK encoder's dynamic table has diverged from the
    /// server's view (writeRequest failed mid-encode). Existing siblings whose
    /// HEADERS already went out are unaffected, but no new stream may be
    /// opened on this connection.
    pub(crate) encoder_poisoned: Cell<bool>,
    /// True while onData's deliver loop is running. retryFromH2/doRedirect
    /// re-dispatch may try to adopt back onto this same session; blocking
    /// that during delivery prevents `streams` mutation under iteration and
    /// the failAll → onClose → double-free path.
    pub(crate) delivering: Cell<bool>,
    /// Set by `dispatchFrame` when the inbound batch carried a frame that
    /// advanced an active stream (HEADERS/DATA/WINDOW_UPDATE on a tracked id).
    /// `onData` only re-arms the idle timer when this is true so a server
    /// can't keep a stalled upload alive forever with bare PINGs.
    pub(crate) stream_progressed: Cell<bool>,
    pub(crate) goaway_last_stream_id: Cell<u31>,
    pub(crate) fatal_error: Cell<Option<Error>>,
    /// HEADERS/CONTINUATION fragments for a stream we no longer track (e.g.
    /// in flight when we RST'd it). RFC 9113 §4.3 still requires the block be
    /// fed to the HPACK decoder so the connection-level dynamic table stays
    /// in sync.
    pub(crate) orphan_header_block: RefCell<Vec<u8>>,
    /// Reused HPACK-encode scratch for `writeRequest` so each request doesn't
    /// alloc/free its own header-block buffer.
    pub(crate) encode_scratch: RefCell<Vec<u8>>,

    pub(crate) remote_max_frame_size: Cell<u24>,
    pub(crate) remote_max_concurrent_streams: Cell<u32>,
    pub(crate) remote_initial_window_size: Cell<u32>,
    /// SETTINGS_HEADER_TABLE_SIZE received from the peer that hasn't yet been
    /// acknowledged with a Dynamic Table Size Update (RFC 7541 §6.3) at the
    /// start of a header block. lshpack's encoder doesn't emit that opcode
    /// itself, so writeRequest must prepend it before the first encode call.
    pub(crate) pending_hpack_enc_capacity: Cell<Option<u32>>,
    /// Connection-level send window. Starts at the spec default regardless of
    /// SETTINGS; only WINDOW_UPDATE on stream 0 grows it.
    pub(crate) conn_send_window: Cell<i32>,

    /// DATA bytes consumed since the last connection-level WINDOW_UPDATE.
    pub(crate) conn_unacked_bytes: Cell<u32>,

    /// Index in the context's active-session list while reachable for
    /// concurrent attachment; maxInt when not listed.
    pub(crate) registry_index: Cell<u32>,
}

/// A live session as its holders point at it: the socket ext slot, the
/// context's registry, the keep-alive pool, or the pointer `create` returned.
///
/// Every `pub(crate)` entry point that can leave the session released (socket
/// events, the registry / pool hand-offs in `HTTPContext::connect`, the
/// per-request wakeups from `HTTPThread`) takes one of these and goes through
/// [`ClientSession::enter`], so the releases happen through the holder's
/// pointer after the body's borrow has ended. Callers that need the session
/// alive across two entry points hold a `ref_guard()` of their own across
/// both.
pub(crate) type SessionPtr = bun_ptr::ThisPtr<ClientSession>;

impl ClientSession {
    #[inline]
    pub(crate) fn this_ptr(&self) -> SessionPtr {
        self.self_root.this_ptr(self)
    }

    /// Run `body` on the session behind `this`, then perform the release it
    /// asked for.
    ///
    /// The guard keeps the session alive while the body re-enters clients
    /// (delivering bodies, failing requests) and releases the registry ref, so
    /// no release inside the body is ever the last one. Only once `body` has
    /// returned is the socket tag's reference it may have given up
    /// (`released_ref`) released, followed by the guard's own, both through
    /// `this`. When the body tore the session down that second release frees
    /// it, with no reference to it live anywhere.
    fn enter(this: SessionPtr, body: impl FnOnce(&ClientSession)) {
        let _keep_alive = RefPtr::from_this(this);
        body(&this);
        drop(this.released_ref.take());
    }

    /// Socket onData entry point; see [`Self::handle_data`].
    pub(crate) fn on_data(this: SessionPtr, incoming: &[u8]) {
        Self::enter(this, |s| s.handle_data(incoming));
    }

    /// Socket onWritable entry point; see [`Self::handle_writable`].
    pub(crate) fn on_writable(this: SessionPtr) {
        Self::enter(this, |s| s.handle_writable());
    }

    /// Socket onClose / onTimeout entry point. The socket is already gone, so
    /// every stream fails and the socket tag's ref is released; unless a
    /// caller holds its own guard, the session is freed before this returns.
    pub(crate) fn on_close(this: SessionPtr, err: Error) {
        Self::enter(this, |s| s.fail_streams(err));
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

    /// Called from the HTTP thread's shutdown queue when a fetch on this
    /// session is aborted; see [`Self::abort_request`].
    pub(crate) fn abort_by_http_id(this: SessionPtr, async_http_id: u32) {
        Self::enter(this, |s| s.abort_request(async_http_id));
    }

    /// HTTP-thread wake-up from `scheduleRequestWrite`; see
    /// [`Self::stream_request_body`].
    pub(crate) fn stream_body_by_http_id(this: SessionPtr, async_http_id: u32, ended: bool) {
        Self::enter(this, |s| s.stream_request_body(async_http_id, ended));
    }

    /// HTTP-thread wake-up from `resumeReceive`; see [`Self::resume_receive`].
    pub(crate) fn resume_receive_by_http_id(this: SessionPtr, async_http_id: u32) {
        Self::enter(this, |s| s.resume_receive(async_http_id));
    }

    /// HTTP-thread wake-up from `scheduleResponseBodyDrain`; see
    /// [`Self::drain_response_body`].
    pub(crate) fn drain_response_body_by_http_id(this: SessionPtr, async_http_id: u32) {
        Self::enter(this, |s| s.drain_response_body(async_http_id));
    }

    /// A session coming back from the keep-alive pool onto `socket` for
    /// `client`: the pool's reference becomes the socket tag's again.
    pub(crate) fn resume_from_pool(
        session: RefPtr<ClientSession>,
        socket: Socket,
        ctx: &NewHTTPContext<true>,
        client: &mut HTTPClient,
    ) {
        session.socket.set(socket);
        NewHTTPContext::<true>::tag_as_h2(socket, &session);
        ctx.register_h2(&session);
        let this = session.this_ptr();
        this.socket_ref.set(Some(session));
        Self::adopt(this, client);
    }

    #[inline]
    pub(crate) fn registry_index(&self) -> u32 {
        self.registry_index.get()
    }
    #[inline]
    pub(crate) fn set_registry_index(&self, i: u32) {
        self.registry_index.set(i);
    }

    #[inline]
    fn set_fatal(&self, err: Error) {
        self.fatal_error.set(Some(err));
    }

    /// Send RST_STREAM for `stream` and mark it closed.
    pub(crate) fn rst_stream(&self, stream: &Stream, code: wire::ErrorCode) {
        if stream.rst_done.get() || stream.state.get() == StreamState::Closed {
            return;
        }
        stream.rst_done.set(true);
        stream.state.set(StreamState::Closed);
        let value: [u8; 4] = code.0.to_be_bytes();
        self.write_frame(wire::FrameType::HTTP_FRAME_RST_STREAM, 0, stream.id, &value);
    }

    /// Allocate a session for a socket whose ALPN just selected h2, tag the
    /// socket with it (the tag holds the session's first reference) and list
    /// it in the context's registry. The caller then opens the leader's stream
    /// with [`Self::attach_leader`].
    pub(crate) fn create(ctx: CtxRef<true>, socket: Socket, client: &HTTPClient) -> SessionPtr {
        let session = RefPtr::new_cyclic(|self_root| ClientSession {
            ref_count: Cell::new(1),
            self_root,
            socket_ref: Cell::new(None),
            released_ref: Cell::new(None),
            hpack: RefCell::new(lshpack::HpackHandle::new(4096)),
            socket: Cell::new(socket),
            ctx,
            hostname: Box::<[u8]>::from(client.connected_hostname.as_slice()),
            port: client.connected_port,
            ssl_config: client.tls_props.clone(),
            did_have_handshaking_error: client.flags.did_have_handshaking_error,
            verification: client.socket_verification(),
            write_buffer: RefCell::new(bun_io::StreamBuffer::default()),
            read_buffer: RefCell::new(Vec::new()),
            streams: RefCell::new(ArrayHashMap::default()),
            by_http_id: RefCell::new(ArrayHashMap::default()),
            next_stream_id: Cell::new(1),
            expecting_continuation: Cell::new(0),
            continuation_count: Cell::new(0),
            pending_attach: RefCell::new(Vec::new()),
            preface_sent: Cell::new(false),
            settings_received: Cell::new(false),
            goaway_received: Cell::new(false),
            encoder_poisoned: Cell::new(false),
            delivering: Cell::new(false),
            stream_progressed: Cell::new(false),
            goaway_last_stream_id: Cell::new(0),
            fatal_error: Cell::new(None),
            orphan_header_block: RefCell::new(Vec::new()),
            encode_scratch: RefCell::new(Vec::new()),
            remote_max_frame_size: Cell::new(wire::DEFAULT_MAX_FRAME_SIZE),
            remote_max_concurrent_streams: Cell::new(100),
            remote_initial_window_size: Cell::new(wire::DEFAULT_WINDOW_SIZE),
            pending_hpack_enc_capacity: Cell::new(None),
            conn_send_window: Cell::new(wire::DEFAULT_WINDOW_SIZE as i32),
            conn_unacked_bytes: Cell::new(0),
            registry_index: Cell::new(u32::MAX),
        });
        super::live_sessions.fetch_add(1, Ordering::Relaxed);
        NewHTTPContext::<true>::tag_as_h2(socket, &session);
        ctx.register_h2(&session);
        let this = session.this_ptr();
        this.socket_ref.set(Some(session));
        this
    }

    pub(crate) fn has_headroom(&self) -> bool {
        !self.goaway_received.get()
            && !self.encoder_poisoned.get()
            && self.fatal_error.get().is_none()
            && self.streams.borrow().count() < self.remote_max_concurrent_streams.get() as usize
            && self.next_stream_id.get() < wire::MAX_STREAM_ID
    }

    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<*const ssl_config::SSLConfig>,
    ) -> bool {
        let mine: Option<*const ssl_config::SSLConfig> = self
            .ssl_config
            .as_ref()
            .map(|p| std::ptr::from_ref(p.get()));
        self.port == port && mine == ssl_config && strings::eql_long(&self.hostname, hostname, true)
    }

    fn adopt_client(&self, client: &mut HTTPClient) {
        client.h2_register_abort_tracker(self.socket.get());
        // Park instead of attaching when (a) we're inside onData's deliver
        // loop — attach() mustn't mutate `streams` under iteration — or (b)
        // the server's first SETTINGS hasn't arrived yet, so the real
        // MAX_CONCURRENT_STREAMS isn't known and a non-replayable body
        // shouldn't risk a REFUSED_STREAM. The leader bypasses adopt() and
        // attaches directly so the preface still goes out.
        if self.delivering.get() || !self.settings_received.get() {
            self.pending_attach.borrow_mut().push(client.req());
            self.rearm_timeout(Some(client));
            return;
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
        // If attach() poisoned the encoder and left the session empty, release
        // it now — adopt() callers (keep-alive resume, active-session match)
        // have no tail maybeRelease of their own.
        if self.encoder_poisoned.get() {
            self.maybe_release();
        }
    }

    /// Park a request that was coalesced onto this session's connect until the
    /// server's SETTINGS arrive; see [`Self::park`].
    pub(crate) fn enqueue(this: SessionPtr, client: &mut HTTPClient) {
        Self::enter(this, |s| s.park(client));
    }

    /// Park a coalesced request until the server's SETTINGS arrive. Abort
    /// is routed via the session socket so `abortByHttpId` can find it.
    fn park(&self, client: &mut HTTPClient) {
        client.h2_register_abort_tracker(self.socket.get());
        self.pending_attach.borrow_mut().push(client.req());
        self.rearm_timeout(Some(client));
    }

    fn take_pending_attach(&self) -> Vec<RequestRef> {
        core::mem::take(&mut *self.pending_attach.borrow_mut())
    }

    fn drain_pending(&self) {
        if !self.settings_received.get() || self.pending_attach.borrow().is_empty() {
            return;
        }
        for waiter in self.take_pending_attach() {
            let mut client = waiter.client();
            if let Some(err) = self.fatal_error.get() {
                client.h2_fail(err);
            } else if client.signals.get(signals::Field::Aborted) {
                client.h2_fail(crate::Error::Aborted);
            } else if self.has_headroom() {
                self.attach(&mut client);
            } else {
                client.h2_retry_after_coalesce();
            }
        }
    }

    /// True when the connection can be parked in the keep-alive pool: no
    /// active streams, no GOAWAY/error, and no leftover bytes that would
    /// confuse the next request.
    pub(crate) fn can_pool(&self) -> bool {
        self.streams.borrow().count() == 0
            && !self.goaway_received.get()
            && !self.encoder_poisoned.get()
            && self.fatal_error.get().is_none()
            && self.expecting_continuation.get() == 0
            && self.read_buffer.borrow().is_empty()
            && self.write_buffer.borrow().is_empty()
            && self.remote_max_concurrent_streams.get() > 0
            && self.next_stream_id.get() < wire::MAX_STREAM_ID
    }

    #[inline]
    pub(crate) fn queue(&self, bytes: &[u8]) {
        let _ = self.write_buffer.borrow_mut().write(bytes);
    }

    #[inline]
    pub(crate) fn write_buffer_size(&self) -> usize {
        self.write_buffer.borrow().size()
    }

    pub(crate) fn write_frame(
        &self,
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
        let mut write_buffer = self.write_buffer.borrow_mut();
        let _ = write_buffer.write(&header);
        let _ = write_buffer.write(payload);
    }

    pub(crate) fn stream(&self, id: u31) -> Option<Rc<Stream>> {
        self.streams.borrow().get(&id).cloned()
    }

    /// Allocate a stream for `client`, serialise its request as HEADERS +
    /// DATA, and flush.
    fn attach(&self, client: &mut HTTPClient) {
        debug_assert!(self.has_headroom());

        let send_window = i32::try_from(
            self.remote_initial_window_size
                .get()
                .min(wire::MAX_WINDOW_SIZE),
        )
        .expect("int cast");
        // Only clients with an abort-signal store are ever looked up by id
        // (the HTTP-thread wake paths key off `abort_tracker()`); mirror that
        // gate so unsignaled callers sharing the `0` sentinel never collide.
        let async_http_id = client
            .signals
            .aborted
            .is_some()
            .then_some(client.async_http_id);
        let stream = Rc::new(Stream::new(
            self.next_stream_id.get(),
            async_http_id,
            Some(client.req()),
            send_window,
        ));
        self.next_stream_id
            .set(self.next_stream_id.get().saturating_add(2));
        let _ = self.streams.borrow_mut().put(stream.id, Rc::clone(&stream));
        if let Some(id) = async_http_id {
            let _ = self.by_http_id.borrow_mut().put(id, Rc::clone(&stream));
        }
        client.h2_attached = true;
        client.flags.protocol = Protocol::Http2;
        client.allow_retry = false;

        if !self.preface_sent.get() {
            encode::write_preface(self);
        }

        self.rearm_timeout(Some(client));
        // DATA-frame encoding may yield mid-body — compress into the Vec so the
        // cursor stays valid across event-loop ticks.
        if let Err(e) = client.compress_body_for_send(false) {
            // Nothing was encoded, so the session stays usable; the preface
            // (if this was the first stream) still has to go out.
            self.remove_stream(&stream);
            client.h2_attached = false;
            let _ = self.flush();
            client.h2_fail(e);
            return;
        }
        {
            let thread = client.thread();
            let mut request_headers = thread.request_headers_buf.borrow_mut();
            let header_count =
                client.build_request(client.body_len_for_send(), &mut request_headers);
            // `client.url` is not touched again until the request is out.
            let path = bun_ptr::RawSlice::new(client.url.pathname());
            let request = bun_picohttp::Request {
                method: client.method.as_str().as_bytes(),
                path: path.slice(),
                minor_version: 1,
                headers: &request_headers[..header_count],
                bytes_read: 0,
            };
            if let Err(err) = encode::write_request(self, client, &stream, &request) {
                drop(request_headers);
                // encodeHeader pushes into the HPACK encoder's dynamic table per
                // call, so a mid-encode failure leaves entries the server will
                // never see. Mark the session unusable for future streams and
                // remove without RST — from the server's view this stream id was
                // never opened (RST on an idle stream is a connection error per
                // RFC 9113 §5.1).
                self.encoder_poisoned.set(true);
                self.remove_stream(&stream);
                client.h2_attached = false;
                client.h2_fail(err);
                // The poisoned session is dead for new work; bounce any waiters
                // and let maybeRelease() drop the registration so the next fetch
                // opens a fresh connection instead of waiting for idle-timeout.
                for waiter in self.take_pending_attach() {
                    waiter.client().h2_retry_after_coalesce();
                }
                let _ = self.flush();
                // Do NOT maybeRelease() here: attach() runs from drainPending()
                // inside onData (whose tail maybeRelease handles cleanup) and from
                // adopt() (which calls maybeRelease itself when this leaves the
                // session empty).
                return;
            }
            if client.verbose != HTTPVerboseLevel::None {
                crate::print_request(
                    Protocol::Http2,
                    &request,
                    client.url.href(),
                    !client.flags.reject_unauthorized,
                    client.state.request_body.slice(),
                    client.verbose == HTTPVerboseLevel::Curl,
                );
            }
        }
        client.state.request_stage = if stream.local_closed() {
            HTTPStage::Done
        } else {
            HTTPStage::Body
        };
        client.state.response_stage = HTTPStage::Headers;

        if let Err(err) = self.pump_send_bodies() {
            // `client` is busy here, so fail it directly rather than through
            // its stream's back-reference.
            stream.client.set(None);
            client.h2_attached = false;
            self.fail_all(err);
            client.h2_fail(err);
            return;
        }

        if client.flags.is_streaming_request_body {
            client.h2_progress_update(self.ctx, self.socket.get());
        }
    }

    /// Unlink `stream` from the session map. If the stream was
    /// mid-CONTINUATION (HEADERS arrived without END_HEADERS), the buffered
    /// fragment is moved to `orphan_header_block` so the trailing CONTINUATION
    /// frames decode against the full block — otherwise HPACK-decoding the
    /// suffix alone desyncs the dynamic table for every sibling stream.
    fn remove_stream(&self, stream: &Stream) {
        if self.expecting_continuation.get() == stream.id {
            *self.orphan_header_block.borrow_mut() =
                core::mem::take(&mut *stream.header_block.borrow_mut());
        }
        if let Some(id) = stream.async_http_id {
            self.by_http_id.borrow_mut().swap_remove(&id);
        }
        self.streams.borrow_mut().swap_remove(&stream.id);
    }

    /// Remove `stream` from the session, RST it, and fail its client. The
    /// session and socket stay up for siblings.
    pub(crate) fn detach_with_failure(&self, stream: &Rc<Stream>, err: Error) {
        self.rst_stream(stream, wire::ErrorCode::CANCEL);
        let _ = self.flush();
        let client = stream.client.take();
        if let Some(req) = client {
            req.client().h2_attached = false;
        }
        self.remove_stream(stream);
        if let Some(req) = client {
            req.client().h2_fail(err);
        }
    }

    /// Re-arm the shared socket's idle timer based on the aggregate of every
    /// attached client. With multiplexed streams the per-request
    /// `disable_timeout` flag can't drive the socket directly (last writer
    /// would win and a `{timeout:false}` long-poll could be killed by a
    /// sibling re-arming, or strip the safety net from one that wants it),
    /// so the session disarms only when *every* attached client opted out.
    /// `busy` is the client the caller is in the middle of working on, if
    /// any (its cell cannot be borrowed again).
    fn rearm_timeout(&self, busy: Option<&HTTPClient>) {
        // The socket is shared by every stream on the session, so arm the
        // longest effective idle timeout among them (0 = every client's
        // effective deadline is "none", or no clients are attached).
        let mut want: core::ffi::c_uint = 0;
        let mut any_unbounded = false;
        let mut fold = |eff: core::ffi::c_uint| {
            any_unbounded |= eff == 0;
            want = want.max(eff);
        };
        let timeout_of = |req: RequestRef| match req.try_client() {
            Some(client) => Some(client.effective_idle_timeout_seconds()),
            None => busy.map(|c| c.effective_idle_timeout_seconds()),
        };
        for s in self.streams.borrow().values() {
            if let Some(eff) = s.client.get().and_then(timeout_of) {
                fold(eff);
            }
        }
        for &req in self.pending_attach.borrow().iter() {
            if let Some(eff) = timeout_of(req) {
                fold(eff);
            }
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
        self.socket.get().set_timeout(want);
    }

    /// O(1) lookup in the `by_http_id` secondary index.
    #[inline]
    fn stream_for_http_id(&self, async_http_id: u32) -> Option<Rc<Stream>> {
        self.by_http_id.borrow().get(&async_http_id).cloned()
    }

    /// JS just enabled `response_body_streaming` on the request, so flush any
    /// body bytes that arrived between metadata delivery and `getReader()`.
    fn drain_response_body(&self, async_http_id: u32) {
        let Some(stream) = self.stream_for_http_id(async_http_id) else {
            return;
        };
        if let Some(req) = stream.client.get() {
            req.client().h2_drain_response_body(self.socket.get());
        }
    }

    fn resume_receive(&self, async_http_id: u32) {
        if self.stream_for_http_id(async_http_id).is_none() {
            return;
        }
        self.replenish_window();
        if self.write_buffer.borrow().is_not_empty() {
            if let Err(err) = self.flush() {
                self.fail_all(err);
            }
        }
    }

    /// New request body bytes (or end-of-body) are available in the request's
    /// ThreadSafeStreamBuffer.
    fn stream_request_body(&self, async_http_id: u32, ended: bool) {
        let Some(stream) = self.stream_for_http_id(async_http_id) else {
            return;
        };
        {
            let Some(req) = stream.client.get() else {
                return;
            };
            let mut client = req.client();
            let Body::Stream(ref mut st) = client.state.original_request_body else {
                return;
            };
            st.ended = ended;
        }
        self.rearm_timeout(None);
        encode::drain_send_body(self, &stream, usize::MAX);
        if let Err(err) = self.pump_send_bodies() {
            self.fail_all(err);
        }
    }

    pub(crate) fn write_window_update(&self, stream_id: u32, increment: u31) {
        let bytes = increment.to_be_bytes();
        self.write_frame(
            wire::FrameType::HTTP_FRAME_WINDOW_UPDATE,
            0,
            stream_id,
            &bytes,
        );
    }

    fn replenish_window(&self) {
        let threshold = LOCAL_INITIAL_WINDOW_SIZE / 2;
        if self.conn_unacked_bytes.get() >= threshold {
            self.write_window_update(0, self.conn_unacked_bytes.get());
            self.conn_unacked_bytes.set(0);
        }
        for s in self.streams.borrow().values() {
            if s.unacked_bytes.get() < threshold || s.remote_closed() {
                continue;
            }
            if s.client
                .get()
                .is_some_and(|req| req.signals().is_receive_paused())
            {
                continue;
            }
            self.write_window_update(s.id, s.unacked_bytes.get());
            s.unacked_bytes.set(0);
        }
    }

    pub(crate) fn flush(&self) -> Result<bool, Error> {
        let mut write_buffer = self.write_buffer.borrow_mut();
        let pending = write_buffer.slice();
        if pending.is_empty() {
            return Ok(false);
        }
        let socket = self.socket.get();
        let len = pending.len();
        let mut total: usize = 0;
        while total < len {
            let wrote = socket.write(&pending[total..]);
            if wrote < 0 {
                return Err(crate::Error::WriteFailed);
            }
            let n = wrote as usize;
            total += n;
            if n == 0 {
                break;
            }
        }
        write_buffer.wrote(total);
        if write_buffer.is_empty() {
            write_buffer.reset();
            return Ok(false);
        }
        Ok(true)
    }

    /// Parse frames into per-stream state, deliver each ready stream to its
    /// client, then pool or close if no streams remain. Structured "parse all
    /// → deliver all" because delivering may finish the client.
    fn handle_data(&self, incoming: &[u8]) {
        self.stream_progressed.set(false);
        if self.read_buffer.borrow().is_empty() {
            let consumed = dispatch::parse_frames(self, incoming);
            if consumed < incoming.len() && self.fatal_error.get().is_none() {
                self.read_buffer
                    .borrow_mut()
                    .extend_from_slice(&incoming[consumed..]);
            }
        } else {
            let mut read_buffer = self.read_buffer.borrow_mut();
            read_buffer.extend_from_slice(incoming);
            // No frame handler touches `read_buffer`.
            let consumed = dispatch::parse_frames(self, &read_buffer);
            read_buffer.drain_front(consumed);
        }

        if self.flush().is_err() {
            self.set_fatal(crate::Error::WriteFailed);
        }

        if let Some(err) = self.fatal_error.get() {
            return self.fail_all(err);
        }

        self.drain_pending();
        // attach()'s flush() can failAll() from inside the loop above; if so the
        // session has already torn down — nothing more to do here.
        if self.fatal_error.get().is_some() {
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
        self.delivering.set(true);
        let mut i: usize = 0;
        let mut rst_any = false;
        loop {
            let Some(stream) = self.streams.borrow().values().get(i).cloned() else {
                break;
            };
            if self.deliver_stream(&stream) {
                // Any detach that leaves the stream open from the server's
                // perspective (we never sent END_STREAM, *or* the server
                // never did and hasn't RST'd) must signal abandonment so the
                // server can release its concurrency slot. rst() is idempotent.
                if stream.state.get() != StreamState::Closed {
                    self.rst_stream(&stream, wire::ErrorCode::CANCEL);
                    rst_any = true;
                }
                self.remove_stream(&stream);
            } else {
                i += 1;
            }
        }
        self.delivering.set(false);
        self.replenish_window();
        if rst_any || self.write_buffer.borrow().is_not_empty() {
            let _ = self.flush();
        }
        // PING/SETTINGS-ACK alone don't reset the idle timer; only frames that
        // moved a stream (HEADERS/DATA/WINDOW_UPDATE on an active id) do.
        if self.stream_progressed.get() {
            self.rearm_timeout(None);
        }

        // Retries/redirects that re-dispatched onto this session during the
        // loop are parked in pending_attach; attach them now that iteration
        // is finished.
        if !self.pending_attach.borrow().is_empty() {
            self.drain_pending();
            if self.fatal_error.get().is_some() {
                return;
            }
            if let Err(err) = self.flush() {
                return self.fail_all(err);
            }
        }

        self.maybe_release();
    }

    /// Drain and flush until backpressure or nothing is left: a full flush raises no onWritable.
    fn pump_send_bodies(&self) -> Result<(), Error> {
        loop {
            let more = encode::drain_send_bodies(self);
            let backpressured = self.flush()?;
            if !more || backpressured {
                return Ok(());
            }
        }
    }

    fn handle_writable(&self) {
        if let Err(err) = self.pump_send_bodies() {
            return self.fail_all(err);
        }
        self.reap_aborted();
        self.rearm_timeout(None);
        self.maybe_release();
    }

    /// Called while the socket is parked in the pool with no clients; answers
    /// PING/SETTINGS, records GOAWAY, discards anything stream-addressed.
    pub(crate) fn on_idle_data(&self, incoming: &[u8]) {
        {
            let mut read_buffer = self.read_buffer.borrow_mut();
            read_buffer.extend_from_slice(incoming);
            let consumed = dispatch::parse_frames(self, &read_buffer);
            let tail = read_buffer.len() - consumed;
            if tail > 0 && consumed > 0 {
                read_buffer.copy_within(consumed.., 0);
            }
            read_buffer.truncate(tail);
        }
        if self.flush().is_err() {
            self.set_fatal(crate::Error::WriteFailed);
        }
    }

    /// Tear the session down once its socket is gone (or, via `fail_all`,
    /// about to be closed): leave the registry, fail every parked and attached
    /// request, and hand the socket tag's ref to the enclosing entry point for
    /// release. Runs exactly once per session: the socket is dead afterwards,
    /// so no further socket event reaches it, and every `fail_all` caller
    /// returns straight away.
    fn fail_streams(&self, err: Error) {
        self.ctx.unregister_h2(self);
        for waiter in self.take_pending_attach() {
            waiter.client().h2_fail(err);
        }
        let streams: Vec<Rc<Stream>> = {
            let mut map = self.streams.borrow_mut();
            let list = map.values().to_vec();
            map.clear_retaining_capacity();
            list
        };
        self.by_http_id.borrow_mut().clear_retaining_capacity();
        for stream in streams {
            let client = stream.client.take();
            if let Some(req) = client {
                req.client().h2_attached = false;
            }
            drop(stream);
            if let Some(req) = client {
                req.client().h2_fail(err);
            }
        }
        self.give_up_socket_ref();
    }

    /// The socket tag's ref is no longer wanted; `enter` releases it once this
    /// body has returned. See `released_ref`.
    fn give_up_socket_ref(&self) {
        if let Some(socket_ref) = self.socket_ref.take() {
            let parked = self.released_ref.replace(Some(socket_ref));
            debug_assert!(parked.is_none(), "h2 session torn down twice");
        } else {
            debug_assert!(false, "h2 session torn down twice");
        }
    }

    fn fail_all(&self, err: Error) {
        let err = self.fatal_error.get().unwrap_or(err);
        self.set_fatal(err);
        let sock = self.socket.get();
        // RFC 9113 §5.4.1: an endpoint that encounters a connection error
        // SHOULD first send GOAWAY. Best-effort only; the socket may already
        // be dead.
        if !sock.is_closed_or_has_error() {
            let mut goaway = [0u8; 8];
            goaway[0..4].copy_from_slice(&0u32.to_be_bytes());
            goaway[4..8].copy_from_slice(&dispatch::error_code_for(err).0.to_be_bytes());
            self.write_frame(wire::FrameType::HTTP_FRAME_GOAWAY, 0, 0, &goaway);
            let _ = self.flush();
        }
        NewHTTPContext::<true>::mark_socket_as_dead(sock);
        self.fail_streams(err);
        sock.close(bun_uws::CloseKind::Failure);
    }

    /// RST_STREAMs (or unparks and fails) the one aborted request; siblings
    /// continue.
    fn abort_request(&self, async_http_id: u32) {
        let found = self
            .pending_attach
            .borrow()
            .iter()
            .position(|req| req.async_http_id() == async_http_id);
        if let Some(i) = found {
            let waiter = self.pending_attach.borrow_mut().swap_remove(i);
            waiter.client().h2_fail(crate::Error::Aborted);
            self.rearm_timeout(None);
            self.maybe_release();
            return;
        }
        if let Some(stream) = self.stream_for_http_id(async_http_id) {
            self.detach_with_failure(&stream, crate::Error::Aborted);
        }
        self.rearm_timeout(None);
        self.maybe_release();
    }

    fn reap_aborted(&self) {
        let mut i: usize = 0;
        loop {
            let Some(stream) = self.streams.borrow().values().get(i).cloned() else {
                break;
            };
            let aborted = match stream.client.get() {
                Some(req) => req.signals().get(signals::Field::Aborted),
                None => {
                    i += 1;
                    continue;
                }
            };
            if aborted {
                self.detach_with_failure(&stream, crate::Error::Aborted);
            } else {
                i += 1;
            }
        }
    }

    /// Once the last request is gone, leave the registry and either park the
    /// connection in the keep-alive pool (which takes over the socket tag's
    /// ref) or close it and give that ref up.
    fn maybe_release(&self) {
        if self.streams.borrow().count() > 0 || !self.pending_attach.borrow().is_empty() {
            return;
        }
        // Idempotent: a session is released exactly once. The registry index is
        // the sentinel — `registerH2` re-arms it on keep-alive resume, and any
        // path that has already unregistered (encoder-poison, abort, a
        // `fail_all` earlier in the same entry point) leaves it at maxInt so a
        // second caller can't close the socket or give up the ref twice.
        if self.registry_index.get() == u32::MAX {
            return;
        }
        self.ctx.unregister_h2(self);
        let socket = self.socket.get();
        if self.can_pool() && !socket.is_closed_or_has_error() {
            // The pool takes over the socket tag's reference so a later fetch
            // can resume the multiplexed connection.
            let pool_ref = self.socket_ref.take();
            debug_assert!(pool_ref.is_some());
            self.ctx.release_socket(
                socket,
                self.did_have_handshaking_error,
                self.verification,
                &self.hostname,
                self.port,
                self.ssl_config.as_ref(),
                None,
                b"",
                0,
                0,
                pool_ref,
            );
        } else {
            NewHTTPContext::<true>::close_socket(socket);
            self.give_up_socket_ref();
        }
    }

    /// Deliver any ready headers/body/error on `stream` to its client.
    /// Returns true when the stream is finished and should be removed.
    /// After a true return, `stream.client` has been cleared.
    fn deliver_stream(&self, stream: &Stream) -> bool {
        let Some(req) = stream.client.get() else {
            return true;
        };
        let mut client = req.client();
        let client = &mut *client;

        if client.signals.get(signals::Field::Aborted) {
            self.rst_stream(stream, wire::ErrorCode::CANCEL);
            let _ = self.flush();
            stream.client.set(None);
            client.h2_attached = false;
            client.h2_fail(crate::Error::Aborted);
            return true;
        }

        if let Some(err) = stream.fatal_error.get() {
            stream.client.set(None);
            client.h2_attached = false;
            // Only transparently retry when the server refused the stream
            // before producing any of it (REFUSED_STREAM after HEADERS would
            // be a server bug, but retrying then re-streams a body prefix
            // into a Response that JS already holds — silent corruption).
            if err == crate::Error::HTTP2RefusedStream
                && stream.status_code.get() == 0
                && client.h2_retries < crate::MAX_H2_RETRIES
                && matches!(client.state.original_request_body, Body::Bytes(_))
            {
                client.h2_retry();
            } else {
                client.h2_fail(err);
            }
            return true;
        }

        if stream.headers_ready.get() {
            stream.headers_ready.set(false);
            let decoded_headers = stream.decoded_headers.borrow();
            let (result, response) = match client
                .apply_multiplexed_headers(stream.status_code.get(), &decoded_headers)
            {
                Ok(r) => r,
                Err(err) => {
                    drop(decoded_headers);
                    self.rst_stream(stream, wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    stream.client.set(None);
                    client.h2_attached = false;
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
                drop(decoded_headers);
                self.rst_stream(stream, wire::ErrorCode::CANCEL);
                let _ = self.flush();
                stream.client.set(None);
                client.h2_attached = false;
                client.h2_do_redirect(self.ctx, self.socket.get());
                return true;
            }
            // Deep-copy before detaching: `response` borrows
            // `stream.decoded_headers`.
            client.h2_clone_metadata(&response);
            drop(decoded_headers);
            // `is_done()`: Content-Length: 0 can arrive as `HasBody` (e.g. an
            // SSE content-type), which would make the headerProgress update
            // below terminal and finish `client` while the stream still holds it.
            if result == HeaderResult::Finished
                || (stream.remote_closed() && stream.body_buffer.borrow().is_empty())
                || client.state.is_done()
            {
                stream.client.set(None);
                client.h2_attached = false;
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
                client.h2_progress_update(self.ctx, self.socket.get());
            }
        }

        if client.state.response_stage != HTTPStage::Body {
            return false;
        }

        if !stream.body_buffer.borrow().is_empty() {
            let terminal = stream.remote_closed();
            if terminal {
                client.state.flags.received_last_chunk = true;
                stream.client.set(None);
                client.h2_attached = false;
            }
            let body_buffer = core::mem::take(&mut *stream.body_buffer.borrow_mut());
            let report = match client.h2_handle_response_body(&body_buffer, false) {
                Ok(r) => r,
                Err(err) => {
                    self.rst_stream(stream, wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    if !terminal {
                        stream.client.set(None);
                        client.h2_attached = false;
                    }
                    client.h2_fail(err);
                    return true;
                }
            };
            // keep the allocation for the next pass
            {
                let mut slot = stream.body_buffer.borrow_mut();
                if slot.is_empty() {
                    *slot = body_buffer;
                    slot.clear();
                }
            }
            if terminal {
                return self.finish_stream(stream, client);
            }
            if report {
                // handleResponseBody may report completion before END_STREAM
                // (Content-Length satisfied). The terminal progressUpdate
                // path finishes `client`, so detach first; the trailing
                // END_STREAM/trailers land on a stream we no longer track and
                // are discarded.
                if client.state.is_done() {
                    stream.client.set(None);
                    client.h2_attached = false;
                    client.h2_progress_update(self.ctx, self.socket.get());
                    return true;
                }
                client.h2_progress_update(self.ctx, self.socket.get());
            }
            return false;
        }

        if stream.remote_closed() {
            stream.client.set(None);
            client.h2_attached = false;
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
    fn finish_stream(&self, stream: &Stream, client: &mut HTTPClient) -> bool {
        if let Some(cl) = client.state.content_length {
            if stream.data_bytes_received.get() != cl as u64 {
                client.h2_fail(crate::Error::HTTP2ContentLengthMismatch);
                return true;
            }
        }
        client.h2_progress_update(self.ctx, self.socket.get());
        true
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        super::live_sessions.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(self.registry_index.get() == u32::MAX);
    }
}
