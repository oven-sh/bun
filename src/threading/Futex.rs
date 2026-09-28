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

use core::fmt;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use core::time::Duration;

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
    wake_raw(core::ptr::from_ref(ptr), max_waiters);
}

/// [`wake`] for a word the woken side may already have freed (`Mutex::unlock_raw`): every
/// backend keys on the address and never reads the word, so at worst this wakes spuriously.
#[cold]
pub(crate) fn wake_raw(ptr: *const AtomicU32, max_waiters: u32) {
    // Avoid calling into the OS if there's nothing to wake up.
    if max_waiters == 0 {
        return;
    }

    imp::wake(ptr, max_waiters);
}

/// The OS, or a layer that filters or emulates system calls, gave `wake()` a code its backend
/// has no arm for. Whether the wake was done is not known: the waiter is awake, or it stays
/// blocked until its timeout or the next wake.
///
/// `code` is by value: a reference gives the caller a stack slot, which every `wake()` pays for.
#[cfg(unix)]
#[cold]
#[inline(never)]
fn unexpected_wake(op: &str, code: impl fmt::Display) {
    static REPORTED: AtomicBool = AtomicBool::new(false);
    report_once(&REPORTED, op, &code, WAKE_EFFECT);
}

#[cfg(unix)]
const WAKE_EFFECT: &str = "A thread that waits for this wake can stay asleep.";

/// The same for `wait()`. The caller sees a spurious wakeup and checks its word again. The
/// sleep keeps that loop from spinning when the OS does none of the waits.
#[cold]
#[inline(never)]
fn unexpected_wait(op: &str, code: impl fmt::Display) -> Result<(), TimeoutError> {
    static REPORTED: AtomicBool = AtomicBool::new(false);
    report_once(&REPORTED, op, &code, WAIT_EFFECT);
    std::thread::sleep(BACK_OFF);
    Ok(())
}

const WAIT_EFFECT: &str = "A thread that cannot wait polls.";
const BACK_OFF: Duration = Duration::from_millis(1);

const REPORT_MAX: usize = 192;

/// Must not allocate: `ThreadPool` waits between `mi_on_thread_idle_start` and
/// `mi_on_thread_idle_end`.
fn report_once(reported: &AtomicBool, op: &str, code: &dyn fmt::Display, effect: &str) {
    if reported.swap(true, Ordering::Relaxed) {
        return;
    }
    let mut buf = [0u8; REPORT_MAX];
    let line = format_report(&mut buf, op, code, effect);
    // The report is a diagnostic. A stderr that is closed or full must not stop the caller.
    let _ = bun_sys::write(bun_sys::Fd::stderr(), line);
}

fn format_report<'a>(
    buf: &'a mut [u8; REPORT_MAX],
    op: &str,
    code: &dyn fmt::Display,
    effect: &str,
) -> &'a [u8] {
    let mut line = bun_core::fmt::SliceCursor::new(buf);
    // A piece that does not fit ends the line there.
    let _ = fmt::write(
        &mut line,
        format_args!("warn: {op} returned {code}. Bun continues. {effect}\n"),
    );
    let len = line.at;
    &line.buf[..len]
}

/// An errno as the report prints it: the number, then the name.
#[cfg(unix)]
struct Errno(i64);

#[cfg(unix)]
impl fmt::Display for Errno {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = bun_sys::SystemErrno::init(self.0).map_or("UNKNOWN", <&'static str>::from);
        write!(f, "errno {} ({name})", self.0)
    }
}

#[cfg(windows)]
struct NtStatus(u32);

#[cfg(windows)]
impl fmt::Display for NtStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NTSTATUS {:#010X}", self.0)
    }
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

    pub(super) fn wake(_ptr: *const AtomicU32, _max_waiters: u32) {
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
    use bun_sys::windows;
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
            windows::NTSTATUS::TIMEOUT => Err(TimeoutError::Timeout),
            windows::NTSTATUS(code) => unexpected_wait("RtlWaitOnAddress", NtStatus(code)),
        }
    }

    pub(super) fn wake(ptr: *const AtomicU32, max_waiters: u32) {
        let address: *const c_void = ptr.cast();
        debug_assert!(max_waiters != 0);

        // SAFETY: RtlWakeAddress* only key on `address`; it need not be live (`super::wake_raw`).
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
    use bun_core::time::NS_PER_US;
    use bun_sys::darwin as c;
    use core::ffi::c_void;

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
        let flags = c::UL {
            op: c::ULOp::COMPARE_AND_WAIT,
            no_errno: true,
            ..Default::default()
        };
        // SAFETY: addr points at a live AtomicU32; flags/expect/timeout are plain values.
        let status = unsafe {
            'blk: {
                if supports_ulock_wait2 {
                    break 'blk c::__ulock_wait2(flags, addr, expect as u64, timeout_ns, 0);
                }

                let timeout_us = match u32::try_from(timeout_ns / NS_PER_US) {
                    Ok(v) => v,
                    Err(_) => {
                        timeout_overflowed = true;
                        u32::MAX
                    }
                };

                c::__ulock_wait(flags, addr, expect as u64, timeout_us)
            }
        };

        if status >= 0 {
            return Ok(());
        }
        // ULF_NO_ERRNO: kernel returns `-errno` directly. `c::E` is `#[repr(u16)]`,
        // so cast (no transmute — sizes differ).
        match c::E::from_raw((-status) as u16) {
            // Wait was interrupted by the OS or other spurious signalling.
            c::E::EINTR => Ok(()),
            // Address of the futex was paged out. This is unlikely, but possible in theory, and
            // pthread/libdispatch on darwin bother to handle it. In this case we'll return
            // without waiting, but the caller should retry anyway.
            c::E::EFAULT => Ok(()),
            // Only report Timeout if we didn't have to cap the timeout
            c::E::ETIMEDOUT => {
                if !timeout_overflowed {
                    return Err(TimeoutError::Timeout);
                }
                Ok(())
            }
            _ => unexpected_wait("__ulock_wait2", Errno(i64::from(-status))),
        }
    }

    pub(super) fn wake(ptr: *const AtomicU32, max_waiters: u32) {
        let flags = c::UL {
            op: c::ULOp::COMPARE_AND_WAIT,
            no_errno: true,
            wake_all: max_waiters > 1,
            ..Default::default()
        };

        loop {
            let addr: *const c_void = ptr.cast();
            // SAFETY: __ulock_wake only keys on `addr`; it need not be live (`super::wake_raw`).
            let status = unsafe { c::__ulock_wake(flags, addr, 0) };

            if status >= 0 {
                return;
            }
            match c::E::from_raw((-status) as u16) {
                c::E::EINTR => continue, // spurious wake()
                c::E::ENOENT => return,  // nothing was woken up
                // EFAULT is one: __ulock_wake doesn't generate it according to darwin
                // pthread_cond_t. EALREADY is one: it is only for ULF_WAKE_THREAD.
                _ => return unexpected_wake("__ulock_wake", Errno(i64::from(-status))),
            }
        }
    }
}

// https://man7.org/linux/man-pages/man2/futex.2.html
#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux_impl {
    use super::*;
    use bun_core::time::NS_PER_S;

    // Out of line, so that `super::wait` inlines into its callers and the ones that pass a
    // constant timeout drop its check.
    #[inline(never)]
    pub(super) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        use bun_sys::linux;
        // SAFETY: ts is fully initialized below before being passed to the kernel when
        // timeout.is_some(); when timeout is None we pass null and ts is never read.
        let mut ts: linux::timespec = unsafe { bun_core::ffi::zeroed_unchecked() };
        if let Some(timeout_ns) = timeout {
            ts.sec = <_>::try_from(timeout_ns / NS_PER_S).unwrap();
            ts.nsec = <_>::try_from(timeout_ns % NS_PER_S).unwrap();
        }

        // SAFETY: ptr.as_ptr() is a valid *const u32 for the duration of the call; the
        // timespec pointer is either null or points at the stack local above.
        let rc = unsafe {
            linux::futex_4arg(
                ptr.as_ptr().cast(),
                linux::FutexOp {
                    cmd: linux::FutexCmd::WAIT,
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

        match linux::E::init(rc) {
            linux::E::SUCCESS => Ok(()), // notified by `wake()`
            linux::E::INTR => Ok(()),    // spurious wakeup
            linux::E::AGAIN => Ok(()),   // ptr.* != expect
            linux::E::TIMEDOUT => Err(TimeoutError::Timeout),
            linux::E::INVAL => Ok(()), // possibly timeout overflow
            _ => unexpected_wait("FUTEX_WAIT", Errno(-rc as i64)),
        }
    }

    pub(super) fn wake(ptr: *const AtomicU32, max_waiters: u32) {
        use bun_sys::linux;
        let val: u32 = match i32::try_from(max_waiters) {
            Ok(v) => v as u32,
            Err(_) => i32::MAX as u32,
        };
        // SAFETY: a private FUTEX_WAKE only keys on the address (`get_futex_key`); it
        // need not be live (see `super::wake_raw`).
        let rc = unsafe {
            linux::futex_3arg(
                ptr.cast(),
                linux::FutexOp {
                    cmd: linux::FutexCmd::WAKE,
                    private: true,
                },
                val,
            )
        };

        match linux::E::init(rc) {
            linux::E::SUCCESS => {} // successful wake up
            linux::E::INVAL => {}   // invalid futex_wait() on ptr done elsewhere
            linux::E::FAULT => {}   // word already freed (Miri reports this; see `super::wake_raw`)
            _ => unexpected_wake("FUTEX_WAKE", Errno(-rc as i64)),
        }
    }
}

// https://www.freebsd.org/cgi/man.cgi?query=_umtx_op&sektion=2&n=1
#[cfg(target_os = "freebsd")]
mod freebsd_impl {
    use super::*;
    use bun_core::time::NS_PER_S;
    use bun_sys::E;
    use core::ffi::{c_int, c_ulong, c_void};

    pub(super) fn wait(
        ptr: &AtomicU32,
        expect: u32,
        timeout: Option<u64>,
    ) -> Result<(), TimeoutError> {
        let mut tm_size: usize = 0;
        // SAFETY: all-zero is a valid `_umtx_time` (POD).
        let mut tm: libc::_umtx_time = bun_core::ffi::zeroed();
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

        match bun_sys::get_errno(rc) {
            E::SUCCESS => Ok(()),
            E::EINVAL => Ok(()), // possibly timeout overflow
            E::ETIMEDOUT => Err(TimeoutError::Timeout),
            E::EINTR => Ok(()), // spurious wake
            _ => unexpected_wait(
                "UMTX_OP_WAIT_UINT_PRIVATE",
                Errno(i64::from(bun_sys::last_errno())),
            ),
        }
    }

    pub(super) fn wake(ptr: *const AtomicU32, max_waiters: u32) {
        // The kernel reads n_wake as `int`; passing maxInt(u32) truncates to
        // -1 and umtxq_signal_queue's `++ret >= n_wake` returns after one
        // wakeup. _umtx_op(2): "Specify INT_MAX to wake up all waiters."
        let n: c_ulong = max_waiters.min(c_int::MAX as u32) as c_ulong;
        // SAFETY: a private WAKE only keys on the address; it need not be live (`super::wake_raw`).
        let rc = unsafe {
            libc::_umtx_op(
                ptr.cast::<c_void>().cast_mut(),
                libc::UMTX_OP_WAKE_PRIVATE,
                n,
                core::ptr::null_mut(), // there is no timeout struct
                core::ptr::null_mut(), // there is no timeout struct pointer
            )
        };

        match bun_sys::get_errno(rc) {
            E::SUCCESS => {}
            E::EFAULT => {} // it's ok if the ptr doesn't point to valid memory
            _ => unexpected_wake(
                "UMTX_OP_WAKE_PRIVATE",
                Errno(i64::from(bun_sys::last_errno())),
            ),
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
            _ => unexpected_wait("memory.atomic.wait32", result),
        }
    }

    pub fn wake(ptr: *const AtomicU32, max_waiters: u32) {
        #[cfg(not(target_feature = "atomics"))]
        compile_error!("WASI target missing cpu feature 'atomics'");

        debug_assert!(max_waiters != 0);
        // SAFETY: memory.atomic.notify only keys on the aligned address, and linear memory is
        // never unmapped (see `super::wake_raw`); AtomicU32 has the layout of i32.
        let woken_count = unsafe {
            core::arch::wasm32::memory_atomic_notify(ptr.cast::<i32>().cast_mut(), max_waiters)
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
pub(crate) struct Deadline {
    timeout: Option<u64>,
    started: std::time::Instant,
}

impl Deadline {
    /// Create the deadline to expire after the given amount of time in nanoseconds passes.
    /// Pass in `null` to have the deadline call `Futex.wait()` and never expire.
    pub(crate) fn init(expires_in_ns: Option<u64>) -> Deadline {
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
    pub(crate) fn wait(&mut self, ptr: &AtomicU32, expect: u32) -> Result<(), TimeoutError> {
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    fn report<'a>(buf: &'a mut [u8; REPORT_MAX], op: &str, code: i64, effect: &str) -> &'a [u8] {
        format_report(buf, op, &Errno(code), effect)
    }

    #[test]
    fn report_has_the_operation_the_number_and_the_name() {
        let mut buf = [0u8; REPORT_MAX];
        let expected = format!(
            "warn: FUTEX_WAKE returned errno {} (EAGAIN). Bun continues. {WAKE_EFFECT}\n",
            libc::EAGAIN,
        );
        assert_eq!(
            report(&mut buf, "FUTEX_WAKE", libc::EAGAIN.into(), WAKE_EFFECT),
            expected.as_bytes(),
        );
    }

    #[test]
    fn report_has_the_number_of_a_code_without_a_name() {
        let mut buf = [0u8; REPORT_MAX];
        let expected = format!(
            "warn: FUTEX_WAIT returned errno 5000 (UNKNOWN). Bun continues. {WAIT_EFFECT}\n"
        );
        assert_eq!(
            report(&mut buf, "FUTEX_WAIT", 5000, WAIT_EFFECT),
            expected.as_bytes(),
        );
    }

    #[test]
    fn report_of_every_errno_fits() {
        // The longest operation name a backend passes.
        const OP: &str = "UMTX_OP_WAIT_UINT_PRIVATE";
        // Every code with a name, then the longest number a backend passes.
        for code in (1..=i64::from(u8::MAX)).chain([i64::from(i32::MAX)]) {
            for effect in [WAKE_EFFECT, WAIT_EFFECT] {
                let mut buf = [0u8; REPORT_MAX];
                let line = report(&mut buf, OP, code, effect);
                assert!(line.ends_with(format!("{effect}\n").as_bytes()), "{code}");
            }
        }
    }

    /// Counts the calls the current thread makes to the allocator.
    struct CountingAllocator;

    thread_local! {
        static ALLOCATOR_CALLS: Cell<usize> = const { Cell::new(0) };
    }

    // SAFETY: both methods forward to `System`.
    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            ALLOCATOR_CALLS.set(ALLOCATOR_CALLS.get() + 1);
            // SAFETY: the caller upholds the contract of `GlobalAlloc::alloc`.
            unsafe { System.alloc(layout) }
        }

        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            ALLOCATOR_CALLS.set(ALLOCATOR_CALLS.get() + 1);
            // SAFETY: the caller upholds the contract of `GlobalAlloc::dealloc`.
            unsafe { System.dealloc(ptr, layout) }
        }
    }

    #[global_allocator]
    static ALLOCATOR: CountingAllocator = CountingAllocator;

    #[test]
    fn unexpected_code_returns_to_the_caller_and_does_not_allocate() {
        let before = ALLOCATOR_CALLS.get();
        // The two helpers report once for each process. A new latch reports each time.
        for _ in 0..4 {
            let reported = AtomicBool::new(false);
            report_once(
                &reported,
                "FUTEX_WAKE",
                &Errno(libc::EAGAIN.into()),
                WAKE_EFFECT,
            );
            unexpected_wake("FUTEX_WAKE", Errno(libc::EAGAIN.into()));
            let waited = unexpected_wait("FUTEX_WAIT", Errno(libc::ENOSYS.into()));
            assert_eq!(waited, Ok(()));
        }
        assert_eq!(ALLOCATOR_CALLS.get() - before, 0);
    }
}
