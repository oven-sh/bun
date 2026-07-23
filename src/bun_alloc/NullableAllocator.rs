//! A nullable allocator the same size as `StdAllocator`.

use core::ffi::c_void;

use crate::{AllocatorVTable, StdAllocator};

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
    pub fn get(&self) -> Option<StdAllocator> {
        Some(StdAllocator {
            ptr: self.ptr,
            vtable: self.vtable?,
        })
    }
}

const _: () = assert!(
    core::mem::size_of::<NullableAllocator>() == core::mem::size_of::<StdAllocator>(),
    "Expected the sizes to be the same."
);
