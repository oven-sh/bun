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
use bun_core::ffi::FfiSlice;
use bun_core::{EncodedSlice, String as BunString};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{ContextId, JSGlobalObject, JSValue, JsResult, VirtualMachineRef};
use bun_ptr::ThisPtr;
use bun_uws_sys::Socket;

use super::websocket_deflate;
use super::{ErrorCode, InitialData, WebSocketProxyTunnel};

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
    );
    #[allow(improper_ctypes)]
    safe fn WebSocket__didConnectWithTunnel(
        websocket_context: &CppWebSocket,
        tunnel: ThisPtr<WebSocketProxyTunnel>,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
    );
    safe fn WebSocket__didAbruptClose(websocket_context: &CppWebSocket, reason: ErrorCode);
    safe fn WebSocket__didReceiveHandshakeResponse(
        websocket_context: &CppWebSocket,
        status_code: u16,
        status_message: FfiSlice<'_>,
        headers: FfiSlice<'_, RawHeader<'_>>,
        body: FfiSlice<'_>,
    );
    safe fn WebSocket__didClose(websocket_context: &CppWebSocket, code: u16, reason: BunString);
    safe fn WebSocket__didReceiveText(
        websocket_context: &CppWebSocket,
        clone: bool,
        text: &EncodedSlice,
    );
    safe fn WebSocket__didReceiveBytes(
        websocket_context: &CppWebSocket,
        bytes: FfiSlice<'_>,
        opcode: u8,
    );
    safe fn WebSocket__rejectUnauthorized(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__isProxyTLS(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__bunContext(websocket_context: &CppWebSocket) -> *const core::ffi::c_void;
    safe fn WebSocket__checkServerIdentity(websocket_context: &CppWebSocket) -> JSValue;
    safe fn WebSocket__holdPendingActivityForClient(websocket_context: &CppWebSocket);
    safe fn WebSocket__releasePendingActivityForClient(websocket_context: &CppWebSocket);
    safe fn WebSocket__setProtocol(websocket_context: &CppWebSocket, protocol: BunString);
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

    pub(crate) fn did_abrupt_close(&self, reason: ErrorCode) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didAbruptClose(self, reason);
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

    pub(crate) fn did_close(&self, code: u16, reason: BunString) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didClose(self, code, reason);
        event_loop.exit();
    }

    pub(crate) fn did_receive_text(&self, clone: bool, text: &EncodedSlice) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didReceiveText(self, clone, text);
        event_loop.exit();
    }

    pub(crate) fn did_receive_bytes(&self, bytes: &[u8], opcode: u8) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didReceiveBytes(self, bytes.into(), opcode);
        event_loop.exit();
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
        // The name the certificate must carry. That JS must not be able to free it.
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
                ssl.is_some_and(|ssl| run_check_server_identity(context, callback, ssl, hostname))
                    || !enforce
            }
        }
    }

    /// `buffered_data` and `secure` are handed on to the connected client.
    pub(crate) fn did_connect(
        &self,
        socket: &mut Socket,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
        verified_hostname: &[u8],
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didConnect(
            self,
            socket,
            buffered_data,
            deflate_params,
            secure,
            verified_hostname.into(),
        );
        event_loop.exit();
    }

    /// `buffered_data` is handed on to the connected client.
    pub(crate) fn did_connect_with_tunnel(
        &self,
        tunnel: ThisPtr<WebSocketProxyTunnel>,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didConnectWithTunnel(self, tunnel, buffered_data, deflate_params);
        event_loop.exit();
    }
}

impl CppWebSocket {
    fn r#ref(&self) {
        bun_jsc::mark_binding!();
        WebSocket__holdPendingActivityForClient(self);
    }

    fn unref(&self) {
        bun_jsc::mark_binding!();
        WebSocket__releasePendingActivityForClient(self);
    }

    pub(crate) fn set_protocol(&self, protocol: BunString) {
        bun_jsc::mark_binding!();
        WebSocket__setProtocol(self, protocol);
    }
}

/// Runs the callback in the context of the script that made the WebSocket.
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
            // A throw rejects the peer and is reported like any uncaught exception.
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
    // When script may not run (a stopping VM), `call` returns `undefined`, which reads as approval.
    let vm = global.bun_vm();
    if !vm.script_allowed() || global.vm().execution_forbidden() || vm.calls_nobody() {
        return Ok(false);
    }
    // As in `tls.connect()` (src/js/node/net.ts), any truthy verdict rejects: an async callback's Promise too.
    Ok(!verdict.is_truthy())
}

// Also declared in `bun_runtime::api::bun::x509`, which is above this crate.
unsafe extern "C" {
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut boringssl::c::X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

/// RAII owner of one pending-activity ref on a C++ `WebCore::WebSocket`.
///
/// Construction calls [`CppWebSocket::r#ref`]; `Drop` calls
/// [`CppWebSocket::unref`]. For when the ref must outlive the constructing
/// scope (e.g. stored on a queued task).
pub struct CppWebSocketRef(core::ptr::NonNull<CppWebSocket>);

impl CppWebSocketRef {
    /// Take a pending-activity ref on `ws` (which keeps it alive until `Drop`).
    pub(crate) fn new(ws: &CppWebSocket) -> Self {
        ws.r#ref();
        Self(core::ptr::NonNull::from(ws))
    }
}

impl Drop for CppWebSocketRef {
    fn drop(&mut self) {
        CppWebSocket::opaque_ref(self.0.as_ptr()).unref();
    }
}
