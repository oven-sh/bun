//! `ParentRef<T>` — non-owning back-pointer from a child/task to its **mortal**
//! owner, with debug-only liveness checking.
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

#[cfg(debug_assertions)]
use core::sync::atomic::{AtomicU64, Ordering};

// ─────────────────────────────────────────────────────────────────────────────
// LiveMarker / Anchored
// ─────────────────────────────────────────────────────────────────────────────

/// Zero-cost-in-release liveness sentinel embedded in a parent struct.
///
/// Debug: `AtomicU64` initialised from a process-global counter; `Drop` poisons
/// it to [`DEAD`](Self::DEAD). Release: ZST (no field, no `Drop`).
///
/// Embed this in any struct that hands out [`ParentRef::anchored`] copies of
/// itself, then `#[derive(Anchored)]` (re-exported from `bun_ptr`) so the
/// derive can locate the field. Every `ParentRef::get()` / `Deref` then
/// debug-asserts that the parent's marker still matches the snapshot taken at
/// construction — catching use-after-parent-drop and ABA-reallocation at the
/// deref site instead of the eventual segfault.
///
/// `AtomicU64` (not `Cell<u64>`) so the marker is `Send + Sync` and embedding
/// it does not poison the parent's auto-traits, and so the cross-thread
/// `ParentRef::get()` debug-check is itself race-free.
pub struct LiveMarker {
    #[cfg(debug_assertions)]
    generation: AtomicU64,
}

impl LiveMarker {
    /// Generation value written on `Drop`. Never produced by [`next_gen`].
    pub const DEAD: u64 = 0;

    /// Fresh marker with a unique non-zero generation (debug) / ZST (release).
    #[inline]
    pub fn new() -> Self {
        #[cfg(debug_assertions)]
        {
            Self {
                generation: AtomicU64::new(next_gen()),
            }
        }
        #[cfg(not(debug_assertions))]
        {
            Self {}
        }
    }

    /// Current generation. Release builds return a fixed non-zero value so
    /// callers that branch on `!= DEAD` see "live".
    #[inline]
    pub fn generation(&self) -> u64 {
        #[cfg(debug_assertions)]
        {
            self.generation.load(Ordering::Relaxed)
        }
        #[cfg(not(debug_assertions))]
        {
            1
        }
    }

    /// Debug-asserts `self.generation() == expected`. No-op in release.
    #[inline]
    pub fn assert_live(&self, expected: u64) {
        #[cfg(debug_assertions)]
        {
            let live = self.generation.load(Ordering::Relaxed);
            debug_assert_eq!(
                live, expected,
                "ParentRef: use-after-parent-drop (marker={live:#x}, expected={expected:#x})",
            );
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = expected;
        }
    }
}

impl Default for LiveMarker {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(debug_assertions)]
impl Drop for LiveMarker {
    #[inline]
    fn drop(&mut self) {
        self.generation.store(Self::DEAD, Ordering::Relaxed);
    }
}

/// Process-global generation counter. Starts at 1 so `0` is reserved for
/// [`LiveMarker::DEAD`] / "unchecked".
#[cfg(debug_assertions)]
#[inline]
fn next_gen() -> u64 {
    static GEN: AtomicU64 = AtomicU64::new(1);
    GEN.fetch_add(1, Ordering::Relaxed)
}

/// Implemented (usually via `#[derive(Anchored)]`) by any struct that embeds a
/// [`LiveMarker`] field. Gives [`ParentRef::anchored`] something to read.
pub trait Anchored {
    fn live_marker(&self) -> &LiveMarker;
}

// ─────────────────────────────────────────────────────────────────────────────
// ParentRef<T>
// ─────────────────────────────────────────────────────────────────────────────

/// Non-owning back-pointer from a child/task to its mortal owner.
///
/// See the [module docs](self) for the full rationale.
///
/// # Layout
/// `#[repr(transparent)]` over `NonNull<T>` in release, so
/// `Option<ParentRef<T>>` is pointer-sized (NonNull niche) — bit-identical to
/// the `*mut T` field it replaces, no struct-layout churn. In debug builds the
/// generation snapshot adds 16 bytes.
#[cfg_attr(not(debug_assertions), repr(transparent))]
pub struct ParentRef<T: ?Sized> {
    ptr: NonNull<T>,
    /// Snapshot of `parent.live_marker().generation()` at construction.
    /// `0` = unchecked (constructed via `new` / `from_raw*` on a non-`Anchored`
    /// parent, or `marker` is null).
    #[cfg(debug_assertions)]
    generation: u64,
    /// Raw pointer to the parent's embedded `LiveMarker.generation` atomic. Stored
    /// separately (not projected through `T: Anchored` on every `get()`) so
    /// `Deref` works without an `Anchored` bound. `None` = unchecked.
    #[cfg(debug_assertions)]
    marker: Option<NonNull<AtomicU64>>,
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
            #[cfg(debug_assertions)]
            generation: 0,
            #[cfg(debug_assertions)]
            marker: None,
        }
    }

    /// Construct and capture the parent's live-generation. Prefer this over
    /// [`new`](Self::new) for any parent with a finite lifetime (i.e. almost
    /// all of them) so use-after-drop is caught in debug builds.
    ///
    /// Same `SharedReadOnly` provenance caveat as [`new`](Self::new).
    #[inline]
    pub fn anchored(parent: &T) -> Self
    where
        T: Anchored,
    {
        #[cfg(debug_assertions)]
        {
            let marker = parent.live_marker();
            Self {
                ptr: NonNull::from(parent),
                generation: marker.generation(),
                marker: Some(NonNull::from(&marker.generation)),
            }
        }
        #[cfg(not(debug_assertions))]
        {
            Self {
                ptr: NonNull::from(parent),
            }
        }
    }

    /// Wrap a raw `*const T` (FFI / `container_of` recovery).
    ///
    /// # Safety
    /// `p` must be non-null, properly aligned, and point to a `T` that remains
    /// live and at a stable address for the entire lifetime of every
    /// `ParentRef` copied from the result. No generation check is installed.
    #[inline]
    pub const unsafe fn from_raw(p: *const T) -> Self {
        Self {
            // SAFETY: caller contract — `p` is non-null.
            ptr: unsafe { NonNull::new_unchecked(p as *mut T) },
            #[cfg(debug_assertions)]
            generation: 0,
            #[cfg(debug_assertions)]
            marker: None,
        }
    }

    /// Wrap a raw `*mut T` with **write provenance** preserved (Zig `*T`).
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
            #[cfg(debug_assertions)]
            generation: 0,
            #[cfg(debug_assertions)]
            marker: None,
        }
    }

    /// Convenience: `Some(from_raw_mut(p))` if `p` is non-null, else `None`.
    ///
    /// # Safety
    /// If `p` is non-null, the [`from_raw_mut`](Self::from_raw_mut) contract
    /// applies.
    #[inline]
    pub unsafe fn from_nullable_mut(p: *mut T) -> Option<Self> {
        NonNull::new(p).map(|nn| Self {
            ptr: nn,
            #[cfg(debug_assertions)]
            generation: 0,
            #[cfg(debug_assertions)]
            marker: None,
        })
    }

    /// Debug-only liveness assertion for anchored refs. Single `unsafe` deref
    /// site for the set-once `marker: Option<NonNull<AtomicU64>>` field, shared
    /// by [`get`](Self::get) and [`assume_mut`](Self::assume_mut).
    #[cfg(debug_assertions)]
    #[inline]
    fn debug_assert_live(&self) {
        if let Some(m) = self.marker {
            // SAFETY: best-effort debug check. `m` points into the parent's
            // `LiveMarker`; if the parent has been dropped-in-place this reads
            // `DEAD` (assert fires). If the allocation was freed this is
            // technically a wild read — acceptable for a debug-only sanitizer
            // (it will read garbage that almost certainly ≠ `generation`, or fault).
            let live = unsafe { m.as_ref() }.load(Ordering::Relaxed);
            debug_assert_eq!(
                live,
                self.generation,
                "ParentRef<{}>: use-after-parent-drop (live={live:#x}, snap={:#x})",
                core::any::type_name::<T>(),
                self.generation,
            );
        }
    }

    /// Shared borrow of the parent. **Debug-asserts** liveness if anchored.
    ///
    /// Sound under the `ParentRef` invariant: the pointee outlives the holder
    /// (by construction or by the caller's `from_raw*` contract). The returned
    /// borrow is tied to `&self` so it cannot outlive the `ParentRef`.
    #[inline]
    pub fn get(&self) -> &T {
        #[cfg(debug_assertions)]
        self.debug_assert_live();
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
    ///       **not** via [`new`] / [`anchored`], which derive from `&T` and
    ///       give `SharedReadOnly` provenance (writing through that is UB
    ///       under Stacked Borrows regardless of (a)/(b)).
    ///
    /// [`from_raw_mut`]: Self::from_raw_mut
    /// [`from_nullable_mut`]: Self::from_nullable_mut
    /// [`new`]: Self::new
    /// [`anchored`]: Self::anchored
    #[inline]
    pub unsafe fn assume_mut<'a>(self) -> &'a mut T {
        #[cfg(debug_assertions)]
        self.debug_assert_live();
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
        Self {
            ptr: p,
            #[cfg(debug_assertions)]
            generation: 0,
            #[cfg(debug_assertions)]
            marker: None,
        }
    }
}

impl<T: ?Sized> core::fmt::Debug for ParentRef<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        #[cfg(debug_assertions)]
        {
            write!(
                f,
                "ParentRef({:p}, generation={:#x})",
                self.ptr, self.generation
            )
        }
        #[cfg(not(debug_assertions))]
        {
            write!(f, "ParentRef({:p})", self.ptr)
        }
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
// The debug-only `marker: Option<NonNull<AtomicU64>>` is `Sync`-safe (atomic).
unsafe impl<T: ?Sized + Sync> Send for ParentRef<T> {}
unsafe impl<T: ?Sized + Sync> Sync for ParentRef<T> {}

#[cfg(all(test, not(debug_assertions)))]
const _: () = {
    // Release-build layout guarantee: `Option<ParentRef<T>>` is pointer-sized.
    assert!(core::mem::size_of::<Option<ParentRef<u8>>>() == core::mem::size_of::<*mut u8>());
};
