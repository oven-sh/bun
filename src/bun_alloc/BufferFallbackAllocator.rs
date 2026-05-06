//! An allocator that attempts to allocate from a provided buffer first,
//! falling back to another allocator when the buffer is exhausted.
//! Unlike `std.heap.StackFallbackAllocator`, this does not own the buffer.

use core::ffi::c_void;

use crate::{Alignment, Allocator, FixedBufferAllocator};
// TODO(port): `Allocator` here is the Zig-style fat-pointer `{ ptr: *mut c_void, vtable: &'static VTable }`
// re-exported from `bun_alloc`. If Phase B models `bun_alloc::Allocator` as a trait instead,
// replace `allocator()` + the four vtable fns below with `impl Allocator for BufferFallbackAllocator`.

pub struct BufferFallbackAllocator<'a> {
    fallback_allocator: Allocator,
    fixed_buffer_allocator: FixedBufferAllocator<'a>,
}

impl<'a> BufferFallbackAllocator<'a> {
    pub fn init(buffer: &'a mut [u8], fallback_allocator: Allocator) -> BufferFallbackAllocator<'a> {
        BufferFallbackAllocator {
            fallback_allocator,
            fixed_buffer_allocator: FixedBufferAllocator::init(buffer),
        }
    }

    pub fn allocator(&mut self) -> Allocator {
        Allocator {
            ptr: self as *mut Self as *mut c_void,
            vtable: &crate::VTable {
                alloc,
                resize,
                remap,
                free,
            },
        }
    }

    pub fn reset(&mut self) {
        self.fixed_buffer_allocator.reset();
    }
}

fn alloc(ctx: *mut c_void, len: usize, alignment: Alignment, ra: usize) -> Option<*mut u8> {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator = unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    FixedBufferAllocator::alloc(&mut self_.fixed_buffer_allocator, len, alignment, ra)
        .or_else(|| self_.fallback_allocator.raw_alloc(len, alignment, ra))
}

fn resize(ctx: *mut c_void, buf: &mut [u8], alignment: Alignment, new_len: usize, ra: usize) -> bool {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator = unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed_buffer_allocator.owns_ptr(buf.as_ptr()) {
        return FixedBufferAllocator::resize(
            &mut self_.fixed_buffer_allocator,
            buf,
            alignment,
            new_len,
            ra,
        );
    }
    self_.fallback_allocator.raw_resize(buf, alignment, new_len, ra)
}

fn remap(ctx: *mut c_void, memory: &mut [u8], alignment: Alignment, new_len: usize, ra: usize) -> Option<*mut u8> {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator = unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed_buffer_allocator.owns_ptr(memory.as_ptr()) {
        return FixedBufferAllocator::remap(
            &mut self_.fixed_buffer_allocator,
            memory,
            alignment,
            new_len,
            ra,
        );
    }
    self_.fallback_allocator.raw_remap(memory, alignment, new_len, ra)
}

fn free(ctx: *mut c_void, buf: &mut [u8], alignment: Alignment, ra: usize) {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator = unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed_buffer_allocator.owns_ptr(buf.as_ptr()) {
        return FixedBufferAllocator::free(
            &mut self_.fixed_buffer_allocator,
            buf,
            alignment,
            ra,
        );
    }
    self_.fallback_allocator.raw_free(buf, alignment, ra)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/BufferFallbackAllocator.zig (85 lines)
//   confidence: medium
//   todos:      1
//   notes:      Assumes bun_alloc::Allocator is a Zig-style {ptr, vtable} struct; if Phase B uses a trait, fold the four vtable fns into `impl Allocator`.
// ──────────────────────────────────────────────────────────────────────────
