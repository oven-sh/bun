//! Socket-group / listen / connect lifecycle.
//!
//! Ports `packages/bun-usockets/src/context.c`. Every function that appears in
//! `libusockets.h` or is called cross-TU (`us_internal_*`) is `#[no_mangle]
//! extern "C"` so uWebSockets (C++) keeps linking unchanged.

use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::mem::{size_of, zeroed};
use core::ptr;

use crate::bsd::LIBUS_SOCKET_ERROR;
use crate::eventing::{LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE, us_loop_t, us_poll_t};
use crate::types::{
    Bun__addrinfo_freeRequest, Bun__addrinfo_get, Bun__addrinfo_getRequestResult,
    Bun__addrinfo_set, Bun__outOfMemory, LIBUS_LISTEN_DEFER_ACCEPT, LIBUS_SOCKET_ALLOW_HALF_OPEN,
    LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET,
    LIBUS_SOCKET_DESCRIPTOR, POLL_TYPE_SEMI_SOCKET, POLL_TYPE_SOCKET, addrinfo, addrinfo_request,
    addrinfo_result, ext_of, sockaddr_storage, us_bun_verify_error_t, us_calloc, us_cert_string_t,
    us_connecting_socket_t, us_dispatch_connect_error, us_dispatch_open,
    us_internal_raw_root_certs, us_listen_socket_t, us_socket_group_t, us_socket_t,
    us_socket_vtable_t,
};

use bun_boringssl_sys::SSL_CTX;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CONCURRENT_CONNECTIONS: c_int = 4;

#[cfg(not(windows))]
const ECONNABORTED: c_int = libc::ECONNABORTED;
#[cfg(not(windows))]
const ECONNREFUSED: c_int = libc::ECONNREFUSED;
// MSVCRT <errno.h> values (NOT WSAE* — the C code uses the CRT constants).
#[cfg(windows)]
const ECONNABORTED: c_int = 106;
#[cfg(windows)]
const ECONNREFUSED: c_int = 107;

// ═══════════════════════════════════════════════════════════════════════════
// Platform glue: errno / sockaddr / inet_pton
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
#[inline(always)]
unsafe fn errno_ptr() -> *mut c_int {
    unsafe extern "C" {
        #[cfg_attr(
            any(target_os = "macos", target_os = "ios", target_os = "freebsd"),
            link_name = "__error"
        )]
        #[cfg_attr(target_os = "linux", link_name = "__errno_location")]
        #[cfg_attr(target_os = "android", link_name = "__errno")]
        fn __errno() -> *mut c_int;
    }
    // SAFETY: returns a valid thread-local int* for the calling thread.
    unsafe { __errno() }
}

#[cfg(windows)]
#[inline(always)]
unsafe fn errno_ptr() -> *mut c_int {
    unsafe extern "C" {
        fn _errno() -> *mut c_int;
    }
    // SAFETY: MSVCRT thread-local errno slot.
    unsafe { _errno() }
}

#[inline(always)]
unsafe fn errno() -> c_int {
    // SAFETY: errno_ptr always returns a valid thread-local pointer.
    unsafe { *errno_ptr() }
}

#[inline(always)]
unsafe fn set_errno(e: c_int) {
    // SAFETY: errno_ptr always returns a valid thread-local pointer.
    unsafe { *errno_ptr() = e };
}

#[inline(always)]
const fn htons(n: u16) -> u16 {
    n.to_be()
}

#[cfg(not(windows))]
mod plat {
    use core::ffi::{c_char, c_int, c_void};
    pub(super) use libc::{AF_INET, AF_INET6, sockaddr_in, sockaddr_in6};

    unsafe extern "C" {
        pub(super) fn inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
    }
}

#[cfg(windows)]
mod plat {
    pub(super) use bun_windows_sys::ws2_32::{sockaddr_in, sockaddr_in6};
    use core::ffi::{c_char, c_int, c_void};

    pub(super) const AF_INET: c_int = 2;
    pub(super) const AF_INET6: c_int = 23;

    pub(super) const MSG_PUSH_IMMEDIATE: c_int = 0x20;
    pub(super) const SOCKET_ERROR: c_int = -1;
    pub(super) const WSAEINTR: c_int = 10004;
    pub(super) const WSAEWOULDBLOCK: c_int = 10035;

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        pub(super) fn inet_pton(family: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
        pub(super) fn recv(s: usize, buf: *mut c_char, len: c_int, flags: c_int) -> c_int;
        pub(super) fn WSAGetLastError() -> c_int;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Externs defined in sibling translation units
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    // loop_core.rs
    fn us_internal_loop_link_group(loop_: *mut us_loop_t, group: *mut us_socket_group_t);
    fn us_internal_loop_unlink_group(loop_: *mut us_loop_t, group: *mut us_socket_group_t);
    fn us_internal_enable_sweep_timer(loop_: *mut us_loop_t);
    fn us_internal_disable_sweep_timer(loop_: *mut us_loop_t);

    // socket.rs
    fn us_socket_is_closed(s: *mut us_socket_t) -> c_int;
    fn us_socket_is_shut_down(s: *mut us_socket_t) -> c_int;
    fn us_socket_close(s: *mut us_socket_t, code: c_int, reason: *mut c_void) -> *mut us_socket_t;
    fn us_internal_socket_close_raw(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;
    fn us_connecting_socket_close(c: *mut us_connecting_socket_t);
    fn us_connecting_socket_free(c: *mut us_connecting_socket_t);
    fn us_socket_local_port(s: *mut us_socket_t) -> c_int;
    fn us_socket_timeout(s: *mut us_socket_t, seconds: c_uint);

    // eventing/*.rs
    fn us_create_poll(
        loop_: *mut us_loop_t,
        fallthrough: c_int,
        ext_size: c_uint,
    ) -> *mut us_poll_t;
    fn us_poll_init(p: *mut us_poll_t, fd: LIBUS_SOCKET_DESCRIPTOR, poll_type: c_int);
    fn us_poll_start_rc(p: *mut us_poll_t, loop_: *mut us_loop_t, events: c_int) -> c_int;
    fn us_poll_stop(p: *mut us_poll_t, loop_: *mut us_loop_t);
    fn us_poll_change(p: *mut us_poll_t, loop_: *mut us_loop_t, events: c_int);
    fn us_poll_free(p: *mut us_poll_t, loop_: *mut us_loop_t);
    fn us_poll_fd(p: *mut us_poll_t) -> LIBUS_SOCKET_DESCRIPTOR;
    fn us_poll_resize(
        p: *mut us_poll_t,
        loop_: *mut us_loop_t,
        old_ext_size: c_uint,
        ext_size: c_uint,
    ) -> *mut us_poll_t;
    fn us_internal_poll_type(p: *mut us_poll_t) -> c_int;
    fn us_internal_poll_set_type(p: *mut us_poll_t, poll_type: c_int);

    // bsd.rs
    fn bsd_create_listen_socket(
        host: *const c_char,
        port: c_int,
        options: c_int,
        error: *mut c_int,
    ) -> LIBUS_SOCKET_DESCRIPTOR;
    fn bsd_create_listen_socket_unix(
        path: *const c_char,
        pathlen: usize,
        options: c_int,
        error: *mut c_int,
    ) -> LIBUS_SOCKET_DESCRIPTOR;
    fn bsd_create_connect_socket(
        addr: *mut sockaddr_storage,
        local_addr: *mut sockaddr_storage,
        options: c_int,
    ) -> LIBUS_SOCKET_DESCRIPTOR;
    fn bsd_create_connect_socket_unix(
        server_path: *const c_char,
        pathlen: usize,
        options: c_int,
    ) -> LIBUS_SOCKET_DESCRIPTOR;
    fn bsd_close_socket(fd: LIBUS_SOCKET_DESCRIPTOR);
    fn bsd_socket_nodelay(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: c_int);
    fn bsd_set_defer_accept(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int;

    // ssl/openssl.rs
    fn us_internal_ssl_ctx_up_ref(ssl_ctx: *mut SSL_CTX);
    fn us_internal_ssl_attach(
        s: *mut us_socket_t,
        ssl_ctx: *mut SSL_CTX,
        is_client: c_int,
        sni: *const c_char,
        listener: *mut us_listen_socket_t,
    );
    fn us_internal_ssl_socket_relocated(
        loop_: *mut us_loop_t,
        old_s: *mut us_socket_t,
        new_s: *mut us_socket_t,
    );
    fn us_internal_listen_socket_ssl_free(ls: *mut us_listen_socket_t);
    fn us_internal_ssl_on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut c_char,
        ip_length: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_verify_error(s: *mut us_socket_t) -> us_bun_verify_error_t;
}

// ═══════════════════════════════════════════════════════════════════════════
// Root certs forwarder
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_raw_root_certs(out: *mut *mut us_cert_string_t) -> c_int {
    // SAFETY: thin forwarder; callee validates `out`.
    unsafe { us_internal_raw_root_certs(out) }
}

// ═══════════════════════════════════════════════════════════════════════════
// Group lifecycle
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_init(
    group: *mut us_socket_group_t,
    loop_: *mut us_loop_t,
    vtable: *const us_socket_vtable_t,
    ext: *mut c_void,
) {
    // SAFETY: caller owns the embedding storage for `group`.
    unsafe {
        ptr::write_bytes(group, 0, 1);
        (*group).loop_ = loop_;
        (*group).vtable = vtable;
        (*group).ext = ext;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_deinit(group: *mut us_socket_group_t) {
    // The owner is about to free the embedding storage. Every list head and the
    // low-prio count must be zero or some socket still holds s->group into us —
    // a UAF the caller must close_all() away first.
    // SAFETY: `group` is live for the duration of this call.
    unsafe {
        debug_assert!((*group).head_sockets.is_null());
        debug_assert!((*group).head_connecting_sockets.is_null());
        debug_assert!((*group).head_listen_sockets.is_null());
        debug_assert!((*group).low_prio_count == 0);
        debug_assert!((*group).iterator.is_null());
        if (*group).linked != 0 {
            us_internal_loop_unlink_group((*group).loop_, group);
            (*group).linked = 0;
        }
    }
}

/// Close every connecting/connected socket in the group; if `also_listeners`,
/// close listen sockets too. Process-exit callers pass 0: a us_listen_socket_t
/// is 1:1 owned by a Listener/App that closes it in finalize().
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_close_all_ex(
    group: *mut us_socket_group_t,
    also_listeners: c_int,
) {
    // SAFETY: `group` is live; every close helper handles its own list mutation.
    unsafe {
        if also_listeners != 0 {
            // Listeners first — stops new sockets from being accepted into
            // head_sockets while we're draining it.
            while !(*group).head_listen_sockets.is_null() {
                us_listen_socket_close((*group).head_listen_sockets);
            }
        }

        let mut c = (*group).head_connecting_sockets;
        while !c.is_null() {
            let next_c = (*c).next_pending;
            us_connecting_socket_close(c);
            c = next_c;
        }

        let mut s = (*group).head_sockets;
        while !s.is_null() {
            let next_s = (*s).next;
            if us_internal_poll_type(&mut (*s).p) & POLL_TYPE_SEMI_SOCKET != 0 {
                // In-flight connect — deliver the same on_connect_error the
                // natural failure path would have so the wrapper detaches;
                // then force-close if the handler didn't.
                us_dispatch_connect_error(s, ECONNABORTED);
                if us_socket_is_closed(s) == 0 {
                    us_internal_socket_close_raw(
                        s,
                        LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET,
                        ptr::null_mut(),
                    );
                }
            } else {
                us_socket_close(s, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, ptr::null_mut());
            }
            s = next_s;
        }

        // TLS sockets may have deferred the close above (close_notify +
        // WANT_READ leaves the socket open). Force-drain the rest so no
        // survivor's s->group dangles into freed owner storage.
        while !(*group).head_sockets.is_null() {
            us_internal_socket_close_raw(
                (*group).head_sockets,
                LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET,
                ptr::null_mut(),
            );
        }

        // Sockets parked in the loop-wide low-prio queue aren't in head_sockets
        // (the queue reuses prev/next). Drain ours out now so they don't later
        // deref s->group into freed storage.
        if (*group).low_prio_count != 0 {
            // Leave low_prio_state==1 so us_socket_close takes its low-prio
            // branch (rewires the list before dispatch and decrements the count).
            let ld = &mut (*(*group).loop_).data;
            let mut q = ld.low_prio_head;
            while !q.is_null() {
                let next = (*q).next;
                if (*q).group == group {
                    us_socket_close(q, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN, ptr::null_mut());
                }
                q = next;
            }
            debug_assert!((*group).low_prio_count == 0);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_close_all(group: *mut us_socket_group_t) {
    // SAFETY: forwards to _ex.
    unsafe { us_socket_group_close_all_ex(group, 1) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_timestamp(group: *mut us_socket_group_t) -> c_ushort {
    // SAFETY: `group` is live.
    unsafe { (*group).timestamp as c_ushort }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_loop(group: *mut us_socket_group_t) -> *mut us_loop_t {
    // SAFETY: `group` is live.
    unsafe { (*group).loop_ }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_ext(group: *mut us_socket_group_t) -> *mut c_void {
    // SAFETY: `group` is live.
    unsafe { (*group).ext }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_next(
    group: *mut us_socket_group_t,
) -> *mut us_socket_group_t {
    // SAFETY: `group` is live.
    unsafe { (*group).next }
}

// ═══════════════════════════════════════════════════════════════════════════
// Link / unlink
// ═══════════════════════════════════════════════════════════════════════════

#[inline]
unsafe fn group_is_empty(group: *mut us_socket_group_t) -> bool {
    // SAFETY: `group` is live.
    unsafe {
        (*group).head_sockets.is_null()
            && (*group).head_connecting_sockets.is_null()
            && (*group).head_listen_sockets.is_null()
            && (*group).low_prio_count == 0
    }
}

#[inline]
unsafe fn group_touched(group: *mut us_socket_group_t) {
    // SAFETY: `group` is live; link-in is idempotent via the `linked` flag.
    unsafe {
        if (*group).linked == 0 {
            us_internal_loop_link_group((*group).loop_, group);
            (*group).linked = 1;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_group_maybe_unlink(group: *mut us_socket_group_t) {
    // SAFETY: `group` is live.
    unsafe {
        if (*group).linked != 0 && group_is_empty(group) {
            us_internal_loop_unlink_group((*group).loop_, group);
            (*group).linked = 0;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_group_link_socket(
    group: *mut us_socket_group_t,
    s: *mut us_socket_t,
) {
    // SAFETY: both pointers are live; intrusive doubly-linked push-front.
    unsafe {
        if us_socket_is_closed(s) != 0 {
            return;
        }
        (*s).group = group;
        (*s).next = (*group).head_sockets;
        (*s).prev = ptr::null_mut();
        if !(*group).head_sockets.is_null() {
            (*(*group).head_sockets).prev = s;
        }
        (*group).head_sockets = s;
        group_touched(group);
        us_internal_enable_sweep_timer((*group).loop_);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_group_unlink_socket(
    group: *mut us_socket_group_t,
    s: *mut us_socket_t,
) {
    // SAFETY: `s` is linked into `group->head_sockets`.
    unsafe {
        // Keep the timer-sweep iterator valid.
        if s == (*group).iterator {
            (*group).iterator = (*s).next;
        }

        let prev = (*s).prev;
        let next = (*s).next;
        if prev == next {
            (*group).head_sockets = ptr::null_mut();
        } else {
            if !prev.is_null() {
                (*prev).next = next;
            } else {
                (*group).head_sockets = next;
            }
            if !next.is_null() {
                (*next).prev = prev;
            }
        }
        us_internal_disable_sweep_timer((*group).loop_);
        us_internal_group_maybe_unlink(group);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_group_link_connecting_socket(
    group: *mut us_socket_group_t,
    c: *mut us_connecting_socket_t,
) {
    // SAFETY: intrusive push-front on next_pending/prev_pending.
    unsafe {
        if (*c).closed() {
            return;
        }
        (*c).group = group;
        (*c).next_pending = (*group).head_connecting_sockets;
        (*c).prev_pending = ptr::null_mut();
        if !(*group).head_connecting_sockets.is_null() {
            (*(*group).head_connecting_sockets).prev_pending = c;
        }
        (*group).head_connecting_sockets = c;
        group_touched(group);
        us_internal_enable_sweep_timer((*group).loop_);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_group_unlink_connecting_socket(
    group: *mut us_socket_group_t,
    c: *mut us_connecting_socket_t,
) {
    // SAFETY: `c` is linked into `group->head_connecting_sockets`.
    unsafe {
        let prev = (*c).prev_pending;
        let next = (*c).next_pending;
        if prev == next {
            (*group).head_connecting_sockets = ptr::null_mut();
        } else {
            if !prev.is_null() {
                (*prev).next_pending = next;
            } else {
                (*group).head_connecting_sockets = next;
            }
            if !next.is_null() {
                (*next).prev_pending = prev;
            }
        }
        us_internal_disable_sweep_timer((*group).loop_);
        us_internal_group_maybe_unlink(group);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Adopt
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_adopt(
    s: *mut us_socket_t,
    group: *mut us_socket_group_t,
    kind: u8,
    old_ext_size: c_int,
    ext_size: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is an open socket; may be relocated via us_poll_resize.
    unsafe {
        if us_socket_is_closed(s) != 0 || us_socket_is_shut_down(s) != 0 {
            return s;
        }
        let old_group = (*s).group;
        let loop_ = (*old_group).loop_;

        if (*s).flags.low_prio_state() != 1 {
            // This properly updates the iterator if in on_timeout.
            us_internal_socket_group_unlink_socket(old_group, s);
        } else if old_group != group {
            // Stays on the loop-wide low-prio queue, but s->group changes owner —
            // keep both groups' invariants consistent so old_group can deinit.
            (*old_group).low_prio_count -= 1;
            (*group).low_prio_count += 1;
            group_touched(group);
            us_internal_group_maybe_unlink(old_group);
        }

        let c = (*s).connect_state;
        let mut new_s = s;
        if ext_size != -1 {
            let base = (size_of::<us_socket_t>() - size_of::<us_poll_t>()) as c_uint;
            new_s = us_poll_resize(
                &mut (*s).p,
                loop_,
                base + old_ext_size as c_uint,
                base + ext_size as c_uint,
            )
            .cast();
            if new_s != s {
                // Old allocation stays valid until deferred free; mark it closed
                // and forward `prev` to the relocated socket so the event loop
                // can route pending ready-events.
                (*s).flags.set_is_closed(true);
                (*s).next = (*loop_).data.closed_head;
                (*loop_).data.closed_head = s;
                (*s).flags.set_adopted(true);
                (*s).prev = new_s;
                if !(*s).ssl.is_null() {
                    us_internal_ssl_socket_relocated(loop_, s, new_s);
                }
            }
            if !c.is_null() {
                (*c).connecting_head = new_s;
                (*c).group = group;
                (*c).kind = kind;
                us_internal_socket_group_unlink_connecting_socket(old_group, c);
                us_internal_socket_group_link_connecting_socket(group, c);
            }
        }
        (*new_s).group = group;
        (*new_s).kind = kind;
        (*new_s).timeout = 255;
        (*new_s).long_timeout = 255;

        if (*new_s).flags.low_prio_state() == 1 {
            // Fix up low-priority queue pointers in place for the relocated node.
            if (*new_s).prev.is_null() {
                (*loop_).data.low_prio_head = new_s;
            } else {
                (*(*new_s).prev).next = new_s;
            }
            if !(*new_s).next.is_null() {
                (*(*new_s).next).prev = new_s;
            }
        } else {
            us_internal_socket_group_link_socket(group, new_s);
        }
        new_s
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Listen
// ═══════════════════════════════════════════════════════════════════════════

unsafe fn init_listen_socket(
    ls: *mut us_listen_socket_t,
    group: *mut us_socket_group_t,
    kind: u8,
    ssl_ctx: *mut SSL_CTX,
    options: c_int,
    socket_ext_size: c_int,
) {
    // SAFETY: `ls` points at freshly-calloc'd storage of size >= us_listen_socket_t.
    unsafe {
        let s = &mut (*ls).s;
        s.group = group;
        s.kind = 0; // listener itself never dispatches
        s.ssl = ptr::null_mut();
        s.timeout = 255;
        s.long_timeout = 255;
        s.flags.set_low_prio_state(0);
        s.flags.set_is_paused(false);
        s.flags.set_is_ipc(false);
        s.flags.set_is_closed(false);
        s.flags.set_adopted(false);
        s.flags
            .set_allow_half_open(options & LIBUS_SOCKET_ALLOW_HALF_OPEN != 0);
        s.next = ptr::null_mut();
        s.prev = ptr::null_mut();
        s.connect_state = ptr::null_mut();
        s.connect_next = ptr::null_mut();

        (*ls).accept_group = group;
        (*ls).accept_kind = kind;
        (*ls).ssl_ctx = ssl_ctx;
        if !ssl_ctx.is_null() {
            us_internal_ssl_ctx_up_ref(ssl_ctx);
        }
        (*ls).sni = ptr::null_mut();
        (*ls).on_server_name = None;
        (*ls).socket_ext_size = socket_ext_size as c_uint;
        (*ls).deferred_accept = 0;

        // Link into the group so close_all() / test-isolation can find it.
        (*ls).next = (*group).head_listen_sockets;
        (*group).head_listen_sockets = ls;
        group_touched(group);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_listen(
    group: *mut us_socket_group_t,
    kind: u8,
    ssl_ctx: *mut SSL_CTX,
    host: *const c_char,
    port: c_int,
    options: c_int,
    socket_ext_size: c_int,
    error: *mut c_int,
) -> *mut us_listen_socket_t {
    // SAFETY: `group` and `error` are non-null per the C API contract.
    unsafe {
        let listen_fd = bsd_create_listen_socket(host, port, options, error);
        if listen_fd == LIBUS_SOCKET_ERROR {
            return ptr::null_mut();
        }

        let p = us_create_poll((*group).loop_, 0, size_of::<us_listen_socket_t>() as c_uint);
        us_poll_init(p, listen_fd, POLL_TYPE_SEMI_SOCKET);
        if us_poll_start_rc(p, (*group).loop_, LIBUS_SOCKET_READABLE) != 0 {
            // EPOLL_CTL_ADD failed (e.g. ENOSPC). Report via both the out-param
            // and thread-local errno: Bun.listen reads *error, Bun.serve reads errno.
            let saved_errno = errno();
            bsd_close_socket(listen_fd);
            us_poll_free(p, (*group).loop_);
            *error = saved_errno;
            set_errno(saved_errno);
            return ptr::null_mut();
        }

        let ls = p.cast::<us_listen_socket_t>();
        init_listen_socket(ls, group, kind, ssl_ctx, options, socket_ext_size);

        if options & LIBUS_LISTEN_DEFER_ACCEPT != 0 {
            (*ls).deferred_accept = bsd_set_defer_accept(listen_fd) as u8;
        }

        ls
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_listen_unix(
    group: *mut us_socket_group_t,
    kind: u8,
    ssl_ctx: *mut SSL_CTX,
    path: *const c_char,
    pathlen: usize,
    options: c_int,
    socket_ext_size: c_int,
    error: *mut c_int,
) -> *mut us_listen_socket_t {
    // SAFETY: `group`, `path`, and `error` are non-null per the C API contract.
    unsafe {
        let listen_fd = bsd_create_listen_socket_unix(path, pathlen, options, error);
        if listen_fd == LIBUS_SOCKET_ERROR {
            return ptr::null_mut();
        }

        let p = us_create_poll((*group).loop_, 0, size_of::<us_listen_socket_t>() as c_uint);
        us_poll_init(p, listen_fd, POLL_TYPE_SEMI_SOCKET);
        if us_poll_start_rc(p, (*group).loop_, LIBUS_SOCKET_READABLE) != 0 {
            let saved_errno = errno();
            bsd_close_socket(listen_fd);
            us_poll_free(p, (*group).loop_);
            *error = saved_errno;
            set_errno(saved_errno);
            return ptr::null_mut();
        }

        let ls = p.cast::<us_listen_socket_t>();
        init_listen_socket(ls, group, kind, ssl_ctx, options, socket_ext_size);
        ls
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_close(ls: *mut us_listen_socket_t) {
    // SAFETY: `ls` is live; deferred-freed via loop->data.closed_head.
    unsafe {
        let s: *mut us_socket_t = &mut (*ls).s;
        if us_socket_is_closed(s) != 0 {
            // Cannot free now — may be inside an accept loop.
            return;
        }
        let group = (*ls).accept_group;
        let loop_ = (*(*s).group).loop_;
        us_poll_stop(s.cast(), loop_);
        bsd_close_socket(us_poll_fd(s.cast()));

        us_internal_listen_socket_ssl_free(ls);

        // Unlink from group->head_listen_sockets (singly-linked).
        let mut pp = &mut (*group).head_listen_sockets as *mut *mut us_listen_socket_t;
        while !(*pp).is_null() {
            if *pp == ls {
                *pp = (*ls).next;
                break;
            }
            pp = &mut (**pp).next;
        }
        (*ls).next = ptr::null_mut();
        us_internal_group_maybe_unlink(group);

        // Link onto the close-list; deleted after this iteration.
        (*s).next = (*loop_).data.closed_head;
        (*loop_).data.closed_head = s;
        (*s).flags.set_is_closed(true);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_ext(ls: *mut us_listen_socket_t) -> *mut c_void {
    // SAFETY: trailing ext bytes sit immediately after the struct.
    unsafe { ext_of(ls) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_head_listen_socket(
    group: *mut us_socket_group_t,
) -> *mut us_listen_socket_t {
    // SAFETY: `group` is live.
    unsafe { (*group).head_listen_sockets }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_next(
    ls: *mut us_listen_socket_t,
) -> *mut us_listen_socket_t {
    // SAFETY: `ls` is live.
    unsafe { (*ls).next }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_get_fd(
    ls: *mut us_listen_socket_t,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: `&ls->s.p` aliases `*mut us_poll_t` (first field).
    unsafe { us_poll_fd(&mut (*ls).s.p) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_port(ls: *mut us_listen_socket_t) -> c_int {
    // SAFETY: `ls` is live.
    unsafe { us_socket_local_port(&mut (*ls).s) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_group(
    ls: *mut us_listen_socket_t,
) -> *mut us_socket_group_t {
    // SAFETY: `ls` is live.
    unsafe { (*ls).accept_group }
}

// ═══════════════════════════════════════════════════════════════════════════
// Connect
// ═══════════════════════════════════════════════════════════════════════════

#[inline]
unsafe fn init_connect_socket(
    s: *mut us_socket_t,
    group: *mut us_socket_group_t,
    kind: u8,
    options: c_int,
) {
    // SAFETY: `s` points at freshly-allocated us_socket_t storage.
    unsafe {
        (*s).group = group;
        (*s).kind = kind;
        (*s).ssl = ptr::null_mut();
        (*s).timeout = 255;
        (*s).long_timeout = 255;
        (*s).flags.set_low_prio_state(0);
        (*s).flags
            .set_allow_half_open(options & LIBUS_SOCKET_ALLOW_HALF_OPEN != 0);
        (*s).flags.set_is_paused(false);
        (*s).flags.set_is_ipc(false);
        (*s).flags.set_is_closed(false);
        (*s).flags.set_adopted(false);
        (*s).flags.set_last_write_failed(false);
        (*s).connect_state = ptr::null_mut();
        (*s).connect_next = ptr::null_mut();
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_connect_resolved_dns(
    group: *mut us_socket_group_t,
    kind: u8,
    ssl_ctx: *mut SSL_CTX,
    addr: *mut sockaddr_storage,
    local_addr: *mut sockaddr_storage,
    options: c_int,
    socket_ext_size: c_int,
) -> *mut us_socket_t {
    // SAFETY: `group` and `addr` are non-null; `local_addr` may be null.
    unsafe {
        let connect_fd = bsd_create_connect_socket(addr, local_addr, options);
        if connect_fd == LIBUS_SOCKET_ERROR {
            return ptr::null_mut();
        }

        bsd_socket_nodelay(connect_fd, 1);

        let p = us_create_poll(
            (*group).loop_,
            0,
            (size_of::<us_socket_t>() + socket_ext_size as usize) as c_uint,
        );
        us_poll_init(p, connect_fd, POLL_TYPE_SEMI_SOCKET);
        if us_poll_start_rc(p, (*group).loop_, LIBUS_SOCKET_WRITABLE) != 0 {
            let saved_errno = errno();
            bsd_close_socket(connect_fd);
            us_poll_free(p, (*group).loop_);
            set_errno(saved_errno);
            return ptr::null_mut();
        }

        let socket = p.cast::<us_socket_t>();
        init_connect_socket(socket, group, kind, options);

        // Fast path has no us_connecting_socket_t to stash ssl_ctx on, so
        // attach SSL now; on_open will route through the TLS layer.
        if !ssl_ctx.is_null() {
            us_internal_ssl_attach(socket, ssl_ctx, 1, ptr::null(), ptr::null_mut());
        }

        us_internal_socket_group_link_socket(group, socket);
        socket
    }
}

unsafe fn init_addr_with_port(info: *mut addrinfo, port: c_int, addr: *mut sockaddr_storage) {
    // SAFETY: `info->ai_addr` is valid for `ai_addrlen` bytes; `addr` is sockaddr_storage-sized.
    unsafe {
        if (*info).ai_family == plat::AF_INET {
            let addr_in = addr.cast::<plat::sockaddr_in>();
            ptr::copy_nonoverlapping(
                (*info).ai_addr.cast::<u8>(),
                addr_in.cast::<u8>(),
                (*info).ai_addrlen as usize,
            );
            (*addr_in).sin_port = htons(port as u16);
        } else {
            let addr_in6 = addr.cast::<plat::sockaddr_in6>();
            ptr::copy_nonoverlapping(
                (*info).ai_addr.cast::<u8>(),
                addr_in6.cast::<u8>(),
                (*info).ai_addrlen as usize,
            );
            (*addr_in6).sin6_port = htons(port as u16);
        }
    }
}

unsafe fn try_parse_ip(ip_str: *const c_char, port: c_int, storage: *mut sockaddr_storage) -> bool {
    // SAFETY: `storage` is sockaddr_storage-sized; inet_pton writes in_addr/in6_addr only on success.
    unsafe {
        ptr::write_bytes(storage, 0, 1);

        let addr4 = storage.cast::<plat::sockaddr_in>();
        if plat::inet_pton(
            plat::AF_INET,
            ip_str,
            ptr::addr_of_mut!((*addr4).sin_addr).cast(),
        ) == 1
        {
            (*addr4).sin_port = htons(port as u16);
            (*addr4).sin_family = plat::AF_INET as _;
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            {
                (*addr4).sin_len = size_of::<plat::sockaddr_in>() as u8;
            }
            return true;
        }

        let addr6 = storage.cast::<plat::sockaddr_in6>();
        if plat::inet_pton(
            plat::AF_INET6,
            ip_str,
            ptr::addr_of_mut!((*addr6).sin6_addr).cast(),
        ) == 1
        {
            (*addr6).sin6_port = htons(port as u16);
            (*addr6).sin6_family = plat::AF_INET6 as _;
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            {
                (*addr6).sin6_len = size_of::<plat::sockaddr_in6>() as u8;
            }
            return true;
        }

        false
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_connect(
    group: *mut us_socket_group_t,
    kind: u8,
    ssl_ctx: *mut SSL_CTX,
    host: *const c_char,
    port: c_int,
    local_host: *const c_char,
    local_port: c_int,
    options: c_int,
    socket_ext_size: c_int,
    has_dns_resolved: *mut c_int,
) -> *mut c_void {
    // SAFETY: `group`, `host`, `has_dns_resolved` non-null per API contract.
    unsafe {
        let loop_ = (*group).loop_;

        // The local address is always a literal IP (Node validates it as one).
        let mut local_addr_storage: sockaddr_storage = zeroed();
        let mut local_addr: *mut sockaddr_storage = ptr::null_mut();
        if !local_host.is_null() && try_parse_ip(local_host, local_port, &mut local_addr_storage) {
            local_addr = &mut local_addr_storage;
        }

        let mut addr: sockaddr_storage = zeroed();
        if try_parse_ip(host, port, &mut addr) {
            *has_dns_resolved = 1;
            return us_socket_group_connect_resolved_dns(
                group,
                kind,
                ssl_ctx,
                &mut addr,
                local_addr,
                options,
                socket_ext_size,
            )
            .cast();
        }

        let mut ai_req: *mut addrinfo_request = ptr::null_mut();
        if Bun__addrinfo_get(loop_, host, port as u16, &mut ai_req) == 0 {
            let result = Bun__addrinfo_getRequestResult(ai_req);
            // A cached resolver failure falls through to the connecting-socket
            // path below so it is reported through the same connect-error
            // callback (tagged error_is_dns) as an uncached one.
            if (*result).error == 0 {
                let entries = (*result).entries;
                if !entries.is_null() && (*entries).info.ai_next.is_null() {
                    let mut a: sockaddr_storage = zeroed();
                    init_addr_with_port(&mut (*entries).info, port, &mut a);
                    *has_dns_resolved = 1;
                    let s = us_socket_group_connect_resolved_dns(
                        group,
                        kind,
                        ssl_ctx,
                        &mut a,
                        local_addr,
                        options,
                        socket_ext_size,
                    );
                    Bun__addrinfo_freeRequest(ai_req, s.is_null() as c_int);
                    return s.cast();
                }
            }
        }

        let c = us_calloc(
            1,
            size_of::<us_connecting_socket_t>() + socket_ext_size as usize,
        )
        .cast::<us_connecting_socket_t>();
        if c.is_null() {
            Bun__outOfMemory();
        }
        (*c).socket_ext_size = socket_ext_size;
        (*c).options = options;
        (*c).kind = kind;
        (*c).loop_ = loop_;
        (*c).ssl_ctx = ssl_ctx;
        if !ssl_ctx.is_null() {
            us_internal_ssl_ctx_up_ref(ssl_ctx);
        }
        (*c).timeout = 255;
        (*c).long_timeout = 255;
        (*c).set_pending_resolve_callback(true);
        (*c).addrinfo_req = ai_req;
        (*c).port = port as u16;
        us_internal_socket_group_link_connecting_socket(group, c);

        #[cfg(windows)]
        {
            (*(*loop_).uv_loop).active_handles += 1;
        }
        #[cfg(not(windows))]
        {
            (*loop_).num_polls += 1;
        }

        Bun__addrinfo_set(ai_req, c);

        c.cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_group_connect_unix(
    group: *mut us_socket_group_t,
    kind: u8,
    ssl_ctx: *mut SSL_CTX,
    server_path: *const c_char,
    pathlen: usize,
    options: c_int,
    socket_ext_size: c_int,
) -> *mut us_socket_t {
    // SAFETY: `group` and `server_path` are non-null per API contract.
    unsafe {
        let connect_fd = bsd_create_connect_socket_unix(server_path, pathlen, options);
        if connect_fd == LIBUS_SOCKET_ERROR {
            return ptr::null_mut();
        }

        let p = us_create_poll(
            (*group).loop_,
            0,
            (size_of::<us_socket_t>() + socket_ext_size as usize) as c_uint,
        );
        us_poll_init(p, connect_fd, POLL_TYPE_SEMI_SOCKET);
        if us_poll_start_rc(p, (*group).loop_, LIBUS_SOCKET_WRITABLE) != 0 {
            let saved_errno = errno();
            bsd_close_socket(connect_fd);
            us_poll_free(p, (*group).loop_);
            set_errno(saved_errno);
            return ptr::null_mut();
        }

        let socket = p.cast::<us_socket_t>();
        init_connect_socket(socket, group, kind, options);

        if !ssl_ctx.is_null() {
            us_internal_ssl_attach(socket, ssl_ctx, 1, ptr::null(), ptr::null_mut());
        }

        us_internal_socket_group_link_socket(group, socket);
        socket
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn start_connections(c: *mut us_connecting_socket_t, count: c_int) -> c_int {
    // SAFETY: `c` is live; `c->addrinfo_head` walks the resolver result list.
    unsafe {
        let mut opened: c_int = 0;
        let group = (*c).group;
        let loop_ = (*group).loop_;
        while !(*c).addrinfo_head.is_null() && opened < count {
            let mut addr: sockaddr_storage = zeroed();
            init_addr_with_port((*c).addrinfo_head, (*c).port as c_int, &mut addr);
            // The deferred-DNS path does not carry a local binding.
            let connect_fd = bsd_create_connect_socket(&mut addr, ptr::null_mut(), (*c).options);
            if connect_fd == LIBUS_SOCKET_ERROR {
                (*c).addrinfo_head = (*(*c).addrinfo_head).ai_next;
                continue;
            }
            bsd_socket_nodelay(connect_fd, 1);
            let s = us_create_poll(
                loop_,
                0,
                (size_of::<us_socket_t>() + (*c).socket_ext_size as usize) as c_uint,
            )
            .cast::<us_socket_t>();
            us_poll_init(&mut (*s).p, connect_fd, POLL_TYPE_SEMI_SOCKET);
            if us_poll_start_rc(&mut (*s).p, loop_, LIBUS_SOCKET_WRITABLE) != 0 {
                bsd_close_socket(connect_fd);
                us_poll_free(&mut (*s).p, loop_);
                (*c).addrinfo_head = (*(*c).addrinfo_head).ai_next;
                continue;
            }
            opened += 1;
            init_connect_socket(s, group, (*c).kind, (*c).options);
            (*s).timeout = (*c).timeout;
            (*s).long_timeout = (*c).long_timeout;

            us_internal_socket_group_link_socket(group, s);

            // Copy trailing ext bytes from the connecting socket to this candidate.
            ptr::copy_nonoverlapping(
                ext_of(c).cast::<u8>(),
                ext_of(s).cast::<u8>(),
                (*c).socket_ext_size as usize,
            );

            (*s).connect_next = (*c).connecting_head;
            (*c).connecting_head = s;
            (*s).connect_state = c;

            (*c).addrinfo_head = (*(*c).addrinfo_head).ai_next;
        }
        opened
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_after_resolve(c: *mut us_connecting_socket_t) {
    // SAFETY: `c` is live; may have been closed between queuing and delivery.
    unsafe {
        (*c).set_pending_resolve_callback(false);
        if (*c).closed() {
            if !(*c).addrinfo_req.is_null() {
                Bun__addrinfo_freeRequest((*c).addrinfo_req, 0);
                (*c).addrinfo_req = ptr::null_mut();
            }
            us_connecting_socket_free(c);
            return;
        }

        let group = (*c).group;
        #[cfg(windows)]
        {
            (*(*(*group).loop_).uv_loop).active_handles -= 1;
        }
        #[cfg(not(windows))]
        {
            (*(*group).loop_).num_polls -= 1;
        }
        let result: *mut addrinfo_result = Bun__addrinfo_getRequestResult((*c).addrinfo_req);
        if (*result).error != 0 {
            // Preserve the getaddrinfo failure so the connect-error callback
            // reports the resolver error instead of a fabricated ECONNABORTED.
            (*c).error = (*result).error;
            (*c).set_error_is_dns(true);
            us_connecting_socket_close(c);
            return;
        }

        (*c).addrinfo_head = &mut (*(*result).entries).info;

        let opened = start_connections(c, CONCURRENT_CONNECTIONS);
        if opened == 0 {
            // Real connect failure — must not be reported as a caller abort.
            (*c).error = ECONNREFUSED;
            us_connecting_socket_close(c);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_socket_after_open(s: *mut us_socket_t, error: c_int) {
    // SAFETY: `s` is a SEMI_SOCKET that became writable or errored.
    unsafe {
        let c = (*s).connect_state;

        #[cfg(windows)]
        let mut error = error;
        #[cfg(windows)]
        if error == 0 {
            if plat::recv(
                us_poll_fd(s.cast()),
                ptr::null_mut(),
                0,
                plat::MSG_PUSH_IMMEDIATE,
            ) == plat::SOCKET_ERROR
            {
                error = plat::WSAGetLastError();
                match error {
                    plat::WSAEWOULDBLOCK | plat::WSAEINTR => error = 0,
                    _ => {}
                }
            }
        }

        if error != 0 {
            if !c.is_null() {
                // Remove `s` from c->connecting_head (singly-linked).
                let mut next = &mut (*c).connecting_head as *mut *mut us_socket_t;
                while !(*next).is_null() {
                    if *next == s {
                        *next = (*s).connect_next;
                        break;
                    }
                    next = &mut (**next).connect_next;
                }
                us_socket_close(s, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, ptr::null_mut());

                if (*c).connecting_head.is_null() || (*(*c).connecting_head).connect_next.is_null()
                {
                    let want = if (*c).connecting_head.is_null() {
                        CONCURRENT_CONNECTIONS
                    } else {
                        1
                    };
                    let opened = start_connections(c, want);
                    if opened == 0 && (*c).connecting_head.is_null() {
                        // Every resolved address failed. Without this, close
                        // defaults to ECONNABORTED and never invalidates the
                        // DNS cache entry for the dead host.
                        (*c).error = ECONNREFUSED;
                        us_connecting_socket_close(c);
                    }
                }
            } else {
                us_dispatch_connect_error(s, error);
                // It's expected that close is called by the caller.
            }
        } else {
            us_poll_change(&mut (*s).p, (*(*s).group).loop_, LIBUS_SOCKET_READABLE);
            bsd_socket_nodelay(us_poll_fd(&mut (*s).p), 1);
            us_internal_poll_set_type(&mut (*s).p, POLL_TYPE_SOCKET);
            us_socket_timeout(s, 0);

            if !c.is_null() {
                // Close losing candidates.
                let mut next = (*c).connecting_head;
                while !next.is_null() {
                    let after = (*next).connect_next;
                    if next != s {
                        us_socket_close(
                            next,
                            LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET,
                            ptr::null_mut(),
                        );
                    }
                    next = after;
                }
                // Attach TLS now that we know which candidate won.
                if !(*c).ssl_ctx.is_null() {
                    us_internal_ssl_attach(s, (*c).ssl_ctx, 1, ptr::null(), ptr::null_mut());
                }
                Bun__addrinfo_freeRequest((*c).addrinfo_req, 0);
                us_connecting_socket_free(c);
                (*s).connect_state = ptr::null_mut();
            }

            if !(*s).ssl.is_null() {
                us_internal_ssl_on_open(s, 1, ptr::null_mut(), 0);
            } else {
                us_dispatch_open(s, 1, ptr::null_mut(), 0);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Misc
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_verify_error(s: *mut us_socket_t) -> us_bun_verify_error_t {
    // SAFETY: `s` is live.
    unsafe {
        if !(*s).ssl.is_null() {
            return us_internal_ssl_verify_error(s);
        }
    }
    us_bun_verify_error_t::default()
}
