//! `bun_spawn_sys` — raw OS process-spawn layer split out of `bun_spawn`.
//!
//! This crate owns everything that talks directly to the kernel/libuv to
//! create a child process and read its exit status, with **no** event-loop
//! integration:
//!
//!   - `posix_spawn(2)` libc wrappers (`Actions`/`Attr`/`spawn_z`/`wait4`)
//!   - the `posix_spawn_bun` repr(C) request structs and FFI decl
//!   - `spawn_process_posix` (fd plumbing + `posix_spawn` call)
//!   - `PosixSpawnOptions`/`PosixStdio`/`PosixSpawnResult`/`ExtraPipe`/
//!     `StdioKind`/`Dup2`/`Rusage`
//!   - signal-forwarding / no-orphans `extern "C"` decls
//!
//! Dependencies are deliberately leaf-only: `libc`, `bun_sys`, `bun_core`,
//! (Unix-only) `bun_analytics`, and (Windows-only) `bun_libuv_sys`. There is **no**
//! `bun_event_loop`/`bun_io`/`bun_io`/`bun_threading` dependency — `Process`,
//! `Poller`, `WaiterThread`, and the `sync` runner stay in `bun_spawn` and
//! depend on this crate.
//!
//! See `docs/SPAWN_SYS_PROPOSAL.md` for the full crate-graph rationale.

// ──────────────────────────────────────────────────────────────────────────
// Module layout
// ──────────────────────────────────────────────────────────────────────────

pub mod error;
pub use error::{Error, Result};

/// posix_spawn(2) FFI wrappers (Actions / Attr / spawn_z / wait4).
#[cfg(unix)]
#[path = "posix_spawn.rs"]
pub mod posix_spawn;

/// `spawn_process_posix` + option/result structs + `Rusage`.
/// Split out of `src/spawn/process.rs`.
#[path = "spawn_process.rs"]
pub mod spawn_process;

// ──────────────────────────────────────────────────────────────────────────
// Signal-forwarding / no-orphans FFI surface — moved down from
// `bun_spawn::process::sync` so the decls live next to `posix_spawn_bun`.
// `bun_spawn::sync` consumes these via `bun_spawn_sys::ffi::*`.
// ──────────────────────────────────────────────────────────────────────────
pub mod ffi {
    use core::ffi::c_int;

    // `pid_t` doesn't exist in `libc` on Windows; the noOrphans tracker is
    // macOS-only anyway, so just use the raw C type the C++ side declares.
    #[allow(non_camel_case_types)]
    type pid_t = c_int;

    unsafe extern "C" {
        /// Install SIGINT/SIGTERM/… handlers that record the signal for
        /// forwarding to [`Bun__currentSyncPID`].
        pub safe fn Bun__registerSignalsForForwarding();
        pub safe fn Bun__unregisterSignalsForForwarding();

        // macOS p_puniqueid descendant tracker — see NoOrphansTracker.cpp.
        pub safe fn Bun__noOrphans_begin(kq: c_int, root: pid_t);
        pub safe fn Bun__noOrphans_releaseKq();
        pub safe fn Bun__noOrphans_onFork();
        pub safe fn Bun__noOrphans_onExit(pid: pid_t);

        /// The PID to forward signals to (`std::atomic<int64_t>` in C++).
        /// Set to 0 when unregistering.
        pub safe static Bun__currentSyncPID: core::sync::atomic::AtomicI64;

        /// Forwards a signal that arrived before the child PID was known.
        /// Call after a `SeqCst` store of the PID.
        pub safe fn Bun__sendPendingSignalIfNecessary();

        /// `kill(2)`. safe: by-value integers only; a bad pid or signal is an errno, never UB. Async-signal-safe.
        #[cfg(unix)]
        pub safe fn kill(pid: pid_t, sig: c_int) -> c_int;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Waiter-thread fallback flag — owned here so `spawn_process_posix` /
// `PosixSpawnResult::pifd_from_pid` can flip it without depending on
// `bun_threading`. `bun_spawn::process::WaiterThread` reads/writes through these.
// ──────────────────────────────────────────────────────────────────────────
pub mod waiter_thread_flag {
    use core::sync::atomic::{AtomicBool, Ordering};

    static SHOULD_USE_WAITER_THREAD: AtomicBool = AtomicBool::new(false);

    /// The waiter thread is the fallback for Linux without pidfd. kqueue
    /// platforms always have EVFILT_PROC, and the thread's loop has no wakeup
    /// for newly appended processes there, so the flag is not honoured on them.
    #[inline]
    pub fn set() {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        SHOULD_USE_WAITER_THREAD.store(true, Ordering::Relaxed);
    }

    #[inline]
    pub fn get() -> bool {
        SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `PR_SET_PDEATHSIG` default — `spawn_process_posix` consults this when
// `PosixSpawnOptions::linux_pdeathsig` is `None`. Storage lives here (lowest
// tier that reads it); `bun_io::ParentDeathWatchdog::enable()` flips it on
// from the main thread. `PR_SET_PDEATHSIG` is *thread*-scoped in the kernel,
// so the default only applies when spawning from the same thread that armed
// the watchdog (a `Bun.spawn` from a JS Worker would otherwise kill the child
// on `worker.terminate()`).
// ──────────────────────────────────────────────────────────────────────────
pub mod pdeathsig {
    use core::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use std::thread::ThreadId;

    static DEFAULT_PDEATHSIG_ON_LINUX: AtomicBool = AtomicBool::new(false);
    static INSTALL_THREAD: OnceLock<ThreadId> = OnceLock::new();

    /// Arm the default. Records the calling thread so `should_default` only
    /// returns `true` for spawns issued from that thread. Idempotent.
    pub fn set_default(enabled: bool) {
        if enabled {
            let _ = INSTALL_THREAD.set(std::thread::current().id());
        }
        DEFAULT_PDEATHSIG_ON_LINUX.store(enabled, Ordering::Release);
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[inline]
    pub(crate) fn should_default() -> bool {
        DEFAULT_PDEATHSIG_ON_LINUX.load(Ordering::Acquire) && is_arming_thread()
    }

    /// True iff the calling thread is the one that called `set_default(true)`
    /// (i.e. the main thread that ran `ParentDeathWatchdog::enable()`). The
    /// no-orphans `spawnSync` machinery — `PR_SET_CHILD_SUBREAPER`,
    /// signalfd(SIGCHLD), `wait4(-1)` orphan-reaping — is only sound from that
    /// thread; off-thread callers (install's threadpool `git` clones) would
    /// race the process-wide subreaper flag and reap each other's children.
    #[inline]
    pub fn is_arming_thread() -> bool {
        INSTALL_THREAD.get().copied() == Some(std::thread::current().id())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Public surface — flat re-exports so `bun_spawn` can `pub use bun_spawn_sys::*`.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub use spawn_process::spawn_process_posix;
#[cfg(windows)]
pub use spawn_process::uv_getrusage;
pub use spawn_process::{
    Dup2, ExtraPipe, PidT, PosixSpawnOptions, PosixSpawnResult, PosixStdio, Rusage, RusageFields,
    StdioKind, rusage_zeroed,
};
