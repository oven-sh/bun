use core::ffi::{c_char, c_int, c_void};

use bun_boringssl_sys::OwnedSslCtx;

use crate::{SslCtx, us_socket_t};

/// Opaque FFI handle for a uSockets listen socket. As in C, its first member is the socket.
#[repr(C)]
pub struct ListenSocket(us_socket_t);

impl ListenSocket {
    pub fn close(&mut self) {
        us_listen_socket_close(self)
    }

    pub fn get_local_address<'a>(&mut self, buf: &'a mut [u8]) -> Result<&'a [u8], crate::Error> {
        self.get_socket().local_address(buf)
    }

    pub fn get_local_port(&mut self) -> Option<u16> {
        self.get_socket().local_port()
    }

    pub fn get_socket(&mut self) -> &mut us_socket_t {
        &mut self.0
    }

    pub fn socket<const IS_SSL: bool>(&mut self) -> crate::socket::NewSocketHandler<IS_SSL> {
        // NewSocketHandler is local (crate::socket); no upward dep.
        crate::socket::NewSocketHandler::<IS_SSL>::from(std::ptr::from_mut::<us_socket_t>(
            self.get_socket(),
        ))
    }

    /// `ssl_ctx` is `SSL_CTX_up_ref`'d for the SNI node; the listener drops
    /// that ref on close, or when `hostname` is registered again.
    ///
    /// `ssl_ctx` is taken as a raw `*mut SslCtx` (not `&mut SslCtx`) because
    /// `SSL_CTX` is a refcounted shared object — C `SSL_CTX_up_ref`s it and
    /// stores the pointer past this call, so the caller cannot legitimately
    /// hold exclusive `&mut` access.
    pub fn add_server_name(&mut self, hostname: &core::ffi::CStr, ssl_ctx: *mut SslCtx) {
        // SAFETY: self and hostname are valid for the duration of the call;
        // caller guarantees `ssl_ctx` is non-null and points at a live SSL_CTX
        // (C up-refs and stores it).
        unsafe { us_listen_socket_add_server_name(self, hostname.as_ptr(), ssl_ctx) }
    }

    /// Makes `ctx` the default `SSL_CTX` for sockets accepted from now on.
    pub fn set_default_ssl_ctx(&mut self, ctx: &OwnedSslCtx) {
        // SAFETY: `ctx` owns a live SSL_CTX, which C up-refs before it stores the pointer.
        unsafe { us_listen_socket_set_default_ssl_ctx(self, ctx.as_ptr()) }
    }

    /// `cb` receives a null `ListenSocket` once this listen socket closed.
    pub fn on_server_name(
        &mut self,
        cb: extern "C" fn(
            *mut ListenSocket,
            *const c_char,
            Option<&mut c_int>,
            *mut c_void,
        ) -> *mut c_void,
    ) {
        us_listen_socket_on_server_name(self, cb)
    }
}

// This file IS the *_sys crate, so externs live here.
// `ListenSocket` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`, so `&mut
// ListenSocket` is ABI-identical to a non-null pointer; value-typed shims are
// `safe fn`. Shims with nullable raw / ctx ptr stay unsafe.
unsafe extern "C" {
    safe fn us_listen_socket_close(ls: &mut ListenSocket);
    fn us_listen_socket_add_server_name(
        ls: *mut ListenSocket,
        hostname: *const c_char,
        ssl_ctx: *mut SslCtx,
    );
    fn us_listen_socket_set_default_ssl_ctx(ls: *mut ListenSocket, ctx: *mut SslCtx);
    safe fn us_listen_socket_on_server_name(
        ls: &mut ListenSocket,
        cb: extern "C" fn(
            *mut ListenSocket,
            *const c_char,
            Option<&mut c_int>,
            *mut c_void,
        ) -> *mut c_void,
    );
}
