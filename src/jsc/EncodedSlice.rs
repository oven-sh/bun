//! JSC bridges for `bun_core::EncodedSlice`: the `EncodedSliceJsc` extension
//! trait and the `EncodedSlice__freeGlobal` callback.

use core::ffi::c_void;

use crate::bun_string_jsc::{self, ErrorKind};
use crate::webcore_types::store::Store;
use crate::{DOMExceptionCode, JSGlobalObject, JSValue, JsResult, cpp};
use bun_core::{EncodedSlice, StringView};
use bun_ptr::RefPtr;

/// # Safety
/// `ptr` must be a (possibly tagged) pointer to `len` bytes allocated by the
/// default allocator.
#[unsafe(no_mangle)]
unsafe extern "C" fn EncodedSlice__freeGlobal(ptr: *const u8, _len: usize) {
    let untagged = bun_core::EncodedSlice::untagged(ptr)
        .cast_mut()
        .cast::<c_void>();
    if bun_alloc::USE_MIMALLOC {
        debug_assert!(bun_alloc::mimalloc::mi_is_in_heap_region(untagged));
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
    fn EncodedSlice__external(
        this: &EncodedSlice,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *mut c_void, usize),
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
    /// Copies into a GC-managed `JSString`.
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    /// Transfers ownership of a globally-allocated buffer to JSC's
    /// external-string finalizer. `None`, with the buffer freed, when it is too long for a string.
    fn try_to_external_value(&self, global: &JSGlobalObject) -> Option<JSValue>;
    /// `JSON.parse` over the bytes.
    fn to_json_object(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    /// Like `try_to_external_value`, for bytes that `store` owns: the string keeps the ref.
    ///
    /// # Safety
    /// The bytes stay valid and unchanged until `store` is dropped.
    unsafe fn external(&self, global: &JSGlobalObject, store: RefPtr<Store>) -> JsResult<JSValue>;
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
        EncodedSlice__toValueGC(self, global)
    }
    fn try_to_external_value(&self, global: &JSGlobalObject) -> Option<JSValue> {
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
            return None;
        }
        // SAFETY: `self` is a valid `&EncodedSlice`; `JSGlobalObject` is an opaque
        // `UnsafeCell`-backed handle so `&` → `*mut` is its intended FFI shape.
        Some(unsafe { cpp::EncodedSlice__toExternalValue(self, global.as_ptr()) })
    }
    fn to_json_object(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        cpp::EncodedSlice__toJSONObject(self, global)
    }
    unsafe fn external(&self, global: &JSGlobalObject, store: RefPtr<Store>) -> JsResult<JSValue> {
        extern "C" fn release(store: RefPtr<Store>, _: *mut c_void, _: usize) {
            drop(store);
        }
        if self.len > bun_core::String::max_length() {
            drop(store);
            return Err(global.throw_string_too_long());
        }
        // SAFETY: fn contract. A `RefPtr` is a thin pointer, and JSC passes this one to `release`, once.
        Ok(unsafe {
            let release = bun_ptr::cast_fn_ptr::<
                extern "C" fn(RefPtr<Store>, *mut c_void, usize),
                unsafe extern "C" fn(*mut c_void, *mut c_void, usize),
            >(release);
            EncodedSlice__external(self, global, store.into_raw().cast(), release)
        })
    }
}
