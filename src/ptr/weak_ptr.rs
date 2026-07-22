use core::ptr::NonNull;

/// Bit layout:
///   bits 0..=30 → reference_count
///   bit  31     → finalized
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct WeakPtrData(u32);

impl WeakPtrData {
    pub const EMPTY: Self = Self(0); // reference_count = 0, finalized = false

    const REF_MASK: u32 = 0x7FFF_FFFF; // low 31 bits
    const FINALIZED_BIT: u32 = 0x8000_0000; // bit 31

    #[inline]
    fn reference_count(self) -> u32 {
        self.0 & Self::REF_MASK
    }

    #[inline]
    fn set_reference_count(&mut self, n: u32) {
        debug_assert!(n <= Self::REF_MASK);
        self.0 = (self.0 & Self::FINALIZED_BIT) | (n & Self::REF_MASK);
    }

    #[inline]
    fn finalized(self) -> bool {
        (self.0 & Self::FINALIZED_BIT) != 0
    }

    #[inline]
    fn set_finalized(&mut self, v: bool) {
        if v {
            self.0 |= Self::FINALIZED_BIT;
        } else {
            self.0 &= !Self::FINALIZED_BIT;
        }
    }

    pub fn on_finalize(&mut self) -> bool {
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
/// The field projection is a trait method (typically implemented via
/// `core::mem::offset_of!`).
pub trait HasWeakPtrData {
    /// Return a pointer to the embedded `WeakPtrData` field on `this`.
    ///
    /// # Safety
    /// `this` must point to a live allocation of `Self` (the inner contents
    /// may already be finalized, but the allocation itself must not yet be
    /// freed).
    unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData;
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
/// invalidates the handle, so every later `get`/`deref` is UB. This mirrors
/// [`ThisPtr::new`](crate::ThisPtr::new) and
/// [`ParentRef::from_raw_mut`](crate::ParentRef::from_raw_mut).
pub struct WeakPtr<T: HasWeakPtrData> {
    // Intentionally a raw pointer, not `std::sync::Weak<T>`: this file *is*
    // the definition of the intrusive weak pointer, with liveness tracked by
    // the embedded `WeakPtrData` and manual ref/deref.
    raw_ptr: Option<NonNull<T>>,
}

impl<T: HasWeakPtrData> WeakPtr<T> {
    pub const EMPTY: Self = Self { raw_ptr: None };

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
        let d = unsafe { &mut *T::weak_ptr_data(this) };
        debug_assert!(!d.finalized());
        d.set_reference_count(d.reference_count() + 1);
        Self {
            // SAFETY: caller contract — `this` is non-null.
            raw_ptr: Some(unsafe { NonNull::new_unchecked(this) }),
        }
    }

    pub fn deref(&mut self) {
        if let Some(value) = self.raw_ptr {
            // SAFETY: `raw_ptr` was set by `init_ref` and not yet released;
            // the allocation outlives all `WeakPtr`s by construction.
            unsafe { self.deref_internal(value) };
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
                if !(*T::weak_ptr_data(value.as_ptr())).finalized() {
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
        // SAFETY: caller guarantees `value` points to a live allocation;
        // projecting to the embedded `WeakPtrData` field.
        let weak_data = unsafe { &mut *T::weak_ptr_data(value.as_ptr()) };
        let count = weak_data.reference_count() - 1;
        weak_data.set_reference_count(count);
        let finalized = weak_data.finalized();
        if finalized && count == 0 {
            // The allocation came from `heap::alloc` (via `Box::new`).
            // SAFETY: this is the last reference and the owner has finalized,
            // so we hold the only pointer to a `Box`-allocated `T`. `weak_data`
            // is dead here, so freeing through `value` disturbs no live borrow.
            drop(unsafe { bun_core::heap::take(value.as_ptr()) });
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

    impl HasWeakPtrData for Owner {
        unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData {
            // SAFETY: caller contract — pure field projection, no read.
            unsafe { &raw mut (*this).weak }
        }
    }

    fn new_owner(payload: u32) -> *mut Owner {
        bun_core::heap::into_raw(Box::new(Owner {
            weak: WeakPtrData::EMPTY,
            payload,
            _heap: Box::new(payload),
        }))
    }

    #[test]
    fn bit_layout() {
        let mut d = WeakPtrData::EMPTY;
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
        let mut d = WeakPtrData::EMPTY;
        assert!(d.on_finalize());

        let mut d = WeakPtrData::EMPTY;
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
        assert_eq!(weak.get().map(|o| o.payload), Some(4));

        // Owner finalizes its contents: not the last ref, so the allocation stays.
        // SAFETY: `raw` is live.
        assert!(!unsafe { (*Owner::weak_ptr_data(raw)).on_finalize() });
        assert_eq!(drops(), before);

        // `get` on a finalized owner releases the ref and reports `None`, which
        // is the last ref, so `deref_internal` frees the allocation.
        assert!(weak.get().is_none());
        assert_eq!(drops(), before + 1);
        // The handle is now empty: a second `get`/`deref` must be a no-op.
        assert!(weak.get().is_none());
        weak.deref();
    }

    /// `deref` before finalize leaves the allocation to the owner.
    #[test]
    fn weak_ptr_deref_before_finalize_leaves_owner_in_charge() {
        let _serial = serial();
        let before = drops();
        let raw = new_owner(6);
        // SAFETY: `raw` is a freshly leaked Box; live and not finalized.
        let mut weak = unsafe { WeakPtr::init_ref(raw) };
        weak.deref();
        assert_eq!(drops(), before);
        // SAFETY: no weak refs remain; the owner frees its own allocation.
        drop(unsafe { bun_core::heap::take(raw) });
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
            assert_eq!(weak.get().map(|o| o.payload), Some(i));
        }

        weak.deref();
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
        assert_eq!(unsafe { (*Owner::weak_ptr_data(raw)).reference_count() }, 2);
        assert_eq!(a.get().map(|o| o.payload), Some(2));
        assert_eq!(b.get().map(|o| o.payload), Some(2));

        // SAFETY: `raw` is live.
        assert!(!unsafe { (*Owner::weak_ptr_data(raw)).on_finalize() });
        a.deref();
        assert_eq!(drops(), before);
        b.deref();
        assert_eq!(drops(), before + 1);
    }
}
