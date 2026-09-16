//! This is the wrapper between Rust and C++ for WebSocket client functionality. It corresponds to the `WebCore::WebSocket` class (WebSocket.cpp).
//!
//! Each method in this interface ensures proper JavaScript event loop integration by entering
//! and exiting the event loop around C++ function calls, maintaining proper execution context.
//!
//! The external C++ functions are imported and wrapped with Rust functions that handle
//! the event loop management automatically.
//!
//! Note: This is specifically for WebSocket client implementations, not for server-side WebSockets.

use bun_boringssl::c::OwnedSslCtx;
use bun_core::ffi::FfiSlice;
use bun_core::{EncodedSlice, String as BunString};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::ThisPtr;
use bun_uws_sys::Socket;

use super::websocket_deflate;
use super::{ErrorCode, InitialData, WebSocketProxyTunnel};

bun_opaque::opaque_ffi! {
    /// Opaque handle to the C++ `WebCore::WebSocket` object.
    pub struct CppWebSocket;
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

    pub(crate) fn reject_unauthorized(&self) -> bool {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        let result = WebSocket__rejectUnauthorized(self);
        event_loop.exit();
        result
    }

    /// `buffered_data` and `secure` are handed on to the connected client.
    pub(crate) fn did_connect(
        &self,
        socket: &mut Socket,
        buffered_data: Option<Box<InitialData>>,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<OwnedSslCtx>,
    ) {
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didConnect(self, socket, buffered_data, deflate_params, secure);
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
