//! This is the wrapper between Rust and C++ for WebSocket client functionality. It corresponds to the `WebCore::WebSocket` class (WebSocket.cpp).
//!
//! Each method in this interface ensures proper JavaScript event loop integration by entering
//! and exiting the event loop around C++ function calls, maintaining proper execution context.
//!
//! The external C++ functions are imported and wrapped with Rust functions that handle
//! the event loop management automatically.
//!
//! Note: This is specifically for WebSocket client implementations, not for server-side WebSockets.

use core::ffi::c_void;

use bun_core::{String as BunString, ZigString};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_uws_sys::{Socket, SslCtx};

use super::ErrorCode;
use super::websocket_deflate;

bun_opaque::opaque_ffi! {
    /// Opaque handle to the C++ `WebCore::WebSocket` object.
    pub struct CppWebSocket;
}

// FFI surface for `WebCore::WebSocket` (src/jsc/bindings/webcore/WebSocket.cpp).
// Kept private to this module — the safe wrappers below are the only callers.
//
// `CppWebSocket` is an UnsafeCell-backed opaque ZST, so `&CppWebSocket` carries
// no `readonly`/`noalias` — the C++ side owns and mutates all state behind it.
// Imports whose only non-value param is that handle are declared `safe fn`.
unsafe extern "C" {
    fn WebSocket__didConnect(
        websocket_context: &CppWebSocket,
        socket: *mut Socket,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: *const websocket_deflate::Params,
        secure: *mut SslCtx,
    );
    fn WebSocket__didConnectWithTunnel(
        websocket_context: &CppWebSocket,
        tunnel: *mut c_void,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: *const websocket_deflate::Params,
    );
    safe fn WebSocket__didAbruptClose(websocket_context: &CppWebSocket, reason: ErrorCode);
    fn WebSocket__didClose(websocket_context: &CppWebSocket, code: u16, reason: *const BunString);
    fn WebSocket__didReceiveText(
        websocket_context: &CppWebSocket,
        clone: bool,
        text: *const ZigString,
    );
    fn WebSocket__didReceiveBytes(
        websocket_context: &CppWebSocket,
        bytes: *const u8,
        byte_len: usize,
        opcode: u8,
    );
    safe fn WebSocket__rejectUnauthorized(websocket_context: &CppWebSocket) -> bool;
    safe fn WebSocket__incrementPendingActivity(websocket_context: &CppWebSocket);
    safe fn WebSocket__decrementPendingActivity(websocket_context: &CppWebSocket);
    fn WebSocket__setProtocol(websocket_context: &CppWebSocket, protocol: *mut BunString);
}

// PORT NOTE: receivers are `&self` (not `&mut self`) because `CppWebSocket` is
// an opaque C++ handle with no Rust-visible state; mutation happens entirely on
// the C++ side. Callers hold `NonNull<CppWebSocket>` and dispatch via shared
// borrows (often while `&mut WebSocket<SSL>` is also live), so `&mut self`
// would force needless `unsafe { &mut *ptr }` at every site.
impl CppWebSocket {
    pub fn did_abrupt_close(&self, reason: ErrorCode) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        WebSocket__didAbruptClose(self, reason);
        event_loop.exit();
    }

    pub fn did_close(&self, code: u16, reason: &mut BunString) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; reason outlives the call.
        unsafe { WebSocket__didClose(self, code, reason) };
        event_loop.exit();
    }

    pub fn did_receive_text(&self, clone: bool, text: &ZigString) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; text outlives the call.
        unsafe { WebSocket__didReceiveText(self, clone, text) };
        event_loop.exit();
    }

    pub fn did_receive_bytes(&self, bytes: *const u8, byte_len: usize, opcode: u8) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; bytes points to byte_len valid bytes.
        unsafe { WebSocket__didReceiveBytes(self, bytes, byte_len, opcode) };
        event_loop.exit();
    }

    pub fn reject_unauthorized(&self) -> bool {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        let result = WebSocket__rejectUnauthorized(self);
        event_loop.exit();
        result
    }

    pub fn did_connect(
        &self,
        socket: &mut Socket,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: Option<&websocket_deflate::Params>,
        secure: Option<&mut SslCtx>,
    ) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; all pointers are valid for the call duration.
        unsafe {
            WebSocket__didConnect(
                self,
                socket,
                buffered_data,
                buffered_len,
                deflate_params.map_or(core::ptr::null(), |p| std::ptr::from_ref(p)),
                secure.map_or(core::ptr::null_mut(), |p| std::ptr::from_mut(p)),
            )
        };
        event_loop.exit();
    }

    pub fn did_connect_with_tunnel(
        &self,
        tunnel: *mut c_void,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: Option<&websocket_deflate::Params>,
    ) {
        // SAFETY: VirtualMachine::get() returns the live current-thread VM;
        // event_loop() yields its raw event-loop pointer (live for VM lifetime).
        let event_loop = VirtualMachine::get().event_loop_mut();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; tunnel/buffered_data are valid for the call duration.
        unsafe {
            WebSocket__didConnectWithTunnel(
                self,
                tunnel,
                buffered_data,
                buffered_len,
                deflate_params.map_or(core::ptr::null(), |p| std::ptr::from_ref(p)),
            )
        };
        event_loop.exit();
    }
}

impl CppWebSocket {
    // PORT NOTE: `ref` is a Rust keyword; using raw identifier to match Zig fn name.
    pub fn r#ref(&self) {
        bun_jsc::mark_binding!();
        WebSocket__incrementPendingActivity(self);
    }

    pub fn unref(&self) {
        bun_jsc::mark_binding!();
        WebSocket__decrementPendingActivity(self);
    }

    pub fn set_protocol(&self, protocol: &mut BunString) {
        bun_jsc::mark_binding!();
        // SAFETY: self is a valid C++ WebCore::WebSocket; protocol outlives the call.
        unsafe { WebSocket__setProtocol(self, protocol) };
    }
}

/// RAII owner of one pending-activity ref on a C++ `WebCore::WebSocket`.
///
/// Construction calls [`CppWebSocket::r#ref`]; `Drop` calls
/// [`CppWebSocket::unref`]. Replaces the Zig `ws.ref(); defer ws.unref();`
/// pattern when the ref must outlive the constructing scope (e.g. stored on a
/// queued task).
pub struct CppWebSocketRef(core::ptr::NonNull<CppWebSocket>);

impl CppWebSocketRef {
    /// Take a pending-activity ref on `ws`.
    ///
    /// # Safety
    /// `ws` must point to a live C++ `WebCore::WebSocket` that outlives the
    /// returned guard.
    pub unsafe fn new(ws: core::ptr::NonNull<CppWebSocket>) -> Self {
        CppWebSocket::opaque_ref(ws.as_ptr()).r#ref();
        Self(ws)
    }
}

impl Drop for CppWebSocketRef {
    fn drop(&mut self) {
        CppWebSocket::opaque_ref(self.0.as_ptr()).unref();
    }
}

// ported from: src/http_jsc/websocket_client/CppWebSocket.zig
