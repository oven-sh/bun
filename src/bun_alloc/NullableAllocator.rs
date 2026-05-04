//! A nullable allocator the same size as `std.mem.Allocator`.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::Allocator;
// TODO(port): `std.mem.Allocator.VTable` has no named Rust equivalent — `&dyn Allocator`
// is a fat pointer whose vtable type is unnameable on stable. Phase B: either expose
// `crate::AllocatorVTable` or collapse this whole struct to `Option<&'a dyn Allocator>`
// (which already has the same size via niche optimization).
use crate::AllocatorVTable;

#[derive(Clone, Copy)]
pub struct NullableAllocator {
    ptr: *mut c_void,
    // Utilize the null pointer optimization on the vtable instead of
    // the regular `ptr` because `ptr` may be undefined.
    // TODO(port): lifetime
    vtable: Option<NonNull<AllocatorVTable>>,
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
    #[inline]
    pub fn init(allocator: Option<&dyn Allocator>) -> NullableAllocator {
        if let Some(a) = allocator {
            // TODO(port): decomposing `&dyn Allocator` into (data, vtable) requires
            // `core::ptr::metadata` (feature `ptr_metadata`). Phase B may instead store
            // the fat pointer directly.
            let (ptr, vtable) = crate::dyn_allocator_into_raw_parts(a);
            Self {
                ptr,
                vtable: Some(vtable),
            }
        } else {
            Self::default()
        }
    }

    #[inline]
    pub fn is_null(&self) -> bool {
        self.vtable.is_none()
    }

    #[inline]
    pub fn is_wtf_allocator(&self) -> bool {
        let Some(a) = self.get() else { return false };
        bun_str::String::is_wtf_allocator(a)
    }

    #[inline]
    pub fn get(&self) -> Option<&dyn Allocator> {
        if let Some(vt) = self.vtable {
            // TODO(port): reassembling `&dyn Allocator` from (data, vtable) requires
            // `core::ptr::from_raw_parts` (feature `ptr_metadata`).
            // SAFETY: ptr/vtable were obtained from a live `&dyn Allocator` in `init`.
            Some(unsafe { crate::dyn_allocator_from_raw_parts(self.ptr, vt) })
        } else {
            None
        }
    }

    pub fn free(&self, bytes: &[u8]) {
        if let Some(allocator) = self.get() {
            if bun_str::String::is_wtf_allocator(allocator) {
                // avoid calling `std.mem.Allocator.free` as it sets the memory to undefined
                // TODO(port): `.@"1"` is `std.mem.Alignment.@"1"` (log2-align = 0, i.e. byte-aligned).
                allocator.raw_free(bytes.as_ptr() as *mut u8, bytes.len(), /* align */ 1, /* ret_addr */ 0);
                return;
            }

            allocator.free(bytes);
        }
    }
}

const _: () = assert!(
    core::mem::size_of::<NullableAllocator>() == core::mem::size_of::<*const dyn Allocator>(),
    "Expected the sizes to be the same."
);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/NullableAllocator.zig (48 lines)
//   confidence: medium
//   todos:      4
//   notes:      stable Rust cannot name a dyn-trait vtable; Phase B should likely replace this with Option<&dyn Allocator> (same size via niche) or gate on feature(ptr_metadata)
// ──────────────────────────────────────────────────────────────────────────
