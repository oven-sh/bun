//! Legacy `jsc::zig_string` namespace. The borrowed-view type is now a private
//! `StringView` payload of `bun_core::String`; everything goes through
//! `bun_core::String` (= `BunString` on the C++ side).

use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue};
use bun_core::String as BunString;

pub use bun_core::StringGithubActionFormatter as GithubActionFormatter;
/// `ZigString.Slice` re-export for `crate::zig_string::Slice` callers.
pub use bun_core::ZigStringSlice as Slice;

// `OpaqueJSString` / `JSStringRef` retained for type-level compatibility with
// the JSC C API surface; the `to_js_string_ref` constructor wrappers were dead
// code (no C++ body for `JSStringCreateStatic` in Bun's link image — Zig's
// `toJSStringRef` is unreachable behind `@hasDecl(bun, "bindgen")`).
bun_opaque::opaque_ffi! { pub struct OpaqueJSString; }

unsafe extern "C" {
    fn ZigString__toExternalU16(
        ptr: *const u16,
        len: usize,
        global: *const JSGlobalObject,
    ) -> JSValue;
}

/// `ZigString.toExternalU16` (ZigString.zig:571) — hand a globally-allocated
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
        // TODO(port): Zig used `global.ERR(.STRING_TOO_LONG, msg).throw()`;
        // the codegen'd `ErrorCode::ERR_STRING_TOO_LONG` builder hasn't landed
        // yet, so throw a plain RangeError with the same message. Propagation
        // is swallowed (matches Zig's `catch {}`).
        let err = global.create_range_error_instance(format_args!(
            "Cannot create a string longer than 2^32-1 characters"
        ));
        let _ = global.throw_value(err);
        return JSValue::ZERO;
    }
    // SAFETY: ptr/len describe a globally-allocated UTF-16 buffer; ownership
    // transfers to JSC (freed via the external-string finalizer).
    unsafe { ZigString__toExternalU16(ptr, len, global) }
}

/// # Safety
/// `raw` must point to `len` bytes allocated by the default allocator.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn BunStringView__free(
    raw: *const u8,
    len: usize,
    allocator_: *mut c_void,
) {
    if allocator_.is_null() {
        return;
    }
    // TODO(port): Zig dereferenced *std.mem.Allocator from opaque ptr — Rust uses global mimalloc;
    // verify no callers pass a non-default allocator here.
    let ptr = bun_alloc::String::untag_view_ptr(raw);
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
pub(crate) unsafe extern "C" fn BunStringView__freeGlobal(ptr: *const u8, len: usize) {
    let _ = len;
    let untagged = bun_alloc::String::untag_view_ptr(ptr)
        .cast_mut()
        .cast::<c_void>();
    if bun_alloc::USE_MIMALLOC {
        // SAFETY: read-only heap-region probe.
        debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(untagged) });
    }
    // SAFETY: untagged ptr was allocated by the default allocator.
    unsafe { bun_alloc::default_alloc::free(untagged) };
}

// ported from: src/jsc/ZigString.zig
