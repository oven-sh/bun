use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use crate::sizes;
use crate::{JSGlobalObject, JSValue};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a JSC `JSUint8Array` cell.
    pub struct JSUint8Array;
}

impl JSUint8Array {
    pub fn ptr(&self) -> *mut u8 {
        // SAFETY: `self` points at a live JSUint8Array cell; the typed-array vector
        // pointer lives at a fixed byte offset computed by the C++ codegen (sizes.zig).
        // Using byte_add preserves provenance vs. the Zig `@ptrFromInt(@intFromPtr(..)+off)`.
        unsafe {
            std::ptr::from_ref::<Self>(self)
                .byte_add(sizes::BUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_VECTOR)
                .cast::<*mut u8>()
                .read()
        }
    }

    pub fn len(&self) -> usize {
        // SAFETY: same invariant as `ptr()` — fixed byte offset into the JSUint8Array
        // cell where the typed-array length is stored.
        unsafe {
            std::ptr::from_ref::<Self>(self)
                .byte_add(sizes::BUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_LENGTH)
                .cast::<usize>()
                .read()
        }
    }

    pub fn slice(&mut self) -> &mut [u8] {
        // PORT NOTE: detached/empty JSUint8Array has ptr=null, len=0. Zig `ptr[0..0]` is
        // valid for any ptr; `ffi::slice_mut` tolerates `(null, 0)` so no extra guard.
        // SAFETY: JSC guarantees `ptr()` is valid for `len()` bytes while the cell is alive.
        unsafe { bun_core::ffi::slice_mut(self.ptr(), self.len()) }
    }

    /// `bytes` must come from `bun.default_allocator` (the global mimalloc allocator);
    /// ownership is transferred to the returned JS Uint8Array.
    // PORT NOTE: Zig took `[]u8` + a doc comment requiring default_allocator provenance.
    // In Rust the global allocator IS mimalloc, so `Box<[u8]>` encodes that ownership.
    pub fn from_bytes(global: &JSGlobalObject, bytes: Box<[u8]>) -> JSValue {
        let len = bytes.len();
        let ptr = bun_core::heap::into_raw(bytes).cast::<u8>();
        // SAFETY: `ptr`/`len` describe a heap allocation from the global (mimalloc)
        // allocator; the C++ side adopts and later frees it with the same allocator.
        unsafe { JSUint8Array__fromDefaultAllocator(global, ptr, len) }
    }

    pub fn from_bytes_copy(global: &JSGlobalObject, bytes: &[u8]) -> JSValue {
        // SAFETY: C++ copies `len` bytes out of `ptr`; it does not retain the pointer.
        unsafe {
            Bun__createUint8ArrayForCopy(
                global,
                bytes.as_ptr().cast::<c_void>(),
                bytes.len(),
                false,
            )
        }
    }

    pub fn create_empty(global: &JSGlobalObject) -> JSValue {
        // SAFETY: null/0 is the documented "empty" input for this FFI entrypoint.
        unsafe { Bun__createUint8ArrayForCopy(global, core::ptr::null(), 0, false) }
    }
}

// TODO(port): move to jsc_sys
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

// ported from: src/jsc/JSUint8Array.zig
