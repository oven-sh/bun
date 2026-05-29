//! C-ABI allocator thunks routing C library allocator hooks to the default allocator.
//!
//! | ABI                              | alloc signature                          | free signature             |
//! |----------------------------------|------------------------------------------|----------------------------|
//! | zlib `alloc_func`/`free_func`    | `(opaque, items: c_uint, size: c_uint)`  | `(opaque, ptr)`            |
//! | brotli `brotli_alloc/free_func`  | `(opaque, size: usize)`                  | `(opaque, ptr)`            |
//! | JSC `JSTypedArrayBytesDeallocator` | —                                      | `(bytes, ctx)`             |
//!
//! The plain (non-zone-tagged) variants are free functions below; the
//! zone-tagged variants are minted per-label by [`c_thunks_for_zone!`].

use core::ffi::{c_uint, c_void};

use crate::default_alloc as raw;

// ──────────────────────────────────────────────────────────────────────────
// Plain default-allocator thunks (no heap-breakdown tagging)
// ──────────────────────────────────────────────────────────────────────────

/// zlib `alloc_func` → default allocator `malloc(items * size)` (non-zeroing).
pub extern "C" fn mi_malloc_items(_: *mut c_void, items: c_uint, size: c_uint) -> *mut c_void {
    let p = raw::malloc((items * size) as usize);
    if p.is_null() {
        unreachable!();
    }
    p
}

/// `(opaque, ptr)` → default allocator `free(ptr)`; opaque cookie ignored.
pub unsafe extern "C" fn mi_free_opaque(_: *mut c_void, ptr: *mut c_void) {
    // SAFETY: ptr was allocated by the default allocator (or is null).
    unsafe { raw::free(ptr) };
}

/// JSC `JSTypedArrayBytesDeallocator` → default allocator `free(ctx)`; `bytes` ignored.
pub use mi_free_opaque as mi_free_ctx;

/// JSC `JSTypedArrayBytesDeallocator` → default allocator `free(bytes)`; `ctx` ignored.
pub unsafe extern "C" fn mi_free_bytes(bytes: *mut c_void, _ctx: *mut c_void) {
    // SAFETY: bytes was allocated by the default allocator (or is null).
    unsafe { raw::free(bytes) };
}

// ──────────────────────────────────────────────────────────────────────────
// Zone-tagged thunks
// ──────────────────────────────────────────────────────────────────────────

#[macro_export]
macro_rules! c_thunks_for_zone {
    ($name:literal) => {
        pub extern "C" fn malloc_size(
            _: *mut ::core::ffi::c_void,
            len: usize,
        ) -> *mut ::core::ffi::c_void {
            if $crate::heap_breakdown::ENABLED {
                return match $crate::get_zone!($name).malloc_zone_malloc(len) {
                    Some(p) => p,
                    None => $crate::out_of_memory(),
                };
            }
            let p = $crate::default_alloc::malloc(len);
            if p.is_null() {
                $crate::out_of_memory();
            }
            p
        }

        pub extern "C" fn calloc_items(
            _: *mut ::core::ffi::c_void,
            items: ::core::ffi::c_uint,
            len: ::core::ffi::c_uint,
        ) -> *mut ::core::ffi::c_void {
            if $crate::heap_breakdown::ENABLED {
                return match $crate::get_zone!($name)
                    .malloc_zone_calloc(items as usize, len as usize)
                {
                    Some(p) => p,
                    None => $crate::out_of_memory(),
                };
            }
            let p = $crate::default_alloc::calloc(items as usize, len as usize);
            if p.is_null() {
                $crate::out_of_memory();
            }
            p
        }

        pub unsafe extern "C" fn free(_: *mut ::core::ffi::c_void, data: *mut ::core::ffi::c_void) {
            if $crate::heap_breakdown::ENABLED {
                // SAFETY: `data` was allocated by this zone in one of the
                // alloc thunks above.
                unsafe { $crate::get_zone!($name).malloc_zone_free(data) };
                return;
            }
            // SAFETY: data was allocated by the default allocator (or is null).
            unsafe { $crate::default_alloc::free(data) };
        }
    };
}
