//! `to_external_u16` and the `EncodedSlice__freeGlobal` callback; the
//! `bun_core::EncodedSlice` → JS conversions live on [`crate::EncodedSliceJsc`].

use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue};
use bun_core::String as BunString;

unsafe extern "C" {
    fn EncodedSlice__toExternalU16(
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
                format_args!("Cannot create a string longer than 2147483647 characters"),
            )
            .throw();
        return JSValue::ZERO;
    }
    // SAFETY: ptr/len describe a globally-allocated UTF-16 buffer; ownership
    // transfers to JSC (freed via the external-string finalizer).
    unsafe { EncodedSlice__toExternalU16(ptr, len, global) }
}

/// # Safety
/// `ptr` must be a (possibly tagged) pointer to `len` bytes allocated by the
/// default allocator.
#[unsafe(no_mangle)]
unsafe extern "C" fn EncodedSlice__freeGlobal(ptr: *const u8, len: usize) {
    let _ = len;
    let untagged = bun_alloc::EncodedSlice::untagged(ptr)
        .cast_mut()
        .cast::<c_void>();
    if bun_alloc::USE_MIMALLOC {
        // SAFETY: read-only heap-region probe.
        debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(untagged) });
    }
    // SAFETY: untagged ptr was allocated by the default allocator.
    unsafe { bun_alloc::default_alloc::free(untagged) };
}
