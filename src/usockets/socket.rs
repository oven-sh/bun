//! Port of `packages/bun-usockets/src/socket.c`.
//!
//! Public `us_socket_*` / `us_connecting_socket_*` ABI. Every function that
//! appears in `libusockets.h` or is called cross-file keeps its exact C
//! signature so uWebSockets (C++) and the rest of the runtime keep linking.

#![allow(dead_code, unused_imports)]

use core::ffi::{c_char, c_int, c_uchar, c_uint, c_void};
use core::mem::{MaybeUninit, size_of, zeroed};
use core::ptr;

#[cfg(not(windows))]
use crate::bsd::bsd_sendmsg;
use crate::bsd::{
    apple_no_sigpipe, bsd_addr_get_ip, bsd_addr_get_ip_length, bsd_addr_get_port, bsd_close_socket,
    bsd_local_addr, bsd_remote_addr, bsd_send, bsd_send_is_transient_error, bsd_set_nonblocking,
    bsd_shutdown_socket, bsd_shutdown_socket_read, bsd_socket_flush, bsd_socket_get_tos,
    bsd_socket_keepalive, bsd_socket_nodelay, bsd_socket_set_tos, bsd_would_block, bsd_write2,
    bsd_writev, ssize_t,
};
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
use crate::eventing::us_internal_loop_update_pending_ready_polls;
use crate::eventing::{
    LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE, us_create_poll, us_internal_poll_set_type,
    us_internal_poll_type, us_loop_t, us_poll_change, us_poll_events, us_poll_fd, us_poll_free,
    us_poll_init, us_poll_start_rc, us_poll_stop, us_poll_t,
};
use crate::types::{
    Bun__addrinfo_cancel, Bun__addrinfo_freeRequest, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET,
    LIBUS_SOCKET_DESCRIPTOR, POLL_TYPE_SEMI_SOCKET, POLL_TYPE_SOCKET, POLL_TYPE_SOCKET_SHUT_DOWN,
    bsd_addr_t, us_connecting_socket_t, us_dispatch_close, us_dispatch_connecting_error,
    us_dispatch_open, us_iovec_t, us_listen_socket_t, us_socket_group_t, us_socket_t,
};

// ═══════════════════════════════════════════════════════════════════════════
// Cross-file us_internal_* (context.rs, ssl/*.rs, eventing/*.rs)
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn us_internal_socket_group_link_socket(group: *mut us_socket_group_t, s: *mut us_socket_t);
    fn us_internal_socket_group_unlink_socket(group: *mut us_socket_group_t, s: *mut us_socket_t);
    fn us_internal_socket_group_unlink_connecting_socket(
        group: *mut us_socket_group_t,
        c: *mut us_connecting_socket_t,
    );
    fn us_internal_group_maybe_unlink(group: *mut us_socket_group_t);

    fn us_internal_ssl_is_handshake_finished(s: *mut us_socket_t) -> c_int;
    fn us_internal_ssl_handshake_callback_has_fired(s: *mut us_socket_t) -> c_int;
    fn us_internal_ssl_close(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_on_close(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut c_char,
        ip_length: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_detach(s: *mut us_socket_t);
    fn us_internal_ssl_attach(
        s: *mut us_socket_t,
        ssl_ctx: *mut bun_boringssl_sys::SSL_CTX,
        is_client: c_int,
        sni: *const c_char,
        listener: *mut us_listen_socket_t,
    );
    fn us_internal_ssl_ctx_unref(ssl_ctx: *mut bun_boringssl_sys::SSL_CTX);
    fn us_internal_ssl_get_native_handle(s: *mut us_socket_t) -> *mut c_void;
    fn us_internal_ssl_write(s: *mut us_socket_t, data: *const c_char, length: c_int) -> c_int;
    fn us_internal_ssl_is_shut_down(s: *mut us_socket_t) -> c_int;
    fn us_internal_ssl_shutdown(s: *mut us_socket_t);
}

// ═══════════════════════════════════════════════════════════════════════════
// errno constants — C's <errno.h> values (identical on MSVC and POSIX here)
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
const ECONNABORTED: c_int = libc::ECONNABORTED;
#[cfg(not(windows))]
const ECONNREFUSED: c_int = libc::ECONNREFUSED;
#[cfg(not(windows))]
const EBADF: c_int = libc::EBADF;

#[cfg(windows)]
const ECONNABORTED: c_int = 106;
#[cfg(windows)]
const ECONNREFUSED: c_int = 107;
#[cfg(windows)]
const EBADF: c_int = 9;

// ═══════════════════════════════════════════════════════════════════════════
// Local helpers
// ═══════════════════════════════════════════════════════════════════════════

#[inline(always)]
unsafe fn poll_of(s: *mut us_socket_t) -> *mut us_poll_t {
    // SAFETY: `us_socket_t` begins with a `us_poll_t` field (`repr(C)`).
    s.cast()
}

#[inline(always)]
unsafe fn group_loop(s: *mut us_socket_t) -> *mut us_loop_t {
    // SAFETY: caller guarantees `s` is live and still linked to a group.
    unsafe { (*(*s).group).loop_ }
}

/// Unlink `s` from the loop's low-priority queue (`loop->data.low_prio_head`).
/// Mirrors the identical block in `us_internal_socket_close_raw` and
/// `us_socket_detach`.
unsafe fn unlink_from_low_prio_queue(s: *mut us_socket_t, loop_: *mut us_loop_t) {
    // SAFETY: caller checked `low_prio_state == 1`, so `s` is on the list.
    unsafe {
        if (*s).prev.is_null() {
            (*loop_).data.low_prio_head = (*s).next;
        } else {
            (*(*s).prev).next = (*s).next;
        }
        if !(*s).next.is_null() {
            (*(*s).next).prev = (*s).prev;
        }
        (*s).prev = ptr::null_mut();
        (*s).next = ptr::null_mut();
        (*s).flags.set_low_prio_state(0);
        (*(*s).group).low_prio_count -= 1;
        us_internal_group_maybe_unlink((*s).group);
    }
}

/// `setsockopt(fd, SOL_SOCKET, SO_LINGER, &{1,0}, ...)` — arm RST on close.
#[inline]
unsafe fn set_linger_reset(fd: LIBUS_SOCKET_DESCRIPTOR) {
    #[cfg(not(windows))]
    unsafe {
        let l = libc::linger {
            l_onoff: 1,
            l_linger: 0,
        };
        libc::setsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_LINGER,
            (&raw const l).cast(),
            size_of::<libc::linger>() as libc::socklen_t,
        );
    }
    #[cfg(windows)]
    unsafe {
        #[repr(C)]
        struct linger {
            l_onoff: u16,
            l_linger: u16,
        }
        const SOL_SOCKET: c_int = 0xFFFF;
        const SO_LINGER: c_int = 0x0080;
        #[link(name = "ws2_32")]
        unsafe extern "system" {
            fn setsockopt(
                s: LIBUS_SOCKET_DESCRIPTOR,
                level: c_int,
                optname: c_int,
                optval: *const c_char,
                optlen: c_int,
            ) -> c_int;
        }
        let l = linger {
            l_onoff: 1,
            l_linger: 0,
        };
        setsockopt(
            fd,
            SOL_SOCKET,
            SO_LINGER,
            (&raw const l).cast(),
            size_of::<linger>() as c_int,
        );
    }
}

/// Decrement the loop's "keep-alive" count taken on behalf of a pending
/// DNS resolve (`group->loop->num_polls--` / `uv_loop->active_handles--`).
#[inline]
unsafe fn loop_release_dns_keepalive(loop_: *mut us_loop_t) {
    #[cfg(windows)]
    // SAFETY: caller guarantees `loop_` is live; matches the `++` in connect.
    unsafe {
        (*(*loop_).uv_loop).active_handles -= 1;
    }
    #[cfg(not(windows))]
    // SAFETY: caller guarantees `loop_` is live; matches the `++` in connect.
    unsafe {
        (*loop_).num_polls -= 1;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Address helpers
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_local_port(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket; `bsd_addr_t` is plain data.
    unsafe {
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();
        if bsd_local_addr(us_poll_fd(poll_of(s)), addr.as_mut_ptr()) != 0 {
            -1
        } else {
            bsd_addr_get_port(addr.as_mut_ptr())
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_remote_port(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket; `bsd_addr_t` is plain data.
    unsafe {
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();
        if bsd_remote_addr(us_poll_fd(poll_of(s)), addr.as_mut_ptr()) != 0 {
            -1
        } else {
            bsd_addr_get_port(addr.as_mut_ptr())
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_shutdown_read(s: *mut us_socket_t) {
    // This syscall is idempotent so no extra check is needed.
    // SAFETY: `s` is a live socket.
    unsafe { bsd_shutdown_socket_read(us_poll_fd(poll_of(s))) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_shutdown_read(c: *mut us_connecting_socket_t) {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).set_shutdown_read(true) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_remote_address(
    s: *mut us_socket_t,
    buf: *mut c_char,
    length: *mut c_int,
) {
    // SAFETY: `s`/`buf`/`length` are valid per the `nonnull` C contract.
    unsafe {
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();
        if bsd_remote_addr(us_poll_fd(poll_of(s)), addr.as_mut_ptr()) != 0
            || *length < bsd_addr_get_ip_length(addr.as_mut_ptr())
        {
            *length = 0;
        } else {
            *length = bsd_addr_get_ip_length(addr.as_mut_ptr());
            ptr::copy_nonoverlapping(bsd_addr_get_ip(addr.as_mut_ptr()), buf, *length as usize);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_local_address(
    s: *mut us_socket_t,
    buf: *mut c_char,
    length: *mut c_int,
) {
    // SAFETY: `s`/`buf`/`length` are valid per the `nonnull` C contract.
    unsafe {
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();
        if bsd_local_addr(us_poll_fd(poll_of(s)), addr.as_mut_ptr()) != 0
            || *length < bsd_addr_get_ip_length(addr.as_mut_ptr())
        {
            *length = 0;
        } else {
            *length = bsd_addr_get_ip_length(addr.as_mut_ptr());
            ptr::copy_nonoverlapping(bsd_addr_get_ip(addr.as_mut_ptr()), buf, *length as usize);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Trivial accessors
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group(s: *mut us_socket_t) -> *mut us_socket_group_t {
    // SAFETY: `s` is a live socket.
    unsafe { (*s).group }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_kind(s: *mut us_socket_t) -> c_uchar {
    // SAFETY: `s` is a live socket.
    unsafe { (*s).kind }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_set_kind(s: *mut us_socket_t, kind: c_uchar) {
    // SAFETY: `s` is a live socket.
    unsafe { (*s).kind = kind };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_set_ssl_raw_tap(s: *mut us_socket_t, enabled: c_int) {
    // SAFETY: `s` is a live socket.
    unsafe { (*s).set_ssl_raw_tap(enabled != 0) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_is_tls(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe { (!(*s).ssl.is_null()) as c_int }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_group(
    c: *mut us_connecting_socket_t,
) -> *mut us_socket_group_t {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).group }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_kind(c: *mut us_connecting_socket_t) -> c_uchar {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).kind }
}

// ═══════════════════════════════════════════════════════════════════════════
// Timeouts
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_timeout(s: *mut us_socket_t, seconds: c_uint) {
    // SAFETY: `s` is live and `s->group` is a valid pointer.
    unsafe {
        (*s).timeout = if seconds != 0 {
            (((*(*s).group).timestamp as c_uint + ((seconds + 3) >> 2)) % 240) as u8
        } else {
            255
        };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_timeout(
    c: *mut us_connecting_socket_t,
    seconds: c_uint,
) {
    // SAFETY: `c` is live and `c->group` is a valid pointer.
    unsafe {
        (*c).timeout = if seconds != 0 {
            (((*(*c).group).timestamp as c_uint + ((seconds + 3) >> 2)) % 240) as u8
        } else {
            255
        };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_long_timeout(s: *mut us_socket_t, minutes: c_uint) {
    // SAFETY: `s` is live and `s->group` is a valid pointer.
    unsafe {
        (*s).long_timeout = if minutes != 0 {
            (((*(*s).group).long_timestamp as c_uint + minutes) % 240) as u8
        } else {
            255
        };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_long_timeout(
    c: *mut us_connecting_socket_t,
    minutes: c_uint,
) {
    // SAFETY: `c` is live and `c->group` is a valid pointer.
    unsafe {
        (*c).long_timeout = if minutes != 0 {
            (((*(*c).group).long_timestamp as c_uint + minutes) % 240) as u8
        } else {
            255
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Flush / closed / established
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_flush(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket.
    unsafe {
        if us_socket_is_shut_down(s) == 0 {
            bsd_socket_flush(us_poll_fd(poll_of(s)));
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_is_closed(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe { (*s).flags.is_closed() as c_int }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_is_ssl_handshake_finished(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_is_handshake_finished(s);
        }
    }
    1
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_ssl_handshake_callback_has_fired(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_handshake_callback_has_fired(s);
        }
    }
    1
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_is_closed(c: *mut us_connecting_socket_t) -> c_int {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).closed() as c_int }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_is_established(s: *mut us_socket_t) -> c_int {
    // Everything that is not POLL_TYPE_SEMI_SOCKET is established.
    // SAFETY: `s` is a live socket.
    unsafe { (us_internal_poll_type(poll_of(s)) != POLL_TYPE_SEMI_SOCKET) as c_int }
}

// ═══════════════════════════════════════════════════════════════════════════
// us_connecting_socket_t teardown
// ═══════════════════════════════════════════════════════════════════════════

/// Detach `c` from its group + drop the borrowed SSL_CTX ref, but leave `c`
/// allocated. After this `c->group` is null; the only remaining link is into a
/// loop-owned list.
unsafe fn us_internal_connecting_socket_detach(
    c: *mut us_connecting_socket_t,
    _loop: *mut us_loop_t,
) {
    // SAFETY: `c` is live; group/ssl_ctx may be null (idempotent).
    unsafe {
        if !(*c).group.is_null() {
            us_internal_socket_group_unlink_connecting_socket((*c).group, c);
            (*c).group = ptr::null_mut();
        }
        if !(*c).ssl_ctx.is_null() {
            us_internal_ssl_ctx_unref((*c).ssl_ctx);
            (*c).ssl_ctx = ptr::null_mut();
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_free(c: *mut us_connecting_socket_t) {
    // We can't free `c` immediately — it may be enqueued in dns_ready_head.
    // Move it to the close list and free after the iteration.
    // SAFETY: `c` is live; `c->loop_` outlives `c`.
    unsafe {
        us_internal_connecting_socket_detach(c, (*c).loop_);
        (*c).next = (*(*c).loop_).data.closed_connecting_head;
        (*(*c).loop_).data.closed_connecting_head = c;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_close(c: *mut us_connecting_socket_t) {
    // SAFETY: `c` is live; sockets on `connecting_head` share its loop.
    unsafe {
        if (*c).closed() {
            return;
        }
        (*c).set_closed(true);

        let mut s = (*c).connecting_head;
        while !s.is_null() {
            let group = (*s).group;
            us_internal_socket_group_unlink_socket(group, s);
            us_poll_stop(poll_of(s), (*group).loop_);
            bsd_close_socket(us_poll_fd(poll_of(s)));
            // Link to the close-list; deleted after this iteration.
            (*s).next = (*(*group).loop_).data.closed_head;
            (*(*group).loop_).data.closed_head = s;
            (*s).flags.set_is_closed(true);
            s = (*s).connect_next;
        }

        if (*c).error == 0 {
            // No error recorded → we were aborted (caller called close).
            (*c).error = ECONNABORTED;
        }
        let group = (*c).group;

        if (*c).pending_resolve_callback() {
            // DNS callback not drained. Try to remove `c` from the request's
            // notify list so it never fires. Returns 0 if the result is already
            // set (callback fired or is about to).
            if !(*c).addrinfo_req.is_null() && Bun__addrinfo_cancel((*c).addrinfo_req, c) != 0 {
                loop_release_dns_keepalive((*group).loop_);
                (*c).set_pending_resolve_callback(false);
                Bun__addrinfo_freeRequest((*c).addrinfo_req, 0);
                (*c).addrinfo_req = ptr::null_mut();
                us_dispatch_connecting_error(c, (*c).error);
                us_connecting_socket_free(c);
            } else {
                // Can't cancel — the resolve callback is already queued. Detach
                // from the group NOW so the owner can deinit; after_resolve will
                // see c->closed and only push to the loop's closed list.
                loop_release_dns_keepalive((*group).loop_);
                us_dispatch_connecting_error(c, (*c).error);
                us_internal_connecting_socket_detach(c, (*group).loop_);
            }
            return;
        }

        if !(*c).addrinfo_req.is_null() {
            // Invalidate the cache entry for a refused connect (addresses may be
            // stale) and for a resolver failure (never cache a negative result).
            Bun__addrinfo_freeRequest(
                (*c).addrinfo_req,
                ((*c).error == ECONNREFUSED || (*c).error_is_dns()) as c_int,
            );
            (*c).addrinfo_req = ptr::null_mut();
        }
        us_dispatch_connecting_error(c, (*c).error);
        us_connecting_socket_free(c);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Close / detach
// ═══════════════════════════════════════════════════════════════════════════

/// Tear the fd down + dispatch on_close. Bypasses the SSL layer — public
/// `us_socket_close` routes through `us_internal_ssl_close` first so a
/// client-initiated close sends close_notify; openssl.c re-enters here once
/// that graceful path is done.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_close_raw(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    // SAFETY: `s` is a live socket; group/loop are valid while not is_closed.
    unsafe {
        if !(*s).ssl.is_null() && (*s).ssl_in_use() {
            // A JS callback running from inside SSL_do_handshake/SSL_read
            // destroyed this socket. Defer the close to the SSL driver's
            // epilogue so BoringSSL's stack isn't freed under it.
            (*s).set_ssl_pending_detach(true);
            (*s).ssl_pending_close_code = code as u8;
            return s;
        }
        if us_socket_is_closed(s) != 0 {
            return s;
        }

        let loop_ = group_loop(s);

        if (*s).flags.low_prio_state() == 1 {
            unlink_from_low_prio_queue(s, loop_);
        } else {
            us_internal_socket_group_unlink_socket((*s).group, s);
        }

        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
        {
            // kqueue automatically removes the fd from the set on close —
            // skip the system call for that case.
            us_internal_loop_update_pending_ready_polls(
                loop_,
                poll_of(s),
                ptr::null_mut(),
                us_poll_events(poll_of(s)),
                0,
            );
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "freebsd")))]
        {
            // Disable any instance of us in the pending ready poll list.
            us_poll_stop(poll_of(s), loop_);
        }

        if code == LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET {
            // Prevent entering TIME_WAIT state when forcefully closing.
            set_linger_reset(us_poll_fd(poll_of(s)));
        }

        bsd_close_socket(us_poll_fd(poll_of(s)));

        (*s).flags.set_is_closed(true);

        // SEMI_SOCKET: never-opened connect — owner is notified via
        // on_connect_error from the connect path, not here. Dispatching here
        // would double-fire on the natural path.
        let mut res = s;
        if (us_internal_poll_type(poll_of(s)) & POLL_TYPE_SEMI_SOCKET) == 0 {
            res = if !(*s).ssl.is_null() {
                us_internal_ssl_on_close(s, code, reason)
            } else {
                us_dispatch_close(s, code, reason)
            };
        }

        us_internal_ssl_detach(s);

        // Link to the close-list; deleted after this iteration.
        (*s).next = (*loop_).data.closed_head;
        (*loop_).data.closed_head = s;

        res
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_close(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() && us_socket_is_closed(s) == 0 {
            return us_internal_ssl_close(s, code, reason);
        }
        us_internal_socket_close_raw(s, code, reason)
    }
}

/// Same as `us_socket_close` but does not emit on_close and does not close the fd.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_detach(s: *mut us_socket_t) -> *mut us_socket_t {
    // SAFETY: `s` is a live socket; group/loop are valid while not is_closed.
    unsafe {
        if us_socket_is_closed(s) != 0 {
            return s;
        }
        let loop_ = group_loop(s);

        if (*s).flags.low_prio_state() == 1 {
            unlink_from_low_prio_queue(s, loop_);
        } else {
            us_internal_socket_group_unlink_socket((*s).group, s);
        }
        us_poll_stop(poll_of(s), loop_);

        us_internal_ssl_detach(s);

        (*s).next = (*loop_).data.closed_head;
        (*loop_).data.closed_head = s;

        (*s).flags.set_is_closed(true);
    }
    s
}

// ═══════════════════════════════════════════════════════════════════════════
// socketpair / from_fd
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_pair(
    group: *mut us_socket_group_t,
    kind: c_uchar,
    socket_ext_size: c_int,
    fds: *mut LIBUS_SOCKET_DESCRIPTOR,
) -> *mut us_socket_t {
    #[cfg(windows)]
    {
        let _ = (group, kind, socket_ext_size, fds);
        ptr::null_mut()
    }
    #[cfg(not(windows))]
    // SAFETY: `fds` points at an array of 2 descriptors per the C contract.
    unsafe {
        if libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, fds) != 0 {
            return ptr::null_mut();
        }
        us_socket_from_fd(group, kind, ptr::null_mut(), socket_ext_size, *fds, 0)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_from_fd(
    group: *mut us_socket_group_t,
    kind: c_uchar,
    ssl_ctx: *mut bun_boringssl_sys::SSL_CTX,
    socket_ext_size: c_int,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    ipc: c_int,
) -> *mut us_socket_t {
    #[cfg(windows)]
    {
        let _ = (group, kind, ssl_ctx, socket_ext_size, fd, ipc);
        ptr::null_mut()
    }
    #[cfg(not(windows))]
    // SAFETY: `group` is a live group; the allocated poll owns its fd.
    unsafe {
        let p1 = us_create_poll(
            (*group).loop_,
            0,
            (size_of::<us_socket_t>() + socket_ext_size as usize) as c_uint,
        );
        us_poll_init(p1, fd, POLL_TYPE_SOCKET);
        let rc = us_poll_start_rc(
            p1,
            (*group).loop_,
            LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
        );
        if rc != 0 {
            us_poll_free(p1, (*group).loop_);
            return ptr::null_mut();
        }

        let s = p1 as *mut us_socket_t;
        (*s).group = group;
        (*s).kind = kind;
        (*s).ssl = ptr::null_mut();
        (*s).timeout = 255;
        (*s).long_timeout = 255;
        (*s).flags.set_low_prio_state(0);
        (*s).flags.set_allow_half_open(false);
        (*s).flags.set_is_paused(false);
        (*s).flags.set_is_ipc(ipc != 0);
        (*s).flags.set_is_closed(false);
        (*s).flags.set_adopted(false);
        (*s).connect_state = ptr::null_mut();

        // We always use nodelay.
        bsd_socket_nodelay(fd, 1);
        apple_no_sigpipe(fd);
        bsd_set_nonblocking(fd);
        us_internal_socket_group_link_socket(group, s);

        // Bun.connect({fd, tls}) hands us an already-connected fd that should
        // speak TLS from the first byte. The IPC path passes ssl_ctx == NULL.
        if !ssl_ctx.is_null() {
            us_internal_ssl_attach(s, ssl_ctx, 1, ptr::null(), ptr::null_mut());
        }

        s
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Writes
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_write2(
    s: *mut us_socket_t,
    header: *const c_char,
    header_length: c_int,
    payload: *const c_char,
    payload_length: c_int,
) -> c_int {
    // SAFETY: `s` is a live socket; pointers are valid for their lengths.
    unsafe {
        if us_socket_is_closed(s) != 0 || us_socket_is_shut_down(s) != 0 {
            return 0;
        }
        let written = bsd_write2(
            us_poll_fd(poll_of(s)),
            header,
            header_length,
            payload,
            payload_length,
        );
        if written != (header_length + payload_length) as ssize_t {
            us_poll_change(
                poll_of(s),
                group_loop(s),
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
            );
        }
        if written < 0 { 0 } else { written as c_int }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_get_native_handle(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_get_native_handle(s);
        }
        us_poll_fd(poll_of(s)) as usize as *mut c_void
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_get_native_handle(
    _c: *mut us_connecting_socket_t,
) -> *mut c_void {
    usize::MAX as *mut c_void
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_write(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
) -> c_int {
    // SAFETY: `s` is a live socket; `data` is valid for `length` bytes.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_write(s, data, length);
        }
        if us_socket_is_closed(s) != 0 || us_socket_is_shut_down(s) != 0 {
            return 0;
        }
        let written = bsd_send(us_poll_fd(poll_of(s)), data, length);
        if written != length as ssize_t {
            (*s).flags.set_last_write_failed(true);
            us_poll_change(
                poll_of(s),
                group_loop(s),
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
            );
        }
        if written < 0 { 0 } else { written as c_int }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_write_check_error(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
    fatal_write_error: *mut c_int,
) -> c_int {
    // SAFETY: `s` is a live socket; `fatal_write_error` may be null.
    unsafe {
        if !fatal_write_error.is_null() {
            *fatal_write_error = 0;
        }
        if us_socket_is_closed(s) != 0 || us_socket_is_shut_down(s) != 0 {
            return 0;
        }
        if !(*s).ssl.is_null() {
            // TLS writes have their own error propagation; keep the existing path.
            return us_socket_write(s, data, length);
        }

        let written = bsd_send(us_poll_fd(poll_of(s)), data, length);
        if written < 0 {
            // ENOBUFS/ENOMEM are transient kernel resource exhaustion on a
            // healthy connection — not fatal.
            if bsd_would_block() != 0 || bsd_send_is_transient_error() != 0 {
                (*s).flags.set_last_write_failed(true);
                us_poll_change(
                    poll_of(s),
                    group_loop(s),
                    LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
                );
                return 0;
            }
            // Fatal send error (EPIPE/ECONNRESET): report to opted-in callers
            // and do not keep polling writable — retrying can never succeed.
            if !fatal_write_error.is_null() {
                *fatal_write_error = 1;
            }
            return 0;
        }
        if written != length as ssize_t {
            (*s).flags.set_last_write_failed(true);
            us_poll_change(
                poll_of(s),
                group_loop(s),
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
            );
        }
        written as c_int
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_raw_writev(
    s: *mut us_socket_t,
    iov: *const us_iovec_t,
    count: c_int,
) -> c_int {
    // SAFETY: `s` is a live socket; `iov` is an array of `count` entries.
    unsafe {
        if us_socket_is_closed(s) != 0
            || us_internal_poll_type(poll_of(s)) == POLL_TYPE_SOCKET_SHUT_DOWN
        {
            return 0;
        }

        let mut total: usize = 0;
        for i in 0..count as usize {
            total += (*iov.add(i)).iov_len;
        }

        let written = bsd_writev(us_poll_fd(poll_of(s)), iov, count);
        if written != total as ssize_t {
            (*s).flags.set_last_write_failed(true);
            us_poll_change(
                poll_of(s),
                group_loop(s),
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
            );
        }
        if written < 0 { 0 } else { written as c_int }
    }
}

/// Bypass-TLS write: gates only on fd close and TCP-level FIN, so openssl.c
/// can flush close_notify after the SSL layer is already marked shut down.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_raw_write(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
) -> c_int {
    // SAFETY: `s` is a live socket; `data` is valid for `length` bytes.
    unsafe {
        if us_socket_is_closed(s) != 0
            || us_internal_poll_type(poll_of(s)) == POLL_TYPE_SOCKET_SHUT_DOWN
        {
            return 0;
        }
        let written = bsd_send(us_poll_fd(poll_of(s)), data, length);
        if written != length as ssize_t {
            (*s).flags.set_last_write_failed(true);
            us_poll_change(
                poll_of(s),
                group_loop(s),
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
            );
        }
        if written < 0 { 0 } else { written as c_int }
    }
}

/// Send data with an attached fd via SCM_RIGHTS, for IPC. Returns bytes
/// written; if less than `length`, the fd was not sent.
#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_ipc_write_fd(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
    fd: c_int,
) -> c_int {
    // SAFETY: `s` is a live socket on a UNIX-domain fd; `data` valid for `length`.
    unsafe {
        if us_socket_is_closed(s) != 0 || us_socket_is_shut_down(s) != 0 {
            return 0;
        }

        let mut msg: libc::msghdr = zeroed();
        let mut iov: libc::iovec = zeroed();
        // cmsghdr-aligned scratch large enough for CMSG_SPACE(sizeof(int)) on
        // every supported target (≤ 24 bytes).
        #[repr(C)]
        union CmsgBuf {
            _align: [libc::cmsghdr; 0],
            buf: [u8; 32],
        }
        let mut cmsgbuf: CmsgBuf = zeroed();
        let cmsg_space = libc::CMSG_SPACE(size_of::<c_int>() as u32) as usize;
        debug_assert!(cmsg_space <= size_of::<CmsgBuf>());

        iov.iov_base = data as *mut c_void;
        iov.iov_len = length as usize;

        msg.msg_iov = &mut iov;
        msg.msg_iovlen = 1 as _;
        msg.msg_control = cmsgbuf.buf.as_mut_ptr().cast();
        msg.msg_controllen = cmsg_space as _;

        let cmsg = libc::CMSG_FIRSTHDR(&msg);
        (*cmsg).cmsg_level = libc::SOL_SOCKET;
        (*cmsg).cmsg_type = libc::SCM_RIGHTS;
        (*cmsg).cmsg_len = libc::CMSG_LEN(size_of::<c_int>() as u32) as _;
        ptr::write_unaligned(libc::CMSG_DATA(cmsg) as *mut c_int, fd);

        let sent = bsd_sendmsg(us_poll_fd(poll_of(s)), &msg, 0);
        if sent != length as ssize_t {
            (*s).flags.set_last_write_failed(true);
            us_poll_change(
                poll_of(s),
                group_loop(s),
                LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
            );
        }
        if sent < 0 { 0 } else { sent as c_int }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ext pointers
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_ext(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: `s` was allocated with trailing ext storage.
    unsafe { s.add(1).cast() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_ext(c: *mut us_connecting_socket_t) -> *mut c_void {
    // SAFETY: `c` was allocated with trailing ext storage.
    unsafe { c.add(1).cast() }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shutdown
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_is_shut_down(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_is_shut_down(s);
        }
        (us_internal_poll_type(poll_of(s)) == POLL_TYPE_SOCKET_SHUT_DOWN) as c_int
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_is_shut_down(
    c: *mut us_connecting_socket_t,
) -> c_int {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).shutdown() as c_int }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_raw_shutdown(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket; group/loop are valid while not is_closed.
    unsafe {
        if us_socket_is_closed(s) == 0
            && us_internal_poll_type(poll_of(s)) != POLL_TYPE_SOCKET_SHUT_DOWN
        {
            us_internal_poll_set_type(poll_of(s), POLL_TYPE_SOCKET_SHUT_DOWN);
            us_poll_change(
                poll_of(s),
                group_loop(s),
                us_poll_events(poll_of(s)) & LIBUS_SOCKET_READABLE,
            );
            bsd_shutdown_socket(us_poll_fd(poll_of(s)));
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_shutdown(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() {
            us_internal_ssl_shutdown(s);
            return;
        }
        us_internal_socket_raw_shutdown(s);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_shutdown(c: *mut us_connecting_socket_t) {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).set_shutdown(true) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_get_error(c: *mut us_connecting_socket_t) -> c_int {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).error }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_get_dns_error(
    c: *mut us_connecting_socket_t,
) -> c_int {
    // SAFETY: `c` is a live connecting socket.
    unsafe { if (*c).error_is_dns() { (*c).error } else { 0 } }
}

// ═══════════════════════════════════════════════════════════════════════════
// Open
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_open(
    s: *mut us_socket_t,
    is_client: c_int,
    ip: *mut c_char,
    ip_length: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_on_open(s, is_client, ip, ip_length);
        }
        us_dispatch_open(s, is_client, ip, ip_length)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Address info (for Bun.serve().requestIP())
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_get_remote_address_info(
    buf: *mut c_char,
    s: *mut us_socket_t,
    _dest: *mut *const c_char,
    port: *mut c_int,
    _is_ipv6: *mut c_int,
) -> c_uint {
    // SAFETY: `s`/`buf`/`port` are valid per the C contract.
    unsafe {
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();
        if bsd_remote_addr(us_poll_fd(poll_of(s)), addr.as_mut_ptr()) != 0 {
            return 0;
        }
        let length = bsd_addr_get_ip_length(addr.as_mut_ptr());
        if length == 0 {
            return 0;
        }
        ptr::copy_nonoverlapping(bsd_addr_get_ip(addr.as_mut_ptr()), buf, length as usize);
        *port = bsd_addr_get_port(addr.as_mut_ptr());
        length as c_uint
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_get_local_address_info(
    buf: *mut c_char,
    s: *mut us_socket_t,
    _dest: *mut *const c_char,
    port: *mut c_int,
    _is_ipv6: *mut c_int,
) -> c_uint {
    // SAFETY: `s`/`buf`/`port` are valid per the C contract.
    unsafe {
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();
        if bsd_local_addr(us_poll_fd(poll_of(s)), addr.as_mut_ptr()) != 0 {
            return 0;
        }
        let length = bsd_addr_get_ip_length(addr.as_mut_ptr());
        if length == 0 {
            return 0;
        }
        ptr::copy_nonoverlapping(bsd_addr_get_ip(addr.as_mut_ptr()), buf, length as usize);
        *port = bsd_addr_get_port(addr.as_mut_ptr());
        length as c_uint
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ref / unref (libuv only), nodelay, keepalive, tos
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_ref(s: *mut us_socket_t) {
    #[cfg(windows)]
    // SAFETY: `s` is a live socket whose poll owns a uv_poll_t.
    unsafe {
        bun_libuv_sys::uv_ref((*s).p.uv_p.cast());
    }
    #[cfg(not(windows))]
    let _ = s;
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_unref(s: *mut us_socket_t) {
    #[cfg(windows)]
    // SAFETY: `s` is a live socket whose poll owns a uv_poll_t.
    unsafe {
        bun_libuv_sys::uv_unref((*s).p.uv_p.cast());
    }
    #[cfg(not(windows))]
    let _ = s;
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_nodelay(s: *mut us_socket_t, enabled: c_int) {
    // SAFETY: `s` is a live socket.
    unsafe {
        if us_socket_is_shut_down(s) == 0 {
            bsd_socket_nodelay(us_poll_fd(poll_of(s)), enabled);
        }
    }
}

/// Returns 0 on success or a negative platform errno.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_set_tos(s: *mut us_socket_t, tos: c_int) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe {
        if us_socket_is_closed(s) != 0 {
            return -EBADF;
        }
        bsd_socket_set_tos(us_poll_fd(poll_of(s)), tos)
    }
}

/// Returns the current TOS / traffic class (>= 0) or a negative platform errno.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_get_tos(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe {
        if us_socket_is_closed(s) != 0 {
            return -EBADF;
        }
        bsd_socket_get_tos(us_poll_fd(poll_of(s)))
    }
}

/// Returns 0 on success. Platform-specific error codes on failure.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_keepalive(
    s: *mut us_socket_t,
    enabled: c_int,
    delay: c_uint,
) -> c_int {
    // SAFETY: `s` is a live socket.
    unsafe {
        if us_socket_is_shut_down(s) == 0 {
            return bsd_socket_keepalive(us_poll_fd(poll_of(s)), enabled, delay);
        }
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_connecting_socket_get_loop(
    c: *mut us_connecting_socket_t,
) -> *mut us_loop_t {
    // SAFETY: `c` is a live connecting socket.
    unsafe { (*c).loop_ }
}

// ═══════════════════════════════════════════════════════════════════════════
// pause / resume
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_pause(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket.
    unsafe {
        if (*s).flags.is_paused() {
            return;
        }
        if us_socket_is_closed(s) != 0 {
            return;
        }
        us_poll_change(poll_of(s), group_loop(s), LIBUS_SOCKET_WRITABLE);
        (*s).flags.set_is_paused(true);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_resume(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket.
    unsafe {
        if !(*s).flags.is_paused() {
            return;
        }
        (*s).flags.set_is_paused(false);
        if us_socket_is_closed(s) != 0 {
            return;
        }
        if us_socket_is_shut_down(s) != 0 {
            // FIN already sent — resume only the readable side.
            us_poll_change(poll_of(s), group_loop(s), LIBUS_SOCKET_READABLE);
            return;
        }
        us_poll_change(
            poll_of(s),
            group_loop(s),
            LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
        );
    }
}
