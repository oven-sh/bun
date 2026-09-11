//! The CPU time one thread has used.

use std::thread::JoinHandle;

/// Microseconds, split as `getrusage(RUSAGE_THREAD)` splits them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ThreadCpuUsage {
    pub user: u64,
    pub system: u64,
}

impl ThreadCpuUsage {
    /// The calling thread's.
    pub fn current() -> Option<Self> {
        imp::current()
    }

    /// `thread`'s, read from any thread. `None` once it has exited, and where
    /// the platform has no way to ask.
    pub fn of<T>(thread: &JoinHandle<T>) -> Option<Self> {
        imp::of(thread)
    }

    /// `self` with neither time below what `previous` reported. On Linux the
    /// split of another thread's time is an estimate that moves between reads.
    #[must_use]
    pub fn never_below(self, previous: Self) -> Self {
        let total = self.user + self.system;
        if total <= previous.user + previous.system {
            return previous;
        }
        let system = self.system.max(previous.system);
        let user = total - system;
        if user < previous.user {
            return Self {
                user: previous.user,
                system: total - previous.user,
            };
        }
        Self { user, system }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod imp {
    use super::ThreadCpuUsage;
    use core::ffi::c_int;
    use std::os::unix::thread::JoinHandleExt as _;
    use std::thread::JoinHandle;

    unsafe extern "C" {
        // The out-parameters are references; a clock that does not exist is an errno.
        safe fn clock_gettime(clock: libc::clockid_t, time: &mut libc::timespec) -> c_int;
        safe fn getrusage(who: c_int, usage: &mut libc::rusage) -> c_int;
    }

    // include/uapi/linux/resource.h; the libc crate has no constant for bionic.
    const RUSAGE_THREAD: c_int = 1;

    pub(super) fn current() -> Option<ThreadCpuUsage> {
        let mut usage: libc::rusage = bun_core::ffi::zeroed();
        let micros = |t: libc::timeval| t.tv_sec as u64 * 1_000_000 + t.tv_usec as u64;
        (getrusage(RUSAGE_THREAD, &mut usage) == 0).then(|| ThreadCpuUsage {
            user: micros(usage.ru_utime),
            system: micros(usage.ru_stime),
        })
    }

    // `(!tid << 3) | CPUCLOCK_PERTHREAD_MASK | which` (include/linux/posix-timers_types.h).
    const WHICH_MASK: libc::clockid_t = 3;
    const USER_AND_SYSTEM_TICKS: libc::clockid_t = 0;
    const USER_TICKS: libc::clockid_t = 1;

    pub(super) fn of<T>(thread: &JoinHandle<T>) -> Option<ThreadCpuUsage> {
        let mut runtime_clock: libc::clockid_t = 0;
        // SAFETY: a thread that is neither joined nor detached keeps its pthread_t valid.
        let status = unsafe {
            libc::pthread_getcpuclockid(
                thread.as_pthread_t() as libc::pthread_t,
                &raw mut runtime_clock,
            )
        };
        // musl and bionic clear the tid of a thread that has exited and answer with the clock of
        // tid 0, which is the calling thread's.
        let tid = !(runtime_clock >> 3);
        if status != 0 || tid == 0 {
            return None;
        }
        let nanos = |clock: libc::clockid_t| -> Option<u64> {
            let mut time = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            (clock_gettime(clock, &mut time) == 0)
                .then(|| time.tv_sec as u64 * 1_000_000_000 + time.tv_nsec as u64)
        };
        let runtime = nanos(runtime_clock)?;
        let user_ticks = nanos((runtime_clock & !WHICH_MASK) | USER_TICKS)?;
        let system_ticks = nanos((runtime_clock & !WHICH_MASK) | USER_AND_SYSTEM_TICKS)?
            .saturating_sub(user_ticks);
        // getrusage(RUSAGE_THREAD) only answers for the calling thread. It reports the exact
        // runtime, split in the ratio of the tick-sampled times (cputime_adjust(),
        // kernel/sched/cputime.c).
        let system = match (user_ticks, system_ticks) {
            (_, 0) => 0,
            (0, _) => runtime,
            (user, system) => {
                (u128::from(runtime) * u128::from(system) / (u128::from(user) + u128::from(system)))
                    as u64
            }
        };
        Some(ThreadCpuUsage {
            user: (runtime - system) / 1000,
            system: system / 1000,
        })
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::ThreadCpuUsage;
    use std::os::unix::thread::JoinHandleExt as _;
    use std::thread::JoinHandle;

    pub(super) fn current() -> Option<ThreadCpuUsage> {
        // SAFETY: no preconditions; the calling thread's pthread_t is valid.
        of_pthread(unsafe { libc::pthread_self() })
    }

    pub(super) fn of<T>(thread: &JoinHandle<T>) -> Option<ThreadCpuUsage> {
        of_pthread(thread.as_pthread_t() as libc::pthread_t)
    }

    /// `pthread` belongs to a thread that is neither joined nor detached.
    fn of_pthread(pthread: libc::pthread_t) -> Option<ThreadCpuUsage> {
        // SAFETY: all-zero is a valid `thread_basic_info` (POD C struct).
        let mut info: libc::thread_basic_info = unsafe { bun_core::ffi::zeroed_unchecked() };
        let mut count = libc::THREAD_BASIC_INFO_COUNT;
        // SAFETY: the pthread_t is valid (fn contract) and lends its mach port without a new
        // right; `info` and `count` are out-pointers of the size `count` states. The port of a
        // thread that has exited is a dead name, which is an error status.
        let status = unsafe {
            libc::thread_info(
                libc::pthread_mach_thread_np(pthread),
                libc::THREAD_BASIC_INFO as libc::thread_flavor_t,
                (&raw mut info).cast(),
                &raw mut count,
            )
        };
        let micros = |t: libc::time_value_t| t.seconds as u64 * 1_000_000 + t.microseconds as u64;
        (status == libc::KERN_SUCCESS).then(|| ThreadCpuUsage {
            user: micros(info.user_time),
            system: micros(info.system_time),
        })
    }
}

#[cfg(windows)]
mod imp {
    use super::ThreadCpuUsage;
    use crate::windows::{FILETIME, GetCurrentThread, GetThreadTimes, HANDLE};
    use std::os::windows::io::AsRawHandle as _;
    use std::thread::JoinHandle;

    pub(super) fn current() -> Option<ThreadCpuUsage> {
        // SAFETY: no preconditions; a pseudo handle for the calling thread.
        of_handle(unsafe { GetCurrentThread() })
    }

    pub(super) fn of<T>(thread: &JoinHandle<T>) -> Option<ThreadCpuUsage> {
        of_handle(thread.as_raw_handle().cast())
    }

    /// `thread` is an open thread handle. A thread that has exited reports its final times.
    fn of_handle(thread: HANDLE) -> Option<ThreadCpuUsage> {
        // SAFETY: all-zero is a valid FILETIME (POD C struct).
        let [mut creation, mut exit, mut kernel, mut user]: [FILETIME; 4] =
            unsafe { bun_core::ffi::zeroed_unchecked() };
        // SAFETY: an open handle (fn contract) and four valid out-pointers.
        let ok = unsafe {
            GetThreadTimes(
                thread,
                &raw mut creation,
                &raw mut exit,
                &raw mut kernel,
                &raw mut user,
            )
        };
        // FILETIME counts 100 ns units.
        let micros =
            |t: FILETIME| ((u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)) / 10;
        (ok != 0).then(|| ThreadCpuUsage {
            user: micros(user),
            system: micros(kernel),
        })
    }
}

#[cfg(target_os = "freebsd")]
mod imp {
    use super::ThreadCpuUsage;
    use core::ffi::c_int;
    use std::thread::JoinHandle;

    unsafe extern "C" {
        // The out-parameter is a reference; a `who` that does not exist is an errno.
        safe fn getrusage(who: c_int, usage: &mut libc::rusage) -> c_int;
    }

    pub(super) fn current() -> Option<ThreadCpuUsage> {
        let mut usage: libc::rusage = bun_core::ffi::zeroed();
        let micros = |t: libc::timeval| t.tv_sec as u64 * 1_000_000 + t.tv_usec as u64;
        (getrusage(libc::RUSAGE_THREAD, &mut usage) == 0).then(|| ThreadCpuUsage {
            user: micros(usage.ru_utime),
            system: micros(usage.ru_stime),
        })
    }

    pub(super) fn of<T>(_: &JoinHandle<T>) -> Option<ThreadCpuUsage> {
        None
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "freebsd",
    windows
)))]
mod imp {
    use super::ThreadCpuUsage;
    use std::thread::JoinHandle;

    pub(super) fn current() -> Option<ThreadCpuUsage> {
        None
    }

    pub(super) fn of<T>(_: &JoinHandle<T>) -> Option<ThreadCpuUsage> {
        None
    }
}
