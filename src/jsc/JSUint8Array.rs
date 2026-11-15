use crate::{ArrayBuffer, JSGlobalObject, JSValue, JsResult};

bun_opaque::sealed_handle! {
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

    pub fn create_empty(global: &JSGlobalObject) -> JsResult<JSValue> {
        ArrayBuffer::create_uint8_array(global, &[])
    }
}

unsafe extern "C" {
    pub(crate) fn JSUint8Array__fromDefaultAllocator(
        global: *const JSGlobalObject,
        ptr: *mut u8,
        len: usize,
    ) -> JSValue;
}
