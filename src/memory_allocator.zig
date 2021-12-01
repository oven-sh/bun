const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

const mimalloc = @import("./allocators/mimalloc.zig");
const Allocator = mem.Allocator;
const assert = std.debug.assert;

const CAllocator = struct {
    comptime {
        if (!builtin.link_libc) {
            @compileError("C allocator is only available when linking against libc");
        }
    }
    pub const supports_malloc_size = true;
    pub const malloc_size = mimalloc.mi_malloc_size;
    pub const supports_posix_memalign = true;

    fn getHeader(ptr: [*]u8) *[*]u8 {
        return @intToPtr(*[*]u8, @ptrToInt(ptr) - @sizeOf(usize));
    }

    fn alignedAlloc(len: usize, alignment: usize) ?[*]u8 {
        if (supports_posix_memalign) {
            // The posix_memalign only accepts alignment values that are a
            // multiple of the pointer size

            var aligned_ptr: ?*c_void = undefined;
            if (mimalloc.mi_posix_memalign(&aligned_ptr, @maximum(alignment, @sizeOf(usize)), len) != 0)
                return null;

            return @ptrCast([*]u8, aligned_ptr);
        }

        // Thin wrapper around regular malloc, overallocate to account for
        // alignment padding and store the orignal malloc()'ed pointer before
        // the aligned address.
        var unaligned_ptr = @ptrCast([*]u8, mimalloc.mi_malloc(len + alignment - 1 + @sizeOf(usize)) orelse return null);
        const unaligned_addr = @ptrToInt(unaligned_ptr);
        const aligned_addr = mem.alignForward(unaligned_addr + @sizeOf(usize), alignment);
        var aligned_ptr = unaligned_ptr + (aligned_addr - unaligned_addr);
        getHeader(aligned_ptr).* = unaligned_ptr;

        return aligned_ptr;
    }

    fn alignedFree(ptr: [*]u8) void {
        if (supports_posix_memalign) {
            return mimalloc.mi_free(ptr);
        }

        const unaligned_ptr = getHeader(ptr).*;
        mimalloc.mi_free(unaligned_ptr);
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        if (supports_posix_memalign) {
            return malloc_size(ptr);
        }

        const unaligned_ptr = getHeader(ptr).*;
        const delta = @ptrToInt(ptr) - @ptrToInt(unaligned_ptr);
        return malloc_size(unaligned_ptr) - delta;
    }

    fn alloc(
        allocator: *Allocator,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        _ = allocator;
        _ = return_address;
        assert(len > 0);
        assert(std.math.isPowerOfTwo(alignment));

        var ptr = alignedAlloc(len, alignment) orelse return error.OutOfMemory;
        if (len_align == 0) {
            return ptr[0..len];
        }
        const full_len = init: {
            if (supports_malloc_size) {
                const s = alignedAllocSize(ptr);
                assert(s >= len);
                break :init s;
            }
            break :init len;
        };
        return ptr[0..mem.alignBackwardAnyAlign(full_len, len_align)];
    }

    fn resize(
        allocator: *Allocator,
        buf: []u8,
        buf_align: u29,
        new_len: usize,
        len_align: u29,
        return_address: usize,
    ) Allocator.Error!usize {
        _ = allocator;
        _ = buf_align;
        _ = return_address;
        if (new_len == 0) {
            alignedFree(buf.ptr);
            return 0;
        }
        if (new_len <= buf.len) {
            return mem.alignAllocLen(buf.len, new_len, len_align);
        }
        if (supports_malloc_size) {
            const full_len = alignedAllocSize(buf.ptr);
            if (new_len <= full_len) {
                return mem.alignAllocLen(full_len, new_len, len_align);
            }
        }

        return error.OutOfMemory;
    }
};

/// Supports the full Allocator interface, including alignment, and exploiting
/// `malloc_usable_size` if available. For an allocator that directly calls
/// `malloc`/`free`, see `raw_c_allocator`.
pub const c_allocator = &c_allocator_state;
var c_allocator_state = Allocator{
    .allocFn = CAllocator.alloc,
    .resizeFn = CAllocator.resize,
};
