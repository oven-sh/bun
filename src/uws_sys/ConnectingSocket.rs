use core::ffi::{c_uint, c_void};

use crate::{Loop, SocketGroup, SocketKind};

bun_opaque::opaque_ffi! { pub struct ConnectingSocket; }

impl ConnectingSocket {
    pub fn close(&mut self) {
        us_connecting_socket_close(self)
    }

    pub fn group(&mut self) -> *mut SocketGroup {
        us_connecting_socket_group(self)
    }
    pub fn raw_group(&mut self) -> *mut SocketGroup {
        self.group()
    }

    pub fn kind(&mut self) -> SocketKind {
        SocketKind::from_u8(us_connecting_socket_kind(self))
    }

    /// Returns the owning `Loop`. Raw pointer because the loop is a shared
    /// singleton referenced by every group/socket/timer (Zig `*Loop` freely
    /// aliases); materializing `&mut Loop` here would be aliased UB.
    pub fn r#loop(&mut self) -> *mut Loop {
        us_connecting_socket_get_loop(self)
    }

    pub fn ext<T>(&mut self) -> &mut T {
        // SAFETY: the ext slot is per-socket trailing storage inside this
        // allocation; `&mut self` guarantees exclusive access to it for the
        // returned borrow's lifetime. Caller asserts the slot was sized/
        // aligned for T at group creation.
        unsafe { &mut *us_connecting_socket_ext(self).cast::<T>() }
    }

    pub fn get_error(&mut self) -> i32 {
        us_connecting_socket_get_error(self)
    }

    pub fn get_native_handle(&mut self) -> *mut c_void {
        us_connecting_socket_get_native_handle(self)
    }

    pub fn is_closed(&mut self) -> bool {
        us_connecting_socket_is_closed(self) == 1
    }

    pub fn is_shutdown(&mut self) -> bool {
        us_connecting_socket_is_shut_down(self) == 1
    }

    pub fn long_timeout(&mut self, seconds: c_uint) {
        us_connecting_socket_long_timeout(self, seconds)
    }

    pub fn shutdown(&mut self) {
        us_connecting_socket_shutdown(self)
    }

    pub fn shutdown_read(&mut self) {
        us_connecting_socket_shutdown_read(self)
    }

    pub fn timeout(&mut self, seconds: c_uint) {
        us_connecting_socket_timeout(self, seconds)
    }
}

unsafe extern "C" {
    pub(crate) safe fn us_connecting_socket_close(s: &mut ConnectingSocket);
    pub(crate) safe fn us_connecting_socket_group(s: &mut ConnectingSocket) -> *mut SocketGroup;
    pub(crate) safe fn us_connecting_socket_kind(s: &mut ConnectingSocket) -> u8;
    pub(crate) safe fn us_connecting_socket_ext(s: &mut ConnectingSocket) -> *mut c_void;
    pub(crate) safe fn us_connecting_socket_get_error(s: &mut ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_get_native_handle(
        s: &mut ConnectingSocket,
    ) -> *mut c_void;
    pub(crate) safe fn us_connecting_socket_is_closed(s: &mut ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_is_shut_down(s: &mut ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_long_timeout(s: &mut ConnectingSocket, seconds: c_uint);
    pub(crate) safe fn us_connecting_socket_shutdown(s: &mut ConnectingSocket);
    pub(crate) safe fn us_connecting_socket_shutdown_read(s: &mut ConnectingSocket);
    pub(crate) safe fn us_connecting_socket_timeout(s: &mut ConnectingSocket, seconds: c_uint);
    pub(crate) safe fn us_connecting_socket_get_loop(s: &mut ConnectingSocket) -> *mut Loop;
}

// ported from: src/uws_sys/ConnectingSocket.zig
