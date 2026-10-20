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
use core::net::IpAddr;

use bun_boringssl::c::OwnedSslCtx;
use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_http::websocket::{Opcode, WebsocketHeader, is_valid_close_code};
use bun_io::KeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject};
use bun_ptr::{BackRef, JsCell, RefPtr, ThisPtr};
use bun_uws::{self as uws, NewSocketHandler, us_bun_verify_error_t};
use bun_uws_sys::us_socket_t;

use self::cpp_websocket::{CppWebSocket, TlsHandshake};
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
/// RFC 6455 §5.5: a control frame's payload is at most 125 bytes.
const MAX_CONTROL_PAYLOAD: usize = 125;
/// Largest frame length `ws` and undici accept: `Number.MAX_SAFE_INTEGER`.
const MAX_PAYLOAD_LENGTH: u64 = (1 << 53) - 1;
const MAX_CONTROL_FRAME_SIZE: usize = WebsocketHeader::frame_size(MAX_CONTROL_PAYLOAD, true);
/// Skip auto-pongs while more than this many bytes are unsent. A peer can send unlimited Pings,
/// so unbounded replies would let it exhaust our memory. App sends aren't capped.
/// RFC 6455 §5.5.3 allows answering only the most recent Ping.
const AUTO_PONG_BACKPRESSURE_LIMIT: usize = 16 * 1024 * 1024;

/// Seconds to wait after sending our Close frame before dropping the connection (`closeTimeout` in `ws`).
#[inline]
fn close_timeout_seconds() -> core::ffi::c_uint {
    bun_http::normalize_idle_timeout_seconds(
        bun_core::env_var::BUN_CONFIG_WS_CLOSE_TIMEOUT
            .get()
            .unwrap_or(30),
    )
}

/// Matches `WebSocketConnectedOptions` (WebSocketDeflate.h).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ConnectedOptions {
    /// Max size of one message in bytes, after reassembly and decompression. 0 = no limit.
    pub max_payload_length: usize,
    pub auto_pong: bool,
    /// This client backs a `ws` module WebSocket. Text messages are validated and delivered as
    /// UTF-8 bytes, `did_drain` fires when the send queue empties, and `ws` runs the close timer.
    pub ws_mode: bool,
    /// Only with `ws_mode`: don't validate UTF-8 in text messages and close reasons.
    pub skip_utf8_validation: bool,
    /// Act as the server side: expect masked frames and send unmasked ones.
    pub is_server: bool,
}

/// The underlying connection that frames are sent and received on.
enum Transport {
    /// `self.tcp`. Every transport is reset to this once the connection closes, with `tcp` detached.
    Socket,
    /// wss:// through an HTTP proxy. The tunnel handles TLS, so this is only used with SSL=false.
    /// Holds one ref, released in `clear_data`.
    Tunnel(RefPtr<WebSocketProxyTunnel>),
    /// A JS stream. Writes go through C++, which always accepts the whole buffer.
    /// Reads arrive through `feed`. C++ holds the only ref on this client.
    Stream,
}

/// A copy of [`Transport`], so no borrow of the cell is held across a write.
/// A write can re-enter and replace the transport.
#[derive(Clone, Copy)]
enum Io {
    Socket,
    Tunnel(ThisPtr<WebSocketProxyTunnel>),
    Stream,
}

/// Unmasking state for the frame being read. Server only.
#[derive(Clone, Copy)]
struct Unmask {
    /// The masking key, rotated so `key[0]` applies to the next payload byte.
    key: [u8; 4],
    /// Bytes of `key` read so far.
    key_len: u8,
    /// State to enter once the key is complete.
    payload_state: ReceiveState,
}

impl Unmask {
    fn copy(&mut self, output: &mut [u8], input: &[u8]) {
        bun_highway::fill_with_skip_mask(self.key, output, input, false);
        self.key.rotate_left(input.len() % 4);
    }
}

/// How to close the underlying socket.
#[derive(Clone, Copy)]
pub(crate) enum CloseMode {
    /// Like Node's `socket.destroy()`: data already in the kernel's send buffer is still sent.
    Fin,
    /// Send a RST and drop unsent data. For when the JS object was collected or its context is
    /// being torn down.
    Reset,
}

impl CloseMode {
    pub(crate) fn close<const SSL: bool>(self, socket: Socket<SSL>) {
        match self {
            CloseMode::Fin => socket.close_now(),
            CloseMode::Reset => socket.close(uws::CloseKind::Failure),
        }
    }
}

/// How a connection ended; see [`WebSocket::finish`].
enum Outcome {
    /// Closed by the peer, the close timeout or `terminate()`.
    Closed,
    /// We failed the connection (RFC 6455 §7.1.7) and won't wait for the peer.
    /// The string is appended to the error message.
    Failed(ErrorCode, BunString),
}

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

    /// Payload of the control frame being read.
    control_payload: Cell<[u8; MAX_CONTROL_PAYLOAD]>,
    control_payload_len: Cell<u8>,
    /// A Ping/Pong/Close payload is partially buffered in `control_payload`.
    pub(crate) control_frame_started: Cell<bool>,
    /// Server only.
    unmask: Cell<Unmask>,
    /// We wrote or queued our Close frame. No frame may follow it (RFC 6455 §5.5.1).
    close_sent: Cell<bool>,
    /// Code and reason from the peer's Close frame, reported by the `close` event (RFC 6455 §7.1.5).
    close_received: RefCell<Option<(u16, BunString)>>,
    /// We flushed our Close frame, stopped reading and half-closed the connection.
    sent_fin: Cell<bool>,

    pub(crate) receive_body_remain: Cell<usize>,
    pub(crate) receive_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub(crate) send_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub(crate) global_this: GlobalRef,
    pub(crate) poll_ref: Cell<KeepAlive>,

    pub(crate) header_fragment: Cell<Option<u8>>,

    pub(crate) payload_length_frame_bytes: Cell<[u8; 8]>,
    pub(crate) payload_length_frame_len: Cell<u8>,

    /// Bytes not parsed yet. Either bytes that arrived with the 101, held until after `open`
    /// (or until `resume()` if an `open` listener paused the socket), or bytes from a
    /// re-entrant `feed`, held until the outer `feed` finishes.
    initial_data: Cell<Option<Box<InitialData>>>,
    /// A `feed` call is on the stack.
    parsing: Cell<bool>,
    options: ConnectedOptions,
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

    /// Hostname the upgrade client verified. A renegotiation re-checks it: an IP host has no SNI.
    verified_hostname: Box<[u8]>,

    transport: JsCell<Transport>,
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

    fn io(&self) -> Io {
        match self.transport.get() {
            Transport::Socket => Io::Socket,
            Transport::Tunnel(tunnel) => Io::Tunnel(tunnel.this_ptr()),
            Transport::Stream => Io::Stream,
        }
    }

    fn tunnel(&self) -> Option<ThisPtr<WebSocketProxyTunnel>> {
        match self.io() {
            Io::Tunnel(tunnel) => Some(tunnel),
            Io::Socket | Io::Stream => None,
        }
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

    fn max_payload_length(&self) -> usize {
        match self.options.max_payload_length {
            0 => usize::MAX,
            max => max,
        }
    }

    pub(crate) fn clear_data(&self) {
        log!("clearData");
        let mut poll_ref = self.poll_ref.take();
        poll_ref.unref(Self::vm_loop_ctx(&self.global_this));
        self.poll_ref.set(poll_ref);
        self.clear_receive_buffers(true);
        self.clear_send_buffers(true);
        self.initial_data.set(None);
        self.control_frame_started.set(false);
        self.control_payload_len.set(0);
        self.receiving_compressed.set(false);
        self.message_is_compressed.set(false);
        self.deflate.replace(None);
        drop(self.secure.take());
        // Detach the tunnel first so its shutdown callbacks cannot re-enter this path.
        if let Transport::Tunnel(tunnel) = self.transport.replace(Transport::Socket) {
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

    /// Implements `terminate()`. In `ws_mode` this only closes the socket, so `handle_close` /
    /// `handle_tunnel_close` still parse `initial_data`, though replies can no longer be sent.
    /// A listener fired from that parse can call `terminate()` again. The socket is already
    /// closed by then, so the nested call is a no-op.
    pub(crate) fn cancel(this: ThisPtr<Self>) {
        log!("cancel");
        let _guard = RefPtr::from_this(this);
        // `ws` calls this from JS. Holding `_scope` makes the `did_*` callbacks' `enter()` nested, so
        // they don't drain `process.nextTick` callbacks and microtasks before the calling JS frame
        // returns. `feed` and `stream_closed` do the same.
        match this.io() {
            Io::Stream => {
                let _scope = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
                this.finish(Outcome::Closed);
            }
            Io::Socket if this.options.ws_mode => {
                let _scope = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
                this.tcp.get().close_now();
            }
            Io::Tunnel(tunnel) if this.options.ws_mode => {
                if tunnel.has_socket() {
                    let _scope = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
                    Self::handle_tunnel_close(this);
                }
            }
            Io::Socket | Io::Tunnel(_) => this.finish(Outcome::Closed),
        }
    }

    /// The caller holds a ref guard. In tunnel mode the socket is the upgrade client's and only the tunnel reaches it.
    /// Doesn't destroy a JS stream. `finish` does that, as the only caller allowed to run JS.
    fn drop_connection(&self, mode: CloseMode) {
        let tunnel = self.tunnel().map(RefPtr::from_this);
        self.receive_state.set(ReceiveState::Closed);
        self.clear_data();
        match tunnel {
            Some(tunnel) => tunnel.close_socket(mode),
            None => mode.close(self.tcp.get()),
        }
    }

    /// The single teardown path. Closes the connection if it's still open, reports the
    /// outcome to C++ and releases the C++ ref. The close is clean (RFC 6455 §7.1.4) if both
    /// Close frames were exchanged, no matter how the connection ended afterwards.
    ///
    /// Every caller holds a ref guard (the uws dispatcher, a C++ entry point,
    /// or the tunnel callback), so `self` outlives the releases below.
    fn finish(&self, outcome: Outcome) {
        let Some((ws, _cpp_ref)) = self.outgoing_websocket.replace(None) else {
            return;
        };
        jsc::mark_binding!();
        let buffered_amount = self.buffered_amount();
        let received = self.close_received.take();
        let is_stream = matches!(self.io(), Io::Stream);
        self.drop_connection(CloseMode::Fin);
        if is_stream {
            ws.stream_destroy();
        }
        match outcome {
            Outcome::Failed(code, detail) => {
                ws.did_fail(code, buffered_amount, BunString::EMPTY, detail);
            }
            Outcome::Closed => {
                let was_clean = received.is_some() && self.sent_fin.get();
                let (code, reason) = received.unwrap_or((1006, BunString::EMPTY));
                ws.did_close(code, reason, was_clean, buffered_amount);
            }
        }
    }

    /// Ignore everything received after a Close frame (RFC 6455 §5.5.1) or after a failure.
    fn stop_reading(&self) {
        self.receive_state.set(ReceiveState::Closed);
        self.clear_receive_buffers(true);
    }

    fn fail(&self, code: ErrorCode) {
        self.fail_with_detail(code, BunString::EMPTY);
    }

    /// Fail the connection (RFC 6455 §7.1.7): send a best-effort Close frame with the reason and
    /// don't wait for a reply. In `ws_mode`, emit `error` now and `close` once the connection
    /// actually closes, same as after a normal closing handshake.
    fn fail_with_detail(&self, code: ErrorCode, detail: BunString) {
        let Some(ws) = self.cpp_websocket() else {
            return;
        };
        log!("fail ({})", <&'static str>::from(code));
        let Some(close_code) = code.info().close_code else {
            return self.finish(Outcome::Failed(code, detail));
        };
        self.send_close(&close_code.to_be_bytes());
        if !self.options.ws_mode {
            return self.finish(Outcome::Failed(code, detail));
        }
        self.stop_reading();
        ws.did_error(code, detail);
        self.send_fin_if_done();
    }

    /// The upgrade client handles the first handshake. This gets the end of a renegotiation, and a
    /// read that failed (`success` is 0).
    pub fn handle_handshake(
        &self,
        socket: Socket<SSL>,
        success: i32,
        ssl_error: us_bun_verify_error_t,
    ) {
        jsc::mark_binding!();

        log!("onHandshake({})", success);

        let Some(ws) = self.cpp_websocket() else {
            return;
        };
        if !ws.accepts_tls_peer(
            TlsHandshake::Renegotiation,
            socket.ssl_mut(),
            success == 1 && ssl_error.error_no == 0,
            &self.verified_hostname,
        ) {
            self.parse_initial_data();
            self.fail(ErrorCode::TlsHandshakeFailed);
        }
    }

    fn detach_tcp(&self) {
        let mut tcp = self.tcp.get();
        tcp.detach();
        self.tcp.set(tcp);
    }

    pub fn handle_close(&self, _socket: Socket<SSL>, _code: c_int, _reason: *mut c_void) {
        log!("onClose");
        self.detach_tcp();
        self.parse_initial_data();
        self.finish(Outcome::Closed);

        // For the socket.
        self.release_io_ref();
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
            None => Err(ErrorCode::UnexpectedRsv1),
            Some(deflate) => deflate
                .decompress(
                    rare.libdeflate_decompressor(),
                    data,
                    &mut decompressed,
                    self.max_payload_length(),
                )
                .map_err(|err| match err {
                    websocket_deflate::Error::InflateFailed => ErrorCode::InvalidCompressedData,
                    websocket_deflate::Error::TooLarge => ErrorCode::MessageTooBig,
                    websocket_deflate::Error::OutOfMemory => ErrorCode::FailedToAllocateMemory,
                }),
        };

        // The deflate borrow is released: both arms can re-enter `clear_data`.
        match result {
            Ok(()) => self.dispatch_data(&decompressed, kind),
            Err(code) => self.fail(code),
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
            Opcode::Text if self.options.ws_mode => {
                if !self.options.skip_utf8_validation && !strings::is_valid_utf8(data) {
                    self.fail(ErrorCode::InvalidUtf8);
                    return;
                }
                jsc::mark_binding!();
                out.did_receive_bytes(data, kind as u8);
            }
            Opcode::Text => {
                // this function encodes to UTF-16 if > 127
                // so we don't need to worry about latin1 non-ascii code points
                // we avoid trim since we wanna keep the utf8 validation intact
                let utf16_bytes = match strings::to_utf16_alloc(data, true, false) {
                    Ok(v) => v,
                    Err(strings::ToUTF16Error::InvalidByteSequence) => {
                        self.fail(ErrorCode::InvalidUtf8);
                        return;
                    }
                    Err(strings::ToUTF16Error::OutOfMemory) => {
                        self.fail(ErrorCode::FailedToAllocateMemory);
                        return;
                    }
                };
                let text = match utf16_bytes {
                    Some(utf16) => BunString::create_external_globally_allocated_utf16(utf16),
                    None => BunString::clone_latin1(data),
                };
                jsc::mark_binding!();
                out.did_receive_text(text);
            }
            Opcode::Binary | Opcode::Ping | Opcode::Pong => {
                jsc::mark_binding!();
                out.did_receive_bytes(data, kind as u8);
            }
            _ => {
                self.fail(ErrorCode::UnexpectedOpcode);
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

    // There is no `socket` parameter: the dispatch thunk wraps the same
    // `us_socket_t*` that `adopt_group` stored into `self.tcp`, so the parse
    // loop reads `self.tcp` directly.
    pub fn handle_data(this: ThisPtr<Self>, data: &[u8]) {
        // Bumps the intrusive refcount and derefs on Drop.
        let _guard = RefPtr::from_this(this);

        this.parse_initial_data();
        this.handle_data_loop(data);
    }

    /// Fires `message` events, so never call this from inside a JS call into the WebSocket.
    pub(crate) fn deliver_initial_data(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);
        if this.cpp_websocket().is_some_and(|ws| !ws.is_paused()) {
            this.parse_initial_data();
        }
    }

    fn parse_initial_data(&self) {
        if let Some(initial_data) = self.initial_data.take() {
            self.handle_data_loop(&initial_data.0);
        }
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

        loop {
            // `stop_reading` may have run before this call, on the previous frame, or in a listener.
            if self.receive_state.get() == ReceiveState::Closed {
                return;
            }
            log!("onData ({})", <&'static str>::from(cursor.state));

            let step = match cursor.state {
                ReceiveState::NeedHeader => self.recv_frame_header(&mut cursor),
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
                ReceiveState::MaskKey => self.recv_mask_key(&mut cursor),
                ReceiveState::MaskedBody => self.recv_masked_body(&mut cursor),
                ReceiveState::Closed => Step::Terminated,
            };
            match step {
                Step::Continue => {}
                Step::NeedMoreData => break,
                Step::Terminated => return,
            }
        }

        if self.receive_state.get() == ReceiveState::Closed {
            return;
        }
        self.receive_state.set(cursor.state);
        self.receiving_type.set(cursor.last_data_type);
        self.receive_body_remain.set(cursor.body_remain);
    }

    fn recv_failed(&self, code: ErrorCode) -> Step {
        self.fail(code);
        Step::Terminated
    }

    /// `value` is the invalid opcode, length or status code. It's appended to the error message.
    fn recv_failed_with_value(&self, code: ErrorCode, value: usize) -> Step {
        self.fail_with_detail(code, BunString::create_format(format_args!("{value}")));
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

        let header = match parse_websocket_header(header_bytes, self.options.is_server) {
            Ok(header) => header,
            Err(code @ ErrorCode::UnsupportedControlFrame) => {
                return self.recv_failed_with_value(code, (header_bytes[0] & 0x0F) as usize);
            }
            Err(code) => return self.recv_failed(code),
        };
        cursor.state = header.next;
        cursor.body_remain = header.payload_len;
        cursor.is_final = header.is_final;

        match header.opcode {
            Opcode::Continue => {
                // if is final is true continue is invalid
                if self.receiving_is_final.get() {
                    // nothing to continue here
                    // Per Autobahn test case 5.9: "The connection is failed immediately, since there is no message to continue."
                    return self.recv_failed_with_value(
                        ErrorCode::UnexpectedOpcode,
                        header.opcode as usize,
                    );
                }
                // only update final if is a valid continue
                self.receiving_is_final.set(header.is_final);
            }
            Opcode::Text | Opcode::Binary => {
                // if the last one is not final this is invalid because we are waiting a continue
                if !self.receiving_is_final.get() {
                    return self.recv_failed_with_value(
                        ErrorCode::UnexpectedOpcode,
                        header.opcode as usize,
                    );
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

        // RFC 7692 §6.1: RSV1 marks the start of a compressed message, so only
        // the first frame of a data message may set it, and only if deflate was negotiated.
        if header.compressed
            && (!matches!(header.opcode, Opcode::Text | Opcode::Binary)
                || self.deflate.borrow().is_none())
        {
            return self.recv_failed(ErrorCode::UnexpectedRsv1);
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

        if let Step::Terminated = self.validate_payload_length(cursor) {
            return Step::Terminated;
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
            8 => {
                let length = u64::from_be_bytes(payload_length_frame_bytes);
                if length > MAX_PAYLOAD_LENGTH {
                    return self.recv_failed(ErrorCode::UnsupportedPayloadLength);
                }
                length as usize
            }
            2 => u16::from_be_bytes([payload_length_frame_bytes[0], payload_length_frame_bytes[1]])
                as usize,
            _ => unreachable!(),
        };

        self.payload_length_frame_len.set(0);

        cursor.state = ReceiveState::NeedBody;
        self.validate_payload_length(cursor)
    }

    /// Reject an invalid payload length as soon as it's known, before the masking key and
    /// payload arrive. Does nothing while `cursor.state` still expects the extended length.
    fn validate_payload_length(&self, cursor: &mut RecvCursor<'_>) -> Step {
        let length = cursor.body_remain;
        match cursor.state {
            ReceiveState::NeedBody => {
                let buffered_len = self.receive_buffer.borrow().readable_length();
                if buffered_len.saturating_add(length) > self.max_payload_length() {
                    return self.recv_failed(ErrorCode::MessageTooBig);
                }
            }
            ReceiveState::Ping | ReceiveState::Pong | ReceiveState::Close => {
                // A Close payload is either empty or starts with a 2-byte status code.
                if length > MAX_CONTROL_PAYLOAD
                    || (length == 1 && cursor.state == ReceiveState::Close)
                {
                    return self.recv_failed_with_value(ErrorCode::InvalidControlFrame, length);
                }
            }
            _ => {}
        }
        if self.options.is_server {
            cursor.state = self.expect_mask_key(cursor.state);
        }
        Step::Continue
    }

    /// The masking key comes after the length and before the payload, so read it before `next`.
    fn expect_mask_key(&self, next: ReceiveState) -> ReceiveState {
        let payload_state = match next {
            ReceiveState::ExtendedPayloadLength16 | ReceiveState::ExtendedPayloadLength64 => {
                return next;
            }
            ReceiveState::NeedBody => ReceiveState::MaskedBody,
            control => control,
        };
        self.unmask.set(Unmask {
            key: [0; 4],
            key_len: 0,
            payload_state,
        });
        ReceiveState::MaskKey
    }

    fn recv_mask_key(&self, cursor: &mut RecvCursor<'_>) -> Step {
        let mut unmask = self.unmask.get();
        let start = unmask.key_len as usize;
        let (key_bytes, rest) = cursor
            .data
            .split_at((unmask.key.len() - start).min(cursor.data.len()));
        unmask.key[start..start + key_bytes.len()].copy_from_slice(key_bytes);
        unmask.key_len += key_bytes.len() as u8;
        self.unmask.set(unmask);
        cursor.data = rest;

        if (unmask.key_len as usize) < unmask.key.len() {
            return Step::NeedMoreData;
        }
        // Continue even if `data` is empty, because the payload may be empty too.
        cursor.state = unmask.payload_state;
        Step::Continue
    }

    /// Server version of [`Self::recv_body`]. Unmasks the payload while copying it into `receive_buffer`.
    fn recv_masked_body(&self, cursor: &mut RecvCursor<'_>) -> Step {
        let (chunk, rest) = cursor
            .data
            .split_at(cursor.body_remain.min(cursor.data.len()));
        if !chunk.is_empty() {
            let mut unmask = self.unmask.get();
            let mut receive_buffer = self.receive_buffer.borrow_mut();
            let writable = bun_core::handle_oom(receive_buffer.writable_with_size(chunk.len()));
            unmask.copy(&mut writable[..chunk.len()], chunk);
            receive_buffer.update(chunk.len());
            self.unmask.set(unmask);
        }

        cursor.body_remain -= chunk.len();
        cursor.data = rest;
        if cursor.body_remain == 0 {
            cursor.state = ReceiveState::NeedHeader;
            if cursor.is_final {
                self.dispatch_buffered_message(
                    cursor.last_data_type,
                    self.receiving_compressed.get(),
                );
            }
        }

        if cursor.data.is_empty() {
            return Step::NeedMoreData;
        }
        Step::Continue
    }

    /// While `control_frame_started`, `cursor.body_remain` counts bytes buffered so far, not bytes left.
    fn buffer_control_payload(
        &self,
        cursor: &mut RecvCursor<'_>,
    ) -> Option<([u8; MAX_CONTROL_PAYLOAD], usize)> {
        if !self.control_frame_started.get() {
            self.control_payload_len.set(cursor.body_remain as u8);
            cursor.body_remain = 0;
            self.control_frame_started.set(true);
        }
        let payload_len = self.control_payload_len.get() as usize;

        if !cursor.data.is_empty() {
            let total_received = payload_len.min(cursor.body_remain + cursor.data.len());
            let mut control_payload = self.control_payload.get();
            let dst = &mut control_payload[cursor.body_remain..total_received];
            let copied = dst.len();
            dst.copy_from_slice(&cursor.data[..copied]);
            self.control_payload.set(control_payload);
            cursor.body_remain = total_received;
            cursor.data = &cursor.data[copied..];
        }
        if payload_len > cursor.body_remain {
            // wait for more data - the control payload is fragmented across TCP segments
            return None;
        }

        let mut payload = self.control_payload.get();
        if self.options.is_server {
            let key = self.unmask.get().key;
            bun_highway::fill_with_skip_mask_inplace(key, &mut payload[..payload_len], false);
        }
        self.control_frame_started.set(false);
        Some((payload, payload_len))
    }

    fn recv_ping_or_pong(&self, cursor: &mut RecvCursor<'_>, opcode: Opcode) -> Step {
        let Some((payload, payload_len)) = self.buffer_control_payload(cursor) else {
            return Step::NeedMoreData;
        };
        // Send the Pong before dispatching `ping`. If a listener calls close(), the Pong must not
        // follow the Close frame.
        if opcode == Opcode::Ping
            && self.options.auto_pong
            && self.buffered_amount() <= AUTO_PONG_BACKPRESSURE_LIMIT
        {
            // we need to send all pongs to pass autobahn tests
            self.send_pong(&payload[..payload_len]);
        }
        self.dispatch_data(&payload[..payload_len], opcode);

        cursor.state = ReceiveState::NeedHeader;
        cursor.body_remain = 0;

        if cursor.data.is_empty() {
            return Step::NeedMoreData;
        }
        Step::Continue
    }

    fn recv_body(&self, cursor: &mut RecvCursor<'_>) -> Step {
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

    /// Record the peer's Close frame, echo it unless we already sent ours, and
    /// stop reading: a received Close always terminates the parse loop.
    fn recv_close(&self, cursor: &mut RecvCursor<'_>) -> Step {
        let Some((payload, payload_len)) = self.buffer_control_payload(cursor) else {
            return Step::NeedMoreData;
        };
        let payload = &payload[..payload_len];

        let received = match payload.split_first_chunk::<2>() {
            // RFC 6455 §7.1.5: "no status received".
            None => (1005, BunString::EMPTY),
            Some((code, reason)) => {
                let code = u16::from_be_bytes(*code);
                if !is_valid_close_code(code) {
                    return self.recv_failed_with_value(ErrorCode::InvalidCloseCode, code as usize);
                }
                if !self.options.skip_utf8_validation && !strings::is_valid_utf8(reason) {
                    return self.recv_failed(ErrorCode::InvalidUtf8);
                }
                (code, BunString::clone_utf8(reason))
            }
        };
        let (code, reason) = received.clone();
        self.close_received.replace(Some(received));
        self.stop_reading();
        self.send_close(payload);
        if let Some(ws) = self.cpp_websocket() {
            ws.did_start_closing_handshake(code, reason);
        }
        self.send_fin_if_done();
        Step::Terminated
    }

    /// Send an encoded frame, after anything already queued.
    fn enqueue_encoded_bytes(&self, bytes: &[u8]) {
        if self.has_backpressure() {
            // A tunnel flushes the queue from `handle_tunnel_writable`.
            self.copy_to_send_buffer(bytes);
            if self.tunnel().is_none() {
                self.send_buffer_out();
            }
            return;
        }

        match self.write_to_transport(bytes) {
            Some(wrote) if wrote == bytes.len() => {}
            Some(wrote) => self.copy_to_send_buffer(&bytes[wrote..]),
            None => self.finish(Outcome::Closed),
        }
    }

    /// Returns how many bytes were written, or `None` if the write failed.
    fn write_to_transport(&self, bytes: &[u8]) -> Option<usize> {
        match self.io() {
            // Do not set MSG_MORE, see https://github.com/oven-sh/bun/issues/4010
            Io::Socket => usize::try_from(self.tcp.get().write(bytes)).ok(),
            Io::Tunnel(tunnel) => match WebSocketProxyTunnel::write(tunnel, bytes) {
                Ok(wrote) => Some(wrote),
                // Like a socket, a tunnel that refuses a write took 0 bytes: `handle_tunnel_writable` follows
                // (a renegotiation ended) or `handle_tunnel_close` (a read failed, its data comes first).
                Err(_) => Some(0),
            },
            Io::Stream => {
                self.cpp_websocket()?.stream_write(bytes);
                Some(bytes.len())
            }
        }
    }

    fn copy_to_send_buffer(&self, bytes: &[u8]) {
        bun_core::handle_oom(self.send_buffer.borrow_mut().write(bytes));
    }

    fn send_data(&self, bytes: Copy<'_>, do_write: bool, kind: FrameKind) {
        if kind.deflate == Deflate::Never || self.deflate.borrow().is_none() {
            return self.send_data_uncompressed(bytes, do_write, kind);
        }

        // Small messages aren't worth the deflate overhead (or the transcode below).
        let (_, content_byte_len) = bytes.frame_and_content_len(kind.masked);
        if kind.deflate == Deflate::IfLargeEnough && content_byte_len < MIN_COMPRESS_SIZE {
            return self.send_data_uncompressed(bytes, do_write, kind);
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
        };

        let mut compressed: Vec<u8> = Vec::new();
        let compressed_ok = self.deflate.borrow_mut().as_mut().is_some_and(|deflate| {
            deflate
                .compress(content_to_compress, &mut compressed)
                .is_ok()
        });
        if !compressed_ok {
            // If compression fails, fall back to uncompressed
            return self.send_data_uncompressed(bytes, do_write, kind);
        }

        let frame_size = WebsocketHeader::frame_size(compressed.len(), kind.masked);
        {
            let mut send_buffer = self.send_buffer.borrow_mut();
            let writable = bun_core::handle_oom(send_buffer.writable_with_size(frame_size));
            Copy::copy_compressed(
                &self.global_this,
                &mut writable[..frame_size],
                &compressed,
                kind,
            );
            send_buffer.update(frame_size);
        }

        if do_write {
            self.debug_assert_socket_writable();
            self.send_buffer_out();
        }
    }

    fn send_data_uncompressed(&self, bytes: Copy<'_>, do_write: bool, kind: FrameKind) {
        let (write_len, content_byte_len) = bytes.frame_and_content_len(kind.masked);
        debug_assert!(write_len > 0);

        {
            let mut send_buffer = self.send_buffer.borrow_mut();
            let writable = bun_core::handle_oom(send_buffer.writable_with_size(write_len));
            bytes.copy(
                &self.global_this,
                &mut writable[..write_len],
                content_byte_len,
                kind,
            );
            send_buffer.update(write_len);
        }

        if do_write {
            self.debug_assert_socket_writable();
            self.send_buffer_out();
        }
    }

    /// In debug builds, assert that the underlying socket can still be written
    /// to (the other transports don't use `tcp`).
    fn debug_assert_socket_writable(&self) {
        #[cfg(debug_assertions)]
        if matches!(self.io(), Io::Socket) {
            let tcp = self.tcp.get();
            debug_assert!(!tcp.is_shutdown());
            debug_assert!(!tcp.is_closed());
            debug_assert!(tcp.is_established());
        }
    }

    fn send_buffer_out(&self) {
        let mut buf = self
            .send_buffer
            .replace(LinearFifo::<u8, DynamicBuffer<u8>>::init());
        let wrote: Option<usize> = loop {
            let out_buf = buf.readable_slice(0);
            debug_assert!(!out_buf.is_empty());
            let slice_len = out_buf.len();
            let wrote = self.write_to_transport(out_buf);
            // When the ring buffer wraps, `readable_slice` only returns the first part. Loop to
            // write the rest, because no second writable event will fire for it.
            match wrote {
                Some(wrote) if wrote == slice_len && wrote < buf.readable_length() => {
                    buf.discard(wrote);
                }
                _ => break wrote,
            }
        };
        buf.discard(wrote.unwrap_or(0));
        self.send_buffer.replace(buf);
        if wrote.is_none() {
            self.finish(Outcome::Closed);
        }
    }

    fn send_pong(&self, payload: &[u8]) {
        if self.can_send() {
            self.send_control_frame(Opcode::Pong, payload);
        }
    }

    /// Send our Close frame, after anything already queued. `payload` is the status code
    /// plus reason, or empty. The connection then has `close_timeout_seconds` to close.
    /// In `ws_mode`, `ws` runs its own timer that calls `terminate()`, and a paused socket
    /// stays paused.
    fn send_close(&self, payload: &[u8]) {
        if !self.can_send() {
            return;
        }
        log!("Sending close ({} bytes)", payload.len());
        self.close_sent.set(true);
        if !self.options.ws_mode {
            // Resume reading, or we'd never see the peer's Close frame or FIN.
            self.resume();
            self.arm_close_timeout();
        }
        self.send_control_frame(Opcode::Close, payload);
    }

    fn arm_close_timeout(&self) {
        match self.io() {
            Io::Socket => self.tcp.get().set_timeout(close_timeout_seconds()),
            Io::Tunnel(tunnel) => tunnel.set_timeout(close_timeout_seconds()),
            Io::Stream => {}
        }
    }

    fn send_control_frame(&self, opcode: Opcode, payload: &[u8]) {
        let kind = FrameKind {
            opcode,
            fin: true,
            deflate: Deflate::Never,
            masked: !self.options.is_server,
        };
        let frame_size = WebsocketHeader::frame_size(payload.len(), kind.masked);
        let mut frame = [0u8; MAX_CONTROL_FRAME_SIZE];
        Copy::Bytes(payload).copy(
            &self.global_this,
            &mut frame[..frame_size],
            payload.len(),
            kind,
        );
        self.enqueue_encoded_bytes(&frame[..frame_size]);
    }

    /// Once our Close frame is flushed and we've stopped reading, half-close and wait for the
    /// peer to close the connection (RFC 6455 §7.1.1). `finish` runs when it does.
    fn send_fin_if_done(&self) {
        if self.sent_fin.get()
            || !self.close_sent.get()
            || self.has_backpressure()
            || self.receive_state.get() != ReceiveState::Closed
        {
            return;
        }
        self.sent_fin.set(true);
        match self.io() {
            Io::Socket => self.tcp.get().shutdown(),
            Io::Tunnel(tunnel) => WebSocketProxyTunnel::end(tunnel),
            Io::Stream => {
                if let Some(ws) = self.cpp_websocket() {
                    ws.stream_end();
                }
            }
        }
    }

    /// Shared tail of the writable handlers (direct socket and proxy tunnel).
    /// Call when the socket became writable. Data queued before close() goes out first. As long
    /// as the peer keeps reading it, the close timeout starts over, or a slow upload would be
    /// cut off.
    pub(crate) fn restart_close_timeout_while_sending(&self) {
        if self.close_sent.get() && !self.options.ws_mode && self.has_backpressure() {
            self.arm_close_timeout();
        }
    }

    fn flush_send_queue(&self) {
        self.restart_close_timeout_while_sending();
        if self.send_buffer.borrow().readable_length() != 0 {
            self.send_buffer_out();
        }
        if self.has_backpressure() {
            return;
        }
        if self.options.ws_mode {
            if let Some(ws) = self.cpp_websocket() {
                ws.did_drain();
            }
        }
        self.send_fin_if_done();
    }

    pub(crate) fn is_same_socket(&self, socket: &Socket<SSL>) -> bool {
        socket.socket == self.tcp.get().socket
    }

    pub fn handle_writable(&self, socket: Socket<SSL>) {
        debug_assert!(self.is_same_socket(&socket));
        self.flush_send_queue();
    }

    /// Only `arm_close_timeout` sets a timeout.
    pub fn handle_timeout(&self, _socket: Socket<SSL>) {
        self.finish(Outcome::Closed);
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

    /// Set whether this connection keeps the process alive. Nothing re-refs it automatically.
    pub(crate) fn set_ref(&self, keep_alive: bool) {
        // A JS stream keeps the process alive on its own.
        if self.cpp_websocket().is_none() || matches!(self.io(), Io::Stream) {
            return;
        }
        let ctx = Self::vm_loop_ctx(&self.global_this);
        let mut poll_ref = self.poll_ref.take();
        if keep_alive {
            poll_ref.r#ref(ctx);
        } else {
            poll_ref.unref(ctx);
        }
        self.poll_ref.set(poll_ref);
    }

    /// In tunnel mode this is the proxy's address.
    pub(crate) fn remote_address(&self) -> Option<(IpAddr, u16)> {
        match self.tunnel() {
            Some(tunnel) => tunnel.remote_address(),
            None => remote_address_of(self.tcp.get()),
        }
    }

    /// In tunnel mode this is the socket to the proxy. `None` on the stream transport.
    pub(crate) fn us_socket(&self) -> Option<*mut bun_uws_sys::us_socket_t> {
        match self.tunnel() {
            Some(tunnel) => tunnel.us_socket(),
            None => self.tcp.get().socket.get(),
        }
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
    fn send_frame(&self, bytes: Copy<'_>, payload_byte_len: usize, kind: FrameKind) {
        let frame_size = WebsocketHeader::frame_size(payload_byte_len, kind.masked);
        if frame_size < STACK_FRAME_SIZE && self.can_send_inline(kind) {
            self.send_inline_frame(bytes, payload_byte_len, frame_size, kind);
            return;
        }

        self.send_data(bytes, !self.has_backpressure(), kind);
    }

    pub(crate) fn write_binary_data(this: ThisPtr<Self>, slice: &[u8], op: u8, flags: u8) {
        // In tunnel mode, SSLWrapper.writeData() can synchronously fire
        // onClose → handle_tunnel_close() → finish() and release the refs on
        // `this` while enqueue_encoded_bytes/send_buffer_out still run.
        let _guard = RefPtr::from_this(this);

        if !this.can_send() || op > 0xF {
            return;
        }

        this.send_frame(
            Copy::Bytes(slice),
            slice.len(),
            FrameKind::from_ffi(op, flags, !this.options.is_server),
        );
    }

    /// An inline frame skips the send queue and the compressor.
    fn can_send_inline(&self, kind: FrameKind) -> bool {
        kind.deflate != Deflate::Always && !self.has_backpressure()
    }

    /// Encode a frame small enough for a stack buffer and hand it straight to
    /// the socket, bypassing the heap-backed send queue.
    fn send_inline_frame(
        &self,
        bytes: Copy<'_>,
        content_len: usize,
        frame_size: usize,
        kind: FrameKind,
    ) {
        debug_assert!(frame_size <= STACK_FRAME_SIZE);
        let mut inline_buf = [0u8; STACK_FRAME_SIZE];
        bytes.copy(
            &self.global_this,
            &mut inline_buf[..frame_size],
            content_len,
            kind,
        );
        self.enqueue_encoded_bytes(&inline_buf[..frame_size]);
    }

    fn has_tcp(&self) -> bool {
        match self.io() {
            Io::Socket => {
                let tcp = self.tcp.get();
                !tcp.is_closed() && !tcp.is_shutdown()
            }
            Io::Tunnel(tunnel) => tunnel.has_socket(),
            Io::Stream => true,
        }
    }

    fn can_send(&self) -> bool {
        !self.close_sent.get() && self.has_tcp()
    }

    pub(crate) fn write_string(this: ThisPtr<Self>, str: &EncodedSlice, op: u8, flags: u8) {
        // See write_binary_data() — tunnel.write() can re-enter finish().
        let _guard = RefPtr::from_this(this);

        if !this.can_send() {
            return;
        }

        // Note: 0 is valid

        let kind = FrameKind::from_ffi(op, flags, !this.options.is_server);

        // fast path: small frame, no backpressure, attempt to send without allocating
        if !str.is_16bit() && str.len < STACK_FRAME_SIZE {
            let bytes = Copy::Latin1(str.slice());
            let (frame_size, byte_len) = bytes.frame_and_content_len(kind.masked);
            if frame_size < STACK_FRAME_SIZE && this.can_send_inline(kind) {
                this.send_inline_frame(bytes, byte_len, frame_size, kind);
                return;
            }
            // max length of a utf16 -> utf8 conversion is 4 times the length of the utf16 string
        } else if (str.len * 4) < STACK_FRAME_SIZE && this.can_send_inline(kind) {
            let bytes = Copy::Utf16(str.utf16_slice());
            let (frame_size, byte_len) = bytes.frame_and_content_len(kind.masked);
            this.send_inline_frame(bytes, byte_len, frame_size, kind);
            return;
        }

        this.send_data(
            if str.is_16bit() {
                Copy::Utf16(str.utf16_slice())
            } else {
                Copy::Latin1(str.slice())
            },
            !this.has_backpressure(),
            kind,
        );
    }

    /// `code` 1005 ("no status received") sends a Close frame with an empty payload.
    /// `reason` is UTF-8. It's left out if it doesn't fit, but C++ already rejects those.
    pub(crate) fn close(this: ThisPtr<Self>, code: u16, reason: &[u8]) {
        // See write_binary_data() — tunnel.write() can re-enter finish().
        let _guard = RefPtr::from_this(this);

        let mut payload = [0u8; MAX_CONTROL_PAYLOAD];
        let mut payload_len = 0;
        if code != 1005 {
            payload[..2].copy_from_slice(&code.to_be_bytes());
            payload_len = 2;
            if let Some(reason_bytes) = payload.get_mut(2..2 + reason.len()) {
                reason_bytes.copy_from_slice(reason);
                payload_len += reason.len();
            }
        }
        this.send_close(&payload[..payload_len]);
    }

    /// Allocate a client with `ref_count == 1` (the I/O-layer ref, released by
    /// `handle_close` for adopted sockets and by `clear_data` in tunnel mode)
    /// and an optional permessage-deflate context.
    fn new_raw(
        global_this: &JSGlobalObject,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        verified_hostname: &[u8],
        transport: Transport,
        options: &ConnectedOptions,
    ) -> RefPtr<Self> {
        let ws = RefPtr::new(WebSocket::<SSL> {
            ref_count: Cell::new(1),
            tcp: Cell::new(Socket::<SSL>::detached()),
            io_ref: Cell::new(None),
            outgoing_websocket: JsCell::new(None),
            receive_state: Cell::new(ReceiveState::NeedHeader),
            receiving_type: Cell::new(Opcode::ResB),
            receiving_is_final: Cell::new(true),
            control_payload: Cell::new([0u8; MAX_CONTROL_PAYLOAD]),
            control_payload_len: Cell::new(0),
            control_frame_started: Cell::new(false),
            unmask: Cell::new(Unmask {
                key: [0; 4],
                key_len: 0,
                payload_state: ReceiveState::NeedHeader,
            }),
            close_sent: Cell::new(false),
            close_received: RefCell::new(None),
            sent_fin: Cell::new(false),
            receive_body_remain: Cell::new(0),
            receive_buffer: RefCell::new(LinearFifo::<u8, DynamicBuffer<u8>>::init()),
            send_buffer: RefCell::new(LinearFifo::<u8, DynamicBuffer<u8>>::init()),
            global_this: GlobalRef::from(global_this),
            poll_ref: Cell::new(KeepAlive::init()),
            header_fragment: Cell::new(None),
            payload_length_frame_bytes: Cell::new([0u8; 8]),
            payload_length_frame_len: Cell::new(0),
            initial_data: Cell::new(None),
            parsing: Cell::new(false),
            options: *options,
            deflate: RefCell::new(
                deflate_params.map(|params| WebSocketDeflate::init(*params, options.is_server)),
            ),
            receiving_compressed: Cell::new(false),
            message_is_compressed: Cell::new(false),
            secure: Cell::new(secure),
            verified_hostname: Box::from(verified_hostname),
            transport: JsCell::new(transport),
        });
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::ALLOC_TYPE_NAME, ws.as_ptr());
        ws
    }

    /// Shared tail of `init`/`init_with_tunnel`: record the I/O-layer ref,
    /// reserve the I/O buffers, take the keep-alive ref, keep any
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

        ws.initial_data
            .set(buffered_data.filter(|b| !b.0.is_empty()));

        ws.as_ptr()
    }

    pub(crate) fn init(
        outgoing: &CppWebSocket,
        input_socket: *mut us_socket_t,
        global_this: &JSGlobalObject,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        verified_hostname: &[u8],
        options: &ConnectedOptions,
    ) -> *mut Self {
        let ws = Self::new_raw(
            global_this,
            deflate_params,
            secure,
            verified_hostname,
            Transport::Socket,
            options,
        );
        let this = ws.this_ptr();

        // `adopt_group` takes a closure to write the new socket.
        let loop_ = global_this.bun_vm().uws_loop();
        // SAFETY: `input_socket` is the live upgraded socket, still in its
        // context's upgrade group.
        let group = unsafe {
            bun_jsc::rare_data::SocketGroups::of((*input_socket).group())
                .ws_client_group::<SSL>(loop_)
        };
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
            // The upgrade client still owns the socket but forgets it when this returns, so close it here.
            CloseMode::Fin.close(Socket::<SSL>::from(input_socket));
            outgoing.did_fail(ErrorCode::Ended, 0, BunString::EMPTY, BunString::EMPTY);
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
        options: &ConnectedOptions,
    ) -> *mut Self {
        // The caller retains its own ref on `tunnel`; take one of our own
        // (released in `clear_data`).
        //
        // ref_count starts at 1: this is the I/O-layer ref, owned by the
        // tunnel connection (analogous to the adopted-socket ref in init()
        // that handle_close() releases). It is released in clear_data() when
        // the tunnel is detached. `finish_init` adds the C++ ref paired
        // with m_connectedWebSocket.
        let ws = Self::new_raw(
            global_this,
            deflate_params,
            None,
            &[],
            Transport::Tunnel(RefPtr::from_this(tunnel)),
            options,
        );

        Self::finish_init(ws, outgoing, global_this, buffered_data)
    }

    /// Create a client (or the server side, with `options.is_server`) that reads and writes
    /// through a JS stream. The stream keeps the process alive, so this takes no keep-alive ref.
    pub(crate) fn init_over_stream(
        outgoing: &CppWebSocket,
        global_this: &JSGlobalObject,
        options: &ConnectedOptions,
        deflate_params: Option<&websocket_deflate::Params>,
    ) -> *mut Self {
        let ws = Self::new_raw(
            global_this,
            deflate_params,
            None,
            &[],
            Transport::Stream,
            options,
        );
        let this = ws.this_ptr();
        this.outgoing_websocket
            .set(Some((BackRef::new(outgoing), ws)));
        this.as_ptr()
    }

    /// Parse bytes read from the JS stream. A listener can re-enter `feed` while we're parsing
    /// (e.g. an in-memory duplex pair whose other end replies synchronously). Re-entrant bytes
    /// are queued and parsed in order.
    pub(crate) fn feed(this: ThisPtr<Self>, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let _guard = RefPtr::from_this(this);
        if this.parsing.get() {
            let mut pending = this
                .initial_data
                .take()
                .unwrap_or_else(|| Box::new(InitialData(Vec::new())));
            pending.0.extend_from_slice(data);
            this.initial_data.set(Some(pending));
            return;
        }

        this.parsing.set(true);
        {
            let _scope = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
            this.handle_data_loop(data);
            while let Some(pending) = this.initial_data.take() {
                this.handle_data_loop(&pending.0);
            }
        }
        this.parsing.set(false);
    }

    /// The JS stream was closed or destroyed.
    pub(crate) fn stream_closed(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);
        if matches!(this.io(), Io::Stream) {
            this.transport.set(Transport::Socket);
        }
        let _scope = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
        this.finish(Outcome::Closed);
    }

    /// Handle data received from the proxy tunnel (already decrypted).
    /// Called by the WebSocketProxyTunnel when it receives and decrypts data.
    pub(crate) fn handle_tunnel_data(this: ThisPtr<Self>, data: &[u8]) {
        // Process the decrypted data as if it came from the socket
        Self::handle_data(this, data);
    }

    /// Called by the WebSocketProxyTunnel when its TLS session or the underlying proxy connection closes.
    pub(crate) fn handle_tunnel_close(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);
        if let Some(tunnel) = this.tunnel() {
            tunnel.close_socket(CloseMode::Fin);
        }
        this.parse_initial_data();
        this.finish(Outcome::Closed);
    }

    /// Called by the WebSocketProxyTunnel when the underlying socket drains or a renegotiation ends.
    /// Flushes any buffered plaintext data through the tunnel.
    pub(crate) fn handle_tunnel_writable(this: ThisPtr<Self>) {
        // send_buffer → tunnel.write() can re-enter finish() synchronously
        // (see write_binary_data). The tunnel ref-guards itself in
        // on_writable() but not this struct.
        let _guard = RefPtr::from_this(this);

        this.flush_send_queue();
    }

    /// The JS wrapper was collected or its context is being torn down. C++ is letting go of its
    /// ref, so forget it first: nothing below may call back into it or into script. Then drop the
    /// connection, with a raw close on TLS too, since there may be no loop left to finish a
    /// graceful one.
    pub(crate) fn finalize(this: ThisPtr<Self>) {
        log!("finalize");
        // Either release below may be the last ref.
        let _guard = RefPtr::from_this(this);

        // This is only called by outgoing_websocket.
        this.release_cpp_ref();
        this.drop_connection(CloseMode::Reset);
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
        bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::ALLOC_TYPE_NAME, self);
    }
}

/// `None` for a unix socket or a closed socket.
pub(crate) fn remote_address_of<const SSL: bool>(socket: Socket<SSL>) -> Option<(IpAddr, u16)> {
    let mut buf = [0u8; 64];
    let bytes = socket.remote_address(&mut buf)?;
    let ip = <[u8; 4]>::try_from(bytes)
        .map(IpAddr::from)
        .or_else(|_| <[u8; 16]>::try_from(bytes).map(IpAddr::from))
        .ok()?;
    Some((ip, socket.remote_port()?))
}

/// FFI form of [`WebSocket::remote_address`]. Returns false and leaves the out-params untouched
/// when there's no address.
fn write_remote_address(
    remote: Option<(IpAddr, u16)>,
    address: &mut BunString,
    port: &mut u16,
    is_ipv6: &mut bool,
) -> bool {
    let Some((ip, remote_port)) = remote else {
        return false;
    };
    *address = BunString::create_format(format_args!("{ip}"));
    *port = remote_port;
    *is_ipv6 = ip.is_ipv6();
    true
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
// HOST_EXPORT(Bun__WebSocketClient__setRef, c)
pub fn bun__websocketclient__set_ref(
    this: &crate::websocket_client::WebSocketClient,
    keep_alive: bool,
) {
    this.set_ref(keep_alive)
}
// HOST_EXPORT(Bun__WebSocketClient__remoteAddress, c)
pub fn bun__websocketclient__remote_address(
    this: &crate::websocket_client::WebSocketClient,
    address: &mut bun_core::String,
    port: &mut u16,
    is_ipv6: &mut bool,
) -> bool {
    write_remote_address(this.remote_address(), address, port, is_ipv6)
}
// HOST_EXPORT(Bun__WebSocketClient__usSocket, c)
pub fn bun__websocketclient__us_socket(
    this: &crate::websocket_client::WebSocketClient,
) -> *mut bun_uws_sys::us_socket_t {
    this.us_socket().unwrap_or(core::ptr::null_mut())
}
// HOST_EXPORT(Bun__WebSocketClient__close, c)
pub fn bun__websocketclient__close(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    code: u16,
    reason: &[u8],
) {
    WebSocketClient::close(this, code, reason)
}
// HOST_EXPORT(Bun__WebSocketClient__finalize, c)
pub fn bun__websocketclient__finalize(this: ThisPtr<crate::websocket_client::WebSocketClient>) {
    WebSocketClient::finalize(this)
}
// HOST_EXPORT(Bun__WebSocketClient__init, c)
pub fn bun__websocketclient__init(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    input_socket: *mut bun_uws_sys::us_socket_t,
    global_this: &JSGlobalObject,
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    secure: Option<bun_boringssl::c::OwnedSslCtx>,
    verified_hostname: &[u8],
    options: &crate::websocket_client::ConnectedOptions,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init(
        outgoing,
        input_socket,
        global_this,
        buffered_data,
        deflate_params,
        secure,
        verified_hostname,
        options,
    )
}
// HOST_EXPORT(Bun__WebSocketClient__deliverInitialData, c)
pub fn bun__websocketclient__deliver_initial_data(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
) {
    WebSocketClient::deliver_initial_data(this)
}
// HOST_EXPORT(Bun__WebSocketClient__initWithTunnel, c)
pub fn bun__websocketclient__init_with_tunnel(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    tunnel: ThisPtr<crate::websocket_client::websocket_proxy_tunnel::WebSocketProxyTunnel>,
    global_this: &JSGlobalObject,
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    options: &crate::websocket_client::ConnectedOptions,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init_with_tunnel(
        outgoing,
        tunnel,
        global_this,
        buffered_data,
        deflate_params,
        options,
    )
}
// HOST_EXPORT(Bun__WebSocketClient__initOverStream, c)
pub fn bun__websocketclient__init_over_stream(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    global_this: &JSGlobalObject,
    options: &crate::websocket_client::ConnectedOptions,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init_over_stream(outgoing, global_this, options, deflate_params)
}
// HOST_EXPORT(Bun__WebSocketClient__feed, c)
pub fn bun__websocketclient__feed(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    bytes: &[u8],
) {
    WebSocketClient::feed(this, bytes)
}
// HOST_EXPORT(Bun__WebSocketClient__streamClosed, c)
pub fn bun__websocketclient__stream_closed(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
) {
    WebSocketClient::stream_closed(this)
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
    flags: u8,
) {
    WebSocketClient::write_binary_data(this, bytes, op, flags)
}
// HOST_EXPORT(Bun__WebSocketClient__writeString, c)
pub fn bun__websocketclient__write_string(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    str_: &bun_core::EncodedSlice,
    op: u8,
    flags: u8,
) {
    WebSocketClient::write_string(this, str_, op, flags)
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
// HOST_EXPORT(Bun__WebSocketClientTLS__setRef, c)
pub fn bun__websocketclienttls__set_ref(
    this: &crate::websocket_client::WebSocketClientTLS,
    keep_alive: bool,
) {
    this.set_ref(keep_alive)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__remoteAddress, c)
pub fn bun__websocketclienttls__remote_address(
    this: &crate::websocket_client::WebSocketClientTLS,
    address: &mut bun_core::String,
    port: &mut u16,
    is_ipv6: &mut bool,
) -> bool {
    write_remote_address(this.remote_address(), address, port, is_ipv6)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__usSocket, c)
pub fn bun__websocketclienttls__us_socket(
    this: &crate::websocket_client::WebSocketClientTLS,
) -> *mut bun_uws_sys::us_socket_t {
    this.us_socket().unwrap_or(core::ptr::null_mut())
}
// HOST_EXPORT(Bun__WebSocketClientTLS__close, c)
pub fn bun__websocketclienttls__close(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
    code: u16,
    reason: &[u8],
) {
    WebSocketClientTLS::close(this, code, reason)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__finalize, c)
pub fn bun__websocketclienttls__finalize(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
) {
    WebSocketClientTLS::finalize(this)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__init, c)
pub fn bun__websocketclienttls__init(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    input_socket: *mut bun_uws_sys::us_socket_t,
    global_this: &JSGlobalObject,
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    secure: Option<bun_boringssl::c::OwnedSslCtx>,
    verified_hostname: &[u8],
    options: &crate::websocket_client::ConnectedOptions,
) -> *mut crate::websocket_client::WebSocketClientTLS {
    WebSocketClientTLS::init(
        outgoing,
        input_socket,
        global_this,
        buffered_data,
        deflate_params,
        secure,
        verified_hostname,
        options,
    )
}
// HOST_EXPORT(Bun__WebSocketClientTLS__deliverInitialData, c)
pub fn bun__websocketclienttls__deliver_initial_data(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
) {
    WebSocketClientTLS::deliver_initial_data(this)
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
    flags: u8,
) {
    WebSocketClientTLS::write_binary_data(this, bytes, op, flags)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__writeString, c)
pub fn bun__websocketclienttls__write_string(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
    str_: &bun_core::EncodedSlice,
    op: u8,
    flags: u8,
) {
    WebSocketClientTLS::write_string(this, str_, op, flags)
}

// ──────────────────────────────────────────────────────────────────────────
// InitialData
// ──────────────────────────────────────────────────────────────────────────

/// Bytes the upgrade client read past the end of the handshake response; boxed
/// so they cross C++ (`WebSocket::didConnect*`) as one opaque pointer.
pub struct InitialData(pub Vec<u8>);

// ──────────────────────────────────────────────────────────────────────────
// ErrorCode
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ErrorCode {
    Cancel,
    InvalidResponse,
    Expected101StatusCode,
    MissingUpgradeHeader,
    MissingConnectionHeader,
    MissingWebsocketAcceptHeader,
    InvalidUpgradeHeader,
    InvalidConnectionHeader,
    InvalidWebsocketVersion,
    MismatchWebsocketAcceptHeader,
    MissingClientProtocol,
    MismatchClientProtocol,
    Timeout,
    FailedToWrite,
    FailedToConnect,
    Ended,
    FailedToAllocateMemory,
    ControlFrameIsFragmented,
    InvalidControlFrame,
    InvalidCompressedData,
    UnexpectedMaskFromServer,
    UnsupportedControlFrame,
    UnexpectedOpcode,
    InvalidUtf8,
    TlsHandshakeFailed,
    MessageTooBig,
    // Proxy error codes
    ProxyConnectFailed,
    ProxyAuthenticationRequired,
    ProxyTunnelFailed,
    UnexpectedRsv1,
    InvalidCloseCode,
    UnexpectedRsv2Or3,
    UnsupportedExtension,
    ResponseHeadersTooLarge,
    ExpectedMask,
    UnsupportedPayloadLength,
}

pub(crate) struct ErrorInfo {
    /// Appended to "WebSocket connection to '<url>' failed: " to make `error.message`.
    pub message: &'static str,
    /// Default `error.code`. Empty means none.
    pub code: &'static str,
    /// Close code to send to the peer when this error fails an open connection.
    /// `None` means drop the connection without a Close frame.
    pub close_code: Option<u16>,
}

impl ErrorCode {
    /// Every `code` with a `close_code` needs an entry in `receiverErrors` (src/js/thirdparty/ws.ts),
    /// which replaces the error with npm ws's.
    #[rustfmt::skip]
    pub(crate) const fn info(self) -> ErrorInfo {
        let (message, code, close_code) = match self {
            Self::Cancel                        => ("Connection cancelled",                         "",                                       None),
            Self::InvalidResponse               => ("Invalid response",                             "HPE_INVALID_CONSTANT",                   None),
            Self::Expected101StatusCode         => ("Expected 101 status code",                     "",                                       None),
            Self::MissingUpgradeHeader          => ("Missing upgrade header",                       "",                                       None),
            Self::MissingConnectionHeader       => ("Missing connection header",                    "",                                       None),
            Self::MissingWebsocketAcceptHeader  => ("Missing websocket accept header",              "",                                       None),
            Self::InvalidUpgradeHeader          => ("Invalid upgrade header",                       "",                                       None),
            Self::InvalidConnectionHeader       => ("Invalid connection header",                    "",                                       None),
            Self::InvalidWebsocketVersion       => ("Invalid websocket version",                    "",                                       None),
            Self::MismatchWebsocketAcceptHeader => ("Mismatch websocket accept header",             "",                                       None),
            Self::MissingClientProtocol         => ("Missing client protocol",                      "",                                       None),
            Self::MismatchClientProtocol        => ("Mismatch client protocol",                     "",                                       None),
            Self::Timeout                       => ("Timeout",                                      "",                                       None),
            Self::FailedToWrite                 => ("Failed to write",                              "",                                       None),
            Self::FailedToConnect               => ("Failed to connect",                            "",                                       None),
            Self::Ended                         => ("Connection ended",                             "ECONNRESET",                             None),
            Self::FailedToAllocateMemory        => ("Failed to allocate memory",                    "",                                       None),
            Self::ControlFrameIsFragmented      => ("Protocol error - control frame is fragmented", "WS_ERR_EXPECTED_FIN",                    Some(1002)),
            Self::InvalidControlFrame           => ("Protocol error - invalid control frame",       "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH",  Some(1002)),
            Self::InvalidCompressedData         => ("Invalid compressed data",                      "Z_DATA_ERROR",                           Some(1007)),
            Self::UnexpectedMaskFromServer      => ("Protocol error - unexpected mask from server", "WS_ERR_UNEXPECTED_MASK",                 Some(1002)),
            Self::UnsupportedControlFrame       => ("Protocol error - unsupported control frame",   "WS_ERR_INVALID_OPCODE",                  Some(1002)),
            Self::UnexpectedOpcode              => ("Protocol error - unexpected opcode",           "WS_ERR_INVALID_OPCODE",                  Some(1002)),
            Self::InvalidUtf8                   => ("Server sent invalid UTF8",                     "WS_ERR_INVALID_UTF8",                    Some(1007)),
            Self::TlsHandshakeFailed            => ("TLS handshake failed",                         "",                                       None),
            Self::MessageTooBig                 => ("Message too big",                              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",      Some(1009)),
            Self::ProxyConnectFailed            => ("Proxy connection failed",                      "",                                       None),
            Self::ProxyAuthenticationRequired   => ("Proxy authentication required",                "",                                       None),
            Self::ProxyTunnelFailed             => ("Proxy tunnel failed",                          "",                                       None),
            Self::UnexpectedRsv1                => ("Protocol error - RSV1 must be clear",          "WS_ERR_UNEXPECTED_RSV_1",                Some(1002)),
            Self::InvalidCloseCode              => ("Protocol error - invalid close code",          "WS_ERR_INVALID_CLOSE_CODE",              Some(1002)),
            Self::UnexpectedRsv2Or3             => ("Protocol error - RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3",              Some(1002)),
            Self::UnsupportedExtension          => ("Unsupported websocket extension",              "",                                       None),
            Self::ResponseHeadersTooLarge       => ("Response headers too large",                   "",                                       None),
            Self::ExpectedMask                  => ("Protocol error - expected mask from client",   "WS_ERR_EXPECTED_MASK",                   Some(1002)),
            Self::UnsupportedPayloadLength      => ("Payload length over 2^53 - 1",                 "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH", Some(1009)),
        };
        ErrorInfo { message, code, close_code }
    }
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
    NeedBody,
    ExtendedPayloadLength16,
    ExtendedPayloadLength64,
    Ping,
    Pong,
    Close,
    /// Server only.
    MaskKey,
    /// Server only.
    MaskedBody,
    /// Reading has stopped. See `stop_reading`.
    Closed,
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

fn parse_websocket_header(bytes: [u8; 2], is_server: bool) -> Result<ParsedHeader, ErrorCode> {
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

    // rsv2 and rsv3 must always be 0 per RFC 6455 (rsv1 is checked by the caller).
    if header.rsv() != 0 {
        return Err(ErrorCode::UnexpectedRsv2Or3);
    }

    // RFC 6455 §5.1: a client must mask every frame, a server must not mask any.
    if header.mask() != is_server {
        return Err(if is_server {
            ErrorCode::ExpectedMask
        } else {
            ErrorCode::UnexpectedMaskFromServer
        });
    }

    let next = match opcode {
        Opcode::Text | Opcode::Continue | Opcode::Binary => match payload_len {
            0..=125 => ReceiveState::NeedBody,
            126 => ReceiveState::ExtendedPayloadLength16,
            _ => ReceiveState::ExtendedPayloadLength64,
        },
        Opcode::Close => ReceiveState::Close,
        Opcode::Ping => ReceiveState::Ping,
        Opcode::Pong => ReceiveState::Pong,
        _ => return Err(ErrorCode::UnsupportedControlFrame),
    };
    Ok(ParsedHeader {
        opcode,
        payload_len,
        is_fragmented: opcode == Opcode::Continue || !header.final_(),
        is_final: header.final_(),
        compressed: header.compressed(),
        next,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Copy
// ──────────────────────────────────────────────────────────────────────────

/// An outgoing payload in its source encoding, framed and masked by [`Copy::copy`].
#[derive(Copy, Clone)]
enum Copy<'a> {
    Utf16(&'a [u16]),
    Latin1(&'a [u8]),
    Bytes(&'a [u8]),
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum Deflate {
    Never,
    /// Only if the payload is at least `MIN_COMPRESS_SIZE` bytes.
    IfLargeEnough,
    Always,
}

/// Header fields and compression mode of one outgoing frame.
#[derive(Copy, Clone)]
struct FrameKind {
    opcode: Opcode,
    fin: bool,
    deflate: Deflate,
    /// True for a client, false for a server.
    masked: bool,
}

impl FrameKind {
    /// `flags`: bit 0 = FIN, bit 1 = compress if large enough, bit 2 = always compress.
    /// Fragmented messages are never compressed.
    fn from_ffi(op: u8, flags: u8, masked: bool) -> Self {
        let opcode = Opcode::from_raw(op & 0x0F);
        let fin = flags & 0b001 != 0;
        let deflate = if !fin || !matches!(opcode, Opcode::Text | Opcode::Binary) {
            Deflate::Never
        } else if flags & 0b100 != 0 {
            Deflate::Always
        } else if flags & 0b010 != 0 {
            Deflate::IfLargeEnough
        } else {
            Deflate::Never
        };
        Self {
            opcode,
            fin,
            deflate,
            masked,
        }
    }
}

/// Disjoint header / masking-key / payload views of one outbound frame.
struct FrameParts<'a> {
    header: &'a mut [u8],
    mask: Option<&'a mut [u8; 4]>,
    payload: &'a mut [u8],
}

/// Split a frame-sized `buf` into its [`FrameParts`], writing the extended length bytes.
fn split_frame(buf: &mut [u8], content_byte_len: usize, masked: bool) -> FrameParts<'_> {
    let length_byte_count = WebsocketHeader::length_byte_count(content_byte_len);
    debug_assert_eq!(
        WebsocketHeader::frame_size(content_byte_len, masked),
        buf.len()
    );
    match length_byte_count {
        0 => {}
        2 => buf[2..4].copy_from_slice(&(content_byte_len as u16).to_be_bytes()),
        8 => buf[2..10].copy_from_slice(&(content_byte_len as u64).to_be_bytes()),
        _ => unreachable!(),
    }
    let (header, rest) = buf.split_at_mut(2 + length_byte_count);
    let (mask, payload) = if masked {
        let (mask, payload) = rest.split_at_mut(4);
        (
            Some(mask.try_into().expect("infallible: size matches")),
            payload,
        )
    } else {
        (None, rest)
    };
    FrameParts {
        header,
        mask,
        payload: &mut payload[..content_byte_len],
    }
}

impl Copy<'_> {
    /// Returns `(frame_len, content_byte_len)`: the size of the full frame to
    /// write out and the UTF-8/byte length of the payload it carries.
    fn frame_and_content_len(&self, masked: bool) -> (usize, usize) {
        let byte_len = match self {
            Copy::Utf16(utf16) => strings::element_length_utf16_into_utf8(utf16),
            Copy::Latin1(latin1) => strings::element_length_latin1_into_utf8(latin1),
            Copy::Bytes(bytes) => bytes.len(),
        };
        (WebsocketHeader::frame_size(byte_len, masked), byte_len)
    }

    fn copy(
        &self,
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        content_byte_len: usize,
        kind: FrameKind,
    ) {
        self.copy_with_rsv1(global_this, buf, content_byte_len, kind, false);
    }

    /// Frame an already-deflated message.
    fn copy_compressed(
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        compressed_data: &[u8],
        kind: FrameKind,
    ) {
        Copy::Bytes(compressed_data).copy_with_rsv1(
            global_this,
            buf,
            compressed_data.len(),
            kind,
            true,
        );
    }

    fn copy_with_rsv1(
        &self,
        global_this: &JSGlobalObject,
        buf: &mut [u8],
        content_byte_len: usize,
        kind: FrameKind,
        compressed: bool,
    ) {
        let mut header = WebsocketHeader::new(
            WebsocketHeader::pack_length(content_byte_len),
            kind.masked,
            kind.opcode,
        );
        header.set_final(kind.fin);
        header.set_compressed(compressed);

        let mut parts = split_frame(buf, content_byte_len, kind.masked);
        header
            .write_header(&mut parts.header, content_byte_len)
            .expect("unreachable");

        match self {
            Copy::Utf16(utf16) => {
                let encoded = strings::copy_utf16_into_utf8_impl::<true>(parts.payload, utf16);
                debug_assert_eq!(encoded.written, content_byte_len);
                debug_assert_eq!(encoded.read, utf16.len());
            }
            Copy::Latin1(latin1) => {
                let encoded = strings::copy_latin1_into_utf8(parts.payload, latin1);
                debug_assert_eq!(encoded.written, content_byte_len);
                // latin1 can contain non-ascii
                debug_assert_eq!(encoded.read, latin1.len());
            }
            Copy::Bytes(bytes) => {
                match parts.mask {
                    Some(mask) => Mask::fill(global_this, mask, parts.payload, bytes),
                    None => parts.payload.copy_from_slice(bytes),
                }
                return;
            }
        }
        if let Some(mask) = parts.mask {
            Mask::fill_in_place(global_this, mask, parts.payload);
        }
    }
}
