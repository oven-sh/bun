//! Node's `AliasedStruct` (node/src/aliased_struct.h): a struct that script reads and writes as an ArrayBuffer.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::null_mut;
use std::sync::Arc;

use bun_core::Pod;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult};

#[repr(C)]
struct Fields<S, const STATS: usize> {
    state: Cell<S>,
    stats: [Cell<u64>; STATS],
}

impl<S: Pod, const STATS: usize> Default for Fields<S, STATS> {
    fn default() -> Self {
        Self {
            state: Cell::new(bun_core::ffi::zeroed()),
            stats: [const { Cell::new(0) }; STATS],
        }
    }
}

/// The ArrayBuffer holds a reference, as script can keep it longer than the native object, and transfer it to another thread.
pub(super) struct AliasedStruct<S, const STATS: usize>(Arc<Fields<S, STATS>>);

impl<S: Pod, const STATS: usize> AliasedStruct<S, STATS> {
    pub(super) fn zeroed() -> Self {
        Self(Arc::default())
    }

    pub(super) fn state(&self) -> S {
        self.0.state.get()
    }

    /// What script writes while `f` runs is lost.
    pub(super) fn update_state(&self, f: impl FnOnce(&mut S)) {
        let mut state = self.0.state.get();
        f(&mut state);
        self.0.state.set(state);
    }

    /// They follow the state.
    pub(super) fn stats(&self) -> &[Cell<u64>; STATS] {
        &self.0.stats
    }

    pub(super) fn to_array_buffer(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        unsafe extern "C" fn deallocator<T>(ptr: *mut c_void, _: *mut c_void) {
            // SAFETY: the reference that `to_array_buffer` took.
            drop(unsafe { Arc::from_raw(ptr.cast::<T>()) });
        }
        let len = const {
            let len = size_of::<S>() + size_of::<[u64; STATS]>();
            assert!(len == size_of::<Fields<S, STATS>>());
            len
        };
        let buffer = ArrayBuffer {
            ptr: Arc::into_raw(Arc::clone(&self.0)).cast_mut().cast(),
            len,
            byte_len: len,
            typed_array_type: JSType::ArrayBuffer,
            ..Default::default()
        };
        let deallocator = deallocator::<Fields<S, STATS>>;
        // SAFETY: the bytes are `Pod`s in `Cell`s with no padding, and live until `deallocator` runs.
        // A `Pod` has no destructor, so on any thread that only changes the count and frees.
        unsafe { buffer.to_js_with_context(global, null_mut(), Some(deallocator)) }
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
