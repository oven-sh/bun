//! Waiting for one connection's socket without the event loop (stacksjs/bun).
//!
//! `connection.pump(ms)` blocks the calling thread until this connection's
//! socket has something, handles exactly that, and returns. It is what a
//! synchronous query waits with: the loop does not turn, so no other socket,
//! timer or task runs in the middle of the caller's statement. The C half and
//! the reasons are at `us_socket_pump` in `packages/bun-usockets/src/loop.c`.

use core::ffi::{c_int, c_void};

use bun_uws as uws;

unsafe extern "C" {
    fn us_socket_pump(s: *mut c_void, timeout_ms: c_int) -> c_int;
    fn us_connecting_socket_pump(c: *mut c_void, timeout_ms: c_int) -> c_int;
    fn us_internal_dns_prefer_work_pool(prefer: c_int);
}

/// `ms` as `poll()` takes it. Anything that is not a finite number of at
/// least zero is no limit.
pub(crate) fn timeout_ms(ms: f64) -> c_int {
    if ms.is_finite() && ms >= 0.0 {
        ms.ceil().min(f64::from(c_int::MAX)) as c_int
    } else {
        -1
    }
}

/// 1: something was handled. 0: the time passed. -1: there is nothing to
/// wait on (the socket is closed, or is not one of the kernel's).
pub(crate) fn pump(socket: uws::AnySocket, timeout_ms: c_int) -> c_int {
    let internal = match socket {
        uws::AnySocket::SocketTcp(s) => s.socket,
        uws::AnySocket::SocketTls(s) => s.socket,
    };
    match internal {
        // SAFETY: uSockets stores a live socket here until the close callback, which replaces it
        // with `Detached` before the socket is freed (`on_close` of both drivers).
        uws::InternalSocket::Connected(s) => unsafe { us_socket_pump(s.cast(), timeout_ms) },
        // SAFETY: as above, until `on_open` or `on_connect_error`.
        uws::InternalSocket::Connecting(c) => unsafe {
            us_connecting_socket_pump(c.cast(), timeout_ms)
        },
        _ => -1,
    }
}

/// While it lives, a name this thread looks up is resolved on the thread
/// pool, whose answer `pump` can see. The answer of the system resolver that
/// Bun otherwise asks on macOS is only read by a tick of the event loop.
pub(crate) struct ResolveOnWorkPool(());

impl ResolveOnWorkPool {
    pub(crate) fn new() -> Self {
        // SAFETY: counts on a thread-local.
        unsafe { us_internal_dns_prefer_work_pool(1) };
        Self(())
    }
}

impl Drop for ResolveOnWorkPool {
    fn drop(&mut self) {
        // SAFETY: counts on a thread-local.
        unsafe { us_internal_dns_prefer_work_pool(0) };
    }
}
