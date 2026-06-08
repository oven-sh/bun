use core::ffi::c_void;
use core::ptr;

use crate::{Alignment, Allocator};
// The libc-malloc-backed allocator.
use super::C_ALLOCATOR as c_allocator;

/// A fallback zero-initializing allocator.
//
// The public export is a ZST implementing the `Allocator` trait. Consumers
// borrow `&ALLOCATOR` (coerces to `&dyn Allocator`).
pub static ALLOCATOR: Z = Z;

#[derive(Clone, Copy, Default)]
pub struct Z;

// `Allocator` is a marker trait carrying `type_id()`; the allocation methods
// are inherent on `Z` below.
impl Allocator for Z {}

impl Z {
    pub fn alloc(
        &self,
        len: usize,
        alignment: Alignment,
        return_address: usize,
    ) -> Option<*mut u8> {
        let result = c_allocator.raw_alloc(len, alignment, return_address)?;
        // SAFETY: `result` points to a fresh allocation of at least `len` bytes.
        unsafe { ptr::write_bytes(result, 0, len) };
        Some(result)
    }

    /// # Safety
    /// `buf` must describe a live allocation obtained from [`Self::alloc`]
    /// with `alignment`.
    pub unsafe fn resize(
        &self,
        buf: &mut [u8],
        alignment: Alignment,
        new_len: usize,
        return_address: usize,
    ) -> bool {
        // SAFETY: caller contract — `Self::alloc` allocates via `c_allocator`.
        if !unsafe { c_allocator.raw_resize(buf, alignment, new_len, return_address) } {
            return false;
        }
        let old_len = buf.len();
        // Only zero on grow. On shrink (`new_len < old_len`), `new_len - old_len`
        // would underflow to ~usize::MAX and `write_bytes` would corrupt the heap.
        if new_len > old_len {
            // SAFETY: `raw_resize` succeeded in-place, so `buf.ptr[old_len..new_len]`
            // is now valid uninitialized memory owned by this allocation.
            unsafe { ptr::write_bytes(buf.as_mut_ptr().add(old_len), 0, new_len - old_len) };
        }
        true
    }

    // `.remap = Allocator.noRemap` — the mimalloc z_allocator doesn't support remap.
    pub fn remap(
        self,
        _buf: &mut [u8],
        _alignment: Alignment,
        _new_len: usize,
        _return_address: usize,
    ) -> Option<*mut u8> {
        None
    }

    /// # Safety
    /// `buf` must describe a live allocation obtained from [`Self::alloc`]
    /// with `alignment`. The allocation is freed exactly once; its memory must
    /// not be accessed after this call.
    pub unsafe fn free(self, buf: &mut [u8], alignment: Alignment, return_address: usize) {
        // SAFETY: caller contract — `Self::alloc` allocates via `c_allocator`.
        unsafe { c_allocator.raw_free(buf, alignment, return_address) };
    }
}

// Keeps the `c_void`/`ptr` imports referenced from every cfg combination.
const _: fn() -> *mut c_void = || ptr::null_mut();
