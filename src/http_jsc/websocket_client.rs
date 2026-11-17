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
use std::borrow::Cow;

use bun_boringssl::c::OwnedSslCtx;
use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_http_types::websocket::{
    Event, Header, Input, MAX_CONTROL_FRAME_SIZE, Opcode, ProtocolError, Reader, ReaderOptions,
    close_payload,
};
use bun_io::KeepAlive;
use bun_jsc as jsc;
use bun_jsc::virtual_machine::VirtualMachine;
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

impl ConnectedOptions {
    fn max_payload_length(&self) -> usize {
        match self.max_payload_length {
            0 => usize::MAX,
            max => max,
        }
    }
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
#[derive(Clone, Copy)]
enum Outcome {
    /// Closed by the peer, the close timeout or `terminate()`.
    Closed,
    /// We failed the connection (RFC 6455 §7.1.7) and won't wait for the peer.
    Failed(ErrorCode),
}

/// How far our half of the closing handshake got.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SendState {
    Open,
    /// We wrote or queued our Close frame. No frame may follow it (RFC 6455 §5.5.1).
    CloseSent,
    /// We flushed it, stopped reading and half-closed the connection.
    FinSent,
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

    reader: JsCell<Reader>,
    send_state: Cell<SendState>,
    /// Code and reason from the peer's Close frame, reported by the `close` event (RFC 6455 §7.1.5).
    close_received: Cell<Option<(u16, BunString)>>,

    pub(crate) send_buffer: RefCell<LinearFifo<u8, DynamicBuffer<u8>>>,

    pub(crate) poll_ref: KeepAlive,

    /// Bytes not parsed yet. Either bytes that arrived with the 101, held until after `open`
    /// (or until `resume()` if an `open` listener paused the socket), or bytes from a
    /// re-entrant `feed`, held until the outer `feed` finishes.
    initial_data: Cell<Option<Box<InitialData>>>,
    /// A `feed` call is on the stack.
    parsing: Cell<bool>,
    options: ConnectedOptions,
    pub(crate) deflate: RefCell<Option<Box<WebSocketDeflate>>>,

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

    pub(crate) fn clear_data(&self) {
        log!("clearData");
        self.poll_ref.unref(VirtualMachine::get().loop_ctx());
        self.stop_reading();
        self.send_buffer
            .replace(LinearFifo::<u8, DynamicBuffer<u8>>::init());
        self.initial_data.set(None);
        self.deflate.replace(None);
        drop(self.secure.take());
        // Detach the tunnel first so its shutdown callbacks cannot re-enter this path.
        if let Transport::Tunnel(tunnel) = self.transport.replace(Transport::Socket) {
            tunnel.clear_connected_web_socket();
            WebSocketProxyTunnel::shutdown(&tunnel);
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
            Outcome::Failed(code) => {
                ws.did_fail(code, buffered_amount, BunString::EMPTY, code.detail());
            }
            Outcome::Closed => {
                let was_clean = received.is_some() && self.send_state.get() == SendState::FinSent;
                let (code, reason) = received.unwrap_or((1006, BunString::EMPTY));
                ws.did_close(code, reason, was_clean, buffered_amount);
            }
        }
    }

    fn stop_reading(&self) {
        self.reader.with_mut(Reader::stop);
    }

    /// Fail the connection (RFC 6455 §7.1.7): send a best-effort Close frame with the reason and
    /// don't wait for a reply. In `ws_mode`, emit `error` now and `close` once the connection
    /// actually closes, same as after a normal closing handshake.
    fn fail(&self, code: ErrorCode) {
        let Some(ws) = self.cpp_websocket() else {
            return;
        };
        log!("fail ({:?})", code);
        let Some(close_code) = code.info().close_code else {
            return self.finish(Outcome::Failed(code));
        };
        self.send_close(close_code, &[]);
        if !self.options.ws_mode {
            return self.finish(Outcome::Failed(code));
        }
        self.stop_reading();
        ws.did_error(code, code.detail());
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

    fn dispatch_compressed_data(&self, data: &[u8], kind: Opcode) {
        let rare = VirtualMachine::get().rare_data();
        let mut decompressed = rare.take_websocket_inflate_scratch();
        let result = match self.deflate.borrow_mut().as_mut() {
            None => Err(ProtocolError::UnexpectedRsv1.into()),
            Some(deflate) => deflate
                .decompress(
                    rare.libdeflate_decompressor(),
                    data,
                    &mut decompressed,
                    self.options.max_payload_length(),
                )
                .map_err(|err| match err {
                    websocket_deflate::Error::InflateFailed => {
                        ProtocolError::InvalidCompressedData.into()
                    }
                    websocket_deflate::Error::TooLarge => ProtocolError::MessageTooBig.into(),
                    websocket_deflate::Error::OutOfMemory => ErrorCode::FailedToAllocateMemory,
                }),
        };

        // The deflate borrow is released: both arms can re-enter `clear_data`.
        match result {
            Ok(()) => self.dispatch_data(&decompressed, kind),
            Err(code) => self.fail(code),
        }

        rare.put_back_websocket_inflate_scratch(decompressed);
    }

    /// Data will be cloned in C++.
    fn dispatch_data(&self, data: &[u8], kind: Opcode) {
        let Some(out) = self.cpp_websocket() else {
            return;
        };

        match kind {
            Opcode::Text if !self.options.ws_mode => {
                // this function encodes to UTF-16 if > 127
                // so we don't need to worry about latin1 non-ascii code points
                // we avoid trim since we wanna keep the utf8 validation intact
                let utf16_bytes = match strings::to_utf16_alloc(data, true, false) {
                    Ok(v) => v,
                    Err(strings::ToUTF16Error::InvalidByteSequence) => {
                        self.fail(ProtocolError::InvalidUtf8.into());
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
            Opcode::Text if !self.accepts_utf8(data) => {
                self.fail(ProtocolError::InvalidUtf8.into());
            }
            _ => {
                jsc::mark_binding!();
                out.did_receive_bytes(data, kind as u8);
            }
        }
    }

    fn accepts_utf8(&self, bytes: &[u8]) -> bool {
        self.options.skip_utf8_validation || strings::is_valid_utf8(bytes)
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

    /// A listener can run the event loop and get here again: the reader is past the event, but not past the rest of `data`.
    fn handle_data_loop(&self, data: &[u8]) {
        log!("onData ({} bytes)", data.len());
        let mut input = Input::new(data);
        while let Some(event) = self.reader.with_mut(|reader| reader.next(&mut input)) {
            match event {
                Ok(Event::Message(message, payload)) => {
                    if message.compressed {
                        self.dispatch_compressed_data(&payload, message.opcode);
                    } else {
                        self.dispatch_data(&payload, message.opcode);
                    }
                    self.reader.with_mut(|reader| reader.recycle(payload));
                }
                Ok(Event::Ping(payload)) => {
                    // Before `ping`: a listener can call close(), and no Pong may follow the Close frame.
                    if self.options.auto_pong
                        && self.buffered_amount() <= AUTO_PONG_BACKPRESSURE_LIMIT
                        && self.can_send()
                    {
                        self.send_control_frame(Opcode::Pong, payload);
                    }
                    self.dispatch_data(payload, Opcode::Ping);
                }
                Ok(Event::Pong(payload)) => self.dispatch_data(payload, Opcode::Pong),
                Ok(Event::Close(code, reason)) => self.recv_close(code, reason),
                Err(error) => self.fail(error.into()),
            }
        }
    }

    /// Record the peer's Close frame and echo it, unless we already sent ours.
    fn recv_close(&self, code: u16, reason: &[u8]) {
        if !self.accepts_utf8(reason) {
            return self.fail(ProtocolError::InvalidUtf8.into());
        }
        let text = BunString::clone_utf8(reason);
        self.close_received.set(Some((code, text.clone())));
        self.send_close(code, reason);
        if let Some(ws) = self.cpp_websocket() {
            ws.did_start_closing_handshake(code, text);
        }
        self.send_fin_if_done();
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

    /// `None` if deflate wasn't negotiated or failed: the message goes out as it is.
    fn compress(&self, source: Source<'_>, len: usize) -> Option<Vec<u8>> {
        let mut deflate = self.deflate.borrow_mut();
        let deflate = deflate.as_mut()?;
        let utf8 = match source {
            Source::Utf16(utf16) => Cow::Owned(strings::to_utf8_alloc(utf16)),
            Source::Latin1(latin1) if latin1.len() != len => Cow::Owned(bun_core::handle_oom(
                strings::allocate_latin1_into_utf8(latin1),
            )),
            Source::Latin1(bytes) | Source::Bytes(bytes) => Cow::Borrowed(bytes),
        };
        let mut compressed = Vec::new();
        deflate.compress(&utf8, &mut compressed).ok()?;
        Some(compressed)
    }

    fn header(&self, opcode: Opcode, fin: bool, len: usize) -> Header {
        Header {
            opcode,
            fin,
            compressed: false,
            len,
            key: (!self.options.is_server).then(|| VirtualMachine::get().rare_data().entropy()),
        }
    }

    /// `flags`: bit 0 = FIN, bit 1 = compress if large enough, bit 2 = always compress.
    fn send(this: ThisPtr<Self>, source: Source<'_>, op: u8, flags: u8) {
        // A write to the tunnel can fire onClose → finish() and release the refs on `this`.
        let _guard = RefPtr::from_this(this);

        if !this.can_send() {
            return;
        }
        let Some(opcode) = Opcode::from_u8(op) else {
            return;
        };
        let mut header = this.header(opcode, flags & 0b001 != 0, source.utf8_len());
        // Fragmented messages are never compressed.
        let may_compress = header.fin && matches!(opcode, Opcode::Text | Opcode::Binary);
        let must_compress = may_compress && flags & 0b100 != 0;
        let idle = !this.has_backpressure();

        let frame_size = header.frame_size();
        let is_small = match source {
            Source::Utf16(utf16) => utf16.len() * 4 < STACK_FRAME_SIZE,
            Source::Latin1(_) | Source::Bytes(_) => frame_size < STACK_FRAME_SIZE,
        };
        if is_small && idle && !must_compress {
            let mut frame = [0u8; STACK_FRAME_SIZE];
            let frame = &mut frame[..frame_size];
            source.encode(header, frame);
            return this.enqueue_encoded_bytes(frame);
        }

        let compressed = (must_compress
            || (may_compress && flags & 0b010 != 0 && header.len >= MIN_COMPRESS_SIZE))
            .then(|| this.compress(source, header.len))
            .flatten();
        let source = match &compressed {
            Some(compressed) => {
                header.compressed = true;
                header.len = compressed.len();
                Source::Bytes(compressed)
            }
            None => source,
        };
        {
            let frame_size = header.frame_size();
            let mut send_buffer = this.send_buffer.borrow_mut();
            let frame = bun_core::handle_oom(send_buffer.writable_with_size(frame_size));
            source.encode(header, frame);
            send_buffer.update(frame_size);
        }

        if idle {
            this.debug_assert_socket_writable();
            this.send_buffer_out();
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

    /// Send our Close frame, after anything already queued. Its payload is the status code
    /// plus reason, or empty. The connection then has `close_timeout_seconds` to close.
    /// In `ws_mode`, `ws` runs its own timer that calls `terminate()`, and a paused socket
    /// stays paused.
    fn send_close(&self, code: u16, reason: &[u8]) {
        if !self.can_send() {
            return;
        }
        log!("Sending close ({})", code);
        self.send_state.set(SendState::CloseSent);
        if !self.options.ws_mode {
            // Resume reading, or we'd never see the peer's Close frame or FIN.
            self.resume();
            self.arm_close_timeout();
        }
        self.send_control_frame(Opcode::Close, &close_payload(code, reason));
    }

    fn arm_close_timeout(&self) {
        match self.io() {
            Io::Socket => self.tcp.get().set_timeout(close_timeout_seconds()),
            Io::Tunnel(tunnel) => tunnel.set_timeout(close_timeout_seconds()),
            Io::Stream => {}
        }
    }

    fn send_control_frame(&self, opcode: Opcode, payload: &[u8]) {
        let header = self.header(opcode, true, payload.len());
        let mut frame = [0u8; MAX_CONTROL_FRAME_SIZE];
        let frame = &mut frame[..header.frame_size()];
        header.encode(frame, payload);
        self.enqueue_encoded_bytes(frame);
    }

    /// Once our Close frame is flushed and we've stopped reading, half-close and wait for the
    /// peer to close the connection (RFC 6455 §7.1.1). `finish` runs when it does.
    fn send_fin_if_done(&self) {
        if self.send_state.get() != SendState::CloseSent
            || self.has_backpressure()
            || !self.reader.get().is_stopped()
        {
            return;
        }
        self.send_state.set(SendState::FinSent);
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
        if self.send_state.get() != SendState::Open
            && !self.options.ws_mode
            && self.has_backpressure()
        {
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
        let ctx = VirtualMachine::get().loop_ctx();
        if keep_alive {
            self.poll_ref.r#ref(ctx);
        } else {
            self.poll_ref.unref(ctx);
        }
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
        self.send_state.get() == SendState::Open && self.has_tcp()
    }

    /// `code` 1005 ("no status received") sends a Close frame with an empty payload.
    /// `reason` is UTF-8. It's left out if it doesn't fit, but C++ already rejects those.
    pub(crate) fn close(this: ThisPtr<Self>, code: u16, reason: &[u8]) {
        // See send() — tunnel.write() can re-enter finish().
        let _guard = RefPtr::from_this(this);
        this.send_close(code, reason);
    }

    /// Allocate a client with `ref_count == 1` (the I/O-layer ref, released by
    /// `handle_close` for adopted sockets and by `clear_data` in tunnel mode)
    /// and an optional permessage-deflate context.
    fn new_raw(
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
            reader: JsCell::new(Reader::new(ReaderOptions {
                masked: options.is_server,
                deflate: deflate_params.is_some(),
                max_payload: options.max_payload_length(),
            })),
            send_state: Cell::new(SendState::Open),
            close_received: Cell::new(None),
            send_buffer: RefCell::new(LinearFifo::<u8, DynamicBuffer<u8>>::init()),
            poll_ref: KeepAlive::init(),
            initial_data: Cell::new(None),
            parsing: Cell::new(false),
            options: *options,
            deflate: RefCell::new(
                deflate_params.map(|params| WebSocketDeflate::init(*params, options.is_server)),
            ),
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
        buffered_data: Option<Box<InitialData>>,
    ) -> *mut Self {
        let ws = io_ref.this_ptr();
        // C++ holds the returned pointer as `m_connectedWebSocket`.
        ws.outgoing_websocket
            .set(Some((BackRef::new(outgoing), io_ref.clone())));
        ws.io_ref.set(Some(io_ref));
        bun_core::handle_oom(ws.send_buffer.borrow_mut().ensure_total_capacity(2048));
        ws.reader.with_mut(|reader| reader.reserve(2048));
        ws.poll_ref.r#ref(VirtualMachine::get().loop_ctx());

        ws.initial_data
            .set(buffered_data.filter(|b| !b.0.is_empty()));

        ws.as_ptr()
    }

    pub(crate) fn init(
        outgoing: &CppWebSocket,
        input_socket: *mut us_socket_t,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        verified_hostname: &[u8],
        options: &ConnectedOptions,
    ) -> *mut Self {
        let ws = Self::new_raw(
            deflate_params,
            secure,
            verified_hostname,
            Transport::Socket,
            options,
        );
        let this = ws.this_ptr();

        // `adopt_group` takes a closure to write the new socket.
        let loop_ = VirtualMachine::get().uws_loop();
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

        Self::finish_init(ws, outgoing, buffered_data)
    }

    /// Initialize a WebSocket client that uses a proxy tunnel for I/O.
    /// Used for wss:// through HTTP proxy where TLS is handled by the tunnel.
    /// The tunnel takes ownership of socket I/O, and this client reads/writes through it.
    pub(crate) fn init_with_tunnel(
        outgoing: &CppWebSocket,
        tunnel: ThisPtr<WebSocketProxyTunnel>,
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
            deflate_params,
            None,
            &[],
            Transport::Tunnel(RefPtr::from_this(tunnel)),
            options,
        );

        Self::finish_init(ws, outgoing, buffered_data)
    }

    /// Create a client (or the server side, with `options.is_server`) that reads and writes
    /// through a JS stream. The stream keeps the process alive, so this takes no keep-alive ref.
    pub(crate) fn init_over_stream(
        outgoing: &CppWebSocket,
        options: &ConnectedOptions,
        deflate_params: Option<&websocket_deflate::Params>,
    ) -> *mut Self {
        let ws = Self::new_raw(deflate_params, None, &[], Transport::Stream, options);
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
        // (see send). The tunnel ref-guards itself in
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
        cost += self.reader.get().capacity();
        // This is under-estimated a little, as we don't include usockets context.
        cost
    }
}

impl<const SSL: bool> Drop for WebSocket<SSL> {
    fn drop(&mut self) {
        self.clear_data();
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
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    secure: Option<bun_boringssl::c::OwnedSslCtx>,
    verified_hostname: &[u8],
    options: &crate::websocket_client::ConnectedOptions,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init(
        outgoing,
        input_socket,
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
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    options: &crate::websocket_client::ConnectedOptions,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init_with_tunnel(outgoing, tunnel, buffered_data, deflate_params, options)
}
// HOST_EXPORT(Bun__WebSocketClient__initOverStream, c)
pub fn bun__websocketclient__init_over_stream(
    outgoing: &crate::websocket_client::cpp_websocket::CppWebSocket,
    options: &crate::websocket_client::ConnectedOptions,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
) -> *mut crate::websocket_client::WebSocketClient {
    WebSocketClient::init_over_stream(outgoing, options, deflate_params)
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
    WebSocketClient::send(this, Source::Bytes(bytes), op, flags)
}
// HOST_EXPORT(Bun__WebSocketClient__writeString, c)
pub fn bun__websocketclient__write_string(
    this: ThisPtr<crate::websocket_client::WebSocketClient>,
    str_: &bun_core::EncodedSlice,
    op: u8,
    flags: u8,
) {
    WebSocketClient::send(this, str_.into(), op, flags)
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
    buffered_data: Option<Box<crate::websocket_client::InitialData>>,
    deflate_params: Option<&crate::websocket_client::websocket_deflate::Params>,
    secure: Option<bun_boringssl::c::OwnedSslCtx>,
    verified_hostname: &[u8],
    options: &crate::websocket_client::ConnectedOptions,
) -> *mut crate::websocket_client::WebSocketClientTLS {
    WebSocketClientTLS::init(
        outgoing,
        input_socket,
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
    WebSocketClientTLS::send(this, Source::Bytes(bytes), op, flags)
}
// HOST_EXPORT(Bun__WebSocketClientTLS__writeString, c)
pub fn bun__websocketclienttls__write_string(
    this: ThisPtr<crate::websocket_client::WebSocketClientTLS>,
    str_: &bun_core::EncodedSlice,
    op: u8,
    flags: u8,
) {
    WebSocketClientTLS::send(this, str_.into(), op, flags)
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
    TlsHandshakeFailed,
    // Proxy error codes
    ProxyConnectFailed,
    ProxyAuthenticationRequired,
    ProxyTunnelFailed,
    UnsupportedExtension,
    ResponseHeadersTooLarge,
    Protocol(ProtocolError),
}

impl From<ProtocolError> for ErrorCode {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
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
        use {ErrorCode::Protocol, ProtocolError::*};
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
            Protocol(ControlFrameIsFragmented)  => ("Protocol error - control frame is fragmented", "WS_ERR_EXPECTED_FIN",                    Some(1002)),
            Protocol(InvalidControlLength(_))   => ("Protocol error - invalid control frame",       "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH",  Some(1002)),
            Protocol(InvalidCompressedData)     => ("Invalid compressed data",                      "Z_DATA_ERROR",                           Some(1007)),
            Protocol(UnexpectedMask)            => ("Protocol error - unexpected mask from server", "WS_ERR_UNEXPECTED_MASK",                 Some(1002)),
            Protocol(ReservedOpcode(_))         => ("Protocol error - unsupported control frame",   "WS_ERR_INVALID_OPCODE",                  Some(1002)),
            Protocol(UnexpectedOpcode(_))       => ("Protocol error - unexpected opcode",           "WS_ERR_INVALID_OPCODE",                  Some(1002)),
            Protocol(InvalidUtf8)               => ("Server sent invalid UTF8",                     "WS_ERR_INVALID_UTF8",                    Some(1007)),
            Self::TlsHandshakeFailed            => ("TLS handshake failed",                         "",                                       None),
            Protocol(MessageTooBig)             => ("Message too big",                              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",      Some(1009)),
            Self::ProxyConnectFailed            => ("Proxy connection failed",                      "",                                       None),
            Self::ProxyAuthenticationRequired   => ("Proxy authentication required",                "",                                       None),
            Self::ProxyTunnelFailed             => ("Proxy tunnel failed",                          "",                                       None),
            Protocol(UnexpectedRsv1)            => ("Protocol error - RSV1 must be clear",          "WS_ERR_UNEXPECTED_RSV_1",                Some(1002)),
            Protocol(InvalidCloseCode(_))       => ("Protocol error - invalid close code",          "WS_ERR_INVALID_CLOSE_CODE",              Some(1002)),
            Protocol(UnexpectedRsv2Or3)         => ("Protocol error - RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3",              Some(1002)),
            Self::UnsupportedExtension          => ("Unsupported websocket extension",              "",                                       None),
            Self::ResponseHeadersTooLarge       => ("Response headers too large",                   "",                                       None),
            Protocol(ExpectedMask)              => ("Protocol error - expected mask from client",   "WS_ERR_EXPECTED_MASK",                   Some(1002)),
            Protocol(UnsupportedPayloadLength)  => ("Payload length over 2^53 - 1",                 "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH", Some(1009)),
        };
        ErrorInfo { message, code, close_code }
    }

    /// The opcode, length or status code that was refused. It's appended to the error message.
    fn detail(self) -> BunString {
        use {ErrorCode::Protocol, ProtocolError::*};
        let value = match self {
            Protocol(ReservedOpcode(n) | UnexpectedOpcode(n) | InvalidControlLength(n)) => n.into(),
            Protocol(InvalidCloseCode(code)) => code,
            _ => return BunString::EMPTY,
        };
        BunString::create_format(format_args!("{value}"))
    }
}

/// An outgoing payload in its source encoding.
#[derive(Copy, Clone)]
enum Source<'a> {
    Utf16(&'a [u16]),
    Latin1(&'a [u8]),
    Bytes(&'a [u8]),
}

impl<'a> From<&EncodedSlice<'a>> for Source<'a> {
    fn from(string: &EncodedSlice<'a>) -> Self {
        if string.is_16bit() {
            Self::Utf16(string.utf16_slice())
        } else {
            Self::Latin1(string.slice())
        }
    }
}

impl Source<'_> {
    fn utf8_len(self) -> usize {
        match self {
            Self::Utf16(utf16) => strings::element_length_utf16_into_utf8(utf16),
            Self::Latin1(latin1) => strings::element_length_latin1_into_utf8(latin1),
            Self::Bytes(bytes) => bytes.len(),
        }
    }

    fn encode(self, header: Header, frame: &mut [u8]) {
        match self {
            Self::Utf16(utf16) => header.encode_with(frame, |payload| {
                let encoded = strings::copy_utf16_into_utf8_impl::<true>(payload, utf16);
                debug_assert_eq!((encoded.read, encoded.written), (utf16.len(), header.len));
            }),
            Self::Latin1(latin1) => header.encode_with(frame, |payload| {
                let encoded = strings::copy_latin1_into_utf8(payload, latin1);
                debug_assert_eq!((encoded.read, encoded.written), (latin1.len(), header.len));
            }),
            Self::Bytes(bytes) => header.encode(frame, bytes),
        }
    }
}
