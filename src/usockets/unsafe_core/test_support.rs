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

// Runtime hooks reached from group/tick tests (real definitions live in
// bun_runtime / quic.c / JSC glue): no-ops in the single-threaded test binary.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(_loop: *mut Loop) {}

#[unsafe(no_mangle)]
pub extern "C" fn us_quic_loop_process(_loop: *mut Loop) {}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__JSC_onBeforeWait(_vm: *const core::ffi::c_void) {}

// Link-only BoringSSL / DNS surface pulled in by the socket close paths;
// group/tick tests never create TLS transports or DNS lookups, so every one
// of these is unreachable at runtime.
macro_rules! link_stub {
    ($($name:ident),+ $(,)?) => {$(
        #[unsafe(no_mangle)]
        pub extern "C" fn $name() {
            unreachable!(concat!("test binary must not call ", stringify!($name)));
        }
    )+};
}

link_stub!(
    BIO_clear_retry_flags,
    BIO_get_data,
    BIO_get_new_index,
    BIO_meth_new,
    BIO_meth_set_create,
    BIO_meth_set_ctrl,
    BIO_meth_set_read,
    BIO_meth_set_write,
    BIO_set_init,
    BIO_set_retry_read,
    BIO_set_retry_write,
    Bun__addrinfo_cancel,
    Bun__addrinfo_getRequestResult,
    SSL_CTX_get_ex_new_index,
    SSL_get_error,
    SSL_get_ex_new_index,
    SSL_in_init,
    SSL_shutdown,
    SSL_write,
    bun_ssl_ctx_cache_on_free,
    ERR_clear_error,
    ERR_error_string_n,
    ERR_peek_last_error,
    SSL_CIPHER_get_auth_nid,
    SSL_CTX_get_ex_data,
    SSL_CTX_get_verify_mode,
    SSL_SESSION_get_protocol_version,
    SSL_get_current_cipher,
    SSL_get_ex_data,
    SSL_get_peer_certificate,
    SSL_get_session,
    SSL_get_verify_result,
    SSL_session_reused,
    SSL_set_ex_data,
    X509_free,
    X509_verify_cert_error_string,
    us_get_shared_default_ca_store,
    BIO_free,
    BIO_new,
    BIO_set_data,
    Bun__addrinfo_freeRequest,
    SSL_CTX_free,
    SSL_do_handshake,
    SSL_get_SSL_CTX,
    SSL_get_quiet_shutdown,
    SSL_get_shutdown,
    SSL_is_init_finished,
    SSL_new,
    SSL_read,
    SSL_renegotiate,
    SSL_set0_verify_cert_store,
    SSL_set_accept_state,
    SSL_set_bio,
    SSL_set_connect_state,
    SSL_set_renegotiate_mode,
    SSL_set_tlsext_host_name,
    SSL_set_verify,
);
