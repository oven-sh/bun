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

/// `ZigString.as_()` return type — re-exported alongside the struct.
pub use bun_core::ByteString;
/// Canonical `ZigString` lives in `bun_core`; re-exported here so existing
/// `bun_jsc::zig_string::ZigString` import paths keep resolving.
pub use bun_core::ZigString;
/// `ZigString.githubAction()` return type — re-exported for parity with the
/// pre-dedup local `GithubActionFormatter` struct.
pub use bun_core::ZigStringGithubActionFormatter as GithubActionFormatter;
/// `ZigString.Slice` re-export for `crate::zig_string::Slice` callers.
pub use bun_core::ZigStringSlice as Slice;

/// JSC-side conversions on `ZigString` are provided by the [`ZigStringJsc`]
/// extension trait (canonical impl in `crate::lib`). Re-exported here so
/// callers can `use bun_jsc::zig_string::{ZigString, ZigStringJsc}`.
pub use crate::ZigStringJsc;

// `OpaqueJSString` / `JSStringRef` retained for type-level compatibility with
// the JSC C API surface; the `to_js_string_ref` constructor wrappers were dead
// code (no C++ body for `JSStringCreateStatic` in Bun's link image — Zig's
// `toJSStringRef` is unreachable behind `@hasDecl(bun, "bindgen")`).
bun_opaque::opaque_ffi! { pub struct OpaqueJSString; }
pub type JSStringRef = *mut OpaqueJSString;

unsafe extern "C" {
    fn ZigString__toExternalU16(
        ptr: *const u16,
        len: usize,
        global: *const JSGlobalObject,
    ) -> JSValue;
}

/// `ZigString.static(comptime s)` — borrow a static ASCII/Latin-1 literal.
/// Spec (`ZigString.static`, ZigString.zig:499-506) constructs the string with
/// the raw literal pointer and NO encoding tag. Callers who need UTF-8
/// semantics must use `init_utf8` / `from_utf8` explicitly.
#[inline]
pub fn static_(s: &'static [u8]) -> ZigString {
    ZigString::init(s)
}

/// `ZigString.toExternalU16` (ZigString.zig:571) — hand a globally-allocated
/// UTF-16 buffer to JSC as an external string. Ownership of `ptr[0..len]`
/// transfers to JSC on success; on the too-long path the buffer is freed
/// here, a `STRING_TOO_LONG` error is thrown, and `.zero` is returned.
///
/// SAFETY: `ptr` must have been allocated by the global mimalloc allocator
/// (via `heap::alloc`/`Vec::into_raw_parts`/`bun.default_allocator`) and
/// must not be used by the caller after this returns.
pub fn to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue {
    if len > BunString::max_length() {
        // SAFETY: caller contract — `ptr` came from the global mimalloc
        // allocator. `mi_free` accepts the raw block pointer regardless of
        // element size.
        unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<core::ffi::c_void>()) };
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

#[unsafe(no_mangle)]
pub extern "C" fn ZigString__free(raw: *const u8, len: usize, allocator_: *mut c_void) {
    let Some(allocator_) = core::ptr::NonNull::new(allocator_) else {
        return;
    };
    // TODO(port): Zig dereferenced *std.mem.Allocator from opaque ptr — Rust uses global mimalloc;
    // verify no callers pass a non-default allocator here.
    let _ = allocator_;
    // SAFETY: raw/len describe a valid slice allocated by the caller-provided allocator.
    let s = unsafe { bun_core::ffi::slice(raw, len) };
    let ptr = ZigString::init(s).slice().as_ptr();
    #[cfg(debug_assertions)]
    // SAFETY: read-only heap-region probe.
    debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()) });
    let _ = len;
    // SAFETY: ptr was allocated by mimalloc; mi_free is size-agnostic.
    unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<c_void>()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn ZigString__freeGlobal(ptr: *const u8, len: usize) {
    // SAFETY: ptr/len describe a valid slice.
    let s = unsafe { bun_core::ffi::slice(ptr, len) };
    let untagged = ZigString::init(s)
        .slice()
        .as_ptr()
        .cast_mut()
        .cast::<c_void>();
    #[cfg(debug_assertions)]
    // SAFETY: read-only heap-region probe.
    debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()) });
    // we must untag the string pointer
    // SAFETY: untagged ptr was allocated by mimalloc.
    unsafe { bun_alloc::mimalloc::mi_free(untagged) };
}

// ──────────────────────────────────────────────────────────────────────────
// `NullableAllocator`-backed `Slice` struct port — the `#[repr(C)]`-shaped
// counterpart to the enum-based `bun_core::ZigStringSlice` (re-exported as
// `super::Slice`). Kept for FFI surfaces that need the raw `{allocator, ptr,
// len}` layout; the enum form is preferred for pure-Rust callers.
// ──────────────────────────────────────────────────────────────────────────
mod _slice_struct {
    use super::*;
    use bun_alloc::{AllocError, NullableAllocator};
    use core::slice;

    /// A maybe-owned byte slice. Tracks its allocator so it can free on drop and so
    /// callers can ask `is_wtf_allocated()`.
    pub struct Slice {
        pub allocator: NullableAllocator,
        pub ptr: *const u8,
        pub len: u32,
    }

    impl Default for Slice {
        fn default() -> Self {
            Self {
                allocator: NullableAllocator::null(),
                ptr: b"".as_ptr(),
                len: 0,
            }
        }
    }

    impl Slice {
        pub const EMPTY: Slice = Slice {
            allocator: NullableAllocator::NULL,
            ptr: b"".as_ptr(),
            len: 0,
        };

        pub fn is_wtf_allocated(&self) -> bool {
            self.allocator.is_wtf_allocator()
        }

        pub fn init(input: &[u8]) -> Slice {
            Slice {
                ptr: input.as_ptr(),
                len: input.len() as u32,
                allocator: NullableAllocator::default_alloc(),
            }
        }

        pub fn from_utf8_never_free(input: &[u8]) -> Slice {
            Slice {
                ptr: input.as_ptr(),
                len: input.len() as u32,
                allocator: NullableAllocator::null(),
            }
        }

        #[inline]
        pub fn is_allocated(&self) -> bool {
            !self.allocator.is_null()
        }

        pub fn slice(&self) -> &[u8] {
            // SAFETY: ptr/len are kept in sync by all constructors.
            unsafe { slice::from_raw_parts(self.ptr, self.len as usize) }
        }
    }

    impl Drop for Slice {
        fn drop(&mut self) {
            // Reuse the safe accessor instead of re-deriving the slice from raw
            // parts; `slice()` already encapsulates the ptr/len invariant.
            self.allocator.free(self.slice());
        }
    }
} // mod _slice_struct

// ported from: src/jsc/ZigString.zig
