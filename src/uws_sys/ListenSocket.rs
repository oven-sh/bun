use core::ffi::{c_char, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};

use bun_sys::Fd;

use crate::{us_socket_t, SocketGroup, SslCtx, LIBUS_SOCKET_DESCRIPTOR};

/// Opaque FFI handle for a uSockets listen socket.
#[repr(C)]
pub struct ListenSocket {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl ListenSocket {
    pub fn close(&mut self) {
        // SAFETY: self is a valid *mut ListenSocket from the C side.
        unsafe { us_listen_socket_close(self) }
    }

    pub fn get_local_address<'a>(&mut self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        // TODO(port): narrow error set
        self.get_socket().local_address(buf)
    }

    pub fn get_local_port(&mut self) -> i32 {
        self.get_socket().local_port()
    }

    pub fn get_socket(&mut self) -> &mut us_socket_t {
        // SAFETY: ListenSocket is layout-compatible with us_socket_t on the C side
        // (a listen socket IS a us_socket_t); Zig does `@ptrCast(this)`.
        unsafe { &mut *(self as *mut ListenSocket).cast::<us_socket_t>() }
    }

    pub fn socket<const IS_SSL: bool>(&mut self) -> bun_uws::NewSocketHandler<IS_SSL> {
        // TODO(port): bun_uws::NewSocketHandler lives in the wrapper crate; verify
        // this dependency direction (uws_sys -> uws) is acceptable in Phase B or
        // move this method to bun_uws as an extension.
        bun_uws::NewSocketHandler::<IS_SSL>::from(self.get_socket())
    }

    /// Group accepted sockets are linked into.
    pub fn group(&mut self) -> &mut SocketGroup {
        // SAFETY: self is a valid listen socket; C returns a non-null group.
        unsafe { &mut *us_listen_socket_group(self) }
    }

    pub fn ext<T>(&mut self) -> &mut T {
        // SAFETY: caller guarantees the ext storage was sized/aligned for T at
        // group creation time (mirrors Zig `@ptrCast(@alignCast(...))`).
        unsafe { &mut *us_listen_socket_ext(self).cast::<T>() }
    }

    pub fn fd(&mut self) -> Fd {
        // SAFETY: self is a valid listen socket.
        Fd::from_native(unsafe { us_listen_socket_get_fd(self) })
    }

    /// `ssl_ctx` is `SSL_CTX_up_ref`'d for the SNI node; the listener drops
    /// that ref on close / `remove_server_name`. `user` is the per-domain handle
    /// `find_server_name_userdata` recovers (uWS uses an `HttpRouter*`; Bun.listen
    /// passes `None`).
    pub fn add_server_name<U>(
        &mut self,
        hostname: &core::ffi::CStr,
        ssl_ctx: &mut SslCtx,
        user: Option<&U>,
    ) -> bool {
        let erased: *mut c_void = match user {
            None => core::ptr::null_mut(),
            // SAFETY: erasing a borrowed pointer to opaque userdata; C side never
            // mutates through it (matches Zig `@ptrCast(@constCast(user))`).
            Some(u) => u as *const U as *mut c_void,
        };
        // SAFETY: self, hostname, ssl_ctx are valid for the duration of the call.
        unsafe { us_listen_socket_add_server_name(self, hostname.as_ptr(), ssl_ctx, erased) == 0 }
    }

    pub fn remove_server_name(&mut self, hostname: &core::ffi::CStr) {
        // SAFETY: self and hostname are valid for the duration of the call.
        unsafe { us_listen_socket_remove_server_name(self, hostname.as_ptr()) }
    }

    pub fn find_server_name_userdata<T>(&mut self, hostname: &core::ffi::CStr) -> Option<&mut T> {
        // SAFETY: self and hostname valid; caller guarantees the stored userdata
        // is a *T (mirrors Zig `@ptrCast(@alignCast(...))`).
        let p = unsafe { us_listen_socket_find_server_name_userdata(self, hostname.as_ptr()) };
        if p.is_null() {
            None
        } else {
            // SAFETY: non-null, caller-asserted type/alignment.
            Some(unsafe { &mut *p.cast::<T>() })
        }
    }

    pub fn on_server_name(
        &mut self,
        cb: extern "C" fn(*mut ListenSocket, *const c_char),
    ) {
        // SAFETY: self is valid; cb has C ABI.
        unsafe { us_listen_socket_on_server_name(self, cb) }
    }
}

// This file IS the *_sys crate, so externs live here.
unsafe extern "C" {
    fn us_listen_socket_close(ls: *mut ListenSocket);
    fn us_listen_socket_group(ls: *mut ListenSocket) -> *mut SocketGroup;
    fn us_listen_socket_ext(ls: *mut ListenSocket) -> *mut c_void;
    fn us_listen_socket_get_fd(ls: *mut ListenSocket) -> LIBUS_SOCKET_DESCRIPTOR;
    #[allow(dead_code)]
    fn us_listen_socket_port(ls: *mut ListenSocket) -> c_int;
    fn us_listen_socket_add_server_name(
        ls: *mut ListenSocket,
        hostname: *const c_char,
        ssl_ctx: *mut SslCtx,
        user: *mut c_void,
    ) -> c_int;
    fn us_listen_socket_remove_server_name(ls: *mut ListenSocket, hostname: *const c_char);
    fn us_listen_socket_find_server_name_userdata(
        ls: *mut ListenSocket,
        hostname: *const c_char,
    ) -> *mut c_void;
    fn us_listen_socket_on_server_name(
        ls: *mut ListenSocket,
        cb: extern "C" fn(*mut ListenSocket, *const c_char),
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/ListenSocket.zig (69 lines)
//   confidence: medium
//   todos:      2
//   notes:      socket() references bun_uws::NewSocketHandler (wrapper crate) — possible layering inversion; add_server_name's anytype→Option<&U> may need adjustment per call sites.
// ──────────────────────────────────────────────────────────────────────────
