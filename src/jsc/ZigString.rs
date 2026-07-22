//! Prefer using bun.String instead of ZigString in new code.
//!
//! DEDUP NOTE: this module formerly defined a second `#[repr(C)] struct ZigString`
//! mirror with ~70 inherent methods that duplicated `bun_core::ZigString`. The
//! struct definition and all pure (non-JSC) methods now live canonically in
//! `bun_core`; this file re-exports the type and surfaces the JSC-only
//! conversions (`to_js`, `to_*_error_instance`, `to_external_value`, …) via the
//! [`crate::ZigStringJsc`] extension trait. Both crates share the identical
//! `#[repr(C)] { *const u8, usize }` layout, so the `extern "C"` `ZigString__*`
//! shims remain ABI-valid.

use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue};
use bun_core::String as BunString;

/// Canonical `ZigString` lives in `bun_core`; re-exported here so existing
/// `bun_jsc::zig_string::ZigString` import paths keep resolving.
pub use bun_core::ZigString;

unsafe extern "C" {
    fn ZigString__toExternalU16(
        ptr: *const u16,
        len: usize,
        global: *const JSGlobalObject,
    ) -> JSValue;
}

/// Hand a globally-allocated
/// UTF-16 buffer to JSC as an external string. Ownership of `ptr[0..len]`
/// transfers to JSC on success; on the too-long path the buffer is freed
/// here, a `STRING_TOO_LONG` error is thrown, and `.zero` is returned.
///
/// # Safety
/// `ptr` must have been allocated by the global mimalloc allocator
/// (via `heap::alloc`/`Vec::into_raw_parts`/`bun.default_allocator`) and
/// must not be used by the caller after this returns.
pub unsafe fn to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue {
    if len > BunString::max_length() {
        // SAFETY: caller contract — `ptr` came from the default (global) allocator.
        unsafe { bun_alloc::default_alloc::free(ptr.cast_mut().cast::<core::ffi::c_void>()) };
        // Propagation of the throw is intentionally swallowed.
        let _ = global
            .err(
                crate::ErrorCode::STRING_TOO_LONG,
                format_args!("Cannot create a string longer than 2^32-1 characters"),
            )
            .throw();
        return JSValue::ZERO;
    }
    // SAFETY: ptr/len describe a globally-allocated UTF-16 buffer; ownership
    // transfers to JSC (freed via the external-string finalizer).
    unsafe { ZigString__toExternalU16(ptr, len, global) }
}

/// # Safety
/// `raw` must point to `len` bytes allocated by the default allocator.
#[unsafe(no_mangle)]
unsafe extern "C" fn ZigString__free(raw: *const u8, len: usize, allocator_: *mut c_void) {
    let Some(allocator_) = core::ptr::NonNull::new(allocator_) else {
        return;
    };
    // The buffer is always owned by the global allocator. Verified:
    // no C++ call site passes a non-default allocator — the only reference to
    // this symbol outside this file is the declaration in
    // headers-handwritten.h (helpers.h frees via `ZigString__freeGlobal`).
    let _ = allocator_;
    // SAFETY: raw/len describe a valid slice allocated by the caller-provided allocator.
    let s = unsafe { bun_core::ffi::slice(raw, len) };
    let ptr = ZigString::init(s).slice().as_ptr();
    if bun_alloc::USE_MIMALLOC {
        // SAFETY: read-only heap-region probe.
        debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()) });
    }
    let _ = len;
    // SAFETY: ptr was allocated by the default allocator.
    unsafe { bun_alloc::default_alloc::free(ptr.cast_mut().cast::<c_void>()) };
}

/// # Safety
/// `ptr` must point to `len` bytes allocated by the default allocator.
#[unsafe(no_mangle)]
unsafe extern "C" fn ZigString__freeGlobal(ptr: *const u8, len: usize) {
    // SAFETY: ptr/len describe a valid slice.
    let s = unsafe { bun_core::ffi::slice(ptr, len) };
    let untagged = ZigString::init(s)
        .slice()
        .as_ptr()
        .cast_mut()
        .cast::<c_void>();
    if bun_alloc::USE_MIMALLOC {
        // SAFETY: read-only heap-region probe.
        debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()) });
    }
    // we must untag the string pointer
    // SAFETY: untagged ptr was allocated by the default allocator.
    unsafe { bun_alloc::default_alloc::free(untagged) };
}
