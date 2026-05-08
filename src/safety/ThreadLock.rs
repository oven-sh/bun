// TODO(b2): `ci_assert` feature — wire up in src/safety/Cargo.toml [features] (see src/http_types/Cargo.toml).
// Until then, silence check-cfg so this file contributes 0 diagnostics on the bun_bin link path.
#![allow(unexpected_cfgs)]

use super::thread_id::{self, ThreadId, INVALID as INVALID_THREAD_ID};
// TODO(port): verify `super::thread_id` exports `ThreadId` + `current()` in the Rust port;
// Zig used `std.Thread.Id` / `std.Thread.getCurrentId()` directly with `invalid` from thread_id.zig.
#[cfg(debug_assertions)]
use bun_core::StoredTrace; // MOVE_DOWN: was bun_crash_handler::StoredTrace (CYCLEBREAK → core)

// TODO(port): `bun.Environment.ci_assert` — confirm the exact cfg/feature name in Phase B.
// Using feature = "ci_assert" as a placeholder; Zig gates the entire struct payload on this.
pub struct ThreadLock {
    #[cfg(feature = "ci_assert")]
    owning_thread: ThreadId,
    #[cfg(debug_assertions)]
    locked_at: StoredTrace,
}

impl ThreadLock {
    pub fn init_unlocked() -> Self {
        Self {
            #[cfg(feature = "ci_assert")]
            owning_thread: INVALID_THREAD_ID,
            #[cfg(debug_assertions)]
            locked_at: StoredTrace::empty(),
        }
    }

    pub fn init_locked() -> Self {
        let mut self_ = Self::init_unlocked();
        self_.lock();
        self_
    }

    pub fn init_locked_if_non_comptime() -> Self {
        // TODO(port): Zig's `@inComptime()` has no Rust equivalent. Rust has no comptime
        // evaluation context for this struct's runtime fields, so always take the runtime path.
        Self::init_locked()
    }

    /// RAII spelling of `lock()` + `defer unlock()`. Returns a guard that
    /// `unlock()`s on `Drop`. The guard stores a raw pointer (not a borrow)
    /// so the caller's surrounding `&mut self` stays usable for the rest of
    /// the scope — `ThreadLock` is a debug-only ownership assertion, not a
    /// real mutex, so re-forming `&mut` at drop time mirrors what every
    /// caller already did via `scopeguard` + raw pointer.
    #[inline]
    pub fn guard(&mut self) -> ThreadLockGuard {
        self.lock();
        ThreadLockGuard(std::ptr::from_mut::<Self>(self))
    }

    pub fn lock(&mut self) {
        #[cfg(feature = "ci_assert")]
        {
            let current = thread_id::current();
            if self.owning_thread != INVALID_THREAD_ID {
                #[cfg(debug_assertions)]
                {
                    bun_core::output::err(
                        "assertion failure",
                        format_args!("`ThreadLock` was already locked here:"),
                    );
                    // bun_core::dump_stack_trace (T0 fallback — raw addrs;
                    // crash-report path uses the richer bun_crash_handler).
                    crate::dump_stored_trace(&self.locked_at);
                }
                panic!(
                    "tried to lock `ThreadLock` on thread {}, but was already locked by thread {}",
                    current, self.owning_thread,
                );
            }
            self.owning_thread = current;
            #[cfg(debug_assertions)]
            {
                // TODO(port): @returnAddress() — no stable Rust equivalent; StoredTrace::capture
                // may need to take `Option<usize>` or use backtrace's caller frame.
                self.locked_at = StoredTrace::capture(None);
            }
        }
    }

    pub fn unlock(&mut self) {
        #[cfg(feature = "ci_assert")]
        {
            self.assert_locked();
            *self = Self::init_unlocked();
        }
    }

    pub fn assert_locked(&self) {
        #[cfg(feature = "ci_assert")]
        {
            // Spec uses `bun.assertf` (always-on under ci_assert), not a
            // debug-only check. The body is already cfg-gated on `ci_assert`,
            // so use `assert!` — `debug_assert!` would silently no-op in a
            // release CI build with `ci_assert` enabled.
            assert!(
                self.owning_thread != INVALID_THREAD_ID,
                "`ThreadLock` is not locked",
            );
            let current = thread_id::current();
            assert!(
                self.owning_thread == current,
                "`ThreadLock` is locked by thread {}, not thread {}",
                self.owning_thread,
                current,
            );
        }
    }

    /// Acquires the lock if not already locked; otherwise, asserts that the current thread holds the
    /// lock.
    pub fn lock_or_assert(&mut self) {
        #[cfg(feature = "ci_assert")]
        {
            if self.owning_thread == INVALID_THREAD_ID {
                self.lock();
            } else {
                self.assert_locked();
            }
        }
    }
}

/// RAII guard returned by [`ThreadLock::guard`]. Calls `unlock()` on drop.
#[must_use = "dropping immediately unlocks the ThreadLock"]
pub struct ThreadLockGuard(*mut ThreadLock);

impl Drop for ThreadLockGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `self.0` was `&mut ThreadLock` at `ThreadLock::guard()` and
        // the lock is a field of a struct the caller holds `&mut` to for the
        // entire guard scope (every call site is `self.field.guard()` inside a
        // `&mut self` method); no other live `&mut ThreadLock` exists at drop.
        unsafe { (*self.0).unlock() }
    }
}

// TODO(port): `bun.Environment.ci_assert` cfg mapping (see field cfg above).
pub(crate) const ENABLED: bool = cfg!(feature = "ci_assert");

#[allow(dead_code)]
const TRACES_ENABLED: bool = cfg!(debug_assertions);

// ported from: src/safety/ThreadLock.zig
