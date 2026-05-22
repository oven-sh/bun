// ─── ThreadLock (from bun_safety) ─────────────────────────────────────────
// Debug-only re-entrancy guard. Release builds compile to a ZST.
//
// `locked_at` is `Cell` so `lock()`/`lock_or_assert()` can take `&self`
// (callers like `RefCount::assert_single_threaded` only have `&self`). The
// whole point of ThreadLock is asserting single-threaded access, so the
// unsynchronized write to `locked_at` is exactly the Zig semantics — if two
// threads race here, the `owning_thread.swap` panic fires first.
pub struct ThreadLock {
    #[cfg(debug_assertions)]
    owning_thread: core::sync::atomic::AtomicU64,
    #[cfg(debug_assertions)]
    locked_at: core::cell::Cell<crate::StoredTrace>,
}
// SAFETY: `locked_at` is only written after `owning_thread.swap` proves the
// current thread is the unique acquirer; concurrent access panics first. The
// `Cell` is `!Sync` but the AcqRel `swap` on `owning_thread` is the lock that
// serializes its non-atomic load/store across threads.
unsafe impl Sync for ThreadLock {}
#[cfg(debug_assertions)]
const INVALID_THREAD_ID: u64 = 0;
impl ThreadLock {
    pub const fn init_unlocked() -> Self {
        Self {
            #[cfg(debug_assertions)]
            owning_thread: core::sync::atomic::AtomicU64::new(INVALID_THREAD_ID),
            #[cfg(debug_assertions)]
            locked_at: core::cell::Cell::new(crate::StoredTrace::EMPTY),
        }
    }
    #[inline]
    pub fn init_locked() -> Self {
        let s = Self::init_unlocked();
        s.lock();
        s
    }
    /// Zig `initLockedIfNonComptime` — Zig comptime evaluation has no thread;
    /// in Rust there is no comptime execution, so this is just `init_locked`.
    #[inline]
    pub fn init_locked_if_non_comptime() -> Self {
        Self::init_locked()
    }
    /// RAII spelling of `lock()` + `defer unlock()`. Returns a guard that
    /// `unlock()`s on `Drop`. The guard stores a raw pointer (not a borrow)
    /// so the caller's surrounding `&mut self` on the owning struct stays
    /// usable for the rest of the scope — `ThreadLock` is a debug-only
    /// ownership assertion, not a real mutex.
    #[inline]
    pub fn guard(&self) -> ThreadLockGuard {
        self.lock();
        ThreadLockGuard(core::ptr::from_ref::<Self>(self))
    }
    /// Zig `lockOrAssert` — acquire if unlocked, else assert this thread holds it.
    #[inline]
    pub fn lock_or_assert(&self) {
        #[cfg(debug_assertions)]
        {
            let held = self
                .owning_thread
                .load(core::sync::atomic::Ordering::Acquire);
            if held == INVALID_THREAD_ID {
                self.lock();
            } else {
                self.assert_locked();
            }
        }
    }
    #[inline]
    pub fn lock(&self) {
        #[cfg(debug_assertions)]
        {
            let cur = thread_id();
            let prev = self
                .owning_thread
                .swap(cur, core::sync::atomic::Ordering::AcqRel);
            if prev != INVALID_THREAD_ID {
                // Prior holder wrote `locked_at` after its `swap`; our AcqRel
                // swap observes it. Debug-only diagnostic on the panic path.
                let stored = self.locked_at.get();
                crate::dump_stack_trace(
                    &stored.trace(),
                    crate::DumpStackTraceOptions {
                        frame_count: 10,
                        stop_at_jsc_llint: true,
                        ..Default::default()
                    },
                );
                panic!("ThreadLock: thread {cur} tried to lock, already held by {prev}");
            }
            // swap above proved we are the unique acquirer (prev was INVALID);
            // no other thread can be in this branch concurrently.
            self.locked_at.set(crate::StoredTrace::capture(None));
        }
    }
    #[inline]
    pub fn unlock(&self) {
        #[cfg(debug_assertions)]
        {
            self.assert_locked(); // Zig: assert current thread holds it before reset.
            self.owning_thread
                .store(INVALID_THREAD_ID, core::sync::atomic::Ordering::Release);
            // assert_locked above proved we are the unique holder.
            self.locked_at.set(crate::StoredTrace::EMPTY);
        }
    }
    #[inline]
    pub fn assert_locked(&self) {
        #[cfg(debug_assertions)]
        {
            // Spec uses `bun.assertf` (always-on under ci_assert). Body is
            // already cfg-gated, so plain `assert!` — `debug_assert!` would be
            // redundant gating.
            let held = self
                .owning_thread
                .load(core::sync::atomic::Ordering::Acquire);
            assert!(held != INVALID_THREAD_ID, "`ThreadLock` is not locked");
            let current = thread_id();
            assert!(
                held == current,
                "`ThreadLock` is locked by thread {held}, not thread {current}",
            );
        }
    }
}

/// RAII guard returned by [`ThreadLock::guard`]. Calls `unlock()` on drop.
///
/// Stores a raw `*const ThreadLock` (not a borrow) so holding the guard does
/// not freeze the borrow of the struct that owns the lock — every call site is
/// `self.field.guard()` inside a `&mut self` method that needs the rest of
/// `self` mutably for the scope.
#[must_use = "dropping immediately unlocks the ThreadLock"]
pub struct ThreadLockGuard(*const ThreadLock);

impl Drop for ThreadLockGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `self.0` was `&ThreadLock` at `ThreadLock::guard()` and the
        // lock is a field of a struct the caller holds for the entire guard
        // scope; the pointee outlives the guard. `unlock` takes `&self`.
        unsafe { (*self.0).unlock() }
    }
}

/// OS thread id for debug-only ownership assertions (`ThreadLock`,
/// `ThreadCell`). `pub(crate)` so `atomic_cell` can reuse it; `#[doc(hidden)]`
/// because it is not part of `bun_core`'s public surface.
#[cfg(debug_assertions)]
#[doc(hidden)]
#[inline]
pub(crate) fn debug_thread_id() -> u64 {
    crate::thread_id::current() as u64
}

#[cfg(debug_assertions)]
#[inline]
fn thread_id() -> u64 {
    crate::thread_id::current() as u64
}
