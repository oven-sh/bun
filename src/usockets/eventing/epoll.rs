#![cfg(any(target_os = "linux", target_os = "android"))]
//! epoll eventing backend. Port of `packages/bun-usockets/src/eventing/epoll_kqueue.c`
//! (epoll arms only) and `internal/eventing/epoll_kqueue.h`.

use core::ffi::{c_char, c_int, c_longlong, c_uint, c_void};
use core::mem::{MaybeUninit, size_of};
use core::ptr;
use core::sync::atomic::{AtomicI32, AtomicU32, Ordering};

use crate::types::{
    Bun__outOfMemory, Bun__panic, LIBUS_MAX_READY_POLLS, LIBUS_SOCKET_DESCRIPTOR,
    POLL_TYPE_CALLBACK, POLL_TYPE_KIND_MASK, POLL_TYPE_POLLING_IN, POLL_TYPE_POLLING_MASK,
    POLL_TYPE_POLLING_OUT, us_calloc, us_free, us_internal_async, us_internal_callback_t,
    us_internal_loop_data_t, us_malloc, us_socket_t,
};

// ═══════════════════════════════════════════════════════════════════════════
// Backend-specific constants
// ═══════════════════════════════════════════════════════════════════════════

pub const LIBUS_SOCKET_READABLE: c_int = libc::EPOLLIN;
pub const LIBUS_SOCKET_WRITABLE: c_int = libc::EPOLLOUT;

/// Pointer tags distinguish a Bun `FilePoll` (high bits set) from a uSockets `us_poll_t*`.
const UNSET_BITS_49_UNTIL_64: usize = 0x0000_FFFF_FFFF_FFFF;

#[inline(always)]
fn clear_pointer_tag<T>(p: *mut T) -> *mut T {
    (p as usize & UNSET_BITS_49_UNTIL_64) as *mut T
}

#[inline(always)]
unsafe fn errno() -> c_int {
    unsafe extern "C" {
        #[cfg_attr(target_os = "linux", link_name = "__errno_location")]
        #[cfg_attr(target_os = "android", link_name = "__errno")]
        fn __errno() -> *mut c_int;
    }
    // SAFETY: __errno_location()/__errno() always returns a valid thread-local pointer.
    unsafe { *__errno() }
}

#[inline(always)]
unsafe fn is_eintr(rc: isize) -> bool {
    // SAFETY: reads thread-local errno; always valid.
    rc == -1 && unsafe { errno() } == libc::EINTR
}

// ═══════════════════════════════════════════════════════════════════════════
// Externs provided by other translation units
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn Bun__internal_dispatch_ready_poll(loop_: *mut c_void, poll: *mut c_void);
    fn Bun__isEpollPwait2SupportedOnLinuxKernel() -> c_int;
    fn Bun__JSC_onBeforeWait(jsc_vm: *mut c_void);

    fn sys_epoll_pwait2(
        epfd: c_int,
        events: *mut libc::epoll_event,
        maxevents: c_int,
        timeout: *const libc::timespec,
        sigmask: *const libc::sigset_t,
    ) -> isize;

    fn us_internal_loop_data_init(
        loop_: *mut us_loop_t,
        wakeup_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
        pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
        post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    );
    fn us_internal_loop_data_free(loop_: *mut us_loop_t);
    fn us_internal_loop_pre(loop_: *mut us_loop_t);
    fn us_internal_loop_post(loop_: *mut us_loop_t);
    fn us_internal_sweep_timeout_ns(loop_: *mut us_loop_t) -> c_longlong;
    fn us_internal_sweep_if_due(loop_: *mut us_loop_t);
    fn us_internal_dispatch_ready_poll(p: *mut us_poll_t, error: c_int, eof: c_int, events: c_int);
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_poll_t` — 4-byte packed state, 16-byte aligned
// ═══════════════════════════════════════════════════════════════════════════

/// Mirrors the C `alignas(16) struct { int fd:27; unsigned poll_type:5; } state`.
/// Bit layout: `poll_type` in bits 0..5, `fd` (sign-extended) in bits 5..32.
#[repr(C, align(16))]
pub struct us_poll_t {
    state: u32,
}

impl us_poll_t {
    #[inline(always)]
    pub fn fd(&self) -> c_int {
        (self.state as i32) >> 5
    }
    #[inline(always)]
    pub fn poll_type(&self) -> c_int {
        (self.state & 0x1F) as c_int
    }
    #[inline(always)]
    fn set_fd(&mut self, fd: c_int) {
        self.state = (self.state & 0x1F) | ((fd as u32) << 5);
    }
    #[inline(always)]
    fn set_poll_type(&mut self, t: c_int) {
        self.state = (self.state & !0x1F) | (t as u32 & 0x1F);
    }
}

const _: () = assert!(size_of::<us_poll_t>() == 16);

// ═══════════════════════════════════════════════════════════════════════════
// `us_loop_t`
// ═══════════════════════════════════════════════════════════════════════════

/// `alignas(16) struct epoll_event ready_polls[1024]` — wrapped so the 16-byte
/// alignment on the array's start address is honored.
#[repr(C, align(16))]
pub struct ReadyPolls(pub [libc::epoll_event; LIBUS_MAX_READY_POLLS]);

#[repr(C, align(16))]
pub struct us_loop_t {
    pub data: us_internal_loop_data_t,
    /// Number of non-fallthrough polls in the loop.
    pub num_polls: c_int,
    /// Number of ready polls this iteration.
    pub num_ready_polls: c_int,
    /// Current index in list of ready polls.
    pub current_ready_poll: c_int,
    /// Loop's own epoll file descriptor.
    pub fd: c_int,
    /// Number of polls owned by Bun.
    pub bun_polls: c_uint,
    /// Incremented atomically by wakeup(), swapped to 0 before epoll_wait.
    /// Non-zero means the wait will return immediately so skip the GC safepoint.
    pub pending_wakeups: AtomicU32,
    pub ready_polls: ReadyPolls,
}

/// Opaque on epoll/kqueue; concrete only under libuv.
#[repr(C)]
pub struct us_timer_t {
    _p: [u8; 0],
}

// ═══════════════════════════════════════════════════════════════════════════
// ready_polls helpers (raw-pointer access so dispatch re-entrancy is sound)
// ═══════════════════════════════════════════════════════════════════════════

#[inline(always)]
unsafe fn ready_poll_ptr(loop_: *mut us_loop_t, index: c_int) -> *mut libc::epoll_event {
    // SAFETY: caller guarantees `index` is in-bounds of `ready_polls`.
    unsafe {
        ptr::addr_of_mut!((*loop_).ready_polls.0)
            .cast::<libc::epoll_event>()
            .add(index as usize)
    }
}

#[inline(always)]
unsafe fn get_ready_poll(loop_: *mut us_loop_t, index: c_int) -> *mut us_poll_t {
    // SAFETY: `u64` overlays `data.ptr` in the C `epoll_data` union.
    unsafe { (*ready_poll_ptr(loop_, index)).u64 as usize as *mut us_poll_t }
}

#[inline(always)]
unsafe fn set_ready_poll(loop_: *mut us_loop_t, index: c_int, poll: *mut us_poll_t) {
    // SAFETY: in-bounds packed-field store; Rust emits an unaligned write.
    unsafe { (*ready_poll_ptr(loop_, index)).u64 = poll as usize as u64 }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop lifecycle
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_free(loop_: *mut us_loop_t) {
    // SAFETY: caller owns `loop_`; frees all loop-owned resources then the allocation.
    unsafe {
        us_internal_loop_data_free(loop_);
        libc::close((*loop_).fd);
        us_free(loop_.cast());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_poll(
    loop_: *mut us_loop_t,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_poll_t {
    // SAFETY: `loop_` is a live loop; allocation owned by caller until `us_poll_free`.
    unsafe {
        if fallthrough == 0 {
            (*loop_).num_polls += 1;
        }
        let p = us_malloc(size_of::<us_poll_t>() + ext_size as usize);
        if p.is_null() {
            Bun__outOfMemory();
        }
        clear_pointer_tag(p).cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_free(p: *mut us_poll_t, loop_: *mut us_loop_t) {
    // SAFETY: caller guarantees `p` was returned by `us_create_poll` on `loop_`.
    unsafe {
        (*loop_).num_polls -= 1;
        us_free(p.cast());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_ext(p: *mut us_poll_t) -> *mut c_void {
    // SAFETY: `p` was allocated with trailing ext bytes.
    unsafe { p.add(1).cast() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_init(
    p: *mut us_poll_t,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    poll_type: c_int,
) {
    // SAFETY: `p` is a valid poll; writes both bitfields.
    unsafe {
        (*p).set_fd(fd);
        (*p).set_poll_type(poll_type);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_events(p: *mut us_poll_t) -> c_int {
    // SAFETY: `p` is a valid poll.
    let pt = unsafe { (*p).poll_type() };
    (if pt & POLL_TYPE_POLLING_IN != 0 {
        LIBUS_SOCKET_READABLE
    } else {
        0
    }) | (if pt & POLL_TYPE_POLLING_OUT != 0 {
        LIBUS_SOCKET_WRITABLE
    } else {
        0
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_fd(p: *mut us_poll_t) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: `p` is a valid poll.
    unsafe { (*p).fd() }
}

/// Returns the "kind" (listen/socket/shutdown/callback) with polling bits masked off.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_type(p: *mut us_poll_t) -> c_int {
    // SAFETY: `p` is a valid poll.
    unsafe { (*p).poll_type() & POLL_TYPE_KIND_MASK }
}

/// Overwrites the kind bits, preserves polling-direction bits — reads-then-changes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_set_type(p: *mut us_poll_t, poll_type: c_int) {
    // SAFETY: `p` is a valid poll.
    unsafe {
        let preserved = (*p).poll_type() & POLL_TYPE_POLLING_MASK;
        (*p).set_poll_type(poll_type | preserved);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// epoll_pwait2 probe + fallback
// ═══════════════════════════════════════════════════════════════════════════

/// Tri-state: -1 unknown, 0 unsupported, else supported. Benign race (monotonic).
static HAS_EPOLL_PWAIT2: AtomicI32 = AtomicI32::new(-1);

unsafe fn bun_epoll_pwait2(
    epfd: c_int,
    events: *mut libc::epoll_event,
    maxevents: c_int,
    timeout: *const libc::timespec,
) -> c_int {
    // SAFETY: all pointer arguments are valid for the kernel ABI; retries on EINTR.
    unsafe {
        let mut mask = MaybeUninit::<libc::sigset_t>::uninit();
        libc::sigemptyset(mask.as_mut_ptr());
        let mask = mask.as_ptr();

        if HAS_EPOLL_PWAIT2.load(Ordering::Relaxed) != 0 {
            let mut ret: isize;
            loop {
                ret = sys_epoll_pwait2(epfd, events, maxevents, timeout, mask);
                // Raw syscall returns -errno directly, not -1+errno.
                if ret != -(libc::EINTR as isize) {
                    break;
                }
            }
            if ret != -(libc::ENOSYS as isize)
                && ret != -(libc::EPERM as isize)
                && ret != -(libc::EOPNOTSUPP as isize)
                && ret != -(libc::EACCES as isize)
                && ret != -(libc::EFAULT as isize)
            {
                return ret as c_int;
            }
            HAS_EPOLL_PWAIT2.store(0, Ordering::Relaxed);
        }

        let timeout_ms: c_int = if timeout.is_null() {
            -1
        } else {
            ((*timeout).tv_sec * 1000 + (*timeout).tv_nsec / 1_000_000) as c_int
        };

        unsafe extern "C" {
            fn epoll_pwait(
                epfd: c_int,
                events: *mut libc::epoll_event,
                maxevents: c_int,
                timeout: c_int,
                sigmask: *const libc::sigset_t,
            ) -> c_int;
        }
        let mut ret: c_int;
        loop {
            ret = epoll_pwait(epfd, events, maxevents, timeout_ms, mask);
            if !is_eintr(ret as isize) {
                break;
            }
        }
        ret
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_loop(
    _hint: *mut c_void,
    wakeup_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    ext_size: c_uint,
) -> *mut us_loop_t {
    // SAFETY: allocates and fully initializes a loop; caller owns it until `us_loop_free`.
    unsafe {
        let loop_ = us_calloc(1, size_of::<us_loop_t>() + ext_size as usize).cast::<us_loop_t>();
        if loop_.is_null() {
            Bun__outOfMemory();
        }
        (*loop_).num_polls = 0;
        // These could be accessed if we close a poll before starting the loop.
        (*loop_).num_ready_polls = 0;
        (*loop_).current_ready_poll = 0;
        (*loop_).bun_polls = 0;

        (*loop_).fd = libc::epoll_create1(libc::EPOLL_CLOEXEC);

        if HAS_EPOLL_PWAIT2.load(Ordering::Relaxed) == -1
            && Bun__isEpollPwait2SupportedOnLinuxKernel() == 0
        {
            HAS_EPOLL_PWAIT2.store(0, Ordering::Relaxed);
        }

        us_internal_loop_data_init(loop_, wakeup_cb, pre_cb, post_cb);
        loop_
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatch
// ═══════════════════════════════════════════════════════════════════════════

/// Shared dispatch loop for both us_loop_run and us_loop_run_bun_tick.
unsafe fn us_internal_dispatch_ready_polls(loop_: *mut us_loop_t) {
    // SAFETY: iterates via the struct field so re-entrant callees that call
    // `us_internal_loop_update_pending_ready_polls` observe the live index.
    unsafe {
        (*loop_).current_ready_poll = 0;
        while (*loop_).current_ready_poll < (*loop_).num_ready_polls {
            let idx = (*loop_).current_ready_poll;
            let poll = get_ready_poll(loop_, idx);
            if !poll.is_null() {
                if clear_pointer_tag(poll) != poll {
                    Bun__internal_dispatch_ready_poll(loop_.cast(), poll.cast());
                    (*loop_).current_ready_poll += 1;
                    continue;
                }
                let mut events = (*ready_poll_ptr(loop_, idx)).events as c_int;
                // Normalize to 0/1: forwarded as a close code; raw EPOLLERR(8)
                // would surface as errno 8 (ENOEXEC) in the JS error path.
                let error = (events & libc::EPOLLERR != 0) as c_int;
                let eof = events & libc::EPOLLHUP;
                events &= us_poll_events(poll);
                if events != 0 || error != 0 || eof != 0 {
                    us_internal_dispatch_ready_poll(poll, error, eof, events);
                }
            }
            (*loop_).current_ready_poll += 1;
        }
    }
}

/// If the kernel filled our entire buffer, more events are likely queued.
/// Re-poll non-blocking and dispatch again before running pre/post callbacks.
/// Capped at 48 iterations — matches libuv's uv__io_poll.
unsafe fn us_internal_drain_ready_polls(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live for the duration; re-reads fields each iteration.
    unsafe {
        let mut drain_count: c_int = 48;
        while (*loop_).num_ready_polls == LIBUS_MAX_READY_POLLS as c_int
            && {
                drain_count -= 1;
                drain_count != 0
            }
            && (*loop_).num_polls > 0
        {
            static ZERO: libc::timespec = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            (*loop_).num_ready_polls = bun_epoll_pwait2(
                (*loop_).fd,
                ptr::addr_of_mut!((*loop_).ready_polls.0).cast(),
                LIBUS_MAX_READY_POLLS as c_int,
                &raw const ZERO,
            );
            if (*loop_).num_ready_polls <= 0 {
                (*loop_).num_ready_polls = 0;
                break;
            }
            us_internal_dispatch_ready_polls(loop_);
        }
    }
}

/// Bound `timeout` by the socket-timeout sweep deadline (null == forever).
unsafe fn us_internal_clamp_to_sweep(
    loop_: *mut us_loop_t,
    timeout: *const libc::timespec,
    storage: *mut libc::timespec,
) -> *const libc::timespec {
    // SAFETY: `storage` is caller-provided stack memory; may return `timeout` or `storage`.
    unsafe {
        let ns = us_internal_sweep_timeout_ns(loop_);
        if ns < 0 {
            return timeout;
        }
        let sweep_sec = ns / 1_000_000_000;
        let sweep_nsec = ns % 1_000_000_000;
        if !timeout.is_null()
            && (c_longlong::from((*timeout).tv_sec) < sweep_sec
                || (c_longlong::from((*timeout).tv_sec) == sweep_sec
                    && (*timeout).tv_nsec <= sweep_nsec as libc::c_long))
        {
            return timeout;
        }
        (*storage).tv_sec = sweep_sec as _;
        (*storage).tv_nsec = sweep_nsec as libc::c_long;
        storage
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is a live loop owned by the caller for the full run.
    unsafe {
        // While we have non-fallthrough polls we shouldn't fall through.
        while (*loop_).num_polls != 0 {
            (*loop_).data.tick_depth += 1;
            us_internal_loop_pre(loop_);

            let mut sweep_ts = MaybeUninit::<libc::timespec>::uninit();
            let timeout = us_internal_clamp_to_sweep(loop_, ptr::null(), sweep_ts.as_mut_ptr());

            (*loop_).num_ready_polls = bun_epoll_pwait2(
                (*loop_).fd,
                ptr::addr_of_mut!((*loop_).ready_polls.0).cast(),
                LIBUS_MAX_READY_POLLS as c_int,
                timeout,
            );

            us_internal_dispatch_ready_polls(loop_);
            us_internal_drain_ready_polls(loop_);
            us_internal_sweep_if_due(loop_);

            us_internal_loop_post(loop_);
            (*loop_).data.tick_depth -= 1;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run_bun_tick(
    loop_: *mut us_loop_t,
    timeout: *const libc::timespec,
) {
    // SAFETY: `loop_` is a live loop; `timeout` may be null.
    unsafe {
        if (*loop_).num_polls == 0 {
            return;
        }

        (*loop_).data.tick_depth += 1;
        us_internal_loop_pre(loop_);

        // Fold in the QUIC earliest-tick deadline so retransmit/idle timers
        // fire without other I/O waking us (callers may pass NULL).
        let mut timeout = timeout;
        let mut quic_ts = MaybeUninit::<libc::timespec>::uninit();
        if !(*loop_).data.quic_head.is_null() && (*loop_).data.quic_next_tick_us >= 0 {
            let us: c_longlong = (*loop_).data.quic_next_tick_us;
            if timeout.is_null()
                || (*timeout).tv_sec as c_longlong * 1_000_000
                    + (*timeout).tv_nsec as c_longlong / 1000
                    > us
            {
                (*quic_ts.as_mut_ptr()).tv_sec = (us / 1_000_000) as _;
                (*quic_ts.as_mut_ptr()).tv_nsec = ((us % 1_000_000) * 1000) as libc::c_long;
                timeout = quic_ts.as_ptr();
            }
        }

        let mut sweep_ts = MaybeUninit::<libc::timespec>::uninit();
        let timeout = us_internal_clamp_to_sweep(loop_, timeout, sweep_ts.as_mut_ptr());

        let had_wakeups = (*loop_).pending_wakeups.swap(0, Ordering::Acquire);
        let will_idle = had_wakeups == 0
            && (timeout.is_null() || ((*timeout).tv_nsec != 0 || (*timeout).tv_sec != 0));
        if will_idle && !(*loop_).data.jsc_vm.is_null() {
            Bun__JSC_onBeforeWait((*loop_).data.jsc_vm);
        }

        // A zero timespec has a fast path in ep_poll (fs/eventpoll.c); no
        // KEVENT_FLAG_IMMEDIATE equivalent needed.
        (*loop_).num_ready_polls = bun_epoll_pwait2(
            (*loop_).fd,
            ptr::addr_of_mut!((*loop_).ready_polls.0).cast(),
            LIBUS_MAX_READY_POLLS as c_int,
            timeout,
        );

        us_internal_dispatch_ready_polls(loop_);
        us_internal_drain_ready_polls(loop_);
        us_internal_sweep_if_due(loop_);

        us_internal_loop_post(loop_);
        (*loop_).data.tick_depth -= 1;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_loop_update_pending_ready_polls(
    loop_: *mut us_loop_t,
    old_poll: *mut us_poll_t,
    new_poll: *mut us_poll_t,
    _old_events: c_int,
    _new_events: c_int,
) {
    // SAFETY: scans `ready_polls` from the live dispatch cursor; tombstones or redirects matches.
    unsafe {
        // Epoll only has one ready poll per poll.
        let mut remaining: c_int = 1;
        let mut i = (*loop_).current_ready_poll;
        while i < (*loop_).num_ready_polls && remaining != 0 {
            if get_ready_poll(loop_, i) == old_poll {
                set_ready_poll(loop_, i, new_poll);
                remaining -= 1;
            }
            i += 1;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Poll registration
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_resize(
    p: *mut us_poll_t,
    loop_: *mut us_loop_t,
    old_ext_size: c_uint,
    ext_size: c_uint,
) -> *mut us_poll_t {
    // SAFETY: `p` was allocated with `old_ext_size` trailing bytes; caller frees `p` later.
    unsafe {
        let old_size = size_of::<us_poll_t>() + old_ext_size as usize;
        let new_size = size_of::<us_poll_t>() + ext_size as usize;
        if new_size <= old_size {
            return p;
        }

        let new_p = us_calloc(1, new_size).cast::<us_poll_t>();
        if new_p.is_null() {
            Bun__outOfMemory();
        }
        libc::memcpy(new_p.cast(), p.cast(), old_size);

        // The old poll is freed separately which decrements; keep the total correct.
        (*loop_).num_polls += 1;

        let events = us_poll_events(p);
        // Forcefully update poll by stripping away already-set events.
        (*new_p).set_poll_type(us_internal_poll_type(new_p));
        us_poll_change(new_p, loop_, events);

        // us_poll_change doesn't update the old poll entry.
        us_internal_loop_update_pending_ready_polls(loop_, p, new_p, events, events);
        new_p
    }
}

#[inline]
fn compute_poll_type(kind: c_int, events: c_int) -> c_int {
    kind | (if events & LIBUS_SOCKET_READABLE != 0 {
        POLL_TYPE_POLLING_IN
    } else {
        0
    }) | (if events & LIBUS_SOCKET_WRITABLE != 0 {
        POLL_TYPE_POLLING_OUT
    } else {
        0
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start_rc(
    p: *mut us_poll_t,
    loop_: *mut us_loop_t,
    mut events: c_int,
) -> c_int {
    // SAFETY: `p` is a valid poll with an initialized fd; registers it with epoll.
    unsafe {
        (*p).set_poll_type(compute_poll_type(us_internal_poll_type(p), events));

        if events & LIBUS_SOCKET_READABLE == 0 && events & LIBUS_SOCKET_WRITABLE == 0 {
            // EPOLLHUP/EPOLLERR are always reported; never add EPOLLRDHUP for a
            // half-closed socket or a level-triggered loop spins at 100% CPU.
            events |= libc::EPOLLHUP | libc::EPOLLERR;
        }
        let mut event = libc::epoll_event {
            events: events as u32,
            u64: p as usize as u64,
        };
        let mut ret: c_int;
        loop {
            ret = libc::epoll_ctl((*loop_).fd, libc::EPOLL_CTL_ADD, (*p).fd(), &raw mut event);
            if !is_eintr(ret as isize) {
                break;
            }
        }
        ret
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start(p: *mut us_poll_t, loop_: *mut us_loop_t, events: c_int) {
    // SAFETY: delegates to `_rc`, discarding the return code.
    unsafe {
        us_poll_start_rc(p, loop_, events);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_change(
    p: *mut us_poll_t,
    loop_: *mut us_loop_t,
    mut events: c_int,
) {
    // SAFETY: `p` is already registered; issues EPOLL_CTL_MOD when the set differs.
    unsafe {
        let old_events = us_poll_events(p);
        if old_events == events {
            return;
        }
        (*p).set_poll_type(compute_poll_type(us_internal_poll_type(p), events));

        if events & LIBUS_SOCKET_READABLE == 0 && events & LIBUS_SOCKET_WRITABLE == 0 {
            // See us_poll_start_rc: never add EPOLLRDHUP here.
            events |= libc::EPOLLHUP | libc::EPOLLERR;
        }
        let mut event = libc::epoll_event {
            events: events as u32,
            u64: p as usize as u64,
        };
        loop {
            let rc = libc::epoll_ctl((*loop_).fd, libc::EPOLL_CTL_MOD, (*p).fd(), &raw mut event);
            if !is_eintr(rc as isize) {
                break;
            }
        }
        // Set all removed events to null-polls in pending ready poll list.
        us_internal_loop_update_pending_ready_polls(loop_, p, p, old_events, events);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_stop(p: *mut us_poll_t, loop_: *mut us_loop_t) {
    // SAFETY: `p` is registered on `loop_`; EPOLL_CTL_DEL ignores the event arg.
    unsafe {
        let old_events = us_poll_events(p);
        let new_events = 0;
        let mut event = MaybeUninit::<libc::epoll_event>::zeroed();
        loop {
            let rc = libc::epoll_ctl(
                (*loop_).fd,
                libc::EPOLL_CTL_DEL,
                (*p).fd(),
                event.as_mut_ptr(),
            );
            if !is_eintr(rc as isize) {
                break;
            }
        }
        // Disable any instance of us in the pending ready poll list.
        us_internal_loop_update_pending_ready_polls(
            loop_,
            p,
            ptr::null_mut(),
            old_events,
            new_events,
        );
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_accept_poll_event(p: *mut us_poll_t) -> usize {
    // SAFETY: `p` wraps a readable eventfd; drains the counter.
    unsafe {
        let fd = us_poll_fd(p);
        let mut buf: u64 = 0;
        loop {
            let rc = libc::read(fd, (&raw mut buf).cast(), 8);
            if !is_eintr(rc) {
                break;
            }
        }
        buf as usize
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Async (internal helper for the loop's wakeup feature)
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_create_async(
    loop_: *mut us_loop_t,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_internal_async {
    // SAFETY: allocates a callback-type poll backed by an eventfd; caller owns it.
    unsafe {
        let cb_size = size_of::<us_internal_callback_t>() + ext_size as usize;
        let p = us_create_poll(loop_, fallthrough, cb_size as c_uint);
        libc::memset(p.cast(), 0, cb_size);

        let efd = libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC);
        if efd == -1 {
            // eventfd only fails on EMFILE/ENFILE; the loop is unusable without
            // wakeup_async and the caller doesn't null-check. Crash loudly.
            const MSG: &[u8] = b"eventfd() failed during loop init (out of file descriptors?)";
            Bun__panic(MSG.as_ptr().cast::<c_char>(), MSG.len());
        }
        us_poll_init(p, efd, POLL_TYPE_CALLBACK);

        let cb = p.cast::<us_internal_callback_t>();
        (*cb).loop_ = loop_;
        (*cb).cb_expects_the_loop = 1;
        // Edge-triggered: skip reading eventfd on wakeup.
        (*cb).leave_poll_ready = 1;
        cb
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_close(a: *mut us_internal_async) {
    // SAFETY: `a` was returned by `us_internal_create_async`; frees eventfd and poll.
    unsafe {
        let cb = a.cast::<us_internal_callback_t>();
        us_poll_stop(ptr::addr_of_mut!((*cb).p), (*cb).loop_);
        libc::close(us_poll_fd(ptr::addr_of_mut!((*cb).p)));
        // Regular sockets are the only polls not freed immediately.
        us_poll_free(a.cast::<us_poll_t>(), (*cb).loop_);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_set(
    a: *mut us_internal_async,
    cb: Option<unsafe extern "C" fn(*mut us_internal_async)>,
) {
    // SAFETY: `a` is a live async; stores the callback and registers edge-triggered.
    unsafe {
        let internal_cb = a.cast::<us_internal_callback_t>();
        // `us_internal_async` is a type alias for `us_internal_callback_t`.
        (*internal_cb).cb = cb;

        us_poll_start(
            a.cast::<us_poll_t>(),
            (*internal_cb).loop_,
            LIBUS_SOCKET_READABLE,
        );

        // Upgrade to edge-triggered to avoid reading the eventfd on each wakeup.
        let mut event = libc::epoll_event {
            events: (libc::EPOLLIN | libc::EPOLLET) as u32,
            u64: a as usize as u64,
        };
        libc::epoll_ctl(
            (*(*internal_cb).loop_).fd,
            libc::EPOLL_CTL_MOD,
            us_poll_fd(a.cast::<us_poll_t>()),
            &raw mut event,
        );
    }
}

/// Thread-safe: may be called from any thread.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_wakeup(a: *mut us_internal_async) {
    // SAFETY: `a` wraps a live eventfd; write is atomic and thread-safe.
    unsafe {
        let fd = us_poll_fd(a.cast::<us_poll_t>());
        let mut val: u64;
        loop {
            val = 1;
            if libc::write(fd, (&raw const val).cast(), 8) >= 0 {
                return;
            }
            match errno() {
                libc::EINTR => continue,
                libc::EAGAIN => {
                    // Counter overflow — drain and retry.
                    if libc::read(fd, (&raw mut val).cast(), 8) > 0
                        || errno() == libc::EAGAIN
                        || errno() == libc::EINTR
                    {
                        continue;
                    }
                    break;
                }
                _ => break,
            }
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_get_error(s: *mut us_socket_t) -> c_int {
    // SAFETY: `us_poll_t` is the first field of `us_socket_t` (repr(C) first-field cast).
    unsafe {
        let mut error: c_int = 0;
        let mut len = size_of::<c_int>() as libc::socklen_t;
        if libc::getsockopt(
            us_poll_fd(s.cast::<us_poll_t>()),
            libc::SOL_SOCKET,
            libc::SO_ERROR,
            (&raw mut error).cast(),
            &raw mut len,
        ) == -1
        {
            return errno();
        }
        error
    }
}
