//! Poll-layer raw edges for backend/{epoll,kqueue}.rs: copy-in/copy-out
//! accessors over `*mut Loop` / `*mut PollState` (no borrow ever spans a
//! callback — C17), the slab generation probe (OQ-4), and the kernel
//! poll/change syscalls (epoll_pwait2 latch, kevent64 + FreeBSD shim).

use core::ptr::NonNull;

use crate::backend::{CallbackFn, CallbackPoll, PollState};
use crate::socket::SocketHeader;
use crate::unsafe_core::slab::ChunkedSlab;

#[cfg(not(windows))]
use crate::backend::{EventType, MAX_READY_POLLS};
#[cfg(not(windows))]
use crate::loop_::Loop;

// ── PollState / CallbackPoll raw access ──────────────────────────────────────

/// Copy out the 4-byte poll state. Registered udata pointers stay readable
/// for the loop's lifetime (slab pages never unmap; callback/udp polls are
/// freed only after poll_stop nulls their pending ready entries).
#[inline]
pub(crate) fn read_poll(p: *const PollState) -> PollState {
    // SAFETY: see above — `p` is a registered poll pointer.
    unsafe { p.read() }
}

#[inline]
pub(crate) fn write_poll(p: *mut PollState, v: PollState) {
    // SAFETY: same contract as `read_poll`; 4-byte plain store.
    unsafe { p.write(v) }
}

/// Copy out a CALLBACK-kind poll body (dispatch reads it once, then calls
/// through the copy so the callback may free the poll — C17).
#[inline]
pub(crate) fn read_callback_poll(p: *mut CallbackPoll) -> CallbackPoll {
    // SAFETY: caller verified kind_bits == Callback; layout is repr(C) with
    // PollState first, so the udata pointer is the CallbackPoll pointer.
    unsafe { p.read() }
}

#[inline]
pub(crate) fn invoke_callback(cb: CallbackFn, arg: *mut core::ffi::c_void) {
    // SAFETY: fn pointer installed by loop/wakeup init (C-ABI contract).
    unsafe { cb(arg) }
}

/// Current generation of the socket-slab slot holding `p` (odd = occupied).
/// OQ-4: dispatch drops events whose udata resolves to a vacant slot.
pub(crate) fn slab_generation(p: *mut PollState) -> u32 {
    let header = NonNull::new(p.cast::<SocketHeader>()).expect("null slab poll");
    // SAFETY: slab-kind udata always points at a socket slab slot (value-
    // first repr(C) Slot); slab memory is never returned to the OS while the
    // loop lives, so reading a vacant slot's generation is defined.
    unsafe { ChunkedSlab::<SocketHeader>::generation(header) }
}

// ── Loop field access (copy-in/copy-out; POSIX layout only) ─────────────────
// SAFETY (all accessors): `loop_` is the live loop; each access forms only a
// transient place projection, never a reference that spans a callback.

#[cfg(not(windows))]
pub(crate) fn loop_fd(loop_: *mut Loop) -> i32 {
    unsafe { (*loop_).fd }
}

#[cfg(not(windows))]
pub(crate) fn num_polls(loop_: *mut Loop) -> i32 {
    unsafe { (*loop_).num_polls }
}

#[cfg(not(windows))]
pub(crate) fn num_ready_polls(loop_: *mut Loop) -> i32 {
    unsafe { (*loop_).num_ready_polls }
}

#[cfg(not(windows))]
pub(crate) fn set_num_ready_polls(loop_: *mut Loop, v: i32) {
    unsafe { (*loop_).num_ready_polls = v }
}

#[cfg(not(windows))]
pub(crate) fn current_ready_poll(loop_: *mut Loop) -> i32 {
    unsafe { (*loop_).current_ready_poll }
}

#[cfg(not(windows))]
pub(crate) fn set_current_ready_poll(loop_: *mut Loop, v: i32) {
    unsafe { (*loop_).current_ready_poll = v }
}

#[cfg(not(windows))]
pub(crate) fn ready_poll_at(loop_: *mut Loop, i: i32) -> EventType {
    unsafe { (*loop_).ready_polls[i as usize] }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) fn ready_poll_udata(loop_: *mut Loop, i: i32) -> u64 {
    unsafe { (*loop_).ready_polls[i as usize].u64 }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) fn set_ready_poll_udata(loop_: *mut Loop, i: i32, udata: u64) {
    unsafe { (*loop_).ready_polls[i as usize].u64 = udata }
}

#[cfg(target_os = "macos")]
pub(crate) fn ready_poll_udata(loop_: *mut Loop, i: i32) -> u64 {
    unsafe { (*loop_).ready_polls[i as usize].udata }
}

#[cfg(target_os = "macos")]
pub(crate) fn set_ready_poll_udata(loop_: *mut Loop, i: i32, udata: u64) {
    unsafe { (*loop_).ready_polls[i as usize].udata = udata }
}

#[cfg(target_os = "freebsd")]
pub(crate) fn ready_poll_udata(loop_: *mut Loop, i: i32) -> u64 {
    unsafe { (*loop_).ready_polls[i as usize].udata as u64 }
}

#[cfg(target_os = "freebsd")]
pub(crate) fn set_ready_poll_udata(loop_: *mut Loop, i: i32, udata: u64) {
    unsafe { (*loop_).ready_polls[i as usize].udata = udata as *mut core::ffi::c_void }
}

// ── errno ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
pub(crate) fn last_errno() -> i32 {
    // SAFETY: thread-local errno location.
    unsafe { *libc::__errno_location() }
}

#[cfg(target_os = "android")]
pub(crate) fn last_errno() -> i32 {
    // SAFETY: thread-local errno location (bionic spelling).
    unsafe { *libc::__errno() }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub(crate) fn last_errno() -> i32 {
    // SAFETY: thread-local errno location.
    unsafe { *libc::__error() }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
fn set_errno(v: i32) {
    // SAFETY: thread-local errno location.
    unsafe { *libc::__error() = v }
}

#[cfg(not(windows))]
fn timespec_from_ns(ns: i64) -> libc::timespec {
    libc::timespec {
        tv_sec: (ns / 1_000_000_000) as _,
        tv_nsec: (ns % 1_000_000_000) as _,
    }
}

// ── epoll syscall edges (R1.9, R2.7-R2.10) ───────────────────────────────────

#[cfg(any(target_os = "linux", target_os = "android"))]
mod epoll_sys {
    use super::*;
    use core::sync::atomic::{AtomicI32, Ordering};

    /// −1 = unprobed, 0 = unavailable, else use the raw syscall (R1.9).
    static HAS_EPOLL_PWAIT2: AtomicI32 = AtomicI32::new(-1);

    unsafe extern "C" {
        /// Raw SYS_epoll_pwait2 (441) provided by `src/platform/linux.rs`;
        /// returns -errno directly.
        fn sys_epoll_pwait2(
            epfd: i32,
            events: *mut libc::epoll_event,
            maxevents: i32,
            timeout: *const libc::timespec,
            sigmask: *const libc::sigset_t,
        ) -> isize;

        fn Bun__isEpollPwait2SupportedOnLinuxKernel() -> i32;
    }

    // libc 0.2.186 does not declare epoll_pwait for android; bionic has it
    // since API 21.
    #[cfg(target_os = "android")]
    unsafe extern "C" {
        fn epoll_pwait(
            epfd: i32,
            events: *mut libc::epoll_event,
            maxevents: i32,
            timeout: i32,
            sigmask: *const libc::sigset_t,
        ) -> i32;
    }
    #[cfg(target_os = "linux")]
    use libc::epoll_pwait;

    pub(crate) fn epoll_create_cloexec() -> i32 {
        // SAFETY: plain syscall, no pointers.
        unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) }
    }

    /// Kernel-version probe, run once at loop creation (R1.3).
    pub(crate) fn probe_epoll_pwait2() {
        if HAS_EPOLL_PWAIT2.load(Ordering::Relaxed) == -1 {
            // SAFETY: pure extern probe exported by the platform crate.
            if unsafe { Bun__isEpollPwait2SupportedOnLinuxKernel() } == 0 {
                HAS_EPOLL_PWAIT2.store(0, Ordering::Relaxed);
            }
        }
    }

    /// EINTR-retried epoll_ctl. DEL ignores the event argument (legal since
    /// Linux 2.6.9 — R2.10); a zeroed one is passed for it.
    pub(crate) fn epoll_ctl(epfd: i32, op: i32, fd: i32, events: u32, data: u64) -> i32 {
        let mut ev = libc::epoll_event { events, u64: data };
        loop {
            // SAFETY: `ev` outlives the call; fd/epfd owned by the caller.
            let rc = unsafe { libc::epoll_ctl(epfd, op, fd, &mut ev) };
            if rc == -1 && last_errno() == libc::EINTR {
                continue;
            }
            return rc;
        }
    }

    /// `bun_epoll_pwait2` (R1.9): raw epoll_pwait2 retried on -EINTR; on
    /// ENOSYS/EPERM/EOPNOTSUPP/EACCES/EFAULT latch off and fall back forever
    /// to epoll_pwait with a truncating ms conversion (999999 ns → 0 ms).
    fn bun_epoll_pwait2(
        epfd: i32,
        events: *mut libc::epoll_event,
        maxevents: i32,
        timeout: *const libc::timespec,
    ) -> i32 {
        // SAFETY: sigset init into a local.
        let mut mask: libc::sigset_t = unsafe { core::mem::zeroed() };
        unsafe { libc::sigemptyset(&mut mask) };

        if HAS_EPOLL_PWAIT2.load(Ordering::Relaxed) != 0 {
            loop {
                // SAFETY: events buffer valid for maxevents entries (caller);
                // timeout/mask are live locals or null.
                let ret = unsafe { sys_epoll_pwait2(epfd, events, maxevents, timeout, &mask) };
                if ret == -(libc::EINTR as isize) {
                    continue;
                }
                let neg = (-ret) as i32;
                if !(ret < 0
                    && matches!(
                        neg,
                        libc::ENOSYS | libc::EPERM | libc::EOPNOTSUPP | libc::EACCES | libc::EFAULT
                    ))
                {
                    return ret as i32;
                }
                HAS_EPOLL_PWAIT2.store(0, Ordering::Relaxed);
                break;
            }
        }

        let timeout_ms = if timeout.is_null() {
            -1
        } else {
            // SAFETY: non-null timeout points at the caller's live timespec.
            unsafe { ((*timeout).tv_sec * 1000 + (*timeout).tv_nsec / 1_000_000) as i32 }
        };
        loop {
            // SAFETY: same buffers as above.
            let ret = unsafe { epoll_pwait(epfd, events, maxevents, timeout_ms, &mask) };
            if ret == -1 && last_errno() == libc::EINTR {
                continue;
            }
            return ret;
        }
    }

    /// Fill `loop.ready_polls` and store the raw return (possibly negative)
    /// into `num_ready_polls`, matching the C call sites. `timeout_ns < 0`
    /// blocks forever.
    pub(crate) fn epoll_wait_ready(loop_: *mut Loop, timeout_ns: i64) -> i32 {
        let ts;
        let ts_ptr: *const libc::timespec = if timeout_ns < 0 {
            core::ptr::null()
        } else {
            ts = timespec_from_ns(timeout_ns);
            &ts
        };
        // SAFETY: raw pointer into the live loop's ready_polls; no Rust
        // reference is held across the kernel call.
        let (epfd, buf) = unsafe {
            (
                (*loop_).fd,
                (&raw mut (*loop_).ready_polls).cast::<libc::epoll_event>(),
            )
        };
        let n = bun_epoll_pwait2(epfd, buf, MAX_READY_POLLS as i32, ts_ptr);
        set_num_ready_polls(loop_, n);
        n
    }

    /// Drain the wakeup eventfd (8-byte counter read, EINTR-retried).
    pub(crate) fn read_eventfd8(fd: i32) -> u64 {
        let mut buf: u64 = 0;
        loop {
            // SAFETY: 8-byte read into a local.
            let r = unsafe { libc::read(fd, (&raw mut buf).cast(), 8) };
            if r == -1 && last_errno() == libc::EINTR {
                continue;
            }
            return buf;
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) use epoll_sys::{
    epoll_create_cloexec, epoll_ctl, epoll_wait_ready, probe_epoll_pwait2, read_eventfd8,
};

// ── kqueue syscall edges (R2.9, R2.13; FreeBSD kevent64 shim) ────────────────

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
mod kqueue_sys {
    use super::*;
    use crate::LIBUS_SOCKET_DESCRIPTOR;

    // Darwin sys/event.h values; FreeBSD takes the shimmed behavior instead.
    #[cfg(target_os = "macos")]
    const KEVENT_FLAG_IMMEDIATE: libc::c_uint = 0x001;
    #[cfg(target_os = "macos")]
    const KEVENT_FLAG_ERROR_EVENTS: libc::c_uint = 0x002;

    pub(crate) fn kqueue_create() -> i32 {
        // SAFETY: plain syscall, no pointers.
        unsafe { libc::kqueue() }
    }

    pub(crate) fn zeroed_kev() -> EventType {
        // SAFETY: all-zero bytes are a valid kevent (null udata included).
        unsafe { core::mem::zeroed() }
    }

    pub(crate) fn make_kev(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        filter: i16,
        flags: u16,
        udata: u64,
    ) -> EventType {
        let mut e = zeroed_kev();
        #[cfg(target_os = "macos")]
        {
            e.ident = fd as u64;
            e.filter = filter;
            e.flags = flags;
            e.udata = udata;
        }
        #[cfg(target_os = "freebsd")]
        {
            e.ident = fd as usize;
            e.filter = filter;
            e.flags = flags;
            e.udata = udata as *mut core::ffi::c_void;
        }
        e
    }

    /// Submit a changelist with KEVENT_FLAG_ERROR_EVENTS semantics: per-
    /// filter failures come back as EV_ERROR entries with the errno in
    /// `.data`; mirror it into errno so callers keep epoll's contract (R2.9).
    #[cfg(target_os = "macos")]
    pub(crate) fn kevent_error_events(kqfd: i32, changes: &mut [EventType]) -> i32 {
        let len = changes.len() as i32;
        let ptr = changes.as_mut_ptr();
        loop {
            // SAFETY: `changes` is a live slice used as both change- and
            // event-list, exactly like the C call.
            let ret = unsafe {
                libc::kevent64(
                    kqfd,
                    ptr,
                    len,
                    ptr,
                    len,
                    KEVENT_FLAG_ERROR_EVENTS,
                    core::ptr::null(),
                )
            };
            if ret == -1 && last_errno() == libc::EINTR {
                continue;
            }
            if ret > 0 {
                set_errno(changes[0].data as i32);
            }
            return ret;
        }
    }

    /// FreeBSD shim (epoll_kqueue.h:44-75): no ERROR_EVENTS equivalent —
    /// suppress eventlist harvesting entirely (registration paths only need
    /// syscall success), so no per-filter errno mirror exists here.
    #[cfg(target_os = "freebsd")]
    pub(crate) fn kevent_error_events(kqfd: i32, changes: &mut [EventType]) -> i32 {
        let len = changes.len() as i32;
        let ptr = changes.as_ptr();
        loop {
            // SAFETY: live slice as changelist; eventlist suppressed.
            let ret = unsafe {
                libc::kevent(kqfd, ptr, len, core::ptr::null_mut(), 0, core::ptr::null())
            };
            if ret == -1 && last_errno() == libc::EINTR {
                continue;
            }
            return ret;
        }
    }

    /// Fill `loop.ready_polls`, EINTR-retried; stores the raw return into
    /// `num_ready_polls`. `immediate` = KEVENT_FLAG_IMMEDIATE (Darwin) /
    /// zero-timespec (FreeBSD) — avoids the ~14 µs XNU thread_block for an
    /// already-expired deadline (R1.10 step 8).
    pub(crate) fn kevent_wait_ready(loop_: *mut Loop, timeout_ns: i64, immediate: bool) -> i32 {
        let ts;
        #[allow(unused_mut)]
        let mut ts_ptr: *const libc::timespec = if timeout_ns < 0 {
            core::ptr::null()
        } else {
            ts = timespec_from_ns(timeout_ns);
            &ts
        };

        #[cfg(target_os = "freebsd")]
        static ZERO_TS: libc::timespec = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        #[cfg(target_os = "freebsd")]
        if immediate && ts_ptr.is_null() {
            ts_ptr = &ZERO_TS;
        }

        // SAFETY: raw pointer into the live loop's ready_polls; no Rust
        // reference is held across the kernel call.
        let (kqfd, buf) = unsafe {
            (
                (*loop_).fd,
                (&raw mut (*loop_).ready_polls).cast::<EventType>(),
            )
        };
        loop {
            #[cfg(target_os = "macos")]
            // SAFETY: buffer valid for MAX_READY_POLLS entries.
            let n = unsafe {
                libc::kevent64(
                    kqfd,
                    core::ptr::null(),
                    0,
                    buf,
                    MAX_READY_POLLS as i32,
                    if immediate { KEVENT_FLAG_IMMEDIATE } else { 0 },
                    ts_ptr,
                )
            };
            #[cfg(target_os = "freebsd")]
            // SAFETY: buffer valid for MAX_READY_POLLS entries.
            let n = unsafe {
                libc::kevent(
                    kqfd,
                    core::ptr::null(),
                    0,
                    buf,
                    MAX_READY_POLLS as i32,
                    ts_ptr,
                )
            };
            if n == -1 && last_errno() == libc::EINTR {
                continue;
            }
            set_num_ready_polls(loop_, n);
            return n;
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub(crate) use kqueue_sys::{
    kevent_error_events, kevent_wait_ready, kqueue_create, make_kev, zeroed_kev,
};

// ── W4 additions: pending_wakeups + wakeup-async platform primitives ─────────
// (loop_/wakeup.rs is `deny(unsafe_code)`; everything below is its raw edge.)

/// RELEASE increment of `loop.pending_wakeups` — pairs with the ACQUIRE swap
/// at the top of every bun tick (R10.1/R10.2). Callable from ANY thread.
#[cfg(not(windows))]
pub(crate) fn pending_wakeups_add_release(loop_: *mut Loop) {
    // SAFETY: field projection into the live loop; AtomicU32 has u32 layout
    // and the loop allocation outlives every wakeup caller (C lifetime rule).
    let a =
        unsafe { &*(&raw const (*loop_).pending_wakeups).cast::<core::sync::atomic::AtomicU32>() };
    a.fetch_add(1, core::sync::atomic::Ordering::Release);
}

/// Loop-thread `num_polls` adjustment through a raw place projection —
/// never forms `&mut Loop`, so the access span excludes `pending_wakeups`,
/// which other threads `fetch_add` concurrently (R10.6, C17).
#[cfg(not(windows))]
pub(crate) fn num_polls_add(loop_: *mut Loop, delta: i32) {
    // SAFETY: `loop_` is live; `num_polls` is loop-thread-only; single raw
    // place read-modify-write, no reference formed.
    unsafe { *(&raw mut (*loop_).num_polls) += delta }
}

/// ACQUIRE swap-to-0 before blocking (R1.10 step 5).
#[cfg(not(windows))]
pub(crate) fn pending_wakeups_swap_acquire(loop_: *mut Loop) -> u32 {
    // SAFETY: see `pending_wakeups_add_release`.
    let a =
        unsafe { &*(&raw const (*loop_).pending_wakeups).cast::<core::sync::atomic::AtomicU32>() };
    a.swap(0, core::sync::atomic::Ordering::Acquire)
}

/// Erase a loop-taking callback to the `CallbackFn` shape — identical C ABI
/// (one pointer argument, no return); dispatch passes the loop pointer back
/// because `cb_expects_the_loop` is set.
pub(crate) fn erase_loop_cb(cb: unsafe extern "C" fn(*mut crate::loop_::Loop)) -> CallbackFn {
    // SAFETY: ABI-identical fn pointer types (pointer arg, unit return).
    unsafe { core::mem::transmute::<unsafe extern "C" fn(*mut crate::loop_::Loop), CallbackFn>(cb) }
}

/// Box-allocate the wakeup async's CALLBACK poll. Owner:
/// `loop.data.wakeup_async` until [`free_callback_poll`] at loop teardown.
pub(crate) fn alloc_callback_poll(cp: CallbackPoll) -> *mut CallbackPoll {
    bun_core::heap::into_raw(Box::new(cp))
}

/// Release a poll from [`alloc_callback_poll`] (exactly once, at async close).
pub(crate) fn free_callback_poll(p: *mut CallbackPoll) {
    // SAFETY: `p` came from `alloc_callback_poll`; the async is closed once
    // and nothing references it afterwards.
    unsafe { bun_core::heap::destroy(p) }
}

// eventfd (R10.4 Linux/Android).
#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) mod eventfd {
    use super::last_errno;

    pub(crate) fn create() -> i32 {
        // SAFETY: plain syscall.
        unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) }
    }

    /// write(8-byte 1); on EAGAIN (counter overflow) drain via read and
    /// retry (epoll_kqueue.c:658-668). Callable from ANY thread.
    pub(crate) fn send(fd: i32) {
        let val: u64 = 1;
        loop {
            // SAFETY: 8-byte write from a stack u64 (eventfd contract).
            if unsafe { libc::write(fd, (&raw const val).cast(), 8) } >= 0 {
                return;
            }
            match last_errno() {
                libc::EINTR => continue,
                libc::EAGAIN => {
                    let mut drained: u64 = 0;
                    // SAFETY: 8-byte read into a stack u64.
                    let n = unsafe { libc::read(fd, (&raw mut drained).cast(), 8) };
                    if n > 0 || matches!(last_errno(), libc::EAGAIN | libc::EINTR) {
                        continue;
                    }
                    return;
                }
                _ => return,
            }
        }
    }
}

// EVFILT_USER (R10.4 FreeBSD).
#[cfg(target_os = "freebsd")]
pub(crate) mod evuser {
    use super::*;

    pub(crate) fn add(kqfd: i32, ident: u64, udata: u64) -> i32 {
        let mut e = zeroed_kev();
        e.ident = ident as usize;
        e.filter = libc::EVFILT_USER;
        e.flags = libc::EV_ADD | libc::EV_ENABLE | libc::EV_CLEAR;
        e.udata = udata as usize as *mut core::ffi::c_void;
        let mut ch = [e];
        kevent_error_events(kqfd, &mut ch)
    }

    /// NOTE_TRIGGER with NO eventlist — an eventlist could consume the
    /// wakeup on the posting thread (epoll_kqueue.c:856-858). Any thread.
    pub(crate) fn trigger(kqfd: i32, ident: u64, udata: u64) {
        let mut e = zeroed_kev();
        e.ident = ident as usize;
        e.filter = libc::EVFILT_USER;
        e.fflags = libc::NOTE_TRIGGER;
        e.udata = udata as usize as *mut core::ffi::c_void;
        loop {
            // SAFETY: one-change submit, eventlist suppressed, cannot block.
            let ret =
                unsafe { libc::kevent(kqfd, &e, 1, core::ptr::null_mut(), 0, core::ptr::null()) };
            if ret == -1 && last_errno() == libc::EINTR {
                continue;
            }
            return;
        }
    }

    pub(crate) fn delete(kqfd: i32, ident: u64, udata: u64) {
        let mut e = zeroed_kev();
        e.ident = ident as usize;
        e.filter = libc::EVFILT_USER;
        e.flags = libc::EV_DELETE;
        e.udata = udata as usize as *mut core::ffi::c_void;
        let mut ch = [e];
        let _ = kevent_error_events(kqfd, &mut ch);
    }
}

// EVFILT_MACHPORT (R10.4 macOS). Constants from xnu osfmk/mach/{message,port}.h;
// EVFILT_MACHPORT benchmarks faster than EVFILT_USER cross-thread
// (epoll_kqueue.c:735-742).
#[cfg(target_os = "macos")]
pub(crate) mod mach {
    use super::*;

    pub(crate) const MACHPORT_BUF_LEN: usize = 1024;

    const MACH_PORT_RIGHT_RECEIVE: u32 = 1;
    const MACH_MSG_TYPE_MAKE_SEND: u32 = 20;
    const MACH_MSG_TYPE_COPY_SEND: u32 = 19;
    const MACH_PORT_LIMITS_INFO: i32 = 1;
    const MACH_PORT_LIMITS_INFO_COUNT: u32 = 1;
    const MACH_SEND_MSG: i32 = 0x1;
    const MACH_SEND_TIMEOUT: i32 = 0x10;
    const MACH_RCV_MSG: u32 = 0x2;
    const MACH_RCV_OVERWRITE: u32 = 0x1000;
    const KERN_SUCCESS: i32 = 0;

    #[repr(C)]
    struct MachMsgHeader {
        bits: u32,
        size: u32,
        remote_port: u32,
        local_port: u32,
        voucher_port: u32,
        id: i32,
    }

    unsafe extern "C" {
        static mach_task_self_: u32;
        fn mach_port_allocate(task: u32, right: u32, name: *mut u32) -> i32;
        fn mach_port_insert_right(task: u32, name: u32, poly: u32, poly_type: u32) -> i32;
        fn mach_port_set_attributes(
            task: u32,
            name: u32,
            flavor: i32,
            info: *mut u32,
            count: u32,
        ) -> i32;
        fn mach_port_deallocate(task: u32, name: u32) -> i32;
        fn mach_msg(
            msg: *mut MachMsgHeader,
            option: i32,
            send_size: u32,
            rcv_size: u32,
            rcv_name: u32,
            timeout: u32,
            notify: u32,
        ) -> i32;
    }

    /// Receive+send port with queue limit 1 (sends coalesce — port full ==
    /// wakeup already pending). Returns 0 on failure (the C returned NULL
    /// and crashed at async_set; the Rust caller panics instead).
    pub(crate) fn port_create_qlimit1() -> u32 {
        let mut port: u32 = 0;
        // SAFETY: mach kernel calls on the current task; `port`/`qlimit` are
        // stack out-params (epoll_kqueue.c:675-710 port).
        unsafe {
            let task = mach_task_self_;
            if mach_port_allocate(task, MACH_PORT_RIGHT_RECEIVE, &mut port) != KERN_SUCCESS {
                return 0;
            }
            if mach_port_insert_right(task, port, port, MACH_MSG_TYPE_MAKE_SEND) != KERN_SUCCESS {
                return 0;
            }
            let mut qlimit: u32 = 1;
            if mach_port_set_attributes(
                task,
                port,
                MACH_PORT_LIMITS_INFO,
                &mut qlimit,
                MACH_PORT_LIMITS_INFO_COUNT,
            ) != KERN_SUCCESS
            {
                return 0;
            }
        }
        port
    }

    pub(crate) fn port_dealloc(port: u32) {
        // SAFETY: balances `port_create_qlimit1`.
        unsafe {
            mach_port_deallocate(mach_task_self_, port);
        }
    }

    pub(crate) fn alloc_buf() -> *mut core::ffi::c_void {
        bun_core::heap::into_raw(Box::new([0u8; MACHPORT_BUF_LEN])).cast()
    }

    pub(crate) fn free_buf(buf: *mut core::ffi::c_void) {
        // SAFETY: `buf` came from `alloc_buf`; freed exactly once at close.
        unsafe { bun_core::heap::destroy(buf.cast::<[u8; MACHPORT_BUF_LEN]>()) }
    }

    /// Non-blocking header-only send; TIMED_OUT/NO_BUFFER == queue full ==
    /// a wakeup is already pending (epoll_kqueue.c:766-803). Any thread.
    pub(crate) fn send(port: u32) {
        let mut msg = MachMsgHeader {
            bits: MACH_MSG_TYPE_COPY_SEND, // MACH_MSGH_BITS(COPY_SEND, 0)
            size: core::mem::size_of::<MachMsgHeader>() as u32,
            remote_port: port,
            local_port: 0,
            voucher_port: 0,
            id: 0,
        };
        // SAFETY: header-only message from the stack; every rc case breaks
        // in the C, so the result is deliberately ignored.
        unsafe {
            let _ = mach_msg(
                &mut msg,
                MACH_SEND_MSG | MACH_SEND_TIMEOUT,
                msg.size,
                0,
                0,
                0,
                0,
            );
        }
    }

    /// EV_ADD|EV_ENABLE EVFILT_MACHPORT with MACH_RCV_MSG|OVERWRITE into the
    /// async's buffer — the kernel performs the receive itself, so dispatch
    /// never syscalls. Returns the kevent64 rc.
    pub(crate) fn kev_add(kqfd: i32, port: u32, buf: *mut core::ffi::c_void, udata: u64) -> i32 {
        let mut e = zeroed_kev();
        e.ident = port as u64;
        e.filter = libc::EVFILT_MACHPORT;
        e.flags = libc::EV_ADD | libc::EV_ENABLE;
        e.fflags = MACH_RCV_MSG | MACH_RCV_OVERWRITE;
        e.ext = [buf as usize as u64, MACHPORT_BUF_LEN as u64];
        e.udata = udata;
        let mut ch = [e];
        kevent_error_events(kqfd, &mut ch)
    }

    /// Deliberate deviation: the C passes the poll POINTER as ident
    /// (epoll_kqueue.c:717-724), so its EV_DELETE silently fails and the
    /// knote is only reaped when the kqueue fd closes; we delete for real.
    pub(crate) fn kev_delete(kqfd: i32, port: u32, udata: u64) {
        let mut e = zeroed_kev();
        e.ident = port as u64;
        e.filter = libc::EVFILT_MACHPORT;
        e.flags = libc::EV_DELETE;
        e.udata = udata;
        let mut ch = [e];
        let _ = kevent_error_events(kqfd, &mut ch);
    }
}
