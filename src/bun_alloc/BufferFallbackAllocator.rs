//! An allocator that attempts to allocate from a provided buffer first,
//! falling back to another allocator when the buffer is exhausted.
//! Unlike `std.heap.StackFallbackAllocator`, this does not own the buffer.

use core::ffi::c_void;

use crate::{Alignment, AllocatorVTable, FixedBufferAllocator, StdAllocator};

pub struct BufferFallbackAllocator<'a> {
    fallback_allocator: StdAllocator,
    fixed_buffer_allocator: FixedBufferAllocator<'a>,
}

impl<'a> BufferFallbackAllocator<'a> {
    pub fn init(buffer: &'a mut [u8], fallback_allocator: StdAllocator) -> BufferFallbackAllocator<'a> {
        BufferFallbackAllocator {
            fallback_allocator,
            fixed_buffer_allocator: FixedBufferAllocator::init(buffer),
        }
    }

    pub fn allocator(&mut self) -> StdAllocator {
        StdAllocator {
            ptr: self as *mut Self as *mut c_void,
            vtable: &VTABLE,
        }
    }

    pub fn reset(&mut self) {
        self.fixed_buffer_allocator.reset();
    }
}

static VTABLE: AllocatorVTable = AllocatorVTable {
    alloc,
    resize,
    remap,
    free,
};

unsafe fn alloc(ctx: *mut c_void, len: usize, alignment: Alignment, ra: usize) -> *mut u8 {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator = unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    FixedBufferAllocator::alloc(&mut self_.fixed_buffer_allocator, len, alignment, ra)
        .or_else(|| self_.fallback_allocator.raw_alloc(len, alignment, ra))
        .unwrap_or(core::ptr::null_mut())
}

unsafe fn resize(ctx: *mut c_void, buf: &mut [u8], alignment: Alignment, new_len: usize, ra: usize) -> bool {
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

unsafe fn remap(ctx: *mut c_void, memory: &mut [u8], alignment: Alignment, new_len: usize, ra: usize) -> *mut u8 {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator = unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed_buffer_allocator.owns_ptr(memory.as_ptr()) {
        return FixedBufferAllocator::remap(
            &mut self_.fixed_buffer_allocator,
            memory,
            alignment,
            new_len,
            ra,
        )
        .unwrap_or(core::ptr::null_mut());
    }
    self_
        .fallback_allocator
        .raw_remap(memory, alignment, new_len, ra)
        .unwrap_or(core::ptr::null_mut())
}

unsafe fn free(ctx: *mut c_void, buf: &mut [u8], alignment: Alignment, ra: usize) {
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
//   confidence: high
//   todos:      0
//   notes:      Zig `Allocator` struct → `StdAllocator`; vtable hand-rolled.
// ──────────────────────────────────────────────────────────────────────────
