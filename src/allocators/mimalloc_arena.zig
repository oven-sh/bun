const mem = @import("std").mem;
const std = @import("std");

const mimalloc = @import("./mimalloc.zig");
const Environment = @import("../env.zig");
const FeatureFlags = @import("../feature_flags.zig");
const Allocator = mem.Allocator;
const assert = bun.assert;
const bun = @import("bun");
const log = bun.Output.scoped(.mimalloc, true);

pub const Arena = struct {
    heap: ?*mimalloc.Heap = null,

    /// Internally, mimalloc calls mi_heap_get_default()
    /// to get the default heap.
    /// It uses pthread_getspecific to do that.
    /// We can save those extra calls if we just do it once in here
    pub fn getThreadlocalDefault() Allocator {
        return Allocator{ .ptr = mimalloc.mi_heap_get_default(), .vtable = &c_allocator_vtable };
    }

    pub fn backingAllocator(this: Arena) Allocator {
        var arena = Arena{ .heap = this.heap.?.backing() };
        return arena.allocator();
    }

    pub fn allocator(this: Arena) Allocator {
        @setRuntimeSafety(false);
        return Allocator{ .ptr = this.heap.?, .vtable = &c_allocator_vtable };
    }

    pub fn dumpThreadStats(_: *Arena) void {
        const dump_fn = struct {
            pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.C) void {
                const text = bun.span(textZ);
                bun.Output.errorWriter().writeAll(text) catch {};
            }
        }.dump;
        mimalloc.mi_thread_stats_print_out(dump_fn, null);
        bun.Output.flush();
    }

    pub fn dumpStats(_: *Arena) void {
        const dump_fn = struct {
            pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.C) void {
                const text = bun.span(textZ);
                bun.Output.errorWriter().writeAll(text) catch {};
            }
        }.dump;
        mimalloc.mi_stats_print_out(dump_fn, null);
        bun.Output.flush();
    }

    pub fn deinit(this: *Arena) void {
        mimalloc.mi_heap_destroy(bun.take(&this.heap).?);
    }
    pub fn init() !Arena {
        const arena = Arena{ .heap = mimalloc.mi_heap_new() orelse return error.OutOfMemory };
        return arena;
    }

    pub fn gc(this: Arena) void {
        mimalloc.mi_heap_collect(this.heap orelse return, false);
    }

    pub inline fn helpCatchMemoryIssues(this: Arena) void {
        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.gc();
            bun.Mimalloc.mi_collect(false);
        }
    }

    pub fn ownsPtr(this: Arena, ptr: *const anyopaque) bool {
        return mimalloc.mi_heap_check_owned(this.heap.?, ptr);
    }
    pub const supports_posix_memalign = true;

    fn alignedAlloc(heap: *mimalloc.Heap, len: usize, alignment: mem.Alignment) ?[*]u8 {
        log("Malloc: {d}\n", .{len});

        const ptr: ?*anyopaque = if (mimalloc.canUseAlignedAlloc(len, alignment.toByteUnits()))
            mimalloc.mi_heap_malloc_aligned(heap, len, alignment.toByteUnits())
        else
            mimalloc.mi_heap_malloc(heap, len);

        if (comptime Environment.isDebug) {
            const usable = mimalloc.mi_malloc_usable_size(ptr);
            if (usable < len) {
                std.debug.panic("mimalloc: allocated size is too small: {d} < {d}", .{ usable, len });
            }
        }

        return if (ptr) |p|
            @as([*]u8, @ptrCast(p))
        else
            null;
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return mimalloc.mi_malloc_usable_size(ptr);
    }

    fn alloc(arena: *anyopaque, len: usize, alignment: mem.Alignment, _: usize) ?[*]u8 {
        const this = bun.cast(*mimalloc.Heap, arena);

        return alignedAlloc(
            this,
            len,
            alignment,
        );
    }

    fn resize(_: *anyopaque, buf: []u8, _: mem.Alignment, new_len: usize, _: usize) bool {
        return mimalloc.mi_expand(buf.ptr, new_len) != null;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        alignment: mem.Alignment,
        _: usize,
    ) void {
        // mi_free_size internally just asserts the size
        // so it's faster if we don't pass that value through
        // but its good to have that assertion
        if (comptime Environment.isDebug) {
            assert(mimalloc.mi_is_in_heap_region(buf.ptr));
            if (mimalloc.canUseAlignedAlloc(buf.len, alignment.toByteUnits()))
                mimalloc.mi_free_size_aligned(buf.ptr, buf.len, alignment.toByteUnits())
            else
                mimalloc.mi_free_size(buf.ptr, buf.len);
        } else {
            mimalloc.mi_free(buf.ptr);
        }
    }

    /// Attempt to expand or shrink memory, allowing relocation.
    ///
    /// `memory.len` must equal the length requested from the most recent
    /// successful call to `alloc`, `resize`, or `remap`. `alignment` must
    /// equal the same value that was passed as the `alignment` parameter to
    /// the original `alloc` call.
    ///
    /// A non-`null` return value indicates the resize was successful. The
    /// allocation may have same address, or may have been relocated. In either
    /// case, the allocation now has size of `new_len`. A `null` return value
    /// indicates that the resize would be equivalent to allocating new memory,
    /// copying the bytes from the old memory, and then freeing the old memory.
    /// In such case, it is more efficient for the caller to perform the copy.
    ///
    /// `new_len` must be greater than zero.
    ///
    /// `ret_addr` is optionally provided as the first return address of the
    /// allocation call stack. If the value is `0` it means no return address
    /// has been provided.
    fn remap(this: *anyopaque, buf: []u8, alignment: mem.Alignment, new_len: usize, _: usize) ?[*]u8 {
        const aligned_size = alignment.toByteUnits();
        const value = mimalloc.mi_heap_realloc_aligned(@ptrCast(this), buf.ptr, new_len, aligned_size);
        return @ptrCast(value);
    }
};

const c_allocator_vtable = Allocator.VTable{
    .alloc = &Arena.alloc,
    .resize = &Arena.resize,
    .remap = &Arena.remap,
    .free = &Arena.free,
};
