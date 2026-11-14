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
    fn us_connecting_socket_pump(
        c: *mut c_void,
        timeout_ms: c_int,
        resolve_needs_loop: c_int,
    ) -> c_int;
    fn us_internal_dns_prefer_work_pool(prefer: c_int);
    fn us_internal_dns_take_inflight_join() -> c_int;
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

/// `budget_ms` of what is left before the connection's own timeout fires, and `timeout_ms` of
/// the caller: the one that ends first. Negative is no limit.
pub(crate) fn sooner(timeout_ms: c_int, budget_ms: Option<i64>) -> c_int {
    match budget_ms {
        Some(budget) => {
            let budget = budget.clamp(0, i64::from(c_int::MAX)) as c_int;
            if timeout_ms < 0 || budget < timeout_ms {
                budget
            } else {
                timeout_ms
            }
        }
        None => timeout_ms,
    }
}

/// 1: something was handled. 0: the time passed. -1: there is nothing to
/// wait on (the socket is closed, or is not one of the kernel's, or its address is being
/// looked up in a way only the event loop sees the end of: `resolve_needs_loop`).
pub(crate) fn pump(socket: uws::AnySocket, timeout_ms: c_int, resolve_needs_loop: bool) -> c_int {
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
            us_connecting_socket_pump(c.cast(), timeout_ms, c_int::from(resolve_needs_loop))
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

    /// For a dial that a caller who blocks has started (`wanted`). Any other dial resolves as
    /// it always has.
    pub(crate) fn when(wanted: bool) -> Option<Self> {
        wanted.then(Self::new)
    }
}

/// After a dial was started: whether the lookup of its address ends in a way `pump` cannot see.
/// That is the system resolver of macOS, which a dial uses unless it asked for the thread pool,
/// and which it shares when a lookup of the same name was already under way.
pub(crate) fn resolve_needs_loop(on_work_pool: bool) -> bool {
    // SAFETY: reads and clears a thread-local.
    let joined = unsafe { us_internal_dns_take_inflight_join() } != 0;
    cfg!(target_os = "macos") && (!on_work_pool || joined)
}

impl Drop for ResolveOnWorkPool {
    fn drop(&mut self) {
        // SAFETY: counts on a thread-local.
        unsafe { us_internal_dns_prefer_work_pool(0) };
    }
}
