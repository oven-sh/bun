//! This type is a `GenericAllocator`; see `src/allocators.zig`.

const Self = @This();

const safety_checks = bun.Environment.isDebug or bun.Environment.enable_asan;

#heap: *mimalloc.Heap,
thread_id: if (safety_checks) std.Thread.Id else void,

/// Uses the default thread-local heap. This type is zero-sized.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub const Default = struct {
    pub fn allocator(self: Default) std.mem.Allocator {
        _ = self;
        return Borrowed.getDefault().allocator();
    }
};

/// Borrowed version of `MimallocArena`, returned by `MimallocArena.borrow`.
/// Using this type makes it clear who actually owns the `MimallocArena`, and prevents
/// `deinit` from being called twice.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub const Borrowed = struct {
    #heap: *mimalloc.Heap,

    pub fn allocator(self: Borrowed) std.mem.Allocator {
        return .{ .ptr = self.#heap, .vtable = c_allocator_vtable };
    }

    pub fn getDefault() Borrowed {
        return .{ .#heap = mimalloc.mi_heap_main() };
    }

    pub fn gc(self: Borrowed) void {
        mimalloc.mi_heap_collect(self.#heap, false);
    }

    pub fn helpCatchMemoryIssues(self: Borrowed) void {
        if (comptime bun.FeatureFlags.help_catch_memory_issues) {
            self.gc();
            bun.mimalloc.mi_collect(false);
        }
    }

    fn fromOpaque(ptr: *anyopaque) Borrowed {
        return .{ .#heap = @ptrCast(@alignCast(ptr)) };
    }

    fn alignedAlloc(self: Borrowed, len: usize, alignment: Alignment) ?[*]u8 {
        log("Malloc: {d}\n", .{len});

        const ptr: ?*anyopaque = if (mimalloc.mustUseAlignedAlloc(alignment))
            mimalloc.mi_heap_malloc_aligned(self.#heap, len, alignment.toByteUnits())
        else
            mimalloc.mi_heap_malloc(self.#heap, len);

        if (comptime bun.Environment.isDebug) {
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

    pub fn downcast(std_alloc: std.mem.Allocator) Borrowed {
        bun.assertf(
            isInstance(std_alloc),
            "not a MimallocArena (vtable is {*})",
            .{std_alloc.vtable},
        );
        return .fromOpaque(std_alloc.ptr);
    }
};

const log = bun.Output.scoped(.mimalloc, .hidden);

pub fn allocator(self: Self) std.mem.Allocator {
    self.assertThreadOwnership();
    return self.borrow().allocator();
}

pub fn borrow(self: Self) Borrowed {
    return .{ .#heap = self.#heap };
}

pub fn getThreadLocalDefault() std.mem.Allocator {
    if (bun.Environment.enable_asan) return bun.default_allocator;
    return Borrowed.getDefault().allocator();
}

pub fn backingAllocator(_: Self) std.mem.Allocator {
    return getThreadLocalDefault();
}

pub fn dumpThreadStats(_: Self) void {
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.c) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_thread_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn dumpStats(_: Self) void {
    const dump_fn = struct {
        pub fn dump(textZ: [*:0]const u8, _: ?*anyopaque) callconv(.c) void {
            const text = bun.span(textZ);
            bun.Output.errorWriter().writeAll(text) catch {};
        }
    }.dump;
    mimalloc.mi_stats_print_out(dump_fn, null);
    bun.Output.flush();
}

pub fn deinit(self: *Self) void {
    mimalloc.mi_heap_destroy(self.#heap);
    self.* = undefined;
}

pub fn init() Self {
    return .{
        .#heap = mimalloc.mi_heap_new() orelse bun.outOfMemory(),
        .thread_id = if (safety_checks) std.Thread.getCurrentId() else {},
    };
}

pub fn gc(self: Self) void {
    self.borrow().gc();
}

pub fn helpCatchMemoryIssues(self: Self) void {
    self.borrow().helpCatchMemoryIssues();
}

fn assertThreadOwnership(self: Self) void {
    if (comptime safety_checks) {
        const current_thread = std.Thread.getCurrentId();
        if (current_thread != self.thread_id) {
            std.debug.panic(
                "MimallocArena used from wrong thread: arena belongs to thread {d}, but current thread is {d}",
                .{ self.thread_id, current_thread },
            );
        }
    }
}

fn alignedAllocSize(ptr: [*]u8) usize {
    return mimalloc.mi_malloc_usable_size(ptr);
}

fn vtable_alloc(ptr: *anyopaque, len: usize, alignment: Alignment, _: usize) ?[*]u8 {
    const self: Borrowed = .fromOpaque(ptr);
    return self.alignedAlloc(len, alignment);
}

fn vtable_resize(_: *anyopaque, buf: []u8, _: Alignment, new_len: usize, _: usize) bool {
    return mimalloc.mi_expand(buf.ptr, new_len) != null;
}

fn vtable_free(
    _: *anyopaque,
    buf: []u8,
    alignment: Alignment,
    _: usize,
) void {
    // mi_free_size internally just asserts the size
    // so it's faster if we don't pass that value through
    // but its good to have that assertion
    if (comptime bun.Environment.isDebug) {
        assert(mimalloc.mi_is_in_heap_region(buf.ptr));
        if (mimalloc.mustUseAlignedAlloc(alignment))
            mimalloc.mi_free_size_aligned(buf.ptr, buf.len, alignment.toByteUnits())
        else
            mimalloc.mi_free_size(buf.ptr, buf.len);
    } else {
        mimalloc.mi_free(buf.ptr);
    }
}

fn vtable_remap(ptr: *anyopaque, buf: []u8, alignment: Alignment, new_len: usize, _: usize) ?[*]u8 {
    const self: Borrowed = .fromOpaque(ptr);
    const value = mimalloc.mi_heap_realloc_aligned(self.#heap, buf.ptr, new_len, alignment.toByteUnits());
    return @ptrCast(value);
}

pub fn isInstance(alloc: std.mem.Allocator) bool {
    return alloc.vtable == c_allocator_vtable;
}

const c_allocator_vtable = &std.mem.Allocator.VTable{
    .alloc = vtable_alloc,
    .resize = vtable_resize,
    .remap = vtable_remap,
    .free = vtable_free,
};

const std = @import("std");
const Alignment = std.mem.Alignment;

const bun = @import("bun");
const assert = bun.assert;
const mimalloc = bun.mimalloc;
