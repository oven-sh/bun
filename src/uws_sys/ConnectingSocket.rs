use core::ffi::{c_uint, c_void};

use crate::{Loop, SocketGroup, SocketKind};

// `us_connecting_socket_t` — a connect in flight (DNS / non-blocking
// `connect()` / happy-eyeballs). No I/O is possible yet; on success the loop
// promotes it to a `us_socket_t` and fires `onOpen`, on failure
// `onConnectingError`.
bun_opaque::opaque_ffi! { pub struct ConnectingSocket; }

impl ConnectingSocket {
    pub fn close(&self) {
        us_connecting_socket_close(self)
    }

    /// Returns the owning `SocketGroup`. Raw pointer because the group is
    /// shared by every socket it owns;
    /// materializing `&mut SocketGroup` here would alias with other sockets'
    /// borrows of the same group.
    pub fn group(&self) -> *mut SocketGroup {
        us_connecting_socket_group(self)
    }
    pub fn raw_group(&self) -> *mut SocketGroup {
        self.group()
    }

    pub fn kind(&self) -> SocketKind {
        SocketKind::from_u8(us_connecting_socket_kind(self))
    }

    /// Returns the owning `Loop`. Raw pointer because the loop is a shared
    /// singleton referenced by every group/socket/timer;
    /// materializing `&mut Loop` here would be aliased UB.
    pub fn r#loop(&self) -> *mut Loop {
        us_connecting_socket_get_loop(self)
    }

    /// `&mut self`: the returned `&mut T` aliases the socket's real trailing ext
    /// storage, so the exclusive borrow — not the ZST receiver — is what keeps two
    /// `&mut T` to that slot from coexisting. Caller asserts the slot was
    /// sized/aligned for T at group creation.
    pub fn ext<T>(&mut self) -> &mut T {
        // SAFETY: `us_connecting_socket_ext` returns the per-socket ext slot.
        unsafe { &mut *us_connecting_socket_ext(self).cast::<T>() }
    }

    pub fn get_error(&self) -> i32 {
        us_connecting_socket_get_error(self)
    }

    /// Raw `getaddrinfo(3)` return code when the name lookup itself failed;
    /// 0 for a connect failure past name resolution. A different namespace
    /// from [`Self::get_error`] (errno).
    pub fn get_dns_error(&self) -> i32 {
        us_connecting_socket_get_dns_error(self)
    }

    pub fn get_native_handle(&self) -> *mut c_void {
        us_connecting_socket_get_native_handle(self)
    }

    pub fn is_closed(&self) -> bool {
        us_connecting_socket_is_closed(self) == 1
    }

    pub fn is_shutdown(&self) -> bool {
        us_connecting_socket_is_shut_down(self) == 1
    }

    pub fn long_timeout(&self, seconds: c_uint) {
        us_connecting_socket_long_timeout(self, seconds)
    }

    pub fn shutdown(&self) {
        us_connecting_socket_shutdown(self)
    }

    pub fn shutdown_read(&self) {
        us_connecting_socket_shutdown_read(self)
    }

    pub fn timeout(&self, seconds: c_uint) {
        us_connecting_socket_timeout(self, seconds)
    }
}

// `ConnectingSocket` is `!Freeze`, so `&ConnectingSocket` carries neither
// `noalias` nor `readonly` and is ABI-identical to a non-null pointer. uSockets
// re-enters through the same pointer, so no shim may claim exclusivity.
unsafe extern "C" {
    pub(crate) safe fn us_connecting_socket_close(s: &ConnectingSocket);
    pub(crate) safe fn us_connecting_socket_group(s: &ConnectingSocket) -> *mut SocketGroup;
    pub(crate) safe fn us_connecting_socket_kind(s: &ConnectingSocket) -> u8;
    pub(crate) safe fn us_connecting_socket_ext(s: &ConnectingSocket) -> *mut c_void;
    pub(crate) safe fn us_connecting_socket_get_error(s: &ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_get_dns_error(s: &ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_get_native_handle(s: &ConnectingSocket) -> *mut c_void;
    pub(crate) safe fn us_connecting_socket_is_closed(s: &ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_is_shut_down(s: &ConnectingSocket) -> i32;
    pub(crate) safe fn us_connecting_socket_long_timeout(s: &ConnectingSocket, seconds: c_uint);
    pub(crate) safe fn us_connecting_socket_shutdown(s: &ConnectingSocket);
    pub(crate) safe fn us_connecting_socket_shutdown_read(s: &ConnectingSocket);
    pub(crate) safe fn us_connecting_socket_timeout(s: &ConnectingSocket, seconds: c_uint);
    pub(crate) safe fn us_connecting_socket_get_loop(s: &ConnectingSocket) -> *mut Loop;
}
