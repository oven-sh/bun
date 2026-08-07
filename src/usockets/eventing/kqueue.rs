#![cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
//! kqueue eventing backend. Ports `packages/bun-usockets/src/eventing/epoll_kqueue.c`
//! (the `LIBUS_USE_KQUEUE` half) and `internal/eventing/epoll_kqueue.h`.

use core::ffi::{c_int, c_longlong, c_uint, c_void};
use core::mem::{MaybeUninit, size_of};
use core::ptr;
use core::sync::atomic::{AtomicU32, Ordering};

use libc::timespec;

use crate::types::{
    Bun__outOfMemory, LIBUS_MAX_READY_POLLS, LIBUS_SOCKET_DESCRIPTOR, POLL_TYPE_CALLBACK,
    POLL_TYPE_KIND_MASK, POLL_TYPE_POLLING_IN, POLL_TYPE_POLLING_MASK, POLL_TYPE_POLLING_OUT,
    us_calloc, us_free, us_internal_async, us_internal_callback_t, us_internal_loop_data_t,
    us_malloc, us_socket_t,
};

// ═══════════════════════════════════════════════════════════════════════════
// Backend constants
// ═══════════════════════════════════════════════════════════════════════════

/// Kqueue's EVFILT_* is NOT a bitfield; we keep our own bitfield and
/// translate on every kevent64() call.
pub const LIBUS_SOCKET_READABLE: c_int = 1;
pub const LIBUS_SOCKET_WRITABLE: c_int = 2;

/// Pointer tags mark a Bun-owned pointer vs a uSockets pointer.
const UNSET_BITS_49_UNTIL_64: usize = 0x0000_FFFF_FFFF_FFFF;

#[inline(always)]
fn clear_pointer_tag<T>(p: *mut T) -> *mut T {
    (p as usize & UNSET_BITS_49_UNTIL_64) as *mut T
}

#[inline(always)]
fn unlikely(b: bool) -> bool {
    if b {
        cold();
    }
    b
}
#[cold]
fn cold() {}

#[inline(always)]
unsafe fn errno_location() -> *mut c_int {
    // SAFETY: libc's thread-local errno accessor is always valid.
    unsafe { libc::__error() }
}

#[inline(always)]
unsafe fn is_eintr(rc: c_int) -> bool {
    // SAFETY: reading the thread-local errno.
    rc == -1 && unsafe { *errno_location() } == libc::EINTR
}

// ═══════════════════════════════════════════════════════════════════════════
// kevent64 shim — Darwin has `kevent64(2)`; FreeBSD only has `kevent(2)`.
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod kq {
    pub(super) use libc::{KEVENT_FLAG_ERROR_EVENTS, KEVENT_FLAG_IMMEDIATE, kevent64, kevent64_s};
}

#[cfg(target_os = "freebsd")]
mod kq {
    use core::ffi::{c_int, c_uint};
    use core::ptr;
    use libc::timespec;

    /// FreeBSD has plain `kevent(2)` only — alias it so the body stays shared.
    pub(super) type kevent64_s = libc::kevent;

    /// Darwin-only kevent64 flags, translated by the shim below.
    pub(super) const KEVENT_FLAG_ERROR_EVENTS: c_uint = 0x1;
    pub(super) const KEVENT_FLAG_IMMEDIATE: c_uint = 0x2;

    /// Translate Darwin `kevent64` semantics onto FreeBSD `kevent`.
    #[inline]
    pub(super) unsafe fn kevent64(
        kq: c_int,
        changelist: *const kevent64_s,
        nchanges: c_int,
        mut eventlist: *mut kevent64_s,
        mut nevents: c_int,
        flags: c_uint,
        mut timeout: *const timespec,
    ) -> c_int {
        // ERROR_EVENTS: Darwin restricts eventlist to per-change errors; FreeBSD
        // would pop unrelated ready events here, so suppress harvesting entirely.
        if flags & KEVENT_FLAG_ERROR_EVENTS != 0 {
            eventlist = ptr::null_mut();
            nevents = 0;
        }
        static ZERO_TS: timespec = timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        if flags & KEVENT_FLAG_IMMEDIATE != 0 && timeout.is_null() {
            timeout = &raw const ZERO_TS;
        }
        // SAFETY: caller guarantees changelist/eventlist point at `nchanges`/`nevents` entries.
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }
}

use kq::{KEVENT_FLAG_ERROR_EVENTS, KEVENT_FLAG_IMMEDIATE, kevent64, kevent64_s};

/// `EV_SET64` — fill a `kevent64_s`. ext[] is zeroed (matches FreeBSD `EV_SET`).
#[inline(always)]
unsafe fn ev_set64(
    kev: *mut kevent64_s,
    ident: u64,
    filter: i16,
    flags: u16,
    fflags: u32,
    data: i64,
    udata: *mut c_void,
    ext0: u64,
    ext1: u64,
) {
    // SAFETY: caller guarantees `kev` is valid for write.
    unsafe {
        *kev = MaybeUninit::zeroed().assume_init();
        (*kev).ident = ident as _;
        (*kev).filter = filter as _;
        (*kev).flags = flags as _;
        (*kev).fflags = fflags as _;
        (*kev).data = data as _;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            (*kev).udata = udata as u64;
            (*kev).ext = [ext0, ext1];
        }
        #[cfg(target_os = "freebsd")]
        {
            (*kev).udata = udata;
            let _ = (ext0, ext1);
        }
    }
}

#[inline(always)]
unsafe fn get_ready_poll(loop_: *mut us_loop_t, index: c_int) -> *mut us_poll_t {
    // SAFETY: caller guarantees `index < num_ready_polls` within `ready_polls`.
    unsafe {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            (*loop_).ready_polls[index as usize].udata as *mut us_poll_t
        }
        #[cfg(target_os = "freebsd")]
        {
            (*loop_).ready_polls[index as usize]
                .udata
                .cast::<us_poll_t>()
        }
    }
}

#[inline(always)]
unsafe fn set_ready_poll(loop_: *mut us_loop_t, index: c_int, poll: *mut us_poll_t) {
    // SAFETY: caller guarantees `index < num_ready_polls` within `ready_polls`.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    unsafe {
        (*loop_).ready_polls[index as usize].udata = poll as u64;
    }
    #[cfg(target_os = "freebsd")]
    unsafe {
        (*loop_).ready_polls[index as usize].udata = poll.cast::<c_void>();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-crate externs not present in `types.rs`
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn us_internal_loop_data_init(
        loop_: *mut us_loop_t,
        wakeup_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
        pre_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
        post_cb: Option<unsafe extern "C" fn(*mut us_loop_t)>,
    );
    fn us_internal_loop_data_free(loop_: *mut us_loop_t);
    fn us_internal_loop_pre(loop_: *mut us_loop_t);
    fn us_internal_loop_post(loop_: *mut us_loop_t);
    fn us_internal_dispatch_ready_poll(p: *mut us_poll_t, error: c_int, eof: c_int, events: c_int);
    fn us_internal_sweep_timeout_ns(loop_: *mut us_loop_t) -> c_longlong;
    fn us_internal_sweep_if_due(loop_: *mut us_loop_t);

    fn Bun__internal_dispatch_ready_poll(loop_: *mut c_void, poll: *mut c_void);
    fn Bun__JSC_onBeforeWait(jsc_vm: *mut c_void);
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_poll_t` — 4-byte packed { fd:27, poll_type:5 }, 16-aligned.
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C, align(16))]
pub struct us_poll_t {
    pub state: u32,
}
const _: () = assert!(size_of::<us_poll_t>() == 16);

impl us_poll_t {
    #[inline(always)]
    pub fn fd(&self) -> c_int {
        (self.state as i32) >> 5
    }
    #[inline(always)]
    pub fn set_fd(&mut self, fd: c_int) {
        self.state = ((fd as u32) << 5) | (self.state & 0x1F);
    }
    #[inline(always)]
    pub fn poll_type(&self) -> c_int {
        (self.state & 0x1F) as c_int
    }
    #[inline(always)]
    pub fn set_poll_type(&mut self, t: c_int) {
        self.state = (self.state & !0x1F) | (t as u32 & 0x1F);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// `us_loop_t`
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C, align(16))]
pub struct us_loop_t {
    pub data: us_internal_loop_data_t,
    /// Number of non-fallthrough polls in the loop.
    pub num_polls: c_int,
    /// Number of ready polls this iteration.
    pub num_ready_polls: c_int,
    /// Current index in list of ready polls.
    pub current_ready_poll: c_int,
    /// Loop's own kqueue fd.
    pub fd: c_int,
    /// Number of polls owned by Bun.
    pub bun_polls: c_uint,
    /// Set atomically by wakeup(); swapped to 0 before kevent64 so we can skip
    /// the GC safepoint when non-zero.
    pub pending_wakeups: AtomicU32,
    pub ready_polls: [kevent64_s; LIBUS_MAX_READY_POLLS],
}

/// `us_timer_t` — opaque on the kqueue backend (timers are driven by the
/// sweep-deadline clamp in `us_loop_run_bun_tick`, not by an fd).
#[repr(C)]
pub struct us_timer_t {
    _p: [u8; 0],
}

// ═══════════════════════════════════════════════════════════════════════════
// Loop
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_free(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` was allocated by us_create_loop; fields are valid.
    unsafe {
        us_internal_loop_data_free(loop_);
        libc::close((*loop_).fd);
        us_free(loop_.cast::<c_void>());
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
    // SAFETY: calloc-zeroed block large enough for us_loop_t + ext.
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

        (*loop_).fd = libc::kqueue();

        us_internal_loop_data_init(loop_, wakeup_cb, pre_cb, post_cb);
        loop_
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Poll — create/free/ext/init/type/events/fd
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_poll(
    loop_: *mut us_loop_t,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_poll_t {
    // SAFETY: `loop_` is live for the duration of the poll.
    unsafe {
        if fallthrough == 0 {
            (*loop_).num_polls += 1;
        }
        let p = us_malloc(size_of::<us_poll_t>() + ext_size as usize).cast::<us_poll_t>();
        clear_pointer_tag(p)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_free(p: *mut us_poll_t, loop_: *mut us_loop_t) {
    // SAFETY: `p` was returned by us_create_poll; `loop_` is live.
    unsafe {
        (*loop_).num_polls -= 1;
        us_free(p.cast::<c_void>());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_ext(p: *mut us_poll_t) -> *mut c_void {
    // SAFETY: ext area is the bytes immediately after the struct.
    unsafe { p.add(1).cast::<c_void>() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_init(
    p: *mut us_poll_t,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    poll_type: c_int,
) {
    // SAFETY: `p` points at a live us_poll_t.
    unsafe {
        (*p).set_fd(fd);
        (*p).set_poll_type(poll_type);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_events(p: *mut us_poll_t) -> c_int {
    // SAFETY: `p` points at a live us_poll_t.
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
    // SAFETY: `p` points at a live us_poll_t.
    unsafe { (*p).fd() }
}

/// Returns any of listen socket, socket, shut down socket or callback.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_type(p: *mut us_poll_t) -> c_int {
    // SAFETY: `p` points at a live us_poll_t.
    unsafe { (*p).poll_type() & POLL_TYPE_KIND_MASK }
}

/// Bug: doesn't really SET, rather read and change, so needs to be inited first!
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_poll_set_type(p: *mut us_poll_t, poll_type: c_int) {
    // SAFETY: `p` points at a live us_poll_t.
    unsafe {
        let keep = (*p).poll_type() & POLL_TYPE_POLLING_MASK;
        (*p).set_poll_type(poll_type | keep);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Ready-poll dispatch loop
// ═══════════════════════════════════════════════════════════════════════════

/// Coalesced per-poll kqueue flags (1 byte).
#[repr(transparent)]
#[derive(Clone, Copy, Default)]
struct KeventFlags(u8);
impl KeventFlags {
    const READABLE: u8 = 1 << 0;
    const WRITABLE: u8 = 1 << 1;
    const ERROR: u8 = 1 << 2;
    const EOF: u8 = 1 << 3;
    const SKIP: u8 = 1 << 4;

    #[inline]
    const fn readable(self) -> bool {
        self.0 & Self::READABLE != 0
    }
    #[inline]
    const fn writable(self) -> bool {
        self.0 & Self::WRITABLE != 0
    }
    #[inline]
    const fn error(self) -> bool {
        self.0 & Self::ERROR != 0
    }
    #[inline]
    const fn eof(self) -> bool {
        self.0 & Self::EOF != 0
    }
    #[inline]
    const fn skip(self) -> bool {
        self.0 & Self::SKIP != 0
    }
}
const _: () = assert!(size_of::<KeventFlags>() == 1);

#[cfg(any(target_os = "macos", target_os = "ios"))]
const WAKEUP_FILTER: i16 = libc::EVFILT_MACHPORT;
#[cfg(target_os = "freebsd")]
const WAKEUP_FILTER: i16 = libc::EVFILT_USER;

/// Shared dispatch for `us_loop_run` and `us_loop_run_bun_tick`. Kqueue reports
/// each filter (READ, WRITE, ...) as its own kevent, so the same poll can
/// appear twice — coalesce before dispatch to match epoll's single-bitmask model.
unsafe fn us_internal_dispatch_ready_polls(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live and `num_ready_polls` entries of `ready_polls` were
    // filled by the preceding kevent64() call.
    unsafe {
        let mut coalesced = [KeventFlags(0); LIBUS_MAX_READY_POLLS];

        // First pass: decode kevents and coalesce same-poll entries.
        let num_ready = (*loop_).num_ready_polls;
        let mut i: c_int = 0;
        while i < num_ready {
            let poll = get_ready_poll(loop_, i);
            if poll.is_null() || clear_pointer_tag(poll) != poll {
                coalesced[i as usize] = KeventFlags(KeventFlags::SKIP);
                i += 1;
                continue;
            }

            let ev = &(*loop_).ready_polls[i as usize];
            let filter = ev.filter as i16;
            let flags = ev.flags as u16;
            let mut bits = 0u8;
            if filter == libc::EVFILT_READ || filter == WAKEUP_FILTER {
                bits |= KeventFlags::READABLE;
            }
            if filter == libc::EVFILT_WRITE {
                bits |= KeventFlags::WRITABLE;
            }
            if flags & libc::EV_ERROR != 0 {
                bits |= KeventFlags::ERROR;
            }
            if flags & libc::EV_EOF != 0 {
                bits |= KeventFlags::EOF;
            }

            // Look backward for a prior entry with the same poll (kqueue yields
            // at most READ + WRITE = 2 per fd).
            let mut merged = false;
            let mut j = i - 1;
            while j >= 0 {
                if !coalesced[j as usize].skip() && get_ready_poll(loop_, j) == poll {
                    coalesced[j as usize].0 |= bits;
                    coalesced[i as usize] = KeventFlags(KeventFlags::SKIP);
                    merged = true;
                    break;
                }
                j -= 1;
            }
            if !merged {
                coalesced[i as usize] = KeventFlags(bits);
            }
            i += 1;
        }

        // Second pass: dispatch in order — tagged pointers and coalesced events.
        (*loop_).current_ready_poll = 0;
        while (*loop_).current_ready_poll < (*loop_).num_ready_polls {
            let idx = (*loop_).current_ready_poll;
            let poll = get_ready_poll(loop_, idx);
            if !poll.is_null() {
                // Tagged pointers (FilePoll) go through Bun's own dispatch.
                if clear_pointer_tag(poll) != poll {
                    Bun__internal_dispatch_ready_poll(
                        loop_.cast::<c_void>(),
                        poll.cast::<c_void>(),
                    );
                } else {
                    let bits = coalesced[idx as usize];
                    if !bits.skip() {
                        let mut events = (if bits.readable() {
                            LIBUS_SOCKET_READABLE
                        } else {
                            0
                        }) | (if bits.writable() {
                            LIBUS_SOCKET_WRITABLE
                        } else {
                            0
                        });
                        events &= us_poll_events(poll);
                        if events != 0 || bits.error() || bits.eof() {
                            us_internal_dispatch_ready_poll(
                                poll,
                                bits.error() as c_int,
                                bits.eof() as c_int,
                                events,
                            );
                        }
                    }
                }
            }
            (*loop_).current_ready_poll += 1;
        }
    }
}

/// If the kernel filled the whole buffer, re-poll non-blocking and dispatch
/// again so one tick covers all pending I/O. Capped at 48 iterations (libuv).
unsafe fn us_internal_drain_ready_polls(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; kevent64 fills `ready_polls`.
    unsafe {
        let mut drain_count = 48;
        while unlikely((*loop_).num_ready_polls == LIBUS_MAX_READY_POLLS as c_int)
            && {
                drain_count -= 1;
                drain_count != 0
            }
            && (*loop_).num_polls > 0
        {
            loop {
                (*loop_).num_ready_polls = kevent64(
                    (*loop_).fd,
                    ptr::null(),
                    0,
                    (*loop_).ready_polls.as_mut_ptr(),
                    LIBUS_MAX_READY_POLLS as c_int,
                    KEVENT_FLAG_IMMEDIATE,
                    ptr::null(),
                );
                if !is_eintr((*loop_).num_ready_polls) {
                    break;
                }
            }
            if (*loop_).num_ready_polls <= 0 {
                (*loop_).num_ready_polls = 0;
                break;
            }
            us_internal_dispatch_ready_polls(loop_);
        }
    }
}

/// Bound `timeout` by the socket-timeout sweep deadline (NULL == forever).
unsafe fn us_internal_clamp_to_sweep(
    loop_: *mut us_loop_t,
    timeout: *const timespec,
    storage: *mut timespec,
) -> *const timespec {
    // SAFETY: `loop_` and `storage` are caller-owned; `timeout` may be null.
    unsafe {
        let ns = us_internal_sweep_timeout_ns(loop_);
        if ns < 0 {
            return timeout;
        }
        let sweep_sec = ns / 1_000_000_000;
        let sweep_nsec = ns % 1_000_000_000;
        if !timeout.is_null() {
            let t = &*timeout;
            if (t.tv_sec as c_longlong) < sweep_sec
                || ((t.tv_sec as c_longlong) == sweep_sec
                    && (t.tv_nsec as c_longlong) <= sweep_nsec)
            {
                return timeout;
            }
        }
        (*storage).tv_sec = sweep_sec as libc::time_t;
        (*storage).tv_nsec = sweep_nsec as _;
        storage
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` was returned by us_create_loop and is single-threaded here.
    unsafe {
        while (*loop_).num_polls != 0 {
            (*loop_).data.tick_depth += 1;
            us_internal_loop_pre(loop_);

            let mut sweep_ts: timespec = MaybeUninit::zeroed().assume_init();
            let timeout = us_internal_clamp_to_sweep(loop_, ptr::null(), &raw mut sweep_ts);

            loop {
                (*loop_).num_ready_polls = kevent64(
                    (*loop_).fd,
                    ptr::null(),
                    0,
                    (*loop_).ready_polls.as_mut_ptr(),
                    LIBUS_MAX_READY_POLLS as c_int,
                    0,
                    timeout,
                );
                if !is_eintr((*loop_).num_ready_polls) {
                    break;
                }
            }

            us_internal_dispatch_ready_polls(loop_);
            us_internal_drain_ready_polls(loop_);
            us_internal_sweep_if_due(loop_);

            us_internal_loop_post(loop_);
            (*loop_).data.tick_depth -= 1;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_loop_run_bun_tick(loop_: *mut us_loop_t, mut timeout: *const timespec) {
    // SAFETY: `loop_` is live; `timeout` may be null.
    unsafe {
        if (*loop_).num_polls == 0 {
            return;
        }

        (*loop_).data.tick_depth += 1;
        us_internal_loop_pre(loop_);

        // loop_pre stores the soonest QUIC adv tick. The JS event loop folds
        // this in elsewhere; other callers pass NULL, so fold it here too.
        let mut quic_ts: timespec = MaybeUninit::zeroed().assume_init();
        if !(*loop_).data.quic_head.is_null() && (*loop_).data.quic_next_tick_us >= 0 {
            let us = (*loop_).data.quic_next_tick_us;
            let earlier = timeout.is_null()
                || ((*timeout).tv_sec as c_longlong) * 1_000_000
                    + ((*timeout).tv_nsec as c_longlong) / 1_000
                    > us;
            if earlier {
                quic_ts.tv_sec = (us / 1_000_000) as libc::time_t;
                quic_ts.tv_nsec = ((us % 1_000_000) * 1_000) as _;
                timeout = &raw const quic_ts;
            }
        }

        let mut sweep_ts: timespec = MaybeUninit::zeroed().assume_init();
        timeout = us_internal_clamp_to_sweep(loop_, timeout, &raw mut sweep_ts);

        let had_wakeups = (*loop_).pending_wakeups.swap(0, Ordering::Acquire);
        let will_idle = had_wakeups == 0
            && (timeout.is_null() || ((*timeout).tv_nsec != 0 || (*timeout).tv_sec != 0));
        if will_idle && !(*loop_).data.jsc_vm.is_null() {
            Bun__JSC_onBeforeWait((*loop_).data.jsc_vm);
        }

        loop {
            // When not idling, KEVENT_FLAG_IMMEDIATE avoids a full
            // assert_wait_deadline/thread_block round-trip in XNU's kqueue_scan.
            (*loop_).num_ready_polls = kevent64(
                (*loop_).fd,
                ptr::null(),
                0,
                (*loop_).ready_polls.as_mut_ptr(),
                LIBUS_MAX_READY_POLLS as c_int,
                if will_idle { 0 } else { KEVENT_FLAG_IMMEDIATE },
                timeout,
            );
            if !is_eintr((*loop_).num_ready_polls) {
                break;
            }
        }

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
    // Ready polls may contain same poll twice under kqueue (READ + WRITE).
    // SAFETY: `loop_` is live and `num_ready_polls` is in bounds.
    unsafe {
        let mut remaining: c_int = 2;
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
// Poll — kqueue registration
// ═══════════════════════════════════════════════════════════════════════════

/// Set or update EVFILT_READ / EVFILT_WRITE for `fd`.
pub(crate) unsafe fn kqueue_change(
    kqfd: c_int,
    fd: c_int,
    old_events: c_int,
    new_events: c_int,
    user_data: *mut c_void,
) -> c_int {
    // SAFETY: `change_list` is local; kevent64 writes back errors into it.
    unsafe {
        let mut change_list: [kevent64_s; 2] = MaybeUninit::zeroed().assume_init();
        let mut change_len: c_int = 0;

        let is_readable = new_events & LIBUS_SOCKET_READABLE;
        let is_writable = new_events & LIBUS_SOCKET_WRITABLE;

        // Do they differ in readable?
        if (new_events & LIBUS_SOCKET_READABLE) != (old_events & LIBUS_SOCKET_READABLE) {
            ev_set64(
                change_list.as_mut_ptr().add(change_len as usize),
                fd as u64,
                libc::EVFILT_READ,
                if is_readable != 0 {
                    libc::EV_ADD
                } else {
                    libc::EV_DELETE
                },
                0,
                0,
                user_data,
                0,
                0,
            );
            change_len += 1;
        }

        if is_readable == 0 && is_writable == 0 {
            if old_events & LIBUS_SOCKET_WRITABLE == 0 {
                // Not reading or writing → add one-shot WRITE to receive FIN.
                ev_set64(
                    change_list.as_mut_ptr().add(change_len as usize),
                    fd as u64,
                    libc::EVFILT_WRITE,
                    libc::EV_ADD | libc::EV_ONESHOT,
                    0,
                    0,
                    user_data,
                    0,
                    0,
                );
                change_len += 1;
            }
        } else if (new_events & LIBUS_SOCKET_WRITABLE) != (old_events & LIBUS_SOCKET_WRITABLE) {
            // Do they differ in writable?
            ev_set64(
                change_list.as_mut_ptr().add(change_len as usize),
                fd as u64,
                libc::EVFILT_WRITE,
                if new_events & LIBUS_SOCKET_WRITABLE != 0 {
                    libc::EV_ADD | libc::EV_ONESHOT
                } else {
                    libc::EV_DELETE
                },
                0,
                0,
                user_data,
                0,
                0,
            );
            change_len += 1;
        }

        let mut ret;
        loop {
            ret = kevent64(
                kqfd,
                change_list.as_ptr(),
                change_len,
                change_list.as_mut_ptr(),
                change_len,
                KEVENT_FLAG_ERROR_EVENTS,
                ptr::null(),
            );
            if !is_eintr(ret) {
                break;
            }
        }

        // KEVENT_FLAG_ERROR_EVENTS returns per-filter failures as EV_ERROR with
        // errno in .data; mirror epoll's contract so callers can read errno.
        if ret > 0 {
            *errno_location() = change_list[0].data as c_int;
        }
        ret
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_resize(
    p: *mut us_poll_t,
    loop_: *mut us_loop_t,
    old_ext_size: c_uint,
    ext_size: c_uint,
) -> *mut us_poll_t {
    // SAFETY: `p` is a live poll; `loop_` owns it.
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
        ptr::copy_nonoverlapping(p.cast::<u8>(), new_p.cast::<u8>(), old_size);

        // The old poll is freed separately which decrements; keep total correct.
        (*loop_).num_polls += 1;

        let events = us_poll_events(p);
        // Forcefully update poll by resetting with new_p as user data.
        kqueue_change(
            (*loop_).fd,
            (*new_p).fd(),
            0,
            LIBUS_SOCKET_WRITABLE | LIBUS_SOCKET_READABLE,
            new_p.cast::<c_void>(),
        );
        us_internal_loop_update_pending_ready_polls(loop_, p, new_p, events, events);
        new_p
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start_rc(
    p: *mut us_poll_t,
    loop_: *mut us_loop_t,
    events: c_int,
) -> c_int {
    // SAFETY: `p` and `loop_` are live.
    unsafe {
        let kind = us_internal_poll_type(p);
        (*p).set_poll_type(
            kind | (if events & LIBUS_SOCKET_READABLE != 0 {
                POLL_TYPE_POLLING_IN
            } else {
                0
            }) | (if events & LIBUS_SOCKET_WRITABLE != 0 {
                POLL_TYPE_POLLING_OUT
            } else {
                0
            }),
        );
        kqueue_change((*loop_).fd, (*p).fd(), 0, events, p.cast::<c_void>())
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_start(p: *mut us_poll_t, loop_: *mut us_loop_t, events: c_int) {
    // SAFETY: forwards to us_poll_start_rc.
    unsafe {
        us_poll_start_rc(p, loop_, events);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_change(p: *mut us_poll_t, loop_: *mut us_loop_t, events: c_int) {
    // SAFETY: `p` and `loop_` are live.
    unsafe {
        let old_events = us_poll_events(p);
        if old_events != events {
            let kind = us_internal_poll_type(p);
            (*p).set_poll_type(
                kind | (if events & LIBUS_SOCKET_READABLE != 0 {
                    POLL_TYPE_POLLING_IN
                } else {
                    0
                }) | (if events & LIBUS_SOCKET_WRITABLE != 0 {
                    POLL_TYPE_POLLING_OUT
                } else {
                    0
                }),
            );
            kqueue_change(
                (*loop_).fd,
                (*p).fd(),
                old_events,
                events,
                p.cast::<c_void>(),
            );
            us_internal_loop_update_pending_ready_polls(loop_, p, p, old_events, events);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_poll_stop(p: *mut us_poll_t, loop_: *mut us_loop_t) {
    // SAFETY: `p` and `loop_` are live.
    unsafe {
        let old_events = us_poll_events(p);
        let new_events = 0;
        if old_events != 0 {
            kqueue_change(
                (*loop_).fd,
                (*p).fd(),
                old_events,
                new_events,
                ptr::null_mut(),
            );
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
pub unsafe extern "C" fn us_internal_accept_poll_event(_p: *mut us_poll_t) -> usize {
    // Kqueue has no underlying FD for user events.
    0
}

// ═══════════════════════════════════════════════════════════════════════════
// Async — macOS/iOS: EVFILT_MACHPORT; FreeBSD: EVFILT_USER + NOTE_TRIGGER.
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod mach {
    use core::ffi::{c_int, c_uint};

    pub(super) type mach_port_t = c_uint;
    pub(super) type kern_return_t = c_int;

    pub(super) const MACHPORT_BUF_LEN: usize = 1024;

    pub(super) const KERN_SUCCESS: kern_return_t = 0;
    pub(super) const MACH_PORT_NULL: mach_port_t = 0;
    pub(super) const MACH_PORT_RIGHT_RECEIVE: c_uint = 1;
    pub(super) const MACH_MSG_TYPE_MAKE_SEND: c_uint = 20;
    pub(super) const MACH_MSG_TYPE_COPY_SEND: c_uint = 19;
    pub(super) const MACH_PORT_LIMITS_INFO: c_int = 1;
    pub(super) const MACH_PORT_LIMITS_INFO_COUNT: c_uint = 1;
    pub(super) const MACH_RCV_MSG: c_uint = 0x0000_0002;
    pub(super) const MACH_RCV_OVERWRITE: c_uint = 0x0000_0000;
    pub(super) const MACH_SEND_MSG: c_int = 0x0000_0001;
    pub(super) const MACH_SEND_TIMEOUT: c_int = 0x0000_0010;

    /// `MACH_MSGH_BITS(remote, local)` — legacy encoder.
    #[inline(always)]
    pub(super) const fn mach_msgh_bits(remote: c_uint, local: c_uint) -> c_uint {
        remote | (local << 8)
    }

    #[repr(C)]
    pub(super) struct mach_port_limits_t {
        pub mpl_qlimit: c_uint,
    }

    #[repr(C)]
    pub(super) struct mach_msg_header_t {
        pub msgh_bits: c_uint,
        pub msgh_size: c_uint,
        pub msgh_remote_port: mach_port_t,
        pub msgh_local_port: mach_port_t,
        pub msgh_voucher_port: c_uint,
        pub msgh_id: c_int,
    }

    unsafe extern "C" {
        pub(super) static mach_task_self_: mach_port_t;
        pub(super) fn mach_port_allocate(
            task: mach_port_t,
            right: c_uint,
            name: *mut mach_port_t,
        ) -> kern_return_t;
        pub(super) fn mach_port_insert_right(
            task: mach_port_t,
            name: mach_port_t,
            poly: mach_port_t,
            poly_poly: c_uint,
        ) -> kern_return_t;
        pub(super) fn mach_port_set_attributes(
            task: mach_port_t,
            name: mach_port_t,
            flavor: c_int,
            info: *mut c_int,
            count: c_uint,
        ) -> kern_return_t;
        pub(super) fn mach_port_deallocate(task: mach_port_t, name: mach_port_t) -> kern_return_t;
        pub(super) fn mach_msg(
            msg: *mut mach_msg_header_t,
            option: c_int,
            send_size: c_uint,
            rcv_size: c_uint,
            rcv_name: mach_port_t,
            timeout: c_uint,
            notify: mach_port_t,
        ) -> kern_return_t;
    }

    #[inline(always)]
    pub(super) unsafe fn mach_task_self() -> mach_port_t {
        // SAFETY: reading the libSystem-exported task-self port global.
        unsafe { mach_task_self_ }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_create_async(
    loop_: *mut us_loop_t,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_internal_async {
    use mach::*;
    // SAFETY: `loop_` is live; we allocate/zero a callback block + ext area.
    unsafe {
        let cb = us_calloc(1, size_of::<us_internal_callback_t>() + ext_size as usize)
            .cast::<us_internal_callback_t>();
        if cb.is_null() {
            Bun__outOfMemory();
        }
        (*cb).loop_ = loop_;
        (*cb).cb_expects_the_loop = 1;
        (*cb).leave_poll_ready = 0;

        // us_internal_poll_set_type CHANGES the type, it does not set it.
        (*cb).p.set_poll_type(POLL_TYPE_POLLING_IN);
        us_internal_poll_set_type(&raw mut (*cb).p, POLL_TYPE_CALLBACK);

        if fallthrough == 0 {
            (*loop_).num_polls += 1;
        }

        (*cb).machport_buf = us_malloc(MACHPORT_BUF_LEN);
        if (*cb).machport_buf.is_null() {
            Bun__outOfMemory();
        }
        let self_ = mach_task_self();
        let kr = mach_port_allocate(self_, MACH_PORT_RIGHT_RECEIVE, &raw mut (*cb).port);
        if unlikely(kr != KERN_SUCCESS) {
            return ptr::null_mut();
        }

        // Insert a send right into the port since we also use this to send.
        let kr = mach_port_insert_right(self_, (*cb).port, (*cb).port, MACH_MSG_TYPE_MAKE_SEND);
        if unlikely(kr != KERN_SUCCESS) {
            return ptr::null_mut();
        }

        // Queue size 1 — we use it only for notifications.
        let mut limits = mach_port_limits_t { mpl_qlimit: 1 };
        let kr = mach_port_set_attributes(
            self_,
            (*cb).port,
            MACH_PORT_LIMITS_INFO,
            (&raw mut limits).cast::<c_int>(),
            MACH_PORT_LIMITS_INFO_COUNT,
        );
        if unlikely(kr != KERN_SUCCESS) {
            return ptr::null_mut();
        }

        cb
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_close(a: *mut us_internal_async) {
    use mach::*;
    // SAFETY: `a` was returned by us_internal_create_async.
    unsafe {
        let cb = a.cast::<us_internal_callback_t>();
        let mut event: kevent64_s = MaybeUninit::zeroed().assume_init();
        let ptr_ident = cb as u64;
        ev_set64(
            &raw mut event,
            ptr_ident,
            libc::EVFILT_MACHPORT,
            libc::EV_DELETE,
            0,
            0,
            cb.cast::<c_void>(),
            0,
            0,
        );
        loop {
            let ret = kevent64(
                (*(*cb).loop_).fd,
                &raw const event,
                1,
                &raw mut event,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                ptr::null(),
            );
            if !is_eintr(ret) {
                break;
            }
        }

        mach_port_deallocate(mach_task_self(), (*cb).port);
        us_free((*cb).machport_buf);

        // Regular sockets are the only polls not freed immediately.
        us_poll_free(a.cast::<us_poll_t>(), (*cb).loop_);
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_set(
    a: *mut us_internal_async,
    cb: Option<unsafe extern "C" fn(*mut us_internal_async)>,
) {
    use mach::*;
    // SAFETY: `a` is a live us_internal_callback_t.
    unsafe {
        let internal_cb = a.cast::<us_internal_callback_t>();
        (*internal_cb).cb = cb;

        // EVFILT_MACHPORT benchmarks faster than EVFILT_USER across threads.
        let mut event: kevent64_s = MaybeUninit::zeroed().assume_init();
        event.ident = (*internal_cb).port as u64;
        event.filter = libc::EVFILT_MACHPORT;
        event.flags = libc::EV_ADD | libc::EV_ENABLE;
        event.fflags = MACH_RCV_MSG | MACH_RCV_OVERWRITE;
        event.ext[0] = (*internal_cb).machport_buf as u64;
        event.ext[1] = MACHPORT_BUF_LEN as u64;
        event.udata = internal_cb as u64;

        let mut ret;
        loop {
            ret = kevent64(
                (*(*internal_cb).loop_).fd,
                &raw const event,
                1,
                &raw mut event,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                ptr::null(),
            );
            if !is_eintr(ret) {
                break;
            }
        }
        if unlikely(ret == -1) {
            libc::abort();
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_wakeup(a: *mut us_internal_async) {
    use mach::*;
    // SAFETY: `a` is a live us_internal_callback_t with a valid send right.
    unsafe {
        let internal_cb = a.cast::<us_internal_callback_t>();
        let mut msg = mach_msg_header_t {
            msgh_bits: mach_msgh_bits(MACH_MSG_TYPE_COPY_SEND, 0),
            msgh_size: size_of::<mach_msg_header_t>() as c_uint,
            msgh_remote_port: (*internal_cb).port,
            msgh_local_port: MACH_PORT_NULL,
            msgh_voucher_port: 0,
            msgh_id: 0,
        };
        // MACH_SEND_TIMED_OUT / MACH_SEND_NO_BUFFER both mean the queue is
        // already full → the loop will wake anyway. Ignore the return code.
        let _ = mach_msg(
            &raw mut msg,
            MACH_SEND_MSG | MACH_SEND_TIMEOUT,
            msg.msgh_size,
            0,
            MACH_PORT_NULL,
            0, // fail instantly if the port is full
            MACH_PORT_NULL,
        );
    }
}

#[cfg(target_os = "freebsd")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_create_async(
    loop_: *mut us_loop_t,
    fallthrough: c_int,
    ext_size: c_uint,
) -> *mut us_internal_async {
    // SAFETY: calloc-zeroed; `loop_` is live.
    unsafe {
        let cb = us_calloc(1, size_of::<us_internal_callback_t>() + ext_size as usize)
            .cast::<us_internal_callback_t>();
        if cb.is_null() {
            Bun__outOfMemory();
        }
        (*cb).loop_ = loop_;
        (*cb).cb_expects_the_loop = 1;
        (*cb).leave_poll_ready = 0;

        (*cb).p.set_poll_type(POLL_TYPE_POLLING_IN);
        us_internal_poll_set_type(&raw mut (*cb).p, POLL_TYPE_CALLBACK);

        if fallthrough == 0 {
            (*loop_).num_polls += 1;
        }
        cb
    }
}

#[cfg(target_os = "freebsd")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_close(a: *mut us_internal_async) {
    // SAFETY: `a` was returned by us_internal_create_async.
    unsafe {
        let cb = a.cast::<us_internal_callback_t>();
        let mut event: kevent64_s = MaybeUninit::zeroed().assume_init();
        ev_set64(
            &raw mut event,
            cb as usize as u64,
            libc::EVFILT_USER,
            libc::EV_DELETE,
            0,
            0,
            cb.cast::<c_void>(),
            0,
            0,
        );
        loop {
            let ret = kevent64(
                (*(*cb).loop_).fd,
                &raw const event,
                1,
                &raw mut event,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                ptr::null(),
            );
            if !is_eintr(ret) {
                break;
            }
        }
        us_poll_free(a.cast::<us_poll_t>(), (*cb).loop_);
    }
}

#[cfg(target_os = "freebsd")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_set(
    a: *mut us_internal_async,
    cb: Option<unsafe extern "C" fn(*mut us_internal_async)>,
) {
    // SAFETY: `a` is a live us_internal_callback_t.
    unsafe {
        let internal_cb = a.cast::<us_internal_callback_t>();
        (*internal_cb).cb = cb;

        let mut event: kevent64_s = MaybeUninit::zeroed().assume_init();
        ev_set64(
            &raw mut event,
            internal_cb as usize as u64,
            libc::EVFILT_USER,
            libc::EV_ADD | libc::EV_ENABLE | libc::EV_CLEAR,
            0,
            0,
            internal_cb.cast::<c_void>(),
            0,
            0,
        );
        let mut ret;
        loop {
            ret = kevent64(
                (*(*internal_cb).loop_).fd,
                &raw const event,
                1,
                &raw mut event,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                ptr::null(),
            );
            if !is_eintr(ret) {
                break;
            }
        }
        if unlikely(ret == -1) {
            libc::abort();
        }
    }
}

#[cfg(target_os = "freebsd")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_async_wakeup(a: *mut us_internal_async) {
    // SAFETY: `a` is a live us_internal_callback_t registered with EVFILT_USER.
    unsafe {
        let internal_cb = a.cast::<us_internal_callback_t>();
        let mut event: kevent64_s = MaybeUninit::zeroed().assume_init();
        ev_set64(
            &raw mut event,
            internal_cb as usize as u64,
            libc::EVFILT_USER,
            0,
            libc::NOTE_TRIGGER,
            0,
            internal_cb.cast::<c_void>(),
            0,
            0,
        );
        // Submit NOTE_TRIGGER only — no eventlist, or this thread could
        // consume the wakeup it just posted.
        loop {
            let ret = kevent64(
                (*(*internal_cb).loop_).fd,
                &raw const event,
                1,
                ptr::null_mut(),
                0,
                KEVENT_FLAG_ERROR_EVENTS,
                ptr::null(),
            );
            if !is_eintr(ret) {
                break;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket error accessor
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_get_error(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` starts with a us_poll_t; fd is valid for getsockopt.
    unsafe {
        let mut error: c_int = 0;
        let mut len = size_of::<c_int>() as libc::socklen_t;
        if libc::getsockopt(
            us_poll_fd(s.cast::<us_poll_t>()),
            libc::SOL_SOCKET,
            libc::SO_ERROR,
            (&raw mut error).cast::<c_void>(),
            &raw mut len,
        ) == -1
        {
            return *errno_location();
        }
        error
    }
}
