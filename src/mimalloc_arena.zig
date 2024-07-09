const mem = @import("std").mem;
const builtin = @import("std").builtin;
const std = @import("std");

const mimalloc = @import("./allocators/mimalloc.zig");
const Environment = @import("./env.zig");
const FeatureFlags = @import("./feature_flags.zig");
const Allocator = mem.Allocator;
const assert = bun.assert;
const bun = @import("root").bun;
const log = bun.Output.scoped(.mimalloc, true);

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
        return .{
            .ptr = this,
            .vtable = &.{
                .alloc = alloc,
                .resize = resize,
                .free = free,
            },
        };
    }

    fn alloc(
        self: *GlobalArena,
        len: usize,
        ptr_align: u29,
        len_align: u29,
        return_address: usize,
    ) error{OutOfMemory}![]u8 {
        return self.arena.alloc(len, ptr_align, len_align, return_address) catch
            return self.fallback_allocator.rawAlloc(len, ptr_align, return_address) orelse return error.OutOfMemory;
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

const ArenaRegistry = struct {
    arenas: std.AutoArrayHashMap(?*mimalloc.Heap, std.Thread.Id) = std.AutoArrayHashMap(?*mimalloc.Heap, std.Thread.Id).init(bun.default_allocator),
    mutex: std.Thread.Mutex = .{},

    var registry = ArenaRegistry{};

    pub fn register(arena: Arena) void {
        if (comptime Environment.isDebug and Environment.isNative) {
            registry.mutex.lock();
            defer registry.mutex.unlock();
            const entry = registry.arenas.getOrPut(arena.heap.?) catch unreachable;
            const received = std.Thread.getCurrentId();

            if (entry.found_existing) {
                const expected = entry.value_ptr.*;
                if (expected != received) {
                    bun.unreachablePanic("Arena created on wrong thread! Expected: {d} received: {d}", .{
                        expected,
                        received,
                    });
                }
            }
            entry.value_ptr.* = received;
        }
    }

    pub fn assert(arena: Arena) void {
        if (comptime Environment.isDebug and Environment.isNative) {
            registry.mutex.lock();
            defer registry.mutex.unlock();
            const expected = registry.arenas.get(arena.heap.?) orelse {
                bun.unreachablePanic("Arena not registered!", .{});
            };
            const received = std.Thread.getCurrentId();
            if (expected != received) {
                bun.unreachablePanic("Arena accessed on wrong thread! Expected: {d} received: {d}", .{
                    expected,
                    received,
                });
            }
        }
    }

    pub fn unregister(arena: Arena) void {
        if (comptime Environment.isDebug and Environment.isNative) {
            registry.mutex.lock();
            defer registry.mutex.unlock();
            if (!registry.arenas.swapRemove(arena.heap.?)) {
                bun.unreachablePanic("Arena not registered!", .{});
            }
        }
    }
};

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

    pub fn deinit(this: *Arena) void {
        if (comptime Environment.isDebug) {
            ArenaRegistry.unregister(this.*);
        }
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
        const arena = Arena{ .heap = mimalloc.mi_heap_new() orelse return error.OutOfMemory };
        if (comptime Environment.isDebug) {
            ArenaRegistry.register(arena);
        }
        return arena;
    }

    pub fn gc(this: Arena, force: bool) void {
        mimalloc.mi_heap_collect(this.heap orelse return, force);
    }

    pub fn ownsPtr(this: Arena, ptr: *const anyopaque) bool {
        return mimalloc.mi_heap_check_owned(this.heap.?, ptr);
    }
    pub const supports_posix_memalign = true;

    fn alignedAlloc(heap: *mimalloc.Heap, len: usize, alignment: usize) ?[*]u8 {
        log("Malloc: {d}\n", .{len});

        const ptr: ?*anyopaque = if (mimalloc.canUseAlignedAlloc(len, alignment))
            mimalloc.mi_heap_malloc_aligned(heap, len, alignment)
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

    fn alloc(arena: *anyopaque, len: usize, log2_align: u8, _: usize) ?[*]u8 {
        const this = bun.cast(*mimalloc.Heap, arena);
        // if (comptime Environment.isDebug)
        //     ArenaRegistry.assert(.{ .heap = this });
        if (comptime FeatureFlags.alignment_tweak) {
            return alignedAlloc(this, len, log2_align);
        }

        const alignment = @as(usize, 1) << @as(Allocator.Log2Align, @intCast(log2_align));

        return alignedAlloc(
            this,
            len,
            alignment,
        );
    }

    fn resize(_: *anyopaque, buf: []u8, _: u8, new_len: usize, _: usize) bool {
        if (new_len <= buf.len) {
            return true;
        }

        const full_len = alignedAllocSize(buf.ptr);
        if (new_len <= full_len) {
            return true;
        }

        return false;
    }

    fn free(
        _: *anyopaque,
        buf: []u8,
        buf_align: u8,
        _: usize,
    ) void {
        // mi_free_size internally just asserts the size
        // so it's faster if we don't pass that value through
        // but its good to have that assertion
        if (comptime Environment.isDebug) {
            assert(mimalloc.mi_is_in_heap_region(buf.ptr));
            if (mimalloc.canUseAlignedAlloc(buf.len, buf_align))
                mimalloc.mi_free_size_aligned(buf.ptr, buf.len, buf_align)
            else
                mimalloc.mi_free_size(buf.ptr, buf.len);
        } else {
            mimalloc.mi_free(buf.ptr);
        }
    }
};

const c_allocator_vtable = Allocator.VTable{
    .alloc = &Arena.alloc,
    .resize = &Arena.resize,
    .free = &Arena.free,
};
