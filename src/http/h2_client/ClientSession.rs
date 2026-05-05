//! One TCP+TLS connection running the HTTP/2 protocol for `fetch()`. Owns the
//! socket, the connection-scoped HPACK tables, and a map of active `Stream`s.
//! See `src/http/H2Client.zig` for the module-level overview.

use core::cell::Cell;

use bun_collections::ArrayHashMap;
use bun_core::{err, Error};
use bun_str::strings;

use crate::h2_client::stream::Stream;
use crate::h2_client::{dispatch, encode};
use crate::h2_frame_parser as wire;
use crate::lshpack;
use crate::picohttp;
use crate::HTTPClient;
use crate::NewHTTPContext;
use crate::SSLConfig;
use crate::{self as h2, H2Client as H2};
// TODO(b0): SSLConfig arrives from move-in (MOVE_DOWN → bun_http::ssl_config)

pub type Socket = <NewHTTPContext<true> as crate::HttpContext>::HTTPSocket;
// TODO(port): NewHTTPContext(true).HTTPSocket — exact Rust spelling depends on how the
// `fn NewHTTPContext(comptime ssl: bool) type` generic is ported (struct + const-generic).

const LOCAL_INITIAL_WINDOW_SIZE: u32 = h2::LOCAL_INITIAL_WINDOW_SIZE;

pub struct ClientSession {
    /// Ref holders: the socket-ext tag while the session is the ActiveSocket
    /// (1), the context's active_h2_sessions registry while listed (1), and
    /// the keep-alive pool while parked (1). Hand-offs between socket and
    /// pool transfer a ref rather than touching the count.
    pub ref_count: Cell<u32>,

    pub hpack: *mut lshpack::HPACK, // TODO(port): lifetime — FFI handle owned via init/deinit
    pub socket: Socket,
    pub ctx: *mut NewHTTPContext<true>, // BACKREF: context outlives and registers this session

    /// Pool key. Owned copy so the session can outlive the originating client.
    pub hostname: Box<[u8]>,
    pub port: u16,
    pub ssl_config: Option<SSLConfig::SharedPtr>,
    pub did_have_handshaking_error: bool,

    /// Queued bytes for the socket; whole frames are written here and
    /// `flush()` drains as much as the socket accepts.
    pub write_buffer: bun_io::StreamBuffer,

    /// Inbound bytes until a full 9-byte header + declared payload is
    /// available, so frame handlers always see complete frames.
    pub read_buffer: Vec<u8>,

    pub streams: ArrayHashMap<u31, *mut Stream>, // TODO(port): u31 → newtype StreamId(u32); values are owned (see Drop)
    pub next_stream_id: u31,
    /// Stream id whose CONTINUATION sequence is in progress; 0 = none.
    pub expecting_continuation: u31,

    /// Cold-start coalesced requests parked until the server's first SETTINGS
    /// frame arrives so the real MAX_CONCURRENT_STREAMS cap can be honoured.
    pub pending_attach: Vec<*mut HTTPClient>, // BACKREF: client owns itself; session only borrows

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

    pub remote_max_frame_size: u24, // TODO(port): u24 → u32 (Rust has no u24)
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
    pub registry_index: u32,
}

// Intrusive refcount (single-thread). `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
// → `bun_ptr::IntrusiveRc<ClientSession>` clones via `ref()`, drops via `deref()`, and
// calls `Drop` when the count hits zero.
pub type Ref = bun_ptr::IntrusiveRc<ClientSession>;

impl ClientSession {
    #[inline]
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    #[inline]
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: ref_count reached zero; no other holders. Allocated via Box::into_raw in `create`.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }

    pub fn create(
        ctx: &mut NewHTTPContext<true>,
        socket: Socket,
        client: &HTTPClient,
    ) -> *mut ClientSession {
        let this = Box::into_raw(Box::new(ClientSession {
            ref_count: Cell::new(1),
            hpack: lshpack::HPACK::init(4096),
            socket,
            ctx: ctx as *mut _,
            hostname: Box::<[u8]>::from(client.connected_url.hostname()),
            port: client.connected_url.get_port_auto(),
            ssl_config: client.tls_props.as_ref().map(|p| p.clone()),
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
            registry_index: u32::MAX,
        }));
        H2::live_sessions().fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        // SAFETY: `this` was just allocated and is non-null.
        ctx.register_h2(unsafe { &mut *this });
        this
    }

    pub fn has_headroom(&self) -> bool {
        !self.goaway_received
            && !self.encoder_poisoned
            && self.fatal_error.is_none()
            && self.streams.count() < self.remote_max_concurrent_streams as usize
            && self.next_stream_id < wire::MAX_STREAM_ID
    }

    pub fn matches(&self, hostname: &[u8], port: u16, ssl_config: Option<&SSLConfig>) -> bool {
        self.port == port
            && SSLConfig::raw_ptr(&self.ssl_config) == ssl_config.map_or(core::ptr::null(), |p| p as *const _)
            && strings::eql_long(&self.hostname, hostname, true)
    }

    pub fn adopt(&mut self, client: &mut HTTPClient) {
        client.register_abort_tracker(true, self.socket);
        // Park instead of attaching when (a) we're inside onData's deliver
        // loop — attach() mustn't mutate `streams` under iteration — or (b)
        // the server's first SETTINGS hasn't arrived yet, so the real
        // MAX_CONCURRENT_STREAMS isn't known and a non-replayable body
        // shouldn't risk a REFUSED_STREAM. The leader bypasses adopt() and
        // attaches directly so the preface still goes out.
        if self.delivering || !self.settings_received {
            self.pending_attach.push(client as *mut _);
            self.rearm_timeout();
            return;
        }
        // Belt-and-suspenders: callers gate on hasHeadroom(), but a session
        // pulled from the keep-alive pool (HTTPContext.existingSocket) may have
        // remote_max_concurrent_streams == 0 if a mid-connection SETTINGS
        // dropped it. Re-dispatch instead of asserting in attach().
        if !self.has_headroom() {
            client.retry_after_h2_coalesce();
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
    pub fn enqueue(&mut self, client: &mut HTTPClient) {
        client.register_abort_tracker(true, self.socket);
        self.pending_attach.push(client as *mut _);
        self.rearm_timeout();
    }

    fn drain_pending(&mut self) {
        if !self.settings_received || self.pending_attach.is_empty() {
            return;
        }
        let waiters = core::mem::take(&mut self.pending_attach);
        for client_ptr in waiters {
            // SAFETY: pending_attach entries are live HTTPClient back-refs registered via enqueue/adopt.
            let client = unsafe { &mut *client_ptr };
            if let Some(err) = self.fatal_error {
                client.fail_from_h2(err);
            } else if client.signals.get(crate::Signal::Aborted) {
                client.fail_from_h2(err!("Aborted"));
            } else if self.has_headroom() {
                self.attach(client);
            } else {
                client.retry_after_h2_coalesce();
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

    pub fn queue(&mut self, bytes: &[u8]) {
        self.write_buffer.write(bytes);
    }

    pub fn write_frame(
        &mut self,
        frame_type: wire::FrameType,
        flags: u8,
        stream_id: u32,
        payload: &[u8],
    ) {
        let mut header = wire::FrameHeader {
            r#type: frame_type as u8,
            flags,
            stream_identifier: stream_id,
            length: u32::try_from(payload.len()).unwrap(), // TODO(port): u24
        };
        // TODO(port): std.mem.byteSwapAllFields — wire::FrameHeader should expose
        // a `to_be()` / `byte_swap_all_fields()` helper.
        header.byte_swap_all_fields();
        // SAFETY: FrameHeader is #[repr(C)] POD; reading its first byteSize bytes is sound.
        let header_bytes = unsafe {
            core::slice::from_raw_parts(
                &header as *const _ as *const u8,
                wire::FrameHeader::BYTE_SIZE,
            )
        };
        self.queue(header_bytes);
        self.queue(payload);
    }

    /// Allocate a stream for `client`, serialise its request as HEADERS +
    /// DATA, and flush.
    pub fn attach(&mut self, client: &mut HTTPClient) {
        debug_assert!(self.has_headroom());

        let stream = Box::into_raw(Box::new(Stream {
            id: self.next_stream_id,
            session: self as *mut _,
            client: Some(client as *mut _),
            send_window: i32::try_from(
                self.remote_initial_window_size.min(wire::MAX_WINDOW_SIZE as u32),
            )
            .unwrap(),
            ..Default::default()
        }));
        // TODO(port): Stream::new(.{...}) — exact field set depends on Stream port; using struct-init + Default for unlisted fields.
        H2::live_streams().fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        self.next_stream_id = self.next_stream_id.saturating_add(2);
        // SAFETY: `stream` was just allocated and is non-null.
        let stream_ref = unsafe { &mut *stream };
        self.streams.put(stream_ref.id, stream);
        client.h2 = Some(stream);
        client.flags.protocol = crate::Protocol::Http2;
        client.allow_retry = false;

        if !self.preface_sent {
            encode::write_preface(self);
        }

        self.rearm_timeout();
        let request = client.build_request(client.state.original_request_body.len());
        if let Err(err) = encode::write_request(self, client, stream_ref, request) {
            // encodeHeader pushes into the HPACK encoder's dynamic table per
            // call, so a mid-encode failure leaves entries the server will
            // never see. Mark the session unusable for future streams and
            // remove without RST — from the server's view this stream id was
            // never opened (RST on an idle stream is a connection error per
            // RFC 9113 §5.1).
            self.encoder_poisoned = true;
            self.streams.swap_remove(stream_ref.id);
            // SAFETY: stream was Box::into_raw'd above and removed from the map; sole owner.
            unsafe { drop(Box::from_raw(stream)) };
            client.h2 = None;
            client.fail_from_h2(err);
            // The poisoned session is dead for new work; bounce any waiters
            // and let maybeRelease() drop the registration so the next fetch
            // opens a fresh connection instead of waiting for idle-timeout.
            for c in &self.pending_attach {
                // SAFETY: pending_attach entries are live HTTPClient back-refs.
                unsafe { (**c).retry_after_h2_coalesce() };
            }
            self.pending_attach.clear();
            let _ = self.flush();
            // Do NOT maybeRelease() here: attach() runs from drainPending()
            // inside onData (whose tail maybeRelease handles cleanup) and from
            // adopt() (which calls maybeRelease itself when this leaves the
            // session empty). Releasing twice would close+deref twice.
            return;
        }
        if client.verbose != crate::Verbose::None {
            HTTPClient::print_request(
                crate::Protocol::Http2,
                request,
                client.url.href(),
                !client.flags.reject_unauthorized,
                client.state.request_body(),
                client.verbose == crate::Verbose::Curl,
            );
        }
        client.state.request_stage = if stream_ref.local_closed() {
            crate::RequestStage::Done
        } else {
            crate::RequestStage::Body
        };
        client.state.response_stage = crate::ResponseStage::Headers;

        if let Err(err) = self.flush() {
            self.fail_all(err);
            return;
        }

        if client.flags.is_streaming_request_body {
            // SAFETY: ctx back-ref is valid for the session's lifetime.
            client.progress_update(true, unsafe { &mut *self.ctx }, self.socket);
        }
    }

    /// Unlink `stream` from the session map and free it. If the stream was
    /// mid-CONTINUATION (HEADERS arrived without END_HEADERS), the buffered
    /// fragment is moved to `orphan_header_block` so the trailing CONTINUATION
    /// frames decode against the full block — otherwise HPACK-decoding the
    /// suffix alone desyncs the dynamic table for every sibling stream.
    fn remove_stream(&mut self, stream: *mut Stream) {
        // SAFETY: caller guarantees `stream` is a live entry in `self.streams`.
        let s = unsafe { &mut *stream };
        if self.expecting_continuation == s.id {
            self.orphan_header_block = core::mem::take(&mut s.header_block);
        }
        self.streams.swap_remove(s.id);
        // SAFETY: stream was Box::into_raw'd in attach(); we are the sole owner after map removal.
        unsafe { drop(Box::from_raw(stream)) };
    }

    /// Remove `stream` from the session, RST it, and fail its client. The
    /// session and socket stay up for siblings.
    pub fn detach_with_failure(&mut self, stream: *mut Stream, err: Error) {
        // SAFETY: caller guarantees `stream` is live.
        let s = unsafe { &mut *stream };
        s.rst(wire::ErrorCode::CANCEL);
        let _ = self.flush();
        let client = s.client.take();
        if let Some(c) = client {
            // SAFETY: stream.client is a live HTTPClient back-ref while set.
            unsafe { (*c).h2 = None };
        }
        self.remove_stream(stream);
        if let Some(c) = client {
            // SAFETY: same as above.
            unsafe { (*c).fail_from_h2(err) };
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
            for s in self.streams.values() {
                // SAFETY: streams values are live Stream pointers owned by this session.
                let s = unsafe { &**s };
                let Some(c) = s.client else { continue };
                // SAFETY: stream.client is a live back-ref while set.
                if !unsafe { (*c).flags.disable_timeout } {
                    break 'blk true;
                }
            }
            for c in &self.pending_attach {
                // SAFETY: pending_attach entries are live back-refs.
                if !unsafe { (**c).flags.disable_timeout } {
                    break 'blk true;
                }
            }
            false
        };
        self.socket.timeout(0);
        self.socket.set_timeout_minutes(if want { 5 } else { 0 });
    }

    /// HTTP-thread wake-up from `scheduleResponseBodyDrain`: JS just enabled
    /// `response_body_streaming`, so flush any body bytes that arrived between
    /// metadata delivery and `getReader()`.
    pub fn drain_response_body_by_http_id(&mut self, async_http_id: u32) {
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): scopeguard borrows &self; ref/deref pattern may need IntrusiveRc RAII helper instead.
        for stream in self.streams.values() {
            // SAFETY: owned live Stream pointer.
            let stream = unsafe { &mut **stream };
            let Some(client) = stream.client else { continue };
            // SAFETY: stream.client is a live back-ref while set.
            let client = unsafe { &mut *client };
            if client.async_http_id != async_http_id {
                continue;
            }
            client.drain_response_body(true, self.socket);
            return;
        }
    }

    /// HTTP-thread wake-up from `scheduleRequestWrite`: new body bytes (or
    /// end-of-body) are available in the ThreadSafeStreamBuffer.
    pub fn stream_body_by_http_id(&mut self, async_http_id: u32, ended: bool) {
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): same ref/deref RAII concern as above.
        // PORT NOTE: reshaped for borrowck — collect target stream ptr before mutating self.
        let mut target: Option<*mut Stream> = None;
        for stream in self.streams.values() {
            // SAFETY: owned live Stream pointer.
            let s = unsafe { &mut **stream };
            let Some(client_ptr) = s.client else { continue };
            // SAFETY: stream.client is a live back-ref while set.
            let client = unsafe { &mut *client_ptr };
            if client.async_http_id != async_http_id {
                continue;
            }
            if !matches!(client.state.original_request_body, crate::RequestBody::Stream(_)) {
                return;
            }
            if let crate::RequestBody::Stream(ref mut st) = client.state.original_request_body {
                st.ended = ended;
            }
            target = Some(*stream);
            break;
        }
        if let Some(stream) = target {
            self.rearm_timeout();
            // SAFETY: stream is a live entry in self.streams.
            encode::drain_send_body(self, unsafe { &mut *stream }, usize::MAX);
            if let Err(err) = self.flush() {
                self.fail_all(err);
            }
        }
    }

    pub fn write_window_update(&mut self, stream_id: u32, increment: u31) {
        let value: u32 = (increment as u32).swap_bytes();
        // SAFETY: u32 is POD; reinterpreting as 4 bytes is sound.
        let bytes = value.to_ne_bytes();
        self.write_frame(wire::FrameType::HTTP_FRAME_WINDOW_UPDATE, 0, stream_id, &bytes);
    }

    fn replenish_window(&mut self) {
        let threshold = LOCAL_INITIAL_WINDOW_SIZE / 2;
        if self.conn_unacked_bytes >= threshold {
            self.write_window_update(0, u31::try_from(self.conn_unacked_bytes).unwrap());
            self.conn_unacked_bytes = 0;
        }
        // PORT NOTE: reshaped for borrowck — collect (id, unacked) pairs before mutating self.
        let mut updates: Vec<(u32, u32)> = Vec::new();
        for s in self.streams.values() {
            // SAFETY: owned live Stream pointer.
            let s = unsafe { &mut **s };
            if s.unacked_bytes >= threshold && !s.remote_closed() {
                updates.push((s.id as u32, s.unacked_bytes));
                s.unacked_bytes = 0;
            }
        }
        for (id, unacked) in updates {
            self.write_window_update(id, u31::try_from(unacked).unwrap());
        }
        // PERF(port): Zig iterated and wrote in one pass; profile if extra Vec matters.
    }

    pub fn flush(&mut self) -> Result<bool, Error> {
        // TODO(port): narrow error set
        let pending = self.write_buffer.slice();
        if pending.is_empty() {
            return Ok(false);
        }
        let mut remaining = pending;
        let mut total: usize = 0;
        while !remaining.is_empty() {
            let wrote = self.socket.write(remaining);
            if wrote < 0 {
                return Err(err!("WriteFailed"));
            }
            let n: usize = usize::try_from(wrote).unwrap();
            total += n;
            remaining = &remaining[n..];
            if n == 0 {
                break;
            }
        }
        // PORT NOTE: reshaped for borrowck — drop `remaining` borrow before re-borrowing write_buffer.
        let _ = remaining;
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
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): ref/deref RAII — see drain_response_body_by_http_id note.
        self.stream_progressed = false;
        if self.read_buffer.is_empty() {
            let consumed = dispatch::parse_frames(self, incoming);
            if consumed < incoming.len() && self.fatal_error.is_none() {
                self.read_buffer.extend_from_slice(&incoming[consumed..]);
            }
        } else {
            self.read_buffer.extend_from_slice(incoming);
            // PORT NOTE: reshaped for borrowck — pass raw slice; parse_frames must not retain it.
            let consumed = dispatch::parse_frames(self, {
                // SAFETY: read_buffer is not reallocated during parse_frames (only consumed).
                // TODO(port): verify dispatch::parse_frames does not push into self.read_buffer.
                unsafe { core::slice::from_raw_parts(self.read_buffer.as_ptr(), self.read_buffer.len()) }
            });
            let tail = self.read_buffer.len() - consumed;
            if tail > 0 && consumed > 0 {
                self.read_buffer.copy_within(consumed.., 0);
            }
            self.read_buffer.truncate(tail);
        }

        match self.flush() {
            Ok(_) => {}
            Err(_) => {
                self.fatal_error = Some(err!("WriteFailed"));
            }
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
                // SAFETY: stream is a live entry in self.streams.
                let s = unsafe { &mut *stream };
                // Any detach that leaves the stream open from the server's
                // perspective (we never sent END_STREAM, *or* the server
                // never did and hasn't RST'd) must signal abandonment so the
                // server can release its concurrency slot. rst() is idempotent.
                if s.state != crate::h2_client::stream::State::Closed {
                    s.rst(wire::ErrorCode::CANCEL);
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
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
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
        let consumed = dispatch::parse_frames(self, {
            // SAFETY: see on_data note.
            unsafe { core::slice::from_raw_parts(self.read_buffer.as_ptr(), self.read_buffer.len()) }
        });
        let tail = self.read_buffer.len() - consumed;
        if tail > 0 && consumed > 0 {
            self.read_buffer.copy_within(consumed.., 0);
        }
        self.read_buffer.truncate(tail);
        if self.flush().is_err() {
            self.fatal_error = Some(err!("WriteFailed"));
        }
    }

    /// Socket onClose / onTimeout entry point. The socket is already gone, so
    /// streams just fail and the session is destroyed.
    pub fn on_close(&mut self, err: Error) {
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // SAFETY: ctx back-ref is valid for the session's lifetime.
        unsafe { (*self.ctx).unregister_h2(self) };
        for client in &self.pending_attach {
            // SAFETY: pending_attach entries are live back-refs.
            unsafe { (**client).fail_from_h2(err) };
        }
        self.pending_attach.clear();
        for e in self.streams.values() {
            let stream_ptr = *e;
            // SAFETY: owned live Stream pointer.
            let stream = unsafe { &mut *stream_ptr };
            let client = stream.client.take();
            if let Some(c) = client {
                // SAFETY: live back-ref.
                unsafe { (*c).h2 = None };
            }
            // SAFETY: stream was Box::into_raw'd in attach(); sole owner here.
            unsafe { drop(Box::from_raw(stream_ptr)) };
            if let Some(c) = client {
                // SAFETY: live back-ref.
                unsafe { (*c).fail_from_h2(err) };
            }
        }
        self.streams.clear(); // PERF(port): was clearRetainingCapacity
        self.deref();
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
            goaway[4..8].copy_from_slice(&(dispatch::error_code_for(err) as u32).to_be_bytes());
            self.write_frame(wire::FrameType::HTTP_FRAME_GOAWAY, 0, 0, &goaway);
            let _ = self.flush();
        }
        NewHTTPContext::<true>::mark_socket_as_dead(sock);
        self.on_close(err);
        sock.close(crate::CloseReason::Failure);
    }

    /// Called from the HTTP thread's shutdown queue when a fetch on this
    /// session is aborted. RST_STREAMs that one request; siblings continue.
    pub fn abort_by_http_id(&mut self, async_http_id: u32) {
        for (i, client) in self.pending_attach.iter().enumerate() {
            // SAFETY: pending_attach entries are live back-refs.
            let client = unsafe { &mut **client };
            if client.async_http_id == async_http_id {
                let _ = self.pending_attach.swap_remove(i);
                client.fail_from_h2(err!("Aborted"));
                self.rearm_timeout();
                self.maybe_release();
                return;
            }
        }
        // PORT NOTE: reshaped for borrowck — find target before detaching.
        let mut target: Option<*mut Stream> = None;
        for e in self.streams.values() {
            // SAFETY: owned live Stream pointer.
            let stream = unsafe { &**e };
            let Some(client) = stream.client else { continue };
            // SAFETY: live back-ref.
            if unsafe { (*client).async_http_id } == async_http_id {
                target = Some(*e);
                break;
            }
        }
        if let Some(stream) = target {
            self.detach_with_failure(stream, err!("Aborted"));
        }
        self.rearm_timeout();
        self.maybe_release();
    }

    fn reap_aborted(&mut self) {
        let mut i: usize = 0;
        while i < self.streams.count() {
            let stream = self.streams.values()[i];
            // SAFETY: owned live Stream pointer.
            let s = unsafe { &*stream };
            let Some(client) = s.client else {
                i += 1;
                continue;
            };
            // SAFETY: live back-ref.
            if unsafe { (*client).signals.get(crate::Signal::Aborted) } {
                self.detach_with_failure(stream, err!("Aborted"));
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
        if self.registry_index == u32::MAX {
            return;
        }
        // SAFETY: ctx back-ref is valid for the session's lifetime.
        let ctx = unsafe { &mut *self.ctx };
        ctx.unregister_h2(self);
        if self.can_pool() && !self.socket.is_closed_or_has_error() {
            ctx.release_socket(
                self.socket,
                self.did_have_handshaking_error,
                &self.hostname,
                self.port,
                self.ssl_config.clone(),
                None,
                b"",
                0,
                0,
                Some(self as *mut _),
            );
        } else {
            NewHTTPContext::<true>::close_socket(self.socket);
            self.deref();
        }
    }

    /// Deliver any ready headers/body/error on `stream` to its client.
    /// Returns true when the stream is finished and should be removed.
    /// After a true return, neither `stream.client` nor the client's memory
    /// may be touched.
    fn deliver_stream(&mut self, stream: *mut Stream) -> bool {
        // SAFETY: caller passes a live entry from self.streams.
        let stream = unsafe { &mut *stream };
        let Some(client_ptr) = stream.client else {
            return true;
        };
        // SAFETY: stream.client is a live back-ref while set.
        let client = unsafe { &mut *client_ptr };

        if client.signals.get(crate::Signal::Aborted) {
            stream.rst(wire::ErrorCode::CANCEL);
            let _ = self.flush();
            stream.client = None;
            client.h2 = None;
            client.fail_from_h2(err!("Aborted"));
            return true;
        }

        if let Some(err) = stream.fatal_error {
            stream.client = None;
            client.h2 = None;
            // Only transparently retry when the server refused the stream
            // before producing any of it (REFUSED_STREAM after HEADERS would
            // be a server bug, but retrying then re-streams a body prefix
            // into a Response that JS already holds — silent corruption).
            if err == err!("HTTP2RefusedStream")
                && stream.status_code == 0
                && client.h2_retries < HTTPClient::MAX_H2_RETRIES
                && matches!(client.state.original_request_body, crate::RequestBody::Bytes(_))
            {
                client.retry_from_h2();
            } else {
                client.fail_from_h2(err);
            }
            return true;
        }

        if stream.headers_ready {
            stream.headers_ready = false;
            let result = match self.apply_headers(stream, client) {
                Ok(r) => r,
                Err(err) => {
                    stream.rst(wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    stream.client = None;
                    client.h2 = None;
                    client.fail_from_h2(err);
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
                stream.rst(wire::ErrorCode::CANCEL);
                let _ = self.flush();
                stream.client = None;
                client.h2 = None;
                // SAFETY: ctx back-ref is valid for the session's lifetime.
                client.do_redirect(true, unsafe { &mut *self.ctx }, self.socket);
                return true;
            }
            if result == HeaderResult::Finished
                || (stream.remote_closed() && stream.body_buffer.is_empty())
            {
                stream.client = None;
                client.h2 = None;
                client.clone_metadata();
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
            client.clone_metadata();
            // Mirror the h1 path (http.zig handleOnDataHeaders): deliver headers
            // to JS now so `await fetch()` resolves and `getReader()` can enable
            // response_body_streaming. Without this, a content-length response
            // buffers the entire body before the Response promise settles.
            if client.signals.get(crate::Signal::HeaderProgress) {
                // SAFETY: ctx back-ref is valid for the session's lifetime.
                client.progress_update(true, unsafe { &mut *self.ctx }, self.socket);
            }
        }

        if client.state.response_stage != crate::ResponseStage::Body {
            return false;
        }

        if !stream.body_buffer.is_empty() {
            let terminal = stream.remote_closed();
            if terminal {
                client.state.flags.received_last_chunk = true;
                stream.client = None;
                client.h2 = None;
            }
            let report = match client.handle_response_body(&stream.body_buffer, false) {
                Ok(r) => r,
                Err(err) => {
                    stream.body_buffer.clear();
                    stream.rst(wire::ErrorCode::CANCEL);
                    let _ = self.flush();
                    if !terminal {
                        stream.client = None;
                        client.h2 = None;
                    }
                    client.fail_from_h2(err);
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
                    // SAFETY: ctx back-ref is valid for the session's lifetime.
                    client.progress_update(true, unsafe { &mut *self.ctx }, self.socket);
                    return true;
                }
                // SAFETY: ctx back-ref is valid for the session's lifetime.
                client.progress_update(true, unsafe { &mut *self.ctx }, self.socket);
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
            if stream.data_bytes_received != cl {
                client.fail_from_h2(err!("HTTP2ContentLengthMismatch"));
                return true;
            }
        }
        // SAFETY: ctx back-ref is valid for the session's lifetime.
        client.progress_update(true, unsafe { &mut *self.ctx }, self.socket);
        true
    }

    /// Hand the pre-decoded response headers to the existing HTTP/1.1
    /// metadata pipeline (`handleResponseMetadata` + `cloneMetadata`).
    fn apply_headers(
        &mut self,
        stream: &mut Stream,
        client: &mut HTTPClient,
    ) -> Result<HeaderResult, Error> {
        // TODO(port): narrow error set
        let mut response = picohttp::Response {
            minor_version: 0,
            status_code: stream.status_code,
            status: b"",
            headers: picohttp::Headers {
                list: stream.decoded_headers.as_slice(),
            },
            bytes_read: 0,
        };
        client.state.pending_response = Some(response);

        let should_continue = client.handle_response_metadata(&mut response)?;
        // handleResponseMetadata may mutate *response (e.g. the 304 rewrite for
        // force_last_modified); cloneMetadata reads pending_response, so re-sync.
        client.state.pending_response = Some(response);
        // h2 framing delimits the body; chunked transfer-encoding and the
        // HTTP/1.1 "no Content-Length ⇒ no keep-alive" rule don't apply.
        client.state.transfer_encoding = crate::TransferEncoding::Identity;
        if client.state.response_stage == crate::ResponseStage::BodyChunk {
            client.state.response_stage = crate::ResponseStage::Body;
        }
        client.state.flags.allow_keepalive = true;

        Ok(if should_continue == crate::ShouldContinue::Finished {
            HeaderResult::Finished
        } else {
            HeaderResult::HasBody
        })
    }
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        H2::live_sessions().fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
        debug_assert!(self.registry_index == u32::MAX);
        // SAFETY: hpack was allocated by lshpack::HPACK::init and not yet freed.
        unsafe { lshpack::HPACK::deinit(self.hpack) };
        // write_buffer / read_buffer / pending_attach / orphan_header_block /
        // encode_scratch / hostname / ssl_config are dropped automatically.
        for e in self.streams.values() {
            // SAFETY: streams values are Box::into_raw'd in attach(); sole owner here.
            unsafe { drop(Box::from_raw(*e)) };
        }
        // streams map storage drops automatically.
        // bun.destroy(this) — handled by IntrusiveRc / Box::from_raw in `deref`.
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum HeaderResult {
    HasBody,
    Finished,
}

// TODO(port): `u31` / `u24` are Zig arbitrary-width ints with no Rust primitive.
// Phase B should newtype them (`StreamId(u32)`, `FrameLen(u32)`) with range asserts.
#[allow(non_camel_case_types)]
type u31 = u32;
#[allow(non_camel_case_types)]
type u24 = u32;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h2_client/ClientSession.zig (814 lines)
//   confidence: medium
//   todos:      12
//   notes:      heavy raw-ptr back-refs (ctx/client/stream); ref()/deref() RAII guards conflict with &mut self — Phase B needs IntrusiveRc helper; u31/u24 aliased to u32; parse_frames borrows read_buffer via raw slice
// ──────────────────────────────────────────────────────────────────────────
