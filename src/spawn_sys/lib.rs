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
//! `bun_analytics`, and (Windows-only) `bun_libuv_sys`. There is **no**
//! `bun_event_loop`/`bun_aio`/`bun_io`/`bun_threading` dependency — `Process`,
//! `Poller`, `WaiterThread`, and the `sync` runner stay in `bun_spawn` and
//! depend on this crate.
//!
//! See `docs/SPAWN_SYS_PROPOSAL.md` for the full crate-graph rationale.

#![allow(dead_code)]

use core::ffi::c_char;

// ──────────────────────────────────────────────────────────────────────────
// Module layout
// ──────────────────────────────────────────────────────────────────────────

/// posix_spawn(2) FFI wrappers (Actions / Attr / spawn_z / wait4).
/// Port of `src/runtime/api/bun/spawn.zig`.
#[path = "posix_spawn.rs"]
pub mod posix_spawn;

/// `spawn_process_posix` + option/result structs + `Rusage`.
/// Split out of `src/spawn/process.rs`.
#[path = "spawn_process.rs"]
pub mod spawn_process;

// ──────────────────────────────────────────────────────────────────────────
// Canonical FFI type aliases — Zig `?[*:0]const u8` ↔ Rust `*const c_char`
//
// **Never** spell these as `Option<*const c_char>`: raw pointers are already
// nullable, and `Option<*const T>` does *not* enjoy the null-pointer-niche
// guarantee that `Option<&T>`/`Option<NonNull<T>>` do — its layout is
// implementation-defined. Passing `Vec<Option<*const c_char>>::as_ptr()` to
// `execve` is the bug class that produced the EFAULT fixed in 813ccdb7622.
// ──────────────────────────────────────────────────────────────────────────

/// `[*:null]?[*:0]const u8` — null-terminated array of NUL-terminated C
/// strings (the `argv` shape `posix_spawn`/`execve` accept). Build as
/// `Vec<*const c_char>` with a trailing `core::ptr::null()`, then `.as_ptr()`.
pub type Argv = *const *const c_char;

/// Same shape as [`Argv`] for the environment block.
pub type Envp = *const *const c_char;

/// Element type for an owned `Vec` backing an [`Argv`]/[`Envp`]. Null is the
/// sentinel; never wrap in `Option`.
pub type CStrPtr = *const c_char;

// Layout guard: a C-string pointer is exactly one machine word. If this ever
// fails, every `as_ptr().cast()` from a `Vec<*const c_char>` to `Argv` is
// suspect.
const _: () = assert!(core::mem::size_of::<*const c_char>() == core::mem::size_of::<usize>());
const _: () = assert!(core::mem::align_of::<*const c_char>() == core::mem::align_of::<usize>());
// Negative guard: `Option<*const c_char>` is **not** word-sized — it carries a
// discriminant. Any `[Option<*const c_char>; N]` cast to `Argv` is a layout bug.
// Use `Option<NonNull<c_char>>` for niche-optimized nullable storage instead.
const _: () = assert!(core::mem::size_of::<Option<*const c_char>>() != core::mem::size_of::<usize>());
const _: () = assert!(
    core::mem::size_of::<Option<core::ptr::NonNull<c_char>>>() == core::mem::size_of::<usize>()
);

// ──────────────────────────────────────────────────────────────────────────
// Signal-forwarding / no-orphans FFI surface — moved down from
// `bun_spawn::process::sync` so the decls live next to `posix_spawn_bun`.
// `bun_spawn::sync` consumes these via `bun_spawn_sys::ffi::*`.
// ──────────────────────────────────────────────────────────────────────────
pub mod ffi {
    use core::ffi::c_int;

    unsafe extern "C" {
        /// Install SIGINT/SIGTERM/… handlers that record the signal for
        /// forwarding to [`Bun__currentSyncPID`].
        pub fn Bun__registerSignalsForForwarding();
        pub fn Bun__unregisterSignalsForForwarding();

        // macOS p_puniqueid descendant tracker — see NoOrphansTracker.cpp.
        pub fn Bun__noOrphans_begin(kq: c_int, root: libc::pid_t);
        pub fn Bun__noOrphans_releaseKq();
        pub fn Bun__noOrphans_onFork();
        pub fn Bun__noOrphans_onExit(pid: libc::pid_t);

        /// The PID to forward signals to. Set to 0 when unregistering.
        pub static mut Bun__currentSyncPID: i64;

        /// Race condition: a signal could be sent before `spawn_process_posix`
        /// returns. Call after the child PID is known.
        pub fn Bun__sendPendingSignalIfNecessary();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Waiter-thread fallback flag — owned here so `spawn_process_posix` /
// `PosixSpawnResult::pifd_from_pid` can flip it without depending on
// `bun_threading`. `bun_spawn::WaiterThread` reads/writes through these.
// ──────────────────────────────────────────────────────────────────────────
pub mod waiter_thread_flag {
    use core::sync::atomic::{AtomicBool, Ordering};

    static SHOULD_USE_WAITER_THREAD: AtomicBool = AtomicBool::new(false);

    #[inline]
    pub fn set() {
        SHOULD_USE_WAITER_THREAD.store(true, Ordering::Relaxed);
    }

    #[inline]
    pub fn get() -> bool {
        SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `PR_SET_PDEATHSIG` default hook — `spawn_process_posix` consults this when
// `PosixSpawnOptions::linux_pdeathsig` is `None`. The decision needs
// thread-identity state owned by `bun_aio::ParentDeathWatchdog`, so the
// higher tier installs a function pointer here at startup; the default is
// "no".
// ──────────────────────────────────────────────────────────────────────────
pub mod pdeathsig {
    use core::sync::atomic::{AtomicPtr, Ordering};

    type Hook = fn() -> bool;

    static HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

    /// Installed by `bun_aio::ParentDeathWatchdog::install()`.
    pub fn set_hook(f: Hook) {
        HOOK.store(f as *mut (), Ordering::Release);
    }

    #[inline]
    pub(crate) fn should_default() -> bool {
        let p = HOOK.load(Ordering::Acquire);
        if p.is_null() {
            return false;
        }
        // SAFETY: `p` was stored from a `fn() -> bool` in `set_hook`; fn
        // pointers are word-sized and `*mut ()` round-trips them on every
        // supported target.
        let f: Hook = unsafe { core::mem::transmute::<*mut (), Hook>(p) };
        f()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Public surface — flat re-exports so `bun_spawn` can `pub use bun_spawn_sys::*`.
// ──────────────────────────────────────────────────────────────────────────

pub use spawn_process::{
    rusage_zeroed, Dup2, ExtraPipe, FdT, IoCounters, PidFdType, PidT, PosixSpawnOptions,
    PosixSpawnResult, PosixStdio, Rusage, StdioKind, WinRusage, WinTimeval,
};
#[cfg(unix)]
pub use spawn_process::spawn_process_posix;
#[cfg(windows)]
pub use spawn_process::uv_getrusage;
