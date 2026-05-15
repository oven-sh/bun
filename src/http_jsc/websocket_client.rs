//! This is the Rust implementation of the WebSocket client.
//!
//! It manages the WebSocket connection, including sending and receiving data,
//! handling connection events, and managing the WebSocket state.
//!
//! The WebSocket client supports both secure (TLS) and non-secure connections.
//!
//! This is only used **after** the websocket handshaking step is completed.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_boringssl as boringssl;
use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::Output;
use bun_core::{ZigString, strings};
use bun_http::websocket::{Opcode, WebsocketHeader};
use bun_io::KeepAlive;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject, JSValue};
use bun_ptr::{IntrusiveRc, ThisPtr};
use bun_uws::{self as uws, NewSocketHandler, SslCtx, us_bun_verify_error_t};
use bun_uws_sys::us_socket_t;

use self::cpp_websocket::{CppWebSocket, CppWebSocketRef};
use self::websocket_deflate::WebSocketDeflate;
use self::websocket_proxy_tunnel::WebSocketProxyTunnel;

// ─── Submodules ──────────────────────────────────────────────────────────
#[path = "websocket_client/CppWebSocket.rs"]
pub mod cpp_websocket;
#[path = "websocket_client/WebSocketDeflate.rs"]
pub mod websocket_deflate;
#[path = "websocket_client/WebSocketProxy.rs"]
pub mod websocket_proxy;
#[path = "websocket_client/WebSocketProxyTunnel.rs"]
pub mod websocket_proxy_tunnel;
#[path = "websocket_client/WebSocketUpgradeClient.rs"]
pub mod websocket_upgrade_client;

bun_core::define_scoped_log!(log, WebSocketClient, visible);
bun_core::declare_scope!(alloc, hidden);

// ──────────────────────────────────────────────────────────────────────────
// NewWebSocketClient(comptime ssl: bool) → WebSocket<const SSL: bool>
// ──────────────────────────────────────────────────────────────────────────

pub type Socket<const SSL: bool> = NewSocketHandler<SSL>;

const STACK_FRAME_SIZE: usize = 1024;
/// Minimum message size to compress (RFC 7692 recommendation)
const MIN_COMPRESS_SIZE: usize = 860;
/// DEFLATE overhead
const COMPRESSION_OVERHEAD: usize = 4;

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct WebSocket<const SSL: bool> {
    // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) → intrusive refcount
    pub ref_count: Cell<u32>,

    pub tcp: Socket<SSL>,
    pub outgoing_websocket: Option<NonNull<CppWebSocket>>,

    pub receive_state: ReceiveState,
    pub receiving_type: Opcode,
    // we need to start with final so we validate the first frame
    pub receiving_is_final: bool,

    pub ping_frame_bytes: [u8; 128 + 6],
    pub ping_len: u8,
    pub ping_received: bool,
    pub pong_received: bool,
    pub close_received: bool,
    pub close_frame_buffering: bool,

    pub receive_frame: usize,
    pub receive_body_remain: usize,
    pub receive_pending_chunk_len: usize,
    pub receive_buffer: LinearFifo<u8, DynamicBuffer<u8>>,

    pub send_buffer: LinearFifo<u8, DynamicBuffer<u8>>,

    pub global_this: GlobalRef,
    pub poll_ref: KeepAlive,

    pub header_fragment: Option<u8>,

    pub payload_length_frame_bytes: [u8; 8],
    pub payload_length_frame_len: u8,

    // TODO(port): lifetime — managed by microtask queue, not deinit
    pub initial_data_handler: Option<NonNull<InitialDataHandler<SSL>>>,
    pub event_loop: &'static EventLoop,
    pub deflate: Option<Box<WebSocketDeflate>>,

    /// Track if current message is compressed
    pub receiving_compressed: bool,
    /// Track compression state of the entire message (across fragments)
    pub message_is_compressed: bool,

    /// `us_ssl_ctx_t` inherited from the upgrade client when it was built
    /// with a custom CA. The socket's `SSL*` references the `SSL_CTX`
    /// inside, so this must outlive the connection. None when the upgrade
    /// used the shared default context.
    pub secure: Option<*mut SslCtx>,

    /// Proxy tunnel for wss:// through HTTP proxy.
    /// When set, all I/O goes through the tunnel (TLS encryption/decryption).
    /// The tunnel handles the TLS layer, so this is used with ssl=false.
    ///
    /// PORT NOTE: intrusive refcount is hand-rolled on `WebSocketProxyTunnel`
    /// (`ref_()`/`deref()`); stored as `NonNull` rather than `RefPtr` because
    /// the tunnel does not (yet) implement `bun_ptr::RefCounted`. Ownership
    /// semantics match `RefPtr`: assigning here implies a held ref, released
    /// in `clear_data` via `WebSocketProxyTunnel::deref`.
    pub proxy_tunnel: Option<NonNull<WebSocketProxyTunnel>>,
}

impl<const SSL: bool> WebSocket<SSL> {
    /// Zig `@typeName(@This())` — tests grep for this exact shape under `BUN_DEBUG_alloc=1`.
    const ALLOC_TYPE_NAME: &'static str = if SSL {
        "http.websocket_client.NewWebSocketClient(true)"
    } else {
        "http.websocket_client.NewWebSocketClient(false)"
    };

    #[inline]
    fn vm_loop_ctx(global_this: &JSGlobalObject) -> bun_io::EventLoopCtx {
        // SAFETY: `EventLoopCtx.owner` is a type-erased `*mut ()` slot. Source
        // it from `bun_vm_ptr()` (FFI `*mut VirtualMachine`, see
        // `JSGlobalObject.zig:617`) rather than `bun_vm()`'s `&VirtualMachine`
        // so the stored pointer carries write provenance instead of being
        // laundered through a shared-ref `*const _ as *mut` hop — the vtable
        // slots (`file_polls`, `set_after_event_loop_callback`) write through
        // it.
        jsc::virtual_machine::VirtualMachine::event_loop_ctx(global_this.bun_vm_ptr())
    }

    fn should_compress(&self, data_len: usize, opcode: Opcode) -> bool {
        // Check if compression is available
        if self.deflate.is_none() {
            return false;
        }

        // Only compress Text and Binary messages
        if opcode != Opcode::Text && opcode != Opcode::Binary {
            return false;
        }

        // Don't compress small messages where overhead exceeds benefit
        if data_len < MIN_COMPRESS_SIZE {
            return false;
        }

        true
    }

    // Handler set referenced by `dispatch.zig` (kind = `.ws_client[_tls]`).
    // Replaces the C++→`register()`→`us_socket_context_on_*` round-trip.
    // In Rust: these are aliased via the dispatch table; expose the handle_* fns directly.
    // pub const onClose = handleClose; → see handle_close
    // pub const onData = handleData; → see handle_data
    // pub const onWritable = handleWritable; → see handle_writable
    // pub const onTimeout = handleTimeout; → see handle_timeout
    // pub const onLongTimeout = handleTimeout; → see handle_timeout
    // pub const onConnectError = handleConnectError; → see handle_connect_error
    // pub const onEnd = handleEnd; → see handle_end
    // pub const onHandshake = handleHandshake; → see handle_handshake

    pub fn clear_data(&mut self) {
        log!("clearData");
        self.poll_ref.unref(Self::vm_loop_ctx(&self.global_this));
        self.clear_receive_buffers(true);
        self.clear_send_buffers(true);
        self.ping_received = false;
        self.pong_received = false;
        self.ping_len = 0;
        self.close_frame_buffering = false;
        self.receive_pending_chunk_len = 0;
        self.receiving_compressed = false;
        self.message_is_compressed = false;
        // deflate is Option<Box<_>>; dropping it runs Drop
        self.deflate = None;
        if let Some(s) = self.secure.take() {
            // SAFETY: s is a valid SSL_CTX* owned by us per field invariant
            unsafe { boringssl::c::SSL_CTX_free(s) };
        }
        // Clean up proxy tunnel if we own one
        // Set to None FIRST to prevent re-entrancy (shutdown can trigger callbacks)
        if let Some(tunnel) = self.proxy_tunnel.take() {
            // Detach the websocket from the tunnel before shutdown so the
            // tunnel's onClose callback doesn't dispatch a spurious 1006
            // after we've already handled a clean close.
            let tunnel_ptr = tunnel.as_ptr();
            // SAFETY: `tunnel` holds a live ref. `clear_connected_web_socket`
            // is a single non-reentrant field write; the brief auto-ref `&mut`
            // is the only Rust borrow of the tunnel at this point.
            unsafe { (*tunnel_ptr).clear_connected_web_socket() };
            // SAFETY: `tunnel` holds a live ref. `shutdown` may synchronously
            // fire SSLWrapper callbacks that re-enter the tunnel allocation,
            // so call the raw-ptr overload which never holds a `&mut Self`
            // across the dispatch (see WebSocketProxyTunnel::shutdown).
            unsafe { WebSocketProxyTunnel::shutdown(tunnel_ptr) };
            // SAFETY: `tunnel` (NonNull) held a live intrusive ref; release it.
            unsafe { WebSocketProxyTunnel::deref(tunnel_ptr) };
            // Release the I/O-layer ref taken in init_with_tunnel() — the
            // tunnel was this struct's socket-equivalent owner. In the
            // non-tunnel path this same ref is released by handle_close()
            // when the adopted uSockets socket fires its close event, but
            // tunnel mode never adopts a socket so that callback never runs.
            // Callers that touch `self` after clear_data() must hold a local
            // ref guard (see cancel/finalize).
            // SAFETY: `self: &mut Self` coerces to `*mut Self` with write
            // provenance; allocation is live (guarded by callers' ref).
            unsafe { Self::deref(self) };
        }
    }

    pub extern "C" fn cancel(this_ptr: *mut Self) {
        log!("cancel");
        // clear_data() may drop the tunnel's I/O-layer ref; keep `*this_ptr`
        // alive until we've finished closing the socket below. ScopedRef bumps
        // the intrusive refcount now and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        // SAFETY: called from C++ with a valid `heap::alloc` pointer.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; the guard's ref keeps
        // the allocation alive past every re-entrant call below.
        let this = unsafe { &mut *this_ptr };

        let had_tunnel = this.proxy_tunnel.is_some();
        this.clear_data();

        if SSL {
            // we still want to send pending SSL buffer + close_notify
            this.tcp.close(uws::CloseKind::Normal);
        } else {
            this.tcp.close(uws::CloseKind::Failure);
        }

        // In tunnel mode tcp is .detached so close() above is a no-op and
        // handle_close() never fires. Mirror what handle_close() does for
        // the non-tunnel path: drop the C++ ref (if still held) via
        // dispatch_abrupt_close so e.g. ws.terminate() — which calls
        // cancel() then sets m_connectedWebSocketKind = None, bypassing
        // the destructor's finalize() — does not leak. When reached via
        // fail(), outgoing_websocket is already None and this is a no-op.
        if had_tunnel {
            this.dispatch_abrupt_close(ErrorCode::Ended);
        }
    }

    pub fn fail(&mut self, code: ErrorCode) {
        jsc::mark_binding!();
        if let Some(ws) = self.outgoing_websocket.take() {
            log!("fail ({})", <&'static str>::from(code));
            CppWebSocket::opaque_ref(ws.as_ptr()).did_abrupt_close(code);
            // SAFETY: `self: &mut Self` → `*mut Self`; allocation kept live by
            // the socket/tunnel I/O ref (or by caller's guard).
            unsafe { Self::deref(self) };
        }

        Self::cancel(self);
    }

    pub fn handle_handshake(
        &mut self,
        socket: Socket<SSL>,
        success: i32,
        ssl_error: us_bun_verify_error_t,
    ) {
        jsc::mark_binding!();

        let authorized = success == 1;

        log!("onHandshake({})", success);

        if let Some(ws) = self.outgoing_websocket {
            let ws_ref = CppWebSocket::opaque_ref(ws.as_ptr());
            let reject_unauthorized = ws_ref.reject_unauthorized();

            // Only reject the connection if reject_unauthorized is true
            if reject_unauthorized {
                // Check for SSL errors
                if ssl_error.error_no != 0 {
                    self.outgoing_websocket = None;
                    ws_ref.did_abrupt_close(ErrorCode::FailedToConnect);
                    return;
                }

                // Check authorization status
                if !authorized {
                    self.outgoing_websocket = None;
                    ws_ref.did_abrupt_close(ErrorCode::FailedToConnect);
                    return;
                }

                // Check server identity
                // SAFETY: native handle of an SSL socket is an SSL*
                let ssl_ptr: *mut boringssl::c::SSL = socket
                    .get_native_handle()
                    .map_or(core::ptr::null_mut(), |p| p.cast());
                // `TLSEXT_NAMETYPE_host_name` is 0 per RFC 6066 / `<openssl/tls1.h>`.
                const TLSEXT_NAMETYPE_HOST_NAME: c_int = 0;
                // SAFETY: ssl_ptr is valid for the lifetime of the socket; passing
                // null is well-defined (BoringSSL returns null).
                let servername =
                    unsafe { boringssl::c::SSL_get_servername(ssl_ptr, TLSEXT_NAMETYPE_HOST_NAME) };
                if !servername.is_null() {
                    // SAFETY: servername is a NUL-terminated C string owned by the SSL session.
                    let hostname = unsafe { bun_core::ffi::cstr(servername) }.to_bytes();
                    // SAFETY: ssl_ptr is non-null (connected SSL socket on the handshake path).
                    if !ssl_ptr.is_null()
                        && !boringssl::check_server_identity(unsafe { &mut *ssl_ptr }, hostname)
                    {
                        self.outgoing_websocket = None;
                        ws_ref.did_abrupt_close(ErrorCode::FailedToConnect);
                    }
                }
            }
            // If reject_unauthorized is false, we accept the connection regardless of SSL errors
        }
    }

    pub fn handle_close(&mut self, _socket: Socket<SSL>, _code: c_int, _reason: *mut c_void) {
        log!("onClose");
        jsc::mark_binding!();
        self.clear_data();
        self.tcp.detach();

        self.dispatch_abrupt_close(ErrorCode::Ended);

        // For the socket.
        // SAFETY: `self: &mut Self` → `*mut Self`; this is the terminal
        // release of the socket's I/O-layer ref.
        unsafe { Self::deref(self) };
    }

    pub fn terminate(&mut self, code: ErrorCode) {
        log!("terminate");
        self.fail(code);
    }

    fn clear_receive_buffers(&mut self, free: bool) {
        // PORT NOTE: Zig poked `head = 0; count = 0` directly; LinearFifo's
        // fields are private in Rust so discard everything readable instead
        // (same observable state — empty, head realigned to 0).
        self.receive_buffer
            .discard(self.receive_buffer.readable_length());

        if free {
            // TODO(port): LinearFifo::deinit → Drop semantics; reset to fresh state
            self.receive_buffer = LinearFifo::<u8, DynamicBuffer<u8>>::init();
        }

        self.receive_pending_chunk_len = 0;
        self.receive_body_remain = 0;
    }

    fn clear_send_buffers(&mut self, free: bool) {
        // PORT NOTE: see clear_receive_buffers — discard instead of poking
        // private `head`/`count`.
        self.send_buffer.discard(self.send_buffer.readable_length());
        if free {
            self.send_buffer = LinearFifo::<u8, DynamicBuffer<u8>>::init();
        }
    }

    fn dispatch_compressed_data(&mut self, data: &[u8], kind: Opcode) {
        let Some(deflate) = self.deflate.as_mut() else {
            self.terminate(ErrorCode::CompressionUnsupported);
            return;
        };

        // Decompress the data
        let mut decompressed = deflate.rare_data.array_list();
        // PORT NOTE: `defer decompressed.deinit()` → Drop on Vec

        if let Err(err) = deflate.decompress(data, &mut decompressed) {
            let error_code = match err {
                websocket_deflate::Error::InflateFailed => ErrorCode::InvalidCompressedData,
                websocket_deflate::Error::TooLarge => ErrorCode::MessageTooBig,
                websocket_deflate::Error::OutOfMemory => ErrorCode::FailedToAllocateMemory,
            };
            self.terminate(error_code);
            return;
        }

        // PORT NOTE: reshaped for borrowck — drop deflate borrow before re-borrowing self
        let items = decompressed.as_slice();
        // TODO(port): borrowck — `decompressed` borrows `deflate.rare_data`; may need to
        // copy out or restructure. Leaving as-is for Phase B.
        self.dispatch_data(items, kind);
    }

    /// Data will be cloned in C++.
    fn dispatch_data(&mut self, data: &[u8], kind: Opcode) {
        let Some(out) = self.outgoing_websocket else {
            self.clear_data();
            return;
        };
        let out = CppWebSocket::opaque_ref(out.as_ptr());

        match kind {
            Opcode::Text => {
                // this function encodes to UTF-16 if > 127
                // so we don't need to worry about latin1 non-ascii code points
                // we avoid trim since we wanna keep the utf8 validation intact
                let utf16_bytes = match strings::to_utf16_alloc(data, true, false) {
                    Ok(v) => v,
                    Err(_) => {
                        self.terminate(ErrorCode::InvalidUtf8);
                        return;
                    }
                };
                let mut outstring = ZigString::EMPTY;
                if let Some(utf16) = utf16_bytes {
                    outstring = ZigString::from16_slice(&utf16);
                    outstring.mark_global();
                    jsc::mark_binding!();
                    out.did_receive_text(false, &outstring);
                    // Ownership of the UTF-16 buffer transfers to C++: with
                    // `clone=false` and the global tag set, `Zig::toString`
                    // adopts the allocation into a `WTF::ExternalStringImpl`
                    // which `mi_free`s it later. Dropping the Vec here would
                    // be a UAF + double-free. Mirrors websocket_client.zig
                    // which never frees `utf16` locally.
                    core::mem::forget(utf16);
                } else {
                    outstring = ZigString::init(data);
                    jsc::mark_binding!();
                    out.did_receive_text(true, &outstring);
                }
            }
            Opcode::Binary | Opcode::Ping | Opcode::Pong => {
                jsc::mark_binding!();
                out.did_receive_bytes(data.as_ptr(), data.len(), kind as u8);
            }
            _ => {
                self.terminate(ErrorCode::UnexpectedOpcode);
            }
        }
    }

    pub fn consume(
        &mut self,
        data: &[u8],
        left_in_fragment: usize,
        kind: Opcode,
        is_final: bool,
    ) -> usize {
        debug_assert!(data.len() <= left_in_fragment);

        // For compressed messages, we must buffer all fragments until the message is complete
        if self.receiving_compressed {
            // Always buffer compressed data
            if !data.is_empty() {
                let writable = match self.receive_buffer.writable_with_size(data.len()) {
                    Ok(w) => w,
                    Err(_) => {
                        self.terminate(ErrorCode::Closed);
                        return 0;
                    }
                };
                writable[..data.len()].copy_from_slice(data);
                self.receive_buffer.update(data.len());
            }

            if left_in_fragment >= data.len()
                && left_in_fragment - data.len() - self.receive_pending_chunk_len == 0
            {
                self.receive_pending_chunk_len = 0;
                self.receive_body_remain = 0;
                if is_final {
                    // Decompress the complete message
                    // PORT NOTE: take ownership of the fifo so the readable
                    // slice does not alias `&mut self` while dispatching
                    // (PORTING.md §Forbidden: aliased-&mut). `dispatch_*` may
                    // call `terminate → clear_data → clear_receive_buffers(true)`
                    // which would drop the Vec backing a laundered `&[u8]`.
                    let buf = core::mem::replace(
                        &mut self.receive_buffer,
                        LinearFifo::<u8, DynamicBuffer<u8>>::init(),
                    );
                    self.dispatch_compressed_data(buf.readable_slice(0), kind);
                    drop(buf);
                    self.clear_receive_buffers(false);
                    self.receiving_compressed = false;
                    self.message_is_compressed = false;
                }
            } else {
                self.receive_pending_chunk_len = self
                    .receive_pending_chunk_len
                    .saturating_sub(left_in_fragment);
            }
            return data.len();
        }

        // Non-compressed path remains the same
        // did all the data fit in the buffer?
        // we can avoid copying & allocating a temporary buffer
        if is_final && data.len() == left_in_fragment && self.receive_pending_chunk_len == 0 {
            if self.receive_buffer.readable_length() == 0 {
                self.dispatch_data(data, kind);
                self.message_is_compressed = false;
                return data.len();
            } else if data.is_empty() {
                // PORT NOTE: take ownership of the fifo so the readable slice
                // does not alias `&mut self` while dispatching (PORTING.md
                // §Forbidden: aliased-&mut).
                let buf = core::mem::replace(
                    &mut self.receive_buffer,
                    LinearFifo::<u8, DynamicBuffer<u8>>::init(),
                );
                self.dispatch_data(buf.readable_slice(0), kind);
                drop(buf);
                self.clear_receive_buffers(false);
                self.message_is_compressed = false;
                return 0;
            }
        }

        // this must come after the above check
        if data.is_empty() {
            return 0;
        }

        let writable = self
            .receive_buffer
            .writable_with_size(data.len())
            .expect("unreachable");
        writable[..data.len()].copy_from_slice(data);
        self.receive_buffer.update(data.len());

        if left_in_fragment >= data.len()
            && left_in_fragment - data.len() - self.receive_pending_chunk_len == 0
        {
            self.receive_pending_chunk_len = 0;
            self.receive_body_remain = 0;
            if is_final {
                // PORT NOTE: take ownership of the fifo so the readable slice
                // does not alias `&mut self` while dispatching (PORTING.md
                // §Forbidden: aliased-&mut).
                let buf = core::mem::replace(
                    &mut self.receive_buffer,
                    LinearFifo::<u8, DynamicBuffer<u8>>::init(),
                );
                self.dispatch_data(buf.readable_slice(0), kind);
                drop(buf);
                self.clear_receive_buffers(false);
                self.message_is_compressed = false;
            }
        } else {
            self.receive_pending_chunk_len = self
                .receive_pending_chunk_len
                .saturating_sub(left_in_fragment);
        }
        data.len()
    }

    // PORT NOTE: takes a raw `*mut Self` instead of `&mut self` because
    // `handle_without_deinit()` re-enters this very function on the same
    // allocation (spec .zig:398-402 / 1242-1253). A live outer `&mut self`
    // across that re-entry would yield two `&mut WebSocket` to one allocation
    // (Stacked-Borrows UB), so the preamble works through `this_ptr` and only
    // materializes `&mut *this_ptr` once re-entry is no longer possible.
    //
    // The Zig `socket` parameter is dropped: every caller passed `this.tcp`
    // (the dispatch thunk wraps the same `us_socket_t*` that `adopt_group`
    // stored into `self.tcp`), so the parse loop reads `self.tcp` directly.
    //
    /// # Safety
    /// `this_ptr` must point to a live `WebSocket<SSL>` allocated via
    /// `heap::alloc` (see `init` / `init_with_tunnel`); no `&`/`&mut`
    /// borrow of `*this_ptr` may be live across this call.
    pub unsafe fn handle_data(this_ptr: *mut Self, data_: &[u8]) {
        // SAFETY: caller contract — `this_ptr` is a live `heap::alloc` pointer
        // with no outstanding `&`/`&mut` borrow (uWS dispatches from userdata).
        let this = unsafe { ThisPtr::new(this_ptr) };
        // after receiving close we should ignore the data
        if this.close_received {
            return;
        }
        // Bumps the intrusive refcount and derefs on Drop, after every
        // `&mut *this_ptr` reborrow below has ended.
        let _guard = this.ref_guard();

        // Due to scheduling, it is possible for the websocket onData
        // handler to run with additional data before the microtask queue is
        // drained.
        if let Some(initial_handler) = this.initial_data_handler {
            // This calls `handle_data`
            // We deliberately do not set self.initial_data_handler to None here, that's done in handle_without_deinit.
            // We do not free the memory here since the lifetime is managed by the microtask queue (it should free when called from there)
            // SAFETY: `initial_handler` is valid (managed by microtask queue).
            // `handle_without_deinit` re-enters `Self::handle_data` via the
            // `adopted` raw ptr (same `heap::alloc` provenance as
            // `this_ptr`); no `&mut *this_ptr` is live here, so the nested
            // call may freely form its own exclusive reborrow.
            unsafe { (*initial_handler.as_ptr()).handle_without_deinit() };

            // handle_without_deinit is supposed to clear the handler from WebSocket*
            // to prevent an infinite loop
            debug_assert!(this.initial_data_handler.is_none());

            // If we disconnected for any reason in the re-entrant case, we should just ignore the data
            if this.outgoing_websocket.is_none() || !this.has_tcp() {
                return;
            }
        }

        // No further `handle_data` re-entry on this stack frame; hand the
        // remainder to the `&mut self` parse loop. The reborrow ends before
        // `_guard` drops (LIFO), so `deref(this_ptr)` observes a clean stack.
        // SAFETY: `_guard` ref keeps `*this_ptr` live; sole owner on this thread.
        unsafe { (*this.as_ptr()).handle_data_loop(data_) };
    }

    fn handle_data_loop(&mut self, data_: &[u8]) {
        let mut data = data_;
        let mut receive_state = self.receive_state;
        let mut terminated = false;
        let mut is_fragmented = false;
        let mut receiving_type = self.receiving_type;
        let mut receive_body_remain = self.receive_body_remain;
        let mut is_final = self.receiving_is_final;
        let mut last_receive_data_type = receiving_type;

        // Zig `defer { if terminated ... else ... }` → run at end of fn
        // PORT NOTE: implemented as explicit epilogue after the loop below.

        let mut header_bytes = [0u8; size_of::<usize>()];

        // In the WebSocket specification, control frames may not be fragmented.
        // However, the frame parser should handle fragmented control frames nonetheless.
        // Whether or not the frame parser is given a set of fragmented bytes to parse is subject
        // to the strategy in which the client buffers and coalesces received bytes.

        loop {
            log!("onData ({})", <&'static str>::from(receive_state));

            match receive_state {
                // 0                   1                   2                   3
                // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
                // +-+-+-+-+-------+-+-------------+-------------------------------+
                // |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
                // |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
                // |N|V|V|V|       |S|             |   (if payload len==126/127)   |
                // | |1|2|3|       |K|             |                               |
                // +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
                // |     Extended payload length continued, if payload len == 127  |
                // + - - - - - - - - - - - - - - - +-------------------------------+
                // |                               |Masking-key, if MASK set to 1  |
                // +-------------------------------+-------------------------------+
                // | Masking-key (continued)       |          Payload Data         |
                // +-------------------------------- - - - - - - - - - - - - - - - +
                // :                     Payload Data continued ...                :
                // + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
                // |                     Payload Data continued ...                |
                // +---------------------------------------------------------------+
                ReceiveState::NeedHeader => {
                    if data.len() < 2 {
                        debug_assert!(!data.is_empty());
                        if self.header_fragment.is_none() {
                            self.header_fragment = Some(data[0]);
                            break;
                        }
                    }

                    if let Some(header_fragment) = self.header_fragment {
                        header_bytes[0] = header_fragment;
                        header_bytes[1] = data[0];
                        data = &data[1..];
                    } else {
                        header_bytes[0] = data[0];
                        header_bytes[1] = data[1];
                        data = &data[2..];
                    }
                    self.header_fragment = None;

                    receive_body_remain = 0;
                    let mut need_compression = false;
                    is_final = false;

                    receive_state = parse_websocket_header(
                        [header_bytes[0], header_bytes[1]],
                        &mut receiving_type,
                        &mut receive_body_remain,
                        &mut is_fragmented,
                        &mut is_final,
                        &mut need_compression,
                    );
                    if receiving_type == Opcode::Continue {
                        // if is final is true continue is invalid
                        if self.receiving_is_final {
                            // nothing to continue here
                            // Per Autobahn test case 5.9: "The connection is failed immediately, since there is no message to continue."
                            self.terminate(ErrorCode::UnexpectedOpcode);
                            terminated = true;
                            break;
                        }
                        // only update final if is a valid continue
                        self.receiving_is_final = is_final;
                    } else if receiving_type == Opcode::Text || receiving_type == Opcode::Binary {
                        // if the last one is not final this is invalid because we are waiting a continue
                        if !self.receiving_is_final {
                            self.terminate(ErrorCode::UnexpectedOpcode);
                            terminated = true;
                            break;
                        }
                        // for text and binary frames we need to keep track of final and type
                        self.receiving_is_final = is_final;
                        last_receive_data_type = receiving_type;
                    } else if receiving_type.is_control() && is_fragmented {
                        // Control frames must not be fragmented.
                        self.terminate(ErrorCode::ControlFrameIsFragmented);
                        terminated = true;
                        break;
                    }

                    match receiving_type {
                        Opcode::Continue
                        | Opcode::Text
                        | Opcode::Binary
                        | Opcode::Ping
                        | Opcode::Pong
                        | Opcode::Close => {}
                        _ => {
                            self.terminate(ErrorCode::UnsupportedControlFrame);
                            terminated = true;
                            break;
                        }
                    }

                    if need_compression && self.deflate.is_none() {
                        self.terminate(ErrorCode::CompressionUnsupported);
                        terminated = true;
                        break;
                    }

                    // Control frames must not be compressed
                    if need_compression && receiving_type.is_control() {
                        self.terminate(ErrorCode::InvalidControlFrame);
                        terminated = true;
                        break;
                    }

                    // Track compression state for this message
                    if receiving_type == Opcode::Text || receiving_type == Opcode::Binary {
                        // New message starts - set both compression states
                        self.message_is_compressed = need_compression;
                        self.receiving_compressed = need_compression;
                    } else if receiving_type == Opcode::Continue {
                        // Continuation frame - use the compression state from the message start
                        self.receiving_compressed = self.message_is_compressed;
                    }

                    // Handle when the payload length is 0, but it is a message
                    //
                    // This should become
                    //
                    // - ArrayBuffer(0)
                    // - ""
                    // - Buffer(0) (etc)
                    //
                    if receive_body_remain == 0
                        && receive_state == ReceiveState::NeedBody
                        && is_final
                    {
                        let _ = self.consume(
                            b"",
                            receive_body_remain,
                            last_receive_data_type,
                            is_final,
                        );

                        // Return to the header state to read the next frame
                        receive_state = ReceiveState::NeedHeader;
                        is_fragmented = false;
                        self.receiving_compressed = false;
                        self.message_is_compressed = false;

                        // Bail out if there's nothing left to read
                        if data.is_empty() {
                            break;
                        }
                    }
                }
                ReceiveState::NeedMask => {
                    self.terminate(ErrorCode::UnexpectedMaskFromServer);
                    terminated = true;
                    break;
                }
                rc @ (ReceiveState::ExtendedPayloadLength64
                | ReceiveState::ExtendedPayloadLength16) => {
                    let byte_size: usize = match rc {
                        ReceiveState::ExtendedPayloadLength64 => 8,
                        ReceiveState::ExtendedPayloadLength16 => 2,
                        _ => unreachable!(),
                    };

                    // we need to wait for more data
                    if data.is_empty() {
                        break;
                    }

                    // copy available payload length bytes to a buffer held on this client instance
                    let total_received =
                        (byte_size - self.payload_length_frame_len as usize).min(data.len());
                    let start = self.payload_length_frame_len as usize;
                    self.payload_length_frame_bytes[start..start + total_received]
                        .copy_from_slice(&data[..total_received]);
                    self.payload_length_frame_len +=
                        u8::try_from(total_received).expect("int cast");
                    data = &data[total_received..];

                    // short read on payload length - we need to wait for more data
                    // whatever bytes were returned from the short read are kept in `payload_length_frame_bytes`
                    if (self.payload_length_frame_len as usize) < byte_size {
                        break;
                    }

                    // Multibyte length quantities are expressed in network byte order
                    receive_body_remain = match byte_size {
                        8 => u64::from_be_bytes(self.payload_length_frame_bytes) as usize,
                        2 => u16::from_be_bytes([
                            self.payload_length_frame_bytes[0],
                            self.payload_length_frame_bytes[1],
                        ]) as usize,
                        _ => unreachable!(),
                    };

                    self.payload_length_frame_len = 0;

                    receive_state = ReceiveState::NeedBody;

                    if receive_body_remain == 0 {
                        // this is an error
                        // the server should've set length to zero
                        self.terminate(ErrorCode::InvalidControlFrame);
                        terminated = true;
                        break;
                    }
                }
                ReceiveState::Ping => {
                    if !self.ping_received {
                        if receive_body_remain > 125 {
                            self.terminate(ErrorCode::InvalidControlFrame);
                            terminated = true;
                            break;
                        }
                        self.ping_len = receive_body_remain as u8;
                        receive_body_remain = 0;
                        self.ping_received = true;
                    }
                    let ping_len = self.ping_len as usize;

                    if !data.is_empty() {
                        // copy the data to the ping frame
                        let total_received = ping_len.min(receive_body_remain + data.len());
                        let slice =
                            &mut self.ping_frame_bytes[6..][receive_body_remain..total_received];
                        let slice_len = slice.len();
                        slice.copy_from_slice(&data[..slice_len]);
                        receive_body_remain = total_received;
                        data = &data[slice_len..];
                    }
                    let pending_body = ping_len - receive_body_remain;
                    if pending_body > 0 {
                        // wait for more data it can be fragmented
                        break;
                    }

                    // PORT NOTE: copy the ≤125-byte payload to a stack array so
                    // the slice does not alias `&mut self` across `dispatch_data`
                    // (PORTING.md §Forbidden: aliased-&mut). `dispatch_data` may
                    // call `terminate → clear_data` which mutates `ping_frame_bytes`'
                    // bookkeeping while the laundered `&[u8]` would still be live.
                    let mut ping_data_buf = [0u8; 125];
                    ping_data_buf[..ping_len]
                        .copy_from_slice(&self.ping_frame_bytes[6..][..ping_len]);
                    self.dispatch_data(&ping_data_buf[..ping_len], Opcode::Ping);

                    receive_state = ReceiveState::NeedHeader;
                    receive_body_remain = 0;
                    receiving_type = last_receive_data_type;
                    self.ping_received = false;

                    // we need to send all pongs to pass autobahn tests
                    let _ = self.send_pong();
                    if data.is_empty() {
                        break;
                    }
                }
                ReceiveState::Pong => {
                    if !self.pong_received {
                        if receive_body_remain > 125 {
                            self.terminate(ErrorCode::InvalidControlFrame);
                            terminated = true;
                            break;
                        }
                        self.ping_len = receive_body_remain as u8;
                        receive_body_remain = 0;
                        self.pong_received = true;
                    }
                    let pong_len = self.ping_len as usize;

                    if !data.is_empty() {
                        let total_received = pong_len.min(receive_body_remain + data.len());
                        let slice =
                            &mut self.ping_frame_bytes[6..][receive_body_remain..total_received];
                        let slice_len = slice.len();
                        slice.copy_from_slice(&data[..slice_len]);
                        receive_body_remain = total_received;
                        data = &data[slice_len..];
                    }
                    let pending_body = pong_len - receive_body_remain;
                    if pending_body > 0 {
                        // wait for more data - pong payload is fragmented across TCP segments
                        break;
                    }

                    // PORT NOTE: copy the ≤125-byte payload to a stack array so
                    // the slice does not alias `&mut self` across `dispatch_data`
                    // (PORTING.md §Forbidden: aliased-&mut).
                    let mut pong_data_buf = [0u8; 125];
                    pong_data_buf[..pong_len]
                        .copy_from_slice(&self.ping_frame_bytes[6..][..pong_len]);
                    self.dispatch_data(&pong_data_buf[..pong_len], Opcode::Pong);

                    receive_state = ReceiveState::NeedHeader;
                    receive_body_remain = 0;
                    receiving_type = last_receive_data_type;
                    self.pong_received = false;

                    if data.is_empty() {
                        break;
                    }
                }
                ReceiveState::NeedBody => {
                    let to_consume = receive_body_remain.min(data.len());

                    let consumed = self.consume(
                        &data[..to_consume],
                        receive_body_remain,
                        last_receive_data_type,
                        is_final,
                    );

                    receive_body_remain -= consumed;
                    data = &data[to_consume..];
                    if receive_body_remain == 0 {
                        receive_state = ReceiveState::NeedHeader;
                        is_fragmented = false;
                    }

                    if data.is_empty() {
                        break;
                    }
                }

                ReceiveState::Close => {
                    if receive_body_remain == 1 || receive_body_remain > 125 {
                        self.terminate(ErrorCode::InvalidControlFrame);
                        terminated = true;
                        break;
                    }

                    if receive_body_remain > 0 {
                        if !self.close_frame_buffering {
                            self.ping_len = receive_body_remain as u8;
                            receive_body_remain = 0;
                            self.close_frame_buffering = true;
                        }
                        let to_copy = data.len().min(self.ping_len as usize - receive_body_remain);
                        self.ping_frame_bytes[6 + receive_body_remain..][..to_copy]
                            .copy_from_slice(&data[..to_copy]);
                        receive_body_remain += to_copy;
                        data = &data[to_copy..];
                        if receive_body_remain < self.ping_len as usize {
                            break;
                        }

                        self.close_received = true;
                        let ping_len = self.ping_len as usize;
                        // PORT NOTE: copy close_data out to avoid borrowck conflict with &mut self below
                        let mut close_data_buf = [0u8; 125];
                        close_data_buf[..ping_len]
                            .copy_from_slice(&self.ping_frame_bytes[6..][..ping_len]);
                        let close_data = &close_data_buf[..ping_len];
                        if ping_len >= 2 {
                            let mut code = u16::from_be_bytes([close_data[0], close_data[1]]);
                            if code == 1001 {
                                code = 1000;
                            }
                            if code < 1000
                                || (code >= 1004 && code < 1007)
                                || (code >= 1016 && code <= 2999)
                            {
                                code = 1002;
                            }
                            let mut buf: [u8; 125] = [0; 125];
                            buf[..ping_len - 2].copy_from_slice(&close_data[2..ping_len]);
                            self.send_close_with_body(code, Some(&mut buf), ping_len - 2);
                        } else {
                            self.send_close();
                        }
                        self.close_frame_buffering = false;
                        terminated = true;
                        break;
                    }

                    self.close_received = true;
                    self.send_close();
                    terminated = true;
                    break;
                }
                ReceiveState::Fail => {
                    self.terminate(ErrorCode::UnsupportedControlFrame);
                    terminated = true;
                    break;
                }
            }
        }

        // Zig `defer { ... }` epilogue
        if terminated {
            self.close_received = true;
        } else {
            self.receive_state = receive_state;
            self.receiving_type = last_receive_data_type;
            self.receive_body_remain = receive_body_remain;
        }
    }

    pub fn send_close(&mut self) {
        self.send_close_with_body(1000, None, 0);
    }

    // PORT NOTE: Zig passed `socket` by value (a copy of `this.tcp`). Every
    // Rust caller would have passed `self.tcp`, and threading a `&Socket<SSL>`
    // alongside `&mut self` is a Stacked-Borrows hazard (the receiver retag
    // covers `self.tcp` and invalidates any prior `&self.tcp`-derived pointer
    // before the argument is even retagged). Read `self.tcp` directly instead.
    fn enqueue_encoded_bytes(&mut self, bytes: &[u8]) -> bool {
        // For tunnel mode, write through the tunnel instead of direct socket
        if let Some(tunnel) = &self.proxy_tunnel {
            // SAFETY: `tunnel` holds a live ref (RefPtr has no `Deref`).
            // `write_data()` may fire `write_encrypted(ctx)` which reborrows
            // the tunnel allocation, so call the raw-ptr overload that never
            // holds a `&mut WebSocketProxyTunnel` across the dispatch.
            let wrote = match unsafe { WebSocketProxyTunnel::write(tunnel.as_ptr(), bytes) } {
                Ok(w) => w,
                Err(_) => {
                    self.terminate(ErrorCode::FailedToWrite);
                    return false;
                }
            };
            // Buffer any data the tunnel couldn't accept
            if wrote < bytes.len() {
                let _ = self.copy_to_send_buffer(&bytes[wrote..], false);
            }
            return true;
        }

        // fast path: no backpressure, no queue, just send the bytes.
        if !self.has_backpressure() {
            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
            let wrote = self.tcp.write(bytes);
            let expected = c_int::try_from(bytes.len()).expect("int cast");
            if wrote == expected {
                return true;
            }

            if wrote < 0 {
                self.terminate(ErrorCode::FailedToWrite);
                return false;
            }

            let _ = self
                .copy_to_send_buffer(&bytes[usize::try_from(wrote).expect("int cast")..], false);
            return true;
        }

        self.copy_to_send_buffer(bytes, true)
    }

    fn copy_to_send_buffer(&mut self, bytes: &[u8], do_write: bool) -> bool {
        self.send_data(Copy::Raw(bytes), do_write, Opcode::Binary)
    }

    fn send_data(&mut self, bytes: Copy<'_>, do_write: bool, opcode: Opcode) -> bool {
        let should_compress = self.deflate.is_some()
            && (opcode == Opcode::Text || opcode == Opcode::Binary)
            && !matches!(bytes, Copy::Raw(_));

        if should_compress {
            // For compressed messages, we need to compress the content first
            let mut temp_buffer: Option<Vec<u8>> = None;
            // PORT NOTE: Zig used deflate.rare_data.arena(); in Rust we use global mimalloc.
            // PERF(port): was rare_data arena allocator — profile in Phase B
            let content_to_compress: &[u8] = match bytes {
                Copy::Utf16(utf16) => 'brk: {
                    // Convert UTF16 to UTF8 for compression
                    let content_byte_len: usize = strings::element_length_utf16_into_utf8(utf16);
                    let mut buf = vec![0u8; content_byte_len];
                    let encode_result = strings::copy_utf16_into_utf8(&mut buf, utf16);
                    buf.truncate(encode_result.written as usize);
                    temp_buffer = Some(buf);
                    break 'brk temp_buffer.as_deref().unwrap();
                }
                Copy::Latin1(latin1) => 'brk: {
                    // Convert Latin1 to UTF8 for compression
                    let content_byte_len: usize = strings::element_length_latin1_into_utf8(latin1);
                    if content_byte_len == latin1.len() {
                        // It's all ascii, we don't need to copy it an extra time.
                        break 'brk latin1;
                    }

                    let mut buf = vec![0u8; content_byte_len];
                    let encode_result = strings::copy_latin1_into_utf8(&mut buf, latin1);
                    buf.truncate(encode_result.written as usize);
                    temp_buffer = Some(buf);
                    break 'brk temp_buffer.as_deref().unwrap();
                }
                Copy::Bytes(b) => b,
                Copy::Raw(_) => unreachable!(),
            };

            // Check if compression is worth it
            if !self.should_compress(content_to_compress.len(), opcode) {
                return self.send_data_uncompressed(bytes, do_write, opcode);
            }

            {
                // Compress the content
                let mut compressed: Vec<u8> = Vec::new();
                // PERF(port): was rare_data allocator — profile in Phase B

                if self
                    .deflate
                    .as_mut()
                    .unwrap()
                    .compress(content_to_compress, &mut compressed)
                    .is_err()
                {
                    // If compression fails, fall back to uncompressed
                    return self.send_data_uncompressed(bytes, do_write, opcode);
                }

                // Create the compressed frame
                let frame_size = WebsocketHeader::frame_size_including_mask(compressed.len());
                let writable = match self.send_buffer.writable_with_size(frame_size) {
                    Ok(w) => w,
                    Err(_) => return false,
                };
                Copy::copy_compressed(
                    &self.global_this,
                    &mut writable[..frame_size],
                    &compressed,
                    opcode,
                    true,
                );
                self.send_buffer.update(frame_size);
            }

            if do_write {
                #[cfg(debug_assertions)]
                {
                    if self.proxy_tunnel.is_none() {
                        debug_assert!(!self.tcp.is_shutdown());
                        debug_assert!(!self.tcp.is_closed());
                        debug_assert!(self.tcp.is_established());
                    }
                }
                return self.send_buffer_out();
            }
        } else {
            return self.send_data_uncompressed(bytes, do_write, opcode);
        }

        true
    }

    fn send_data_uncompressed(&mut self, bytes: Copy<'_>, do_write: bool, opcode: Opcode) -> bool {
        let mut content_byte_len: usize = 0;
        let write_len = bytes.len(&mut content_byte_len);
        debug_assert!(write_len > 0);

        let writable = self
            .send_buffer
            .writable_with_size(write_len)
            .expect("unreachable");
        bytes.copy(
            &self.global_this,
            &mut writable[..write_len],
            content_byte_len,
            opcode,
        );
        self.send_buffer.update(write_len);

        if do_write {
            #[cfg(debug_assertions)]
            {
                if self.proxy_tunnel.is_none() {
                    debug_assert!(!self.tcp.is_shutdown());
                    debug_assert!(!self.tcp.is_closed());
                    debug_assert!(self.tcp.is_established());
                }
            }
            return self.send_buffer_out();
        }

        true
    }

    // PORT NOTE: renamed from `sendBuffer` to avoid clash with `send_buffer`
    // field. Reshaped to take no slice argument: every caller in the Zig
    // passed `this.send_buffer.readableSlice(0)`, and laundering that slice
    // through `from_raw_parts` while holding `&mut self` is aliased-&mut UB
    // (PORTING.md §Forbidden). Instead, take ownership of the fifo, write its
    // readable region, then restore. The Zig pointer-equality check becomes
    // unconditional `discard`.
    fn send_buffer_out(&mut self) -> bool {
        let mut buf = core::mem::replace(
            &mut self.send_buffer,
            LinearFifo::<u8, DynamicBuffer<u8>>::init(),
        );
        // Do not use MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
        let wrote: Result<usize, bool> = {
            let out_buf = buf.readable_slice(0);
            debug_assert!(!out_buf.is_empty());
            if let Some(tunnel) = &self.proxy_tunnel {
                // In tunnel mode, route through the tunnel's TLS layer
                // instead of the detached raw socket.
                // SAFETY: `tunnel` holds a live ref (RefPtr has no `Deref`).
                // Use the raw-ptr `write` overload — `write_data()` may fire
                // `write_encrypted(ctx)` which reborrows the tunnel; never
                // hold a `&mut WebSocketProxyTunnel` across that dispatch.
                match unsafe { WebSocketProxyTunnel::write(tunnel.as_ptr(), out_buf) } {
                    Ok(w) => Ok(w),
                    Err(_) => Err(true),
                }
            } else if self.tcp.is_closed() {
                Err(false)
            } else {
                let w = self.tcp.write(out_buf);
                if w < 0 {
                    Err(true)
                } else {
                    Ok(usize::try_from(w).expect("int cast"))
                }
            }
        };
        match wrote {
            Ok(wrote) => {
                buf.discard(wrote);
                self.send_buffer = buf;
                true
            }
            Err(true) => {
                // `terminate → clear_data` resets `send_buffer`; drop the
                // taken fifo without restoring.
                drop(buf);
                self.terminate(ErrorCode::FailedToWrite);
                false
            }
            Err(false) => {
                self.send_buffer = buf;
                false
            }
        }
    }

    fn send_pong(&mut self) -> bool {
        if !self.has_tcp() {
            self.dispatch_abrupt_close(ErrorCode::Ended);
            return false;
        }

        // PORT NOTE: Zig `@bitCast(@as(u16, 0))`; WebsocketHeader has no public
        // raw-bits ctor, so build the all-zero header via from_slice.
        let mut header = WebsocketHeader::from_slice([0, 0]);
        header.set_final(true);
        header.set_opcode(Opcode::Pong);

        header.set_mask(true);
        header.set_len((self.ping_len & 0x7F) as u8); // @truncate to u7
        let header_slice = header.slice();
        self.ping_frame_bytes[0] = header_slice[0];
        self.ping_frame_bytes[1] = header_slice[1];

        let ping_len = self.ping_len as usize;
        if ping_len > 0 {
            // PORT NOTE: reshaped for borrowck — Mask::fill needs disjoint borrows of ping_frame_bytes
            let (head, tail) = self.ping_frame_bytes.split_at_mut(6);
            let mask_buf: &mut [u8; 4] = (&mut head[2..6])
                .try_into()
                .expect("infallible: size matches");
            let to_mask = &mut tail[..ping_len];
            // SAFETY: input and output point to the same memory; Mask::fill supports in-place
            Mask::fill_in_place(&self.global_this, mask_buf, to_mask);
            // PORT NOTE: copy the ≤(6+125)-byte frame to a stack array so the
            // slice does not alias `&mut self` across `enqueue_encoded_bytes`
            // (PORTING.md §Forbidden: aliased-&mut). `enqueue_encoded_bytes`
            // may call `terminate → clear_data` while the laundered slice into
            // `self.ping_frame_bytes` would still be live.
            let frame_len = 6 + ping_len;
            let mut frame_buf = [0u8; 6 + 125];
            frame_buf[..frame_len].copy_from_slice(&self.ping_frame_bytes[..frame_len]);
            self.enqueue_encoded_bytes(&frame_buf[..frame_len])
        } else {
            self.ping_frame_bytes[2..6].fill(0); // autobahn tests require that we mask empty pongs
            let mut frame_buf = [0u8; 6];
            frame_buf.copy_from_slice(&self.ping_frame_bytes[..6]);
            self.enqueue_encoded_bytes(&frame_buf)
        }
    }

    fn send_close_with_body(&mut self, code: u16, body: Option<&mut [u8; 125]>, body_len: usize) {
        log!("Sending close with code {}", code);
        if !self.has_tcp() {
            self.dispatch_abrupt_close(ErrorCode::Ended);
            self.clear_data();
            return;
        }
        // we dont wanna shutdownRead when SSL, because SSL handshake can happen when writting
        // For tunnel mode, shutdownRead on the detached socket is a no-op; skip it.
        if !SSL {
            if self.proxy_tunnel.is_none() {
                self.tcp.shutdown_read();
            }
        }
        let mut final_body_bytes = [0u8; 128 + 8];
        // PORT NOTE: Zig `@bitCast(@as(u16, 0))`; WebsocketHeader has no public
        // raw-bits ctor, so build the all-zero header via from_slice.
        let mut header = WebsocketHeader::from_slice([0, 0]);
        header.set_final(true);
        header.set_opcode(Opcode::Close);
        header.set_mask(true);
        header.set_len(((body_len + 2) & 0x7F) as u8); // @truncate to u7
        let header_slice = header.slice();
        final_body_bytes[0] = header_slice[0];
        final_body_bytes[1] = header_slice[1];
        // mask_buf at [2..6]
        final_body_bytes[6..8].copy_from_slice(&code.to_be_bytes());

        let mut reason = bun_core::String::empty();
        if let Some(data) = body {
            if body_len > 0 {
                let body_slice = &data[..body_len];
                // close is always utf8
                if !strings::is_valid_utf8(body_slice) {
                    self.terminate(ErrorCode::InvalidUtf8);
                    return;
                }
                reason = bun_core::String::clone_utf8(body_slice);
                final_body_bytes[8..][..body_len].copy_from_slice(body_slice);
            }
        }

        // we must mask the code
        let slice_len = 8 + body_len;
        {
            let (head, tail) = final_body_bytes.split_at_mut(6);
            let mask_buf: &mut [u8; 4] = (&mut head[2..6])
                .try_into()
                .expect("infallible: size matches");
            let payload = &mut tail[..slice_len - 6];
            Mask::fill_in_place(&self.global_this, mask_buf, payload);
        }
        let slice = &final_body_bytes[..slice_len];

        if self.enqueue_encoded_bytes(slice) {
            self.clear_data();
            self.dispatch_close(code, &mut reason);
        }
    }

    pub fn is_same_socket(&self, socket: &Socket<SSL>) -> bool {
        socket.socket == self.tcp.socket
    }

    pub fn handle_end(&mut self, socket: Socket<SSL>) {
        debug_assert!(self.is_same_socket(&socket));
        self.terminate(ErrorCode::Ended);
    }

    pub fn handle_writable(&mut self, socket: Socket<SSL>) {
        if self.close_received {
            return;
        }
        debug_assert!(self.is_same_socket(&socket));
        if self.send_buffer.readable_length() == 0 {
            return;
        }
        let _ = self.send_buffer_out();
    }

    pub fn handle_timeout(&mut self, _socket: Socket<SSL>) {
        self.terminate(ErrorCode::Timeout);
    }

    pub fn handle_connect_error(&mut self, _socket: Socket<SSL>, _errno: c_int) {
        self.tcp.detach();
        self.terminate(ErrorCode::FailedToConnect);
    }

    pub fn has_backpressure(&self) -> bool {
        if self.send_buffer.readable_length() > 0 {
            return true;
        }
        if let Some(tunnel) = &self.proxy_tunnel {
            // SAFETY: `tunnel` holds a live ref (RefPtr has no `Deref`).
            return unsafe { tunnel.as_ref() }.has_backpressure();
        }
        false
    }

    pub extern "C" fn write_binary_data(this_ptr: *mut Self, ptr: *const u8, len: usize, op: u8) {
        // In tunnel mode, SSLWrapper.writeData() can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before the catch block in enqueue_encoded_bytes/send_buffer runs.
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &mut *this_ptr };

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        let opcode = Opcode::from_raw(op);
        // SAFETY: ptr/len from C++; caller guarantees valid slice. Empty Blob
        // sends (null, 0); `ffi::slice` tolerates that shape.
        let slice: &[u8] = unsafe { bun_core::ffi::slice(ptr, len) };
        let bytes = Copy::Bytes(slice);
        // fast path: small frame, no backpressure, attempt to send without allocating
        let frame_size = WebsocketHeader::frame_size_including_mask(len);
        if !this.has_backpressure() && frame_size < STACK_FRAME_SIZE {
            let mut inline_buf = [0u8; STACK_FRAME_SIZE];
            bytes.copy(
                &this.global_this,
                &mut inline_buf[..frame_size],
                slice.len(),
                opcode,
            );
            let _ = this.enqueue_encoded_bytes(&inline_buf[..frame_size]);
            return;
        }

        let _ = this.send_data(bytes, !this.has_backpressure(), opcode);
    }

    fn has_tcp(&self) -> bool {
        // For tunnel mode, we have an active connection through the tunnel
        if self.proxy_tunnel.is_some() {
            return true;
        }
        !self.tcp.is_closed() && !self.tcp.is_shutdown()
    }

    pub extern "C" fn write_blob(this_ptr: *mut Self, blob_value: JSValue, op: u8) {
        // See write_binary_data() — tunnel.write() can re-enter fail().
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &mut *this_ptr };

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        let opcode = Opcode::from_raw(op);

        // Cast the JSValue to a Blob.
        // PORT NOTE: `bun_jsc::webcore::Blob` is an opaque C-ABI shim (real
        // layout lives in `bun_runtime::webcore::Blob`, a higher-tier crate).
        // `from_js`/`shared_view` trampoline through extern fns to avoid the
        // dep cycle — see `bun_jsc::webcore::Blob` impl block.
        if let Some(blob) = blob_value.as_::<bun_jsc::webcore::Blob>() {
            // Get the shared view of the blob data
            // SAFETY: `as_` returned a live `*mut Blob` owned by the JS heap;
            // the JSValue is rooted by the caller for the duration of this call.
            let data = unsafe { (*blob).shared_view() };
            if data.is_empty() {
                // Empty blob, send empty frame
                let bytes = Copy::Bytes(&[]);
                let _ = this.send_data(bytes, !this.has_backpressure(), opcode);
                return;
            }

            // Send the blob data similar to write_binary_data
            let bytes = Copy::Bytes(data);

            // Fast path for small blobs
            let frame_size = WebsocketHeader::frame_size_including_mask(data.len());
            if !this.has_backpressure() && frame_size < STACK_FRAME_SIZE {
                let mut inline_buf = [0u8; STACK_FRAME_SIZE];
                bytes.copy(
                    &this.global_this,
                    &mut inline_buf[..frame_size],
                    data.len(),
                    opcode,
                );
                let _ = this.enqueue_encoded_bytes(&inline_buf[..frame_size]);
                return;
            }

            let _ = this.send_data(bytes, !this.has_backpressure(), opcode);
        } else {
            // Invalid blob, close connection
            this.dispatch_abrupt_close(ErrorCode::Ended);
        }
    }

    pub extern "C" fn write_string(this_ptr: *mut Self, str_: *const ZigString, op: u8) {
        // See write_binary_data() — tunnel.write() can re-enter fail().
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &mut *this_ptr };

        // SAFETY: str_ is a valid pointer from C++
        let str = unsafe { &*str_ };
        if !this.has_tcp() {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        // Note: 0 is valid

        let opcode = Opcode::from_raw(op & 0x0F);
        {
            let mut inline_buf = [0u8; STACK_FRAME_SIZE];

            // fast path: small frame, no backpressure, attempt to send without allocating
            if !str.is_16bit() && str.len < STACK_FRAME_SIZE {
                let bytes = Copy::Latin1(str.slice());
                let mut byte_len: usize = 0;
                let frame_size = bytes.len(&mut byte_len);
                if !this.has_backpressure() && frame_size < STACK_FRAME_SIZE {
                    bytes.copy(
                        &this.global_this,
                        &mut inline_buf[..frame_size],
                        byte_len,
                        opcode,
                    );
                    let _ = this.enqueue_encoded_bytes(&inline_buf[..frame_size]);
                    return;
                }
                // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
            } else if (str.len * 4) < STACK_FRAME_SIZE && !this.has_backpressure() {
                let bytes = Copy::Utf16(str.utf16_slice_aligned());
                let mut byte_len: usize = 0;
                let frame_size = bytes.len(&mut byte_len);
                debug_assert!(frame_size <= STACK_FRAME_SIZE);
                bytes.copy(
                    &this.global_this,
                    &mut inline_buf[..frame_size],
                    byte_len,
                    opcode,
                );
                let _ = this.enqueue_encoded_bytes(&inline_buf[..frame_size]);
                return;
            }
        }

        let _ = this.send_data(
            if str.is_16bit() {
                Copy::Utf16(str.utf16_slice_aligned())
            } else {
                Copy::Latin1(str.slice())
            },
            !this.has_backpressure(),
            opcode,
        );
    }

    fn dispatch_abrupt_close(&mut self, code: ErrorCode) {
        let Some(out) = self.outgoing_websocket.take() else {
            return;
        };
        self.poll_ref.unref(Self::vm_loop_ctx(&self.global_this));
        jsc::mark_binding!();
        CppWebSocket::opaque_ref(out.as_ptr()).did_abrupt_close(code);
        // SAFETY: `self: &mut Self` → `*mut Self`; allocation kept live by
        // caller's ref guard (see cancel/handle_close).
        unsafe { Self::deref(self) };
    }

    fn dispatch_close(&mut self, code: u16, reason: &mut bun_core::String) {
        let Some(out) = self.outgoing_websocket.take() else {
            return;
        };
        self.poll_ref.unref(Self::vm_loop_ctx(&self.global_this));
        jsc::mark_binding!();
        CppWebSocket::opaque_ref(out.as_ptr()).did_close(code, reason);
        // SAFETY: `self: &mut Self` → `*mut Self`; allocation kept live by
        // caller's ref guard.
        unsafe { Self::deref(self) };
    }

    pub extern "C" fn close(this_ptr: *mut Self, code: u16, reason: *const ZigString) {
        // In tunnel mode, SSLWrapper.writeData() (via send_close_with_body →
        // enqueue_encoded_bytes → tunnel.write) can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before send_close_with_body's own clear_data/dispatch_close run.
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &mut *this_ptr };

        if !this.has_tcp() {
            return;
        }
        let mut close_reason_buf = [0u8; 128];
        // SAFETY: reason is null or a valid *const ZigString from C++
        if let Some(str) = unsafe { reason.as_ref() } {
            'inner: {
                // Zig: FixedBufferAllocator + allocPrint("{f}", .{str}) — the
                // `{f}` formatter writes the string in UTF-8 regardless of
                // backing encoding. `ZigString` has no `Display` impl yet, so
                // replicate the encoding switch directly: 8-bit copies bytes,
                // 16-bit transcodes via `to_owned_slice()` (UTF-16 → UTF-8).
                use std::io::Write;
                let mut cursor = std::io::Cursor::new(&mut close_reason_buf[..]);
                if str.is_16bit() {
                    // Allocates; close-reason is bounded ≤125 bytes and this
                    // path is cold (close handshake).
                    let utf8 = str.to_owned_slice();
                    if cursor.write_all(&utf8).is_err() {
                        break 'inner;
                    }
                } else if str.is_utf8() {
                    // Already UTF-8-tagged: bytes are valid UTF-8 verbatim.
                    if cursor.write_all(str.slice()).is_err() {
                        break 'inner;
                    }
                } else {
                    // 8-bit Latin-1. Spec websocket_client.zig:1224 routes
                    // through `ZigString.format` → `bun.fmt.formatLatin1`,
                    // transcoding Latin-1 → UTF-8. Writing raw Latin-1 bytes
                    // here would fail the UTF-8 check in `send_close_with_body`
                    // and terminate(InvalidUtf8) instead of sending the frame.
                    let pos = cursor.position() as usize;
                    let dst = &mut cursor.get_mut()[pos..];
                    let result = strings::copy_latin1_into_utf8(dst, str.slice());
                    if (result.read as usize) < str.slice().len() {
                        // Mirrors Zig `error.NoSpaceLeft` from FixedBufferAllocator.
                        break 'inner;
                    }
                    cursor.set_position((pos + result.written as usize) as u64);
                }
                let wrote_len = cursor.position() as usize;
                // SAFETY: close_reason_buf has 128 bytes; reinterpret first 125 as fixed array
                let buf_ptr = close_reason_buf.as_mut_ptr().cast::<[u8; 125]>();
                this.send_close_with_body(code, Some(unsafe { &mut *buf_ptr }), wrote_len);
                return;
            }
        }

        this.send_close_with_body(code, None, 0);
    }

    pub extern "C" fn init(
        outgoing: *mut CppWebSocket,
        input_socket: *mut c_void,
        global_this: &JSGlobalObject,
        buffered_data: *mut u8,
        buffered_data_len: usize,
        deflate_params: Option<&websocket_deflate::Params>,
        secure_ptr: *mut c_void,
    ) -> *mut c_void {
        let tcp = input_socket.cast::<us_socket_t>();
        // outlives this call.
        let vm = global_this.bun_vm().as_mut();
        let ws = bun_core::heap::into_raw(Box::new(WebSocket::<SSL> {
            ref_count: Cell::new(1),
            tcp: Socket::<SSL>::detached(),
            outgoing_websocket: NonNull::new(outgoing),
            receive_state: ReceiveState::NeedHeader,
            receiving_type: Opcode::ResB,
            receiving_is_final: true,
            ping_frame_bytes: [0u8; 128 + 6],
            ping_len: 0,
            ping_received: false,
            pong_received: false,
            close_received: false,
            close_frame_buffering: false,
            receive_frame: 0,
            receive_body_remain: 0,
            receive_pending_chunk_len: 0,
            receive_buffer: LinearFifo::<u8, DynamicBuffer<u8>>::init(),
            send_buffer: LinearFifo::<u8, DynamicBuffer<u8>>::init(),
            global_this: GlobalRef::from(global_this),
            poll_ref: KeepAlive::init(),
            header_fragment: None,
            payload_length_frame_bytes: [0u8; 8],
            payload_length_frame_len: 0,
            initial_data_handler: None,
            // PORT NOTE: reshaped for borrowck — `vm.event_loop()` returns a
            // `&'static`-tied borrow that would lock `vm` for the rest of the
            // fn; re-derive from `global_this` so `vm` stays usable below.
            // SAFETY: bun_vm() never returns null; event_loop ptr is live for VM lifetime.
            event_loop: global_this.bun_vm().event_loop_mut(),
            deflate: None,
            receiving_compressed: false,
            message_is_compressed: false,
            secure: if secure_ptr.is_null() {
                None
            } else {
                Some(secure_ptr.cast::<SslCtx>())
            },
            proxy_tunnel: None,
        }));
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::ALLOC_TYPE_NAME, ws);
        // SAFETY: ws was just allocated via heap::alloc
        let ws_ref = unsafe { &mut *ws };

        if let Some(params) = deflate_params {
            match WebSocketDeflate::init(*params, vm.rare_data()) {
                Ok(deflate) => ws_ref.deflate = Some(deflate),
                Err(_) => ws_ref.deflate = None,
            }
        }

        // PORT NOTE: Zig `adoptGroup(tcp, group, kind, "tcp", ws)` reflected on
        // the field name; Rust port takes a closure to write the new socket.
        let group = {
            // PORT NOTE: reshaped for borrowck — `rare_data()` borrows `vm`
            // mutably and `ws_client_group` also wants a `vm` reference.
            let vm_ptr: *mut _ = vm;
            // SAFETY: `rare_data()` returns `&mut RareData` reached through
            // `vm.rare_data: Option<Box<RareData>>`, i.e. a SEPARATE heap
            // allocation behind a `Box` — the returned `&mut` does not cover
            // any byte of `*vm_ptr` itself, so forming `&*vm_ptr` alongside
            // it is non-overlapping under Stacked Borrows. `lazy_group` only
            // reads `vm.uws_loop()` / `vm.event_loop_handle` and never touches
            // `vm.rare_data`, so the shared `&VirtualMachine` argument cannot
            // observe or invalidate the `&mut RareData` receiver.
            unsafe { (*vm_ptr).rare_data().ws_client_group::<SSL>(&*vm_ptr) }
        };
        if !Socket::<SSL>::adopt_group(
            tcp,
            group,
            if SSL {
                uws::DispatchKind::WsClientTls
            } else {
                uws::DispatchKind::WsClient
            },
            ws,
            // SAFETY: `owner == ws` is a valid live allocation; raw-ptr field
            // write avoids materializing a second `&mut` that would alias
            // `ws_ref` above (Zig's `@field(owner, "tcp") = ...` equivalent).
            |owner, sock| unsafe { core::ptr::addr_of_mut!((*owner).tcp).write(sock) },
        ) {
            // SAFETY: `ws` is the `heap::alloc` allocation just created
            // above; sole owner on this failure path.
            unsafe { Self::deref(ws) };
            return core::ptr::null_mut();
        }

        bun_core::handle_oom(ws_ref.send_buffer.ensure_total_capacity(2048));
        bun_core::handle_oom(ws_ref.receive_buffer.ensure_total_capacity(2048));
        ws_ref.poll_ref.r#ref(Self::vm_loop_ctx(global_this));

        if buffered_data_len > 0 {
            // SAFETY: buffered_data/len from C++; caller guarantees validity.
            // The upgrade client allocated this buffer via `bun.default_allocator`
            // (mimalloc) and transfers ownership to us — Zig's
            // `InitialDataHandler.deinit` frees it with `bun.default_allocator.free`.
            // The Rust global allocator is also mimalloc, so `heap::take`
            // adopts the original allocation (no copy) and `Drop` will `mi_free` it.
            let buffered_slice: Box<[u8]> = unsafe {
                bun_core::heap::take(core::slice::from_raw_parts_mut(
                    buffered_data,
                    buffered_data_len,
                ))
            };
            let initial_data = bun_core::heap::into_raw(Box::new(InitialDataHandler::<SSL> {
                adopted: NonNull::new(ws),
                slice: buffered_slice,
                // We need to ref the outgoing websocket so that it doesn't get
                // finalized before the initial data handler is called.
                // SAFETY: outgoing is a valid CppWebSocket* (extern-C contract);
                // it outlives the handler — `handle_without_deinit` drops the
                // ref before C++ can finalize.
                ws: NonNull::new(outgoing).map(|p| unsafe { CppWebSocketRef::new(p) }),
            }));

            // Use a higher-priority callback for the initial onData handler
            // PORT NOTE: `queue_microtask_callback` takes an erased
            // `(*mut c_void, unsafe extern "C" fn(*mut c_void))`; cast both.
            global_this.queue_microtask_callback(
                initial_data.cast::<c_void>(),
                InitialDataHandler::<SSL>::handle,
            );
        }

        // And lastly, ref the new websocket since C++ has a reference to it
        ws_ref.ref_();

        ws.cast::<c_void>()
    }

    /// Initialize a WebSocket client that uses a proxy tunnel for I/O.
    /// Used for wss:// through HTTP proxy where TLS is handled by the tunnel.
    /// The tunnel takes ownership of socket I/O, and this client reads/writes through it.
    pub extern "C" fn init_with_tunnel(
        outgoing: *mut CppWebSocket,
        tunnel_ptr: *mut c_void,
        global_this: &JSGlobalObject,
        buffered_data: *mut u8,
        buffered_data_len: usize,
        deflate_params: Option<&websocket_deflate::Params>,
    ) -> *mut c_void {
        // SAFETY: tunnel_ptr is a valid *WebSocketProxyTunnel from C++ with an
        // intrusive refcount. The caller retains its own ref; we bump to take
        // ownership (Zig: tunnel.ref()).
        // PORT NOTE: Zig `tunnel.ref()` then store — bump the intrusive count
        // and store the raw owning handle (released in `clear_data`).
        let tunnel_owned: NonNull<WebSocketProxyTunnel> = {
            let p = tunnel_ptr.cast::<WebSocketProxyTunnel>();
            // SAFETY: caller passes a live tunnel pointer (extern-C contract).
            unsafe { (*p).ref_() };
            NonNull::new(p).expect("extern-C contract: tunnel_ptr is non-null")
        };

        // ref_count starts at 1: this is the I/O-layer ref, owned by the
        // tunnel connection (analogous to the adopted-socket ref in init()
        // that handle_close() releases). It is released in clear_data() when
        // proxy_tunnel is detached. The ws.ref() below adds the C++ ref
        // paired with m_connectedWebSocket.
        // outlives this call.
        let vm = global_this.bun_vm().as_mut();
        let ws = bun_core::heap::into_raw(Box::new(WebSocket::<SSL> {
            ref_count: Cell::new(1),
            tcp: Socket::<SSL>::detached(), // No direct socket - using tunnel
            outgoing_websocket: NonNull::new(outgoing),
            receive_state: ReceiveState::NeedHeader,
            receiving_type: Opcode::ResB,
            receiving_is_final: true,
            ping_frame_bytes: [0u8; 128 + 6],
            ping_len: 0,
            ping_received: false,
            pong_received: false,
            close_received: false,
            close_frame_buffering: false,
            receive_frame: 0,
            receive_body_remain: 0,
            receive_pending_chunk_len: 0,
            receive_buffer: LinearFifo::<u8, DynamicBuffer<u8>>::init(),
            send_buffer: LinearFifo::<u8, DynamicBuffer<u8>>::init(),
            global_this: GlobalRef::from(global_this),
            poll_ref: KeepAlive::init(),
            header_fragment: None,
            payload_length_frame_bytes: [0u8; 8],
            payload_length_frame_len: 0,
            initial_data_handler: None,
            // PORT NOTE: reshaped for borrowck — `vm.event_loop()` returns a
            // `&'static`-tied borrow that would lock `vm` for the rest of the
            // fn; re-derive from `global_this` so `vm` stays usable below.
            // SAFETY: bun_vm() never returns null; event_loop ptr is live for VM lifetime.
            event_loop: global_this.bun_vm().event_loop_mut(),
            deflate: None,
            receiving_compressed: false,
            message_is_compressed: false,
            secure: None,
            proxy_tunnel: Some(tunnel_owned),
        }));
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::ALLOC_TYPE_NAME, ws);
        // SAFETY: ws was just allocated via heap::alloc
        let ws_ref = unsafe { &mut *ws };

        if let Some(params) = deflate_params {
            match WebSocketDeflate::init(*params, vm.rare_data()) {
                Ok(deflate) => ws_ref.deflate = Some(deflate),
                Err(_) => ws_ref.deflate = None,
            }
        }

        bun_core::handle_oom(ws_ref.send_buffer.ensure_total_capacity(2048));
        bun_core::handle_oom(ws_ref.receive_buffer.ensure_total_capacity(2048));
        ws_ref.poll_ref.r#ref(Self::vm_loop_ctx(global_this));

        if buffered_data_len > 0 {
            // SAFETY: see `init()` — adopt the C++ mimalloc-owned buffer
            // directly so it is freed (not leaked) when the handler drops.
            let buffered_slice: Box<[u8]> = unsafe {
                bun_core::heap::take(core::slice::from_raw_parts_mut(
                    buffered_data,
                    buffered_data_len,
                ))
            };
            let initial_data = bun_core::heap::into_raw(Box::new(InitialDataHandler::<SSL> {
                adopted: NonNull::new(ws),
                slice: buffered_slice,
                // SAFETY: outgoing is a valid CppWebSocket* (extern-C contract);
                // it outlives the handler — `handle_without_deinit` drops the
                // ref before C++ can finalize.
                ws: NonNull::new(outgoing).map(|p| unsafe { CppWebSocketRef::new(p) }),
            }));
            // PORT NOTE: `queue_microtask_callback` takes an erased
            // `(*mut c_void, unsafe extern "C" fn(*mut c_void))`; cast both.
            global_this.queue_microtask_callback(
                initial_data.cast::<c_void>(),
                InitialDataHandler::<SSL>::handle,
            );
        }

        ws_ref.ref_();

        ws.cast::<c_void>()
    }

    /// Handle data received from the proxy tunnel (already decrypted).
    /// Called by the WebSocketProxyTunnel when it receives and decrypts data.
    ///
    /// # Safety
    /// `this_ptr` must point to a live `WebSocket<SSL>` allocated via
    /// `heap::alloc`; no `&`/`&mut` borrow of `*this_ptr` may be live across
    /// this call (the tunnel calls through its raw `connected_websocket` backref).
    pub unsafe fn handle_tunnel_data(this_ptr: *mut Self, data: &[u8]) {
        // Process the decrypted data as if it came from the socket
        // has_tcp() now returns true for tunnel mode, so this will work correctly
        // SAFETY: forwarded — see `handle_data`'s contract.
        unsafe { Self::handle_data(this_ptr, data) };
    }

    /// Called by the WebSocketProxyTunnel when the underlying socket drains.
    /// Flushes any buffered plaintext data through the tunnel.
    ///
    /// # Safety
    /// `this_ptr` must point to a live `WebSocket<SSL>` allocated via
    /// `heap::alloc`; no `&`/`&mut` borrow of `*this_ptr` may be live across
    /// this call.
    pub unsafe fn handle_tunnel_writable(this_ptr: *mut Self) {
        // SAFETY: caller contract — `this_ptr` is a live `heap::alloc` pointer
        // (the tunnel calls through its raw `connected_websocket` backref).
        let this = unsafe { ThisPtr::new(this_ptr) };
        if this.close_received {
            return;
        }
        // send_buffer → tunnel.write() can re-enter fail() synchronously
        // (see write_binary_data). The tunnel ref-guards itself in
        // on_writable() but not this struct.
        let _guard = this.ref_guard();

        if this.send_buffer.readable_length() == 0 {
            return;
        }
        // SAFETY: `_guard` ref keeps `*this_ptr` live; sole owner on this
        // thread. The auto-ref `&mut *this_ptr` ends before `_guard` drops.
        let _ = unsafe { (*this.as_ptr()).send_buffer_out() };
    }

    pub extern "C" fn finalize(this_ptr: *mut Self) {
        log!("finalize");
        // clear_data() may drop the tunnel's I/O-layer ref and the block
        // below drops the C++ ref; keep `*this_ptr` alive until we've
        // finished the tcp close check.
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &mut *this_ptr };

        this.clear_data();

        // This is only called by outgoing_websocket.
        if this.outgoing_websocket.is_some() {
            this.outgoing_websocket = None;
            // SAFETY: `this: &mut Self` → `*mut Self`; allocation kept live by
            // the local `r#ref()` guard above.
            unsafe { Self::deref(this) };
        }

        if !this.tcp.is_closed() {
            // no need to be .failure we still wanna to send pending SSL buffer + close_notify
            if SSL {
                this.tcp.close(uws::CloseKind::Normal);
            } else {
                this.tcp.close(uws::CloseKind::Failure);
            }
        }
    }

    // PORT NOTE: `deinit` is the IntrusiveRc destructor callback; not `impl Drop` because
    // self is heap-allocated via heap::alloc and crosses FFI as *mut c_void.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: called once when ref_count hits zero
        let this_ref = unsafe { &mut *this };
        this_ref.clear_data();
        // deflate already dropped in clear_data; this is defensive parity with Zig
        this_ref.deflate = None;
        bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::ALLOC_TYPE_NAME, this);
        // SAFETY: this was allocated via heap::alloc in init/init_with_tunnel
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub extern "C" fn memory_cost(this: *const Self) -> usize {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &*this };
        let mut cost: usize = size_of::<Self>();
        cost += this.send_buffer.capacity();
        cost += this.receive_buffer.capacity();
        // This is under-estimated a little, as we don't include usockets context.
        cost
    }
}

// ──────────────────────────────────────────────────────────────────────────
// exportAll() — comptime @export with name concat
// ──────────────────────────────────────────────────────────────────────────
// TODO(port): Zig's `@export(&fn, .{.name = "Bun__" ++ name ++ "__fn"})` with
// comptime string concat cannot be expressed generically in Rust (no_mangle
// requires a literal). Emit two monomorphized #[no_mangle] shims per fn via macro.

// PORT NOTE: avoids the `paste` crate by passing the nine fully-qualified
// `#[no_mangle]` idents at the call site (declare-site macro). Zig's
// comptime `++` concat has no Rust equivalent for `#[no_mangle]` literals.
macro_rules! export_websocket_client {
    (
        $ssl:expr,
        cancel = $cancel:ident,
        close = $close:ident,
        finalize = $finalize:ident,
        init = $init:ident,
        init_with_tunnel = $init_with_tunnel:ident,
        memory_cost = $memory_cost:ident,
        write_binary_data = $write_binary_data:ident,
        write_blob = $write_blob:ident,
        write_string = $write_string:ident $(,)?
    ) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $cancel(this: *mut WebSocket<$ssl>) {
            WebSocket::<$ssl>::cancel(this)
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $close(this: *mut WebSocket<$ssl>, code: u16, reason: *const ZigString) {
            WebSocket::<$ssl>::close(this, code, reason)
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $finalize(this: *mut WebSocket<$ssl>) {
            WebSocket::<$ssl>::finalize(this)
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $init(
            outgoing: *mut CppWebSocket,
            input_socket: *mut c_void,
            global_this: &JSGlobalObject,
            buffered_data: *mut u8,
            buffered_data_len: usize,
            deflate_params: Option<&websocket_deflate::Params>,
            secure_ptr: *mut c_void,
        ) -> *mut c_void {
            WebSocket::<$ssl>::init(
                outgoing,
                input_socket,
                global_this,
                buffered_data,
                buffered_data_len,
                deflate_params,
                secure_ptr,
            )
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $init_with_tunnel(
            outgoing: *mut CppWebSocket,
            tunnel_ptr: *mut c_void,
            global_this: &JSGlobalObject,
            buffered_data: *mut u8,
            buffered_data_len: usize,
            deflate_params: Option<&websocket_deflate::Params>,
        ) -> *mut c_void {
            WebSocket::<$ssl>::init_with_tunnel(
                outgoing,
                tunnel_ptr,
                global_this,
                buffered_data,
                buffered_data_len,
                deflate_params,
            )
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $memory_cost(this: *const WebSocket<$ssl>) -> usize {
            WebSocket::<$ssl>::memory_cost(this)
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $write_binary_data(
            this: *mut WebSocket<$ssl>,
            ptr: *const u8,
            len: usize,
            op: u8,
        ) {
            WebSocket::<$ssl>::write_binary_data(this, ptr, len, op)
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $write_blob(this: *mut WebSocket<$ssl>, blob_value: JSValue, op: u8) {
            WebSocket::<$ssl>::write_blob(this, blob_value, op)
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $write_string(
            this: *mut WebSocket<$ssl>,
            str_: *const ZigString,
            op: u8,
        ) {
            WebSocket::<$ssl>::write_string(this, str_, op)
        }
    };
}

export_websocket_client!(
    false,
    cancel = Bun__WebSocketClient__cancel,
    close = Bun__WebSocketClient__close,
    finalize = Bun__WebSocketClient__finalize,
    init = Bun__WebSocketClient__init,
    init_with_tunnel = Bun__WebSocketClient__initWithTunnel,
    memory_cost = Bun__WebSocketClient__memoryCost,
    write_binary_data = Bun__WebSocketClient__writeBinaryData,
    write_blob = Bun__WebSocketClient__writeBlob,
    write_string = Bun__WebSocketClient__writeString,
);
export_websocket_client!(
    true,
    cancel = Bun__WebSocketClientTLS__cancel,
    close = Bun__WebSocketClientTLS__close,
    finalize = Bun__WebSocketClientTLS__finalize,
    init = Bun__WebSocketClientTLS__init,
    init_with_tunnel = Bun__WebSocketClientTLS__initWithTunnel,
    memory_cost = Bun__WebSocketClientTLS__memoryCost,
    write_binary_data = Bun__WebSocketClientTLS__writeBinaryData,
    write_blob = Bun__WebSocketClientTLS__writeBlob,
    write_string = Bun__WebSocketClientTLS__writeString,
);

// ──────────────────────────────────────────────────────────────────────────
// InitialDataHandler
// ──────────────────────────────────────────────────────────────────────────

pub struct InitialDataHandler<const SSL: bool> {
    pub adopted: Option<NonNull<WebSocket<SSL>>>,
    /// Pending-activity ref taken in `init()`/`init_with_tunnel()`; released
    /// (via `Drop`) when [`handle_without_deinit`] consumes `adopted`.
    pub ws: Option<CppWebSocketRef>,
    pub slice: Box<[u8]>,
}

impl<const SSL: bool> InitialDataHandler<SSL> {
    // pub const Handle = jsc.AnyTask.New(@This(), handle);
    // TODO(port): jsc::AnyTask::new wrapper — Phase B wires queue_microtask_callback signature.

    pub fn handle_without_deinit(&mut self) {
        let Some(this_socket_ptr) = self.adopted.take() else {
            return;
        };
        let ws_ptr = this_socket_ptr.as_ptr();
        // PORT NOTE: this fn is reachable re-entrantly from
        // `WebSocket::handle_data` while that frame may later form its own
        // `&mut *ws_ptr`, so never materialize a `&mut WebSocket` here —
        // touch fields via raw projection only.
        // SAFETY: `adopted` is a backref to a live WebSocket (heap::alloc
        // provenance); raw field write of a `Copy`-sized `Option<NonNull<_>>`.
        unsafe { core::ptr::addr_of_mut!((*ws_ptr).initial_data_handler).write(None) };
        // Zig: `defer ws.unref()` — RAII: take the owned ref so it drops at
        // scope exit. Paired with the `adopted.take()` above so the ref is
        // released exactly once even when this fn is later re-called with
        // `adopted == None` (early return leaves `ws` already `None`).
        let _ws_ref = self.ws.take();

        // For tunnel mode, tcp is detached but connection is still active through the tunnel
        // SAFETY: `ws_ptr` is live (see above); brief shared borrows for
        // `is_closed()` / `is_some()` — no `&mut` to `*ws_ptr` is live.
        let is_connected =
            unsafe { !(*ws_ptr).tcp.is_closed() || (*ws_ptr).proxy_tunnel.is_some() };
        // SAFETY: `ws_ptr` is live; raw read of a `Copy` field.
        if unsafe { (*ws_ptr).outgoing_websocket.is_some() } && is_connected {
            // SAFETY: `ws_ptr` carries `heap::alloc` provenance; `handle_data`
            // takes `*mut Self` and forms its own scoped `&mut` internally. No
            // borrow of `*ws_ptr` is live in this frame across the call.
            unsafe { WebSocket::<SSL>::handle_data(ws_ptr, &self.slice) };
        }
    }

    /// `extern "C"` thunk shape for `JSGlobalObject::queue_microtask_callback`.
    pub unsafe extern "C" fn handle(this: *mut c_void) {
        let this = this.cast::<Self>();
        // SAFETY: called from microtask queue with the pointer we passed in
        // (heap::alloc in init()/init_with_tunnel()).
        let this_ref = unsafe { &mut *this };
        this_ref.handle_without_deinit();
        // deinit: free slice + destroy self
        // SAFETY: allocated via heap::alloc in init()/init_with_tunnel()
        drop(unsafe { bun_core::heap::take(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ErrorCode
// ──────────────────────────────────────────────────────────────────────────

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ErrorCode {
    Cancel = 1,
    InvalidResponse = 2,
    Expected101StatusCode = 3,
    MissingUpgradeHeader = 4,
    MissingConnectionHeader = 5,
    MissingWebsocketAcceptHeader = 6,
    InvalidUpgradeHeader = 7,
    InvalidConnectionHeader = 8,
    InvalidWebsocketVersion = 9,
    MismatchWebsocketAcceptHeader = 10,
    MissingClientProtocol = 11,
    MismatchClientProtocol = 12,
    Timeout = 13,
    Closed = 14,
    FailedToWrite = 15,
    FailedToConnect = 16,
    HeadersTooLarge = 17,
    Ended = 18,
    FailedToAllocateMemory = 19,
    ControlFrameIsFragmented = 20,
    InvalidControlFrame = 21,
    CompressionUnsupported = 22,
    InvalidCompressedData = 23,
    CompressionFailed = 24,
    UnexpectedMaskFromServer = 25,
    ExpectedControlFrame = 26,
    UnsupportedControlFrame = 27,
    UnexpectedOpcode = 28,
    InvalidUtf8 = 29,
    TlsHandshakeFailed = 30,
    MessageTooBig = 31,
    ProtocolError = 32,
    // Proxy error codes
    ProxyConnectFailed = 33,
    ProxyAuthenticationRequired = 34,
    ProxyConnectionRefused = 35,
    ProxyTunnelFailed = 36,
}

// ──────────────────────────────────────────────────────────────────────────
// Mask
// ──────────────────────────────────────────────────────────────────────────

pub struct Mask;

impl Mask {
    pub fn fill(
        global_this: &JSGlobalObject,
        mask_buf: &mut [u8; 4],
        output: &mut [u8],
        input: &[u8],
    ) {
        let entropy = global_this.bun_vm().as_mut().rare_data().entropy_slice(4);
        mask_buf.copy_from_slice(&entropy[..4]);
        let mask = *mask_buf;

        let skip_mask = u32::from_ne_bytes(mask) == 0;
        Self::fill_with_skip_mask(mask, output, input, skip_mask);
    }

    /// In-place variant for when output and input alias the same buffer.
    /// PORT NOTE: Zig's `fill` allowed output==input; Rust borrowck forbids
    /// `&mut [u8]` + `&[u8]` aliasing. Callers that masked in-place use this.
    pub fn fill_in_place(global_this: &JSGlobalObject, mask_buf: &mut [u8; 4], buf: &mut [u8]) {
        let entropy = global_this.bun_vm().as_mut().rare_data().entropy_slice(4);
        mask_buf.copy_from_slice(&entropy[..4]);
        let mask = *mask_buf;

        let skip_mask = u32::from_ne_bytes(mask) == 0;
        if buf.is_empty() {
            bun_core::hint::cold();
            return;
        }
        bun_highway::fill_with_skip_mask_inplace(mask, buf, skip_mask);
    }

    fn fill_with_skip_mask(mask: [u8; 4], output: &mut [u8], input: &[u8], skip_mask: bool) {
        if input.is_empty() {
            bun_core::hint::cold();
            return;
        }
        bun_highway::fill_with_skip_mask(mask, &mut output[..input.len()], input, skip_mask);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReceiveState / DataType
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ReceiveState {
    NeedHeader,
    NeedMask,
    NeedBody,
    ExtendedPayloadLength16,
    ExtendedPayloadLength64,
    Ping,
    Pong,
    Close,
    Fail,
}

impl ReceiveState {
    pub fn need_control_frame(self) -> bool {
        self != ReceiveState::NeedBody
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum DataType {
    None,
    Text,
    Binary,
}

// ──────────────────────────────────────────────────────────────────────────
// parseWebSocketHeader
// ──────────────────────────────────────────────────────────────────────────

fn parse_websocket_header(
    bytes: [u8; 2],
    receiving_type: &mut Opcode,
    payload_length: &mut usize,
    is_fragmented: &mut bool,
    is_final: &mut bool,
    need_compression: &mut bool,
) -> ReceiveState {
    // 0                   1                   2                   3
    // 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
    // +-+-+-+-+-------+-+-------------+-------------------------------+
    // |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
    // |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
    // |N|V|V|V|       |S|             |   (if payload len==126/127)   |
    // | |1|2|3|       |K|             |                               |
    // +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
    // |     Extended payload length continued, if payload len == 127  |
    // + - - - - - - - - - - - - - - - +-------------------------------+
    // |                               |Masking-key, if MASK set to 1  |
    // +-------------------------------+-------------------------------+
    // | Masking-key (continued)       |          Payload Data         |
    // +-------------------------------- - - - - - - - - - - - - - - - +
    // :                     Payload Data continued ...                :
    // + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
    // |                     Payload Data continued ...                |
    // +---------------------------------------------------------------+
    let header = WebsocketHeader::from_slice(bytes);
    let payload = header.len() as usize;
    *payload_length = payload;
    *receiving_type = header.opcode();
    *is_fragmented = matches!(header.opcode(), Opcode::Continue) || !header.final_();
    *is_final = header.final_();

    // Per RFC 7692, RSV1 bit indicates compression for the first fragment of a message
    // For continuation frames, compression state is inherited from the first fragment
    if header.opcode() == Opcode::Text || header.opcode() == Opcode::Binary {
        *need_compression = header.compressed();
    } else if header.opcode() == Opcode::Continue {
        // Compression state for continuation frames should be inherited from the message start
        // This needs to be tracked at a higher level, not determined by the continuation frame's RSV1
        // For now, we don't set it here - it should be maintained by the WebSocket state
        *need_compression = false;
    } else {
        // Control frames cannot be compressed
        if header.compressed() {
            return ReceiveState::Fail; // Control frames with RSV1 set should fail
        }
        *need_compression = false;
    }

    if header.mask() && (header.opcode() == Opcode::Text || header.opcode() == Opcode::Binary) {
        return ReceiveState::NeedMask;
    }

    // Check RSV bits (rsv2 and rsv3 must always be 0 per RFC 6455)
    // rsv1 (compressed bit) is handled separately above
    if header.rsv() != 0 {
        // RSV2 and RSV3 bits must always be 0
        return ReceiveState::Fail;
    }

    match header.opcode() {
        Opcode::Text | Opcode::Continue | Opcode::Binary => {
            if payload <= 125 {
                ReceiveState::NeedBody
            } else if payload == 126 {
                ReceiveState::ExtendedPayloadLength16
            } else if payload == 127 {
                ReceiveState::ExtendedPayloadLength64
            } else {
                ReceiveState::Fail
            }
        }
        Opcode::Close => ReceiveState::Close,
        Opcode::Ping => ReceiveState::Ping,
        Opcode::Pong => ReceiveState::Pong,
        _ => ReceiveState::Fail,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Copy
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
enum Copy<'a> {
    Utf16(&'a [u16]),
    Latin1(&'a [u8]),
    Bytes(&'a [u8]),
    Raw(&'a [u8]),
}

impl<'a> Copy<'a> {
    pub fn len(&self, byte_len: &mut usize) -> usize {
        match self {
            Copy::Utf16(utf16) => {
                *byte_len = strings::element_length_utf16_into_utf8(utf16);
                WebsocketHeader::frame_size_including_mask(*byte_len)
            }
            Copy::Latin1(latin1) => {
                *byte_len = strings::element_length_latin1_into_utf8(latin1);
                WebsocketHeader::frame_size_including_mask(*byte_len)
            }
            Copy::Bytes(bytes) => {
                *byte_len = bytes.len();
                WebsocketHeader::frame_size_including_mask(*byte_len)
            }
            Copy::Raw(raw) => {
                *byte_len = raw.len();
                raw.len()
            }
        }
    }

    pub fn copy(
        &self,
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        content_byte_len: usize,
        opcode: Opcode,
    ) {
        if let Copy::Raw(raw) = self {
            debug_assert!(buf.len() >= raw.len());
            debug_assert!(buf.as_ptr() != raw.as_ptr());
            buf[..raw.len()].copy_from_slice(raw);
            return;
        }

        let how_big_is_the_length_integer = WebsocketHeader::length_byte_count(content_byte_len);
        let how_big_is_the_mask = 4;
        let mask_offset = 2 + how_big_is_the_length_integer;
        let content_offset = mask_offset + how_big_is_the_mask;

        // 2 byte header
        // 4 byte mask
        // 0, 2, 8 byte length

        // PORT NOTE: Zig `@bitCast(@as(u16, 0))`; WebsocketHeader has no public
        // raw-bits ctor, so build the all-zero header via from_slice.
        let mut header = WebsocketHeader::from_slice([0, 0]);

        // Write extended length if needed
        match how_big_is_the_length_integer {
            0 => {}
            2 => buf[2..4].copy_from_slice(&(content_byte_len as u16).to_be_bytes()),
            8 => buf[2..10].copy_from_slice(&(content_byte_len as u64).to_be_bytes()),
            _ => unreachable!(),
        }

        header.set_mask(true);
        header.set_compressed(false);
        header.set_final(true);
        header.set_opcode(opcode);

        debug_assert_eq!(
            WebsocketHeader::frame_size_including_mask(content_byte_len),
            buf.len()
        );

        // PORT NOTE: reshaped for borrowck — split `buf` into three disjoint
        // regions (header bytes / 4-byte mask / payload) so `write_header` and
        // `Mask::fill*` don't alias. Zig wrote through one pointer.
        let (head, to_mask_full) = buf.split_at_mut(content_offset);
        let (header_part, mask_part) = head.split_at_mut(mask_offset);
        let mask_buf: &mut [u8; 4] = (&mut mask_part[..4])
            .try_into()
            .expect("infallible: size matches");
        let to_mask = &mut to_mask_full[..content_byte_len];

        match self {
            Copy::Utf16(utf16) => {
                header.set_len(WebsocketHeader::pack_length(content_byte_len));
                let encode_into_result = strings::copy_utf16_into_utf8_impl::<true>(to_mask, utf16);
                debug_assert_eq!(encode_into_result.written as usize, content_byte_len);
                debug_assert_eq!(encode_into_result.read as usize, utf16.len());
                header.set_len(WebsocketHeader::pack_length(
                    encode_into_result.written as usize,
                ));
                // TODO(port): Zig used std.io.fixedBufferStream + header.writeHeader.
                // WebsocketHeader::write_header should write into &mut head[..2+len_int].
                header
                    .write_header(
                        &mut &mut header_part[..],
                        encode_into_result.written as usize,
                    )
                    .expect("unreachable");

                Mask::fill_in_place(global_this, mask_buf, to_mask);
            }
            Copy::Latin1(latin1) => {
                let encode_into_result = strings::copy_latin1_into_utf8(to_mask, latin1);
                debug_assert_eq!(encode_into_result.written as usize, content_byte_len);

                // latin1 can contain non-ascii
                debug_assert_eq!(encode_into_result.read as usize, latin1.len());

                header.set_len(WebsocketHeader::pack_length(
                    encode_into_result.written as usize,
                ));
                header
                    .write_header(
                        &mut &mut header_part[..],
                        encode_into_result.written as usize,
                    )
                    .expect("unreachable");
                Mask::fill_in_place(global_this, mask_buf, to_mask);
            }
            Copy::Bytes(bytes) => {
                header.set_len(WebsocketHeader::pack_length(bytes.len()));
                header
                    .write_header(&mut &mut header_part[..], bytes.len())
                    .expect("unreachable");
                Mask::fill(global_this, mask_buf, to_mask, bytes);
            }
            Copy::Raw(_) => unreachable!(),
        }
    }

    pub fn copy_compressed(
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        compressed_data: &[u8],
        opcode: Opcode,
        is_first_fragment: bool,
    ) {
        let content_byte_len = compressed_data.len();
        let how_big_is_the_length_integer = WebsocketHeader::length_byte_count(content_byte_len);
        let how_big_is_the_mask = 4;
        let mask_offset = 2 + how_big_is_the_length_integer;
        let content_offset = mask_offset + how_big_is_the_mask;

        // 2 byte header
        // 4 byte mask
        // 0, 2, 8 byte length

        // Write extended length if needed
        match how_big_is_the_length_integer {
            0 => {}
            2 => buf[2..4].copy_from_slice(&(content_byte_len as u16).to_be_bytes()),
            8 => buf[2..10].copy_from_slice(&(content_byte_len as u64).to_be_bytes()),
            _ => unreachable!(),
        }

        // PORT NOTE: Zig `@bitCast(@as(u16, 0))`; WebsocketHeader has no public
        // raw-bits ctor, so build the all-zero header via from_slice.
        let mut header = WebsocketHeader::from_slice([0, 0]);

        header.set_mask(true);
        header.set_compressed(is_first_fragment); // Only set compressed flag for first fragment
        header.set_final(true);
        header.set_opcode(opcode);
        header.set_len(WebsocketHeader::pack_length(content_byte_len));

        debug_assert_eq!(
            WebsocketHeader::frame_size_including_mask(content_byte_len),
            buf.len()
        );

        // PORT NOTE: reshaped for borrowck — three disjoint regions (see `copy`).
        let (head, to_mask_full) = buf.split_at_mut(content_offset);
        let (header_part, mask_part) = head.split_at_mut(mask_offset);
        let mask_buf: &mut [u8; 4] = (&mut mask_part[..4])
            .try_into()
            .expect("infallible: size matches");
        let to_mask = &mut to_mask_full[..content_byte_len];

        header
            .write_header(&mut &mut header_part[..], content_byte_len)
            .expect("unreachable");

        Mask::fill(global_this, mask_buf, to_mask, compressed_data);
    }
}

// ported from: src/http_jsc/websocket_client.zig
