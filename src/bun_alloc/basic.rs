use core::ffi::c_void;

use crate::mimalloc;

/// # Safety
/// `ptr` must have been allocated by mimalloc with the given `size`/`align`.
#[inline(always)]
pub(crate) unsafe fn mi_free_checked(ptr: *mut c_void, size: usize, align: usize) {
    if cfg!(debug_assertions) {
        debug_assert!(mimalloc::mi_is_in_heap_region(ptr));
        // SAFETY: caller contract above.
        unsafe {
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

/// mimalloc can free allocations without being given their size.
///
/// # Safety
/// `ptr` must be null or have been allocated by mimalloc.
pub unsafe fn free_without_size(ptr: *mut c_void) {
    // SAFETY: caller contract — ptr is null or was allocated by mimalloc; mi_free accepts null
    unsafe { mimalloc::mi_free(ptr) }
}
