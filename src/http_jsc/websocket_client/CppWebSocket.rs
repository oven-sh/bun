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

use bun_jsc::VirtualMachine;
use bun_str::{String as BunString, ZigString};
use bun_uws_sys::{Socket, SslCtx};

use super::web_socket_deflate;
use super::ErrorCode;

/// Opaque handle to the C++ `WebCore::WebSocket` object.
#[repr(C)]
pub struct CppWebSocket {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to http_jsc_sys (or appropriate *_sys crate)
unsafe extern "C" {
    fn WebSocket__didConnect(
        websocket_context: *mut CppWebSocket,
        socket: *mut Socket,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: *const web_socket_deflate::Params,
        secure: *mut SslCtx,
    );
    fn WebSocket__didConnectWithTunnel(
        websocket_context: *mut CppWebSocket,
        tunnel: *mut c_void,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: *const web_socket_deflate::Params,
    );
    fn WebSocket__didAbruptClose(websocket_context: *mut CppWebSocket, reason: ErrorCode);
    fn WebSocket__didClose(websocket_context: *mut CppWebSocket, code: u16, reason: *const BunString);
    fn WebSocket__didReceiveText(websocket_context: *mut CppWebSocket, clone: bool, text: *const ZigString);
    fn WebSocket__didReceiveBytes(websocket_context: *mut CppWebSocket, bytes: *const u8, byte_len: usize, opcode: u8);
    fn WebSocket__rejectUnauthorized(websocket_context: *mut CppWebSocket) -> bool;
    fn WebSocket__incrementPendingActivity(websocket_context: *mut CppWebSocket);
    fn WebSocket__decrementPendingActivity(websocket_context: *mut CppWebSocket);
    fn WebSocket__setProtocol(websocket_context: *mut CppWebSocket, protocol: *mut BunString);
}

impl CppWebSocket {
    pub fn did_abrupt_close(&mut self, reason: ErrorCode) {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; event loop is entered.
        unsafe { WebSocket__didAbruptClose(self, reason) };
        event_loop.exit();
    }

    pub fn did_close(&mut self, code: u16, reason: &mut BunString) {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; reason outlives the call.
        unsafe { WebSocket__didClose(self, code, reason) };
        event_loop.exit();
    }

    pub fn did_receive_text(&mut self, clone: bool, text: &ZigString) {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; text outlives the call.
        unsafe { WebSocket__didReceiveText(self, clone, text) };
        event_loop.exit();
    }

    pub fn did_receive_bytes(&mut self, bytes: *const u8, byte_len: usize, opcode: u8) {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; bytes points to byte_len valid bytes.
        unsafe { WebSocket__didReceiveBytes(self, bytes, byte_len, opcode) };
        event_loop.exit();
    }

    pub fn reject_unauthorized(&mut self) -> bool {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket.
        let result = unsafe { WebSocket__rejectUnauthorized(self) };
        event_loop.exit();
        result
    }

    pub fn did_connect(
        &mut self,
        socket: &mut Socket,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: Option<&web_socket_deflate::Params>,
        secure: Option<&mut SslCtx>,
    ) {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; all pointers are valid for the call duration.
        unsafe {
            WebSocket__didConnect(
                self,
                socket,
                buffered_data,
                buffered_len,
                deflate_params.map_or(core::ptr::null(), |p| p as *const _),
                secure.map_or(core::ptr::null_mut(), |p| p as *mut _),
            )
        };
        event_loop.exit();
    }

    pub fn did_connect_with_tunnel(
        &mut self,
        tunnel: *mut c_void,
        buffered_data: *mut u8,
        buffered_len: usize,
        deflate_params: Option<&web_socket_deflate::Params>,
    ) {
        let event_loop = VirtualMachine::get().event_loop();
        event_loop.enter();
        // SAFETY: self is a valid C++ WebCore::WebSocket; tunnel/buffered_data are valid for the call duration.
        unsafe {
            WebSocket__didConnectWithTunnel(
                self,
                tunnel,
                buffered_data,
                buffered_len,
                deflate_params.map_or(core::ptr::null(), |p| p as *const _),
            )
        };
        event_loop.exit();
    }

    // PORT NOTE: `ref` is a Rust keyword; using raw identifier to match Zig fn name.
    pub fn r#ref(&mut self) {
        bun_jsc::mark_binding!();
        // SAFETY: self is a valid C++ WebCore::WebSocket.
        unsafe { WebSocket__incrementPendingActivity(self) };
    }

    pub fn unref(&mut self) {
        bun_jsc::mark_binding!();
        // SAFETY: self is a valid C++ WebCore::WebSocket.
        unsafe { WebSocket__decrementPendingActivity(self) };
    }

    pub fn set_protocol(&mut self, protocol: &mut BunString) {
        bun_jsc::mark_binding!();
        // SAFETY: self is a valid C++ WebCore::WebSocket; protocol outlives the call.
        unsafe { WebSocket__setProtocol(self, protocol) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/websocket_client/CppWebSocket.zig (96 lines)
//   confidence: high
//   todos:      1
//   notes:      enter()/exit() inlined (no error path between them); `ref` uses raw ident r#ref; ErrorCode/web_socket_deflate module paths may need Phase B fixup.
// ──────────────────────────────────────────────────────────────────────────
