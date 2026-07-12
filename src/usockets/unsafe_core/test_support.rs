//! Test-only loop helpers + link stubs for in-crate unit tests. The real
//! definitions of the stubbed symbols live outside this crate
//! (bun_threading, src/platform) and are only present in the full bun link;
//! this module exists only in `cargo test -p bun_usockets`.

use crate::loop_::Loop;

/// Bare loop (no pre/post/wakeup callbacks, no ext) for registry tests.
pub(crate) fn create_test_loop() -> *mut Loop {
    super::ffi::create_loop_static(None, None, None, 0)
}

/// Free a loop from [`create_test_loop`] exactly once.
pub(crate) fn free_test_loop(loop_: *mut Loop) {
    // SAFETY: test contract — `loop_` came from `create_test_loop` and is
    // freed exactly once.
    unsafe { super::ffi::free_loop_raw(loop_) }
}

// ── link stubs (ABI mirrors of the extern declarations in ffi.rs /
//    poll_access.rs; single-threaded test binary, so no-op locks are sound) ──

#[unsafe(no_mangle)]
pub extern "C" fn Bun__lock(_ptr: *mut core::ffi::c_void) {}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__unlock(_ptr: *mut core::ffi::c_void) {}

#[unsafe(no_mangle)]
pub static Bun__lock__size: usize = core::mem::size_of::<crate::loop_::LoopDataMutex>();

/// 0 = unsupported: the tick falls back to plain `epoll_pwait`, so the raw
/// `sys_epoll_pwait2` stub below is link-only, never executed.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__isEpollPwait2SupportedOnLinuxKernel() -> i32 {
    0
}

/// Link-only: tests never create TLS transports, so `ssl_free` is unreachable.
#[unsafe(no_mangle)]
pub extern "C" fn SSL_free(_ssl: *mut core::ffi::c_void) {
    unreachable!("test binary must not free SSL handles");
}

/// Link-only: replaces the C++ crash handler pulled in via bun_alloc's OOM path.
#[unsafe(no_mangle)]
pub extern "C" fn __bun_crash_handler_out_of_memory() -> ! {
    std::process::abort();
}

#[unsafe(no_mangle)]
pub extern "C" fn sys_epoll_pwait2(
    _epfd: i32,
    _events: *mut libc::epoll_event,
    _maxevents: i32,
    _timeout: *const libc::timespec,
    _sigmask: *const libc::sigset_t,
) -> isize {
    -(libc::ENOSYS as isize)
}
