use core::ffi::c_void;
use core::ptr;

use crate::{Alignment, Allocator};
// TODO(port): `std.heap.c_allocator` — the libc-malloc-backed allocator. In the
// `bun_alloc::fallback` module this is the sibling C allocator; Phase B wires
// the exact path (`super::c::ALLOCATOR` or equivalent).
use super::C_ALLOCATOR as c_allocator;

/// A fallback zero-initializing allocator.
//
// Zig: `pub const allocator = Allocator{ .ptr = undefined, .vtable = &vtable };`
// `std.mem.Allocator` is a `{ptr, vtable}` fat struct — the Rust mapping is
// `&dyn bun_alloc::Allocator`, so the public export is a ZST implementing the
// trait. Consumers borrow `&ALLOCATOR` (coerces to `&dyn Allocator`).
pub static ALLOCATOR: Z = Z;

#[derive(Clone, Copy, Default)]
pub struct Z;

// Zig: `const vtable = Allocator.VTable{ .alloc, .resize, .remap = noRemap, .free }`
impl Allocator for Z {
    fn alloc(
        &self, // Zig: `_: *anyopaque` (unused vtable ctx)
        len: usize,
        alignment: Alignment,
        return_address: usize,
    ) -> Option<*mut u8> {
        let result = c_allocator.raw_alloc(len, alignment, return_address)?;
        // SAFETY: `result` points to a fresh allocation of at least `len` bytes.
        unsafe { ptr::write_bytes(result, 0, len) };
        Some(result)
    }

    fn resize(
        &self, // Zig: `_: *anyopaque`
        buf: &mut [u8],
        alignment: Alignment,
        new_len: usize,
        return_address: usize,
    ) -> bool {
        if !c_allocator.raw_resize(buf, alignment, new_len, return_address) {
            return false;
        }
        // PORT NOTE: reshaped for borrowck — capture len before re-deriving the
        // tail pointer (Zig: `buf.ptr[buf.len..new_len]`).
        let old_len = buf.len();
        // SAFETY: `raw_resize` succeeded in-place, so `buf.ptr[old_len..new_len]`
        // is now valid uninitialized memory owned by this allocation.
        unsafe { ptr::write_bytes(buf.as_mut_ptr().add(old_len), 0, new_len - old_len) };
        true
    }

    // `.remap = Allocator.noRemap` — the mimalloc z_allocator doesn't support remap.
    // Use the trait's default `no_remap` impl.
    fn remap(
        &self,
        _buf: &mut [u8],
        _alignment: Alignment,
        _new_len: usize,
        _return_address: usize,
    ) -> Option<*mut u8> {
        None
    }

    fn free(
        &self, // Zig: `_: *anyopaque`
        buf: &mut [u8],
        alignment: Alignment,
        return_address: usize,
    ) {
        c_allocator.raw_free(buf, alignment, return_address);
    }
}

// `*anyopaque` in the Zig vtable signatures maps to `*mut c_void`, but since the
// ctx pointer is unused (`.ptr = undefined`) it collapses to `&self` on a ZST.
const _: fn() -> *mut c_void = || ptr::null_mut();

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/fallback/z.zig (43 lines)
//   confidence: medium
//   todos:      1
//   notes:      vtable→trait-impl on ZST; c_allocator import path needs Phase-B wiring
// ──────────────────────────────────────────────────────────────────────────
