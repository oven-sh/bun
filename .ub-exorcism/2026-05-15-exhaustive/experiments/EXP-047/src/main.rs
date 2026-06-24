//! EXP-047 — `ThreadCell<T>` / `RacyCell<T>` `unsafe impl<T: ?Sized> Sync` unbounded.
//!
//! Production shape (src/bun_core/atomic_cell.rs:503-504 for ThreadCell,
//! src/bun_core/util.rs:2276-2277 for RacyCell):
//!
//!     pub struct RacyCell<T: ?Sized>(UnsafeCell<T>);
//!     unsafe impl<T: ?Sized> Sync for RacyCell<T> {}      // no T: Sync bound
//!
//! ThreadCell ships `assert_owner()` but the assert is debug-build-only and
//! compiles away in release (line 484). RacyCell has zero enforcement.
//! The Bucket 8 sweeper found 100+ instantiations workspace-wide; today none
//! of the in-tree payloads embed a non-`Sync` interior, so the failure mode
//! is invisible — but the type signature says ANY `T` is fine, including a
//! `Cell<U>`.
//!
//! This reproducer makes the gap concrete: a `RacyCell<Cell<u32>>` shared
//! between two threads; the inner `Cell::set` races under Miri's data-race
//! detector. The Sync impl admits the program; the runtime UB happens because
//! `Cell` is `!Sync` for a reason.

use core::cell::{Cell, UnsafeCell};

pub struct RacyCell<T: ?Sized>(UnsafeCell<T>);

// Mirror of the production `unsafe impl<T: ?Sized> Sync for RacyCell<T> {}` —
// note the absence of any `T: Sync` bound.
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}

impl<T> RacyCell<T> {
    pub const fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }
    /// Mirror of the production accessor pattern that hands out a raw `*mut T`
    /// to a `RacyCell<T>`'s interior on the assumption that the caller knows
    /// what they are doing (the assumption the unbounded Sync bound makes
    /// silent).
    pub fn get(&self) -> *mut T {
        self.0.get()
    }
}

fn main() {
    // The instantiation that the unbounded Sync impl admits but should not:
    // T = Cell<u32>, which is !Sync. With a proper `T: Sync` bound, this
    // `&'static RacyCell<Cell<u32>>` would fail to send across threads.
    let rc: &'static RacyCell<Cell<u32>> =
        Box::leak(Box::new(RacyCell::new(Cell::new(0))));

    let handle = std::thread::spawn(move || {
        // SAFETY: nothing — the RacyCell hands out raw access on the assumption
        // that callers single-thread it. This is precisely the contract the
        // unbounded Sync impl quietly removes from the type system.
        let inner: &Cell<u32> = unsafe { &*rc.get() };
        for _ in 0..1000 {
            inner.set(inner.get().wrapping_add(1));
        }
    });

    let inner: &Cell<u32> = unsafe { &*rc.get() };
    for _ in 0..1000 {
        inner.set(inner.get().wrapping_add(1));
    }

    handle.join().unwrap();
    core::hint::black_box(inner.get());
}
