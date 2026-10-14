//! This is the wrapper between Rust and C++ for WebSocket client functionality. It corresponds to the `WebCore::WebSocket` class (WebSocket.cpp).
//!
//! Each method in this interface ensures proper JavaScript event loop integration by entering
//! and exiting the event loop around C++ function calls, maintaining proper execution context.
//!
//! The external C++ functions are imported and wrapped with Rust functions that handle
//! the event loop management automatically.
//!
//! Note: This is specifically for WebSocket client implementations, not for server-side WebSockets.

use bun_boringssl as boringssl;
use bun_boringssl::c::OwnedSslCtx;
use bun_core::String as BunString;
use bun_core::ffi::FfiSlice;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{ContextId, JSGlobalObject, JSValue, JsResult, VirtualMachineRef};
use bun_ptr::{RefPtr, ThisPtr};
use bun_uws_sys::Socket;

use super::websocket_deflate;
use super::{ErrorCode, InitialData, WebSocket, WebSocketProxyTunnel};

bun_opaque::opaque_ffi! {
    /// Opaque handle to the C++ `WebCore::WebSocket` object.
    pub struct CppWebSocket;
}

/// Whose certificate a TLS handshake presented.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TlsPeer {
    /// The WebSocket server, reached directly or inside a proxy tunnel.
    Target,
    /// An HTTPS proxy. `tls.checkServerIdentity` is for the target only, as in fetch.
    Proxy,
}

/// Who decides whether a certificate whose chain verified names the server.
enum NameCheck {
    /// `rejectUnauthorized: false` and no callback.
    Nobody,
    BuiltIn,
    /// `tls.checkServerIdentity`. Without `enforce` it still runs, as in Node, and its verdict is dropped.
    Callback {
        callback: JSValue,
        enforce: bool,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum TlsHandshake {
    /// `tls.checkServerIdentity` runs in the context of the script that made the WebSocket.
    First { context: ContextId, peer: TlsPeer },
    /// On the connected client's socket. BoringSSL refuses a changed certificate here.
    Renegotiation,
}

/// Matches `WebCore::WebSocket::HandshakeRawHeader` (WebSocket.h).
#[repr(C)]
pub struct RawHeader<'a> {
    pub name: FfiSlice<'a>,
    pub value: FfiSlice<'a>,
}

// FFI surface for `WebCore::WebSocket` (src/jsc/bindings/webcore/WebSocket.cpp).
// Kept private to this module — the safe wrappers below are the only callers.
//
// `CppWebSocket` is an UnsafeCell-backed opaque ZST, so `&CppWebSocket` carries
// no `readonly`/`noalias` — the C++ side owns and mutates all state behind it.
// Imports whose only non-value param is that handle are declared `safe fn`.
unsafe extern "C" {
    // `buffered_data` / `secure` / `tunnel` are opaque to C++ (forwarded back
    // into Rust untouched), so their Rust-only layouts are fine here.
    #[allow(improper_ctypes)]
    safe fn WebSocket__didConnect(
        websocket_context: &CppWebSocket,
        socket: &mut Socket,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        verified_hostname: FfiSlice<'_>,
    ) -> *mut core::ffi::c_void;
    #[allow(improper_ctypes)]
    safe fn WebSocket__didConnectWithTunnel(
        websocket_context: &CppWebSocket,
        tunnel: ThisPtr<WebSocketProxyTunnel>,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
    ) -> *mut core::ffi::c_void;
    safe fn WebSocket__didFail(
        websocket_context: &CppWebSocket,
        reason: ErrorCode,
        buffered_amount: usize,
        system_code: BunString,
        detail: BunString,
    );
    safe fn WebSocket__didReceiveHandshakeResponse(
        websocket_context: &CppWebSocket,
        status_code: u16,
        status_message: FfiSlice<'_>,
        headers: FfiSlice<'_, RawHeader<'_>>,
        body: FfiSlice<'_>,
    );
    safe fn WebSocket__readsResponseBody(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__didReceiveResponseBody(
        websocket_context: &CppWebSocket,
        chunk: FfiSlice<'_>,
        ended: bool,
    );
    safe fn WebSocket__didClose(
        websocket_context: &CppWebSocket,
        code: u16,
        reason: BunString,
        was_clean: bool,
        buffered_amount: usize,
    );
    safe fn WebSocket__didStartClosingHandshake(websocket_context: &CppWebSocket);
    safe fn WebSocket__didReceiveText(websocket_context: &CppWebSocket, text: BunString);
    safe fn WebSocket__didReceiveBytes(
        websocket_context: &CppWebSocket,
        bytes: FfiSlice<'_>,
        opcode: u8,
    );
    safe fn WebSocket__didDrain(websocket_context: &CppWebSocket);
    safe fn WebSocket__streamWrite(websocket_context: &CppWebSocket, bytes: FfiSlice<'_>);
    safe fn WebSocket__streamEnd(websocket_context: &CppWebSocket);
    safe fn WebSocket__streamDestroy(websocket_context: &CppWebSocket);
    safe fn WebSocket__isPaused(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__rejectUnauthorized(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__isProxyTLS(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__bunContext(websocket_context: &CppWebSocket) -> *const core::ffi::c_void;
    safe fn WebSocket__checkServerIdentity(websocket_context: &CppWebSocket) -> JSValue;
    safe fn WebSocket__setProtocol(websocket_context: &CppWebSocket, protocol: BunString);
    // Also declared in `bun_runtime::api::bun::x509`, which is above this crate.
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut boringssl::c::X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;
    safe fn SSL_total_renegotiations(ssl: &boringssl::c::SSL) -> core::ffi::c_int;
}

/// For an entry point that JS calls (a client over a JS stream has no other): the wrappers
/// below that `f` reaches are nested in the caller's frame, so what its listeners queue
/// (`process.nextTick`, promise reactions) waits until that frame has returned.
pub(crate) fn without_checkpoint(f: impl FnOnce()) {
    VirtualMachine::get().event_loop_mut().enter();
    f();
    VirtualMachine::get()
        .event_loop_mut()
        .exit_without_checkpoint();
}

// Receivers are `&self` (not `&mut self`) because `CppWebSocket` is
// an opaque C++ handle with no Rust-visible state; mutation happens entirely on
// the C++ side. Callers hold `NonNull<CppWebSocket>` and dispatch via shared
// borrows (often while `&mut WebSocket<SSL>` is also live), so `&mut self`
// would force needless `unsafe { &mut *ptr }` at every site.
impl CppWebSocket {
    /// The context of the script that made this WebSocket: its connection is that context's.
    pub(crate) fn context(&self) -> &bun_jsc::ScriptExecutionContext {
        // SAFETY: called while the WebSocket is connecting from its constructor, inside the context
        // that made it (alive while its script runs); every `WebCore::ScriptExecutionContext` has
        // its Rust half.
        unsafe { &*WebSocket__bunContext(self).cast::<bun_jsc::ScriptExecutionContext>() }
    }

    /// The client failed the connection: `error`, then `close` with 1006.
    /// `system_code` becomes `error.code`; `detail` is appended to the message.
    pub(crate) fn did_fail(
        &self,
        reason: ErrorCode,
        buffered_amount: usize,
        system_code: BunString,
        detail: BunString,
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didFail(self, reason, buffered_amount, system_code, detail);
        event_loop.exit();
    }

    /// Dispatch the native `'handshake'` event; C++ copies all slices synchronously.
    pub(crate) fn did_receive_handshake_response(
        &self,
        status_code: u16,
        status_message: &[u8],
        headers: &[RawHeader<'_>],
        body: &[u8],
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didReceiveHandshakeResponse(
            self,
            status_code,
            status_message.into(),
            headers.into(),
            body.into(),
        );
        event_loop.exit();
    }

    /// Whether a response that is not a 101 is read to its end (the `ws` module) or fails the
    /// connection at its head. A field read on the C++ side: no JS runs.
    pub(crate) fn reads_response_body(&self) -> bool {
        WebSocket__readsResponseBody(self)
    }

    /// A decoded piece of that body, if not empty. After `ended` C++ has let go of the upgrade client.
    pub(crate) fn did_receive_response_body(&self, chunk: &[u8], ended: bool) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didReceiveResponseBody(self, chunk.into(), ended);
        event_loop.exit();
    }

    /// The connection is over without a failure. `code` and `reason` are the peer's.
    pub(crate) fn did_close(
        &self,
        code: u16,
        reason: BunString,
        was_clean: bool,
        buffered_amount: usize,
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didClose(self, code, reason, was_clean, buffered_amount);
        event_loop.exit();
    }

    /// `readyState` becomes CLOSING. A field write on the C++ side: no JS runs, so no event-loop entry.
    pub(crate) fn did_start_closing_handshake(&self) {
        WebSocket__didStartClosingHandshake(self);
    }

    pub(crate) fn did_receive_text(&self, text: BunString) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didReceiveText(self, text);
        event_loop.exit();
    }

    pub(crate) fn did_receive_bytes(&self, bytes: &[u8], opcode: u8) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didReceiveBytes(self, bytes.into(), opcode);
        event_loop.exit();
    }

    pub(crate) fn did_drain(&self) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didDrain(self);
        event_loop.exit();
    }

    // The three below call the JS owner of a stream. Every entry point of a client over a
    // stream is itself a call from JS, so these are nested calls: see `without_checkpoint`.

    /// C++ copies `bytes`. The callee can re-enter the client.
    pub(crate) fn stream_write(&self, bytes: &[u8]) {
        WebSocket__streamWrite(self, bytes.into());
    }

    /// Nothing more will be written: half-close the stream.
    pub(crate) fn stream_end(&self) {
        WebSocket__streamEnd(self);
    }

    pub(crate) fn stream_destroy(&self) {
        WebSocket__streamDestroy(self);
    }

    /// A field read on the C++ side: no JS runs, so no event-loop entry.
    pub(crate) fn is_paused(&self) -> bool {
        WebSocket__isPaused(self)
    }

    /// A field read on the C++ side: no JS runs, so no event-loop entry.
    pub(crate) fn reject_unauthorized(&self) -> bool {
        WebSocket__rejectUnauthorized(self)
    }

    /// Rooted through the JS wrapper, which is alive while the socket is.
    fn check_server_identity(&self) -> Option<JSValue> {
        let callback = WebSocket__checkServerIdentity(self);
        (!callback.is_empty_or_undefined_or_null() && callback.is_callable()).then_some(callback)
    }

    fn name_check(&self, peer: TlsPeer) -> NameCheck {
        let enforce = self.reject_unauthorized();
        let callback = match peer {
            TlsPeer::Target => self.check_server_identity(),
            TlsPeer::Proxy => None,
        };
        match callback {
            Some(callback) => NameCheck::Callback { callback, enforce },
            None if enforce => NameCheck::BuiltIn,
            None => NameCheck::Nobody,
        }
    }

    /// The name check inside the handshake. `Unchecked` leaves the name to `accepts_tls_peer`.
    pub(crate) fn server_identity(
        &self,
        peer: TlsPeer,
        ssl: &mut boringssl::c::SSL,
        hostname: &[u8],
    ) -> boringssl::ServerIdentity {
        match self.name_check(peer) {
            NameCheck::BuiltIn => boringssl::server_identity(ssl, Some(hostname)),
            NameCheck::Nobody | NameCheck::Callback { .. } => boringssl::ServerIdentity::Unchecked,
        }
    }

    /// The one verdict on a completed TLS handshake. May run JS that closes the WebSocket.
    pub(crate) fn accepts_tls_peer(
        &self,
        handshake: TlsHandshake,
        ssl: Option<&mut boringssl::c::SSL>,
        chain_verified: bool,
        hostname: &[u8],
    ) -> bool {
        if !chain_verified {
            // As in Node, the callback never sees a chain that did not verify.
            return !self.reject_unauthorized();
        }
        let peer = match handshake {
            TlsHandshake::First { peer, .. } => peer,
            // Without a tunnel, that socket goes to the target or to the HTTPS proxy of a ws:// target.
            TlsHandshake::Renegotiation if WebSocket__isProxyTLS(self) => TlsPeer::Proxy,
            TlsHandshake::Renegotiation => TlsPeer::Target,
        };
        match (self.name_check(peer), handshake) {
            (NameCheck::Nobody, _) | (NameCheck::Callback { .. }, TlsHandshake::Renegotiation) => {
                true
            }
            (NameCheck::BuiltIn, _) => ssl.is_some_and(|ssl| {
                !hostname.is_empty() && bun_uws::check_server_identity(ssl, hostname)
            }),
            (NameCheck::Callback { callback, enforce }, TlsHandshake::First { context, .. }) => {
                // Before the 101 the upgrade client hears of a renegotiation too.
                ssl.is_some_and(|ssl| {
                    SSL_total_renegotiations(ssl) > 0
                        || run_check_server_identity(context, callback, ssl, hostname)
                }) || !enforce
            }
        }
    }

    /// `connect` dispatches `open` and returns the connected client, or null if `open` dropped it.
    /// The bytes that came with the 101 are parsed after the microtasks of `open`.
    fn open_then_deliver_initial_data<const SSL: bool>(
        connect: impl FnOnce() -> *mut core::ffi::c_void,
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        let client = core::ptr::NonNull::new(connect().cast::<WebSocket<SSL>>()).map(|client| {
            // SAFETY: C++ holds a ref on the client it returns.
            RefPtr::from_this(unsafe { ThisPtr::new(client.as_ptr()) })
        });
        event_loop.exit();
        if let Some(client) = client {
            WebSocket::<SSL>::deliver_initial_data(client.this_ptr());
        }
    }

    /// `buffered_data` and `secure` are handed on to the connected client.
    pub(crate) fn did_connect<const SSL: bool>(
        &self,
        socket: &mut Socket,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        verified_hostname: &[u8],
    ) {
        Self::open_then_deliver_initial_data::<SSL>(|| {
            WebSocket__didConnect(
                self,
                socket,
                buffered_data,
                deflate_params,
                secure,
                verified_hostname.into(),
            )
        });
    }

    /// `buffered_data` is handed on to the connected client.
    pub(crate) fn did_connect_with_tunnel(
        &self,
        tunnel: ThisPtr<WebSocketProxyTunnel>,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
    ) {
        Self::open_then_deliver_initial_data::<false>(|| {
            WebSocket__didConnectWithTunnel(self, tunnel, buffered_data, deflate_params)
        });
    }

    pub(crate) fn set_protocol(&self, protocol: BunString) {
        bun_jsc::mark_binding!();
        WebSocket__setProtocol(self, protocol);
    }
}

fn run_check_server_identity(
    context: ContextId,
    callback: JSValue,
    ssl: &mut boringssl::c::SSL,
    hostname: &[u8],
) -> bool {
    let vm = VirtualMachineRef::get();
    let _context = vm.enter_context(context);
    let event_loop = vm.event_loop_mut();
    event_loop.enter();
    let verdict = match call_check_server_identity(vm.global(), callback, ssl, hostname) {
        Ok(approved) => approved,
        Err(err) => {
            let _ = bun_jsc::task::report_error_or_terminate(vm.global(), err);
            false
        }
    };
    event_loop.exit();
    verdict
}

/// `Ok(true)` only if the callback ran and returned a falsy value.
fn call_check_server_identity(
    global: &JSGlobalObject,
    callback: JSValue,
    ssl: &mut boringssl::c::SSL,
    hostname: &[u8],
) -> JsResult<bool> {
    let Some(cert) = ssl.peer_leaf_certificate() else {
        return Ok(false);
    };
    let js_cert =
        bun_jsc::from_js_host_call(global, || Bun__X509__toJSLegacyEncoding(cert, global))?;
    let js_hostname = bun_jsc::bun_string_jsc::create_utf8_for_js(global, hostname)?;
    let verdict = callback.call(global, JSValue::UNDEFINED, &[js_hostname, js_cert])?;
    js_hostname.ensure_still_alive();
    js_cert.ensure_still_alive();
    if callback.call_may_have_been_dropped(global) {
        return Ok(false);
    }
    // As in `tls.connect()` (src/js/node/net.ts), any truthy verdict rejects: an async callback's Promise too.
    Ok(!verdict.is_truthy())
}
