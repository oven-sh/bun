use core::ffi::{c_char, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_core::Fd;

use crate::{LIBUS_SOCKET_DESCRIPTOR, SocketGroup, SslCtx, us_socket_t};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a uSockets listen socket.
    pub struct ListenSocket;
}

impl ListenSocket {
    pub fn close(&mut self) {
        us_listen_socket_close(self)
    }

    pub fn get_local_address<'a>(
        &mut self,
        buf: &'a mut [u8],
    ) -> Result<&'a [u8], bun_core::Error> {
        // TODO(port): narrow error set
        self.get_socket().local_address(buf)
    }

    pub fn get_local_port(&mut self) -> i32 {
        self.get_socket().local_port()
    }

    pub fn get_socket(&mut self) -> &mut us_socket_t {
        // SAFETY: ListenSocket is layout-compatible with us_socket_t on the C side
        // (a listen socket IS a us_socket_t); Zig does `@ptrCast(this)`. The returned
        // borrow reborrows `&mut self` exclusively — no alias is live while it exists.
        unsafe { &mut *std::ptr::from_mut::<ListenSocket>(self).cast::<us_socket_t>() }
    }

    pub fn socket<const IS_SSL: bool>(
        &mut self,
    ) -> crate::socket::NewSocketHandler<IS_SSL> {
        // NewSocketHandler is local (crate::socket); no upward dep.
        crate::socket::NewSocketHandler::<IS_SSL>::from(std::ptr::from_mut::<us_socket_t>(
            self.get_socket(),
        ))
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
        let raw = us_listen_socket_get_fd(self);
        // SOCKET → kind=system (mask bit 63); `from_native` would store the
        // raw bits verbatim and mis-tag `INVALID_SOCKET` (~0) as kind=uv.
        #[cfg(windows)]
        {
            Fd::from_system(raw as *mut core::ffi::c_void)
        }
        #[cfg(not(windows))]
        {
            Fd::from_native(raw)
        }
    }

    /// `ssl_ctx` is `SSL_CTX_up_ref`'d for the SNI node; the listener drops
    /// that ref on close / `remove_server_name`. `user` is the per-domain handle
    /// `find_server_name_userdata` recovers (uWS uses an `HttpRouter*`; Bun.listen
    /// passes null).
    ///
    /// `ssl_ctx` is taken as a raw `*mut SslCtx` (not `&mut SslCtx`) because
    /// `SSL_CTX` is a refcounted shared object — C `SSL_CTX_up_ref`s it and
    /// stores the pointer past this call, so the caller cannot legitimately
    /// hold exclusive `&mut` access. `user` is likewise raw `*mut` because the
    /// C side stores it and `find_server_name_userdata` later hands it back as
    /// a mutable pointer; accepting `&U` and const-casting would make that
    /// round-trip UB.
    pub fn add_server_name(
        &mut self,
        hostname: &core::ffi::CStr,
        ssl_ctx: *mut SslCtx,
        user: *mut c_void,
    ) -> bool {
        // SAFETY: self and hostname are valid for the duration of the call;
        // caller guarantees `ssl_ctx` is non-null and points at a live SSL_CTX
        // (C up-refs and stores it); `user` is an opaque caller-owned pointer
        // stored verbatim by C.
        unsafe { us_listen_socket_add_server_name(self, hostname.as_ptr(), ssl_ctx, user) == 0 }
    }

    pub fn remove_server_name(&mut self, hostname: &core::ffi::CStr) {
        // SAFETY: self and hostname are valid for the duration of the call.
        unsafe { us_listen_socket_remove_server_name(self, hostname.as_ptr()) }
    }

    /// Returns the raw userdata pointer registered via `add_server_name` for
    /// `hostname`, cast to `*mut T`. Returned as `NonNull<T>` (not `&mut T`)
    /// because the pointee is caller-owned external storage — materializing a
    /// `&mut T` here could alias the caller's own live reference to it. Mirrors
    /// Zig's `?*T` return (Zig pointers freely alias).
    pub fn find_server_name_userdata<T>(
        &mut self,
        hostname: &core::ffi::CStr,
    ) -> Option<NonNull<T>> {
        // SAFETY: self and hostname valid; caller guarantees the stored userdata
        // is a *T (mirrors Zig `@ptrCast(@alignCast(...))`).
        let p = unsafe { us_listen_socket_find_server_name_userdata(self, hostname.as_ptr()) };
        NonNull::new(p.cast::<T>())
    }

    pub fn on_server_name(&mut self, cb: extern "C" fn(*mut ListenSocket, *const c_char)) {
        us_listen_socket_on_server_name(self, cb)
    }
}

// This file IS the *_sys crate, so externs live here.
// `ListenSocket` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`, so `&mut
// ListenSocket` is ABI-identical to a non-null pointer; value-typed shims are
// `safe fn`. Shims with nullable raw / ctx ptr stay unsafe.
unsafe extern "C" {
    safe fn us_listen_socket_close(ls: &mut ListenSocket);
    safe fn us_listen_socket_group(ls: &mut ListenSocket) -> *mut SocketGroup;
    safe fn us_listen_socket_ext(ls: &mut ListenSocket) -> *mut c_void;
    safe fn us_listen_socket_get_fd(ls: &mut ListenSocket) -> LIBUS_SOCKET_DESCRIPTOR;
    #[allow(dead_code)]
    safe fn us_listen_socket_port(ls: &mut ListenSocket) -> c_int;
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
    safe fn us_listen_socket_on_server_name(
        ls: &mut ListenSocket,
        cb: extern "C" fn(*mut ListenSocket, *const c_char),
    );
}

// ported from: src/uws_sys/ListenSocket.zig
