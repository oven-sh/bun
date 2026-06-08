//! A nullable allocator the same size as `StdAllocator`.

use core::ffi::c_void;

use crate::{Alignment, AllocatorVTable, StdAllocator};

/// `vtable: Option<&'static AllocatorVTable>` carries the niche,
/// so the struct is identical in size to `StdAllocator`.
#[derive(Clone, Copy)]
pub struct NullableAllocator {
    ptr: *mut c_void,
    // Utilize the null pointer optimization on the vtable instead of
    // the regular `ptr` because `ptr` may be undefined. Stored as the
    // `&'static` it was constructed from so `get()` is a safe field copy.
    vtable: Option<&'static AllocatorVTable>,
}

impl Default for NullableAllocator {
    fn default() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            vtable: None,
        }
    }
}

impl NullableAllocator {
    /// A `NullableAllocator` with no backing allocator. `const` so it can be
    /// used in `const` initializers (e.g. `ZigString.Slice::EMPTY`).
    pub const NULL: NullableAllocator = NullableAllocator {
        ptr: core::ptr::null_mut(),
        vtable: None,
    };

    #[inline]
    pub const fn null() -> NullableAllocator {
        Self::NULL
    }

    /// Wraps the global mimalloc allocator (`bun.default_allocator`).
    #[inline]
    pub fn default_alloc() -> NullableAllocator {
        Self::init(Some(crate::basic::C_ALLOCATOR))
    }

    /// True iff `allocator`'s vtable is the global mimalloc vtable.
    #[inline]
    pub fn is_default(alloc: StdAllocator) -> bool {
        core::ptr::eq(alloc.vtable, crate::basic::C_ALLOCATOR.vtable)
    }

    #[inline]
    pub fn init(alloc: Option<StdAllocator>) -> NullableAllocator {
        match alloc {
            Some(a) => Self {
                ptr: a.ptr,
                vtable: Some(a.vtable),
            },
            None => Self::default(),
        }
    }

    #[inline]
    pub fn is_null(&self) -> bool {
        self.vtable.is_none()
    }

    #[inline]
    pub fn is_wtf_allocator(&self) -> bool {
        let Some(a) = self.get() else { return false };
        crate::String::is_wtf_allocator(a)
    }

    #[inline]
    pub fn get(&self) -> Option<StdAllocator> {
        Some(StdAllocator {
            ptr: self.ptr,
            vtable: self.vtable?,
        })
    }

    /// [`StdAllocator::free`] through the nullable handle; a null allocator,
    /// null `ptr`, or (for non-WTF allocators) zero `len` is a no-op.
    ///
    /// # Safety
    /// `ptr` must be null or point to a live allocation of `len` bytes
    /// obtained from this allocator. The allocation is freed exactly once; its
    /// memory must not be accessed after this call.
    pub unsafe fn free(&self, ptr: *mut u8, len: usize) {
        if ptr.is_null() {
            return;
        }
        if let Some(allocator) = self.get() {
            if crate::String::is_wtf_allocator(allocator) {
                // `StdAllocator::free` early-outs on `len == 0`, but the WTF
                // "allocator" is a refcount: a zero-byte-length string still
                // holds a reference that must be released, so route straight
                // to `raw_free`.
                // SAFETY: caller contract — `ptr[..len]` is the byte view of
                // the live `WTFStringImpl` this allocator wraps; the slice
                // exists only to satisfy the vtable signature.
                let buf = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
                // SAFETY: caller contract — see the `# Safety` section above.
                unsafe { allocator.raw_free(buf, Alignment::from_byte_units(1), 0) };
                return;
            }

            // SAFETY: caller contract — forwarded unchanged.
            unsafe { allocator.free(ptr, len) };
        }
    }
}

const _: () = assert!(
    core::mem::size_of::<NullableAllocator>() == core::mem::size_of::<StdAllocator>(),
    "Expected the sizes to be the same."
);
