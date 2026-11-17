//! C-ABI allocator thunks routing C library allocator hooks to the default allocator.
//!
//! | ABI                              | alloc signature                          | free signature             |
//! |----------------------------------|------------------------------------------|----------------------------|
//! | brotli `brotli_alloc/free_func`  | `(opaque, size: usize)`                  | `(opaque, ptr)`            |
//! | JSC `JSTypedArrayBytesDeallocator` | —                                      | `(bytes, ctx)`             |
//!
//! The zone-tagged brotli variants are minted per-label by
//! [`c_thunks_for_zone!`].

use core::ffi::c_void;

use crate::default_alloc as raw;

// ──────────────────────────────────────────────────────────────────────────
// Plain default-allocator thunks (no heap-breakdown tagging)
// ──────────────────────────────────────────────────────────────────────────

/// JSC `JSTypedArrayBytesDeallocator` → default allocator `free(bytes)`; `ctx` ignored.
pub unsafe extern "C" fn mi_free_bytes(bytes: *mut c_void, _ctx: *mut c_void) {
    // SAFETY: bytes was allocated by the default allocator (or is null).
    unsafe { raw::free(bytes) };
}

// ──────────────────────────────────────────────────────────────────────────
// Zone-tagged thunks
// ──────────────────────────────────────────────────────────────────────────

/// Expands a set of `extern "C"` allocator thunks bound to a named
/// heap-breakdown zone. When `heap_breakdown::ENABLED` is false (release /
/// non-macOS) the thunks fall straight through to the default allocator.
///
/// Generated items:
/// - `malloc_size(_, len: usize) -> *mut c_void` — brotli-shape, non-zeroing.
///   Safe `extern "C" fn` (opaque cookie ignored; body is all-safe). Returns null on failure, which brotli reports as its own OOM error.
/// - `free(_, ptr: *mut c_void)` — paired with it. `unsafe`
///   (precondition: `ptr` was allocated by this zone / the default allocator).
///
/// Intended to be invoked inside a `mod XxxAllocator { … }` so call sites can
/// keep referring to `XxxAllocator::alloc` / `::free` via a local `pub use`.
#[macro_export]
macro_rules! c_thunks_for_zone {
    ($name:literal) => {
        // One zone for the alloc and free thunks. `get_zone!` expands to its
        // own `static` per use, so it must appear once.
        fn zone() -> &'static $crate::heap_breakdown::Zone {
            $crate::get_zone!($name)
        }

        pub extern "C" fn malloc_size(
            _: *mut ::core::ffi::c_void,
            len: usize,
        ) -> *mut ::core::ffi::c_void {
            if $crate::heap_breakdown::ENABLED {
                return zone()
                    .malloc_zone_malloc(len)
                    .unwrap_or(::core::ptr::null_mut());
            }
            $crate::default_alloc::malloc(len)
        }

        pub unsafe extern "C" fn free(_: *mut ::core::ffi::c_void, data: *mut ::core::ffi::c_void) {
            if $crate::heap_breakdown::ENABLED {
                // SAFETY: `data` was allocated by this zone in `malloc_size`.
                unsafe { zone().malloc_zone_free(data) };
                return;
            }
            // SAFETY: data was allocated by the default allocator (or is null).
            unsafe { $crate::default_alloc::free(data) };
        }
    };
}
