//! C-ABI allocator thunks routing C library allocator hooks to the default allocator.

use core::ffi::c_void;

use crate::default_alloc as raw;

/// JSC `JSTypedArrayBytesDeallocator` → default allocator `free(bytes)`; `ctx` ignored.
pub unsafe extern "C" fn mi_free_bytes(bytes: *mut c_void, _ctx: *mut c_void) {
    // SAFETY: bytes was allocated by the default allocator (or is null).
    unsafe { raw::free(bytes) };
}
