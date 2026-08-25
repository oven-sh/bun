//! `OwnerCell<O, F>` — a heap value packaged with a dependent that borrows it.
//!
//! For the case Rust cannot spell directly: a long-lived object (an event
//! loop turn outlives the stack frame that would otherwise own both) needs to
//! keep an arena *and* the things allocated from it. The owner lives in its
//! own heap allocation (so its address is stable and no `Box` is retagged
//! while the dependent's borrow is live), the dependent is built from `&'a O`
//! for a lifetime the caller cannot name, and every later access goes through
//! a closure that is generic over that lifetime — so nothing borrowed from the
//! owner can be smuggled out or swapped for a shorter-lived borrow.

use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

/// A type constructor over one lifetime: `Of<'a>` is the dependent type when
/// it borrows the owner for `'a` (e.g. `type Of<'a> = Box<Bundle<'a>>`).
pub trait RefFamily {
    type Of<'a>;
}

/// Owns a heap-allocated `O` and an `F::Of<'_>` that borrows it; drops the
/// dependent first, then the owner.
pub struct OwnerCell<O: 'static, F: RefFamily> {
    /// `'static` is storage only: the borrow is of `*owner`, and the value is
    /// only ever lent out at a lifetime a closure cannot outlive.
    ///
    /// Heap-allocated (a leaked box, freed in `into_owner`/`Drop`) so that
    /// moving the cell never moves the dependent: pointers into it that it
    /// handed out (to other threads, to C++) stay valid.
    dependent: NonNull<F::Of<'static>>,
    /// From `Box::leak`; reclaimed in `into_owner`/`Drop` after the dependent
    /// is gone. Held raw (not as a `Box`) so moving the cell never reasserts
    /// unique ownership over memory the dependent borrows.
    owner: NonNull<O>,
    _owns: PhantomData<(Box<O>, Box<F::Of<'static>>)>,
}

impl<O: 'static, F: RefFamily> OwnerCell<O, F> {
    /// Take `owner` and build the dependent from a borrow of it.
    pub fn try_new<E>(
        owner: Box<O>,
        init: impl for<'a> FnOnce(&'a O) -> Result<F::Of<'a>, E>,
    ) -> Result<Self, E> {
        let owner = NonNull::from(Box::leak(owner));
        // SAFETY: `owner` is a live leaked box, freed only after `dependent`
        // has been dropped (`into_owner`/`Drop`); the dependent is only
        // exposed through `with`/`with_mut`, whose closures are generic over
        // the borrow's lifetime.
        let owner_ref: &'static O = unsafe { owner.as_ref() };
        match init(owner_ref) {
            Ok(dependent) => Ok(Self {
                dependent: NonNull::from(Box::leak(Box::new(dependent))),
                owner,
                _owns: PhantomData,
            }),
            Err(e) => {
                // SAFETY: from `Box::leak` above; `init` kept nothing (it failed).
                drop(unsafe { Box::from_raw(owner.as_ptr()) });
                Err(e)
            }
        }
    }

    pub fn new(owner: Box<O>, init: impl for<'a> FnOnce(&'a O) -> F::Of<'a>) -> Self {
        match Self::try_new::<core::convert::Infallible>(owner, |o| Ok(init(o))) {
            Ok(cell) => cell,
            Err(never) => match never {},
        }
    }

    /// The owner. The dependent holds shared borrows of it too.
    #[inline]
    pub fn owner(&self) -> &O {
        // SAFETY: live until `into_owner`/`Drop`; only ever shared-borrowed.
        unsafe { self.owner.as_ref() }
    }

    #[inline]
    pub fn with<R>(&self, f: impl for<'a, 'b> FnOnce(&'b F::Of<'a>) -> R) -> R {
        // SAFETY: leaked in `try_new`, freed only in `into_owner`/`Drop`.
        f(unsafe { self.dependent.as_ref() })
    }

    #[inline]
    pub fn with_mut<R>(&mut self, f: impl for<'a, 'b> FnOnce(&'b mut F::Of<'a>) -> R) -> R {
        // SAFETY: as `with`; `&mut self` makes the borrow exclusive.
        f(unsafe { self.dependent.as_mut() })
    }

    /// Drop the dependent and take the owner back.
    pub fn into_owner(self) -> Box<O> {
        let this = ManuallyDrop::new(self);
        // SAFETY: both from `Box::leak` in `try_new`; the dependent goes
        // first, and `this` is `ManuallyDrop`, so `Drop` does not run again.
        unsafe {
            drop(Box::from_raw(this.dependent.as_ptr()));
            Box::from_raw(this.owner.as_ptr())
        }
    }
}

impl<O: 'static, F: RefFamily> Drop for OwnerCell<O, F> {
    fn drop(&mut self) {
        // SAFETY: both from `Box::leak` in `try_new`; the dependent (which
        // borrows the owner) goes first.
        unsafe {
            drop(Box::from_raw(self.dependent.as_ptr()));
            drop(Box::from_raw(self.owner.as_ptr()));
        }
    }
}
