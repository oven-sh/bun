use core::ffi::{c_uint, c_void};

use crate::{Loop, SocketGroup, SocketKind};

/// `us_connecting_socket_t` — a connect in flight (DNS / non-blocking
/// `connect()` / happy-eyeballs). No I/O is possible yet; on success the loop
/// promotes it to a `us_socket_t` and fires `onOpen`, on failure
/// `onConnectingError`.
#[repr(C)]
pub struct ConnectingSocket {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

impl ConnectingSocket {
    pub fn close(&mut self) {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_close(self) }
    }

    pub fn group(&mut self) -> &mut SocketGroup {
        // SAFETY: self is a valid handle; uSockets guarantees a non-null group
        unsafe { &mut *us_connecting_socket_group(self) }
    }
    pub fn raw_group(&mut self) -> &mut SocketGroup {
        self.group()
    }

    pub fn kind(&mut self) -> SocketKind {
        // SAFETY: SocketKind is #[repr(u8)] and the C side returns a valid discriminant
        unsafe { core::mem::transmute::<u8, SocketKind>(us_connecting_socket_kind(self)) }
    }

    pub fn r#loop(&mut self) -> &mut Loop {
        // SAFETY: self is a valid handle; uSockets guarantees a non-null loop
        unsafe { &mut *us_connecting_socket_get_loop(self) }
    }

    pub fn ext<T>(&mut self) -> &mut T {
        // SAFETY: caller asserts the ext slot was sized/aligned for T at group creation
        unsafe { &mut *us_connecting_socket_ext(self).cast::<T>() }
    }

    pub fn get_error(&mut self) -> i32 {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_get_error(self) }
    }

    pub fn get_native_handle(&mut self) -> *mut c_void {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_get_native_handle(self) }
    }

    pub fn is_closed(&mut self) -> bool {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_is_closed(self) == 1 }
    }

    pub fn is_shutdown(&mut self) -> bool {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_is_shut_down(self) == 1 }
    }

    pub fn long_timeout(&mut self, seconds: c_uint) {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_long_timeout(self, seconds) }
    }

    pub fn shutdown(&mut self) {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_shutdown(self) }
    }

    pub fn shutdown_read(&mut self) {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_shutdown_read(self) }
    }

    pub fn timeout(&mut self, seconds: c_uint) {
        // SAFETY: self is a valid us_connecting_socket_t handle
        unsafe { us_connecting_socket_timeout(self, seconds) }
    }
}

unsafe extern "C" {
    pub fn us_connecting_socket_close(s: *mut ConnectingSocket);
    pub fn us_connecting_socket_group(s: *mut ConnectingSocket) -> *mut SocketGroup;
    pub fn us_connecting_socket_kind(s: *mut ConnectingSocket) -> u8;
    pub fn us_connecting_socket_ext(s: *mut ConnectingSocket) -> *mut c_void;
    pub fn us_connecting_socket_get_error(s: *mut ConnectingSocket) -> i32;
    pub fn us_connecting_socket_get_native_handle(s: *mut ConnectingSocket) -> *mut c_void;
    pub fn us_connecting_socket_is_closed(s: *mut ConnectingSocket) -> i32;
    pub fn us_connecting_socket_is_shut_down(s: *mut ConnectingSocket) -> i32;
    pub fn us_connecting_socket_long_timeout(s: *mut ConnectingSocket, seconds: c_uint);
    pub fn us_connecting_socket_shutdown(s: *mut ConnectingSocket);
    pub fn us_connecting_socket_shutdown_read(s: *mut ConnectingSocket);
    pub fn us_connecting_socket_timeout(s: *mut ConnectingSocket, seconds: c_uint);
    pub fn us_connecting_socket_get_loop(s: *mut ConnectingSocket) -> *mut Loop;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/ConnectingSocket.zig (80 lines)
//   confidence: high
//   todos:      0
//   notes:      SocketGroup/SocketKind/Loop assumed in crate root; r#loop used for `loop` keyword
// ──────────────────────────────────────────────────────────────────────────
