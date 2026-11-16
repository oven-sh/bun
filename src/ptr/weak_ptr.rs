use core::cell::Cell;
use core::mem::MaybeUninit;
use core::ptr::NonNull;

use crate::{AnyRefCounted, RefPtr};

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
            .update(|bits| (bits & Self::FINALIZED_BIT) | (n & Self::REF_MASK));
    }

    #[inline]
    pub(crate) fn finalized(&self) -> bool {
        (self.0.get() & Self::FINALIZED_BIT) != 0
    }

    #[inline]
    pub(crate) fn set_finalized(&self, v: bool) {
        if v {
            self.0.update(|bits| bits | Self::FINALIZED_BIT);
        } else {
            self.0.update(|bits| bits & !Self::FINALIZED_BIT);
        }
    }

    fn on_finalize(&self) -> bool {
        debug_assert!(!self.finalized());
        self.set_finalized(true);
        self.reference_count() == 0
    }
}

/// Implemented by types that embed a `WeakPtrData` field and can be weakly
/// referenced via `WeakPtr<T>`.
///
/// The field projection is a trait method (typically implemented via
/// `core::mem::offset_of!`).
///
/// # Safety
/// Only [`destroy`] frees a heap `Self`, and dropping it touches no `WeakPtr<Self>`.
pub unsafe trait HasWeakPtrData {
    /// Return a pointer to the embedded `WeakPtrData` field on `this`.
    ///
    /// # Safety
    /// `this` must point to a live allocation of `Self` (the inner contents
    /// may already be finalized, but the allocation itself must not yet be
    /// freed).
    unsafe fn weak_ptr_data(this: *mut Self) -> *const WeakPtrData;
}

/// `#[ref_count(destroy = …)]` of a type `WeakPtr`s point to: the last of them frees the allocation.
///
/// # Safety
/// `this` is a `Box` allocation, and its last strong reference is gone.
pub unsafe fn destroy<T: HasWeakPtrData>(this: *mut T) {
    // SAFETY: fn contract. `WeakPtrData` has no drop glue, so it outlives `drop_in_place`.
    unsafe {
        core::ptr::drop_in_place(this);
        if (*T::weak_ptr_data(this)).on_finalize() {
            bun_core::heap::destroy(this.cast::<MaybeUninit<T>>());
        }
    }
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

    pub fn new(strong: &RefPtr<T>) -> Self
    where
        T: AnyRefCounted,
    {
        // SAFETY: a strong reference, with the allocation's provenance.
        unsafe { Self::init_ref(strong.as_ptr()) }
    }

    /// Take a weak reference to `this`, incrementing its weak count.
    ///
    /// # Safety
    /// `this` must be non-null and point to a live, not-yet-finalized `T`.
    /// It must carry the provenance of the whole allocation (as produced by
    /// `bun_core::heap::into_raw` / `Box::into_raw`), **not** a reborrow of a
    /// `&mut T` — see the [type-level note](WeakPtr#provenance).
    pub unsafe fn init_ref(this: *mut T) -> Self {
        debug_assert!(!this.is_null());
        // SAFETY: caller contract — `this` points to a live `T`. Projecting
        // straight to the embedded field means no whole-struct `&mut T` is
        // formed, so `this`'s provenance reaches the stored pointer intact.
        let d = unsafe { &*T::weak_ptr_data(this) };
        debug_assert!(!d.finalized());
        d.set_reference_count(d.reference_count() + 1);
        Self {
            // SAFETY: caller contract — `this` is non-null.
            raw_ptr: Some(unsafe { NonNull::new_unchecked(this) }),
        }
    }

    /// The pointee, valid until its last strong reference goes. `None` after that.
    pub fn get(&mut self) -> Option<NonNull<T>> {
        if let Some(value) = self.raw_ptr {
            // SAFETY: allocation is live while any WeakPtr holds it (see above).
            unsafe {
                if !(*T::weak_ptr_data(value.as_ptr())).finalized() {
                    return Some(value);
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
        // SAFETY: caller guarantees `value` points to a live allocation;
        // projecting to the embedded `WeakPtrData` field.
        let weak_data = unsafe { &*T::weak_ptr_data(value.as_ptr()) };
        let count = weak_data.reference_count() - 1;
        weak_data.set_reference_count(count);
        let finalized = weak_data.finalized();
        if finalized && count == 0 {
            // SAFETY: this is the last reference and `destroy` dropped the value,
            // so we hold the only pointer to its `Box` allocation. `weak_data`
            // is dead here, so freeing through `value` disturbs no live borrow.
            unsafe { bun_core::heap::destroy(value.cast::<MaybeUninit<T>>().as_ptr()) };
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
        payload: u32,
        /// Proves the allocation is actually freed rather than merely leaked.
        _heap: Box<u32>,
    }

    impl Drop for Owner {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    // SAFETY: every test ends its `Owner` with `destroy`.
    unsafe impl HasWeakPtrData for Owner {
        unsafe fn weak_ptr_data(this: *mut Self) -> *const WeakPtrData {
            // SAFETY: caller contract — pure field projection, no read.
            unsafe { &raw const (*this).weak }
        }
    }

    fn new_owner(payload: u32) -> *mut Owner {
        bun_core::heap::into_raw(Box::new(Owner {
            weak: WeakPtrData::EMPTY,
            payload,
            _heap: Box::new(payload),
        }))
    }

    fn payload(weak: &mut WeakPtr<Owner>) -> Option<u32> {
        // SAFETY: `get` just reported the value live.
        weak.get().map(|owner| unsafe { owner.as_ref() }.payload)
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
        let raw = new_owner(4);
        // SAFETY: `raw` is a freshly leaked Box; live and not finalized.
        let mut weak = unsafe { WeakPtr::init_ref(raw) };
        assert_eq!(payload(&mut weak), Some(4));

        // SAFETY: `raw` is live, and its owner is done with it.
        unsafe { destroy(raw) };
        assert_eq!(drops(), before + 1);

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
        // SAFETY: `raw` is live, and its owner is done with it.
        unsafe { destroy(raw) };
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
            unsafe { (*raw).payload = i };
            assert_eq!(payload(&mut weak), Some(i));
        }

        drop(weak);
        // SAFETY: `raw` is live, and its owner is done with it.
        unsafe { destroy(raw) };
        assert_eq!(drops(), before + 1);
    }

    #[test]
    fn weak_count_changes_while_the_owner_is_borrowed() {
        fn while_borrowed(owner: &Owner, raw: *mut Owner) -> u32 {
            // SAFETY: `raw` is the pointer of a new box; live and not finalized.
            drop(unsafe { WeakPtr::init_ref(raw) });
            owner.payload
        }
        let _serial = serial();
        let raw = new_owner(3);
        // SAFETY: `raw` is live, and nothing writes outside its cell.
        assert_eq!(while_borrowed(unsafe { &*raw }, raw), 3);
        // SAFETY: `raw` is live, and its owner is done with it.
        unsafe { destroy(raw) };
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
        assert_eq!(unsafe { (*Owner::weak_ptr_data(raw)).reference_count() }, 2);
        assert_eq!(payload(&mut a), Some(2));
        assert_eq!(payload(&mut b), Some(2));

        // SAFETY: `raw` is live, and its owner is done with it.
        unsafe { destroy(raw) };
        assert_eq!(drops(), before + 1);
        drop(a);
        assert!(b.get().is_none());
        assert_eq!(drops(), before + 1);
    }
}
