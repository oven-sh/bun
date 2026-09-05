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

use bun_boringssl as boringssl;
use bun_boringssl::c::OwnedSslCtx;
use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::{EncodedSlice, strings};
use bun_http::websocket::{Opcode, WebsocketHeader};
use bun_io::KeepAlive;
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject};
use bun_ptr::{BackRef, JsCell, RefPtr, Root, ThisPtr};
use bun_uws::{self as uws, NewSocketHandler, us_bun_verify_error_t};
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

#[derive(bun_ptr::CellRefCounted)]
pub struct WebSocket<const SSL: bool> {
    pub(crate) ref_count: Cell<u32>,

    pub(crate) tcp: Cell<Socket<SSL>>,
    /// The I/O layer's ref (the adopted socket's userdata, or the tunnel
    /// connection in proxy mode); released in `handle_close` / `clear_data`.
    io_ref: Cell<Option<RefPtr<Self>>>,
    /// C++ `WebSocket::m_connectedWebSocket` and the ref held on its behalf;
    /// released together when C++ lets go.
    pub(crate) outgoing_websocket: JsCell<Option<(BackRef<CppWebSocket>, RefPtr<Self>)>>,

    pub(crate) receive_state: Cell<ReceiveState>,
    pub(crate) receiving_type: Cell<Opcode>,
    // we need to start with final so we validate the first frame
    pub(crate) receiving_is_final: Cell<bool>,

    /// Staging area for outgoing control frames and incoming control payloads.
    pub(crate) ping_frame_bytes: Cell<[u8; CONTROL_HEADER_SIZE + 128]>,
    pub(crate) ping_len: Cell<u8>,
    /// A Ping/Pong/Close payload is mid-accumulation in `ping_frame_bytes`.
    pub(crate) control_frame_started: Cell<bool>,
    pub(crate) close_received: Cell<bool>,
    /// `Some` once `send_close_with_body` has enqueued the close frame: blocks
    /// further outbound writes and drives `clear_data` + `dispatch_close` once
    /// the frame is fully flushed (or the socket dies).
    pub(crate) close_dispatch_pending: RefCell<Option<(u16, bun_core::String)>>,

    pub(crate) receive_body_remain: Cell<usize>,
    pub(crate) receive_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub(crate) send_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub(crate) global_this: GlobalRef,
    pub(crate) poll_ref: Cell<KeepAlive>,

    pub(crate) header_fragment: Cell<Option<u8>>,

    pub(crate) payload_length_frame_bytes: Cell<[u8; 8]>,
    pub(crate) payload_length_frame_len: Cell<u8>,

    /// The queued `InitialDataTask` (handshake-overflow bytes) until it runs or
    /// `handle_data` drains it first; detached in `Drop` so a task that
    /// outlives us does nothing.
    pending_initial_task: Cell<Option<BackRef<InitialDataTask<SSL>, Root>>>,
    pub(crate) deflate: RefCell<Option<Box<WebSocketDeflate>>>,

    /// Track if current message is compressed
    pub(crate) receiving_compressed: Cell<bool>,
    /// Track compression state of the entire message (across fragments)
    pub(crate) message_is_compressed: Cell<bool>,

    /// `us_ssl_ctx_t` inherited from the upgrade client when it was built
    /// with a custom CA. The socket's `SSL*` references the `SSL_CTX`
    /// inside, so this must outlive the connection. None when the upgrade
    /// used the shared default context.
    pub(crate) secure: Cell<Option<OwnedSslCtx>>,

    /// Proxy tunnel for wss:// through HTTP proxy.
    /// When set, all I/O goes through the tunnel (TLS encryption/decryption).
    /// The tunnel handles the TLS layer, so this is used with ssl=false.
    /// Holds one ref, released in `clear_data`.
    pub(crate) proxy_tunnel: JsCell<Option<RefPtr<WebSocketProxyTunnel>>>,
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
        global_this.bun_vm().loop_ctx()
    }

    fn tunnel(&self) -> Option<ThisPtr<WebSocketProxyTunnel>> {
        self.proxy_tunnel.get().as_ref().map(RefPtr::this_ptr)
    }

    /// C++'s back-reference, while it still holds one.
    fn cpp_websocket(&self) -> Option<BackRef<CppWebSocket>> {
        self.outgoing_websocket.get().as_ref().map(|(ws, _)| *ws)
    }

    /// C++ let go of `m_connectedWebSocket`: forget the back-reference and
    /// release the ref held on its behalf. May free `self`.
    fn release_cpp_ref(&self) {
        self.outgoing_websocket.set(None);
    }

    /// Release the I/O layer's ref. May free `self`.
    fn release_io_ref(&self) {
        self.io_ref.set(None);
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

    pub(crate) fn clear_data(&self) {
        log!("clearData");
        self.unref_keep_alive();
        self.clear_receive_buffers(true);
        self.clear_send_buffers(true);
        self.control_frame_started.set(false);
        self.ping_len.set(0);
        self.close_dispatch_pending.take();
        self.receiving_compressed.set(false);
        self.message_is_compressed.set(false);
        self.deflate.replace(None);
        drop(self.secure.take());
        // Detach the tunnel first so its shutdown callbacks cannot re-enter this path.
        if let Some(tunnel) = self.proxy_tunnel.replace(None) {
            tunnel.clear_connected_web_socket();
            WebSocketProxyTunnel::shutdown(tunnel.this_ptr());
            drop(tunnel);
            // Release the I/O-layer ref taken in init_with_tunnel() — the
            // tunnel was this struct's socket-equivalent owner. In the
            // non-tunnel path this same ref is released by handle_close()
            // when the adopted uSockets socket fires its close event, but
            // tunnel mode never adopts a socket so that callback never runs.
            // Callers that touch `self` after clear_data() must hold a local
            // ref guard (see cancel/finalize).
            self.release_io_ref();
        }
    }

    pub(crate) fn cancel(this: ThisPtr<Self>) {
        // clear_data() may drop the tunnel's I/O-layer ref; keep `this`
        // alive until we've finished closing the socket below.
        let _guard = RefPtr::from_this(this);
        this.cancel_guarded();
    }

    /// [`cancel`](Self::cancel) for callers that already hold a ref guard.
    fn cancel_guarded(&self) {
        log!("cancel");
        let this = self;
        let had_tunnel = this.tunnel().is_some();
        this.clear_data();

        // Failure still sends close_notify best-effort but never waits for the peer's reply.
        this.tcp.get().close(uws::CloseKind::Failure);

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

    /// Every caller holds a ref guard (the uws dispatcher, a C++ entry point,
    /// or the tunnel callback), so `self` outlives the releases below.
    pub(crate) fn fail(&self, code: ErrorCode) {
        jsc::mark_binding!();
        if let Some((ws, _cpp_ref)) = self.outgoing_websocket.replace(None) {
            log!("fail ({})", <&'static str>::from(code));
            ws.did_abrupt_close(code);
        }

        self.cancel_guarded();
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

        let Some(ws) = self.cpp_websocket() else {
            return;
        };
        if !ws.reject_unauthorized() {
            // We accept the connection regardless of SSL errors.
            return;
        }

        if ssl_error.error_no != 0 || !authorized {
            self.fail(ErrorCode::FailedToConnect);
            return;
        }

        // Fail closed: without the SSL handle or a name to check against we
        // cannot verify the peer.
        let Some(ssl) = socket.ssl_mut() else {
            self.fail(ErrorCode::FailedToConnect);
            return;
        };
        let hostname = ssl.servername().map(<[u8]>::to_vec).unwrap_or_default();
        if hostname.is_empty() || !boringssl::check_server_identity(ssl, &hostname) {
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
        if let Some((code, reason)) = self.close_dispatch_pending.take() {
            // The socket closed while our close frame was mid-flush; the peer
            // either got it or didn't, but JS should still see the
            // user-initiated code/reason (not an abrupt 1006).
            self.detach_tcp();
            self.clear_data();
            self.dispatch_close(code, reason);
            // For the socket.
            self.release_io_ref();
            return;
        }
        self.clear_data();
        self.detach_tcp();

        self.dispatch_abrupt_close(ErrorCode::Ended);

        // For the socket.
        self.release_io_ref();
    }

    pub(crate) fn terminate(&self, code: ErrorCode) {
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
        let rare = self.global_this.bun_vm().as_mut().rare_data();
        let mut decompressed = rare.take_websocket_inflate_scratch();
        let result = match self.deflate.borrow_mut().as_mut() {
            None => Err(ErrorCode::CompressionUnsupported),
            Some(deflate) => deflate
                .decompress(rare.libdeflate_decompressor(), data, &mut decompressed)
                .map_err(|err| match err {
                    websocket_deflate::Error::InflateFailed => ErrorCode::InvalidCompressedData,
                    websocket_deflate::Error::TooLarge => ErrorCode::MessageTooBig,
                    websocket_deflate::Error::OutOfMemory => ErrorCode::FailedToAllocateMemory,
                }),
        };

        // The deflate borrow is released: both arms can re-enter `clear_data`.
        match result {
            Ok(()) => self.dispatch_data(&decompressed, kind),
            Err(code) => self.terminate(code),
        }

        // Both arms run JS, so reach for `RareData` again instead of holding `rare` across them.
        self.global_this
            .bun_vm()
            .as_mut()
            .rare_data()
            .put_back_websocket_inflate_scratch(decompressed);
    }

    /// Data will be cloned in C++.
    fn dispatch_data(&self, data: &[u8], kind: Opcode) {
        let Some(out) = self.cpp_websocket() else {
            self.clear_data();
            return;
        };

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
                let outstring;
                if let Some(utf16) = utf16_bytes {
                    // Ownership of the UTF-16 buffer transfers to C++: with
                    // `clone=false` and the global tag set, `Zig::toString`
                    // adopts the allocation into a `WTF::ExternalStringImpl`
                    // which `mi_free`s it later. Dropping the Vec here would
                    // be a UAF + double-free, so `utf16` must never be freed
                    // locally.
                    let utf16 = core::mem::ManuallyDrop::new(utf16);
                    outstring = EncodedSlice::utf16_global(&utf16);
                    jsc::mark_binding!();
                    out.did_receive_text(false, &outstring);
                } else {
                    outstring = EncodedSlice::latin1(data);
                    jsc::mark_binding!();
                    out.did_receive_text(true, &outstring);
                }
            }
            Opcode::Binary | Opcode::Ping | Opcode::Pong => {
                jsc::mark_binding!();
                out.did_receive_bytes(data, kind as u8);
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

    pub(crate) fn consume(
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

        bun_core::handle_oom(self.buffer_payload(data));
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
        if !data.is_empty() {
            bun_core::handle_oom(self.buffer_payload(data));
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
        let _guard = RefPtr::from_this(this);

        // Due to scheduling, it is possible for the websocket onData
        // handler to run with additional data before the microtask queue is
        // drained.
        if let Some(task) = this.pending_initial_task.take() {
            // Deliver the buffered bytes now (this calls `handle_data`); the
            // queued `InitialDataTask` is detached and will do nothing.
            task.ws.set(None);
            if let Some(initial_data) = task.data.replace(None) {
                initial_data.deliver(this);
            }

            // If we disconnected for any reason in the re-entrant case, we should just ignore the data
            if this.cpp_websocket().is_none() || !this.has_tcp() {
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
            self.send_close_with_body(echo_code, Some(dispatch_code), &payload[2..payload_len]);
        } else {
            self.send_close();
        }
        Step::Terminated
    }

    pub(crate) fn send_close(&self) {
        // Received a bodyless Close: echo a normal-closure frame on the wire,
        // but report 1005 ("no status received") to JS per RFC 6455 §7.1.5.
        self.send_close_with_body(1000, Some(1005), &[]);
    }

    fn enqueue_encoded_bytes(&self, bytes: &[u8]) -> bool {
        // For tunnel mode, write through the tunnel instead of direct socket
        if let Some(tunnel) = self.tunnel() {
            let wrote = match WebSocketProxyTunnel::write(tunnel, bytes) {
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

        // Small messages aren't worth the deflate overhead (or the transcode below).
        let (_, content_byte_len) = bytes.frame_and_content_len();
        if !self.should_compress(content_byte_len, opcode) {
            return self.send_data_uncompressed(bytes, do_write, opcode);
        }

        // The compressor consumes UTF-8/raw bytes, so transcode first.
        let utf8_storage: Vec<u8>;
        let content_to_compress: &[u8] = match bytes {
            Copy::Utf16(utf16) => {
                utf8_storage = strings::to_utf8_alloc(utf16);
                &utf8_storage
            }
            Copy::Latin1(latin1) => {
                if content_byte_len == latin1.len() {
                    // It's all ascii, we don't need to copy it an extra time.
                    latin1
                } else {
                    utf8_storage = bun_core::handle_oom(strings::allocate_latin1_into_utf8(latin1));
                    debug_assert_eq!(utf8_storage.len(), content_byte_len);
                    &utf8_storage
                }
            }
            Copy::Bytes(b) => b,
            Copy::Raw(_) => unreachable!(),
        };

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
            let writable = bun_core::handle_oom(send_buffer.writable_with_size(frame_size));
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
            let writable = bun_core::handle_oom(send_buffer.writable_with_size(write_len));
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
        if self.tunnel().is_none() {
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
            if let Some(tunnel) = self.tunnel() {
                // In tunnel mode, route through the tunnel's TLS layer
                // instead of the detached raw socket.
                match WebSocketProxyTunnel::write(tunnel, out_buf) {
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

    /// `code` is the status code written to the wire frame. `dispatch_code`
    /// overrides the code reported to JS (`CloseEvent.code`) when it differs
    /// from the wire code — e.g. a received bodyless Close echoes 1000 but
    /// reports 1005; when `None`, JS sees `code`.
    fn send_close_with_body(&self, code: u16, dispatch_code: Option<u16>, body: &[u8]) {
        let body_len = body.len().min(MAX_CLOSE_REASON);
        log!("Sending close with code {}", code);
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
        let header = WebsocketHeader::new(((body_len + 2) & 0x7F) as u8, true, Opcode::Close);
        frame[..2].copy_from_slice(&header.slice());
        // the 4-byte masking key lives at frame[2..6]
        frame[CONTROL_HEADER_SIZE..][..2].copy_from_slice(&code.to_be_bytes());

        let mut reason = bun_core::String::EMPTY;
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
        let frame_len = CONTROL_HEADER_SIZE + 2 + body_len;
        {
            let (head, payload) = frame.split_at_mut(CONTROL_HEADER_SIZE);
            let mask_buf: &mut [u8; 4] = (&mut head[2..CONTROL_HEADER_SIZE])
                .try_into()
                .expect("infallible: size matches");
            Mask::fill_in_place(&self.global_this, mask_buf, &mut payload[..2 + body_len]);
        }

        if self.enqueue_encoded_bytes(&frame[..frame_len]) {
            let dispatch_code = dispatch_code.unwrap_or(code);
            if self.send_buffer.borrow().readable_length() == 0 {
                self.shutdown_after_close_frame();
                self.clear_data();
                self.dispatch_close(dispatch_code, reason);
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
        if !SSL && self.tunnel().is_none() {
            self.tcp.get().shutdown_read();
            self.tcp.get().shutdown();
        }
    }

    fn finish_pending_close(&self) {
        if let Some((code, reason)) = self.close_dispatch_pending.take() {
            self.shutdown_after_close_frame();
            self.clear_data();
            self.dispatch_close(code, reason);
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

    pub(crate) fn is_same_socket(&self, socket: &Socket<SSL>) -> bool {
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

    pub(crate) fn has_backpressure(&self) -> bool {
        if self.send_buffer.borrow().readable_length() > 0 {
            return true;
        }
        self.tunnel().is_some_and(|t| t.has_backpressure())
    }

    pub(crate) fn buffered_amount(&self) -> usize {
        self.send_buffer.borrow().readable_length()
            + self.tunnel().map_or(0, |t| t.buffered_amount())
    }

    pub(crate) fn pause(&self) -> bool {
        if let Some(tunnel) = self.tunnel() {
            return tunnel.pause_stream();
        }
        self.tcp.get().pause_stream()
    }

    pub(crate) fn resume(&self) -> bool {
        if let Some(tunnel) = self.tunnel() {
            return tunnel.resume_stream();
        }
        self.tcp.get().resume_stream()
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

    pub(crate) fn write_binary_data(this: ThisPtr<Self>, slice: &[u8], op: u8) {
        // In tunnel mode, SSLWrapper.writeData() can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before the catch block in enqueue_encoded_bytes/send_buffer runs.
        let _guard = RefPtr::from_this(this);

        if !this.has_tcp() || op > 0xF {
            this.dispatch_abrupt_close(ErrorCode::Ended);
            return;
        }

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
        if self.tunnel().is_some() {
            return true;
        }
        let tcp = self.tcp.get();
        !tcp.is_closed() && !tcp.is_shutdown()
    }

    pub(crate) fn write_string(this: ThisPtr<Self>, str: &EncodedSlice, op: u8) {
        // See write_binary_data() — tunnel.write() can re-enter fail().
        let _guard = RefPtr::from_this(this);

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
            let bytes = Copy::Utf16(str.utf16_slice());
            let (frame_size, byte_len) = bytes.frame_and_content_len();
            this.send_inline_frame(bytes, byte_len, frame_size, opcode);
            return;
        }

        let _ = this.send_data(
            if str.is_16bit() {
                Copy::Utf16(str.utf16_slice())
            } else {
                Copy::Latin1(str.slice())
            },
            !this.has_backpressure(),
            opcode,
        );
    }

    /// May free `self`.
    fn dispatch_abrupt_close(&self, code: ErrorCode) {
        let Some((out, _cpp_ref)) = self.outgoing_websocket.replace(None) else {
            return;
        };
        self.unref_keep_alive();
        jsc::mark_binding!();
        out.did_abrupt_close(code);
    }

    /// May free `self`.
    fn dispatch_close(&self, code: u16, reason: bun_core::String) {
        let Some((out, _cpp_ref)) = self.outgoing_websocket.replace(None) else {
            return;
        };
        self.unref_keep_alive();
        jsc::mark_binding!();
        out.did_close(code, reason);
    }

    pub(crate) fn close(this: ThisPtr<Self>, code: u16, reason: Option<&EncodedSlice>) {
        // In tunnel mode, SSLWrapper.writeData() (via send_close_with_body →
        // enqueue_encoded_bytes → tunnel.write) can synchronously fire
        // onClose → ws.fail() → cancel() → clear_data() and free `this`
        // before send_close_with_body's own clear_data/dispatch_close run.
        let _guard = RefPtr::from_this(this);

        if !this.has_tcp() {
            return;
        }
        let mut reason_buf = [0u8; MAX_CONTROL_PAYLOAD];
        let reason_len = reason
            .and_then(|str| encode_close_reason(str, &mut reason_buf))
            .unwrap_or(0);

        this.send_close_with_body(code, None, &reason_buf[..reason_len]);
    }

    /// Allocate a client with `ref_count == 1` (the I/O-layer ref, released by
    /// `handle_close` for adopted sockets and by `clear_data` in tunnel mode)
    /// and an optional permessage-deflate context.
    fn new_raw(
        global_this: &JSGlobalObject,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        proxy_tunnel: Option<RefPtr<WebSocketProxyTunnel>>,
    ) -> RefPtr<Self> {
        let ws = RefPtr::new(WebSocket::<SSL> {
            ref_count: Cell::new(1),
            tcp: Cell::new(Socket::<SSL>::detached()),
            io_ref: Cell::new(None),
            outgoing_websocket: JsCell::new(None),
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
            pending_initial_task: Cell::new(None),
            deflate: RefCell::new(
                deflate_params.and_then(|params| WebSocketDeflate::init(*params).ok()),
            ),
            receiving_compressed: Cell::new(false),
            message_is_compressed: Cell::new(false),
            secure: Cell::new(secure),
            proxy_tunnel: JsCell::new(proxy_tunnel),
        });
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::ALLOC_TYPE_NAME, ws.as_ptr());
        ws
    }

    /// Shared tail of `init`/`init_with_tunnel`: record the I/O-layer ref,
    /// reserve the I/O buffers, take the keep-alive ref, queue any
    /// handshake-buffered bytes, and take the C++-side ref. Returns the
    /// pointer handed back to C++.
    fn finish_init(
        io_ref: RefPtr<Self>,
        outgoing: &CppWebSocket,
        global_this: &JSGlobalObject,
        buffered_data: Option<Box<InitialData>>,
    ) -> *mut Self {
        let ws = io_ref.this_ptr();
        // C++ holds the returned pointer as `m_connectedWebSocket`.
        ws.outgoing_websocket
            .set(Some((BackRef::new(outgoing), io_ref.clone())));
        ws.io_ref.set(Some(io_ref));
        bun_core::handle_oom(ws.send_buffer.borrow_mut().ensure_total_capacity(2048));
        bun_core::handle_oom(ws.receive_buffer.borrow_mut().ensure_total_capacity(2048));
        {
            let mut poll_ref = ws.poll_ref.take();
            poll_ref.r#ref(Self::vm_loop_ctx(global_this));
            ws.poll_ref.set(poll_ref);
        }

        if let Some(buffered_data) = buffered_data.filter(|b| !b.0.is_empty()) {
            // Use a higher-priority callback for the initial onData handler.
            let task = Box::new(InitialDataTask {
                ws: Cell::new(Some(BackRef::from(ws))),
                data: JsCell::new(Some(InitialDataHandler {
                    slice: buffered_data.0,
                    // We need to ref the outgoing websocket so that it doesn't get
                    // finalized before the initial data handler is called.
                    _pending_activity: CppWebSocketRef::new(outgoing),
                })),
            });
            ws.pending_initial_task
                .set(Some(global_this.queue_microtask_boxed(task)));
        }

        ws.as_ptr()
    }

    pub(crate) fn init(
        outgoing: &CppWebSocket,
        input_socket: *mut us_socket_t,
        global_this: &JSGlobalObject,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
    ) -> *mut Self {
        let ws = Self::new_raw(global_this, deflate_params, secure, None);
        let this = ws.this_ptr();

        // `adopt_group` takes a closure to write the new socket.
        let vm = global_this.bun_vm().as_mut();
        let loop_ = vm.uws_loop();
        let group = vm.rare_data().ws_client_group::<SSL>(loop_);
        if !Socket::<SSL>::adopt_group(
            input_socket,
            group,
            if SSL {
                uws::DispatchKind::WsClientTls
            } else {
                uws::DispatchKind::WsClient
            },
            ws.as_ptr(),
            |_, sock| this.tcp.set(sock),
        ) {
            return core::ptr::null_mut();
        }

        Self::finish_init(ws, outgoing, global_this, buffered_data)
    }

    /// Initialize a WebSocket client that uses a proxy tunnel for I/O.
    /// Used for wss:// through HTTP proxy where TLS is handled by the tunnel.
    /// The tunnel takes ownership of socket I/O, and this client reads/writes through it.
    pub(crate) fn init_with_tunnel(
        outgoing: &CppWebSocket,
        tunnel: ThisPtr<WebSocketProxyTunnel>,
        global_this: &JSGlobalObject,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
    ) -> *mut Self {
        // The caller retains its own ref on `tunnel`; take one of our own
        // (released in `clear_data`).
        //
        // ref_count starts at 1: this is the I/O-layer ref, owned by the
        // tunnel connection (analogous to the adopted-socket ref in init()
        // that handle_close() releases). It is released in clear_data() when
        // proxy_tunnel is detached. `finish_init` adds the C++ ref paired
        // with m_connectedWebSocket.
        let ws = Self::new_raw(
            global_this,
            deflate_params,
            None,
            Some(RefPtr::from_this(tunnel)),
        );

        Self::finish_init(ws, outgoing, global_this, buffered_data)
    }

    /// Handle data received from the proxy tunnel (already decrypted).
    /// Called by the WebSocketProxyTunnel when it receives and decrypts data.
    pub(crate) fn handle_tunnel_data(this: ThisPtr<Self>, data: &[u8]) {
        // Process the decrypted data as if it came from the socket
        // has_tcp() now returns true for tunnel mode, so this will work correctly
        Self::handle_data(this, data);
    }

    /// Called by the WebSocketProxyTunnel when the underlying socket drains.
    /// Flushes any buffered plaintext data through the tunnel.
    pub(crate) fn handle_tunnel_writable(this: ThisPtr<Self>) {
        if this.close_received.get() && !this.has_pending_close_dispatch() {
            return;
        }
        // send_buffer → tunnel.write() can re-enter fail() synchronously
        // (see write_binary_data). The tunnel ref-guards itself in
        // on_writable() but not this struct.
        let _guard = RefPtr::from_this(this);

        this.drain_send_buffer_and_finish_close();
    }

    /// The JS wrapper was collected: C++ is letting go of its ref.
    pub(crate) fn finalize(this: ThisPtr<Self>) {
        log!("finalize");
        // clear_data() may drop the tunnel's I/O-layer ref and the block
        // below drops the C++ ref; keep `this` alive until we've finished the
        // tcp close check.
        let _guard = RefPtr::from_this(this);

        this.clear_data();

        // This is only called by outgoing_websocket.
        this.release_cpp_ref();

        if !this.tcp.get().is_closed() {
            this.tcp.get().close(uws::CloseKind::Failure);
        }
    }

    /// The owning C++ WebSocket's context is being torn down: forget it (nothing
    /// here may call back into it or into script) and drop the connection now —
    /// a raw close on TLS too, since no loop remains to finish a graceful one.
    pub(crate) fn drop_connection_without_callback(this: ThisPtr<Self>) {
        log!("dropConnectionWithoutCallback");
        let _guard = RefPtr::from_this(this);

        let _cpp_ref = this.outgoing_websocket.replace(None);
        this.clear_data();
        if !this.tcp.get().is_closed() {
            this.tcp.get().close(uws::CloseKind::Failure);
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = size_of::<Self>();
        cost += self.send_buffer.try_borrow().map_or(0, |b| b.capacity());
        cost += self.receive_buffer.try_borrow().map_or(0, |b| b.capacity());
        // This is under-estimated a little, as we don't include usockets context.
        cost
    }
}

impl<const SSL: bool> Drop for WebSocket<SSL> {
    fn drop(&mut self) {
        self.clear_data();
        // deflate already dropped in clear_data; this is defensive
        self.deflate.replace(None);
        if let Some(task) = self.pending_initial_task.take() {
            // Still owned by the microtask queue (run later, or dropped unrun
            // at teardown); it must not follow its back-reference to us.
            task.ws.set(None);
        }
        bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::ALLOC_TYPE_NAME, self);
    }
}

/// Transcode a close reason to UTF-8 into `buf`; `None` when it exceeds `MAX_CLOSE_REASON`.
fn encode_close_reason(
    reason: &EncodedSlice,
    buf: &mut [u8; MAX_CONTROL_PAYLOAD],
) -> Option<usize> {
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
pub type WebSocketClient = WebSocket<false>;
pub type WebSocketClientTLS = WebSocket<true>;

// HOST_EXPORT(Bun__WebSocketClient__cancel, c)
pub fn bun__websocketclient__cancel(this: ThisPtr<crate::websocket_client::WebSocketClient>) {
    WebSocketClient::cancel(this)
}
// HOST_EXPORT(Bun__WebSocketClient__bufferedAmount, c)
pub fn bun__websocketclient__buffered_amount(
    this: &crate::websocket_client::WebSocketClient,
) -> usize {
    this.buffered_amount()
}
// HOST_EXPORT(Bun__WebSocketClient__pause, c)
pub fn bun__websocketclient__pause(this: &crate::websocket_client::WebSocketClient) -> bool {
    this.pause()
}
// HOST_EXPORT(Bun__WebSocketClient__resume, c)
pub fn bun__websocketclient__resume(this: &crate::websocket_client::WebSocketClient) -> bool {
    this.resume()
}
// HOST_EXPORT(Bun__WebSocketClient__close, c)
pub fn bun__websocketclient__close(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    code: u16,
    reason: Option<&bun_core::EncodedSlice>,
) {
    WebSocketClient::close(this, code, reason)
}
// HOST_EXPORT(Bun__WebSocketClient__finalize, c)
pub fn bun__websocketclient__finalize(this: ThisPtr<crate::websocket_client::WebSocketClient>) {
    WebSocketClient::finalize(this)
}
// HOST_EXPORT(Bun__WebSocketClient__dropConnectionWithoutCallback, c)
pub fn bun__websocketclient__drop_connection_without_callback(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
) {
    WebSocketClient::drop_connection_without_callback(this)
}
// HOST_EXPORT(Bun__WebSocketClient__init, c)
pub fn bun__websocketclient__init(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    input_socket: *mut bun_uws_sys::us_socket_t,
    global_this: &JSGlobalObject,
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    secure: Option<bun_boringssl::c::OwnedSslCtx>,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init(
        outgoing,
        input_socket,
        global_this,
        buffered_data,
        deflate_params,
        secure,
    )
}
// HOST_EXPORT(Bun__WebSocketClient__initWithTunnel, c)
pub fn bun__websocketclient__init_with_tunnel(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    tunnel: ThisPtr<crate::websocket_client::websocket_proxy_tunnel::WebSocketProxyTunnel>,
    global_this: &JSGlobalObject,
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init_with_tunnel(outgoing, tunnel, global_this, buffered_data, deflate_params)
}
// HOST_EXPORT(Bun__WebSocketClient__memoryCost, c)
pub fn bun__websocketclient__memory_cost(this: &crate::websocket_client::WebSocketClient) -> usize {
    this.memory_cost()
}
// HOST_EXPORT(Bun__WebSocketClient__writeBinaryData, c)
pub fn bun__websocketclient__write_binary_data(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    bytes: &[u8],
    op: u8,
) {
    WebSocketClient::write_binary_data(this, bytes, op)
}
// HOST_EXPORT(Bun__WebSocketClient__writeString, c)
pub fn bun__websocketclient__write_string(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    str_: &bun_core::EncodedSlice,
    op: u8,
) {
    WebSocketClient::write_string(this, str_, op)
}

// HOST_EXPORT(Bun__WebSocketClientTLS__cancel, c)
pub fn bun__websocketclienttls__cancel(this: ThisPtr<crate::websocket_client::WebSocketClientTLS>) {
    WebSocketClientTLS::cancel(this)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__bufferedAmount, c)
pub fn bun__websocketclienttls__buffered_amount(
    this: &crate::websocket_client::WebSocketClientTLS,
) -> usize {
    this.buffered_amount()
}
// HOST_EXPORT(Bun__WebSocketClientTLS__pause, c)
pub fn bun__websocketclienttls__pause(this: &crate::websocket_client::WebSocketClientTLS) -> bool {
    this.pause()
}
// HOST_EXPORT(Bun__WebSocketClientTLS__resume, c)
pub fn bun__websocketclienttls__resume(this: &crate::websocket_client::WebSocketClientTLS) -> bool {
    this.resume()
}
// HOST_EXPORT(Bun__WebSocketClientTLS__close, c)
pub fn bun__websocketclienttls__close(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
    code: u16,
    reason: Option<&bun_core::EncodedSlice>,
) {
    WebSocketClientTLS::close(this, code, reason)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__finalize, c)
pub fn bun__websocketclienttls__finalize(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
) {
    WebSocketClientTLS::finalize(this)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__dropConnectionWithoutCallback, c)
pub fn bun__websocketclienttls__drop_connection_without_callback(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
) {
    WebSocketClientTLS::drop_connection_without_callback(this)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__init, c)
pub fn bun__websocketclienttls__init(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    input_socket: *mut bun_uws_sys::us_socket_t,
    global_this: &JSGlobalObject,
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    secure: Option<bun_boringssl::c::OwnedSslCtx>,
) -> *mut crate::websocket_client::WebSocketClientTLS {
    WebSocketClientTLS::init(
        outgoing,
        input_socket,
        global_this,
        buffered_data,
        deflate_params,
        secure,
    )
}
// HOST_EXPORT(Bun__WebSocketClientTLS__memoryCost, c)
pub fn bun__websocketclienttls__memory_cost(
    this: &crate::websocket_client::WebSocketClientTLS,
) -> usize {
    this.memory_cost()
}
// HOST_EXPORT(Bun__WebSocketClientTLS__writeBinaryData, c)
pub fn bun__websocketclienttls__write_binary_data(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
    bytes: &[u8],
    op: u8,
) {
    WebSocketClientTLS::write_binary_data(this, bytes, op)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__writeString, c)
pub fn bun__websocketclienttls__write_string(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
    str_: &bun_core::EncodedSlice,
    op: u8,
) {
    WebSocketClientTLS::write_string(this, str_, op)
}

// ──────────────────────────────────────────────────────────────────────────
// InitialDataHandler
// ──────────────────────────────────────────────────────────────────────────

/// Bytes the upgrade client read past the end of the handshake response; boxed
/// so they cross C++ (`WebSocket::didConnect*`) as one opaque pointer.
pub struct InitialData(pub Vec<u8>);

/// Handshake-overflow bytes plus the pending-activity ref that keeps the C++
/// `WebSocket` alive until they are delivered.
struct InitialDataHandler {
    slice: Vec<u8>,
    _pending_activity: CppWebSocketRef,
}

impl InitialDataHandler {
    /// Feed the buffered bytes to `ws` as if they had just arrived.
    fn deliver<const SSL: bool>(self, ws: ThisPtr<WebSocket<SSL>>) {
        // For tunnel mode, tcp is detached but connection is still active through the tunnel
        let is_connected = !ws.tcp.get().is_closed() || ws.tunnel().is_some();
        if ws.cpp_websocket().is_some() && is_connected {
            WebSocket::<SSL>::handle_data(ws, &self.slice);
        }
    }
}

/// Microtask that delivers [`InitialDataHandler`] ahead of fresh socket data.
pub(crate) struct InitialDataTask<const SSL: bool> {
    /// Detached by `WebSocket`'s `Drop` (or by `handle_data` draining `data`
    /// first) so a task that outlives its client does nothing.
    ws: Cell<Option<BackRef<WebSocket<SSL>, Root>>>,
    data: JsCell<Option<InitialDataHandler>>,
}

impl<const SSL: bool> jsc::MicrotaskCallback for InitialDataTask<SSL> {
    fn run(self: Box<Self>) {
        let Some(ws) = self.ws.take() else {
            return;
        };
        let ws = ws.this_ptr();
        ws.pending_initial_task.set(None);
        if let Some(initial_data) = self.data.replace(None) {
            let _guard = RefPtr::from_this(ws);
            initial_data.deliver(ws);
        }
    }
}

impl<const SSL: bool> Drop for InitialDataTask<SSL> {
    fn drop(&mut self) {
        // Dropped unrun by the microtask queue while the client is still
        // alive: clear its back-reference to us.
        if let Some(ws) = self.ws.take() {
            ws.this_ptr().pending_initial_task.set(None);
        }
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
    Ended = 18,
    FailedToAllocateMemory = 19,
    ControlFrameIsFragmented = 20,
    InvalidControlFrame = 21,
    CompressionUnsupported = 22,
    InvalidCompressedData = 23,
    UnexpectedMaskFromServer = 25,
    UnsupportedControlFrame = 27,
    UnexpectedOpcode = 28,
    InvalidUtf8 = 29,
    TlsHandshakeFailed = 30,
    MessageTooBig = 31,
    // Proxy error codes
    ProxyConnectFailed = 33,
    ProxyAuthenticationRequired = 34,
    ProxyTunnelFailed = 36,
    UnexpectedRsv1 = 37,
}

// ──────────────────────────────────────────────────────────────────────────
// Mask
// ──────────────────────────────────────────────────────────────────────────

struct Mask;

impl Mask {
    fn generate(global_this: &JSGlobalObject) -> [u8; 4] {
        let entropy = global_this.bun_vm().as_mut().rare_data().entropy_slice(4);
        entropy[..4].try_into().expect("infallible: size matches")
    }

    fn fill(global_this: &JSGlobalObject, mask_buf: &mut [u8; 4], output: &mut [u8], input: &[u8]) {
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
    fn fill_in_place(global_this: &JSGlobalObject, mask_buf: &mut [u8; 4], buf: &mut [u8]) {
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
    fn frame_and_content_len(&self) -> (usize, usize) {
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

    fn copy(
        &self,
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        content_byte_len: usize,
        opcode: Opcode,
    ) {
        self.copy_with_compressed_flag(global_this, buf, content_byte_len, opcode, false);
    }

    /// Frame an already-deflated payload; `is_first_fragment` controls RSV1.
    fn copy_compressed(
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
