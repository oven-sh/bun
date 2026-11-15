//! Node's `AliasedStruct` (node/src/aliased_struct.h): a struct that script reads and writes as an ArrayBuffer.

use core::ffi::c_void;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicI64, AtomicU8, AtomicU16, AtomicU32, AtomicU64};
use std::sync::Arc;

use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult};

/// Script can transfer the ArrayBuffer to another thread and write to it there.
///
/// # Safety
/// Every byte of `Self` is part of an atomic integer.
pub(crate) unsafe trait AllAtomic: Send + Sync + 'static {}

// SAFETY: an atomic integer.
unsafe impl AllAtomic for AtomicU8 {}
// SAFETY: as above.
unsafe impl AllAtomic for AtomicU16 {}
// SAFETY: as above.
unsafe impl AllAtomic for AtomicU32 {}
// SAFETY: as above.
unsafe impl AllAtomic for AtomicU64 {}
// SAFETY: as above.
unsafe impl AllAtomic for AtomicI64 {}
// SAFETY: an array holds nothing but its elements, with no padding between them.
unsafe impl<T: AllAtomic, const N: usize> AllAtomic for [T; N] {}

/// Defines a `#[repr(C)]` struct that is [`AllAtomic`]. Padding has to be a field.
macro_rules! all_atomic_struct {
    ($(#[$meta:meta])* $vis:vis struct $Name:ident { $($field_vis:vis $field:ident: $Field:ty),+ $(,)? }) => {
        $(#[$meta])*
        #[repr(C)]
        $vis struct $Name { $($field_vis $field: $Field),+ }

        const _: () = assert!(size_of::<$Name>() == 0 $(+ size_of::<$Field>())+);
        // SAFETY: each field is `AllAtomic`, and the assertion shows that there is no padding.
        unsafe impl $crate::node::quic::aliased_struct::AllAtomic for $Name
        where
            $($Field: $crate::node::quic::aliased_struct::AllAtomic),+
        {
        }
    };
}
pub(super) use all_atomic_struct;

/// The ArrayBuffer holds a reference, so detaching or transferring it does not free `T`.
pub(super) struct AliasedStruct<T>(Arc<T>);

impl<T: AllAtomic> AliasedStruct<T> {
    pub(super) fn new(value: T) -> Self {
        Self(Arc::new(value))
    }

    pub(super) fn to_array_buffer(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        unsafe extern "C" fn deallocator<T>(ptr: *mut c_void, _: *mut c_void) {
            // SAFETY: the reference that `to_array_buffer` took.
            drop(unsafe { Arc::from_raw(ptr.cast::<T>()) });
        }
        let buffer = ArrayBuffer {
            ptr: Arc::into_raw(Arc::clone(&self.0)).cast_mut().cast(),
            len: size_of::<T>(),
            byte_len: size_of::<T>(),
            typed_array_type: JSType::ArrayBuffer,
            ..Default::default()
        };
        // SAFETY: the bytes are initialized, can be written while they are shared, can take any
        // value, and live until `deallocator` runs. `T` is `Send` and `Sync`, so any thread can run it.
        unsafe { buffer.to_js_with_context(global, null_mut(), Some(deallocator::<T>)) }
    }
}

impl<T> core::ops::Deref for AliasedStruct<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
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
