use core::ptr::NonNull;

#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct WeakPtrData(u32);

impl WeakPtrData {
    pub const EMPTY: Self = Self(0); // reference_count = 0, finalized = false

    const REF_MASK: u32 = 0x7FFF_FFFF; // low 31 bits
    const FINALIZED_BIT: u32 = 0x8000_0000; // bit 31

    #[inline]
    pub fn reference_count(self) -> u32 {
        self.0 & Self::REF_MASK
    }

    #[inline]
    pub fn set_reference_count(&mut self, n: u32) {
        debug_assert!(n <= Self::REF_MASK);
        self.0 = (self.0 & Self::FINALIZED_BIT) | (n & Self::REF_MASK);
    }

    #[inline]
    pub fn finalized(self) -> bool {
        (self.0 & Self::FINALIZED_BIT) != 0
    }

    #[inline]
    pub fn set_finalized(&mut self, v: bool) {
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

pub trait HasWeakPtrData {
    /// Return a pointer to the embedded `WeakPtrData` field on `this`.
    ///
    /// # Safety
    /// `this` must point to a live allocation of `Self` (the inner contents
    /// may already be finalized, but the allocation itself must not yet be
    /// freed).
    unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData;
}

pub struct WeakPtr<T: HasWeakPtrData> {
    raw_ptr: Option<NonNull<T>>,
}

pub type Data = WeakPtrData;

impl<T: HasWeakPtrData> WeakPtr<T> {
    pub const EMPTY: Self = Self { raw_ptr: None };

    pub fn init_ref(req: &mut T) -> Self {
        // SAFETY: `req` is a valid &mut T, so the allocation is live.
        let d = unsafe { &mut *T::weak_ptr_data(req) };
        debug_assert!(!d.finalized());
        d.set_reference_count(d.reference_count() + 1);
        Self {
            raw_ptr: Some(NonNull::from(req)),
        }
    }

    pub fn deref(&mut self) {
        if let Some(value) = self.raw_ptr {
            // SAFETY: `raw_ptr` was set by `init_ref` and not yet released;
            // the allocation outlives all `WeakPtr`s by construction.
            unsafe { self.deref_internal(value) };
        }
    }

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
        // SAFETY: caller guarantees `value` points to a live allocation;
        // projecting to the embedded `WeakPtrData` field.
        let weak_data = unsafe { &mut *T::weak_ptr_data(value.as_ptr()) };
        self.raw_ptr = None;
        let count = weak_data.reference_count() - 1;
        weak_data.set_reference_count(count);
        if weak_data.finalized() && count == 0 {
            // Zig: `bun.destroy(value)` — the allocation came from
            // `bun.new(T, ...)` (i.e. `Box::new` + `heap::alloc`).
            // SAFETY: this is the last reference and the owner has finalized,
            // so we hold the only pointer to a `Box`-allocated `T`.
            drop(unsafe { bun_core::heap::take(value.as_ptr()) });
        }
    }
}

impl<T: HasWeakPtrData> Default for WeakPtr<T> {
    fn default() -> Self {
        Self::EMPTY
    }
}

// ported from: src/ptr/weak_ptr.zig
