//! [`AtomicCell<T>`] and [`ThreadCell<T>`] — the two named replacements for
//! [`RacyCell`](crate::RacyCell) when state crosses (or is asserted *not* to
//! cross) a thread boundary.
//!
//! `RacyCell` is overloaded for three unrelated invariants. This module splits two of them
//! into types the compiler / debug build can check:
//!
//! | Invariant                                      | Type                  |
//! | ---------------------------------------------- | --------------------- |
//! | one-byte `Copy` enum, read+written from ≥2 threads | [`AtomicCell<T>`] |
//! | thread-confined scratch (HTTP-thread-only buffer, resolver watermark) | [`ThreadCell<T>`] |
//! | init-once-then-read-only                       | `std::sync::OnceLock` |
//!
//! After migration, `RacyCell` should remain only for FFI-shaped `.bss`
//! symbols where Rust never reads the bytes itself.
//!
//! See `docs/PORTING.md` §Global mutable state.

use core::cell::UnsafeCell;
use core::marker::PhantomData;
#[cfg(debug_assertions)]
use core::sync::atomic::AtomicU64;
use core::sync::atomic::{AtomicU8, Ordering};

use crate::{NoUninit, bytes_of};

// ═══════════════════════════════════════════════════════════════════════════
// AtomicCell<T>
// ═══════════════════════════════════════════════════════════════════════════

/// This is the cross-thread counterpart to [`RacyCell`](crate::RacyCell):
/// where `RacyCell` documents "single-threaded by construction", `AtomicCell`
/// documents "actually shared; every load/store is an atomic op with
/// Acquire/Release ordering". Use this for one-byte enums that several threads touch.
///
/// Default ordering is **Acquire/Release**, not Relaxed — at least six of the
/// data-race findings that motivated this type were "Relaxed gives no
/// happens-before for the init it guards".
pub struct AtomicCell<T>(AtomicU8, PhantomData<T>);

impl<T: NoUninit + Send> AtomicCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        const { assert!(size_of::<T>() == 1) };
        Self(AtomicU8::new(bytes_of(&value)[0]), PhantomData)
    }

    /// Acquire load.
    #[inline]
    pub fn load(&self) -> T {
        // SAFETY: a cell comes only from `new`, which rejects a `T` that is not one byte. `new` and
        // `store` are the only writers, and each writes the byte of a valid `T`.
        unsafe { core::mem::transmute_copy(&self.0.load(Ordering::Acquire)) }
    }

    /// Release store.
    #[inline]
    pub fn store(&self, value: T) {
        self.0.store(bytes_of(&value)[0], Ordering::Release);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ThreadCell<T>
// ═══════════════════════════════════════════════════════════════════════════

/// `RacyCell<T>` + a debug-only owner latch.
///
/// For state whose `// SAFETY:` comment says "HTTP-thread-only" /
/// "resolver-thread-only" / "single watcher thread" and that claim is
/// **load-bearing but unchecked**. `ThreadCell` converts the comment into a
/// checked invariant: once [`claim`](Self::claim) is called from the owning
/// thread, every subsequent [`get`](Self::get) on a different thread panics
/// in debug builds. Release builds compile the latch away — `ThreadCell<T>`
/// has the same layout as `RacyCell<T>`.
///
/// This is the worker-thread sibling of `JsCell<T>` (which is JS-thread-
/// affine and additionally documents reentrancy as the hazard).
///
/// **Migration note:** until [`claim`](Self::claim) is called, `get()` does
/// *not* assert (matching `RacyCell`). This lets a static be initialized on
/// the spawning thread, then claimed from the worker thread's entry point.
/// Existing `RacyCell` sites can swap to `ThreadCell` as a drop-in first
/// step, then add `claim()` once cross-thread callers are routed away.
#[repr(C)]
pub struct ThreadCell<T: ?Sized> {
    #[cfg(debug_assertions)]
    owner: AtomicU64,
    inner: UnsafeCell<T>,
}

// SAFETY: same lie as `RacyCell` (caller promises thread-affinity), now
// *checked* in debug via `owner`.
unsafe impl<T: ?Sized> Sync for ThreadCell<T> {}

#[cfg(debug_assertions)]
const UNCLAIMED: u64 = 0;

impl<T> ThreadCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self {
            #[cfg(debug_assertions)]
            owner: AtomicU64::new(UNCLAIMED),
            inner: UnsafeCell::new(value),
        }
    }
}

impl<T: ?Sized> ThreadCell<T> {
    /// Bind this cell to the calling thread. Idempotent on the owner; panics
    /// if a *different* thread has already claimed it. Call once from the
    /// owning thread's entry point (e.g. `HTTPThread::on_start`,
    /// `IoRequestLoop::on_spawn_io_thread`).
    #[inline]
    pub fn claim(&self) {
        #[cfg(debug_assertions)]
        {
            let me = crate::util::debug_thread_id();
            match self
                .owner
                .compare_exchange(UNCLAIMED, me, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => {}
                Err(prev) if prev == me => {}
                Err(prev) => {
                    panic!("ThreadCell: thread {me} tried to claim, already owned by thread {prev}")
                }
            }
        }
    }

    /// Debug-panic if the cell is claimed by a different thread.
    #[inline]
    pub(crate) fn assert_owner(&self) {
        #[cfg(debug_assertions)]
        {
            let owner = self.owner.load(Ordering::Acquire);
            if owner != UNCLAIMED {
                let me = crate::util::debug_thread_id();
                assert!(
                    owner == me,
                    "ThreadCell: accessed from thread {me}, owned by thread {owner}"
                );
            }
        }
    }

    /// Raw pointer to the contained value (debug-asserts owner if claimed).
    /// Mirrors [`RacyCell::get`](crate::RacyCell::get) — callers stay in
    /// raw-ptr land and deref per-access.
    #[inline]
    pub fn get(&self) -> *mut T {
        self.assert_owner();
        self.inner.get()
    }

    /// Raw pointer **without** the owner assertion. Use only on paths that
    /// touch fields which are *themselves* cross-thread-safe (lock-free
    /// queue + waker), pending a refactor that moves those fields out of the
    /// thread-confined struct. Every call site must say which fields it
    /// touches and why that's sound.
    #[inline]
    pub fn get_unchecked(&self) -> *mut T {
        self.inner.get()
    }
}

impl<T: Default> Default for ThreadCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_cell_bool() {
        let c = AtomicCell::new(false);
        assert!(!c.load());
        c.store(true);
        assert!(c.load());
    }
}
