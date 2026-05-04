use core::ptr::NonNull;

/// Zig: `packed struct(u32) { reference_count: u31, finalized: bool }`
/// First field occupies the low bits, so:
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

/// Implemented by types that embed a `WeakPtrData` field and can be weakly
/// referenced via `WeakPtr<T>`.
///
/// Zig expressed this as `WeakPtr(comptime T: type, data_field: []const u8)`
/// and used `@field(value, data_field)` to reach the embedded data. Rust has
/// no comptime field-name reflection, so the field projection becomes a trait
/// method (typically implemented via `core::mem::offset_of!`).
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
pub struct WeakPtr<T: HasWeakPtrData> {
    // PORT NOTE: LIFETIMES.tsv classifies this field as SHARED → `Weak<T>`,
    // but this file *is* the definition of the intrusive weak pointer; per
    // PORTING.md §Pointers ("keep as `*mut T` + manual ref/deref over an
    // embedded `WeakPtrData`"), the field stays a raw pointer.
    raw_ptr: Option<NonNull<T>>,
}

impl<T: HasWeakPtrData> WeakPtr<T> {
    pub type Data = WeakPtrData;

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
            // `bun.new(T, ...)` (i.e. `Box::new` + `Box::into_raw`).
            // SAFETY: this is the last reference and the owner has finalized,
            // so we hold the only pointer to a `Box`-allocated `T`.
            drop(unsafe { Box::from_raw(value.as_ptr()) });
        }
    }
}

impl<T: HasWeakPtrData> Default for WeakPtr<T> {
    fn default() -> Self {
        Self::EMPTY
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/weak_ptr.zig (69 lines)
//   confidence: medium
//   todos:      0
//   notes:      data_field comptime string → HasWeakPtrData trait; raw_ptr kept raw (intrusive) despite TSV saying Weak<T>
// ──────────────────────────────────────────────────────────────────────────
