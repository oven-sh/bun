const bun = @import("root").bun;
const std = @import("std");
const Environment = bun.Environment;
const Allocator = std.mem.Allocator;
const vm_size_t = usize;

pub const enabled = Environment.allow_assert and Environment.isMac;

pub fn allocator(comptime T: type) std.mem.Allocator {
    return getZone(T).allocator();
}

pub fn getZone(comptime T: type) *Zone {
    comptime bun.assert(enabled);

    const static = struct {
        pub var zone: std.atomic.Value(?*Zone) = .{ .raw = null };
        pub var lock: bun.Lock = bun.Lock.init();
    };

    return static.zone.load(.monotonic) orelse brk: {
        static.lock.lock();
        defer static.lock.unlock();

        if (static.zone.load(.monotonic)) |z| {
            break :brk z;
        }

        const z = Zone.init(T);
        static.zone.store(z, .monotonic);
        break :brk z;
    };
}

pub const Zone = opaque {
    pub fn init(comptime T: type) *Zone {
        const zone = malloc_create_zone(0, 0);

        const title: [:0]const u8 = comptime title: {
            const base_name = if (@hasDecl(T, "heap_label"))
                T.heap_label
            else
                bun.meta.typeBaseName(@typeName(T));
            break :title "Bun__" ++ base_name;
        };
        malloc_set_zone_name(zone, title.ptr);

        return zone;
    }

    fn alignedAlloc(zone: *Zone, len: usize, alignment: usize) ?[*]u8 {
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        const eff_alignment = @max(alignment, @sizeOf(usize));
        const ptr = malloc_zone_memalign(zone, eff_alignment, len);
        return @as(?[*]u8, @ptrCast(ptr));
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return std.c.malloc_size(ptr);
    }

    fn rawAlloc(zone: *anyopaque, len: usize, log2_align: u8, _: usize) ?[*]u8 {
        const alignment = @as(usize, 1) << @intCast(log2_align);
        return alignedAlloc(@ptrCast(zone), len, alignment);
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

    fn rawFree(zone: *anyopaque, buf: [*]u8, _: u8, _: usize) void {
        malloc_zone_free(@ptrCast(zone), @ptrCast(buf));
    }

    pub const vtable = std.mem.Allocator.VTable{
        .alloc = &rawAlloc,
        .resize = &resize,
        .free = &rawFree,
    };

    pub fn allocator(zone: *Zone) std.mem.Allocator {
        return .{
            .vtable = &vtable,
            .ptr = zone,
        };
    }

    /// Create a single-item pointer with initialized data.
    pub inline fn create(zone: *Zone, comptime T: type, data: T) *T {
        const ptr: *T = @alignCast(@ptrCast(
            rawAlloc(zone, @sizeOf(T), @alignOf(T), @returnAddress()) orelse bun.outOfMemory(),
        ));
        ptr.* = data;
        return ptr;
    }

    /// Free a single-item pointer
    pub inline fn destroy(zone: *Zone, comptime T: type, ptr: *T) void {
        malloc_zone_free(zone, @ptrCast(ptr));
    }

    pub extern fn malloc_default_zone() *Zone;
    pub extern fn malloc_create_zone(start_size: vm_size_t, flags: c_uint) *Zone;
    pub extern fn malloc_destroy_zone(zone: *Zone) void;
    pub extern fn malloc_zone_malloc(zone: *Zone, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_calloc(zone: *Zone, num_items: usize, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_valloc(zone: *Zone, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_free(zone: *Zone, ptr: ?*anyopaque) void;
    pub extern fn malloc_zone_realloc(zone: *Zone, ptr: ?*anyopaque, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_from_ptr(ptr: ?*const anyopaque) *Zone;
    pub extern fn malloc_zone_memalign(zone: *Zone, alignment: usize, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_batch_malloc(zone: *Zone, size: usize, results: [*]?*anyopaque, num_requested: c_uint) c_uint;
    pub extern fn malloc_zone_batch_free(zone: *Zone, to_be_freed: [*]?*anyopaque, num: c_uint) void;
    pub extern fn malloc_default_purgeable_zone() *Zone;
    pub extern fn malloc_make_purgeable(ptr: ?*anyopaque) void;
    pub extern fn malloc_make_nonpurgeable(ptr: ?*anyopaque) c_int;
    pub extern fn malloc_zone_register(zone: *Zone) void;
    pub extern fn malloc_zone_unregister(zone: *Zone) void;
    pub extern fn malloc_set_zone_name(zone: *Zone, name: ?[*:0]const u8) void;
    pub extern fn malloc_get_zone_name(zone: *Zone) ?[*:0]const u8;
    pub extern fn malloc_zone_pressure_relief(zone: *Zone, goal: usize) usize;
};
