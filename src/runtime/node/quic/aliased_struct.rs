//! Node's `AliasedStruct` (node/src/aliased_struct.h): a struct that script reads and writes as an ArrayBuffer.

use core::ffi::c_void;
use core::ptr::null_mut;
use std::sync::Arc;

use bun_core::Pod;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsCell, JsResult};

/// The ArrayBuffer holds a reference, so detaching or transferring it does not free `T`.
pub(super) struct AliasedStruct<T>(Arc<JsCell<T>>);

impl<T: Pod> AliasedStruct<T> {
    pub(super) fn zeroed() -> Self {
        Self(Arc::new(JsCell::new(bun_core::ffi::zeroed())))
    }

    /// `f` must not run script or reach this struct again.
    pub(super) fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        self.0.with_mut(f)
    }

    pub(super) fn to_array_buffer(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        unsafe extern "C" fn deallocator<T>(ptr: *mut c_void, _: *mut c_void) {
            // SAFETY: the reference that `to_array_buffer` took.
            drop(unsafe { Arc::from_raw(ptr.cast::<JsCell<T>>()) });
        }
        let buffer = ArrayBuffer {
            ptr: Arc::into_raw(Arc::clone(&self.0)).cast_mut().cast(),
            len: size_of::<T>(),
            byte_len: size_of::<T>(),
            typed_array_type: JSType::ArrayBuffer,
            ..Default::default()
        };
        // SAFETY: the bytes are initialized, are in a cell, can take any value, and live until
        // `deallocator` runs. Any thread can run it: the count is atomic and `T` has no `Drop`.
        unsafe { buffer.to_js_with_context(global, null_mut(), Some(deallocator::<T>)) }
    }
}

pub(super) fn put_state_and_stats(
    global: &JSGlobalObject,
    handle: JSValue,
    state: JSValue,
    stats: JSValue,
    stats_byte_offset: usize,
) {
    handle.put(global, b"state", state);
    handle.put(global, b"stats", stats);
    handle.put(global, b"stateByteOffset", JSValue::js_number(0.0));
    let stats_byte_offset = JSValue::js_number(stats_byte_offset as f64);
    handle.put(global, b"statsByteOffset", stats_byte_offset);
}
