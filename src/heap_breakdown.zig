const bun = @import("root").bun;
const std = @import("std");
const HeapBreakdown = @This();

pub fn allocator(comptime T: type) std.mem.Allocator {
    return malloc_zone_t.get(T).getAllocator();
}

pub const malloc_zone_t = opaque {
    const Allocator = std.mem.Allocator;
    const vm_size_t = usize;

    pub extern fn malloc_default_zone() *malloc_zone_t;
    pub extern fn malloc_create_zone(start_size: vm_size_t, flags: c_uint) *malloc_zone_t;
    pub extern fn malloc_destroy_zone(zone: *malloc_zone_t) void;
    pub extern fn malloc_zone_malloc(zone: *malloc_zone_t, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_calloc(zone: *malloc_zone_t, num_items: usize, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_valloc(zone: *malloc_zone_t, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_free(zone: *malloc_zone_t, ptr: ?*anyopaque) void;
    pub extern fn malloc_zone_realloc(zone: *malloc_zone_t, ptr: ?*anyopaque, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_from_ptr(ptr: ?*const anyopaque) *malloc_zone_t;
    pub extern fn malloc_zone_memalign(zone: *malloc_zone_t, alignment: usize, size: usize) ?*anyopaque;
    pub extern fn malloc_zone_batch_malloc(zone: *malloc_zone_t, size: usize, results: [*]?*anyopaque, num_requested: c_uint) c_uint;
    pub extern fn malloc_zone_batch_free(zone: *malloc_zone_t, to_be_freed: [*]?*anyopaque, num: c_uint) void;
    pub extern fn malloc_default_purgeable_zone() *malloc_zone_t;
    pub extern fn malloc_make_purgeable(ptr: ?*anyopaque) void;
    pub extern fn malloc_make_nonpurgeable(ptr: ?*anyopaque) c_int;
    pub extern fn malloc_zone_register(zone: *malloc_zone_t) void;
    pub extern fn malloc_zone_unregister(zone: *malloc_zone_t) void;
    pub extern fn malloc_set_zone_name(zone: *malloc_zone_t, name: ?[*:0]const u8) void;
    pub extern fn malloc_get_zone_name(zone: *malloc_zone_t) ?[*:0]const u8;
    pub extern fn malloc_zone_pressure_relief(zone: *malloc_zone_t, goal: usize) usize;

    pub fn get(comptime T: type) *malloc_zone_t {
        const Holder = struct {
            pub var zone_t: std.atomic.Value(?*malloc_zone_t) = std.atomic.Value(?*malloc_zone_t).init(null);
            pub var zone_t_lock: bun.Lock = bun.Lock.init();
        };
        return Holder.zone_t.load(.monotonic) orelse brk: {
            Holder.zone_t_lock.lock();
            defer Holder.zone_t_lock.unlock();

            if (Holder.zone_t.load(.monotonic)) |z| {
                break :brk z;
            }

            const z = malloc_zone_t.create(T);
            Holder.zone_t.store(z, .monotonic);
            break :brk z;
        };
    }

    fn alignedAlloc(zone: *malloc_zone_t, len: usize, alignment: usize) ?[*]u8 {
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        const eff_alignment = @max(alignment, @sizeOf(usize));

        const ptr = malloc_zone_memalign(zone, eff_alignment, len);
        return @as(?[*]u8, @ptrCast(ptr));
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return std.c.malloc_size(ptr);
    }

    fn alloc(ptr: *anyopaque, len: usize, log2_align: u8, _: usize) ?[*]u8 {
        const alignment = @as(usize, 1) << @as(Allocator.Log2Align, @intCast(log2_align));
        return alignedAlloc(@ptrCast(ptr), len, alignment);
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

    fn free(ptr: *anyopaque, buf: [*]u8, _: u8, _: usize) void {
        malloc_zone_free(@ptrCast(ptr), @ptrCast(buf));
    }

    pub const VTable = std.mem.Allocator.VTable{
        .alloc = @ptrCast(&alloc),
        .resize = @ptrCast(&resize),
        .free = @ptrCast(&free),
    };

    pub fn create(comptime T: type) *malloc_zone_t {
        const zone = malloc_create_zone(0, 0);
        const title = struct {
            const base_name = if (@hasDecl(T, "heap_label")) T.heap_label else bun.meta.typeBaseName(@typeName(T));
            pub const title_: []const u8 = "Bun__" ++ base_name ++ .{0};
            pub const title: [:0]const u8 = title_[0 .. title_.len - 1 :0];
        }.title;
        malloc_set_zone_name(zone, title.ptr);

        return zone;
    }

    pub fn getAllocator(zone: *malloc_zone_t) std.mem.Allocator {
        return Allocator{
            .vtable = &VTable,
            .ptr = zone,
        };
    }
};
