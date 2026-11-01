use core::ffi::{c_char, c_int, c_void};

use bun_boringssl_sys::OwnedSslCtx;

use crate::{SocketGroup, SocketKind, SslCtx, us_socket_t};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a uSockets listen socket.
    pub struct ListenSocket;
}

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
        // SAFETY: ListenSocket is layout-compatible with us_socket_t on the C side
        // (a listen socket IS a us_socket_t). The returned
        // borrow reborrows `&mut self` exclusively — no alias is live while it exists.
        unsafe { &mut *std::ptr::from_mut::<ListenSocket>(self).cast::<us_socket_t>() }
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

    /// The group this listen socket was created in, where the sockets it accepts land.
    pub fn accept_group(&mut self) -> *mut SocketGroup {
        us_listen_socket_group(self)
    }

    /// What each socket accepted from now on gets: its kind, its `SSL_CTX` (`None` is plain
    /// TCP), the size of its ext block, and whether it starts paused. They still land in
    /// [`Self::accept_group`]. C up-refs `ssl_ctx` and drops the previous one with its SNI names.
    pub fn set_accept(
        &mut self,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        socket_ext_size: c_int,
        paused: bool,
    ) {
        // SAFETY: self is a live listen socket; `ssl_ctx` is null or a live SSL_CTX.
        unsafe {
            us_listen_socket_set_accept(
                self,
                kind as u8,
                ssl_ctx.unwrap_or(core::ptr::null_mut()),
                socket_ext_size,
                c_int::from(paused),
            )
        }
    }

    /// `cb` receives a null `ListenSocket` once this listen socket closed.
    pub fn on_server_name(
        &mut self,
        cb: extern "C" fn(*mut ListenSocket, *const c_char, *mut c_int, *mut c_void) -> *mut c_void,
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
    safe fn us_listen_socket_group(ls: &mut ListenSocket) -> *mut SocketGroup;
    fn us_listen_socket_set_accept(
        ls: *mut ListenSocket,
        kind: u8,
        ssl_ctx: *mut SslCtx,
        socket_ext_size: c_int,
        paused: c_int,
    );
    fn us_listen_socket_add_server_name(
        ls: *mut ListenSocket,
        hostname: *const c_char,
        ssl_ctx: *mut SslCtx,
    );
    fn us_listen_socket_set_default_ssl_ctx(ls: *mut ListenSocket, ctx: *mut SslCtx);
    safe fn us_listen_socket_on_server_name(
        ls: &mut ListenSocket,
        cb: extern "C" fn(*mut ListenSocket, *const c_char, *mut c_int, *mut c_void) -> *mut c_void,
    );
}
