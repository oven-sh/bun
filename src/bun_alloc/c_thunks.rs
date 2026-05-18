//! C-ABI allocator thunks: `extern "C" fn(opaque, …)` shims that route a
//! C library's pluggable allocator hook into mimalloc (optionally tagged
//! through a `heap_breakdown` malloc-zone).
//!
//! Three foreign ABIs are covered — all share the "ignored opaque cookie +
//! mimalloc backend" shape, only the parameter list differs:
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

use crate::mimalloc;

// ──────────────────────────────────────────────────────────────────────────
// Plain mimalloc thunks (no heap-breakdown tagging)
// ──────────────────────────────────────────────────────────────────────────

/// zlib `alloc_func` → `mi_malloc(items * size)` (non-zeroing).
///
/// Panics-via-`unreachable!` on OOM (mirrors the original Zig thunk). The
/// opaque cookie is ignored (never dereferenced) and `mi_malloc` is `safe fn`,
/// so this thunk has no memory-safety preconditions; a safe fn item still
/// coerces to the `Option<unsafe extern "C" fn>` field at the assignment site.
pub extern "C" fn mi_malloc_items(_: *mut c_void, items: c_uint, size: c_uint) -> *mut c_void {
    let p = mimalloc::mi_malloc((items * size) as usize);
    if p.is_null() {
        unreachable!();
    }
    p
}

/// `(opaque, ptr)` → `mi_free(ptr)`. Frees the **second** argument; the first
/// is the ignored opaque cookie. Matches both zlib `free_func` and brotli
/// `brotli_free_func`.
pub unsafe extern "C" fn mi_free_opaque(_: *mut c_void, ptr: *mut c_void) {
    // SAFETY: ptr was allocated by mimalloc (or is null, which mi_free accepts).
    unsafe { mimalloc::mi_free(ptr) };
}

/// JSC `JSTypedArrayBytesDeallocator` → `mi_free(ctx)`. Frees the **second**
/// argument (the deallocator context); `bytes` is ignored. Functionally
/// identical to [`mi_free_opaque`] — distinct name kept so call sites read by
/// intent (opaque-cookie vs. JSC bytes/ctx pair).
pub use mi_free_opaque as mi_free_ctx;

/// JSC `JSTypedArrayBytesDeallocator` → `mi_free(bytes)`. Frees the **first**
/// argument; `ctx` is ignored.
pub unsafe extern "C" fn mi_free_bytes(bytes: *mut c_void, _ctx: *mut c_void) {
    // SAFETY: bytes was allocated by mimalloc; mi_free is null-safe.
    unsafe { mimalloc::mi_free(bytes) };
}

// ──────────────────────────────────────────────────────────────────────────
// Zone-tagged thunks
// ──────────────────────────────────────────────────────────────────────────

/// Expands a set of `extern "C"` allocator thunks bound to a named
/// heap-breakdown zone. When `heap_breakdown::ENABLED` is false (release /
/// non-macOS) the thunks fall straight through to mimalloc.
///
/// Generated items:
/// - `malloc_size(_, len: usize) -> *mut c_void` — brotli-shape, non-zeroing.
///   Safe `extern "C" fn` (opaque cookie ignored; body is all-safe).
/// - `calloc_items(_, items: c_uint, len: c_uint) -> *mut c_void` — zlib-shape,
///   zeroing. Safe `extern "C" fn` (same rationale).
/// - `free(_, ptr: *mut c_void)` — paired with either alloc. `unsafe`
///   (precondition: `ptr` was allocated by this zone / mimalloc).
///
/// Intended to be invoked inside a `mod XxxAllocator { … }` so call sites can
/// keep referring to `XxxAllocator::alloc` / `::free` via a local `pub use`.
#[macro_export]
macro_rules! c_thunks_for_zone {
    ($name:literal) => {
        #[allow(dead_code)]
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
            let p = $crate::mimalloc::mi_malloc(len);
            if p.is_null() {
                $crate::out_of_memory();
            }
            p
        }

        #[allow(dead_code)]
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
            let p = $crate::mimalloc::mi_calloc(items as usize, len as usize);
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
            // SAFETY: data was allocated by mimalloc (or is null).
            unsafe { $crate::mimalloc::mi_free(data) };
        }
    };
}
