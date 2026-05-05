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
use bun_ptr::IntrusiveArc;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_collections::LinearFifo;
use bun_core::Output;
use bun_http::websocket::{Opcode, WebsocketHeader};
use bun_jsc::{self as jsc, EventLoop, JSGlobalObject, JSValue, ZigString};
use bun_ptr::IntrusiveRc;
use bun_str::{self as bstr_mod, strings};
use bun_uws::{self as uws, NewSocketHandler, SslCtx, us_bun_verify_error_t, us_socket_t};

use crate::websocket_client::cpp_websocket::CppWebSocket;
use crate::websocket_client::websocket_deflate::{self as websocket_deflate, WebSocketDeflate};
use crate::websocket_client::websocket_proxy_tunnel::WebSocketProxyTunnel;

bun_output::declare_scope!(WebSocketClient, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(WebSocketClient, $($arg)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// NewWebSocketClient(comptime ssl: bool) → WebSocket<const SSL: bool>
// ──────────────────────────────────────────────────────────────────────────

pub type Socket<const SSL: bool> = NewSocketHandler<SSL>;

const STACK_FRAME_SIZE: usize = 1024;
/// Minimum message size to compress (RFC 7692 recommendation)
const MIN_COMPRESS_SIZE: usize = 860;
/// DEFLATE overhead
const COMPRESSION_OVERHEAD: usize = 4;

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
    pub receive_buffer: LinearFifo<u8>,

    pub send_buffer: LinearFifo<u8>,

    // TODO(port): LIFETIMES.tsv classifies as JSC_BORROW (&JSGlobalObject), but this
    // struct is heap-allocated via bun.new and returned to C++ as *anyopaque, so a
    // borrowed lifetime param is not expressible. Using &'static; revisit in Phase B.
    pub global_this: &'static JSGlobalObject,
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
    pub proxy_tunnel: Option<IntrusiveArc<WebSocketProxyTunnel>>,
}

// IntrusiveRc wiring: ref/deref forward to ref_count; final deref calls deinit()
// TODO(port): bun.ptr.RefCount → bun_ptr::IntrusiveRc<WebSocket<SSL>>; the
// destructor callback is `deinit` (drops self + bun.destroy).
impl<const SSL: bool> WebSocket<SSL> {
    #[inline]
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    #[inline]
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; we own the allocation (bun.new/Box::into_raw)
            unsafe { Self::deinit(self as *const Self as *mut Self) };
        }
    }
}

impl<const SSL: bool> WebSocket<SSL> {
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
        self.poll_ref.unref(self.global_this.bun_vm());
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
            tunnel.clear_connected_websocket();
            tunnel.shutdown();
            // tunnel.deref() → IntrusiveArc::drop decrements the embedded refcount
            drop(tunnel);
            // Release the I/O-layer ref taken in init_with_tunnel() — the
            // tunnel was this struct's socket-equivalent owner. In the
            // non-tunnel path this same ref is released by handle_close()
            // when the adopted uSockets socket fires its close event, but
            // tunnel mode never adopts a socket so that callback never runs.
            // Callers that touch `self` after clear_data() must hold a local
            // ref guard (see cancel/finalize).
            self.deref();
        }
    }

    pub extern "C" fn cancel(this: *mut Self) {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &mut *this };
        log!("cancel");
        // clear_data() may drop the tunnel's I/O-layer ref; keep `this`
        // alive until we've finished closing the socket below.
        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());

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
            // SAFETY: ws is a valid CppWebSocket* held by us
            unsafe { ws.as_ref().did_abrupt_close(code) };
            self.deref();
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
            // SAFETY: ws is a valid CppWebSocket* held by us
            let ws_ref = unsafe { ws.as_ref() };
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
                let ssl_ptr = socket.get_native_handle() as *mut boringssl::c::SSL;
                // SAFETY: ssl_ptr is valid for the lifetime of the socket
                if let Some(servername) = unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0).as_ref() } {
                    // SAFETY: servername is a NUL-terminated C string
                    let hostname = unsafe { core::ffi::CStr::from_ptr(servername as *const _ as *const core::ffi::c_char) }.to_bytes();
                    if !boringssl::check_server_identity(ssl_ptr, hostname) {
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
        self.deref();
    }

    pub fn terminate(&mut self, code: ErrorCode) {
        log!("terminate");
        self.fail(code);
    }

    fn clear_receive_buffers(&mut self, free: bool) {
        self.receive_buffer.head = 0;
        self.receive_buffer.count = 0;

        if free {
            // TODO(port): LinearFifo::deinit → Drop semantics; reset to fresh state
            self.receive_buffer = LinearFifo::new();
        }

        self.receive_pending_chunk_len = 0;
        self.receive_body_remain = 0;
    }

    fn clear_send_buffers(&mut self, free: bool) {
        self.send_buffer.head = 0;
        self.send_buffer.count = 0;
        if free {
            self.send_buffer = LinearFifo::new();
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
        // SAFETY: out is a valid CppWebSocket* held by us
        let out = unsafe { out.as_ref() };

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
                    // PORT NOTE: reshaped for borrowck — readable_slice borrows self
                    // TODO(port): borrowck — need to extract slice before calling dispatch
                    let slice_ptr = self.receive_buffer.readable_slice(0).as_ptr();
                    let slice_len = self.receive_buffer.readable_slice(0).len();
                    // SAFETY: slice valid until clear_receive_buffers below
                    let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
                    self.dispatch_compressed_data(slice, kind);
                    self.clear_receive_buffers(false);
                    self.receiving_compressed = false;
                    self.message_is_compressed = false;
                }
            } else {
                self.receive_pending_chunk_len =
                    self.receive_pending_chunk_len.saturating_sub(left_in_fragment);
            }
            return data.len();
        }

        // Non-compressed path remains the same
        // did all the data fit in the buffer?
        // we can avoid copying & allocating a temporary buffer
        if is_final && data.len() == left_in_fragment && self.receive_pending_chunk_len == 0 {
            if self.receive_buffer.count == 0 {
                self.dispatch_data(data, kind);
                self.message_is_compressed = false;
                return data.len();
            } else if data.is_empty() {
                // PORT NOTE: reshaped for borrowck
                let slice_ptr = self.receive_buffer.readable_slice(0).as_ptr();
                let slice_len = self.receive_buffer.readable_slice(0).len();
                // SAFETY: slice valid until clear_receive_buffers below
                let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
                self.dispatch_data(slice, kind);
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
                // PORT NOTE: reshaped for borrowck
                let slice_ptr = self.receive_buffer.readable_slice(0).as_ptr();
                let slice_len = self.receive_buffer.readable_slice(0).len();
                // SAFETY: slice valid until clear_receive_buffers below
                let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
                self.dispatch_data(slice, kind);
                self.clear_receive_buffers(false);
                self.message_is_compressed = false;
            }
        } else {
            self.receive_pending_chunk_len =
                self.receive_pending_chunk_len.saturating_sub(left_in_fragment);
        }
        data.len()
    }

    pub fn handle_data(&mut self, socket: Socket<SSL>, data_: &[u8]) {
        // after receiving close we should ignore the data
        if self.close_received {
            return;
        }
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): scopeguard captures &self while &mut self is used below;
        // Phase B: convert to manual ref/deref at exit points or use raw ptr in guard.

        // Due to scheduling, it is possible for the websocket onData
        // handler to run with additional data before the microtask queue is
        // drained.
        if let Some(initial_handler) = self.initial_data_handler {
            // This calls `handle_data`
            // We deliberately do not set self.initial_data_handler to None here, that's done in handle_without_deinit.
            // We do not free the memory here since the lifetime is managed by the microtask queue (it should free when called from there)
            // SAFETY: initial_handler is valid (managed by microtask queue)
            unsafe { initial_handler.as_ptr().as_mut().unwrap().handle_without_deinit() };

            // handle_without_deinit is supposed to clear the handler from WebSocket*
            // to prevent an infinite loop
            debug_assert!(self.initial_data_handler.is_none());

            // If we disconnected for any reason in the re-entrant case, we should just ignore the data
            if self.outgoing_websocket.is_none() || !self.has_tcp() {
                return;
            }
        }

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
                        let _ = self.consume(b"", receive_body_remain, last_receive_data_type, is_final);

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
                    self.payload_length_frame_len += u8::try_from(total_received).unwrap();
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

                    // PORT NOTE: reshaped for borrowck — copy ping data range before dispatch
                    let ping_data_ptr = self.ping_frame_bytes[6..][..ping_len].as_ptr();
                    // SAFETY: ping_frame_bytes lives in self; valid for this call
                    let ping_data = unsafe { core::slice::from_raw_parts(ping_data_ptr, ping_len) };
                    self.dispatch_data(ping_data, Opcode::Ping);

                    receive_state = ReceiveState::NeedHeader;
                    receive_body_remain = 0;
                    receiving_type = last_receive_data_type;
                    self.ping_received = false;

                    // we need to send all pongs to pass autobahn tests
                    let _ = self.send_pong(socket);
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

                    let pong_data_ptr = self.ping_frame_bytes[6..][..pong_len].as_ptr();
                    // SAFETY: ping_frame_bytes lives in self; valid for this call
                    let pong_data = unsafe { core::slice::from_raw_parts(pong_data_ptr, pong_len) };
                    self.dispatch_data(pong_data, Opcode::Pong);

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
                        let to_copy =
                            data.len().min(self.ping_len as usize - receive_body_remain);
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
                            self.send_close_with_body(socket, code, Some(&mut buf), ping_len - 2);
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
        self.send_close_with_body(self.tcp, 1000, None, 0);
    }

    fn enqueue_encoded_bytes(&mut self, socket: Socket<SSL>, bytes: &[u8]) -> bool {
        // For tunnel mode, write through the tunnel instead of direct socket
        if let Some(tunnel) = &self.proxy_tunnel {
            let wrote = match tunnel.write(bytes) {
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
            let wrote = socket.write(bytes);
            let expected = c_int::try_from(bytes.len()).unwrap();
            if wrote == expected {
                return true;
            }

            if wrote < 0 {
                self.terminate(ErrorCode::FailedToWrite);
                return false;
            }

            let _ = self.copy_to_send_buffer(&bytes[usize::try_from(wrote).unwrap()..], false);
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
            // PORT NOTE: Zig used deflate.rare_data.allocator(); in Rust we use global mimalloc.
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
                    self.global_this,
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
                // PORT NOTE: reshaped for borrowck
                let slice_ptr = self.send_buffer.readable_slice(0).as_ptr();
                let slice_len = self.send_buffer.readable_slice(0).len();
                // SAFETY: slice valid for this call
                let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
                return self.send_buffer_out(slice);
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
        bytes.copy(self.global_this, &mut writable[..write_len], content_byte_len, opcode);
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
            // PORT NOTE: reshaped for borrowck
            let slice_ptr = self.send_buffer.readable_slice(0).as_ptr();
            let slice_len = self.send_buffer.readable_slice(0).len();
            // SAFETY: slice valid for this call
            let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
            return self.send_buffer_out(slice);
        }

        true
    }

    // PORT NOTE: renamed from `sendBuffer` to avoid clash with `send_buffer` field
    fn send_buffer_out(&mut self, out_buf: &[u8]) -> bool {
        debug_assert!(!out_buf.is_empty());
        // Do not use MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
        let wrote: usize = if let Some(tunnel) = &self.proxy_tunnel {
            // In tunnel mode, route through the tunnel's TLS layer
            // instead of the detached raw socket.
            match tunnel.write(out_buf) {
                Ok(w) => w,
                Err(_) => {
                    self.terminate(ErrorCode::FailedToWrite);
                    return false;
                }
            }
        } else {
            if self.tcp.is_closed() {
                return false;
            }
            let w = self.tcp.write(out_buf);
            if w < 0 {
                self.terminate(ErrorCode::FailedToWrite);
                return false;
            }
            usize::try_from(w).unwrap()
        };
        let readable = self.send_buffer.readable_slice(0);
        if readable.as_ptr() == out_buf.as_ptr() {
            self.send_buffer.discard(wrote);
        }
        true
    }

    fn send_pong(&mut self, socket: Socket<SSL>) -> bool {
        if !self.has_tcp() {
            self.dispatch_abrupt_close(ErrorCode::Ended);
            return false;
        }

        let mut header = WebsocketHeader::from_bits(0u16);
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
            let mask_buf: &mut [u8; 4] = (&mut head[2..6]).try_into().unwrap();
            let to_mask = &mut tail[..ping_len];
            // SAFETY: input and output point to the same memory; Mask::fill supports in-place
            Mask::fill_in_place(self.global_this, mask_buf, to_mask);
            // PORT NOTE: reshaped — copy out to avoid borrow conflict with &mut self
            let frame_len = 6 + ping_len;
            let frame_ptr = self.ping_frame_bytes.as_ptr();
            // SAFETY: frame valid for this call
            let frame = unsafe { core::slice::from_raw_parts(frame_ptr, frame_len) };
            self.enqueue_encoded_bytes(socket, frame)
        } else {
            self.ping_frame_bytes[2..6].fill(0); // autobahn tests require that we mask empty pongs
            let frame_ptr = self.ping_frame_bytes.as_ptr();
            // SAFETY: frame valid for this call
            let frame = unsafe { core::slice::from_raw_parts(frame_ptr, 6) };
            self.enqueue_encoded_bytes(socket, frame)
        }
    }

    fn send_close_with_body(
        &mut self,
        socket: Socket<SSL>,
        code: u16,
        body: Option<&mut [u8; 125]>,
        body_len: usize,
    ) {
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
                socket.shutdown_read();
            }
        }
        let mut final_body_bytes = [0u8; 128 + 8];
        let mut header = WebsocketHeader::from_bits(0u16);
        header.set_final(true);
        header.set_opcode(Opcode::Close);
        header.set_mask(true);
        header.set_len(((body_len + 2) & 0x7F) as u8); // @truncate to u7
        let header_slice = header.slice();
        final_body_bytes[0] = header_slice[0];
        final_body_bytes[1] = header_slice[1];
        // mask_buf at [2..6]
        final_body_bytes[6..8].copy_from_slice(&code.to_be_bytes());

        let mut reason = bun_str::String::empty();
        if let Some(data) = body {
            if body_len > 0 {
                let body_slice = &data[..body_len];
                // close is always utf8
                if !strings::is_valid_utf8(body_slice) {
                    self.terminate(ErrorCode::InvalidUtf8);
                    return;
                }
                reason = bun_str::String::clone_utf8(body_slice);
                final_body_bytes[8..][..body_len].copy_from_slice(body_slice);
            }
        }

        // we must mask the code
        let slice_len = 8 + body_len;
        {
            let (head, tail) = final_body_bytes.split_at_mut(6);
            let mask_buf: &mut [u8; 4] = (&mut head[2..6]).try_into().unwrap();
            let payload = &mut tail[..slice_len - 6];
            Mask::fill_in_place(self.global_this, mask_buf, payload);
        }
        let slice = &final_body_bytes[..slice_len];

        if self.enqueue_encoded_bytes(socket, slice) {
            self.clear_data();
            self.dispatch_close(code, &mut reason);
        }
    }

    pub fn is_same_socket(&self, socket: Socket<SSL>) -> bool {
        socket.socket.eq(&self.tcp.socket)
    }

    pub fn handle_end(&mut self, socket: Socket<SSL>) {
        debug_assert!(self.is_same_socket(socket));
        self.terminate(ErrorCode::Ended);
    }

    pub fn handle_writable(&mut self, socket: Socket<SSL>) {
        if self.close_received {
            return;
        }
        debug_assert!(self.is_same_socket(socket));
        let send_buf_ptr = self.send_buffer.readable_slice(0).as_ptr();
        let send_buf_len = self.send_buffer.readable_slice(0).len();
        if send_buf_len == 0 {
            return;
        }
        // SAFETY: slice valid for this call
        let send_buf = unsafe { core::slice::from_raw_parts(send_buf_ptr, send_buf_len) };
        let _ = self.send_buffer_out(send_buf);
    }

    pub fn handle_timeout(&mut self, _socket: Socket<SSL>) {
        self.terminate(ErrorCode::Timeout);
    }

    pub fn handle_connect_error(&mut self, _socket: Socket<SSL>, _errno: c_int) {
        self.tcp.detach();
        self.terminate(ErrorCode::FailedToConnect);
    }

    pub fn has_backpressure(&self) -> bool {
        if self.send_buffer.count > 0 {
            return true;
        }
        if let Some(tunnel) = &self.proxy_tunnel {
            return tunnel.has_backpressure();
        }
        false
    }

    pub extern "C" fn write_binary_data(this: *mut Self, ptr: *const u8, len: usize, op: u8) {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &mut *this };
        // In tunnel mode, SSLWrapper.writeData() can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before the catch block in enqueue_encoded_bytes/send_buffer runs.
        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());
        // TODO(port): scopeguard borrowck — see handle_data note

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        // SAFETY: op <= 0xF checked above; Opcode is #[repr(u4)]-equivalent
        let opcode: Opcode = unsafe { core::mem::transmute::<u8, Opcode>(op) };
        // SAFETY: ptr/len from C++; caller guarantees valid slice
        let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
        let bytes = Copy::Bytes(slice);
        // fast path: small frame, no backpressure, attempt to send without allocating
        let frame_size = WebsocketHeader::frame_size_including_mask(len);
        if !this.has_backpressure() && frame_size < STACK_FRAME_SIZE {
            let mut inline_buf = [0u8; STACK_FRAME_SIZE];
            bytes.copy(this.global_this, &mut inline_buf[..frame_size], slice.len(), opcode);
            let _ = this.enqueue_encoded_bytes(this.tcp, &inline_buf[..frame_size]);
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

    pub extern "C" fn write_blob(this: *mut Self, blob_value: JSValue, op: u8) {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &mut *this };
        // See write_binary_data() — tunnel.write() can re-enter fail().
        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());
        // TODO(port): scopeguard borrowck

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

        // SAFETY: op <= 0xF checked above
        let opcode: Opcode = unsafe { core::mem::transmute::<u8, Opcode>(op) };

        // Cast the JSValue to a Blob
        if let Some(blob) = blob_value.as_::<bun_jsc::fetch_headers::FetchHeaders::Blob>() {
            // Get the shared view of the blob data
            let data = blob.shared_view();
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
                bytes.copy(this.global_this, &mut inline_buf[..frame_size], data.len(), opcode);
                let _ = this.enqueue_encoded_bytes(this.tcp, &inline_buf[..frame_size]);
                return;
            }

            let _ = this.send_data(bytes, !this.has_backpressure(), opcode);
        } else {
            // Invalid blob, close connection
            this.dispatch_abrupt_close(ErrorCode::Ended);
        }
    }

    pub extern "C" fn write_string(this: *mut Self, str_: *const ZigString, op: u8) {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &mut *this };
        // See write_binary_data() — tunnel.write() can re-enter fail().
        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());
        // TODO(port): scopeguard borrowck

        // SAFETY: str_ is a valid pointer from C++
        let str = unsafe { &*str_ };
        if !this.has_tcp() {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }
        let tcp = this.tcp;

        // Note: 0 is valid

        // SAFETY: u4 truncate of op fits in Opcode repr
        let opcode: Opcode = unsafe { core::mem::transmute::<u8, Opcode>(op & 0x0F) };
        {
            let mut inline_buf = [0u8; STACK_FRAME_SIZE];

            // fast path: small frame, no backpressure, attempt to send without allocating
            if !str.is_16bit() && str.len < STACK_FRAME_SIZE {
                let bytes = Copy::Latin1(str.slice());
                let mut byte_len: usize = 0;
                let frame_size = bytes.len(&mut byte_len);
                if !this.has_backpressure() && frame_size < STACK_FRAME_SIZE {
                    bytes.copy(this.global_this, &mut inline_buf[..frame_size], byte_len, opcode);
                    let _ = this.enqueue_encoded_bytes(tcp, &inline_buf[..frame_size]);
                    return;
                }
                // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
            } else if (str.len * 4) < STACK_FRAME_SIZE && !this.has_backpressure() {
                let bytes = Copy::Utf16(str.utf16_slice_aligned());
                let mut byte_len: usize = 0;
                let frame_size = bytes.len(&mut byte_len);
                debug_assert!(frame_size <= STACK_FRAME_SIZE);
                bytes.copy(this.global_this, &mut inline_buf[..frame_size], byte_len, opcode);
                let _ = this.enqueue_encoded_bytes(tcp, &inline_buf[..frame_size]);
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
        self.poll_ref.unref(self.global_this.bun_vm());
        jsc::mark_binding!();
        // SAFETY: out is a valid CppWebSocket*
        unsafe { out.as_ref().did_abrupt_close(code) };
        self.deref();
    }

    fn dispatch_close(&mut self, code: u16, reason: &mut bun_str::String) {
        let Some(out) = self.outgoing_websocket.take() else {
            return;
        };
        self.poll_ref.unref(self.global_this.bun_vm());
        jsc::mark_binding!();
        // SAFETY: out is a valid CppWebSocket*
        unsafe { out.as_ref().did_close(code, reason) };
        self.deref();
    }

    pub extern "C" fn close(this: *mut Self, code: u16, reason: *const ZigString) {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &mut *this };
        // In tunnel mode, SSLWrapper.writeData() (via send_close_with_body →
        // enqueue_encoded_bytes → tunnel.write) can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before send_close_with_body's own clear_data/dispatch_close run.
        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());
        // TODO(port): scopeguard borrowck

        if !this.has_tcp() {
            return;
        }
        let tcp = this.tcp;
        let mut close_reason_buf = [0u8; 128];
        // SAFETY: reason is null or a valid *const ZigString from C++
        if let Some(str) = unsafe { reason.as_ref() } {
            'inner: {
                // Zig: FixedBufferAllocator + allocPrint → write into fixed buf
                use std::io::Write;
                let mut cursor = std::io::Cursor::new(&mut close_reason_buf[..]);
                if write!(cursor, "{}", str).is_err() {
                    break 'inner;
                }
                let wrote_len = cursor.position() as usize;
                // SAFETY: close_reason_buf has 128 bytes; reinterpret first 125 as fixed array
                let buf_ptr = close_reason_buf.as_mut_ptr() as *mut [u8; 125];
                this.send_close_with_body(tcp, code, Some(unsafe { &mut *buf_ptr }), wrote_len);
                return;
            }
        }

        this.send_close_with_body(tcp, code, None, 0);
    }

    pub extern "C" fn init(
        outgoing: *mut CppWebSocket,
        input_socket: *mut c_void,
        global_this: &'static JSGlobalObject,
        buffered_data: *mut u8,
        buffered_data_len: usize,
        deflate_params: Option<&websocket_deflate::Params>,
        secure_ptr: *mut c_void,
    ) -> *mut c_void {
        let tcp = input_socket as *mut us_socket_t;
        let vm = global_this.bun_vm();
        let ws = Box::into_raw(Box::new(WebSocket::<SSL> {
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
            receive_buffer: LinearFifo::new(),
            send_buffer: LinearFifo::new(),
            global_this,
            poll_ref: KeepAlive::init(),
            header_fragment: None,
            payload_length_frame_bytes: [0u8; 8],
            payload_length_frame_len: 0,
            initial_data_handler: None,
            event_loop: vm.event_loop(),
            deflate: None,
            receiving_compressed: false,
            message_is_compressed: false,
            secure: if secure_ptr.is_null() {
                None
            } else {
                Some(secure_ptr as *mut SslCtx)
            },
            proxy_tunnel: None,
        }));
        // SAFETY: ws was just allocated via Box::into_raw
        let ws_ref = unsafe { &mut *ws };

        if let Some(params) = deflate_params {
            match WebSocketDeflate::init(*params, vm.rare_data()) {
                Ok(deflate) => ws_ref.deflate = Some(deflate),
                Err(_) => ws_ref.deflate = None,
            }
        }

        if !Socket::<SSL>::adopt_group(
            tcp,
            vm.rare_data().ws_client_group(vm, SSL),
            if SSL { uws::DispatchKind::WsClientTls } else { uws::DispatchKind::WsClient },
            // TODO(port): Zig passes (WebSocket, "tcp", ws) for @fieldParentPtr-style adoption.
            // Phase B: bun_uws::adopt_group needs offset_of!(WebSocket<SSL>, tcp) + ws ptr.
            ws_ref,
        ) {
            ws_ref.deref();
            return core::ptr::null_mut();
        }

        ws_ref.send_buffer.ensure_total_capacity(2048);
        ws_ref.receive_buffer.ensure_total_capacity(2048);
        ws_ref.poll_ref.r#ref(global_this.bun_vm());

        // SAFETY: buffered_data/len from C++; caller guarantees validity
        let buffered_slice: &mut [u8] =
            unsafe { core::slice::from_raw_parts_mut(buffered_data, buffered_data_len) };
        if !buffered_slice.is_empty() {
            let initial_data = Box::into_raw(Box::new(InitialDataHandler::<SSL> {
                adopted: NonNull::new(ws),
                slice: Box::from(&*buffered_slice),
                // TODO(port): Zig hands ownership of `buffered_slice` (allocator-owned) to
                // InitialDataHandler which frees it. Here we copy; Phase B should take ownership
                // without copy if the C++ side allocated with mimalloc.
                ws: outgoing,
            }));

            // Use a higher-priority callback for the initial onData handler
            global_this.queue_microtask_callback(initial_data, InitialDataHandler::<SSL>::handle);

            // We need to ref the outgoing websocket so that it doesn't get finalized
            // before the initial data handler is called
            // SAFETY: outgoing is a valid CppWebSocket*
            unsafe { (*outgoing).r#ref() };
        }

        // And lastly, ref the new websocket since C++ has a reference to it
        ws_ref.r#ref();

        ws as *mut c_void
    }

    /// Initialize a WebSocket client that uses a proxy tunnel for I/O.
    /// Used for wss:// through HTTP proxy where TLS is handled by the tunnel.
    /// The tunnel takes ownership of socket I/O, and this client reads/writes through it.
    pub extern "C" fn init_with_tunnel(
        outgoing: *mut CppWebSocket,
        tunnel_ptr: *mut c_void,
        global_this: &'static JSGlobalObject,
        buffered_data: *mut u8,
        buffered_data_len: usize,
        deflate_params: Option<&websocket_deflate::Params>,
    ) -> *mut c_void {
        // SAFETY: tunnel_ptr is a valid *WebSocketProxyTunnel from C++ with an
        // intrusive refcount. The caller retains its own ref; we bump to take
        // ownership (Zig: tunnel.ref()).
        // TODO(port): LIFETIMES.tsv row for proxy_tunnel says Arc — update to
        // IntrusiveArc in Phase B (pointer crosses FFI; Arc header is wrong).
        let tunnel_owned: IntrusiveArc<WebSocketProxyTunnel> = unsafe {
            IntrusiveArc::from_raw(tunnel_ptr as *mut WebSocketProxyTunnel).retained()
        };

        // ref_count starts at 1: this is the I/O-layer ref, owned by the
        // tunnel connection (analogous to the adopted-socket ref in init()
        // that handle_close() releases). It is released in clear_data() when
        // proxy_tunnel is detached. The ws.ref() below adds the C++ ref
        // paired with m_connectedWebSocket.
        let vm = global_this.bun_vm();
        let ws = Box::into_raw(Box::new(WebSocket::<SSL> {
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
            receive_buffer: LinearFifo::new(),
            send_buffer: LinearFifo::new(),
            global_this,
            poll_ref: KeepAlive::init(),
            header_fragment: None,
            payload_length_frame_bytes: [0u8; 8],
            payload_length_frame_len: 0,
            initial_data_handler: None,
            event_loop: vm.event_loop(),
            deflate: None,
            receiving_compressed: false,
            message_is_compressed: false,
            secure: None,
            proxy_tunnel: Some(tunnel_owned),
        }));
        // SAFETY: ws was just allocated via Box::into_raw
        let ws_ref = unsafe { &mut *ws };

        if let Some(params) = deflate_params {
            match WebSocketDeflate::init(*params, vm.rare_data()) {
                Ok(deflate) => ws_ref.deflate = Some(deflate),
                Err(_) => ws_ref.deflate = None,
            }
        }

        ws_ref.send_buffer.ensure_total_capacity(2048);
        ws_ref.receive_buffer.ensure_total_capacity(2048);
        ws_ref.poll_ref.r#ref(global_this.bun_vm());

        // SAFETY: buffered_data/len from C++; caller guarantees validity
        let buffered_slice: &mut [u8] =
            unsafe { core::slice::from_raw_parts_mut(buffered_data, buffered_data_len) };
        if !buffered_slice.is_empty() {
            let initial_data = Box::into_raw(Box::new(InitialDataHandler::<SSL> {
                adopted: NonNull::new(ws),
                slice: Box::from(&*buffered_slice),
                // TODO(port): see init() — ownership of buffered_slice
                ws: outgoing,
            }));
            global_this.queue_microtask_callback(initial_data, InitialDataHandler::<SSL>::handle);
            // SAFETY: outgoing is a valid CppWebSocket*
            unsafe { (*outgoing).r#ref() };
        }

        ws_ref.r#ref();

        ws as *mut c_void
    }

    /// Handle data received from the proxy tunnel (already decrypted).
    /// Called by the WebSocketProxyTunnel when it receives and decrypts data.
    pub fn handle_tunnel_data(&mut self, data: &[u8]) {
        // Process the decrypted data as if it came from the socket
        // has_tcp() now returns true for tunnel mode, so this will work correctly
        self.handle_data(self.tcp, data);
    }

    /// Called by the WebSocketProxyTunnel when the underlying socket drains.
    /// Flushes any buffered plaintext data through the tunnel.
    pub fn handle_tunnel_writable(&mut self) {
        if self.close_received {
            return;
        }
        // send_buffer → tunnel.write() can re-enter fail() synchronously
        // (see write_binary_data). The tunnel ref-guards itself in
        // on_writable() but not this struct.
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): scopeguard borrowck

        let send_buf_ptr = self.send_buffer.readable_slice(0).as_ptr();
        let send_buf_len = self.send_buffer.readable_slice(0).len();
        if send_buf_len == 0 {
            return;
        }
        // SAFETY: slice valid for this call
        let send_buf = unsafe { core::slice::from_raw_parts(send_buf_ptr, send_buf_len) };
        let _ = self.send_buffer_out(send_buf);
    }

    pub extern "C" fn finalize(this: *mut Self) {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &mut *this };
        log!("finalize");
        // clear_data() may drop the tunnel's I/O-layer ref and the block
        // below drops the C++ ref; keep `this` alive until we've finished
        // the tcp close check.
        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());
        // TODO(port): scopeguard borrowck

        this.clear_data();

        // This is only called by outgoing_websocket.
        if this.outgoing_websocket.is_some() {
            this.outgoing_websocket = None;
            this.deref();
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
    // self is heap-allocated via Box::into_raw and crosses FFI as *mut c_void.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: called once when ref_count hits zero
        let this_ref = unsafe { &mut *this };
        this_ref.clear_data();
        // deflate already dropped in clear_data; this is defensive parity with Zig
        this_ref.deflate = None;
        // SAFETY: this was allocated via Box::into_raw in init/init_with_tunnel
        drop(unsafe { Box::from_raw(this) });
    }

    pub extern "C" fn memory_cost(this: *const Self) -> usize {
        // SAFETY: called from C++ with a valid pointer
        let this = unsafe { &*this };
        let mut cost: usize = size_of::<Self>();
        cost += this.send_buffer.buf_len();
        cost += this.receive_buffer.buf_len();
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

macro_rules! export_websocket_client {
    ($ssl:expr, $prefix:literal) => {
        ::paste::paste! {
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __cancel>](this: *mut WebSocket<$ssl>) {
                WebSocket::<$ssl>::cancel(this)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __close>](
                this: *mut WebSocket<$ssl>, code: u16, reason: *const ZigString,
            ) {
                WebSocket::<$ssl>::close(this, code, reason)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __finalize>](this: *mut WebSocket<$ssl>) {
                WebSocket::<$ssl>::finalize(this)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __init>](
                outgoing: *mut CppWebSocket,
                input_socket: *mut c_void,
                global_this: &'static JSGlobalObject,
                buffered_data: *mut u8,
                buffered_data_len: usize,
                deflate_params: Option<&websocket_deflate::Params>,
                secure_ptr: *mut c_void,
            ) -> *mut c_void {
                WebSocket::<$ssl>::init(
                    outgoing, input_socket, global_this, buffered_data,
                    buffered_data_len, deflate_params, secure_ptr,
                )
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __initWithTunnel>](
                outgoing: *mut CppWebSocket,
                tunnel_ptr: *mut c_void,
                global_this: &'static JSGlobalObject,
                buffered_data: *mut u8,
                buffered_data_len: usize,
                deflate_params: Option<&websocket_deflate::Params>,
            ) -> *mut c_void {
                WebSocket::<$ssl>::init_with_tunnel(
                    outgoing, tunnel_ptr, global_this, buffered_data,
                    buffered_data_len, deflate_params,
                )
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __memoryCost>](this: *const WebSocket<$ssl>) -> usize {
                WebSocket::<$ssl>::memory_cost(this)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __writeBinaryData>](
                this: *mut WebSocket<$ssl>, ptr: *const u8, len: usize, op: u8,
            ) {
                WebSocket::<$ssl>::write_binary_data(this, ptr, len, op)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __writeBlob>](
                this: *mut WebSocket<$ssl>, blob_value: JSValue, op: u8,
            ) {
                WebSocket::<$ssl>::write_blob(this, blob_value, op)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn [<Bun__ $prefix __writeString>](
                this: *mut WebSocket<$ssl>, str_: *const ZigString, op: u8,
            ) {
                WebSocket::<$ssl>::write_string(this, str_, op)
            }
        }
    };
}

export_websocket_client!(false, "WebSocketClient");
export_websocket_client!(true, "WebSocketClientTLS");

// ──────────────────────────────────────────────────────────────────────────
// InitialDataHandler
// ──────────────────────────────────────────────────────────────────────────

pub struct InitialDataHandler<const SSL: bool> {
    pub adopted: Option<NonNull<WebSocket<SSL>>>,
    pub ws: *mut CppWebSocket,
    pub slice: Box<[u8]>,
}

impl<const SSL: bool> InitialDataHandler<SSL> {
    // pub const Handle = jsc.AnyTask.New(@This(), handle);
    // TODO(port): jsc::AnyTask::new wrapper — Phase B wires queue_microtask_callback signature.

    pub fn handle_without_deinit(&mut self) {
        let Some(this_socket_ptr) = self.adopted.take() else {
            return;
        };
        // SAFETY: adopted points to a live WebSocket (backref, no ref taken)
        let this_socket = unsafe { &mut *this_socket_ptr.as_ptr() };
        this_socket.initial_data_handler = None;
        let ws = self.ws;
        // defer ws.unref() → scopeguard
        let _guard = scopeguard::guard((), |_| {
            // SAFETY: ws is a valid CppWebSocket* (ref taken in init())
            unsafe { (*ws).unref() };
        });

        // For tunnel mode, tcp is detached but connection is still active through the tunnel
        let is_connected = !this_socket.tcp.is_closed() || this_socket.proxy_tunnel.is_some();
        if this_socket.outgoing_websocket.is_some() && is_connected {
            this_socket.handle_data(this_socket.tcp, &self.slice);
        }
    }

    pub fn handle(this: *mut Self) {
        // SAFETY: called from microtask queue with valid pointer
        let this_ref = unsafe { &mut *this };
        this_ref.handle_without_deinit();
        // deinit: free slice + destroy self
        // SAFETY: allocated via Box::into_raw in init()/init_with_tunnel()
        drop(unsafe { Box::from_raw(this) });
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
        let entropy = global_this.bun_vm().rare_data().entropy_slice(4);
        mask_buf.copy_from_slice(&entropy[..4]);
        let mask = *mask_buf;

        let skip_mask = u32::from_ne_bytes(mask) == 0;
        Self::fill_with_skip_mask(mask, output, input, skip_mask);
    }

    /// In-place variant for when output and input alias the same buffer.
    /// PORT NOTE: Zig's `fill` allowed output==input; Rust borrowck forbids
    /// `&mut [u8]` + `&[u8]` aliasing. Callers that masked in-place use this.
    pub fn fill_in_place(global_this: &JSGlobalObject, mask_buf: &mut [u8; 4], buf: &mut [u8]) {
        let entropy = global_this.bun_vm().rare_data().entropy_slice(4);
        mask_buf.copy_from_slice(&entropy[..4]);
        let mask = *mask_buf;

        let skip_mask = u32::from_ne_bytes(mask) == 0;
        if buf.is_empty() {
            #[cold]
            fn cold() {}
            cold();
            return;
        }
        // SAFETY: highway::fill_with_skip_mask supports in-place (output==input)
        unsafe {
            bun_highway::fill_with_skip_mask(
                mask,
                buf.as_mut_ptr(),
                buf.as_ptr(),
                buf.len(),
                skip_mask,
            )
        };
    }

    fn fill_with_skip_mask(mask: [u8; 4], output: &mut [u8], input: &[u8], skip_mask: bool) {
        if input.is_empty() {
            #[cold]
            fn cold() {}
            cold();
            return;
        }
        // SAFETY: output.len() >= input.len() per caller contract
        unsafe {
            bun_highway::fill_with_skip_mask(
                mask,
                output.as_mut_ptr(),
                input.as_ptr(),
                input.len(),
                skip_mask,
            )
        };
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

        let mut header = WebsocketHeader::from_bits(0u16);

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

        // PORT NOTE: split buf so mask_buf and to_mask are disjoint borrows
        let (head, to_mask_full) = buf.split_at_mut(content_offset);
        let mask_buf: &mut [u8; 4] =
            (&mut head[mask_offset..mask_offset + 4]).try_into().unwrap();
        let to_mask = &mut to_mask_full[..content_byte_len];

        match self {
            Copy::Utf16(utf16) => {
                header.set_len(WebsocketHeader::pack_length(content_byte_len));
                let encode_into_result = strings::copy_utf16_into_utf8_impl(to_mask, utf16, true);
                debug_assert_eq!(encode_into_result.written as usize, content_byte_len);
                debug_assert_eq!(encode_into_result.read as usize, utf16.len());
                header.set_len(WebsocketHeader::pack_length(encode_into_result.written as usize));
                // TODO(port): Zig used std.io.fixedBufferStream + header.writeHeader.
                // WebsocketHeader::write_header should write into &mut head[..2+len_int].
                header
                    .write_header(&mut &mut head[..], encode_into_result.written as usize)
                    .expect("unreachable");

                Mask::fill_in_place(global_this, mask_buf, to_mask);
            }
            Copy::Latin1(latin1) => {
                let encode_into_result = strings::copy_latin1_into_utf8(to_mask, latin1);
                debug_assert_eq!(encode_into_result.written as usize, content_byte_len);

                // latin1 can contain non-ascii
                debug_assert_eq!(encode_into_result.read as usize, latin1.len());

                header.set_len(WebsocketHeader::pack_length(encode_into_result.written as usize));
                header
                    .write_header(&mut &mut head[..], encode_into_result.written as usize)
                    .expect("unreachable");
                Mask::fill_in_place(global_this, mask_buf, to_mask);
            }
            Copy::Bytes(bytes) => {
                header.set_len(WebsocketHeader::pack_length(bytes.len()));
                header
                    .write_header(&mut &mut head[..], bytes.len())
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

        let mut header = WebsocketHeader::from_bits(0u16);

        header.set_mask(true);
        header.set_compressed(is_first_fragment); // Only set compressed flag for first fragment
        header.set_final(true);
        header.set_opcode(opcode);
        header.set_len(WebsocketHeader::pack_length(content_byte_len));

        debug_assert_eq!(
            WebsocketHeader::frame_size_including_mask(content_byte_len),
            buf.len()
        );

        let (head, to_mask_full) = buf.split_at_mut(content_offset);
        let mask_buf: &mut [u8; 4] =
            (&mut head[mask_offset..mask_offset + 4]).try_into().unwrap();
        let to_mask = &mut to_mask_full[..content_byte_len];

        header
            .write_header(&mut &mut head[..], content_byte_len)
            .expect("unreachable");

        Mask::fill(global_this, mask_buf, to_mask, compressed_data);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/websocket_client.zig (1792 lines)
//   confidence: medium
//   todos:      20
//   notes:      Heavy borrowck reshaping (raw-ptr re-slicing of self buffers — Phase B should add a split-borrow helper on LinearFifo); proxy_tunnel now IntrusiveArc (update LIFETIMES.tsv); scopeguard ref/deref guards conflict with &mut self; @export macro uses paste!.
// ──────────────────────────────────────────────────────────────────────────
