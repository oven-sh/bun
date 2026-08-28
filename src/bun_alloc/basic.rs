use core::ffi::c_void;

use crate::{default_alloc, mimalloc};
// TODO(refactor): consider reshaping the vtable struct into `trait Allocator` impls.
use crate::{Alignment, AllocatorVTable, StdAllocator};

/// # Safety
/// `ptr` must have been allocated by mimalloc with the given `size`/`align`.
#[inline(always)]
pub(crate) unsafe fn mi_free_checked(ptr: *mut c_void, size: usize, align: usize) {
    if cfg!(debug_assertions) {
        // SAFETY: `mi_is_in_heap_region` accepts any pointer; remaining calls
        // are sound by the caller contract above.
        unsafe {
            debug_assert!(mimalloc::mi_is_in_heap_region(ptr));
            if mimalloc::must_use_aligned_alloc(align) {
                mimalloc::mi_free_size_aligned(ptr, size, align);
            } else {
                mimalloc::mi_free_size(ptr, size);
            }
        }
    } else {
        let _ = (size, align);
        // SAFETY: caller contract — `ptr` was allocated by mimalloc.
        unsafe { mimalloc::mi_free(ptr) }
    }
}

pub(crate) fn default_allocator_free(_: *mut c_void, buf: &mut [u8], _: Alignment, _: usize) {
    // SAFETY: Allocator vtable invariant — `buf` was allocated by the default allocator.
    unsafe { default_alloc::free(buf.as_mut_ptr().cast()) }
}

pub static C_ALLOCATOR: StdAllocator = StdAllocator {
    // This ptr can be anything. But since it's not nullable, we should set it to something.
    ptr: memory_allocator_tags::DEFAULT_ALLOCATOR_TAG_PTR,
    vtable: C_ALLOCATOR_VTABLE,
};
static C_ALLOCATOR_VTABLE: &AllocatorVTable = &AllocatorVTable {
    free: default_allocator_free,
};

mod memory_allocator_tags {
    use core::ffi::c_void;

    const DEFAULT_ALLOCATOR_TAG: usize = 0xBEEFA110C; // "BEEFA110C"  beef a110c i guess
    pub(crate) const DEFAULT_ALLOCATOR_TAG_PTR: *mut c_void = DEFAULT_ALLOCATOR_TAG as *mut c_void;
}

/// mimalloc can free allocations without being given their size.
///
/// # Safety
/// `ptr` must be null or have been allocated by mimalloc.
pub unsafe fn free_without_size(ptr: *mut c_void) {
    // SAFETY: caller contract — ptr is null or was allocated by mimalloc; mi_free accepts null
    unsafe { mimalloc::mi_free(ptr) }
}
