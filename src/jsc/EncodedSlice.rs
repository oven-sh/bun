//! JSC bridges for `bun_core::EncodedSlice`: the `EncodedSliceJsc` extension
//! trait and the `EncodedSlice__freeGlobal` callback.

use core::ffi::c_void;

use crate::bun_string_jsc::{self, ErrorKind};
use crate::{DOMExceptionCode, JSGlobalObject, JSValue, JsResult, cpp};
use bun_core::{EncodedSlice, StringView};

/// # Safety
/// `ptr` must be a (possibly tagged) pointer to `len` bytes allocated by the
/// default allocator.
#[unsafe(no_mangle)]
unsafe extern "C" fn EncodedSlice__freeGlobal(ptr: *const u8, _len: usize) {
    let untagged = bun_core::EncodedSlice::untagged(ptr)
        .cast_mut()
        .cast::<c_void>();
    if bun_alloc::USE_MIMALLOC {
        // SAFETY: read-only heap-region probe.
        debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(untagged) });
    }
    // SAFETY: untagged ptr was allocated by the default allocator.
    unsafe { bun_alloc::default_alloc::free(untagged) };
}

unsafe extern "C" {
    // safe: `EncodedSlice` is `#[repr(C)]` and read-only across the call; `JSGlobalObject` is an
    // opaque `UnsafeCell`-backed ZST handle. `&T` is ABI-identical to a non-null `*const T`.
    safe fn EncodedSlice__toDOMExceptionInstance(
        this: &EncodedSlice,
        global: &JSGlobalObject,
        code: u8,
    ) -> JSValue;
    safe fn EncodedSlice__toValueGC(this: &EncodedSlice, global: &JSGlobalObject) -> JSValue;
    // EncodedSlice__toExternalValue: use the generated `cpp::` re-export (canonical signature).
    // safe: `EncodedSlice`/`JSGlobalObject` are `#[repr(C)]`/opaque-ZST handles (`&`
    // is ABI-identical to non-null `*const`); `ctx` is an opaque round-trip
    // pointer C++ stores into the external string's finalizer slot and forwards
    // to `callback` on GC (never dereferenced as Rust data) — same contract as
    // `JSC__JSGlobalObject__queueMicrotaskCallback`. The caller-side ownership
    // transfer is documented at the (already-safe) public wrapper.
    safe fn EncodedSlice__external(
        this: &EncodedSlice,
        global: &JSGlobalObject,
        ctx: *mut core::ffi::c_void,
        callback: unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize),
    ) -> JSValue;
}

/// The bytes are copied into the message.
fn error_instance(slice: &EncodedSlice<'_>, global: &JSGlobalObject, kind: ErrorKind) -> JSValue {
    bun_string_jsc::error_instance(&StringView::from_encoded(*slice), global, kind)
}

/// JSC conversions for `bun_core::EncodedSlice`.
pub trait EncodedSliceJsc: Sized {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_dom_exception_instance(&self, global: &JSGlobalObject, code: DOMExceptionCode)
    -> JSValue;
    /// Copies into a GC-managed `JSString` (or hands over an external value
    /// if globally allocated).
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    /// Transfers ownership of a globally-allocated buffer to JSC's
    /// external-string finalizer.
    fn to_external_value(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    /// `JSON.parse` over the bytes.
    fn to_json_object(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    /// Like `to_external_value` but with a caller-supplied `ctx` + finalizer
    /// callback (used to keep a `Blob::Store` ref alive).
    ///
    /// # Safety
    /// `ctx` and the string's backing buffer must satisfy `callback`'s contract;
    /// ownership of both transfers to JSC, which invokes `callback` exactly once.
    unsafe fn external(
        &self,
        global: &JSGlobalObject,
        ctx: *mut core::ffi::c_void,
        callback: unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize),
    ) -> JsResult<JSValue>;
}
impl EncodedSliceJsc for EncodedSlice<'_> {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        error_instance(self, global, ErrorKind::Error)
    }
    fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        error_instance(self, global, ErrorKind::SyntaxError)
    }
    fn to_dom_exception_instance(
        &self,
        global: &JSGlobalObject,
        code: DOMExceptionCode,
    ) -> JSValue {
        EncodedSlice__toDOMExceptionInstance(self, global, code as u8)
    }
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        debug_assert!(!self.is_globally_allocated());
        EncodedSlice__toValueGC(self, global)
    }
    fn to_external_value(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if self.len > bun_core::String::max_length() {
            // SAFETY: contract — bytes were allocated by the default (global)
            // allocator. `default_alloc::free` agrees with the
            // `#[global_allocator]` (`mi_free` normally; libc free under ASAN).
            unsafe {
                bun_alloc::default_alloc::free(
                    self.byte_slice()
                        .as_ptr()
                        .cast_mut()
                        .cast::<core::ffi::c_void>(),
                )
            };
            return Err(global.throw_string_too_long());
        }
        // SAFETY: `self` is a valid `&EncodedSlice`; `JSGlobalObject` is an opaque
        // `UnsafeCell`-backed handle so `&` → `*mut` is its intended FFI shape.
        Ok(unsafe { cpp::EncodedSlice__toExternalValue(self, global.as_ptr()) })
    }
    fn to_json_object(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `self` is a live `&EncodedSlice` for the duration of the call.
        unsafe { cpp::EncodedSlice__toJSONObject(self, global) }
    }
    unsafe fn external(
        &self,
        global: &JSGlobalObject,
        ctx: *mut core::ffi::c_void,
        callback: unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize),
    ) -> JsResult<JSValue> {
        if self.len > bun_core::String::max_length() {
            // SAFETY: invoking the caller-supplied finalizer on the buffer it owns.
            unsafe {
                callback(
                    ctx,
                    self.byte_slice()
                        .as_ptr()
                        .cast_mut()
                        .cast::<core::ffi::c_void>(),
                    self.len,
                )
            };
            return Err(global.throw_string_too_long());
        }
        // Ownership of the buffer + `ctx` transfers to JSC's finalizer.
        Ok(EncodedSlice__external(self, global, ctx, callback))
    }
}
