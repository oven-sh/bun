//! [`ReentrantCell<T>`] — a `RefCell`-shaped cell whose borrow checks run in
//! **release** builds.
//!
//! The runtime mints `&mut T` from shared handles (`&mut *this`,
//! `(*vm).field`, `UnsafeCell::get()`) on the JS thread for short, non-`Copy`
//! borrows that never cross a call into JavaScript. Those sites need a cell
//! that hands out `&mut T` safely: closure-scoped so the borrow cannot escape,
//! and flag-checked so an unexpected re-entry becomes a deterministic panic at
//! the exact overlap point instead of undefined behavior.
//!
//! `JsCell<T>` (`src/jsc/JSCell.rs`) does **not** qualify — its `with_mut` has
//! no borrow tracking and its safe `get()` can alias a live `with_mut` borrow.
//! Do not copy it.

use core::cell::{Cell, UnsafeCell};
use core::marker::PhantomData;

/// A single-threaded interior-mutability cell with a borrow flag that is
/// checked in **release** builds.
///
/// Semantically a `RefCell<T>` restricted to closure-scoped access:
///
/// - [`with`](Self::with) hands out `&T`; any number may be nested.
/// - [`with_mut`](Self::with_mut) hands out `&mut T`; it must be the only
///   live borrow.
/// - Overlap **panics** — in release builds too. A debug-only assertion would
///   be a test, not a guarantee; the point of this type is that no combination
///   of safe calls can cause undefined behavior in a release build.
/// - There is **no safe `get(&self) -> &T`**. A returned reference could be
///   held across a later `with_mut` and the flag could not see it. Access is
///   closure-scoped only; the borrow cannot escape the closure:
///
/// ```compile_fail
/// use bun_ptr::ReentrantCell;
/// let cell = ReentrantCell::new(String::from("x"));
/// let escaped: &String = cell.with(|s| s);
/// ```
///
/// `!Send + !Sync`: the flag is a plain (non-atomic) [`Cell`], so the cell is
/// pinned to the thread that created it. This is a JS-thread type; cross-thread
/// access goes through the concurrent-task machinery, never through a shared
/// `&ReentrantCell`.
///
/// # Cost
///
/// One counter load + store and one always-predicted branch per access. In a
/// release build [`with`](Self::with)/[`with_mut`](Self::with_mut) and the
/// check inline to a flag load, a `cmp`/`jne` to an out-of-line panic, a store
/// to claim the flag, the closure body, and a store to release the flag. The
/// closure itself compiles away.
pub struct ReentrantCell<T> {
    value: UnsafeCell<T>,
    /// `0` = free, `> 0` = number of live shared (`with`) borrows, `-1` = one
    /// live exclusive (`with_mut`) borrow. Checked in release builds.
    borrow: Cell<isize>,
    /// `*mut ()` is `!Send + !Sync`. The borrow flag is non-atomic and the
    /// value is reached through `UnsafeCell`, so the cell is only sound when
    /// confined to a single thread.
    _not_send: PhantomData<*mut ()>,
}

/// Restores the borrow flag to its pre-claim value when the access scope ends,
/// **including on unwind** — a panicking closure must not leave the cell
/// permanently borrowed for code that catches the panic.
struct BorrowGuard<'a> {
    flag: &'a Cell<isize>,
    prev: isize,
}

impl Drop for BorrowGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.flag.set(self.prev);
    }
}

impl<T> ReentrantCell<T> {
    /// Creates a new cell containing `value`.
    #[inline]
    pub const fn new(value: T) -> Self {
        Self {
            value: UnsafeCell::new(value),
            borrow: Cell::new(0),
            _not_send: PhantomData,
        }
    }

    /// Runs `f` with a shared borrow of the contained value.
    ///
    /// Nested `with` calls are allowed (the flag counts readers).
    ///
    /// # Panics
    ///
    /// Panics — in release builds too — if the value is exclusively borrowed
    /// by an enclosing [`with_mut`](Self::with_mut).
    #[inline]
    #[track_caller]
    pub fn with<R>(&self, f: impl FnOnce(&T) -> R) -> R {
        let b = self.borrow.get();
        if b < 0 {
            panic_already_mutably_borrowed();
        }
        self.borrow.set(b + 1);
        let _guard = BorrowGuard {
            flag: &self.borrow,
            prev: b,
        };
        // SAFETY: the flag was `>= 0`, so no `&mut T` from `with_mut` is live
        // (it would have set the flag to `-1`). The flag is now `> 0` for the
        // duration of `f`, so any re-entrant `with_mut` panics instead of
        // aliasing this `&T`. Callers of `get_unchecked_mut` promise (per its
        // contract) not to overlap with any checked access. The cell is
        // `!Send + !Sync`, so there is no concurrent access.
        f(unsafe { &*self.value.get() })
    }

    /// Runs `f` with an exclusive borrow of the contained value.
    ///
    /// # Panics
    ///
    /// Panics — in release builds too — if the value is already borrowed
    /// (shared or exclusive). This is the intended behavior change relative to
    /// the raw-pointer pattern this type replaces: a latent aliasing bug
    /// becomes a deterministic panic at the exact re-entry point.
    #[inline]
    #[track_caller]
    pub fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        if self.borrow.get() != 0 {
            panic_already_borrowed();
        }
        self.borrow.set(-1);
        let _guard = BorrowGuard {
            flag: &self.borrow,
            prev: 0,
        };
        // SAFETY: the flag was `0`, so no other checked borrow is live. The
        // flag is now `-1` for the duration of `f`, so any re-entrant `with`
        // or `with_mut` panics instead of aliasing this `&mut T`. The borrow
        // is closure-scoped and cannot escape `f`. Callers of
        // `get_unchecked_mut` promise (per its contract) not to overlap with
        // any checked access. The cell is `!Send + !Sync`, so there is no
        // concurrent access.
        f(unsafe { &mut *self.value.get() })
    }

    /// Replaces the contained value with `value`.
    ///
    /// The old value is dropped *after* the borrow flag is released, so a
    /// `Drop` impl that touches this cell does not spuriously panic.
    ///
    /// # Panics
    ///
    /// Panics — in release builds too — if the value is currently borrowed.
    #[inline]
    #[track_caller]
    pub fn set(&self, value: T) {
        let old = self.with_mut(|slot| core::mem::replace(slot, value));
        drop(old);
    }

    /// Takes the contained value, leaving `T::default()` in its place.
    ///
    /// # Panics
    ///
    /// Panics — in release builds too — if the value is currently borrowed.
    #[inline]
    #[track_caller]
    pub fn take(&self) -> T
    where
        T: Default,
    {
        self.with_mut(core::mem::take)
    }

    /// Returns `&mut T` without touching the borrow flag.
    ///
    /// Escape hatch for profiled hot paths where the flag's load + branch is
    /// measurable. Prefer [`with_mut`](Self::with_mut) everywhere else.
    ///
    /// # Safety
    ///
    /// The caller must prove that no other borrow of the contained value —
    /// from [`with`](Self::with), [`with_mut`](Self::with_mut), or another
    /// `get_unchecked_mut` — overlaps the returned `&mut T` for its entire
    /// lifetime. The borrow flag is not consulted and not updated, so checked
    /// accesses cannot detect this borrow.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn get_unchecked_mut(&self) -> &mut T {
        // SAFETY: forwarded to the caller — see the `# Safety` contract above.
        unsafe { &mut *self.value.get() }
    }
}

impl<T: Default> Default for ReentrantCell<T> {
    #[inline]
    fn default() -> Self {
        Self::new(T::default())
    }
}

#[cold]
#[inline(never)]
#[track_caller]
fn panic_already_mutably_borrowed() -> ! {
    panic!("ReentrantCell: already mutably borrowed");
}

#[cold]
#[inline(never)]
#[track_caller]
fn panic_already_borrowed() -> ! {
    panic!("ReentrantCell: already borrowed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_with_reads() {
        let cell = ReentrantCell::new(vec![1, 2, 3]);
        let sum = cell.with(|outer| {
            cell.with(|inner| {
                assert_eq!(outer.as_ptr(), inner.as_ptr());
                outer.iter().sum::<i32>() + inner.len() as i32
            })
        });
        assert_eq!(sum, 9);
        // Both reader claims were released.
        cell.with_mut(|v| v.push(4));
        assert_eq!(cell.with(Vec::len), 4);
    }

    #[test]
    fn sequential_with_mut() {
        let cell = ReentrantCell::new(String::new());
        cell.with_mut(|s| s.push('a'));
        cell.with_mut(|s| s.push('b'));
        assert_eq!(cell.with(String::clone), "ab");
    }

    #[test]
    #[should_panic(expected = "already borrowed")]
    fn with_mut_inside_with_mut_panics() {
        let cell = ReentrantCell::new(0_i32);
        cell.with_mut(|_| {
            cell.with_mut(|_| {});
        });
    }

    #[test]
    #[should_panic(expected = "already borrowed")]
    fn with_mut_inside_with_panics() {
        let cell = ReentrantCell::new(0_i32);
        cell.with(|_| {
            cell.with_mut(|_| {});
        });
    }

    #[test]
    #[should_panic(expected = "already mutably borrowed")]
    fn with_inside_with_mut_panics() {
        let cell = ReentrantCell::new(0_i32);
        cell.with_mut(|_| {
            cell.with(|_| {});
        });
    }

    #[test]
    #[should_panic(expected = "already borrowed")]
    fn set_during_borrow_panics() {
        let cell = ReentrantCell::new(0_i32);
        cell.with(|_| {
            cell.set(1);
        });
    }

    #[test]
    #[should_panic(expected = "already borrowed")]
    fn take_during_borrow_panics() {
        let cell = ReentrantCell::new(0_i32);
        cell.with(|_| {
            cell.take();
        });
    }

    #[test]
    fn set_and_take() {
        let cell = ReentrantCell::new(String::from("old"));
        cell.set(String::from("new"));
        assert_eq!(cell.with(String::clone), "new");
        assert_eq!(cell.take(), "new");
        assert_eq!(cell.with(String::len), 0);
    }

    #[test]
    fn set_drops_old_value_after_releasing_the_flag() {
        use std::rc::{Rc, Weak};
        struct ReenterOnDrop(Weak<ReentrantCell<Option<ReenterOnDrop>>>);
        impl Drop for ReenterOnDrop {
            fn drop(&mut self) {
                if let Some(cell) = self.0.upgrade() {
                    cell.with(|_| {});
                }
            }
        }
        let cell = Rc::new(ReentrantCell::new(None));
        cell.set(Some(ReenterOnDrop(Rc::downgrade(&cell))));
        // Replacing the value drops the old `ReenterOnDrop`, whose `Drop`
        // re-enters the same cell. If `set` dropped it before releasing the
        // flag, this would panic with "already mutably borrowed".
        cell.set(None);
        assert!(cell.with(Option::is_none));
    }

    #[test]
    fn unchecked_escape_hatch() {
        let cell = ReentrantCell::new(vec![1, 2, 3]);
        // SAFETY: no other borrow of the cell overlaps this one — it is
        // dropped at the end of the statement.
        unsafe { cell.get_unchecked_mut() }.push(4);
        assert_eq!(cell.with(Vec::len), 4);
    }

    #[test]
    fn panicking_closure_releases_the_flag() {
        let cell = ReentrantCell::new(0_i32);
        let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            cell.with_mut(|_| panic!("boom"));
        }));
        assert!(caught.is_err());
        // The guard released the exclusive claim during unwinding.
        cell.with_mut(|v| *v = 1);
        assert_eq!(cell.with(|v| *v), 1);
    }

    #[test]
    fn default_is_free() {
        let cell = ReentrantCell::<i32>::default();
        assert_eq!(cell.take(), 0);
    }
}
