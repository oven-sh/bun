use core::ffi::{c_char, c_int, c_void};

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

    /// Group accepted sockets are linked into.
    pub fn group(&mut self) -> &mut SocketGroup {
        // SAFETY: self is a valid listen socket; C returns a non-null group.
        unsafe { &mut *us_listen_socket_group(self) }
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

    /// Install `H` as this listener's dynamic SNI resolver (runs first for
    /// every ClientHello carrying a servername; see `us_select_cert_cb`).
    pub fn on_server_name<H: ServerNameHandler>(&mut self) {
        us_listen_socket_on_server_name(self, listen_server_name_thunk::<H>)
    }
}

/// What a dynamic SNI resolver decided for one ClientHello.
pub enum SniDecision {
    /// No dynamic selection: fall through to the static SNI tree, then the
    /// default context.
    Default,
    /// Serve this context for the in-flight handshake. The reference is
    /// handed to the C side, which installs it (`SSL_set_SSL_CTX` takes its
    /// own) and releases this one.
    Context(bun_boringssl_sys::OwnedSslCtx),
    /// The resolver is asynchronous: suspend the handshake until
    /// `us_socket_sni_resolve`.
    Suspend,
    /// Drop the connection without an alert.
    Abort,
}

impl SniDecision {
    /// Encode into the `(SSL_CTX*, *abort_handshake)` pair `openssl.c` reads.
    fn into_c(self, abort_handshake: *mut c_int) -> *mut SslCtx {
        let (ctx, abort) = match self {
            SniDecision::Default => (core::ptr::null_mut(), 0),
            SniDecision::Context(ctx) => (ctx.into_raw(), 0),
            SniDecision::Suspend => (core::ptr::null_mut(), 2),
            SniDecision::Abort => (core::ptr::null_mut(), 1),
        };
        if abort != 0 && !abort_handshake.is_null() {
            // SAFETY: `openssl.c` passes the address of its local
            // `abort_handshake` for the duration of the callback.
            unsafe { *abort_handshake = abort };
        }
        ctx
    }
}

/// A dynamic SNI resolver: the listener-level one registered with
/// [`ListenSocket::on_server_name`], or the socket-level one registered with
/// [`us_socket_t::on_server_name`] for a server-side socket adopted into TLS
/// (no listen socket).
pub trait ServerNameHandler {
    /// `socket` is the accepted socket whose ClientHello asked for `hostname`.
    fn resolve(socket: &mut us_socket_t, hostname: &core::ffi::CStr) -> SniDecision;
}

extern "C" fn listen_server_name_thunk<H: ServerNameHandler>(
    _ls: *mut ListenSocket,
    hostname: *const c_char,
    abort_handshake: *mut c_int,
    socket: *mut c_void,
) -> *mut c_void {
    if hostname.is_null() || socket.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: `openssl.c` passes its NUL-terminated `hostname[256]` buffer,
    // live for the call.
    let hostname = unsafe { core::ffi::CStr::from_ptr(hostname) };
    H::resolve(us_socket_t::opaque_mut(socket.cast()), hostname)
        .into_c(abort_handshake)
        .cast()
}

pub(crate) extern "C" fn socket_server_name_thunk<H: ServerNameHandler>(
    socket: *mut us_socket_t,
    hostname: *const c_char,
    abort_handshake: *mut c_int,
) -> *mut SslCtx {
    if hostname.is_null() || socket.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: `openssl.c` passes its NUL-terminated `hostname[256]` buffer,
    // live for the call.
    let hostname = unsafe { core::ffi::CStr::from_ptr(hostname) };
    H::resolve(us_socket_t::opaque_mut(socket), hostname).into_c(abort_handshake)
}

// This file IS the *_sys crate, so externs live here.
// `ListenSocket` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`, so `&mut
// ListenSocket` is ABI-identical to a non-null pointer; value-typed shims are
// `safe fn`. Shims with nullable raw / ctx ptr stay unsafe.
unsafe extern "C" {
    safe fn us_listen_socket_close(ls: &mut ListenSocket);
    safe fn us_listen_socket_group(ls: &mut ListenSocket) -> *mut SocketGroup;
    safe fn us_listen_socket_get_fd(ls: &mut ListenSocket) -> LIBUS_SOCKET_DESCRIPTOR;
    fn us_listen_socket_add_server_name(
        ls: *mut ListenSocket,
        hostname: *const c_char,
        ssl_ctx: *mut SslCtx,
        user: *mut c_void,
    ) -> c_int;
    fn us_listen_socket_remove_server_name(ls: *mut ListenSocket, hostname: *const c_char);
    safe fn us_listen_socket_on_server_name(
        ls: &mut ListenSocket,
        cb: extern "C" fn(*mut ListenSocket, *const c_char, *mut c_int, *mut c_void) -> *mut c_void,
    );
}
