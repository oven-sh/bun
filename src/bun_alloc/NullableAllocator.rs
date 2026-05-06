//! A nullable allocator the same size as `std.mem.Allocator`.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{Alignment, AllocatorVTable, StdAllocator};

/// PORT NOTE: Zig stored `{ ptr: *anyopaque, vtable: ?*const VTable }` and
/// recovered the `Allocator` by null-checking the vtable. Rust models the same
/// thing directly — `vtable: Option<&'static AllocatorVTable>` carries the
/// niche, so the struct is identical in size to `StdAllocator`.
#[derive(Clone, Copy)]
pub struct NullableAllocator {
    ptr: *mut c_void,
    // Utilize the null pointer optimization on the vtable instead of
    // the regular `ptr` because `ptr` may be undefined.
    vtable: Option<NonNull<AllocatorVTable>>,
}

impl Default for NullableAllocator {
    fn default() -> Self {
        Self { ptr: core::ptr::null_mut(), vtable: None }
    }
}

impl NullableAllocator {
    #[inline]
    pub fn init(allocator: Option<StdAllocator>) -> NullableAllocator {
        match allocator {
            Some(a) => Self { ptr: a.ptr, vtable: Some(NonNull::from(a.vtable)) },
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
        let vt = self.vtable?;
        // SAFETY: vtable was obtained from a `&'static AllocatorVTable` in `init`.
        Some(StdAllocator { ptr: self.ptr, vtable: unsafe { &*vt.as_ptr() } })
    }

    pub fn free(&self, bytes: &[u8]) {
        if let Some(allocator) = self.get() {
            if crate::String::is_wtf_allocator(allocator) {
                // avoid calling `std.mem.Allocator.free` as it sets the memory to undefined
                // SAFETY: `bytes` is reborrowed mutably only for the vtable signature; the
                // WTF deallocator treats it as opaque (Zig passes `[]u8`).
                let buf = unsafe {
                    core::slice::from_raw_parts_mut(bytes.as_ptr() as *mut u8, bytes.len())
                };
                allocator.raw_free(buf, Alignment::from_byte_units(1), 0);
                return;
            }

            allocator.free(bytes);
        }
    }
}

const _: () = assert!(
    core::mem::size_of::<NullableAllocator>() == core::mem::size_of::<StdAllocator>(),
    "Expected the sizes to be the same."
);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/NullableAllocator.zig (48 lines)
//   confidence: high
//   todos:      0
//   notes:      Ported against `StdAllocator` (Zig `std.mem.Allocator` struct shape) instead of `&dyn Allocator`; is_wtf_allocator is a local vtable-identity check against `StringImplAllocator::VTABLE` (hoisted into bun_alloc to break the bun_alloc→bun_string dep cycle without a fn-ptr hook).
// ──────────────────────────────────────────────────────────────────────────
