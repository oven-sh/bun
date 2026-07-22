//! Core loop logic shared by every eventing backend.
//! Port of `packages/bun-usockets/src/loop.c`.

use core::ffi::{c_char, c_int, c_longlong, c_uint, c_void};
use core::mem::{MaybeUninit, size_of, transmute};
use core::ptr;

#[cfg(not(windows))]
use crate::bsd::bsd_recvmsg;
use crate::bsd::{
    LIBUS_SOCKET_ERROR, bsd_accept_socket, bsd_addr_get_ip, bsd_addr_get_ip_length,
    bsd_close_socket, bsd_recv, bsd_recvmmsg, bsd_socket_nodelay, bsd_udp_setup_recvbuf,
    bsd_would_block, udp_recvbuf,
};
#[cfg(not(windows))]
use crate::eventing::us_internal_accept_poll_event;
use crate::eventing::{
    LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE, us_create_poll, us_internal_async_close,
    us_internal_async_set, us_internal_async_wakeup, us_internal_create_async,
    us_internal_poll_type, us_poll_change, us_poll_events, us_poll_fd, us_poll_free, us_poll_init,
    us_poll_start_rc,
};
#[cfg(windows)]
use crate::eventing::{us_create_timer, us_timer_close, us_timer_set};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════
// Externs defined outside this crate (Bun runtime) or in sibling .rs files
// that are linked by name via the C ABI.
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: *mut us_loop_t);
    #[cfg(debug_assertions)]
    static Bun__lock__size: usize;

    fn us_internal_free_loop_ssl_data(loop_: *mut us_loop_t);
    fn us_internal_ssl_attach(
        s: *mut us_socket_t,
        ssl_ctx: *mut bun_boringssl_sys::SSL_CTX,
        is_client: c_int,
        sni: *const c_char,
        listener: *mut us_listen_socket_t,
    );
    fn us_internal_ssl_on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut c_char,
        ip_length: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_on_data(
        s: *mut us_socket_t,
        data: *mut c_char,
        length: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_on_writable(s: *mut us_socket_t) -> *mut us_socket_t;
    fn us_internal_ssl_on_end(s: *mut us_socket_t) -> *mut us_socket_t;
    fn us_internal_ssl_is_low_prio(s: *mut us_socket_t) -> c_int;

    fn us_internal_socket_close_raw(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;
    fn us_internal_socket_after_open(s: *mut us_socket_t, error: c_int);
    fn us_internal_socket_after_resolve(s: *mut us_connecting_socket_t);
    fn us_internal_socket_group_link_socket(group: *mut us_socket_group_t, s: *mut us_socket_t);
    fn us_internal_socket_group_unlink_socket(group: *mut us_socket_group_t, s: *mut us_socket_t);
    fn us_socket_group_close_all_ex(group: *mut us_socket_group_t, also_listeners: c_int);

    fn us_socket_is_closed(s: *mut us_socket_t) -> c_int;
    fn us_socket_is_shut_down(s: *mut us_socket_t) -> c_int;
    fn us_socket_get_error(s: *mut us_socket_t) -> c_int;

    fn us_udp_socket_close(s: *mut us_udp_socket_t);

    fn us_quic_loop_process(loop_: *mut us_loop_t);
}

// ═══════════════════════════════════════════════════════════════════════════
// Platform errno / constants
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
const ECONNRESET: c_int = libc::ECONNRESET;
/// MSVC `<errno.h>` value (not WSAECONNRESET).
#[cfg(windows)]
const ECONNRESET: c_int = 108;

#[cfg(not(windows))]
const MSG_DONTWAIT: c_int = libc::MSG_DONTWAIT;
#[cfg(windows)]
const MSG_DONTWAIT: c_int = 0;

/// Winsock `MSG_PUSH_IMMEDIATE` — deliver partial data without waiting for PSH.
#[cfg(windows)]
const MSG_PUSH_IMMEDIATE: c_int = 0x20;

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
#[inline(always)]
unsafe fn errno() -> c_int {
    // SAFETY: thread-local errno slot.
    unsafe { *libc::__error() }
}
#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline(always)]
unsafe fn errno() -> c_int {
    unsafe extern "C" {
        #[cfg_attr(target_os = "linux", link_name = "__errno_location")]
        fn __errno() -> *mut c_int;
    }
    // SAFETY: thread-local errno slot.
    unsafe { *__errno() }
}

/// C `LIBUS_ERR` — `errno` on POSIX, `WSAGetLastError()` on Windows.
#[inline(always)]
unsafe fn libus_err() -> c_int {
    #[cfg(windows)]
    {
        bun_windows_sys::WSAGetLastError()
    }
    #[cfg(not(windows))]
    {
        // SAFETY: reads the thread-local errno.
        unsafe { errno() }
    }
}

#[cold]
#[inline(never)]
fn cold() {}
#[inline(always)]
fn unlikely(b: bool) -> bool {
    if b {
        cold();
    }
    b
}

// ═══════════════════════════════════════════════════════════════════════════
// Sweep timer — libuv arms a real uv_timer; epoll/kqueue clamp the wait
// timeout against a monotonic deadline instead.
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(windows)]
unsafe extern "C" fn sweep_timer_cb(cb: *mut us_internal_callback_t) {
    // SAFETY: invoked by libuv with the `us_internal_callback_t` we registered.
    unsafe { us_internal_timer_sweep((*cb).loop_) };
}

#[cfg(windows)]
unsafe extern "C" fn sweep_timer_noop(_t: *mut us_timer_t) {}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_enable_sweep_timer(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; sweep_timer was allocated in loop_data_init.
    unsafe {
        (*loop_).data.sweep_timer_count += 1;
        if (*loop_).data.sweep_timer_count == 1 {
            let cb: unsafe extern "C" fn(*mut us_timer_t) = transmute::<
                unsafe extern "C" fn(*mut us_internal_callback_t),
                unsafe extern "C" fn(*mut us_timer_t),
            >(sweep_timer_cb);
            us_timer_set(
                (*loop_).data.sweep_timer,
                Some(cb),
                (LIBUS_TIMEOUT_GRANULARITY * 1000) as c_int,
                (LIBUS_TIMEOUT_GRANULARITY * 1000) as c_int,
            );
            Bun__internal_ensureDateHeaderTimerIsEnabled(loop_);
        }
    }
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_disable_sweep_timer(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live.
    unsafe {
        (*loop_).data.sweep_timer_count -= 1;
        if (*loop_).data.sweep_timer_count == 0 {
            us_timer_set((*loop_).data.sweep_timer, Some(sweep_timer_noop), 0, 0);
        }
    }
}

#[cfg(not(windows))]
const LIBUS_TIMEOUT_GRANULARITY_NS: c_longlong =
    LIBUS_TIMEOUT_GRANULARITY as c_longlong * 1_000_000_000;

#[cfg(not(windows))]
#[inline]
unsafe fn us_internal_monotonic_ns() -> c_longlong {
    let mut ts = MaybeUninit::<libc::timespec>::uninit();
    // SAFETY: `ts` is valid for write; CLOCK_MONOTONIC is always available.
    unsafe {
        libc::clock_gettime(libc::CLOCK_MONOTONIC, ts.as_mut_ptr());
        let ts = ts.assume_init();
        ts.tv_sec as c_longlong * 1_000_000_000 + ts.tv_nsec as c_longlong
    }
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_enable_sweep_timer(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live.
    unsafe {
        (*loop_).data.sweep_timer_count += 1;
        if (*loop_).data.sweep_timer_count == 1 {
            (*loop_).data.sweep_next_tick_ns =
                us_internal_monotonic_ns() + LIBUS_TIMEOUT_GRANULARITY_NS;
            Bun__internal_ensureDateHeaderTimerIsEnabled(loop_);
        }
    }
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_disable_sweep_timer(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live.
    unsafe {
        (*loop_).data.sweep_timer_count -= 1;
        if (*loop_).data.sweep_timer_count == 0 {
            (*loop_).data.sweep_next_tick_ns = -1;
        }
    }
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_sweep_timeout_ns(loop_: *mut us_loop_t) -> c_longlong {
    // SAFETY: `loop_` is live.
    unsafe {
        if (*loop_).data.sweep_next_tick_ns < 0 {
            return -1;
        }
        let diff = (*loop_).data.sweep_next_tick_ns - us_internal_monotonic_ns();
        if diff > 0 { diff } else { 0 }
    }
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_sweep_if_due(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live.
    unsafe {
        if (*loop_).data.sweep_next_tick_ns < 0 {
            return;
        }
        let now = us_internal_monotonic_ns();
        if now < (*loop_).data.sweep_next_tick_ns {
            return;
        }
        // Re-arm first: a timeout handler may unlink the last socket and disarm.
        (*loop_).data.sweep_next_tick_ns = now + LIBUS_TIMEOUT_GRANULARITY_NS;
        us_internal_timer_sweep(loop_);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop data init / free
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_data_init(
    loop_: *mut us_loop_t,
    wakeup_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
) {
    // SAFETY: `loop_` was calloc'd by `us_create_loop`; only fields in use are set.
    unsafe {
        #[cfg(windows)]
        {
            (*loop_).data.sweep_timer = us_create_timer(loop_, 1, 0);
        }
        #[cfg(not(windows))]
        {
            (*loop_).data.sweep_next_tick_ns = -1;
        }
        (*loop_).data.sweep_timer_count = 0;
        (*loop_).data.recv_buf =
            libc::malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2) as *mut c_char;
        (*loop_).data.send_buf = libc::malloc(LIBUS_SEND_BUFFER_LENGTH) as *mut c_char;
        // Every read on this loop writes into recv_buf; a NULL here makes each
        // one fail with EFAULT for the life of the process.
        if (*loop_).data.recv_buf.is_null() || (*loop_).data.send_buf.is_null() {
            Bun__outOfMemory();
        }
        (*loop_).data.pre_cb = pre_cb;
        (*loop_).data.post_cb = post_cb;
        (*loop_).data.wakeup_async = us_internal_create_async(loop_, 1, 0);
        us_internal_async_set(
            (*loop_).data.wakeup_async,
            transmute::<
                Option<unsafe extern "C" fn(*mut us_loop_t)>,
                Option<unsafe extern "C" fn(*mut us_internal_async)>,
            >(wakeup_cb),
        );
        #[cfg(debug_assertions)]
        if Bun__lock__size != size_of::<zig_mutex_t>() {
            const MSG: &[u8] = b"The size of the mutex must match the size of the lock";
            Bun__panic(MSG.as_ptr() as *const c_char, MSG.len());
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_data_free(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; releases everything `init` allocated.
    unsafe {
        us_internal_free_loop_ssl_data(loop_);

        libc::free((*loop_).data.recv_buf as *mut c_void);
        libc::free((*loop_).data.send_buf as *mut c_void);

        #[cfg(windows)]
        {
            us_timer_close((*loop_).data.sweep_timer, 0);
            if !(*loop_).data.quic_timer.is_null() {
                us_timer_close((*loop_).data.quic_timer, 0);
            }
        }
        us_internal_async_close((*loop_).data.wakeup_async);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Wakeup
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_wakeup_loop(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; may be called from any thread.
    unsafe {
        #[cfg(not(windows))]
        {
            (*loop_)
                .pending_wakeups
                .fetch_add(1, core::sync::atomic::Ordering::Release);
        }
        us_internal_async_wakeup((*loop_).data.wakeup_async);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Group link / unlink
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_link_group(
    loop_: *mut us_loop_t,
    group: *mut us_socket_group_t,
) {
    // SAFETY: `loop_` and `group` are live; inserts `group` at the head.
    unsafe {
        (*group).next = (*loop_).data.head;
        (*group).prev = ptr::null_mut();
        if !(*loop_).data.head.is_null() {
            (*(*loop_).data.head).prev = group;
        }
        (*loop_).data.head = group;
    }
}

/// Unlink is called before the embedding owner frees its storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_unlink_group(
    loop_: *mut us_loop_t,
    group: *mut us_socket_group_t,
) {
    // SAFETY: `loop_` and `group` are live; `group` is currently linked.
    unsafe {
        // A timeout callback in the sweep may deinit the current group; advance
        // the sweep iterator before `group->next` is cleared so the walk never
        // touches freed storage.
        if group == (*loop_).data.iterator {
            (*loop_).data.iterator = (*group).next;
        }
        if (*loop_).data.head == group {
            (*loop_).data.head = (*group).next;
            if !(*loop_).data.head.is_null() {
                (*(*loop_).data.head).prev = ptr::null_mut();
            }
        } else {
            (*(*group).prev).next = (*group).next;
            if !(*group).next.is_null() {
                (*(*group).next).prev = (*group).prev;
            }
        }
    }
}

/// Teardown helper: close every socket in every group currently linked to this
/// loop. Listen sockets are left alone (owner closes them). Returns 1 if any
/// group had open connections.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_close_all_groups(loop_: *mut us_loop_t) -> c_int {
    // SAFETY: `loop_` is live; walks the intrusive group list.
    unsafe {
        let mut g = (*loop_).data.head;
        let mut any: c_int = 0;
        while !g.is_null() {
            let mut next = (*g).next;
            // Only connecting/connected sockets are stranded — listen sockets are
            // owned by a Listener/App that closes them in finalize(); closing them
            // here would UAF after drainClosedSockets().
            if !(*g).head_sockets.is_null()
                || !(*g).head_connecting_sockets.is_null()
                || (*g).low_prio_count != 0
            {
                us_socket_group_close_all_ex(g, 0);
                any = 1;
            }
            // An on_close handler may have unlinked our cached `next` too; re-read
            // from the loop head if so.
            if !next.is_null() && (*next).linked == 0 {
                next = (*loop_).data.head;
            }
            g = next;
        }
        any
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Timer sweep
// ═══════════════════════════════════════════════════════════════════════════

/// This function should never run recursively.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_timer_sweep(loop_: *mut us_loop_t) {
    // SAFETY: walks the loop's group list and each group's socket list; timeout
    // dispatch may relink or free groups/sockets, which the iterator fields guard.
    unsafe {
        let loop_data = ptr::addr_of_mut!((*loop_).data);
        (*loop_data).iterator = (*loop_data).head;
        'outer: while !(*loop_data).iterator.is_null() {
            let group = (*loop_data).iterator;

            // Update this group's timestamps (could be moved to loop and done once).
            (*group).global_tick = (*group).global_tick.wrapping_add(1);
            let short_ticks = ((*group).global_tick % 240) as u8;
            (*group).timestamp = short_ticks;
            let long_ticks = (((*group).global_tick / 15) % 240) as u8;
            (*group).long_timestamp = long_ticks;

            let mut s = (*group).head_sockets;
            'sockets: while !s.is_null() {
                // Seek until end or timeout found (tightest loop).
                loop {
                    // We only read from 1 random cache line here.
                    if short_ticks == (*s).timeout || long_ticks == (*s).long_timeout {
                        break;
                    }
                    s = (*s).next;
                    if s.is_null() {
                        break 'sockets;
                    }
                }

                // Here we have a timeout to emit (slow path).
                (*group).iterator = s;

                if short_ticks == (*s).timeout {
                    (*s).timeout = 255;
                    us_dispatch_timeout(s);
                }
                // A timeout handler may have closed every socket and deinit'd the
                // group; unlink_group() would have advanced `loop_data->iterator`.
                // If so, `group` is freed storage — do not touch it again.
                if (*loop_data).iterator != group {
                    continue 'outer;
                }

                if (*group).iterator == s && long_ticks == (*s).long_timeout {
                    (*s).long_timeout = 255;
                    us_dispatch_long_timeout(s);
                }
                if (*loop_data).iterator != group {
                    continue 'outer;
                }

                // If the event handler did not modify the chain, step 1.
                if s == (*group).iterator {
                    s = (*s).next;
                } else {
                    s = (*group).iterator;
                }
            }
            // next_group: — only safe to write back / step ->next if the group survived dispatch.
            (*group).iterator = ptr::null_mut();
            (*loop_data).iterator = (*group).next;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Low-priority SSL-handshake queue
// ═══════════════════════════════════════════════════════════════════════════

/// Spread CPU-heavy SSL handshakes over many loop iterations, prioritizing
/// already-open connections.
const MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION: c_int = 5;

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_handle_low_priority_sockets(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; walks the low-prio LIFO queue.
    unsafe {
        let loop_data = ptr::addr_of_mut!((*loop_).data);
        (*loop_data).low_prio_budget = MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION;

        let mut s = (*loop_data).low_prio_head;
        while !s.is_null() && (*loop_data).low_prio_budget > 0 {
            // Unlink this socket from the low-priority queue.
            (*loop_data).low_prio_head = (*s).next;
            if !(*s).next.is_null() {
                (*(*s).next).prev = ptr::null_mut();
            }
            (*s).next = ptr::null_mut();
            (*(*s).group).low_prio_count -= 1;

            if us_socket_is_closed(s) != 0 {
                (*s).flags.set_low_prio_state(2);
            } else {
                us_internal_socket_group_link_socket((*s).group, s);
                let p = ptr::addr_of_mut!((*s).p);
                us_poll_change(
                    p,
                    (*(*s).group).loop_,
                    us_poll_events(p) | LIBUS_SOCKET_READABLE,
                );
                (*s).flags.set_low_prio_state(2);
            }

            s = (*loop_data).low_prio_head;
            (*loop_data).low_prio_budget -= 1;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DNS resolution queue
// ═══════════════════════════════════════════════════════════════════════════

/// Called when DNS resolution completes. Does not wake up the loop.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_dns_callback(
    c: *mut us_connecting_socket_t,
    _addrinfo_req: *mut c_void,
) {
    // SAFETY: `c` is live and already stores its addrinfo_req; `loop_` stays
    // valid past group detach. The mutex guards the shared dns_ready list.
    unsafe {
        let loop_ = (*c).loop_;
        Bun__lock(ptr::addr_of_mut!((*loop_).data.mutex));
        (*c).next = (*loop_).data.dns_ready_head;
        (*loop_).data.dns_ready_head = c;
        Bun__unlock(ptr::addr_of_mut!((*loop_).data.mutex));
    }
}

/// Called when DNS resolution completes. Wakes up the loop. Thread-safe.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_dns_callback_threadsafe(
    c: *mut us_connecting_socket_t,
    addrinfo_req: *mut c_void,
) {
    // SAFETY: `c` is live; delegates then signals the loop.
    unsafe {
        let loop_ = (*c).loop_;
        us_internal_dns_callback(c, addrinfo_req);
        us_wakeup_loop(loop_);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_drain_pending_dns_resolve(
    _loop: *mut us_loop_t,
    mut s: *mut us_connecting_socket_t,
) {
    // SAFETY: `s` is the detached head of a singly-linked list owned by caller.
    unsafe {
        while !s.is_null() {
            let next = (*s).next;
            us_internal_socket_after_resolve(s);
            s = next;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_handle_dns_results(loop_: *mut us_loop_t) -> c_int {
    // SAFETY: `loop_` is live; swaps the dns_ready list under the mutex.
    unsafe {
        Bun__lock(ptr::addr_of_mut!((*loop_).data.mutex));
        let s = (*loop_).data.dns_ready_head;
        (*loop_).data.dns_ready_head = ptr::null_mut();
        Bun__unlock(ptr::addr_of_mut!((*loop_).data.mutex));
        us_internal_drain_pending_dns_resolve(loop_, s);
        (!s.is_null()) as c_int
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Deferred close drain
// ═══════════════════════════════════════════════════════════════════════════

/// Properly takes the linked list and timeout sweep into account.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_free_closed_sockets(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; each list was populated by close paths that
    // relinquished ownership to the loop.
    unsafe {
        let mut s = (*loop_).data.closed_head;
        while !s.is_null() {
            let next = (*s).next;
            (*s).prev = ptr::null_mut();
            (*s).next = ptr::null_mut();
            us_poll_free(s as *mut us_poll_t, loop_);
            s = next;
        }
        (*loop_).data.closed_head = ptr::null_mut();

        let mut u = (*loop_).data.closed_udp_head;
        while !u.is_null() {
            let next = (*u).next;
            us_poll_free(u as *mut us_poll_t, loop_);
            u = next;
        }
        (*loop_).data.closed_udp_head = ptr::null_mut();

        let mut c = (*loop_).data.closed_connecting_head;
        while !c.is_null() {
            let next = (*c).next;
            us_free(c as *mut c_void);
            c = next;
        }
        (*loop_).data.closed_connecting_head = ptr::null_mut();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop iteration hooks
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_iteration_number(loop_: *mut us_loop_t) -> c_longlong {
    // SAFETY: `loop_` is live.
    unsafe { (*loop_).data.iteration_nr as c_longlong }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_pre(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; pre_cb was set in loop_data_init.
    unsafe {
        (*loop_).data.iteration_nr = (*loop_).data.iteration_nr.wrapping_add(1);
        us_internal_handle_dns_results(loop_);
        us_internal_handle_low_priority_sockets(loop_);
        (*loop_).data.pre_cb.unwrap_unchecked()(loop_);
        // Flush stream writes made by JS tasks before this tick so they go out
        // before the event loop blocks.
        if !(*loop_).data.quic_head.is_null() {
            us_quic_loop_process(loop_);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_post(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; post_cb was set in loop_data_init.
    unsafe {
        us_internal_handle_dns_results(loop_);
        if !(*loop_).data.quic_head.is_null() {
            us_quic_loop_process(loop_);
        }
        // A poll callback may re-enter the loop; only the outermost tick may
        // free closed sockets so the outer dispatch never reads freed `s->flags`.
        if (*loop_).data.tick_depth <= 1 {
            us_internal_free_closed_sockets(loop_);
        }
        (*loop_).data.post_cb.unwrap_unchecked()(loop_);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Ready-poll dispatch (the hot path)
// ═══════════════════════════════════════════════════════════════════════════

/// Follow `s->prev` once when `adopted` is set: after adoption the old socket
/// becomes a tombstone whose `prev` points at the relocated one.
#[inline(always)]
unsafe fn follow_adoption(s: *mut us_socket_t) -> *mut us_socket_t {
    // SAFETY: caller guarantees `s` is either null or a live socket.
    unsafe {
        if !s.is_null() && (*s).flags.adopted() && !(*s).prev.is_null() {
            (*s).prev
        } else {
            s
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_dispatch_ready_poll(
    p: *mut us_poll_t,
    error: c_int,
    eof: c_int,
    events: c_int,
) {
    // SAFETY: `p` is a live poll owned by the loop; its kind bits select the
    // correct cast and every callback invoked may free or relocate the handle.
    unsafe {
        match us_internal_poll_type(p) {
            POLL_TYPE_CALLBACK => {
                let cb = p as *mut us_internal_callback_t;
                // Timers/asyncs should accept (read); UDP sockets should not.
                if (*cb).leave_poll_ready == 0 {
                    #[cfg(not(windows))]
                    us_internal_accept_poll_event(p);
                }
                let arg = if (*cb).cb_expects_the_loop != 0 {
                    (*cb).loop_ as *mut us_internal_callback_t
                } else {
                    // `&cb->p` has the same address as `cb` (first field).
                    cb
                };
                (*cb).cb.unwrap_unchecked()(arg);
            }

            POLL_TYPE_SEMI_SOCKET => {
                // Connect and listen sockets are both semi-sockets polling for
                // different events. Test the WRITABLE bit (not equality) so a
                // pre-connect write's poll_change(R|W) still hits connect-done.
                if us_poll_events(p) & LIBUS_SOCKET_WRITABLE != 0 {
                    // Report the kernel's actual SO_ERROR (e.g. ECONNRESET for
                    // the completed-then-RST race) instead of the literal flag.
                    let mut connect_error = 0;
                    if error != 0 || eof != 0 {
                        connect_error = us_socket_get_error(p as *mut us_socket_t);
                        if connect_error == 0 {
                            connect_error = ECONNRESET;
                        }
                    }
                    us_internal_socket_after_open(p as *mut us_socket_t, connect_error);
                } else {
                    dispatch_listen_socket(p);
                }
            }

            POLL_TYPE_SOCKET_SHUT_DOWN | POLL_TYPE_SOCKET => {
                dispatch_stream_socket(p, error, eof, events);
            }

            POLL_TYPE_UDP => {
                let u = p as *mut us_udp_socket_t;
                if (*u).closed() {
                    return;
                }
                dispatch_udp_socket(p, u, error, events);
            }

            _ => {}
        }
    }
}

#[inline]
unsafe fn dispatch_listen_socket(p: *mut us_poll_t) {
    // SAFETY: `p` is a live listen socket (semi-socket polling READABLE).
    unsafe {
        let listen_socket = p as *mut us_listen_socket_t;
        let accept_group = (*listen_socket).accept_group;
        let loop_ = (*accept_group).loop_;
        let mut addr = MaybeUninit::<bsd_addr_t>::uninit();

        let mut client_fd = bsd_accept_socket(us_poll_fd(p), addr.as_mut_ptr());
        if client_fd == LIBUS_SOCKET_ERROR {
            // Todo: start timer here.
            return;
        }
        // Todo: stop timer if any.

        loop {
            let accepted_p = us_create_poll(
                loop_,
                0,
                (size_of::<us_socket_t>() - size_of::<us_poll_t>()) as c_uint
                    + (*listen_socket).socket_ext_size,
            );
            us_poll_init(accepted_p, client_fd, POLL_TYPE_SOCKET);
            if us_poll_start_rc(accepted_p, loop_, LIBUS_SOCKET_READABLE) != 0 {
                // EPOLL_CTL_ADD failed (e.g. ENOSPC). Close the fd so the peer
                // sees a RST instead of a silent non-answer.
                bsd_close_socket(client_fd);
                us_poll_free(accepted_p, loop_);
            } else {
                let mut s = accepted_p as *mut us_socket_t;

                (*s).group = accept_group;
                (*s).kind = (*listen_socket).accept_kind;
                (*s).ssl = ptr::null_mut();
                (*s).connect_state = ptr::null_mut();
                (*s).timeout = 255;
                (*s).long_timeout = 255;
                (*s).flags.set_low_prio_state(0);
                (*s).flags
                    .set_allow_half_open((*listen_socket).s.flags.allow_half_open());
                (*s).flags.set_is_paused(false);
                (*s).flags.set_is_ipc(false);
                (*s).flags.set_is_closed(false);
                (*s).flags.set_adopted(false);

                // We always use nodelay.
                bsd_socket_nodelay(client_fd, 1);

                us_internal_socket_group_link_socket(accept_group, s);

                if !(*listen_socket).ssl_ctx.is_null() {
                    us_internal_ssl_attach(
                        s,
                        (*listen_socket).ssl_ctx,
                        0,
                        ptr::null(),
                        listen_socket,
                    );
                    us_internal_ssl_on_open(
                        s,
                        0,
                        bsd_addr_get_ip(addr.as_mut_ptr()),
                        bsd_addr_get_ip_length(addr.as_mut_ptr()),
                    );
                } else {
                    us_dispatch_open(
                        s,
                        0,
                        bsd_addr_get_ip(addr.as_mut_ptr()),
                        bsd_addr_get_ip_length(addr.as_mut_ptr()),
                    );
                }
                s = follow_adoption(s);

                // With TCP_DEFER_ACCEPT/SO_ACCEPTFILTER the payload is already
                // buffered — dispatch readable now instead of round-tripping.
                if (*listen_socket).deferred_accept != 0
                    && !s.is_null()
                    && us_socket_is_closed(s) == 0
                {
                    us_internal_dispatch_ready_poll(
                        s as *mut us_poll_t,
                        0,
                        0,
                        LIBUS_SOCKET_READABLE,
                    );
                }

                // Exit accept loop if listen socket was closed in on_open or request handler.
                if us_socket_is_closed(ptr::addr_of_mut!((*listen_socket).s)) != 0 {
                    break;
                }
            }

            client_fd = bsd_accept_socket(us_poll_fd(p), addr.as_mut_ptr());
            if client_fd == LIBUS_SOCKET_ERROR {
                break;
            }
        }
    }
}

#[inline]
unsafe fn dispatch_stream_socket(p: *mut us_poll_t, error: c_int, mut eof: c_int, events: c_int) {
    // SAFETY: `p` is a live established/shut-down socket; we only use `s` past
    // this point (the poll may be relocated by adoption).
    unsafe {
        let mut s = follow_adoption(p as *mut us_socket_t);
        let loop_ = (*(*s).group).loop_;

        if events & LIBUS_SOCKET_WRITABLE != 0 && error == 0 {
            (*s).flags.set_last_write_failed(false);
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
            {
                // Kqueue EVFILT_WRITE is one-shot; clear POLLING_OUT to reflect
                // removal. Keep POLLING_IN from the poll's OWN state, not `events`.
                let pt = (*p).poll_type();
                (*p).set_poll_type((pt & POLL_TYPE_KIND_MASK) | (pt & POLL_TYPE_POLLING_IN));
            }

            s = if !(*s).ssl.is_null() {
                us_internal_ssl_on_writable(s)
            } else {
                us_dispatch_writable(s)
            };
            s = follow_adoption(s);

            if s.is_null() || us_socket_is_closed(s) != 0 {
                return;
            }

            // No failed write or we shut down → stop polling writable.
            if !(*s).flags.last_write_failed() || us_socket_is_shut_down(s) != 0 {
                let sp = ptr::addr_of_mut!((*s).p);
                us_poll_change(sp, loop_, us_poll_events(sp) & LIBUS_SOCKET_READABLE);
            } else {
                #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
                {
                    // Kqueue one-shot writable needs re-registration.
                    let sp = ptr::addr_of_mut!((*s).p);
                    us_poll_change(sp, loop_, us_poll_events(sp) | LIBUS_SOCKET_WRITABLE);
                }
            }
        }

        if events & LIBUS_SOCKET_READABLE != 0 {
            // Only the SSL handshake gate ever returns low-prio.
            if !(*s).ssl.is_null() && us_internal_ssl_is_low_prio(s) != 0 {
                let state = (*s).flags.low_prio_state();
                if state == 2 {
                    // Delayed once already — process this iteration.
                    (*s).flags.set_low_prio_state(0);
                } else if (*loop_).data.low_prio_budget > 0 {
                    (*loop_).data.low_prio_budget -= 1;
                } else {
                    let sp = ptr::addr_of_mut!((*s).p);
                    us_poll_change(sp, loop_, us_poll_events(sp) & LIBUS_SOCKET_WRITABLE);
                    // Already parked: a writable dispatch re-enabled READABLE.
                    // It sits in low_prio_head, NOT head_sockets — the unlink
                    // below would cross-wire the two lists. Leave it.
                    if state == 1 {
                        return;
                    }
                    let g = (*s).group;
                    // Bump BEFORE unlinking so maybe_unlink() still sees non-empty.
                    (*g).low_prio_count += 1;
                    us_internal_socket_group_unlink_socket(g, s);

                    // LIFO queue — prioritize newer clients under high load.
                    (*s).prev = ptr::null_mut();
                    (*s).next = (*loop_).data.low_prio_head;
                    if !(*s).next.is_null() {
                        (*(*s).next).prev = s;
                    }
                    (*loop_).data.low_prio_head = s;

                    (*s).flags.set_low_prio_state(1);
                    return;
                }
            }

            #[allow(unused_mut)]
            let mut repeat_recv_count: usize = 0;
            let recv_buf = (*loop_).data.recv_buf.add(LIBUS_RECV_BUFFER_PADDING);

            'recv: loop {
                #[cfg(windows)]
                let recv_flags: c_int = MSG_PUSH_IMMEDIATE;
                #[cfg(not(windows))]
                let recv_flags: c_int = MSG_DONTWAIT;

                #[allow(unused_assignments)]
                let mut length: c_int = 0;

                #[cfg(not(windows))]
                {
                    if (*s).flags.is_ipc() {
                        // recvmsg path: may carry an SCM_RIGHTS fd.
                        let mut msg: libc::msghdr = core::mem::zeroed();
                        let mut iov: libc::iovec = core::mem::zeroed();
                        let mut cmsg_buf =
                            [0u8; unsafe { libc::CMSG_SPACE(size_of::<c_int>() as c_uint) }
                                as usize];

                        iov.iov_base = recv_buf as *mut c_void;
                        iov.iov_len = LIBUS_RECV_BUFFER_LENGTH;

                        msg.msg_flags = 0;
                        msg.msg_iov = &mut iov;
                        msg.msg_iovlen = 1 as _;
                        msg.msg_name = ptr::null_mut();
                        msg.msg_namelen = 0;
                        msg.msg_controllen = libc::CMSG_LEN(size_of::<c_int>() as c_uint) as _;
                        msg.msg_control = cmsg_buf.as_mut_ptr() as *mut c_void;

                        length = bsd_recvmsg(
                            us_poll_fd(ptr::addr_of_mut!((*s).p)),
                            &mut msg,
                            recv_flags,
                        ) as c_int;

                        if length > 0 && msg.msg_controllen > 0 {
                            let cm = libc::CMSG_FIRSTHDR(&msg);
                            if !cm.is_null()
                                && (*cm).cmsg_level == libc::SOL_SOCKET
                                && (*cm).cmsg_type == libc::SCM_RIGHTS
                            {
                                let fd = ptr::read_unaligned(libc::CMSG_DATA(cm) as *const c_int);
                                s = us_dispatch_fd(s, fd);
                                if s.is_null() || us_socket_is_closed(s) != 0 {
                                    break 'recv;
                                }
                            }
                        }
                    } else {
                        length = bsd_recv(
                            us_poll_fd(ptr::addr_of_mut!((*s).p)),
                            recv_buf as *mut c_void,
                            LIBUS_RECV_BUFFER_LENGTH as c_int,
                            recv_flags,
                        ) as c_int;
                    }
                }
                #[cfg(windows)]
                {
                    length = bsd_recv(
                        us_poll_fd(ptr::addr_of_mut!((*s).p)),
                        recv_buf as *mut c_void,
                        LIBUS_RECV_BUFFER_LENGTH as c_int,
                        recv_flags,
                    ) as c_int;
                }

                if length > 0 {
                    s = if !(*s).ssl.is_null() {
                        us_internal_ssl_on_data(s, recv_buf, length)
                    } else {
                        us_dispatch_data(s, recv_buf, length)
                    };
                    s = follow_adoption(s);

                    #[cfg(not(windows))]
                    {
                        // Keep reading when we filled (nearly) the buffer AND either
                        // the socket has hung up or the loop isn't busy.
                        const BUSY_THRESHOLD: c_int = 25;
                        if !s.is_null()
                            && length >= (LIBUS_RECV_BUFFER_LENGTH - 24 * 1024) as c_int
                            && length <= LIBUS_RECV_BUFFER_LENGTH as c_int
                            && (error != 0 || (*loop_).num_ready_polls < BUSY_THRESHOLD)
                            && us_socket_is_closed(s) == 0
                            && !(*s).flags.is_paused()
                        {
                            repeat_recv_count += (error == 0) as usize;
                            // Cap at 10 non-error repeats to avoid starving others.
                            if !(repeat_recv_count > 10 && (*loop_).num_ready_polls > 2) {
                                continue 'recv;
                            }
                        }
                    }
                    #[cfg(windows)]
                    {
                        // AFD_POLL_ABORT isn't level-triggered; a RST landed while
                        // on the stack is only surfaced by a second recv probe.
                        if !s.is_null()
                            && us_socket_is_closed(s) == 0
                            && !(*s).flags.is_paused()
                            && {
                                let first = repeat_recv_count == 0;
                                repeat_recv_count += 1;
                                first
                            }
                        {
                            continue 'recv;
                        }
                    }
                } else if length == 0 {
                    eof = 1;
                    break 'recv;
                } else if length as LIBUS_SOCKET_DESCRIPTOR == LIBUS_SOCKET_ERROR
                    && bsd_would_block() == 0
                {
                    // Peer-initiated TCP error (RST etc.) — raw-close so the
                    // SSL path doesn't fire on_handshake for a passive close.
                    us_internal_socket_close_raw(s, libus_err(), ptr::null_mut());
                    return;
                }

                break 'recv;
            }
        }

        if eof != 0 && !s.is_null() {
            if unlikely(us_socket_is_closed(s) != 0) {
                return;
            }
            if us_socket_is_shut_down(s) != 0 {
                // Got FIN back after sending it.
                us_internal_socket_close_raw(
                    s,
                    LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN,
                    ptr::null_mut(),
                );
                return;
            }
            if (*s).flags.allow_half_open() {
                // Stop reading but KEEP writable so a queued end() still flushes.
                us_poll_change(ptr::addr_of_mut!((*s).p), loop_, LIBUS_SOCKET_WRITABLE);
                s = if !(*s).ssl.is_null() {
                    us_internal_ssl_on_end(s)
                } else {
                    us_dispatch_end(s)
                };
            } else {
                s = if !(*s).ssl.is_null() {
                    us_internal_ssl_on_end(s)
                } else {
                    us_dispatch_end(s)
                };
                us_internal_socket_close_raw(
                    s,
                    LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN,
                    ptr::null_mut(),
                );
                return;
            }
        }

        if error != 0 && !s.is_null() {
            // Fetch the real errno; clamp values 0..2 which collide with the
            // libus CloseCode enum JS filters out.
            let socket_error = us_socket_get_error(s);
            us_internal_socket_close_raw(
                s,
                if socket_error > 2 {
                    socket_error
                } else {
                    ECONNRESET
                },
                ptr::null_mut(),
            );
        }
    }
}

#[inline]
#[allow(unused_mut, unused_assignments)]
unsafe fn dispatch_udp_socket(
    p: *mut us_poll_t,
    u: *mut us_udp_socket_t,
    mut error: c_int,
    events: c_int,
) {
    // SAFETY: `u` is a live UDP socket; callbacks may close it (checked each step).
    unsafe {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let mut recv_error_surfaced: c_int = 0;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let mut recv_would_block_only: c_int = 0;

        #[cfg(any(target_os = "linux", target_os = "android"))]
        if error != 0 {
            // IP_RECVERR: EPOLLERR stays level-triggered until MSG_ERRQUEUE is
            // drained; surface each queued ICMP error via on_recv_error.
            drain_udp_errqueue(p, u, &mut recv_error_surfaced);
        }

        if events & LIBUS_SOCKET_READABLE != 0 && !(*u).closed() {
            loop {
                let mut recvbuf = MaybeUninit::<udp_recvbuf>::uninit();
                bsd_udp_setup_recvbuf(
                    recvbuf.as_mut_ptr(),
                    (*(*u).loop_).data.recv_buf as *mut c_void,
                    LIBUS_RECV_BUFFER_LENGTH,
                );
                let npackets = bsd_recvmmsg(us_poll_fd(p), recvbuf.as_mut_ptr(), MSG_DONTWAIT);
                if npackets > 0 {
                    (*u).on_data.unwrap_unchecked()(
                        u,
                        recvbuf.as_mut_ptr() as *mut c_void,
                        npackets,
                    );
                } else {
                    if npackets as LIBUS_SOCKET_DESCRIPTOR == LIBUS_SOCKET_ERROR {
                        if bsd_would_block() == 0 {
                            #[cfg(any(target_os = "linux", target_os = "android"))]
                            {
                                let recv_err = errno();
                                recv_error_surfaced = 1;
                                if let Some(cb) = (*u).on_recv_error {
                                    cb(u, recv_err);
                                }
                            }
                            #[cfg(not(any(target_os = "linux", target_os = "android")))]
                            {
                                error = 1;
                            }
                        } else {
                            #[cfg(any(target_os = "linux", target_os = "android"))]
                            {
                                recv_would_block_only = 1;
                            }
                        }
                    }
                    break;
                }
                if (*u).closed() {
                    break;
                }
            }
        }

        if events & LIBUS_SOCKET_WRITABLE != 0 && !(*u).closed() {
            // Clear WRITABLE before on_drain so a callback that re-arms it keeps
            // the re-arm. Not gated on !error so a queued ICMP error doesn't spin.
            let up = ptr::addr_of_mut!((*u).p);
            us_poll_change(up, (*u).loop_, us_poll_events(up) & LIBUS_SOCKET_READABLE);
            (*u).on_drain.unwrap_unchecked()(u);
            if (*u).closed() {
                return;
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        if error != 0 && recv_error_surfaced == 0 && recv_would_block_only == 0 && !(*u).closed() {
            us_udp_socket_close(u);
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        if error != 0 && !(*u).closed() {
            us_udp_socket_close(u);
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
unsafe fn drain_udp_errqueue(
    p: *mut us_poll_t,
    u: *mut us_udp_socket_t,
    recv_error_surfaced: &mut c_int,
) {
    // SAFETY: `u` is live; recvmsg(MSG_ERRQUEUE) reads the socket's error queue.
    unsafe {
        let mut ectrl = [0u8; 512];
        let mut ebuf = [0u8; 1];
        while !(*u).closed() {
            let mut eiov = libc::iovec {
                iov_base: ebuf.as_mut_ptr() as *mut c_void,
                iov_len: ebuf.len(),
            };
            let mut eh: libc::msghdr = core::mem::zeroed();
            eh.msg_iov = &mut eiov;
            eh.msg_iovlen = 1 as _;
            eh.msg_control = ectrl.as_mut_ptr() as *mut c_void;
            eh.msg_controllen = ectrl.len() as _;
            if libc::recvmsg(us_poll_fd(p), &mut eh, libc::MSG_ERRQUEUE) < 0 {
                break;
            }
            *recv_error_surfaced = 1;
            if let Some(cb) = (*u).on_recv_error {
                // The queued ICMP error is in sock_extended_err, not errno.
                let mut ee: c_int = 0;
                let mut cm = libc::CMSG_FIRSTHDR(&eh);
                while !cm.is_null() {
                    if ((*cm).cmsg_level == libc::IPPROTO_IP && (*cm).cmsg_type == libc::IP_RECVERR)
                        || ((*cm).cmsg_level == libc::IPPROTO_IPV6
                            && (*cm).cmsg_type == libc::IPV6_RECVERR)
                    {
                        let se = libc::CMSG_DATA(cm) as *const libc::sock_extended_err;
                        ee = (*se).ee_errno as c_int;
                        break;
                    }
                    cm = libc::CMSG_NXTHDR(&mut eh, cm);
                }
                cb(u, if ee != 0 { ee } else { libc::ECONNREFUSED });
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Misc
// ═══════════════════════════════════════════════════════════════════════════

/// Integration only requires the timer to be set up; it is enabled dynamically
/// by socket count.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_integrate(_loop: *mut us_loop_t) {}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_ext(loop_: *mut us_loop_t) -> *mut c_void {
    // SAFETY: the ext area is the bytes immediately past the `us_loop_t`.
    unsafe { loop_.add(1) as *mut c_void }
}
