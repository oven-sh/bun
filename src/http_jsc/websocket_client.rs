//! This is the Rust implementation of the WebSocket client.
//!
//! It manages the WebSocket connection, including sending and receiving data,
//! handling connection events, and managing the WebSocket state.
//!
//! The WebSocket client supports both secure (TLS) and non-secure connections.
//!
//! This is only used **after** the websocket handshaking step is completed.

use core::cell::{Cell, RefCell};
use core::ffi::{c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_boringssl as boringssl;
use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::{ZigString, strings};
use bun_http::websocket::{Opcode, WebsocketHeader};
use bun_io::KeepAlive;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject, JSValue};
use bun_ptr::{AsCtxPtr, ThisPtr};
use bun_uws::{self as uws, NewSocketHandler, SslCtx, us_bun_verify_error_t};
use bun_uws_sys::us_socket_t;

use self::cpp_websocket::{CppWebSocket, CppWebSocketRef};
use self::websocket_deflate::WebSocketDeflate;
use self::websocket_proxy_tunnel::WebSocketProxyTunnel;

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
// WebSocket<const SSL: bool>
// ──────────────────────────────────────────────────────────────────────────

pub type Socket<const SSL: bool> = NewSocketHandler<SSL>;

const STACK_FRAME_SIZE: usize = 1024;
/// Minimum message size to compress (RFC 7692 recommendation)
const MIN_COMPRESS_SIZE: usize = 860;
/// Maximum buffered inbound message size (128 MB). A server that declares a
/// larger frame, or whose continuation fragments accumulate past this, fails
/// the connection with close code 1009 instead of growing `receive_buffer`
/// without bound.
const MAX_RECEIVE_MESSAGE_LENGTH: usize = 128 * 1024 * 1024;
/// RFC 6455 §5.5: a control frame's payload is at most 125 bytes.
const MAX_CONTROL_PAYLOAD: usize = 125;
/// RFC 6455 §5.5.1: a Close payload is the 2-byte status code + the reason.
const MAX_CLOSE_REASON: usize = MAX_CONTROL_PAYLOAD - 2;
/// Outgoing control frame prefix: 2-byte header + 4-byte masking key.
const CONTROL_HEADER_SIZE: usize = 6;
/// RFC 6455 §7.4.1: reserved, never valid on the wire. C++ passes it to
/// [`WebSocket::close`] for a `ws.close()` with no code: send a Close frame with
/// no payload, which §7.1.5 says both ends report as 1005 "no status received".
const CLOSE_CODE_NOT_SPECIFIED: u16 = 1005;

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct WebSocket<const SSL: bool> {
    pub ref_count: Cell<u32>,

    pub tcp: Cell<Socket<SSL>>,
    pub outgoing_websocket: Cell<Option<NonNull<CppWebSocket>>>,

    pub receive_state: Cell<ReceiveState>,
    pub receiving_type: Cell<Opcode>,
    // we need to start with final so we validate the first frame
    pub receiving_is_final: Cell<bool>,

    /// Staging area for outgoing control frames and incoming control payloads.
    pub ping_frame_bytes: Cell<[u8; CONTROL_HEADER_SIZE + 128]>,
    pub ping_len: Cell<u8>,
    /// A Ping/Pong/Close payload is mid-accumulation in `ping_frame_bytes`.
    pub control_frame_started: Cell<bool>,
    pub close_received: Cell<bool>,
    /// `Some` once `send_close_with_body` has enqueued the close frame: blocks
    /// further outbound writes and drives `clear_data` + `dispatch_close` once
    /// the frame is fully flushed (or the socket dies).
    pub close_dispatch_pending: RefCell<Option<(u16, bun_core::String)>>,

    pub receive_body_remain: Cell<usize>,
    pub receive_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub send_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub global_this: GlobalRef,
    pub poll_ref: Cell<KeepAlive>,

    pub header_fragment: Cell<Option<u8>>,

    pub payload_length_frame_bytes: Cell<[u8; 8]>,
    pub payload_length_frame_len: Cell<u8>,

    // Non-owning; the allocation is managed by the microtask queue, not deinit.
    pub initial_data_handler: Cell<Option<NonNull<InitialDataHandler<SSL>>>>,
    pub event_loop: &'static EventLoop,
    pub deflate: RefCell<Option<Box<WebSocketDeflate>>>,

    /// Track if current message is compressed
    pub receiving_compressed: Cell<bool>,
    /// Track compression state of the entire message (across fragments)
    pub message_is_compressed: Cell<bool>,

    /// `us_ssl_ctx_t` inherited from the upgrade client when it was built
    /// with a custom CA. The socket's `SSL*` references the `SSL_CTX`
    /// inside, so this must outlive the connection. None when the upgrade
    /// used the shared default context.
    pub secure: Cell<Option<*mut SslCtx>>,

    /// Proxy tunnel for wss:// through HTTP proxy.
    /// When set, all I/O goes through the tunnel (TLS encryption/decryption).
    /// The tunnel handles the TLS layer, so this is used with ssl=false.
    ///
    /// intrusive refcount is hand-rolled on `WebSocketProxyTunnel`
    /// (`ref_()`/`deref()`); stored as `NonNull` rather than `RefPtr` because
    /// the tunnel does not (yet) implement `bun_ptr::RefCounted`. Ownership
    /// semantics match `RefPtr`: assigning here implies a held ref, released
    /// in `clear_data` via `WebSocketProxyTunnel::deref`.
    pub proxy_tunnel: Cell<Option<NonNull<WebSocketProxyTunnel>>>,
}

impl<const SSL: bool> WebSocket<SSL> {
    /// Tests grep for this exact shape under `BUN_DEBUG_alloc=1`.
    const ALLOC_TYPE_NAME: &'static str = if SSL {
        "http.websocket_client.NewWebSocketClient(true)"
    } else {
        "http.websocket_client.NewWebSocketClient(false)"
    };

    #[inline]
    fn vm_loop_ctx(global_this: &JSGlobalObject) -> bun_io::EventLoopCtx {
        // SAFETY: `EventLoopCtx.owner` is a type-erased `*mut ()` slot. Source
        // it from `bun_vm_ptr()` (the FFI `*mut VirtualMachine`) rather than
        // `bun_vm()`'s `&VirtualMachine`, so the stored pointer carries write
        // provenance instead of being
        // laundered through a shared-ref `*const _ as *mut` hop — the vtable
        // slots (`file_polls`, `set_after_event_loop_callback`) write through
        // it.
        unsafe { jsc::virtual_machine::VirtualMachine::event_loop_ctx(global_this.bun_vm_ptr()) }
    }

    fn should_compress(&self, data_len: usize, opcode: Opcode) -> bool {
        self.deflate.borrow().is_some()
            && matches!(opcode, Opcode::Text | Opcode::Binary)
            && data_len >= MIN_COMPRESS_SIZE
    }

    fn unref_keep_alive(&self) {
        let mut poll_ref = self.poll_ref.take();
        poll_ref.unref(Self::vm_loop_ctx(&self.global_this));
        self.poll_ref.set(poll_ref);
    }

    pub fn clear_data(&self) {
        log!("clearData");
        self.unref_keep_alive();
        self.clear_receive_buffers(true);
        self.clear_send_buffers(true);
        self.control_frame_started.set(false);
        self.ping_len.set(0);
        if let Some((_, reason)) = self.close_dispatch_pending.take() {
            reason.deref();
        }
        self.receiving_compressed.set(false);
        self.message_is_compressed.set(false);
        self.deflate.replace(None);
        if let Some(s) = self.secure.take() {
            // SAFETY: s is a valid SSL_CTX* owned by us per field invariant
            unsafe { boringssl::c::SSL_CTX_free(s) };
        }
        // Detach the tunnel first so its shutdown callbacks cannot re-enter this path.
        if let Some(tunnel) = self.proxy_tunnel.take() {
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
            // SAFETY: allocation is live (guarded by callers' ref).
            unsafe { Self::deref(self.as_ctx_ptr()) };
        }
    }

    // `extern "C"` entrypoint; `this_ptr` is non-null by C++ contract (see SAFETY comments below).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
        let this = unsafe { &*this_ptr };

        let had_tunnel = this.proxy_tunnel.get().is_some();
        this.clear_data();

        if SSL {
            // we still want to send pending SSL buffer + close_notify
            this.tcp.get().close(uws::CloseKind::Normal);
        } else {
            this.tcp.get().close(uws::CloseKind::Failure);
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

    pub fn fail(&self, code: ErrorCode) {
        jsc::mark_binding!();
        if let Some(ws) = self.outgoing_websocket.take() {
            log!("fail ({})", <&'static str>::from(code));
            CppWebSocket::opaque_ref(ws.as_ptr()).did_abrupt_close(code);
            // SAFETY: allocation kept live by the socket/tunnel I/O ref (or by
            // the caller's guard).
            unsafe { Self::deref(self.as_ctx_ptr()) };
        }

        Self::cancel(self.as_ctx_ptr());
    }

    pub fn handle_handshake(
        &self,
        socket: Socket<SSL>,
        success: i32,
        ssl_error: us_bun_verify_error_t,
    ) {
        jsc::mark_binding!();

        let authorized = success == 1;

        log!("onHandshake({})", success);

        let Some(ws) = self.outgoing_websocket.get() else {
            return;
        };
        if !CppWebSocket::opaque_ref(ws.as_ptr()).reject_unauthorized() {
            // We accept the connection regardless of SSL errors.
            return;
        }

        if ssl_error.error_no != 0 || !authorized {
            self.fail(ErrorCode::FailedToConnect);
            return;
        }

        // SAFETY: native handle of an SSL socket is an SSL*
        let ssl_ptr: *mut boringssl::c::SSL = socket
            .get_native_handle()
            .map_or(core::ptr::null_mut(), <*mut c_void>::cast);
        // Fail closed: without the SSL handle we cannot verify the peer.
        if ssl_ptr.is_null() {
            self.fail(ErrorCode::FailedToConnect);
            return;
        }
        // `TLSEXT_NAMETYPE_host_name` is 0 per RFC 6066 / `<openssl/tls1.h>`.
        const TLSEXT_NAMETYPE_HOST_NAME: c_int = 0;
        // SAFETY: ssl_ptr is non-null (checked above) and outlived by the socket.
        let servername =
            unsafe { boringssl::c::SSL_get_servername(ssl_ptr, TLSEXT_NAMETYPE_HOST_NAME) };
        if servername.is_null() {
            return;
        }
        // SAFETY: servername is a NUL-terminated C string owned by the SSL session.
        let hostname = unsafe { bun_core::ffi::cstr(servername) }.to_bytes();
        // SAFETY: `ssl_ptr` is non-null and no other Rust borrow of the `SSL` exists.
        let ssl = unsafe { &mut *ssl_ptr };
        if !boringssl::check_server_identity(ssl, hostname) {
            self.fail(ErrorCode::FailedToConnect);
        }
    }

    fn detach_tcp(&self) {
        let mut tcp = self.tcp.get();
        tcp.detach();
        self.tcp.set(tcp);
    }

    pub fn handle_close(&self, _socket: Socket<SSL>, _code: c_int, _reason: *mut c_void) {
        log!("onClose");
        jsc::mark_binding!();
        if let Some((code, mut reason)) = self.close_dispatch_pending.take() {
            // The socket closed while our close frame was mid-flush; the peer
            // either got it or didn't, but JS should still see the
            // user-initiated code/reason (not an abrupt 1006).
            self.detach_tcp();
            self.clear_data();
            self.dispatch_close(code, &mut reason);
            // For the socket.
            // SAFETY: this is the terminal release of the socket's
            // I/O-layer ref.
            unsafe { Self::deref(self.as_ctx_ptr()) };
            return;
        }
        self.clear_data();
        self.detach_tcp();

        self.dispatch_abrupt_close(ErrorCode::Ended);

        // For the socket.
        // SAFETY: this is the terminal release of the socket's
        // I/O-layer ref.
        unsafe { Self::deref(self.as_ctx_ptr()) };
    }

    pub fn terminate(&self, code: ErrorCode) {
        log!("terminate");
        self.fail(code);
    }

    fn clear_receive_buffers(&self, free: bool) {
        // `discard` never rewinds `head`; `reset_head_if_empty` keeps `readable_slice(0)` contiguous.
        {
            let mut receive_buffer = self.receive_buffer.borrow_mut();
            let len = receive_buffer.readable_length();
            receive_buffer.discard(len);
            receive_buffer.reset_head_if_empty();
        }

        if free {
            self.receive_buffer
                .replace(LinearFifo::<u8, DynamicBuffer<u8>>::init());
        }

        self.receive_body_remain.set(0);
    }

    fn clear_send_buffers(&self, free: bool) {
        // see clear_receive_buffers — discard instead of poking
        // private `head`/`count`.
        {
            let mut send_buffer = self.send_buffer.borrow_mut();
            let len = send_buffer.readable_length();
            send_buffer.discard(len);
        }
        if free {
            self.send_buffer
                .replace(LinearFifo::<u8, DynamicBuffer<u8>>::init());
        }
    }

    fn dispatch_compressed_data(&self, data: &[u8], kind: Opcode) {
        let mut deflate_slot = self.deflate.borrow_mut();
        let Some(deflate) = deflate_slot.as_mut() else {
            drop(deflate_slot);
            self.terminate(ErrorCode::CompressionUnsupported);
            return;
        };

        let mut decompressed = deflate.rare_data.array_list();
        if let Err(err) = deflate.decompress(data, &mut decompressed) {
            let error_code = match err {
                websocket_deflate::Error::InflateFailed => ErrorCode::InvalidCompressedData,
                websocket_deflate::Error::TooLarge => ErrorCode::MessageTooBig,
                websocket_deflate::Error::OutOfMemory => ErrorCode::FailedToAllocateMemory,
            };
            drop(deflate_slot);
            self.terminate(error_code);
            return;
        }

        // Drop the deflate borrow: `dispatch_data` can re-enter `clear_data`.
        drop(deflate_slot);
        let items = decompressed.as_slice();
        self.dispatch_data(items, kind);
    }

    /// Data will be cloned in C++.
    fn dispatch_data(&self, data: &[u8], kind: Opcode) {
        let Some(out) = self.outgoing_websocket.get() else {
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
                    Err(strings::ToUTF16Error::InvalidByteSequence) => {
                        self.terminate(ErrorCode::InvalidUtf8);
                        return;
                    }
                    Err(strings::ToUTF16Error::OutOfMemory) => {
                        self.terminate(ErrorCode::FailedToAllocateMemory);
                        return;
                    }
                };
                let mut outstring;
                if let Some(utf16) = utf16_bytes {
                    // Ownership of the UTF-16 buffer transfers to C++: with
                    // `clone=false` and the global tag set, `Zig::toString`
                    // adopts the allocation into a `WTF::ExternalStringImpl`
                    // which `mi_free`s it later. Dropping the Vec here would
                    // be a UAF + double-free, so `utf16` must never be freed
                    // locally.
                    let utf16 = core::mem::ManuallyDrop::new(utf16);
                    outstring = ZigString::from16_slice(&utf16);
                    outstring.mark_global();
                    jsc::mark_binding!();
                    out.did_receive_text(false, &outstring);
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

    fn buffer_payload(&self, data: &[u8]) -> Result<(), bun_alloc::AllocError> {
        let mut receive_buffer = self.receive_buffer.borrow_mut();
        let writable = receive_buffer.writable_with_size(data.len())?;
        writable[..data.len()].copy_from_slice(data);
        receive_buffer.update(data.len());
        Ok(())
    }

    pub fn consume(
        &self,
        data: &[u8],
        left_in_fragment: usize,
        kind: Opcode,
        is_final: bool,
    ) -> usize {
        debug_assert!(data.len() <= left_in_fragment);

        // Compressed fragments are always buffered: only the complete message can be inflated.
        if self.receiving_compressed.get() {
            return self.consume_compressed(data, left_in_fragment, kind, is_final);
        }
        let frame_complete = data.len() == left_in_fragment;

        if is_final && frame_complete {
            // Whole message in one read: dispatch it without copying into `receive_buffer`.
            if self.receive_buffer.borrow().readable_length() == 0 {
                self.dispatch_data(data, kind);
                self.message_is_compressed.set(false);
                return data.len();
            }
            if data.is_empty() {
                self.dispatch_buffered_message(kind, false);
                return 0;
            }
        }

        // this must come after the above check
        if data.is_empty() {
            return 0;
        }

        self.buffer_payload(data).expect("unreachable");
        if frame_complete {
            self.receive_body_remain.set(0);
            if is_final {
                self.dispatch_buffered_message(kind, false);
            }
        }
        data.len()
    }

    fn consume_compressed(
        &self,
        data: &[u8],
        left_in_fragment: usize,
        kind: Opcode,
        is_final: bool,
    ) -> usize {
        if !data.is_empty() && self.buffer_payload(data).is_err() {
            self.terminate(ErrorCode::Closed);
            return 0;
        }

        if data.len() == left_in_fragment {
            self.receive_body_remain.set(0);
            if is_final {
                self.dispatch_buffered_message(kind, true);
            }
        }
        data.len()
    }

    /// Dispatch the message accumulated in `receive_buffer`, then reset the per-message state.
    fn dispatch_buffered_message(&self, kind: Opcode, compressed: bool) {
        // Take the fifo first: `dispatch_*` can reach `clear_receive_buffers(true)` and free the readable slice.
        let buf = self
            .receive_buffer
            .replace(LinearFifo::<u8, DynamicBuffer<u8>>::init());
        if compressed {
            self.dispatch_compressed_data(buf.readable_slice(0), kind);
        } else {
            self.dispatch_data(buf.readable_slice(0), kind);
        }
        // Restore the taken fifo so its capacity is kept for the next message.
        self.receive_buffer.replace(buf);
        self.clear_receive_buffers(false);
        if compressed {
            self.receiving_compressed.set(false);
        }
        self.message_is_compressed.set(false);
    }

    // Takes `ThisPtr<Self>` instead of `&self` because
    // `handle_without_deinit()` re-enters this very function on the same
    // allocation through its own raw back-pointer.
    //
    // There is no `socket` parameter: the dispatch thunk wraps the same
    // `us_socket_t*` that `adopt_group` stored into `self.tcp`, so the parse
    // loop reads `self.tcp` directly.
    pub fn handle_data(this: ThisPtr<Self>, data_: &[u8]) {
        // after receiving close we should ignore the data
        if this.close_received.get() {
            return;
        }
        // Bumps the intrusive refcount and derefs on Drop.
        let _guard = this.ref_guard();

        // Due to scheduling, it is possible for the websocket onData
        // handler to run with additional data before the microtask queue is
        // drained.
        if let Some(initial_handler) = this.initial_data_handler.get() {
            // This calls `handle_data`
            // We deliberately do not set self.initial_data_handler to None here, that's done in handle_without_deinit.
            // We do not free the memory here since the lifetime is managed by the microtask queue (it should free when called from there)
            // SAFETY: `initial_handler` is valid (managed by microtask queue).
            // `handle_without_deinit` re-enters `Self::handle_data` via the
            // `adopted` raw ptr (same `heap::alloc` provenance as `this`).
            unsafe { (*initial_handler.as_ptr()).handle_without_deinit() };

            // handle_without_deinit is supposed to clear the handler from WebSocket*
            // to prevent an infinite loop
            debug_assert!(this.initial_data_handler.get().is_none());

            // If we disconnected for any reason in the re-entrant case, we should just ignore the data
            if this.outgoing_websocket.get().is_none() || !this.has_tcp() {
                return;
            }
        }

        this.handle_data_loop(data_);
    }

    fn handle_data_loop(&self, data: &[u8]) {
        // In the WebSocket specification, control frames may not be fragmented.
        // However, the frame parser should handle fragmented control frames nonetheless.
        // Whether or not the frame parser is given a set of fragmented bytes to parse is subject
        // to the strategy in which the client buffers and coalesces received bytes.
        let mut cursor = RecvCursor {
            data,
            state: self.receive_state.get(),
            body_remain: self.receive_body_remain.get(),
            is_final: self.receiving_is_final.get(),
            last_data_type: self.receiving_type.get(),
        };

        let terminated = loop {
            log!("onData ({})", <&'static str>::from(cursor.state));

            let step = match cursor.state {
                ReceiveState::NeedHeader => self.recv_frame_header(&mut cursor),
                ReceiveState::NeedMask => self.recv_failed(ErrorCode::UnexpectedMaskFromServer),
                ReceiveState::ExtendedPayloadLength16 => {
                    self.recv_extended_payload_length(&mut cursor, 2)
                }
                ReceiveState::ExtendedPayloadLength64 => {
                    self.recv_extended_payload_length(&mut cursor, 8)
                }
                ReceiveState::Ping => self.recv_ping_or_pong(&mut cursor, Opcode::Ping),
                ReceiveState::Pong => self.recv_ping_or_pong(&mut cursor, Opcode::Pong),
                ReceiveState::NeedBody => self.recv_body(&mut cursor),
                ReceiveState::Close => self.recv_close(&mut cursor),
                ReceiveState::Fail => self.recv_failed(ErrorCode::UnsupportedControlFrame),
            };
            match step {
                Step::Continue => {}
                Step::NeedMoreData => break false,
                Step::Terminated => break true,
            }
        };

        if terminated {
            self.close_received.set(true);
        } else {
            self.receive_state.set(cursor.state);
            self.receiving_type.set(cursor.last_data_type);
            self.receive_body_remain.set(cursor.body_remain);
        }
    }

    fn recv_failed(&self, code: ErrorCode) -> Step {
        self.terminate(code);
        Step::Terminated
    }

    /// Parse the 2-byte frame header (see the diagram on
    /// [`parse_websocket_header`]) and validate the opcode/fragmentation/
    /// compression rules before moving to the payload state.
    fn recv_frame_header(&self, cursor: &mut RecvCursor<'_>) -> Step {
        if cursor.data.len() < 2 {
            debug_assert!(!cursor.data.is_empty());
            if self.header_fragment.get().is_none() {
                self.header_fragment.set(Some(cursor.data[0]));
                return Step::NeedMoreData;
            }
        }

        let header_bytes = if let Some(header_fragment) = self.header_fragment.take() {
            let bytes = [header_fragment, cursor.data[0]];
            cursor.data = &cursor.data[1..];
            bytes
        } else {
            let bytes = [cursor.data[0], cursor.data[1]];
            cursor.data = &cursor.data[2..];
            bytes
        };

        let header = parse_websocket_header(header_bytes);
        cursor.state = header.next;
        cursor.body_remain = header.payload_len;
        cursor.is_final = header.is_final;

        match header.opcode {
            Opcode::Continue => {
                // if is final is true continue is invalid
                if self.receiving_is_final.get() {
                    // nothing to continue here
                    // Per Autobahn test case 5.9: "The connection is failed immediately, since there is no message to continue."
                    return self.recv_failed(ErrorCode::UnexpectedOpcode);
                }
                // only update final if is a valid continue
                self.receiving_is_final.set(header.is_final);
            }
            Opcode::Text | Opcode::Binary => {
                // if the last one is not final this is invalid because we are waiting a continue
                if !self.receiving_is_final.get() {
                    return self.recv_failed(ErrorCode::UnexpectedOpcode);
                }
                // for text and binary frames we need to keep track of final and type
                self.receiving_is_final.set(header.is_final);
                cursor.last_data_type = header.opcode;
            }
            // Control frames must not be fragmented.
            op if op.is_control() && header.is_fragmented => {
                return self.recv_failed(ErrorCode::ControlFrameIsFragmented);
            }
            _ => {}
        }

        if !matches!(
            header.opcode,
            Opcode::Continue
                | Opcode::Text
                | Opcode::Binary
                | Opcode::Ping
                | Opcode::Pong
                | Opcode::Close
        ) {
            return self.recv_failed(ErrorCode::UnsupportedControlFrame);
        }

        // RFC 7692 §6.1: RSV1 marks the start of a compressed message, so only
        // the first frame of a data message may ever set it.
        if header.compressed && !matches!(header.opcode, Opcode::Text | Opcode::Binary) {
            return self.recv_failed(ErrorCode::UnexpectedRsv1);
        }

        if header.compressed && self.deflate.borrow().is_none() {
            return self.recv_failed(ErrorCode::CompressionUnsupported);
        }

        // A new message records its own RSV1 bit; a continuation inherits the message's.
        match header.opcode {
            Opcode::Text | Opcode::Binary => {
                self.message_is_compressed.set(header.compressed);
                self.receiving_compressed.set(header.compressed);
            }
            Opcode::Continue => self
                .receiving_compressed
                .set(self.message_is_compressed.get()),
            _ => {}
        }

        // An empty final message still dispatches ("", ArrayBuffer(0), ...).
        if cursor.body_remain == 0 && cursor.state == ReceiveState::NeedBody && cursor.is_final {
            let _ = self.consume(b"", 0, cursor.last_data_type, true);

            cursor.state = ReceiveState::NeedHeader;
            self.receiving_compressed.set(false);
            self.message_is_compressed.set(false);

            if cursor.data.is_empty() {
                return Step::NeedMoreData;
            }
        }
        Step::Continue
    }

    /// Accumulate the 2- or 8-byte extended payload length (which may itself
    /// arrive split across reads) into `payload_length_frame_bytes`.
    fn recv_extended_payload_length(&self, cursor: &mut RecvCursor<'_>, byte_size: usize) -> Step {
        // we need to wait for more data
        if cursor.data.is_empty() {
            return Step::NeedMoreData;
        }

        // copy available payload length bytes to a buffer held on this client instance
        let start = self.payload_length_frame_len.get() as usize;
        let total_received = (byte_size - start).min(cursor.data.len());
        let mut payload_length_frame_bytes = self.payload_length_frame_bytes.get();
        payload_length_frame_bytes[start..start + total_received]
            .copy_from_slice(&cursor.data[..total_received]);
        self.payload_length_frame_bytes
            .set(payload_length_frame_bytes);
        self.payload_length_frame_len.set(
            self.payload_length_frame_len.get() + u8::try_from(total_received).expect("int cast"),
        );
        cursor.data = &cursor.data[total_received..];

        // short read on payload length - we need to wait for more data
        // whatever bytes were returned from the short read are kept in `payload_length_frame_bytes`
        if (self.payload_length_frame_len.get() as usize) < byte_size {
            return Step::NeedMoreData;
        }

        // Multibyte length quantities are expressed in network byte order
        cursor.body_remain = match byte_size {
            8 => u64::from_be_bytes(payload_length_frame_bytes) as usize,
            2 => u16::from_be_bytes([payload_length_frame_bytes[0], payload_length_frame_bytes[1]])
                as usize,
            _ => unreachable!(),
        };

        self.payload_length_frame_len.set(0);

        cursor.state = ReceiveState::NeedBody;

        if cursor.body_remain == 0 {
            // this is an error
            // the server should've set length to zero
            return self.recv_failed(ErrorCode::InvalidControlFrame);
        }
        Step::Continue
    }

    /// While `control_frame_started`, `cursor.body_remain` counts bytes buffered so far, not bytes left.
    fn buffer_control_payload(
        &self,
        cursor: &mut RecvCursor<'_>,
    ) -> Option<([u8; MAX_CONTROL_PAYLOAD], usize)> {
        if !self.control_frame_started.get() {
            self.ping_len.set(cursor.body_remain as u8);
            cursor.body_remain = 0;
            self.control_frame_started.set(true);
        }
        let payload_len = self.ping_len.get() as usize;

        if !cursor.data.is_empty() {
            let total_received = payload_len.min(cursor.body_remain + cursor.data.len());
            let mut ping_frame_bytes = self.ping_frame_bytes.get();
            let dst =
                &mut ping_frame_bytes[CONTROL_HEADER_SIZE..][cursor.body_remain..total_received];
            let copied = dst.len();
            dst.copy_from_slice(&cursor.data[..copied]);
            self.ping_frame_bytes.set(ping_frame_bytes);
            cursor.body_remain = total_received;
            cursor.data = &cursor.data[copied..];
        }
        if payload_len > cursor.body_remain {
            // wait for more data - the control payload is fragmented across TCP segments
            return None;
        }

        // Stack copy: the caller's dispatch/close path can reach `clear_data`, which mutates `ping_frame_bytes`.
        let mut payload = [0u8; MAX_CONTROL_PAYLOAD];
        payload[..payload_len]
            .copy_from_slice(&self.ping_frame_bytes.get()[CONTROL_HEADER_SIZE..][..payload_len]);
        self.control_frame_started.set(false);
        Some((payload, payload_len))
    }

    fn recv_ping_or_pong(&self, cursor: &mut RecvCursor<'_>, opcode: Opcode) -> Step {
        if !self.control_frame_started.get() && cursor.body_remain > MAX_CONTROL_PAYLOAD {
            return self.recv_failed(ErrorCode::InvalidControlFrame);
        }
        let Some((payload, payload_len)) = self.buffer_control_payload(cursor) else {
            return Step::NeedMoreData;
        };
        self.dispatch_data(&payload[..payload_len], opcode);

        cursor.state = ReceiveState::NeedHeader;
        cursor.body_remain = 0;

        if opcode == Opcode::Ping {
            // we need to send all pongs to pass autobahn tests
            let _ = self.send_pong();
        }
        if cursor.data.is_empty() {
            return Step::NeedMoreData;
        }
        Step::Continue
    }

    fn recv_body(&self, cursor: &mut RecvCursor<'_>) -> Step {
        let buffered_len = self.receive_buffer.borrow().readable_length();
        if buffered_len.saturating_add(cursor.body_remain) > MAX_RECEIVE_MESSAGE_LENGTH {
            return self.recv_failed(ErrorCode::MessageTooBig);
        }

        let (chunk, rest) = cursor
            .data
            .split_at(cursor.body_remain.min(cursor.data.len()));
        let consumed = self.consume(
            chunk,
            cursor.body_remain,
            cursor.last_data_type,
            cursor.is_final,
        );

        cursor.body_remain -= consumed;
        cursor.data = rest;
        if cursor.body_remain == 0 {
            cursor.state = ReceiveState::NeedHeader;
        }

        if cursor.data.is_empty() {
            return Step::NeedMoreData;
        }
        Step::Continue
    }

    /// Assemble the (optional) close payload, echo a close frame back, and
    /// stop reading: a received Close always terminates the parse loop.
    fn recv_close(&self, cursor: &mut RecvCursor<'_>) -> Step {
        if cursor.body_remain == 1 || cursor.body_remain > MAX_CONTROL_PAYLOAD {
            return self.recv_failed(ErrorCode::InvalidControlFrame);
        }

        if cursor.body_remain == 0 {
            self.close_received.set(true);
            self.send_close();
            return Step::Terminated;
        }

        let Some((payload, payload_len)) = self.buffer_control_payload(cursor) else {
            return Step::NeedMoreData;
        };

        self.close_received.set(true);
        if payload_len >= 2 {
            let received_code = u16::from_be_bytes([payload[0], payload[1]]);
            let (echo_code, dispatch_code) = received_close_codes(received_code);
            self.send_close_with_body(
                Some(echo_code),
                Some(dispatch_code),
                &payload[2..payload_len],
            );
        } else {
            self.send_close();
        }
        Step::Terminated
    }

    pub fn send_close(&self) {
        // Received a bodyless Close: echo a normal-closure frame on the wire,
        // but report 1005 ("no status received") to JS per RFC 6455 §7.1.5.
        self.send_close_with_body(Some(1000), Some(CLOSE_CODE_NOT_SPECIFIED), &[]);
    }

    fn enqueue_encoded_bytes(&self, bytes: &[u8]) -> bool {
        // For tunnel mode, write through the tunnel instead of direct socket
        if let Some(tunnel) = self.proxy_tunnel.get() {
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
            let wrote = self.tcp.get().write(bytes);
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

    fn copy_to_send_buffer(&self, bytes: &[u8], do_write: bool) -> bool {
        self.send_data(Copy::Raw(bytes), do_write, Opcode::Binary)
    }

    fn send_data(&self, bytes: Copy<'_>, do_write: bool, opcode: Opcode) -> bool {
        let may_compress = self.deflate.borrow().is_some()
            && matches!(opcode, Opcode::Text | Opcode::Binary)
            && !matches!(bytes, Copy::Raw(_));
        if !may_compress {
            return self.send_data_uncompressed(bytes, do_write, opcode);
        }

        // The compressor consumes UTF-8/raw bytes, so transcode first.
        let utf8_storage: Vec<u8>;
        let content_to_compress: &[u8] = match bytes {
            Copy::Utf16(utf16) => {
                let content_byte_len: usize = strings::element_length_utf16_into_utf8(utf16);
                let mut buf = vec![0u8; content_byte_len];
                let encode_result = strings::copy_utf16_into_utf8(&mut buf, utf16);
                buf.truncate(encode_result.written as usize);
                utf8_storage = buf;
                &utf8_storage
            }
            Copy::Latin1(latin1) => {
                let content_byte_len: usize = strings::element_length_latin1_into_utf8(latin1);
                if content_byte_len == latin1.len() {
                    // It's all ascii, we don't need to copy it an extra time.
                    latin1
                } else {
                    let mut buf = vec![0u8; content_byte_len];
                    let encode_result = strings::copy_latin1_into_utf8(&mut buf, latin1);
                    buf.truncate(encode_result.written as usize);
                    utf8_storage = buf;
                    &utf8_storage
                }
            }
            Copy::Bytes(b) => b,
            Copy::Raw(_) => unreachable!(),
        };

        // Small messages aren't worth the deflate overhead.
        if !self.should_compress(content_to_compress.len(), opcode) {
            return self.send_data_uncompressed(bytes, do_write, opcode);
        }

        let mut compressed: Vec<u8> = Vec::new();
        let compressed_ok = self.deflate.borrow_mut().as_mut().is_some_and(|deflate| {
            deflate
                .compress(content_to_compress, &mut compressed)
                .is_ok()
        });
        if !compressed_ok {
            // If compression fails, fall back to uncompressed
            return self.send_data_uncompressed(bytes, do_write, opcode);
        }

        let frame_size = WebsocketHeader::frame_size_including_mask(compressed.len());
        {
            let mut send_buffer = self.send_buffer.borrow_mut();
            let Ok(writable) = send_buffer.writable_with_size(frame_size) else {
                return false;
            };
            Copy::copy_compressed(
                &self.global_this,
                &mut writable[..frame_size],
                &compressed,
                opcode,
                true,
            );
            send_buffer.update(frame_size);
        }

        if do_write {
            self.debug_assert_socket_writable();
            return self.send_buffer_out();
        }

        true
    }

    fn send_data_uncompressed(&self, bytes: Copy<'_>, do_write: bool, opcode: Opcode) -> bool {
        let (write_len, content_byte_len) = bytes.frame_and_content_len();
        debug_assert!(write_len > 0);

        {
            let mut send_buffer = self.send_buffer.borrow_mut();
            let writable = send_buffer
                .writable_with_size(write_len)
                .expect("unreachable");
            bytes.copy(
                &self.global_this,
                &mut writable[..write_len],
                content_byte_len,
                opcode,
            );
            send_buffer.update(write_len);
        }

        if do_write {
            self.debug_assert_socket_writable();
            return self.send_buffer_out();
        }

        true
    }

    /// In debug builds, assert that the underlying socket can still be written
    /// to (tunnel mode writes through the tunnel instead of `tcp`).
    fn debug_assert_socket_writable(&self) {
        #[cfg(debug_assertions)]
        if self.proxy_tunnel.get().is_none() {
            let tcp = self.tcp.get();
            debug_assert!(!tcp.is_shutdown());
            debug_assert!(!tcp.is_closed());
            debug_assert!(tcp.is_established());
        }
    }

    fn send_buffer_out(&self) -> bool {
        let mut buf = self
            .send_buffer
            .replace(LinearFifo::<u8, DynamicBuffer<u8>>::init());
        // Do not use MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
        let wrote: Result<usize, bool> = {
            let out_buf = buf.readable_slice(0);
            debug_assert!(!out_buf.is_empty());
            if let Some(tunnel) = self.proxy_tunnel.get() {
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
            } else if self.tcp.get().is_closed() {
                Err(false)
            } else {
                let w = self.tcp.get().write(out_buf);
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
                self.send_buffer.replace(buf);
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
                self.send_buffer.replace(buf);
                false
            }
        }
    }

    fn send_pong(&self) -> bool {
        if !self.has_tcp() {
            self.dispatch_abrupt_close(ErrorCode::Ended);
            return false;
        }

        let ping_len = self.ping_len.get() as usize;
        let header = WebsocketHeader::new(self.ping_len.get() & 0x7F, true, Opcode::Pong);
        let mut ping_frame_bytes = self.ping_frame_bytes.get();
        ping_frame_bytes[..2].copy_from_slice(&header.slice());

        if ping_len > 0 {
            // Mask::fill_in_place needs disjoint borrows of the masking key and the payload.
            let (head, payload) = ping_frame_bytes.split_at_mut(CONTROL_HEADER_SIZE);
            let mask_buf: &mut [u8; 4] = (&mut head[2..CONTROL_HEADER_SIZE])
                .try_into()
                .expect("infallible: size matches");
            Mask::fill_in_place(&self.global_this, mask_buf, &mut payload[..ping_len]);
        } else {
            // autobahn tests require that we mask empty pongs
            ping_frame_bytes[2..CONTROL_HEADER_SIZE].fill(0);
        }
        self.ping_frame_bytes.set(ping_frame_bytes);
        // `enqueue_encoded_bytes` may call `terminate → clear_data`, which
        // mutates `ping_frame_bytes`' bookkeeping; send the local copy.
        self.enqueue_encoded_bytes(&ping_frame_bytes[..CONTROL_HEADER_SIZE + ping_len])
    }

    /// `code` is the status code written to the wire frame; `None` sends the
    /// bodyless Close frame RFC 6455 §5.5.1 allows (`body` is then unused, as a
    /// reason cannot be framed without a code). `dispatch_code` overrides the
    /// code reported to JS (`CloseEvent.code`) when it differs from the wire
    /// code — e.g. a received bodyless Close echoes 1000 but reports 1005; when
    /// `None`, JS sees `code`.
    fn send_close_with_body(&self, code: Option<u16>, dispatch_code: Option<u16>, body: &[u8]) {
        let body_len = if code.is_some() {
            body.len().min(MAX_CLOSE_REASON)
        } else {
            0
        };
        // 2-byte status code + reason, or nothing at all.
        let payload_len = if code.is_some() { 2 + body_len } else { 0 };
        log!("Sending close with code {:?}", code);
        if self.has_pending_close_dispatch() {
            // A close is already mid-flush (user-initiated ws.close() under
            // backpressure); don't enqueue a second close frame on top of it.
            return;
        }
        if !self.has_tcp() {
            self.dispatch_abrupt_close(ErrorCode::Ended);
            self.clear_data();
            return;
        }
        // shutdown_read/shutdown are deferred to shutdown_after_close_frame()
        // so the close frame can finish writing first: SHUT_RD on Linux makes
        // the socket immediately readable (recv → 0), and the resulting on_end
        // → terminate → cancel(Failure) would RST and discard the buffered
        // frame.
        let mut frame = [0u8; CONTROL_HEADER_SIZE + 2 + MAX_CLOSE_REASON];
        let header = WebsocketHeader::new((payload_len & 0x7F) as u8, true, Opcode::Close);
        frame[..2].copy_from_slice(&header.slice());
        // the 4-byte masking key lives at frame[2..6]
        if let Some(code) = code {
            frame[CONTROL_HEADER_SIZE..][..2].copy_from_slice(&code.to_be_bytes());
        }

        let mut reason = bun_core::String::empty();
        if body_len > 0 {
            let body = &body[..body_len];
            // close is always utf8
            if !strings::is_valid_utf8(body) {
                self.terminate(ErrorCode::InvalidUtf8);
                return;
            }
            reason = bun_core::String::clone_utf8(body);
            frame[CONTROL_HEADER_SIZE + 2..][..body_len].copy_from_slice(body);
        }

        // we must mask the code (and the reason, if any)
        let frame_len = CONTROL_HEADER_SIZE + payload_len;
        {
            let (head, payload) = frame.split_at_mut(CONTROL_HEADER_SIZE);
            let mask_buf: &mut [u8; 4] = (&mut head[2..CONTROL_HEADER_SIZE])
                .try_into()
                .expect("infallible: size matches");
            Mask::fill_in_place(&self.global_this, mask_buf, &mut payload[..payload_len]);
        }

        if self.enqueue_encoded_bytes(&frame[..frame_len]) {
            let dispatch_code = dispatch_code.or(code).unwrap_or(CLOSE_CODE_NOT_SPECIFIED);
            if self.send_buffer.borrow().readable_length() == 0 {
                self.shutdown_after_close_frame();
                self.clear_data();
                self.dispatch_close(dispatch_code, &mut reason);
            } else {
                // The close frame was only partially written; the remainder is
                // in send_buffer. clear_data() would discard it (and the
                // proxy_tunnel needed to flush it), so defer teardown until
                // handle_writable drains the buffer or the socket dies.
                self.close_dispatch_pending
                    .replace(Some((dispatch_code, reason)));
            }
        }
    }

    /// SHUT_RD + SHUT_WR after the close frame is in the kernel send buffer.
    /// Marks the socket shut-down so loop.c takes the CLEAN_SHUTDOWN branch on
    /// the subsequent EOF instead of dispatching `on_end → terminate → fail →
    /// cancel → close(Failure)`, which would RST and discard the queued close
    /// frame. SSL is excluded because the SSL handshake can happen during
    /// writes; tunnel mode operates on a detached socket.
    fn shutdown_after_close_frame(&self) {
        if !SSL && self.proxy_tunnel.get().is_none() {
            self.tcp.get().shutdown_read();
            self.tcp.get().shutdown();
        }
    }

    fn finish_pending_close(&self) {
        if let Some((code, mut reason)) = self.close_dispatch_pending.take() {
            self.shutdown_after_close_frame();
            self.clear_data();
            self.dispatch_close(code, &mut reason);
        }
    }

    /// Shared tail of the writable handlers (direct socket and proxy tunnel):
    /// flush whatever is queued and, once the buffer is empty, dispatch a
    /// close that was deferred behind it.
    fn drain_send_buffer_and_finish_close(&self) {
        if self.send_buffer.borrow().readable_length() != 0 {
            let _ = self.send_buffer_out();
        }
        if self.send_buffer.borrow().readable_length() == 0 {
            self.finish_pending_close();
        }
    }

    pub fn is_same_socket(&self, socket: &Socket<SSL>) -> bool {
        socket.socket == self.tcp.get().socket
    }

    fn has_pending_close_dispatch(&self) -> bool {
        self.close_dispatch_pending.borrow().is_some()
    }

    pub fn handle_end(&self, socket: Socket<SSL>) {
        debug_assert!(self.is_same_socket(&socket));
        if self.has_pending_close_dispatch() {
            // Peer FIN'd while we're still draining our close frame; finish the
            // drain on the next writable event instead of RST'ing via
            // terminate → fail → cancel(Failure).
            return;
        }
        self.terminate(ErrorCode::Ended);
    }

    pub fn handle_writable(&self, socket: Socket<SSL>) {
        if self.close_received.get() && !self.has_pending_close_dispatch() {
            return;
        }
        debug_assert!(self.is_same_socket(&socket));
        self.drain_send_buffer_and_finish_close();
    }

    pub fn handle_timeout(&self, _socket: Socket<SSL>) {
        self.terminate(ErrorCode::Timeout);
    }

    pub fn handle_connect_error(&self, _socket: Socket<SSL>, _errno: c_int) {
        self.detach_tcp();
        self.terminate(ErrorCode::FailedToConnect);
    }

    pub fn has_backpressure(&self) -> bool {
        if self.send_buffer.borrow().readable_length() > 0 {
            return true;
        }
        if let Some(tunnel) = self.proxy_tunnel.get() {
            // SAFETY: `tunnel` holds a live ref (RefPtr has no `Deref`).
            return unsafe { tunnel.as_ref() }.has_backpressure();
        }
        false
    }

    /// Frame small unbackpressured sends on the stack; else fall back to [`Self::send_data`].
    fn send_frame(&self, bytes: Copy<'_>, payload_byte_len: usize, opcode: Opcode) {
        let frame_size = WebsocketHeader::frame_size_including_mask(payload_byte_len);
        if !self.has_backpressure() && frame_size < STACK_FRAME_SIZE {
            self.send_inline_frame(bytes, payload_byte_len, frame_size, opcode);
            return;
        }

        let _ = self.send_data(bytes, !self.has_backpressure(), opcode);
    }

    // `extern "C"` entrypoint; pointers are valid by C++ contract (see SAFETY comments below).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub extern "C" fn write_binary_data(this_ptr: *mut Self, ptr: *const u8, len: usize, op: u8) {
        // In tunnel mode, SSLWrapper.writeData() can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before the catch block in enqueue_encoded_bytes/send_buffer runs.
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &*this_ptr };

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        // SAFETY: ptr/len from C++; caller guarantees valid slice. Empty Blob
        // sends (null, 0); `ffi::slice` tolerates that shape.
        let slice: &[u8] = unsafe { bun_core::ffi::slice(ptr, len) };
        this.send_frame(Copy::Bytes(slice), slice.len(), Opcode::from_raw(op));
    }

    /// Encode a frame small enough for a stack buffer and hand it straight to
    /// the socket, bypassing the heap-backed send queue.
    fn send_inline_frame(
        &self,
        bytes: Copy<'_>,
        content_len: usize,
        frame_size: usize,
        opcode: Opcode,
    ) {
        debug_assert!(frame_size <= STACK_FRAME_SIZE);
        let mut inline_buf = [0u8; STACK_FRAME_SIZE];
        bytes.copy(
            &self.global_this,
            &mut inline_buf[..frame_size],
            content_len,
            opcode,
        );
        let _ = self.enqueue_encoded_bytes(&inline_buf[..frame_size]);
    }

    fn has_tcp(&self) -> bool {
        // For tunnel mode, we have an active connection through the tunnel
        if self.proxy_tunnel.get().is_some() {
            return true;
        }
        let tcp = self.tcp.get();
        !tcp.is_closed() && !tcp.is_shutdown()
    }

    // `extern "C"` entrypoint; `this_ptr` is non-null by C++ contract (see SAFETY comments below).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub extern "C" fn write_blob(this_ptr: *mut Self, blob_value: JSValue, op: u8) {
        // See write_binary_data() — tunnel.write() can re-enter fail().
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &*this_ptr };

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        // Cast the JSValue to a Blob.
        // `bun_jsc::webcore::Blob` is an opaque C-ABI shim (real
        // layout lives in `bun_runtime::webcore::Blob`, a higher-tier crate).
        // `from_js`/`shared_view` trampoline through extern fns to avoid the
        // dep cycle — see `bun_jsc::webcore::Blob` impl block.
        let Some(blob) = blob_value.as_::<bun_jsc::webcore::Blob>() else {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        };
        let opcode = Opcode::from_raw(op);
        // SAFETY: `as_` returned a live `*mut Blob` owned by the JS heap;
        // the JSValue is rooted by the caller for the duration of this call.
        let data = unsafe { (*blob).shared_view() };
        if data.is_empty() {
            let _ = this.send_data(Copy::Bytes(&[]), !this.has_backpressure(), opcode);
            return;
        }

        this.send_frame(Copy::Bytes(data), data.len(), opcode);
    }

    // `extern "C"` entrypoint; pointers are valid by C++ contract (see SAFETY comments below).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub extern "C" fn write_string(this_ptr: *mut Self, str_: *const ZigString, op: u8) {
        // See write_binary_data() — tunnel.write() can re-enter fail().
        // SAFETY: called from C++ with a valid `heap::alloc` pointer; ScopedRef
        // bumps the intrusive refcount and derefs on Drop (after `this`'s last
        // use, since `this` is declared after the guard).
        let _guard = unsafe { bun_ptr::ScopedRef::new(this_ptr) };
        // SAFETY: called from C++ with a valid pointer; guarded above.
        let this = unsafe { &*this_ptr };

        // SAFETY: str_ is a valid pointer from C++
        let str = unsafe { &*str_ };
        if !this.has_tcp() {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        // Note: 0 is valid

        let opcode = Opcode::from_raw(op & 0x0F);

        // fast path: small frame, no backpressure, attempt to send without allocating
        if !str.is_16bit() && str.len < STACK_FRAME_SIZE {
            let bytes = Copy::Latin1(str.slice());
            let (frame_size, byte_len) = bytes.frame_and_content_len();
            if !this.has_backpressure() && frame_size < STACK_FRAME_SIZE {
                this.send_inline_frame(bytes, byte_len, frame_size, opcode);
                return;
            }
            // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
        } else if (str.len * 4) < STACK_FRAME_SIZE && !this.has_backpressure() {
            let bytes = Copy::Utf16(str.utf16_slice_aligned());
            let (frame_size, byte_len) = bytes.frame_and_content_len();
            this.send_inline_frame(bytes, byte_len, frame_size, opcode);
            return;
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

    fn dispatch_abrupt_close(&self, code: ErrorCode) {
        let Some(out) = self.outgoing_websocket.take() else {
            return;
        };
        self.unref_keep_alive();
        jsc::mark_binding!();
        CppWebSocket::opaque_ref(out.as_ptr()).did_abrupt_close(code);
        // SAFETY: allocation kept live by caller's ref guard (see
        // cancel/handle_close).
        unsafe { Self::deref(self.as_ctx_ptr()) };
    }

    fn dispatch_close(&self, code: u16, reason: &mut bun_core::String) {
        let Some(out) = self.outgoing_websocket.take() else {
            return;
        };
        self.unref_keep_alive();
        jsc::mark_binding!();
        CppWebSocket::opaque_ref(out.as_ptr()).did_close(code, reason);
        // SAFETY: allocation kept live by caller's ref guard.
        unsafe { Self::deref(self.as_ctx_ptr()) };
    }

    // `extern "C"` entrypoint; pointers are valid (or null where checked) by C++ contract.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
        let this = unsafe { &*this_ptr };

        if !this.has_tcp() {
            return;
        }
        let mut reason_buf = [0u8; MAX_CONTROL_PAYLOAD];
        // SAFETY: reason is null or a valid *const ZigString from C++
        let reason_len = unsafe { reason.as_ref() }
            .and_then(|str| encode_close_reason(str, &mut reason_buf))
            .unwrap_or(0);

        let code = (code != CLOSE_CODE_NOT_SPECIFIED).then_some(code);
        this.send_close_with_body(code, None, &reason_buf[..reason_len]);
    }

    /// Allocate a client with `ref_count == 1` (the I/O-layer ref, released by
    /// `handle_close` for adopted sockets and by `clear_data` in tunnel mode)
    /// and an optional permessage-deflate context.
    fn new_raw(
        outgoing: *mut CppWebSocket,
        global_this: &JSGlobalObject,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<*mut SslCtx>,
        proxy_tunnel: Option<NonNull<WebSocketProxyTunnel>>,
    ) -> *mut Self {
        let ws = bun_core::heap::into_raw(Box::new(WebSocket::<SSL> {
            ref_count: Cell::new(1),
            tcp: Cell::new(Socket::<SSL>::detached()),
            outgoing_websocket: Cell::new(NonNull::new(outgoing)),
            receive_state: Cell::new(ReceiveState::NeedHeader),
            receiving_type: Cell::new(Opcode::ResB),
            receiving_is_final: Cell::new(true),
            ping_frame_bytes: Cell::new([0u8; CONTROL_HEADER_SIZE + 128]),
            ping_len: Cell::new(0),
            control_frame_started: Cell::new(false),
            close_received: Cell::new(false),
            close_dispatch_pending: RefCell::new(None),
            receive_body_remain: Cell::new(0),
            receive_buffer: RefCell::new(LinearFifo::<u8, DynamicBuffer<u8>>::init()),
            send_buffer: RefCell::new(LinearFifo::<u8, DynamicBuffer<u8>>::init()),
            global_this: GlobalRef::from(global_this),
            poll_ref: Cell::new(KeepAlive::init()),
            header_fragment: Cell::new(None),
            payload_length_frame_bytes: Cell::new([0u8; 8]),
            payload_length_frame_len: Cell::new(0),
            initial_data_handler: Cell::new(None),
            // SAFETY: bun_vm() never returns null; event_loop ptr is live for VM lifetime.
            event_loop: global_this.bun_vm().event_loop_mut(),
            deflate: RefCell::new(None),
            receiving_compressed: Cell::new(false),
            message_is_compressed: Cell::new(false),
            secure: Cell::new(secure),
            proxy_tunnel: Cell::new(proxy_tunnel),
        }));
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::ALLOC_TYPE_NAME, ws);
        // SAFETY: ws was just allocated via heap::alloc; no other reference exists.
        let ws_ref = unsafe { &mut *ws };

        if let Some(params) = deflate_params {
            *ws_ref.deflate.get_mut() = WebSocketDeflate::init(*params).ok();
        }

        ws
    }

    /// Shared tail of `init`/`init_with_tunnel`: reserve the I/O buffers, take
    /// the keep-alive ref, queue any handshake-buffered bytes, and take the
    /// C++-side ref. Returns the type-erased pointer handed back to C++.
    fn finish_init(
        ws: *mut Self,
        outgoing: *mut CppWebSocket,
        global_this: &JSGlobalObject,
        buffered_data: *mut u8,
        buffered_data_len: usize,
    ) -> *mut c_void {
        // SAFETY: `ws` is the live `heap::alloc` allocation from `new_raw`.
        let ws_ref = unsafe { &mut *ws };
        bun_core::handle_oom(ws_ref.send_buffer.get_mut().ensure_total_capacity(2048));
        bun_core::handle_oom(ws_ref.receive_buffer.get_mut().ensure_total_capacity(2048));
        ws_ref
            .poll_ref
            .get_mut()
            .r#ref(Self::vm_loop_ctx(global_this));

        if buffered_data_len > 0 {
            // SAFETY: buffered_data/len from C++; caller guarantees validity.
            // The upgrade client allocated this buffer via mimalloc
            // and transfers ownership to us.
            // The global allocator is also mimalloc, so `heap::take`
            // adopts the original allocation (no copy) and `Drop` will `mi_free` it.
            let buffered_slice: Box<[u8]> = unsafe {
                bun_core::heap::take(std::ptr::slice_from_raw_parts_mut(
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
            // Backref so `handle_data` can drain the buffered slice ahead of
            // fresh socket data, and so `deinit()` can detach from the box if
            // teardown races ahead of the microtask drain.
            ws_ref.initial_data_handler.set(NonNull::new(initial_data));

            // Use a higher-priority callback for the initial onData handler
            // `queue_microtask_callback` takes an erased
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
        let secure = (!secure_ptr.is_null()).then(|| secure_ptr.cast::<SslCtx>());
        let ws = Self::new_raw(outgoing, global_this, deflate_params, secure, None);

        // `adopt_group` takes a closure to write the new socket.
        let group = {
            // reshaped for borrowck — `rare_data()` borrows `vm`
            // mutably and `ws_client_group` also wants a `vm` reference.
            let vm_ptr: *mut _ = global_this.bun_vm().as_mut();
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
            // another borrow of the new allocation.
            |owner, sock| unsafe { core::ptr::addr_of_mut!((*owner).tcp).write(Cell::new(sock)) },
        ) {
            // SAFETY: `ws` is the `heap::alloc` allocation just created
            // above; sole owner on this failure path.
            unsafe { Self::deref(ws) };
            return core::ptr::null_mut();
        }

        Self::finish_init(ws, outgoing, global_this, buffered_data, buffered_data_len)
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
        // intrusive refcount. The caller retains its own ref; we bump the
        // intrusive count to take ownership
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
        let ws = Self::new_raw(
            outgoing,
            global_this,
            deflate_params,
            None,
            Some(tunnel_owned),
        );

        Self::finish_init(ws, outgoing, global_this, buffered_data, buffered_data_len)
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
        // SAFETY: caller contract — `this_ptr` is a live `heap::alloc` pointer
        // with no outstanding `&`/`&mut` borrow.
        Self::handle_data(unsafe { ThisPtr::new(this_ptr) }, data);
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
        if this.close_received.get() && !this.has_pending_close_dispatch() {
            return;
        }
        // send_buffer → tunnel.write() can re-enter fail() synchronously
        // (see write_binary_data). The tunnel ref-guards itself in
        // on_writable() but not this struct.
        let _guard = this.ref_guard();

        this.drain_send_buffer_and_finish_close();
    }

    // `extern "C"` entrypoint; `this_ptr` is non-null by C++ contract (see SAFETY comments below).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
        let this = unsafe { &*this_ptr };

        this.clear_data();

        // This is only called by outgoing_websocket.
        if this.outgoing_websocket.take().is_some() {
            // SAFETY: allocation kept live by the local guard above.
            unsafe { Self::deref(this_ptr) };
        }

        if !this.tcp.get().is_closed() {
            // no need to be .failure we still wanna to send pending SSL buffer + close_notify
            if SSL {
                this.tcp.get().close(uws::CloseKind::Normal);
            } else {
                this.tcp.get().close(uws::CloseKind::Failure);
            }
        }
    }

    // `deinit` is the IntrusiveRc destructor callback; not `impl Drop` because
    // self is heap-allocated via heap::alloc and crosses FFI as *mut c_void.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: called once when ref_count hits zero
        let this_ref = unsafe { &mut *this };
        this_ref.clear_data();
        // deflate already dropped in clear_data; this is defensive
        *this_ref.deflate.get_mut() = None;
        if let Some(handler) = this_ref.initial_data_handler.take() {
            // SAFETY: the handler box was allocated via `heap::into_raw` in
            // init()/init_with_tunnel() and is normally freed by the queued
            // microtask in `InitialDataHandler::handle`; this field still
            // being set means that microtask has not run yet, so the box is
            // live and the raw field write does not alias any borrow.
            unsafe { core::ptr::addr_of_mut!((*handler.as_ptr()).adopted).write(None) };
            if this_ref.global_this.bun_vm().is_shutting_down() {
                // SAFETY: same allocation as above; the VM is shutting down, so
                // the queued microtask can no longer run and this is the sole
                // remaining owner of the box.
                drop(unsafe { bun_core::heap::take(handler.as_ptr()) });
            }
        }
        bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::ALLOC_TYPE_NAME, this);
        // SAFETY: this was allocated via heap::alloc in init/init_with_tunnel
        drop(unsafe { bun_core::heap::take(this) });
    }

    // `extern "C"` entrypoint; `this` is non-null by C++ contract (see SAFETY comment below).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub extern "C" fn memory_cost(this: *const Self) -> usize {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &*this };
        let mut cost: usize = size_of::<Self>();
        cost += this.send_buffer.try_borrow().map_or(0, |b| b.capacity());
        cost += this.receive_buffer.try_borrow().map_or(0, |b| b.capacity());
        // This is under-estimated a little, as we don't include usockets context.
        cost
    }
}

/// Transcode a close reason to UTF-8 into `buf`; `None` when it exceeds `MAX_CLOSE_REASON`.
fn encode_close_reason(reason: &ZigString, buf: &mut [u8; MAX_CONTROL_PAYLOAD]) -> Option<usize> {
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    if reason.is_16bit() {
        // Allocates; close-reason is bounded ≤125 bytes and this path is cold.
        let utf8 = reason.to_owned_slice();
        cursor.write_all(&utf8).ok()?;
    } else if reason.is_utf8() {
        cursor.write_all(reason.slice()).ok()?;
    } else {
        // Latin-1 → UTF-8: raw Latin-1 bytes would fail `send_close_with_body`'s UTF-8 check.
        let result = strings::copy_latin1_into_utf8(cursor.get_mut(), reason.slice());
        if (result.read as usize) < reason.slice().len() {
            return None;
        }
        cursor.set_position(result.written as u64);
    }
    let len = cursor.position() as usize;
    (len <= MAX_CLOSE_REASON).then_some(len)
}

// ──────────────────────────────────────────────────────────────────────────
// exportAll()
// ──────────────────────────────────────────────────────────────────────────
// avoids the `paste` crate by passing the nine fully-qualified
// `#[no_mangle]` idents at the call site (declare-site macro).
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
    /// Pending-activity ref, dropped when [`Self::handle_without_deinit`] consumes `adopted`.
    pub ws: Option<CppWebSocketRef>,
    pub slice: Box<[u8]>,
}

impl<const SSL: bool> InitialDataHandler<SSL> {
    pub(crate) fn handle_without_deinit(&mut self) {
        let Some(this_socket_ptr) = self.adopted.take() else {
            return;
        };
        let ws_ptr = this_socket_ptr.as_ptr();
        // this fn is reachable re-entrantly from `WebSocket::handle_data`,
        // so never materialize a `&mut WebSocket` here.
        // SAFETY: `adopted` is a backref to a live WebSocket (heap::alloc
        // provenance).
        unsafe { (*ws_ptr).initial_data_handler.set(None) };
        // RAII: take the owned ref so it drops at
        // scope exit. Paired with the `adopted.take()` above so the ref is
        // released exactly once even when this fn is later re-called with
        // `adopted == None` (early return leaves `ws` already `None`).
        let _ws_ref = self.ws.take();

        // For tunnel mode, tcp is detached but connection is still active through the tunnel
        // SAFETY: `ws_ptr` is live (see above); brief shared borrows for
        // `is_closed()` / `is_some()` — no `&mut` to `*ws_ptr` is live.
        let is_connected =
            unsafe { !(*ws_ptr).tcp.get().is_closed() || (*ws_ptr).proxy_tunnel.get().is_some() };
        // SAFETY: `ws_ptr` is live; raw read of a `Copy` field.
        if unsafe { (*ws_ptr).outgoing_websocket.get().is_some() } && is_connected {
            // SAFETY: `ws_ptr` carries `heap::alloc` provenance and is live; no
            // borrow of `*ws_ptr` is live in this frame across the call.
            let ws = unsafe { ThisPtr::new(ws_ptr) };
            WebSocket::<SSL>::handle_data(ws, &self.slice);
        }
    }

    /// `extern "C"` thunk shape for `JSGlobalObject::queue_microtask_callback`.
    pub(crate) unsafe extern "C" fn handle(this: *mut c_void) {
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
    UnexpectedRsv1 = 37,
}

// ──────────────────────────────────────────────────────────────────────────
// Mask
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct Mask;

impl Mask {
    fn generate(global_this: &JSGlobalObject) -> [u8; 4] {
        let entropy = global_this.bun_vm().as_mut().rare_data().entropy_slice(4);
        entropy[..4].try_into().expect("infallible: size matches")
    }

    pub(crate) fn fill(
        global_this: &JSGlobalObject,
        mask_buf: &mut [u8; 4],
        output: &mut [u8],
        input: &[u8],
    ) {
        *mask_buf = Self::generate(global_this);
        let skip_mask = u32::from_ne_bytes(*mask_buf) == 0;
        if input.is_empty() {
            bun_core::hint::cold();
            return;
        }
        bun_highway::fill_with_skip_mask(*mask_buf, &mut output[..input.len()], input, skip_mask);
    }

    /// In-place variant for when output and input alias the same buffer
    /// (borrowck forbids `&mut [u8]` + `&[u8]` aliasing in `fill`).
    pub(crate) fn fill_in_place(
        global_this: &JSGlobalObject,
        mask_buf: &mut [u8; 4],
        buf: &mut [u8],
    ) {
        *mask_buf = Self::generate(global_this);
        let skip_mask = u32::from_ne_bytes(*mask_buf) == 0;
        if buf.is_empty() {
            bun_core::hint::cold();
            return;
        }
        bun_highway::fill_with_skip_mask_inplace(*mask_buf, buf, skip_mask);
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

/// Per-`handle_data_loop` parse cursor; the epilogue persists it across socket reads.
struct RecvCursor<'a> {
    data: &'a [u8],
    state: ReceiveState,
    body_remain: usize,
    is_final: bool,
    /// Opcode of the message being assembled; interleaved control frames do not change it.
    last_data_type: Opcode,
}

/// Outcome of one frame-loop step.
enum Step {
    Continue,
    NeedMoreData,
    Terminated,
}

/// Map a status code received in a Close frame to the `(wire echo, JS dispatch)`
/// pair. RFC 6455 §7.4.1-§7.4.2: codes outside the legal on-wire set (`<1000`,
/// the reserved `1004`–`1006` and `1015`–`2999`, and the undefined `>4999`) are
/// a protocol error, so JS sees 1002. §7.1.5: the JS-visible code is otherwise
/// the received one. The wire echo acknowledges a 1001 ("going away") with a
/// normal-closure frame.
fn received_close_codes(received: u16) -> (u16, u16) {
    let is_invalid = received < 1000
        || (1004..1007).contains(&received)
        || (1015..=2999).contains(&received)
        || received > 4999;
    let dispatch = if is_invalid { 1002 } else { received };
    let echo = if dispatch == 1001 { 1000 } else { dispatch };
    (echo, dispatch)
}

// ──────────────────────────────────────────────────────────────────────────
// parseWebSocketHeader
// ──────────────────────────────────────────────────────────────────────────

/// The decoded first two bytes of a frame, plus the receive state that follows them.
struct ParsedHeader {
    opcode: Opcode,
    payload_len: usize,
    is_fragmented: bool,
    is_final: bool,
    /// The RSV1 bit (RFC 7692 per-message deflate). Validated by the caller:
    /// only the first frame of a data message may set it.
    compressed: bool,
    next: ReceiveState,
}

fn parse_websocket_header(bytes: [u8; 2]) -> ParsedHeader {
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
    let opcode = header.opcode();
    let payload_len = header.len() as usize;
    let is_data_frame = matches!(opcode, Opcode::Text | Opcode::Binary);
    let mut parsed = ParsedHeader {
        opcode,
        payload_len,
        is_fragmented: opcode == Opcode::Continue || !header.final_(),
        is_final: header.final_(),
        compressed: header.compressed(),
        next: ReceiveState::Fail,
    };

    // A server must not mask data frames it sends to a client.
    if header.mask() && is_data_frame {
        parsed.next = ReceiveState::NeedMask;
        return parsed;
    }

    // rsv2 and rsv3 must always be 0 per RFC 6455 (rsv1 is checked by the caller).
    if header.rsv() != 0 {
        return parsed;
    }

    parsed.next = match opcode {
        Opcode::Text | Opcode::Continue | Opcode::Binary => match payload_len {
            0..=125 => ReceiveState::NeedBody,
            126 => ReceiveState::ExtendedPayloadLength16,
            127 => ReceiveState::ExtendedPayloadLength64,
            _ => ReceiveState::Fail,
        },
        Opcode::Close => ReceiveState::Close,
        Opcode::Ping => ReceiveState::Ping,
        Opcode::Pong => ReceiveState::Pong,
        _ => ReceiveState::Fail,
    };
    parsed
}

// ──────────────────────────────────────────────────────────────────────────
// Copy
// ──────────────────────────────────────────────────────────────────────────

/// An outgoing payload in its source encoding; `Raw` is already framed, the
/// rest are framed and masked by [`Copy::copy`].
#[derive(Copy, Clone)]
enum Copy<'a> {
    Utf16(&'a [u16]),
    Latin1(&'a [u8]),
    Bytes(&'a [u8]),
    Raw(&'a [u8]),
}

/// Disjoint header / masking-key / payload views of one outbound frame.
struct FrameParts<'a> {
    header: &'a mut [u8],
    mask: &'a mut [u8; 4],
    payload: &'a mut [u8],
}

/// Split a frame-sized `buf` into its [`FrameParts`], writing the extended length bytes.
fn split_frame(buf: &mut [u8], content_byte_len: usize) -> FrameParts<'_> {
    let length_byte_count = WebsocketHeader::length_byte_count(content_byte_len);
    debug_assert_eq!(
        WebsocketHeader::frame_size_including_mask(content_byte_len),
        buf.len()
    );
    match length_byte_count {
        0 => {}
        2 => buf[2..4].copy_from_slice(&(content_byte_len as u16).to_be_bytes()),
        8 => buf[2..10].copy_from_slice(&(content_byte_len as u64).to_be_bytes()),
        _ => unreachable!(),
    }
    let mask_offset = 2 + length_byte_count;
    let (head, payload) = buf.split_at_mut(mask_offset + 4);
    let (header, mask) = head.split_at_mut(mask_offset);
    FrameParts {
        header,
        mask: mask.try_into().expect("infallible: size matches"),
        payload: &mut payload[..content_byte_len],
    }
}

impl Copy<'_> {
    /// Returns `(frame_len, content_byte_len)`: the size of the full masked
    /// frame to write out and the UTF-8/byte length of the payload it carries
    /// (`Raw` is already a frame, so both are the raw length).
    pub(crate) fn frame_and_content_len(&self) -> (usize, usize) {
        let byte_len = match self {
            Copy::Utf16(utf16) => strings::element_length_utf16_into_utf8(utf16),
            Copy::Latin1(latin1) => strings::element_length_latin1_into_utf8(latin1),
            Copy::Bytes(bytes) => bytes.len(),
            Copy::Raw(raw) => return (raw.len(), raw.len()),
        };
        (
            WebsocketHeader::frame_size_including_mask(byte_len),
            byte_len,
        )
    }

    pub(crate) fn copy(
        &self,
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        content_byte_len: usize,
        opcode: Opcode,
    ) {
        self.copy_with_compressed_flag(global_this, buf, content_byte_len, opcode, false);
    }

    /// Frame an already-deflated payload; `is_first_fragment` controls RSV1.
    pub(crate) fn copy_compressed(
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        compressed_data: &[u8],
        opcode: Opcode,
        is_first_fragment: bool,
    ) {
        Copy::Bytes(compressed_data).copy_with_compressed_flag(
            global_this,
            buf,
            compressed_data.len(),
            opcode,
            is_first_fragment,
        );
    }

    fn copy_with_compressed_flag(
        &self,
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        content_byte_len: usize,
        opcode: Opcode,
        compressed: bool,
    ) {
        if let Copy::Raw(raw) = self {
            debug_assert!(buf.len() >= raw.len());
            debug_assert!(buf.as_ptr() != raw.as_ptr());
            buf[..raw.len()].copy_from_slice(raw);
            return;
        }

        let mut header =
            WebsocketHeader::new(WebsocketHeader::pack_length(content_byte_len), true, opcode);
        header.set_compressed(compressed);

        let mut parts = split_frame(buf, content_byte_len);

        match self {
            Copy::Utf16(utf16) => {
                let encoded = strings::copy_utf16_into_utf8_impl::<true>(parts.payload, utf16);
                debug_assert_eq!(encoded.written as usize, content_byte_len);
                debug_assert_eq!(encoded.read as usize, utf16.len());
                header
                    .write_header(&mut parts.header, encoded.written as usize)
                    .expect("unreachable");
                Mask::fill_in_place(global_this, parts.mask, parts.payload);
            }
            Copy::Latin1(latin1) => {
                let encoded = strings::copy_latin1_into_utf8(parts.payload, latin1);
                debug_assert_eq!(encoded.written as usize, content_byte_len);
                // latin1 can contain non-ascii
                debug_assert_eq!(encoded.read as usize, latin1.len());
                header
                    .write_header(&mut parts.header, encoded.written as usize)
                    .expect("unreachable");
                Mask::fill_in_place(global_this, parts.mask, parts.payload);
            }
            Copy::Bytes(bytes) => {
                header
                    .write_header(&mut parts.header, bytes.len())
                    .expect("unreachable");
                Mask::fill(global_this, parts.mask, parts.payload, bytes);
            }
            Copy::Raw(_) => unreachable!(),
        }
    }
}
