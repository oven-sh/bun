//! One TCP+TLS connection running the HTTP/2 protocol for `fetch()`. Owns the
//! socket, the connection-scoped HPACK tables, and a map of active `Stream`s.
//! See `src/http/H2Client.zig` for the module-level overview.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_collections::{ArrayHashMap, VecExt};
use bun_core::strings;
use bun_core::{Error, err};

use super::stream::{State as StreamState, Stream};
use super::{dispatch, encode};
use crate::h2_frame_parser as wire;
use crate::http_context::HTTPSocket;
use crate::http_request_body::HTTPRequestBody;
use crate::internal_state::HTTPStage;
use crate::lshpack;
use crate::signals;
use crate::ssl_config;
use crate::{HTTPClient, HTTPVerboseLevel, HeaderResult, NewHTTPContext, Protocol};

/// HTTP/2 only ever runs over TLS in this client (ALPN "h2").
pub type Socket = HTTPSocket<true>;

const LOCAL_INITIAL_WINDOW_SIZE: u32 = super::LOCAL_INITIAL_WINDOW_SIZE;

// PORT NOTE: Zig `u31`/`u24` widened to u32; range asserts at use sites.
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
    pub ref_count: Cell<u32>,

    pub hpack: lshpack::HpackHandle, // RAII owner; Deref/DerefMut to lshpack::HPACK
    pub socket: Socket,
    pub ctx: *mut NewHTTPContext<true>, // BACKREF: context outlives and registers this session

    /// Pool key. Owned copy so the session can outlive the originating client.
    pub hostname: Box<[u8]>,
    pub port: u16,
    pub ssl_config: Option<ssl_config::SharedPtr>,
    pub did_have_handshaking_error: bool,

    /// Queued bytes for the socket; whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    pub write_buffer: bun_io::StreamBuffer,

    /// Inbound bytes until a full 9-byte header + declared payload is
    /// available, so frame handlers always see complete frames.
    pub read_buffer: Vec<u8>,

    pub streams: ArrayHashMap<u31, *mut Stream>,
    pub next_stream_id: u31,
    /// Stream id whose CONTINUATION sequence is in progress; 0 = none.
    pub expecting_continuation: u31,

    /// Cold-start coalesced requests parked until the server's first SETTINGS
    /// frame arrives so the real MAX_CONCURRENT_STREAMS cap can be honoured.
    pub pending_attach: Vec<*mut HTTPClient<'static>>, // BACKREF: client owns itself; session only borrows

    pub preface_sent: bool,
    pub settings_received: bool,
    pub goaway_received: bool,
    /// Set when the HPACK encoder's dynamic table has diverged from the
    /// server's view (writeRequest failed mid-encode). Existing siblings whose
    /// HEADERS already went out are unaffected, but no new stream may be
    /// opened on this connection.
    pub encoder_poisoned: bool,
    /// True while onData's deliver loop is running. retryFromH2/doRedirect
    /// re-dispatch may try to adopt back onto this same session; blocking
    /// that during delivery prevents `streams` mutation under iteration and
    /// the failAll → onClose → double-free path.
    pub delivering: bool,
    /// Set by `dispatchFrame` when the inbound batch carried a frame that
    /// advanced an active stream (HEADERS/DATA/WINDOW_UPDATE on a tracked id).
    /// `onData` only re-arms the idle timer when this is true so a server
    /// can't keep a stalled upload alive forever with bare PINGs.
    pub stream_progressed: bool,
    pub goaway_last_stream_id: u31,
    pub fatal_error: Option<Error>,
    /// HEADERS/CONTINUATION fragments for a stream we no longer track (e.g.
    /// in flight when we RST'd it). RFC 9113 §4.3 still requires the block be
    /// fed to the HPACK decoder so the connection-level dynamic table stays
    /// in sync.
    pub orphan_header_block: Vec<u8>,
    /// Reused HPACK-encode scratch for `writeRequest` so each request doesn't
    /// alloc/free its own header-block buffer.
    pub encode_scratch: Vec<u8>,

    pub remote_max_frame_size: u24,
    pub remote_max_concurrent_streams: u32,
    pub remote_initial_window_size: u32,
    /// SETTINGS_HEADER_TABLE_SIZE received from the peer that hasn't yet been
    /// acknowledged with a Dynamic Table Size Update (RFC 7541 §6.3) at the
    /// start of a header block. lshpack's encoder doesn't emit that opcode
    /// itself, so writeRequest must prepend it before the first encode call.
    pub pending_hpack_enc_capacity: Option<u32>,
    /// Connection-level send window. Starts at the spec default regardless of
    /// SETTINGS; only WINDOW_UPDATE on stream 0 grows it.
    pub conn_send_window: i32,

    /// DATA bytes consumed since the last connection-level WINDOW_UPDATE.
    pub conn_unacked_bytes: u32,

    /// Index in the context's active-session list while reachable for
    /// concurrent attachment; maxInt when not listed.
    pub registry_index: Cell<u32>,
}

/// RAII guard alias — bumps on construction, derefs on Drop.
type SessionRefGuard = bun_ptr::ScopedRef<ClientSession>;

/// Upgrade a `*mut Stream` from `self.streams` to `&mut Stream`.
///
/// INVARIANT: stream pointers stored in `ClientSession.streams` are
/// `heap::alloc`-boxed allocations owned by the session, valid until removed
/// via `remove_stream`/`on_close`/`Drop`. They are independent heap
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
pub(super) fn stream_ref(ptr: *const Stream) -> bun_ptr::ParentRef<Stream> {
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
    /// Bump the refcount and return a guard that releases it on Drop, so
    /// reentrant callbacks (delivering bodies, failing clients) cannot free
    /// `*self` mid-call. Zig: `this.ref(); defer this.deref();`.
    ///
    /// Captures a raw pointer (not a borrow) so the guard does not borrow the
    /// session — the guarded scope may freely take fresh `&mut self`, and the
    /// pointer (derived from `&mut self`) carries write provenance for the
    /// final `heap::take` in `deref`.
    #[inline]
    fn ref_scope(&mut self) -> SessionRefGuard {
        // SAFETY: `self` is a live heap-allocated ClientSession.
        unsafe { SessionRefGuard::new(self) }
    }

    #[inline]
    pub fn registry_index(&self) -> u32 {
        self.registry_index.get()
    }
    #[inline]
    pub fn set_registry_index(&self, i: u32) {
        self.registry_index.set(i);
    }

    /// Send RST_STREAM for `stream` and mark it closed. Equivalent to
    /// `Stream::rst` but routed through `self` directly so the stream's
    /// `session` backref is not dereferenced while `&mut self` is already
    /// live on the stack — re-entering via the raw backref would form a
    /// second aliased `&mut ClientSession` (Stacked-Borrows UB).
    pub(crate) fn rst_stream(&mut self, stream: &mut Stream, code: wire::ErrorCode) {
        if stream.rst_done || stream.state == StreamState::Closed {
            return;
        }
        stream.rst_done = true;
        stream.state = StreamState::Closed;
        let value: [u8; 4] = code.0.to_be_bytes();
        self.write_frame(wire::FrameType::HTTP_FRAME_RST_STREAM, 0, stream.id, &value);
    }

    pub fn create(
        ctx: *mut NewHTTPContext<true>,
        socket: Socket,
        client: &HTTPClient,
    ) -> *mut ClientSession {
        let this = bun_core::heap::into_raw(Box::new(ClientSession {
            ref_count: Cell::new(1),
            hpack: lshpack::HpackHandle::new(4096),
            socket,
            ctx,
            hostname: Box::<[u8]>::from(client.connected_url.hostname),
            port: client.connected_url.get_port_auto(),
            ssl_config: client.tls_props.clone(),
            did_have_handshaking_error: client.flags.did_have_handshaking_error,
            write_buffer: bun_io::StreamBuffer::default(),
            read_buffer: Vec::new(),
            streams: ArrayHashMap::default(),
            next_stream_id: 1,
            expecting_continuation: 0,
            pending_attach: Vec::new(),
            preface_sent: false,
            settings_received: false,
            goaway_received: false,
            encoder_poisoned: false,
            delivering: false,
            stream_progressed: false,
            goaway_last_stream_id: 0,
            fatal_error: None,
            orphan_header_block: Vec::new(),
            encode_scratch: Vec::new(),
            remote_max_frame_size: wire::DEFAULT_MAX_FRAME_SIZE,
            remote_max_concurrent_streams: 100,
            remote_initial_window_size: wire::DEFAULT_WINDOW_SIZE,
            pending_hpack_enc_capacity: None,
            conn_send_window: wire::DEFAULT_WINDOW_SIZE as i32,
            conn_unacked_bytes: 0,
            registry_index: Cell::new(u32::MAX),
        }));
        super::live_sessions.fetch_add(1, Ordering::Relaxed);
        // `ctx` is a live back-ref to the owning context (set-once,
        // HTTP-thread-only, no ancestor `&mut HTTPContext` on this path) —
        // route through the centralised [`HTTPClient::ssl_ctx_mut`] accessor.
        HTTPClient::ssl_ctx_mut(ctx).h2_register(this);
        this
    }

    pub fn has_headroom(&self) -> bool {
        !self.goaway_received
            && !self.encoder_poisoned
            && self.fatal_error.is_none()
            && self.streams.count() < self.remote_max_concurrent_streams as usize
            && self.next_stream_id < wire::MAX_STREAM_ID
    }

    pub fn matches(
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

    pub fn adopt(&mut self, client: &mut HTTPClient) {
        client.h2_register_abort_tracker(self.socket);
        // Park instead of attaching when (a) we're inside onData's deliver
        // loop — attach() mustn't mutate `streams` under iteration — or (b)
        // the server's first SETTINGS hasn't arrived yet, so the real
        // MAX_CONCURRENT_STREAMS isn't known and a non-replayable body
        // shouldn't risk a REFUSED_STREAM. The leader bypasses adopt() and
        // attaches directly so the preface still goes out.
        if self.delivering || !self.settings_received {
            self.pending_attach.push(client.as_erased_ptr().as_ptr());
            self.rearm_timeout();
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
        if self.encoder_poisoned {
            self.maybe_release();
        }
    }

    /// Park a coalesced request until the server's SETTINGS arrive. Abort
    /// is routed via the session socket so `abortByHttpId` can find it.
    pub fn enqueue(&mut self, client: &mut HTTPClient<'_>) {
        client.h2_register_abort_tracker(self.socket);
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
                client.h2_fail(err!(Aborted));
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
    pub fn can_pool(&self) -> bool {
        self.streams.count() == 0
            && !self.goaway_received
            && !self.encoder_poisoned
            && self.fatal_error.is_none()
            && self.expecting_continuation == 0
            && self.read_buffer.is_empty()
            && self.write_buffer.is_empty()
            && self.remote_max_concurrent_streams > 0
            && self.next_stream_id < wire::MAX_STREAM_ID
    }

    #[inline]
    pub fn queue(&mut self, bytes: &[u8]) {
        let _ = self.write_buffer.write(bytes);
    }

    pub fn write_frame(
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

    /// Allocate a stream for `client`, serialise its request as HEADERS +
    /// DATA, and flush.
    pub fn attach(&mut self, client: &mut HTTPClient) {
        debug_assert!(self.has_headroom());

        let send_window = i32::try_from(self.remote_initial_window_size.min(wire::MAX_WINDOW_SIZE))
            .expect("int cast");
        let stream = bun_core::heap::into_raw(Stream::new(
            self.next_stream_id,
            std::ptr::from_mut(self),
            Some(client.as_erased_ptr()),
            send_window,
        ));
        super::live_streams.fetch_add(1, Ordering::Relaxed);
        self.next_stream_id = self.next_stream_id.saturating_add(2);
        let stream_ref = stream_mut(stream);
        let _ = self.streams.put(stream_ref.id, stream);
        client.h2 = NonNull::new(stream);
        client.flags.protocol = Protocol::Http2;
        client.allow_retry = false;

        if !self.preface_sent {
            encode::write_preface(self);
        }

        self.rearm_timeout();
        let request = client.h2_build_request(client.state.original_request_body.len());
        if let Err(err) = encode::write_request(self, client, stream_ref, &request) {
            // encodeHeader pushes into the HPACK encoder's dynamic table per
            // call, so a mid-encode failure leaves entries the server will
            // never see. Mark the session unusable for future streams and
            // remove without RST — from the server's view this stream id was
            // never opened (RST on an idle stream is a connection error per
            // RFC 9113 §5.1).
            self.encoder_poisoned = true;
            self.streams.swap_remove(&stream_ref.id);
            drop_stream(stream);
            client.h2 = None;
            client.h2_fail(err);
            // The poisoned session is dead for new work; bounce any waiters
            // and let maybeRelease() drop the registration so the next fetch
            // opens a fresh connection instead of waiting for idle-timeout.
            for c in core::mem::take(&mut self.pending_attach) {
                pending_client_mut(c).h2_retry_after_coalesce();
            }
            let _ = self.flush();
            // Do NOT maybeRelease() here: attach() runs from drainPending()
            // inside onData (whose tail maybeRelease handles cleanup) and from
            // adopt() (which calls maybeRelease itself when this leaves the
            // session empty). Releasing twice would close+deref twice.
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

        if let Err(err) = self.flush() {
            self.fail_all(err);
            return;
        }

        if client.flags.is_streaming_request_body {
            client.h2_progress_update(self.ctx, self.socket);
        }
    }

    /// Unlink `stream` from the session map and free it. If the stream was
    /// mid-CONTINUATION (HEADERS arrived without END_HEADERS), the buffered
    /// fragment is moved to `orphan_header_block` so the trailing CONTINUATION
    /// frames decode against the full block — otherwise HPACK-decoding the
    /// suffix alone desyncs the dynamic table for every sibling stream.
    fn remove_stream(&mut self, stream: *mut Stream) {
        let s = stream_mut(stream);
        if self.expecting_continuation == s.id {
            self.orphan_header_block = core::mem::take(&mut s.header_block);
        }
        self.streams.swap_remove(&s.id);
        drop_stream(stream);
    }

    /// Remove `stream` from the session, RST it, and fail its client. The
    /// session and socket stay up for siblings.
    pub fn detach_with_failure(&mut self, stream: *mut Stream, err: Error) {
        let s = stream_mut(stream);
        self.rst_stream(s, wire::ErrorCode::CANCEL);
        let _ = self.flush();
        let client = s.client.take();
        if let Some(c) = client {
            stream_client_mut(c).h2 = None;
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
        let want = 'blk: {
            for &s in self.streams.values() {
                if let Some(c) = stream_ref(s).client_ref() {
                    if !c.flags.disable_timeout {
                        break 'blk true;
                    }
                }
            }
            for &c in &self.pending_attach {
                if !pending_client_mut(c).flags.disable_timeout {
                    break 'blk true;
                }
            }
            false
        };
        self.socket.set_timeout(if want {
            crate::idle_timeout_seconds()
        } else {
            0
        });
    }

    /// HTTP-thread wake-up from `scheduleResponseBodyDrain`: JS just enabled
    /// `response_body_streaming`, so flush any body bytes that arrived between
    /// metadata delivery and `getReader()`.
    pub fn drain_response_body_by_http_id(&mut self, async_http_id: u32) {
        let _guard = self.ref_scope();
        for &stream in self.streams.values() {
            let Some(client) = stream_mut(stream).client_mut() else {
                continue;
            };
            if client.async_http_id != async_http_id {
                continue;
            }
            client.h2_drain_response_body(self.socket);
            return;
        }
    }

    /// HTTP-thread wake-up from `scheduleRequestWrite`: new body bytes (or
    /// end-of-body) are available in the ThreadSafeStreamBuffer.
    pub fn stream_body_by_http_id(&mut self, async_http_id: u32, ended: bool) {
        let _guard = self.ref_scope();
        // PORT NOTE: reshaped for borrowck — collect target stream ptr before mutating self.
        let mut target: Option<*mut Stream> = None;
        for &stream in self.streams.values() {
            let Some(client) = stream_mut(stream).client_mut() else {
                continue;
            };
            if client.async_http_id != async_http_id {
                continue;
            }
            if !matches!(
                client.state.original_request_body,
                HTTPRequestBody::Stream(_)
            ) {
                return;
            }
            if let HTTPRequestBody::Stream(ref mut st) = client.state.original_request_body {
                st.ended = ended;
            }
            target = Some(stream);
            break;
        }
        if let Some(stream) = target {
            self.rearm_timeout();
            encode::drain_send_body(self, stream_mut(stream), usize::MAX);
            if let Err(err) = self.flush() {
                self.fail_all(err);
            }
        }
    }

    pub fn write_window_update(&mut self, stream_id: u32, increment: u31) {
        let bytes = increment.to_be_bytes();
        self.write_frame(
            wire::FrameType::HTTP_FRAME_WINDOW_UPDATE,
            0,
            stream_id,
            &bytes,
        );
    }

    fn replenish_window(&mut self) {
        let threshold = LOCAL_INITIAL_WINDOW_SIZE / 2;
        if self.conn_unacked_bytes >= threshold {
            self.write_window_update(0, self.conn_unacked_bytes);
            self.conn_unacked_bytes = 0;
        }
        // PORT NOTE: reshaped for borrowck — collect (id, unacked) pairs before mutating self.
        let mut updates: Vec<(u32, u32)> = Vec::new();
        for &s in self.streams.values() {
            let s = stream_mut(s);
            if s.unacked_bytes >= threshold && !s.remote_closed() {
                updates.push((s.id, s.unacked_bytes));
                s.unacked_bytes = 0;
            }
        }
        for (id, unacked) in updates {
            self.write_window_update(id, unacked);
        }
        // PERF(port): Zig iterated and wrote in one pass; profile if extra Vec matters.
    }

    pub fn flush(&mut self) -> Result<bool, Error> {
        // PORT NOTE: reshaped for borrowck — capture as `bun_ptr::RawSlice`
        // (encapsulated outlives-holder invariant) so the loop can borrow
        // `self.socket` while still subslicing `write_buffer`. The buffer is
        // not reallocated until `wrote()` after the loop.
        let pending = bun_ptr::RawSlice::new(self.write_buffer.slice());
        if pending.is_empty() {
            return Ok(false);
        }
        let len = pending.len();
        let mut total: usize = 0;
        while total < len {
            let wrote = self.socket.write(&pending.slice()[total..]);
            if wrote < 0 {
                return Err(err!(WriteFailed));
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

    /// Socket onData entry point. Parse frames into per-stream state, deliver
    /// each ready stream to its client, then pool or close if no streams
    /// remain. Structured "parse all → deliver all" because delivering may
    /// free the client.
    pub fn on_data(&mut self, incoming: &[u8]) {
        let _guard = self.ref_scope();
        self.stream_progressed = false;
        if self.read_buffer.is_empty() {
            let consumed = dispatch::parse_frames(self, incoming);
            if consumed < incoming.len() && self.fatal_error.is_none() {
                self.read_buffer.extend_from_slice(&incoming[consumed..]);
            }
        } else {
            self.read_buffer.extend_from_slice(incoming);
            // PORT NOTE: reshaped for borrowck — `parse_frames` takes
            // `&mut self` plus a view into `self.read_buffer`. Capture as
            // `bun_ptr::RawSlice`: read_buffer is not reallocated during
            // parse_frames (only consumed), so the outlives-holder invariant
            // holds for the call.
            let buf = bun_ptr::RawSlice::new(self.read_buffer.as_slice());
            let consumed = dispatch::parse_frames(self, buf.slice());
            self.read_buffer.drain_front(consumed);
        }

        if self.flush().is_err() {
            self.fatal_error = Some(err!(WriteFailed));
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
        encode::drain_send_bodies(self);
        if let Err(err) = self.flush() {
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
                    self.rst_stream(s, wire::ErrorCode::CANCEL);
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
        // moved a stream (HEADERS/DATA/WINDOW_UPDATE on an active id) do.
        if self.stream_progressed {
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

    /// Socket onWritable entry point.
    pub fn on_writable(&mut self) {
        let _guard = self.ref_scope();
        if let Err(err) = self.flush() {
            return self.fail_all(err);
        }
        encode::drain_send_bodies(self);
        if let Err(err) = self.flush() {
            return self.fail_all(err);
        }
        self.reap_aborted();
        self.rearm_timeout();
        self.maybe_release();
    }

    /// Called while the socket is parked in the pool with no clients; answers
    /// PING/SETTINGS, records GOAWAY, discards anything stream-addressed.
    pub fn on_idle_data(&mut self, incoming: &[u8]) {
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
            self.fatal_error = Some(err!(WriteFailed));
        }
    }

    /// Socket onClose / onTimeout entry point. The socket is already gone, so
    /// streams just fail and the session is destroyed.
    pub fn on_close(&mut self, err: Error) {
        let _guard = self.ref_scope();
        // SAFETY: ctx back-ref is valid for the session's lifetime. on_close is
        // reachable synchronously from connect() → adopt() → attach() flush
        // failure → fail_all() while connect() still holds `&mut HTTPContext`,
        // so route through the raw-ptr helper instead of forming a second
        // aliased `&mut NewHTTPContext` via autoref.
        unsafe { NewHTTPContext::<true>::unregister_h2_raw(self.ctx, std::ptr::from_ref(self)) };
        for client in core::mem::take(&mut self.pending_attach) {
            pending_client_mut(client).h2_fail(err);
        }
        for &e in self.streams.values() {
            let client = stream_mut(e).client.take();
            if let Some(c) = client {
                stream_client_mut(c).h2 = None;
            }
            drop_stream(e);
            if let Some(c) = client {
                stream_client_mut(c).h2_fail(err);
            }
        }
        self.streams.clear_retaining_capacity();
        // SAFETY: `self: &mut Self` carries write provenance to the Box alloc.
        unsafe { ClientSession::deref(self) };
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
            self.write_frame(wire::FrameType::HTTP_FRAME_GOAWAY, 0, 0, &goaway);
            let _ = self.flush();
        }
        NewHTTPContext::<true>::mark_socket_as_dead(sock);
        self.on_close(err);
        sock.close(bun_uws::CloseKind::Failure);
    }

    /// Called from the HTTP thread's shutdown queue when a fetch on this
    /// session is aborted. RST_STREAMs that one request; siblings continue.
    pub fn abort_by_http_id(&mut self, async_http_id: u32) {
        // PORT NOTE: reshaped for borrowck — find index via raw-ptr field read
        // first, then swap_remove, so no `&mut HTTPClient` is held across the
        // Vec mutation and no `&mut` is materialised during iteration.
        let found = self
            .pending_attach
            .iter()
            .position(|&c| pending_client_mut(c).async_http_id == async_http_id);
        if let Some(i) = found {
            let client = self.pending_attach.swap_remove(i);
            pending_client_mut(client).h2_fail(err!(Aborted));
            self.rearm_timeout();
            self.maybe_release();
            return;
        }
        // PORT NOTE: reshaped for borrowck — find target before detaching.
        let mut target: Option<*mut Stream> = None;
        for &e in self.streams.values() {
            if stream_ref(e)
                .client_ref()
                .is_some_and(|c| c.async_http_id == async_http_id)
            {
                target = Some(e);
                break;
            }
        }
        if let Some(stream) = target {
            self.detach_with_failure(stream, err!(Aborted));
        }
        self.rearm_timeout();
        self.maybe_release();
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
                self.detach_with_failure(stream, err!(Aborted));
            } else {
                i += 1;
            }
        }
    }

    fn maybe_release(&mut self) {
        if self.streams.count() > 0 || !self.pending_attach.is_empty() {
            return;
        }
        // Idempotent: a session is released exactly once. The registry index is
        // the sentinel — `registerH2` re-arms it on keep-alive resume, and any
        // path that has already unregistered (encoder-poison, abort) leaves it
        // at maxInt so a second caller can't double-close+deref.
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
            // the multiplexed connection. SAFETY: `self` is heap-owned and
            // outlives the pool entry (release_socket takes the strong ref).
            let self_ptr = NonNull::from(&mut *self);
            // ctx back-ref is valid for the session's lifetime. Unlike
            // `unregister_h2_raw` above, this branch is *not* reachable on the
            // re-entrant `connect()` → `adopt()` path: every adopt-side entry
            // into `maybe_release` has `encoder_poisoned`, `!has_headroom()`
            // (goaway/fatal/stream-id-exhausted), or `streams.count() > 0` —
            // all of which short-circuit before reaching `can_pool()`. So no
            // ancestor frame holds `&mut NewHTTPContext` here and forming one
            // from the backref is sound — route through the centralised
            // [`HTTPClient::ssl_ctx_mut`] accessor (same set-once invariant).
            HTTPClient::ssl_ctx_mut(self.ctx).release_socket(
                self.socket,
                self.did_have_handshaking_error,
                &self.hostname,
                self.port,
                self.ssl_config.as_ref(),
                None,
                b"",
                0,
                0,
                Some(self_ptr),
            );
        } else {
            NewHTTPContext::<true>::close_socket(self.socket);
            // SAFETY: `self: &mut Self` carries write provenance to the Box alloc.
            unsafe { ClientSession::deref(self) };
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
            self.rst_stream(stream, wire::ErrorCode::CANCEL);
            let _ = self.flush();
            stream.client = None;
            client.h2 = None;
            client.h2_fail(err!(Aborted));
            return true;
        }

        if let Some(err) = stream.fatal_error {
            stream.client = None;
            client.h2 = None;
            // Only transparently retry when the server refused the stream
            // before producing any of it (REFUSED_STREAM after HEADERS would
            // be a server bug, but retrying then re-streams a body prefix
            // into a Response that JS already holds — silent corruption).
            if err == err!(HTTP2RefusedStream)
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
            let result = match self.apply_headers(stream, client) {
                Ok(r) => r,
                Err(err) => {
                    self.rst_stream(stream, wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    stream.client = None;
                    client.h2 = None;
                    client.h2_fail(err);
                    return true;
                }
            };
            // handleResponseMetadata set is_redirect_pending. The doRedirect
            // contract assumes the caller already detached the stream
            // (http.zig:1062). Detach + RST here unconditionally so the
            // header_progress path below can never re-enter doRedirect via
            // progressUpdate while the old Stream still points at this
            // client — that path would attach a second Stream to the same
            // HTTPClient and the first one's `stream.client` becomes a
            // dangling pointer once the request completes.
            if client.state.flags.is_redirect_pending {
                self.rst_stream(stream, wire::ErrorCode::CANCEL);
                let _ = self.flush();
                stream.client = None;
                client.h2 = None;
                client.h2_do_redirect(self.ctx, self.socket);
                return true;
            }
            if result == HeaderResult::Finished
                || (stream.remote_closed() && stream.body_buffer.is_empty())
            {
                stream.client = None;
                client.h2 = None;
                client.h2_clone_metadata();
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
            client.h2_clone_metadata();
            // Mirror the h1 path (http.zig handleOnDataHeaders): deliver headers
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
                client.h2 = None;
            }
            let report = match client.h2_handle_response_body(&stream.body_buffer, false) {
                Ok(r) => r,
                Err(err) => {
                    stream.body_buffer.clear();
                    self.rst_stream(stream, wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    if !terminal {
                        stream.client = None;
                        client.h2 = None;
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
                    client.h2 = None;
                    client.h2_progress_update(self.ctx, self.socket);
                    return true;
                }
                client.h2_progress_update(self.ctx, self.socket);
            }
            return false;
        }

        if stream.remote_closed() {
            stream.client = None;
            client.h2 = None;
            client.state.flags.received_last_chunk = true;
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
                client.h2_fail(err!(HTTP2ContentLengthMismatch));
                return true;
            }
        }
        client.h2_progress_update(self.ctx, self.socket);
        true
    }

    /// Hand the pre-decoded response headers to the existing HTTP/1.1
    /// metadata pipeline (`handleResponseMetadata` + `cloneMetadata`).
    fn apply_headers(
        &mut self,
        stream: &mut Stream,
        client: &mut HTTPClient,
    ) -> Result<HeaderResult, Error> {
        // SAFETY: decoded_headers borrow stream.decoded_bytes, which outlives
        // the synchronous clone_metadata that follows in `process_stream` —
        // see `HTTPClient::apply_multiplexed_headers` contract.
        client.apply_multiplexed_headers(stream.status_code, &stream.decoded_headers)
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        super::live_sessions.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(self.registry_index.get() == u32::MAX);
        // hpack: HpackHandle drops automatically (lshpack_wrapper_deinit).
        // write_buffer / read_buffer / pending_attach / orphan_header_block /
        // encode_scratch / hostname / ssl_config are dropped automatically.
        for &e in self.streams.values() {
            drop_stream(e);
        }
        // streams map storage drops automatically.
        // bun.destroy(this) — handled by heap::take in `deref`.
    }
}

// ported from: src/http/h2_client/ClientSession.zig
