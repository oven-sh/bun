//! An allocator that attempts to allocate from a provided buffer first,
//! falling back to another allocator when the buffer is exhausted.
//! Unlike `std.heap.StackFallbackAllocator`, this does not own the buffer.

use core::ffi::c_void;

use crate::{Alignment, AllocatorVTable, FixedBufferAllocator, StdAllocator};

pub struct BufferFallbackAllocator<'a> {
    fallback: StdAllocator,
    fixed: FixedBufferAllocator<'a>,
}

impl<'a> BufferFallbackAllocator<'a> {
    pub fn init(buffer: &'a mut [u8], fallback: StdAllocator) -> BufferFallbackAllocator<'a> {
        BufferFallbackAllocator {
            fallback,
            fixed: FixedBufferAllocator::init(buffer),
        }
    }

    pub fn allocator(&mut self) -> StdAllocator {
        StdAllocator {
            ptr: std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            vtable: &VTABLE,
        }
    }

    pub fn reset(&mut self) {
        self.fixed.reset();
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
    let self_: &mut BufferFallbackAllocator =
        unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    FixedBufferAllocator::alloc(&mut self_.fixed, len, alignment, ra)
        .or_else(|| self_.fallback.raw_alloc(len, alignment, ra))
        .unwrap_or(core::ptr::null_mut())
}

unsafe fn resize(
    ctx: *mut c_void,
    buf: &mut [u8],
    alignment: Alignment,
    new_len: usize,
    ra: usize,
) -> bool {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator =
        unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed.owns_ptr(buf.as_ptr()) {
        return FixedBufferAllocator::resize(&mut self_.fixed, buf, alignment, new_len, ra);
    }
    self_.fallback.raw_resize(buf, alignment, new_len, ra)
}

unsafe fn remap(
    ctx: *mut c_void,
    memory: &mut [u8],
    alignment: Alignment,
    new_len: usize,
    ra: usize,
) -> *mut u8 {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator =
        unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed.owns_ptr(memory.as_ptr()) {
        return FixedBufferAllocator::remap(&mut self_.fixed, memory, alignment, new_len, ra)
            .unwrap_or(core::ptr::null_mut());
    }
    self_
        .fallback
        .raw_remap(memory, alignment, new_len, ra)
        .unwrap_or(core::ptr::null_mut())
}

unsafe fn free(ctx: *mut c_void, buf: &mut [u8], alignment: Alignment, ra: usize) {
    // SAFETY: ctx was set to `&mut BufferFallbackAllocator` in `allocator()`.
    let self_: &mut BufferFallbackAllocator =
        unsafe { &mut *ctx.cast::<BufferFallbackAllocator>() };
    if self_.fixed.owns_ptr(buf.as_ptr()) {
        return FixedBufferAllocator::free(&mut self_.fixed, buf, alignment, ra);
    }
    self_.fallback.raw_free(buf, alignment, ra)
}

// ported from: src/bun_alloc/BufferFallbackAllocator.zig
