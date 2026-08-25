use core::cell::Cell;
use core::ptr::NonNull;

/// Bit layout:
///   bits 0..=30 → reference_count
///   bit  31     → finalized
#[repr(transparent)]
pub struct WeakPtrData(Cell<u32>);

impl WeakPtrData {
    pub const EMPTY: Self = Self(Cell::new(0)); // reference_count = 0, finalized = false

    const REF_MASK: u32 = 0x7FFF_FFFF; // low 31 bits
    const FINALIZED_BIT: u32 = 0x8000_0000; // bit 31

    #[inline]
    pub(crate) fn reference_count(&self) -> u32 {
        self.0.get() & Self::REF_MASK
    }

    #[inline]
    pub(crate) fn set_reference_count(&self, n: u32) {
        debug_assert!(n <= Self::REF_MASK);
        self.0
            .set((self.0.get() & Self::FINALIZED_BIT) | (n & Self::REF_MASK));
    }

    #[inline]
    pub(crate) fn finalized(&self) -> bool {
        (self.0.get() & Self::FINALIZED_BIT) != 0
    }

    #[inline]
    pub(crate) fn set_finalized(&self, v: bool) {
        if v {
            self.0.set(self.0.get() | Self::FINALIZED_BIT);
        } else {
            self.0.set(self.0.get() & !Self::FINALIZED_BIT);
        }
    }

    pub fn on_finalize(&self) -> bool {
        debug_assert!(!self.finalized());
        self.set_finalized(true);
        self.reference_count() == 0
    }
}

impl Default for WeakPtrData {
    fn default() -> Self {
        Self::EMPTY
    }
}

/// Implemented by types that embed a `WeakPtrData` field and can be weakly
/// referenced via `WeakPtr<T>`.
///
/// The owner of such a value gives it up through [`finalize_owner`] (or, for an
/// intrusively refcounted value, [`destroy_weakly_held`] as its
/// `CellRefCounted::destroy`), which frees the allocation only once no
/// `WeakPtr` holds it.
pub trait HasWeakPtrData {
    /// The embedded `WeakPtrData` field.
    fn weak_ptr_data(&self) -> &WeakPtrData;

    /// The owner is done with the value but a `WeakPtr` still holds its
    /// allocation: release what the value owns, leaving it valid (its later
    /// drop must be a no-op release) until the last `WeakPtr` frees it.
    fn finalize_contents(&self);
}

/// The owner's release of a weakly-referenceable value. Frees `owner` now if
/// no [`WeakPtr`] holds it; otherwise marks it finalized, runs
/// [`HasWeakPtrData::finalize_contents`], and leaves the allocation to the last
/// `WeakPtr` (whose [`get`](WeakPtr::get) reads `None` from here on).
pub fn finalize_owner<T: HasWeakPtrData>(owner: Box<T>) {
    let this = Box::into_raw(owner);
    // SAFETY: `this` was just leaked from the `Box` we own; live and non-null.
    let value = unsafe { &*this };
    if value.weak_ptr_data().on_finalize() {
        // SAFETY: no `WeakPtr` holds the allocation, so we are its sole owner.
        drop(unsafe { Box::from_raw(this) });
    } else {
        value.finalize_contents();
    }
}

/// [`finalize_owner`] for an intrusively refcounted `T` whose count reached
/// zero — the shape `#[ref_count(destroy = …)]` takes.
///
/// # Safety
/// `this` is the sole live owner of a `Box`-allocated `T` (the
/// `CellRefCounted::destroy` contract).
pub unsafe fn destroy_weakly_held<T: HasWeakPtrData>(this: *mut T) {
    // SAFETY: fn contract.
    finalize_owner(unsafe { Box::from_raw(this) });
}

/// Allow a type to be weakly referenced. This keeps a reference count of how
/// many weak-references exist, so that when the object is destroyed, the inner
/// contents can be freed, but the object itself is not destroyed until all
/// `WeakPtr`s are released. Even if the allocation is present, `WeakPtr<T>::get`
/// will return `None` after the inner contents are freed.
///
/// # Provenance
/// A `WeakPtr` is a **shared** handle: the owner keeps using the object through
/// its own pointer, and several `WeakPtr`s may coexist. The stored pointer must
/// therefore carry the allocation's own provenance (`Box::into_raw` /
/// `heap::into_raw`), which is why [`init_ref`](Self::init_ref) takes `*mut T`
/// rather than `&mut T`. Deriving it from a `&mut T` reborrow instead makes the
/// next write through any *other* pointer to the object a foreign write that
/// invalidates the handle, so every later `get` or drop is UB. This mirrors
/// [`ThisPtr::new`](crate::ThisPtr::new) and
/// [`ParentRef::from_raw_mut`](crate::ParentRef::from_raw_mut).
pub struct WeakPtr<T: HasWeakPtrData> {
    raw_ptr: Option<NonNull<T>>,
}

impl<T: HasWeakPtrData> WeakPtr<T> {
    pub const EMPTY: Self = Self { raw_ptr: None };

    /// Take a weak reference to `this`, incrementing its weak count.
    ///
    /// # Safety
    /// `this` must be non-null and point to a live, not-yet-finalized,
    /// `Box`-allocated `T` whose owner releases it only through
    /// [`finalize_owner`] / [`destroy_weakly_held`]. It must carry the
    /// provenance of the whole allocation (as produced by
    /// `bun_core::heap::into_raw` / `Box::into_raw`), **not** a reborrow of a
    /// `&mut T` — see the [type-level note](WeakPtr#provenance).
    pub unsafe fn init_ref(this: *mut T) -> Self {
        debug_assert!(!this.is_null());
        // SAFETY: caller contract — `this` points to a live `T`.
        let d = unsafe { &*this }.weak_ptr_data();
        debug_assert!(!d.finalized());
        d.set_reference_count(d.reference_count() + 1);
        Self {
            // SAFETY: caller contract — `this` is non-null.
            raw_ptr: Some(unsafe { NonNull::new_unchecked(this) }),
        }
    }

    /// Borrow the pointee, or `None` once the owner has finalized it (which
    /// also releases this handle's weak ref).
    ///
    /// The returned `&mut T` is a fresh reborrow of the allocation pointer, so
    /// it must not overlap any other borrow of the same object — including one
    /// handed out by a second `WeakPtr`. Finish with it before the next `get`.
    pub fn get(&mut self) -> Option<&mut T> {
        if let Some(value) = self.raw_ptr {
            // SAFETY: allocation is live while any WeakPtr holds it (see above).
            unsafe {
                if !value.as_ref().weak_ptr_data().finalized() {
                    return Some(&mut *value.as_ptr());
                }
                self.deref_internal(value);
            }
        }
        None
    }

    /// # Safety
    /// `value` must equal `self.raw_ptr.unwrap()` and point to a live
    /// allocation whose embedded `WeakPtrData` has `reference_count > 0`.
    unsafe fn deref_internal(&mut self, value: NonNull<T>) {
        self.raw_ptr = None;
        let (count, finalized) = {
            // SAFETY: caller guarantees `value` points to a live allocation.
            let weak_data = unsafe { value.as_ref() }.weak_ptr_data();
            let count = weak_data.reference_count() - 1;
            weak_data.set_reference_count(count);
            (count, weak_data.finalized())
        };
        if finalized && count == 0 {
            // The allocation came from `heap::alloc` (via `Box::new`).
            // SAFETY: this is the last reference and the owner has finalized,
            // so we hold the only pointer to a `Box`-allocated `T`. No borrow of
            // it is live here, so freeing through `value` disturbs nothing.
            drop(unsafe { bun_core::heap::take(value.as_ptr()) });
        }
    }
}

impl<T: HasWeakPtrData> Drop for WeakPtr<T> {
    fn drop(&mut self) {
        if let Some(value) = self.raw_ptr {
            // SAFETY: `raw_ptr` was set by `init_ref` and not yet released;
            // the allocation outlives all `WeakPtr`s by construction.
            unsafe { self.deref_internal(value) };
        }
    }
}

impl<T: HasWeakPtrData> Default for WeakPtr<T> {
    fn default() -> Self {
        Self::EMPTY
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, MutexGuard, PoisonError};

    static DROPS: AtomicUsize = AtomicUsize::new(0);
    static FINALIZED_CONTENTS: AtomicUsize = AtomicUsize::new(0);

    /// `DROPS` is process-wide but libtest runs `#[test]`s on parallel threads,
    /// so every test asserting on it holds this for its duration.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn drops() -> usize {
        DROPS.load(Ordering::SeqCst)
    }

    struct Owner {
        weak: WeakPtrData,
        /// Inline (not behind a `Box`) so writing it is a write into the
        /// `Owner` allocation itself — the access a stale handle trips on.
        payload: Cell<u32>,
        /// Proves the allocation is actually freed rather than merely leaked.
        _heap: Box<u32>,
    }

    impl Drop for Owner {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl HasWeakPtrData for Owner {
        fn weak_ptr_data(&self) -> &WeakPtrData {
            &self.weak
        }
        fn finalize_contents(&self) {
            FINALIZED_CONTENTS.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn new_owner(payload: u32) -> *mut Owner {
        bun_core::heap::into_raw(Box::new(Owner {
            weak: WeakPtrData::EMPTY,
            payload: Cell::new(payload),
            _heap: Box::new(payload),
        }))
    }

    #[test]
    fn bit_layout() {
        let d = WeakPtrData::EMPTY;
        assert_eq!(d.reference_count(), 0);
        assert!(!d.finalized());

        d.set_reference_count(5);
        assert_eq!(d.reference_count(), 5);
        assert!(!d.finalized());

        d.set_finalized(true);
        assert!(d.finalized());
        // Setting the count must not clobber the finalized bit, and vice versa.
        assert_eq!(d.reference_count(), 5);
        d.set_reference_count(WeakPtrData::REF_MASK);
        assert_eq!(d.reference_count(), WeakPtrData::REF_MASK);
        assert!(d.finalized());

        d.set_finalized(false);
        assert_eq!(d.reference_count(), WeakPtrData::REF_MASK);
    }

    #[test]
    fn on_finalize_reports_last_ref() {
        let d = WeakPtrData::EMPTY;
        assert!(d.on_finalize());

        let d = WeakPtrData::EMPTY;
        d.set_reference_count(1);
        assert!(!d.on_finalize());
    }

    /// Finalizing with a live `WeakPtr` keeps the allocation; the last
    /// `deref` frees it.
    #[test]
    fn weak_ptr_outlives_finalize_then_frees() {
        let _serial = serial();
        let before = drops();
        let finalized_before = FINALIZED_CONTENTS.load(Ordering::SeqCst);
        let raw = new_owner(4);
        // SAFETY: `raw` is a freshly leaked Box; live and not finalized.
        let mut weak = unsafe { WeakPtr::init_ref(raw) };
        assert_eq!(weak.get().map(|o| o.payload.get()), Some(4));

        // Owner finalizes its contents: not the last ref, so the allocation stays.
        // SAFETY: `raw` is the live Box we leaked above.
        finalize_owner(unsafe { Box::from_raw(raw) });
        assert_eq!(drops(), before);
        assert_eq!(
            FINALIZED_CONTENTS.load(Ordering::SeqCst),
            finalized_before + 1
        );

        // `get` on a finalized owner releases the ref and reports `None`, which
        // is the last ref, so `deref_internal` frees the allocation.
        assert!(weak.get().is_none());
        assert_eq!(drops(), before + 1);
        // The handle is now empty: a second `get` or the drop must be a no-op.
        assert!(weak.get().is_none());
        drop(weak);
    }

    /// Dropping before finalize leaves the allocation to the owner.
    #[test]
    fn weak_ptr_drop_before_finalize_leaves_owner_in_charge() {
        let _serial = serial();
        let before = drops();
        let raw = new_owner(6);
        // SAFETY: `raw` is a freshly leaked Box; live and not finalized.
        let weak = unsafe { WeakPtr::init_ref(raw) };
        drop(weak);
        assert_eq!(drops(), before);
        // SAFETY: no weak refs remain; the owner frees its own allocation.
        finalize_owner(unsafe { Box::from_raw(raw) });
        assert_eq!(drops(), before + 1);
    }

    /// The owner keeps mutating the object through its own pointer while the
    /// handle is live — the shape every in-tree caller has (`RequestContext`
    /// holds a `WeakPtr<Request>` while JS mutates the `Request`). A handle
    /// built from a `&mut T` reborrow is invalidated by that foreign write.
    #[test]
    fn weak_ptr_survives_owner_writes_through_its_own_pointer() {
        let _serial = serial();
        let before = drops();
        let raw = new_owner(1);
        // SAFETY: `raw` is a freshly leaked Box; live and not finalized.
        let mut weak = unsafe { WeakPtr::init_ref(raw) };

        for i in 2..5u32 {
            // SAFETY: `raw` is live; the owner writes through its own pointer.
            // This is a foreign write for any handle built from a reborrow.
            unsafe { (*raw).payload.set(i) };
            assert_eq!(weak.get().map(|o| o.payload.get()), Some(i));
        }

        drop(weak);
        // SAFETY: no weak refs remain.
        drop(unsafe { bun_core::heap::take(raw) });
        assert_eq!(drops(), before + 1);
    }

    /// Several weak refs: only the one that takes the count to zero *after*
    /// finalize frees the allocation. Creating the second handle writes the
    /// weak count, which must not invalidate the first.
    #[test]
    fn weak_ptr_many_refs_last_one_frees() {
        let _serial = serial();
        let before = drops();
        let raw = new_owner(2);
        // SAFETY: `raw` is a freshly leaked Box; live and not finalized.
        let mut a = unsafe { WeakPtr::init_ref(raw) };
        // SAFETY: see above.
        let mut b = unsafe { WeakPtr::init_ref(raw) };
        // SAFETY: `raw` is live.
        assert_eq!(unsafe { &*raw }.weak_ptr_data().reference_count(), 2);
        assert_eq!(a.get().map(|o| o.payload.get()), Some(2));
        assert_eq!(b.get().map(|o| o.payload.get()), Some(2));

        // SAFETY: `raw` is the live Box leaked above.
        finalize_owner(unsafe { Box::from_raw(raw) });
        drop(a);
        assert_eq!(drops(), before);
        drop(b);
        assert_eq!(drops(), before + 1);
    }
}
