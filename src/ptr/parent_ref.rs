//! `ParentRef<T>` — non-owning back-pointer from a child/task to its **mortal**
//! owner.
//!
//! See `docs/ub-design-backref-ptr-wrapper.md` for the full design and audit.
//!
//! # Relationship to [`BackRef`](crate::BackRef)
//!
//! [`BackRef<T>`](crate::BackRef) is for **immortal** referents
//! (`JSGlobalObject`, `VirtualMachine`, arena AST nodes) — process-lifetime
//! objects that never die. `ParentRef<T>` is for **mortal** parents that can
//! be dropped while a child/task is still in flight (the bug class this type
//! exists to catch in debug builds).
//!
//! Both project `&T` only via `Deref`. Mutation of parent state goes through
//! interior-mutable fields on `T` (`JsCell`, `Cell`, `Atomic*`, `Mutex`) —
//! never `&mut T`. This makes the Stacked-Borrows story trivial: every access
//! is `SharedReadOnly`, and the parent's mutable cells carry their own
//! `UnsafeCell` provenance.
//!
//! For sites that have been audited to genuinely need exclusive access (e.g.
//! single-threaded event-loop callbacks where no other borrow is live),
//! [`ParentRef::assume_mut`] is the explicit unsafe escape hatch — named so it
//! does not look like a routine accessor.

use core::ptr::NonNull;

// ─────────────────────────────────────────────────────────────────────────────
// ParentRef<T>
// ─────────────────────────────────────────────────────────────────────────────

/// Non-owning back-pointer from a child/task to its mortal owner.
///
/// See the [module docs](self) for the full rationale.
///
/// # Layout
/// `#[repr(transparent)]` over `NonNull<T>`, so
/// `Option<ParentRef<T>>` is pointer-sized (NonNull niche) — bit-identical to
/// the `*mut T` field it replaces, no struct-layout churn.
#[repr(transparent)]
pub struct ParentRef<T: ?Sized> {
    ptr: NonNull<T>,
}

impl<T: ?Sized> ParentRef<T> {
    /// Construct from a shared borrow of the parent. Provenance is
    /// `SharedReadOnly` — correct, because `ParentRef` only ever yields `&T`.
    ///
    /// **Do not** call [`assume_mut`](Self::assume_mut) on the result; the
    /// stored pointer has no write provenance. Use [`from_raw_mut`] for that.
    ///
    /// [`from_raw_mut`]: Self::from_raw_mut
    #[inline]
    pub fn new(parent: &T) -> Self {
        Self {
            ptr: NonNull::from(parent),
        }
    }

    /// Wrap a raw `*const T` (FFI / `container_of` recovery).
    ///
    /// # Safety
    /// `p` must be non-null, properly aligned, and point to a `T` that remains
    /// live and at a stable address for the entire lifetime of every
    /// `ParentRef` copied from the result.
    #[inline]
    pub const unsafe fn from_raw(p: *const T) -> Self {
        Self {
            // SAFETY: caller contract — `p` is non-null.
            ptr: unsafe { NonNull::new_unchecked(p.cast_mut()) },
        }
    }

    /// Wrap a raw `*mut T` with **write provenance** preserved.
    ///
    /// This is the constructor for sites that will later call
    /// [`assume_mut`](Self::assume_mut): the pointer must originate from
    /// `ptr::from_mut` / `&raw mut` / `Box::into_raw` so the stored `NonNull`
    /// retains permission to write.
    ///
    /// # Safety
    /// Same liveness/alignment contract as [`from_raw`](Self::from_raw). The
    /// caller additionally asserts `p` was derived with mutable provenance.
    #[inline]
    pub const unsafe fn from_raw_mut(p: *mut T) -> Self {
        Self {
            // SAFETY: caller contract — `p` is non-null.
            ptr: unsafe { NonNull::new_unchecked(p) },
        }
    }

    /// Convenience: `Some(from_raw_mut(p))` if `p` is non-null, else `None`.
    ///
    /// # Safety
    /// If `p` is non-null, the [`from_raw_mut`](Self::from_raw_mut) contract
    /// applies.
    #[inline]
    pub unsafe fn from_nullable_mut(p: *mut T) -> Option<Self> {
        NonNull::new(p).map(|nn| Self { ptr: nn })
    }

    /// Shared borrow of the parent.
    ///
    /// Sound under the `ParentRef` invariant: the pointee outlives the holder
    /// (by construction or by the caller's `from_raw*` contract). The returned
    /// borrow is tied to `&self` so it cannot outlive the `ParentRef`.
    #[inline]
    pub fn get(&self) -> &T {
        // SAFETY: ParentRef invariant — pointee outlives every copy of `self`;
        // non-null, aligned, dereferenceable. `&T` is `SharedReadOnly`.
        unsafe { self.ptr.as_ref() }
    }

    /// Raw pointer (for `container_of`, FFI round-trip, ptr-eq).
    #[inline]
    pub fn as_ptr(self) -> *const T {
        self.ptr.as_ptr()
    }

    /// Raw pointer with the provenance the `ParentRef` was constructed with.
    /// Only carries write permission if constructed via
    /// [`from_raw_mut`](Self::from_raw_mut) / [`from_nullable_mut`].
    ///
    /// [`from_nullable_mut`]: Self::from_nullable_mut
    #[inline]
    pub fn as_mut_ptr(self) -> *mut T {
        self.ptr.as_ptr()
    }

    /// Explicit *unsafe* exclusive borrow, for the handful of sites that
    /// genuinely need `&mut Parent` and have audited exclusivity (e.g.
    /// single-threaded event-loop callback after all peer borrows retired).
    /// Named `assume_mut` — not `get_mut` — so it does not look like a routine
    /// accessor.
    ///
    /// # Safety
    /// Caller guarantees:
    ///   (a) the parent is live for `'a`,
    ///   (b) **no** other `&` or `&mut` to the parent overlaps the returned
    ///       borrow,
    ///   (c) this `ParentRef` was constructed via [`from_raw_mut`] /
    ///       [`from_nullable_mut`] from a pointer with write provenance —
    ///       **not** via [`new`], which derives from `&T` and gives
    ///       `SharedReadOnly` provenance (writing through that is UB under
    ///       Stacked Borrows regardless of (a)/(b)).
    ///
    /// [`from_raw_mut`]: Self::from_raw_mut
    /// [`from_nullable_mut`]: Self::from_nullable_mut
    /// [`new`]: Self::new
    #[inline]
    pub unsafe fn assume_mut<'a>(self) -> &'a mut T {
        // SAFETY: caller contract (a)+(b)+(c).
        unsafe { &mut *self.ptr.as_ptr() }
    }
}

impl<T: ?Sized> Copy for ParentRef<T> {}
impl<T: ?Sized> Clone for ParentRef<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: ?Sized> core::ops::Deref for ParentRef<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.get()
    }
}

impl<T: ?Sized> From<NonNull<T>> for ParentRef<T> {
    #[inline]
    fn from(p: NonNull<T>) -> Self {
        Self { ptr: p }
    }
}

impl<T: ?Sized> core::fmt::Debug for ParentRef<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "ParentRef({:p})", self.ptr)
    }
}

impl<T: ?Sized> PartialEq for ParentRef<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        core::ptr::addr_eq(self.ptr.as_ptr(), other.ptr.as_ptr())
    }
}
impl<T: ?Sized> Eq for ParentRef<T> {}

// SAFETY: `ParentRef<T>` is morally `&'parent T` (Deref/get only); `assume_mut`
// is `unsafe` and its cross-thread caller must separately establish `T: Send`.
// Match `&T` auto-trait rules: `&T: Send ⇔ T: Sync`, `&T: Sync ⇔ T: Sync`.
unsafe impl<T: ?Sized + Sync> Send for ParentRef<T> {}
// SAFETY: same as the `Send` impl above — `ParentRef<T>` projects only `&T`, so
// sharing `&ParentRef<T>` across threads is sound exactly when `T: Sync`.
unsafe impl<T: ?Sized + Sync> Sync for ParentRef<T> {}

#[cfg(all(test, not(debug_assertions)))]
const _: () = {
    // Release-build layout guarantee: `Option<ParentRef<T>>` is pointer-sized.
    assert!(core::mem::size_of::<Option<ParentRef<u8>>>() == core::mem::size_of::<*mut u8>());
};
