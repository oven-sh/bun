const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

const mimalloc = @import("./allocators/mimalloc.zig");
const Environment = @import("./env.zig");
const FeatureFlags = @import("./feature_flags.zig");
const Allocator = mem.Allocator;
const assert = std.debug.assert;
const bun = @import("bun");

pub const GlobalArena = struct {
    arena: Arena,
    fallback_allocator: std.mem.Allocator,

    pub fn initWithCapacity(capacity: usize, fallback: std.mem.Allocator) error{OutOfMemory}!GlobalArena {
        const arena = try Arena.initWithCapacity(capacity);

        return GlobalArena{
            .arena = arena,
            .fallback_allocator = fallback,
        };
    }

    pub fn allocator(this: *GlobalArena) Allocator {
        return std.mem.Allocator.init(this, alloc, resize, free);
    }

    fn alloc(
        self: *GlobalArena,
        len: usize,
        ptr_align: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        return self.arena.alloc(len, ptr_align, len_align, return_address) catch
            return self.fallback_allocator.rawAlloc(len, ptr_align, len_align, return_address);
    }

    fn resize(
        self: *GlobalArena,
        buf: []u8,
        buf_align: u29,
        new_len: usize,
        len_align: u29,
        return_address: usize,
    ) ?usize {
        if (self.arena.ownsPtr(buf.ptr)) {
            return self.arena.resize(buf, buf_align, new_len, len_align, return_address);
        } else {
            return self.fallback_allocator.rawResize(buf, buf_align, new_len, len_align, return_address);
        }
    }

    fn free(
        self: *GlobalArena,
        buf: []u8,
        buf_align: u29,
        return_address: usize,
    ) void {
        if (self.arena.ownsPtr(buf.ptr)) {
            return self.arena.free(buf, buf_align, return_address);
        } else {
            return self.fallback_allocator.rawFree(buf, buf_align, return_address);
        }
    }
};

pub const Arena = struct {
    heap: ?*mimalloc.Heap = null,
    arena_id: mimalloc.ArenaID = -1,

    pub fn initWithCapacity(capacity: usize) error{OutOfMemory}!Arena {
        var arena_id: mimalloc.ArenaID = -1;

        std.debug.assert(capacity >= 8 * 1024 * 1024); // mimalloc requires a minimum of 8MB
        // which makes this not very useful for us!

        if (!mimalloc.mi_manage_os_memory_ex(null, capacity, true, true, false, -1, true, &arena_id)) {
            if (!mimalloc.mi_manage_os_memory_ex(null, capacity, false, false, false, -1, true, &arena_id)) {
                return error.OutOfMemory;
            }
        }
        std.debug.assert(arena_id != -1);

        var heap = mimalloc.mi_heap_new_in_arena(arena_id) orelse return error.OutOfMemory;
        return Arena{
            .heap = heap,
            .arena_id = arena_id,
        };
    }

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

    pub fn deinit(this: *Arena) void {
        mimalloc.mi_heap_destroy(this.heap.?);

        this.heap = null;
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

    pub fn reset(this: *Arena) void {
        this.deinit();
        this.* = init() catch unreachable;
    }

    pub fn init() !Arena {
        return Arena{ .heap = mimalloc.mi_heap_new() orelse return error.OutOfMemory };
    }

    pub fn gc(this: Arena, force: bool) void {
        mimalloc.mi_heap_collect(this.heap orelse return, force);
    }

    pub fn ownsPtr(this: Arena, ptr: *const anyopaque) bool {
        return mimalloc.mi_heap_check_owned(this.heap.?, ptr);
    }

    // Copied from rust
    const MI_MAX_ALIGN_SIZE = 16;
    inline fn mi_malloc_satisfies_alignment(alignment: usize, size: usize) bool {
        return (alignment == @sizeOf(*anyopaque) or
            (alignment == MI_MAX_ALIGN_SIZE and size >= (MI_MAX_ALIGN_SIZE / 2)));
    }

    fn alignedAlloc(heap: *mimalloc.Heap, len: usize, alignment: usize) ?[*]u8 {
        if (comptime FeatureFlags.log_allocations) std.debug.print("Malloc: {d}\n", .{len});

        var ptr = if (mi_malloc_satisfies_alignment(alignment, len))
            mimalloc.mi_heap_malloc(heap, len)
        else
            mimalloc.mi_heap_malloc_aligned(heap, len, alignment);

        return @ptrCast([*]u8, ptr orelse return null);
    }

    pub fn alloc(
        arena: *anyopaque,
        len: usize,
        alignment: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        _ = return_address;
        assert(len > 0);
        assert(std.math.isPowerOfTwo(alignment));

        var ptr = alignedAlloc(@ptrCast(*mimalloc.Heap, arena), len, alignment) orelse return error.OutOfMemory;
        if (len_align == 0) {
            return ptr[0..len];
        }

        // std.mem.Allocator asserts this, we do it here so we can see the metadata
        if (comptime Environment.allow_assert) {
            const size = mem.alignBackwardAnyAlign(mimalloc.mi_usable_size(ptr), len_align);

            assert(size >= len);
            return ptr[0..size];
        } else {
            return ptr[0..mem.alignBackwardAnyAlign(mimalloc.mi_usable_size(ptr), len_align)];
        }
    }

    pub fn resize(
        _: *anyopaque,
        buf: []u8,
        buf_align: u29,
        new_len: usize,
        len_align: u29,
        return_address: usize,
    ) ?usize {
        _ = buf_align;
        _ = return_address;

        if (new_len <= buf.len) {
            return mem.alignAllocLen(buf.len, new_len, len_align);
        }

        const full_len = mimalloc.mi_usable_size(buf.ptr);
        if (new_len <= full_len) {
            return mem.alignAllocLen(full_len, new_len, len_align);
        }

        return null;
    }

    pub fn free(
        _: *anyopaque,
        buf: []u8,
        buf_align: u29,
        return_address: usize,
    ) void {
        _ = buf_align;
        _ = return_address;
        if (comptime Environment.allow_assert) {
            assert(mimalloc.mi_is_in_heap_region(buf.ptr));
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, buf_align);
        } else {
            mimalloc.mi_free(buf.ptr);
        }
    }
};

const c_allocator_vtable = Allocator.VTable{
    .alloc = Arena.alloc,
    .resize = Arena.resize,
    .free = Arena.free,
};
