use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a JSC `JSUint8Array` cell.
    pub struct JSUint8Array;
}

impl JSUint8Array {
    /// `bytes` must come from `bun.default_allocator` (the global mimalloc allocator);
    /// ownership is transferred to the returned JS Uint8Array (and is released by the
    /// C++ side if the allocation throws).
    // The global allocator IS mimalloc, so `Box<[u8]>` encodes that ownership.
    pub fn from_bytes(global: &JSGlobalObject, bytes: Box<[u8]>) -> JsResult<JSValue> {
        let len = bytes.len();
        let ptr = bun_core::heap::into_raw(bytes).cast::<u8>();
        // SAFETY: `ptr`/`len` describe a heap allocation from the global (mimalloc)
        // allocator; the C++ side adopts and later frees it with the same allocator.
        crate::call_zero_is_throw(global, || unsafe {
            JSUint8Array__fromDefaultAllocator(global, ptr, len)
        })
    }

    pub fn from_bytes_copy(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
        // SAFETY: C++ copies `len` bytes out of `ptr`; it does not retain the pointer.
        crate::call_zero_is_throw(global, || unsafe {
            Bun__createUint8ArrayForCopy(
                global,
                bytes.as_ptr().cast::<c_void>(),
                bytes.len(),
                false,
            )
        })
    }

    pub fn create_empty(global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: null/0 is the documented "empty" input for this FFI entrypoint.
        crate::call_zero_is_throw(global, || unsafe {
            Bun__createUint8ArrayForCopy(global, core::ptr::null(), 0, false)
        })
    }
}

unsafe extern "C" {
    fn JSUint8Array__fromDefaultAllocator(
        global: *const JSGlobalObject,
        ptr: *mut u8,
        len: usize,
    ) -> JSValue;

    fn Bun__createUint8ArrayForCopy(
        global: *const JSGlobalObject,
        ptr: *const c_void,
        len: usize,
        buffer: bool,
    ) -> JSValue;
}
