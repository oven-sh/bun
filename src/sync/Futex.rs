//! A mechanism used to block (`wait`) and unblock (`wake`) threads using a
//! 32bit memory address as hints.
//!
//! Blocking a thread is acknowledged only if the 32bit memory address is equal
//! to a given value. This check helps avoid block/unblock deadlocks which
//! occur if a `wake()` happens before a `wait()`.
//!
//! Using Futex, other Thread synchronization primitives can be built which
//! efficiently wait for cross-thread events or signals.

#![warn(unused_must_use)]
// The per-OS syscall shims below mirror their C names (`timespec`, `ULOp`, …).
#![allow(non_camel_case_types)]

use core::sync::atomic::{AtomicU32, Ordering};

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum TimeoutError {
    #[error("Timeout")]
    Timeout,
}

/// Checks if `ptr` still contains the value `expect` and, if so, blocks the caller until either:
/// - The value at `ptr` is no longer equal to `expect`.
/// - The caller is unblocked by a matching `wake()`.
/// - The caller is unblocked spuriously ("at random").
/// - The caller blocks for longer than the given timeout. In which case, `error.Timeout` is returned.
///
/// The checking of `ptr` and `expect`, along with blocking the caller, is done atomically
/// and totally ordered (sequentially consistent) with respect to other wait()/wake() calls on the same `ptr`.
#[cold]
pub fn wait(ptr: &AtomicU32, expect: u32, timeout_ns: Option<u64>) -> Result<(), TimeoutError> {
    // Avoid calling into the OS for no-op timeouts.
    if let Some(t) = timeout_ns {
        if t == 0 {
            if ptr.load(Ordering::SeqCst) != expect {
                return Ok(());
            }
            return Err(TimeoutError::Timeout);
        }
    }

    imp::wait(ptr, expect, timeout_ns)
}

#[cold]
pub fn wait_forever(ptr: &AtomicU32, expect: u32) {
    loop {
        match imp::wait(ptr, expect, None) {
            // Shouldn't happen, but people can override system calls sometimes.
            Err(TimeoutError::Timeout) => continue,
            Ok(()) => break,
        }
    }
}

/// Unblocks at most `max_waiters` callers blocked in a `wait()` call on `ptr`.
#[cold]
pub fn wake(ptr: &AtomicU32, max_waiters: u32) {
    // Avoid calling into the OS if there's nothing to wake up.
    if max_waiters == 0 {
        return;
    }

    imp::wake(ptr, max_waiters);
}

#[cfg(target_vendor = "apple")]
use darwin_impl as imp;
#[cfg(target_os = "freebsd")]
use freebsd_impl as imp;
// Android is the same Linux kernel; Rust splits it into a distinct target_os
// value, so we must list both.
#[cfg(any(target_os = "linux", target_os = "android"))]
use linux_impl as imp;
#[cfg(not(any(
    windows,
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_arch = "wasm32",
)))]
use unsupported_impl as imp;
#[cfg(target_arch = "wasm32")]
use wasm_impl as imp;
#[cfg(windows)]
use windows_impl as imp;

/// We can't do @compileError() in the `Impl` switch statement above as its eagerly evaluated.
/// So instead, we @compileError() on the methods themselves for platforms which don't support futex.
#[cfg(not(any(
    windows,
    target_vendor = "apple",
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_arch = "wasm32",
)))]
mod unsupported_impl {
    use super::*;

    pub(super) fn wait(
        _ptr: &AtomicU32,
        _expect: u32,
        _timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        unsupported()
    }

    pub(super) fn wake(_ptr: &AtomicU32, _max_waiters: u32) {
        unsupported()
    }

    fn unsupported() -> ! {
        // The cfg ladder above already gates this module, so reaching this at
        // runtime means the ladder is incomplete.
        unreachable!("Unsupported operating system for Futex");
    }
}

// We use WaitOnAddress through NtDll instead of API-MS-Win-Core-Synch-l1-2-0.dll
// as it's generally already a linked target and is autoloaded into all processes anyway.
#[cfg(windows)]
mod windows_impl {
    use super::*;
    use bun_windows_sys as windows;
    use core::ffi::c_void;

    pub(super) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        // NTDLL functions work with time in units of 100 nanoseconds.
        // Positive values are absolute deadlines while negative values are relative durations.
        let timeout_value: windows::LARGE_INTEGER;
        let timeout_ptr: *const windows::LARGE_INTEGER = match timeout {
            Some(delay) => {
                timeout_value = -windows::LARGE_INTEGER::try_from(delay / 100).unwrap();
                &timeout_value
            }
            None => core::ptr::null(),
        };

        // SAFETY: ptr is a valid &AtomicU32 for the duration of the call; expect is a
        // stack local; timeout_ptr is either null or points at the stack local above.
        let rc = unsafe {
            windows::ntdll::RtlWaitOnAddress(
                ptr.as_ptr().cast::<c_void>(),
                (&expect as *const u32).cast::<c_void>(),
                core::mem::size_of::<u32>(),
                timeout_ptr,
            )
        };

        match rc {
            windows::NTSTATUS::SUCCESS => Ok(()),
            windows::NTSTATUS::TIMEOUT => {
                debug_assert!(timeout.is_some());
                Err(TimeoutError::Timeout)
            }
            _ => panic!("Unexpected RtlWaitOnAddress() return code"),
        }
    }

    pub(super) fn wake(ptr: &AtomicU32, max_waiters: u32) {
        let address: *const c_void = ptr.as_ptr().cast();
        debug_assert!(max_waiters != 0);

        // SAFETY: address points at a live AtomicU32.
        unsafe {
            match max_waiters {
                1 => windows::ntdll::RtlWakeAddressSingle(address),
                _ => windows::ntdll::RtlWakeAddressAll(address),
            }
        }
    }
}

#[cfg(target_vendor = "apple")]
mod darwin_impl {
    use super::*;
    use core::ffi::c_void;

    const NS_PER_US: u64 = 1_000;

    // ── Darwin private __ulock_* flags ──
    // <xnu/bsd/sys/ulock.h>. Kept as a plain struct + `.bits()` so `wait`/`wake`
    // can use field-init syntax while the FFI boundary gets the packed u32.
    // (This crate sits below `bun_sys`, so it carries its own externs.)
    #[repr(u8)]
    #[derive(Clone, Copy, Default)]
    enum ULOp {
        #[default]
        NONE = 0,
        COMPARE_AND_WAIT = 1,
    }
    #[derive(Clone, Copy, Default)]
    struct UL {
        op: ULOp,
        /// `ULF_WAKE_ALL` (bit 8).
        wake_all: bool,
        /// `ULF_WAKE_THREAD` (bit 9).
        wake_thread: bool,
        /// `ULF_NO_ERRNO` (bit 24) — return `-errno` directly instead of
        /// setting thread-local errno.
        no_errno: bool,
    }
    impl UL {
        #[inline]
        const fn bits(self) -> u32 {
            (self.op as u32)
                | ((self.wake_all as u32) << 8)
                | ((self.wake_thread as u32) << 9)
                | ((self.no_errno as u32) << 24)
        }
    }
    unsafe extern "C" {
        // Private libSystem symbols (stable since 10.12; `__ulock_wait2` since 11.0).
        #[link_name = "__ulock_wait"]
        fn __ulock_wait_raw(
            operation: u32,
            addr: *const c_void,
            value: u64,
            timeout_us: u32,
        ) -> core::ffi::c_int;
        #[link_name = "__ulock_wait2"]
        fn __ulock_wait2_raw(
            operation: u32,
            addr: *const c_void,
            value: u64,
            timeout_ns: u64,
            value2: u64,
        ) -> core::ffi::c_int;
        #[link_name = "__ulock_wake"]
        fn __ulock_wake_raw(
            operation: u32,
            addr: *const c_void,
            wake_value: u64,
        ) -> core::ffi::c_int;
    }
    /// # Safety
    /// `addr` must point to readable memory of at least 4 bytes (the futex word).
    #[inline]
    unsafe fn __ulock_wait(flags: UL, addr: *const c_void, value: u64, timeout_us: u32) -> i32 {
        // SAFETY: caller contract (`# Safety` above) — `addr` is a live futex word.
        unsafe { __ulock_wait_raw(flags.bits(), addr, value, timeout_us) }
    }
    /// # Safety
    /// See `__ulock_wait`.
    #[inline]
    unsafe fn __ulock_wait2(
        flags: UL,
        addr: *const c_void,
        value: u64,
        timeout_ns: u64,
        value2: u64,
    ) -> i32 {
        // SAFETY: caller contract (`# Safety` above) — `addr` is a live futex word.
        unsafe { __ulock_wait2_raw(flags.bits(), addr, value, timeout_ns, value2) }
    }
    /// # Safety
    /// See `__ulock_wait`.
    #[inline]
    unsafe fn __ulock_wake(flags: UL, addr: *const c_void, wake_value: u64) -> i32 {
        // SAFETY: caller contract (`# Safety` above) — `addr` is a live futex word.
        unsafe { __ulock_wake_raw(flags.bits(), addr, wake_value) }
    }

    pub(super) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        // Darwin XNU 7195.50.7.100.1 introduced __ulock_wait2 and migrated code paths (notably pthread_cond_t) towards it:
        // https://github.com/apple/darwin-xnu/commit/d4061fb0260b3ed486147341b72468f836ed6c8f#diff-08f993cc40af475663274687b7c326cc6c3031e0db3ac8de7b24624610616be6
        //
        // This XNU version appears to correspond to 11.0.1:
        // https://kernelshaman.blogspot.com/2021/01/building-xnu-for-macos-big-sur-1101.html
        //
        // ulock_wait() uses 32-bit micro-second timeouts where 0 = INFINITE or no-timeout
        // ulock_wait2() uses 64-bit nano-second timeouts (with the same convention)
        // Bun's deployment target is macOS 13+, so ulock_wait2 is always available.
        let supports_ulock_wait2: bool = true;

        let mut timeout_ns: u64 = 0;
        if let Some(delay) = timeout {
            debug_assert!(delay != 0); // handled by timedWait()
            timeout_ns = delay;
        }

        // If we're using `__ulock_wait` and `timeout` is too big to fit inside a `u32` count of
        // micro-seconds (around 70min), we'll request a shorter timeout. This is fine (users
        // should handle spurious wakeups), but we need to remember that we did so, so that
        // we don't return `Timeout` incorrectly. If that happens, we set this variable to
        // true so that we we know to ignore the ETIMEDOUT result.
        let mut timeout_overflowed = false;

        let addr: *const c_void = ptr.as_ptr().cast();
        let flags = UL {
            op: ULOp::COMPARE_AND_WAIT,
            no_errno: true,
            ..Default::default()
        };
        // SAFETY: addr points at a live AtomicU32; flags/expect/timeout are plain values.
        let status = unsafe {
            'blk: {
                if supports_ulock_wait2 {
                    break 'blk __ulock_wait2(flags, addr, expect as u64, timeout_ns, 0);
                }

                let timeout_us = match u32::try_from(timeout_ns / NS_PER_US) {
                    Ok(v) => v,
                    Err(_) => {
                        timeout_overflowed = true;
                        u32::MAX
                    }
                };

                __ulock_wait(flags, addr, expect as u64, timeout_us)
            }
        };

        if status >= 0 {
            return Ok(());
        }
        // ULF_NO_ERRNO: the kernel returns `-errno` directly.
        match -status {
            // Wait was interrupted by the OS or other spurious signalling.
            libc::EINTR => Ok(()),
            // Address of the futex was paged out. This is unlikely, but possible in theory, and
            // pthread/libdispatch on darwin bother to handle it. In this case we'll return
            // without waiting, but the caller should retry anyway.
            libc::EFAULT => Ok(()),
            // Only report Timeout if we didn't have to cap the timeout
            libc::ETIMEDOUT => {
                debug_assert!(timeout.is_some());
                if !timeout_overflowed {
                    return Err(TimeoutError::Timeout);
                }
                Ok(())
            }
            _ => panic!("Unexpected __ulock_wait() return code"),
        }
    }

    pub(super) fn wake(ptr: &AtomicU32, max_waiters: u32) {
        let flags = UL {
            op: ULOp::COMPARE_AND_WAIT,
            no_errno: true,
            wake_all: max_waiters > 1,
            ..Default::default()
        };

        loop {
            let addr: *const c_void = ptr.as_ptr().cast();
            // SAFETY: addr points at a live AtomicU32.
            let status = unsafe { __ulock_wake(flags, addr, 0) };

            if status >= 0 {
                return;
            }
            match -status {
                libc::EINTR => continue, // spurious wake()
                libc::EFAULT => panic!("__ulock_wake() returned EFAULT unexpectedly"), // __ulock_wake doesn't generate EFAULT according to darwin pthread_cond_t
                libc::ENOENT => return, // nothing was woken up
                libc::EALREADY => panic!("__ulock_wake() returned EALREADY unexpectedly"), // only for ULF_WAKE_THREAD
                _ => panic!("Unexpected __ulock_wake() return code"),
            }
        }
    }
}

// https://man7.org/linux/man-pages/man2/futex.2.html
#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux_impl {
    use super::*;
    use core::ffi::c_int;

    const NS_PER_S: u64 = 1_000_000_000;

    // ── futex syscall surface ──
    // This crate sits below `bun_sys` (which owns the canonical `bun_sys::linux`
    // wrappers), so it carries its own minimal copies.

    // `libc::time_t` is `#[deprecated]` on musl: musl 1.2.0 widened `time_t`
    // to 64-bit on 32-bit arches and the `libc` crate plans to follow (see
    // rust-lang/libc#1848). Bun only ships 64-bit Linux, where the kernel
    // `SYS_futex` timespec is `{ __kernel_long_t; __kernel_long_t; }` and
    // `time_t == c_long == i64` on every libc, so spell it `i64` on musl to
    // sidestep the deprecation without changing layout. The `const _` below
    // guards the layout-identical-to-`libc::timespec` invariant.
    #[cfg(target_env = "musl")]
    type time_t = i64;
    #[cfg(not(target_env = "musl"))]
    type time_t = libc::time_t;

    /// kernel-shaped timespec (`sec`/`nsec`, no `tv_` prefix).
    /// Layout-identical to `libc::timespec` so a `*const timespec` can be
    /// passed straight to `syscall(SYS_futex, ..)`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct timespec {
        sec: time_t,
        nsec: libc::c_long,
    }
    const _: () = assert!(
        core::mem::size_of::<timespec>() == core::mem::size_of::<libc::timespec>()
            && core::mem::align_of::<timespec>() == core::mem::align_of::<libc::timespec>()
    );

    /// futex op (cmd + private flag), packed.
    #[derive(Clone, Copy)]
    struct FutexOp {
        cmd: FutexCmd,
        private: bool,
    }
    impl FutexOp {
        #[inline]
        fn raw(self) -> c_int {
            self.cmd as c_int
                | if self.private {
                    libc::FUTEX_PRIVATE_FLAG
                } else {
                    0
                }
        }
    }
    #[derive(Clone, Copy)]
    #[repr(i32)]
    enum FutexCmd {
        WAIT = libc::FUTEX_WAIT,
        WAKE = libc::FUTEX_WAKE,
    }

    /// Kernel errno newtype with unprefixed variants and `init(rc)` decoding
    /// the `-errno`-in-return-value convention used by the wrappers below.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    struct E(u16);
    impl E {
        const SUCCESS: E = E(0);
        const INTR: E = E(libc::EINTR as u16);
        const AGAIN: E = E(libc::EAGAIN as u16);
        const FAULT: E = E(libc::EFAULT as u16);
        const INVAL: E = E(libc::EINVAL as u16);
        const TIMEDOUT: E = E(libc::ETIMEDOUT as u16);
        /// Decode a raw Linux syscall return (`-errno` on failure, ≥0 on success).
        #[inline]
        fn init(rc: isize) -> E {
            let u = rc as usize;
            if u > (-4096isize) as usize {
                E((u.wrapping_neg()) as u16)
            } else {
                E::SUCCESS
            }
        }
    }

    /// Read the thread-local libc errno.
    #[inline]
    fn errno() -> c_int {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    }

    /// `syscall(SYS_futex, uaddr, op, val)` — 3-arg form (WAKE).
    /// Returns the raw kernel rc (decode with `E::init`).
    // The kernel futex ABI returns `-errno` on
    // failure. `libc::syscall()` is the *glibc* wrapper —
    // it returns `-1` and sets thread-local errno instead. Translate back to
    // the kernel convention so callers can decode with `E::init(rc)`; without
    // this, every EAGAIN/EINTR from FUTEX_WAIT mis-decodes as EPERM.
    #[inline]
    unsafe fn futex_3arg(uaddr: *const u32, op: FutexOp, val: u32) -> isize {
        // SAFETY: caller contract — `uaddr` points to a live, suitably-aligned
        // `u32` for the syscall's duration.
        let rc = unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val) };
        if rc == -1 {
            -(errno() as isize)
        } else {
            rc as isize
        }
    }
    /// `syscall(SYS_futex, uaddr, op, val, timeout)` — 4-arg form (WAIT).
    #[inline]
    unsafe fn futex_4arg(
        uaddr: *const u32,
        op: FutexOp,
        val: u32,
        timeout: *const timespec,
    ) -> isize {
        // SAFETY: caller contract — `uaddr` points to a live `u32`; `timeout`
        // is null or points to a valid `timespec` for the syscall's duration.
        let rc = unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val, timeout) };
        if rc == -1 {
            -(errno() as isize)
        } else {
            rc as isize
        }
    }

    pub(super) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        // When `timeout` is None we pass null and `ts` is never read.
        let mut ts = timespec { sec: 0, nsec: 0 };
        if let Some(timeout_ns) = timeout {
            ts.sec = <_>::try_from(timeout_ns / NS_PER_S).unwrap();
            ts.nsec = <_>::try_from(timeout_ns % NS_PER_S).unwrap();
        }

        // SAFETY: ptr.as_ptr() is a valid *const u32 for the duration of the call; the
        // timespec pointer is either null or points at the stack local above.
        let rc = unsafe {
            futex_4arg(
                ptr.as_ptr().cast(),
                FutexOp {
                    cmd: FutexCmd::WAIT,
                    private: true,
                },
                expect,
                if timeout.is_some() {
                    &raw const ts
                } else {
                    core::ptr::null()
                },
            )
        };

        match E::init(rc) {
            E::SUCCESS => Ok(()), // notified by `wake()`
            E::INTR => Ok(()),    // spurious wakeup
            E::AGAIN => Ok(()),   // ptr.* != expect
            E::TIMEDOUT => {
                debug_assert!(timeout.is_some());
                Err(TimeoutError::Timeout)
            }
            E::INVAL => Ok(()), // possibly timeout overflow
            E::FAULT => panic!("futex_wait() returned EFAULT unexpectedly"), // ptr was invalid
            err => {
                panic!("Unexpected futex_wait() return code: {} - {}", rc, err.0);
            }
        }
    }

    pub(super) fn wake(ptr: &AtomicU32, max_waiters: u32) {
        let val: u32 = match i32::try_from(max_waiters) {
            Ok(v) => v as u32,
            Err(_) => i32::MAX as u32,
        };
        // SAFETY: ptr.as_ptr() is a valid *const u32 for the duration of the call.
        let rc = unsafe {
            futex_3arg(
                ptr.as_ptr().cast(),
                FutexOp {
                    cmd: FutexCmd::WAKE,
                    private: true,
                },
                val,
            )
        };

        match E::init(rc) {
            E::SUCCESS => {} // successful wake up
            E::INVAL => {}   // invalid futex_wait() on ptr done elsewhere
            E::FAULT => panic!("futex_wake() returned EFAULT unexpectedly"), // pointer became invalid while doing the wake
            _ => panic!("Unexpected futex_wake() return code"),
        }
    }
}

// https://www.freebsd.org/cgi/man.cgi?query=_umtx_op&sektion=2&n=1
#[cfg(target_os = "freebsd")]
mod freebsd_impl {
    use super::*;
    use core::ffi::{c_int, c_ulong, c_void};

    const NS_PER_S: u64 = 1_000_000_000;

    /// Read the thread-local libc errno when `rc` reports failure.
    #[inline]
    fn errno_of(rc: c_int) -> c_int {
        if rc == 0 {
            0
        } else {
            std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
        }
    }

    pub(super) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        let mut tm_size: usize = 0;
        // All-zero is a valid `_umtx_time` (POD; `Zeroable` impl in `bun_opaque`).
        let mut tm: libc::_umtx_time = bun_opaque::ffi::zeroed();
        let mut tm_ptr: *mut c_void = core::ptr::null_mut();

        if let Some(timeout_ns) = timeout {
            tm._flags = 0; // use relative time not UMTX_ABSTIME
            tm._clockid = libc::CLOCK_MONOTONIC as u32;
            tm._timeout.tv_sec = <_>::try_from(timeout_ns / NS_PER_S).unwrap();
            tm._timeout.tv_nsec = <_>::try_from(timeout_ns % NS_PER_S).unwrap();
            tm_size = core::mem::size_of::<libc::_umtx_time>();
            tm_ptr = (&mut tm as *mut libc::_umtx_time).cast();
        }

        // SAFETY: ptr.as_ptr() is valid; tm_ptr is null or points at the stack
        // local above. _umtx_op WAIT_UINT_PRIVATE reads `*obj` as a u32.
        let rc = unsafe {
            libc::_umtx_op(
                ptr.as_ptr().cast::<c_void>(),
                libc::UMTX_OP_WAIT_UINT_PRIVATE,
                expect as c_ulong,
                // Per _umtx_op(2): when uaddr2 is non-null, uaddr1 is the size
                // of the timeout struct (not a pointer).
                tm_size as *mut c_void,
                tm_ptr,
            )
        };

        match errno_of(rc) {
            0 => Ok(()),
            libc::EFAULT => panic!("_umtx_op() WAIT returned EFAULT unexpectedly"),
            libc::EINVAL => Ok(()), // possibly timeout overflow
            libc::ETIMEDOUT => {
                debug_assert!(timeout.is_some());
                Err(TimeoutError::Timeout)
            }
            libc::EINTR => Ok(()), // spurious wake
            _ => panic!("Unexpected _umtx_op() WAIT return code"),
        }
    }

    pub(super) fn wake(ptr: &AtomicU32, max_waiters: u32) {
        // The kernel reads n_wake as `int`; passing maxInt(u32) truncates to
        // -1 and umtxq_signal_queue's `++ret >= n_wake` returns after one
        // wakeup. _umtx_op(2): "Specify INT_MAX to wake up all waiters."
        let n: c_ulong = max_waiters.min(c_int::MAX as u32) as c_ulong;
        // SAFETY: ptr.as_ptr() is valid for the duration of the call.
        let rc = unsafe {
            libc::_umtx_op(
                ptr.as_ptr().cast::<c_void>(),
                libc::UMTX_OP_WAKE_PRIVATE,
                n,
                core::ptr::null_mut(), // there is no timeout struct
                core::ptr::null_mut(), // there is no timeout struct pointer
            )
        };

        match errno_of(rc) {
            0 => {}
            libc::EFAULT => {} // it's ok if the ptr doesn't point to valid memory
            libc::EINVAL => panic!("_umtx_op() WAKE returned EINVAL unexpectedly"),
            _ => panic!("Unexpected _umtx_op() WAKE return code"),
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use super::*;

    pub(crate) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        #[cfg(not(target_feature = "atomics"))]
        compile_error!("WASI target missing cpu feature 'atomics'");

        let to: i64 = match timeout {
            Some(to) => i64::try_from(to).expect("int cast"),
            None => -1,
        };
        // SAFETY: ptr.as_ptr() is a valid aligned *mut i32 (AtomicU32 has the same layout).
        let result = unsafe {
            core::arch::wasm32::memory_atomic_wait32(ptr.as_ptr().cast::<i32>(), expect as i32, to)
        };
        match result {
            0 => Ok(()), // ok
            1 => Ok(()), // expected =! loaded
            2 => Err(TimeoutError::Timeout),
            _ => panic!("Unexpected memory.atomic.wait32() return code"),
        }
    }

    pub fn wake(ptr: &AtomicU32, max_waiters: u32) {
        #[cfg(not(target_feature = "atomics"))]
        compile_error!("WASI target missing cpu feature 'atomics'");

        debug_assert!(max_waiters != 0);
        // SAFETY: ptr.as_ptr() is a valid aligned *mut i32 (AtomicU32 has the same layout).
        let woken_count = unsafe {
            core::arch::wasm32::memory_atomic_notify(ptr.as_ptr().cast::<i32>(), max_waiters)
        };
        let _ = woken_count; // can be 0 when linker flag 'shared-memory' is not enabled
    }
}

/// Deadline is used to wait efficiently for a pointer's value to change using Futex and a fixed timeout.
///
/// Futex's timedWait() api uses a relative duration which suffers from over-waiting
/// when used in a loop which is often required due to the possibility of spurious wakeups.
///
/// Deadline instead converts the relative timeout to an absolute one so that multiple calls
/// to Futex timedWait() can block for and report more accurate error.Timeouts.
pub struct Deadline {
    timeout: Option<u64>,
    started: std::time::Instant,
}

impl Deadline {
    /// Create the deadline to expire after the given amount of time in nanoseconds passes.
    /// Pass in `null` to have the deadline call `Futex.wait()` and never expire.
    pub fn init(expires_in_ns: Option<u64>) -> Deadline {
        // `Instant::now()` is infallible and cheap, so always initialize
        // `started` (even when timeout is None) to avoid MaybeUninit gymnastics.
        Deadline {
            timeout: expires_in_ns,
            started: std::time::Instant::now(),
        }
    }

    /// Wait until either:
    /// - the `ptr`'s value changes from `expect`.
    /// - `Futex.wake()` is called on the `ptr`.
    /// - A spurious wake occurs.
    /// - The deadline expires; In which case `error.Timeout` is returned.
    #[cold]
    pub fn wait(&mut self, ptr: &AtomicU32, expect: u32) -> Result<(), TimeoutError> {
        // Check if we actually have a timeout to wait until.
        // If not just wait "forever".
        let Some(timeout_ns) = self.timeout else {
            wait_forever(ptr, expect);
            return Ok(());
        };

        // Get how much time has passed since we started waiting
        // then subtract that from the init() timeout to get how much longer to wait.
        // Use overflow to detect when we've been waiting longer than the init() timeout.
        let elapsed_ns = u64::try_from(self.started.elapsed().as_nanos()).unwrap_or(u64::MAX);
        let until_timeout_ns = timeout_ns.saturating_sub(elapsed_ns);
        wait(ptr, expect, Some(until_timeout_ns))
    }
}
