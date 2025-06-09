const bun = @import("bun");
const std = @import("std");
const Environment = bun.Environment;
const Allocator = std.mem.Allocator;
const vm_size_t = usize;

pub const enabled = Environment.allow_assert and Environment.isMac;

fn heapLabel(comptime T: type) [:0]const u8 {
    const base_name = if (@hasDecl(T, "heap_label"))
        T.heap_label
    else
        bun.meta.typeBaseName(@typeName(T));
    return base_name;
}

// Function to get the allocation counter for a given type
fn getAllocationCounter(comptime T: type) *std.atomic.Value(usize) {
    const name = comptime heapLabel(T);
    const full_name = comptime "Bun__" ++ name;

    const static = struct {
        pub var active_allocation_counter = std.atomic.Value(usize).init(0);
    };

    // Export the counter with the specific naming convention and section
    comptime {
        @export(&static.active_allocation_counter, .{
            .name = std.fmt.comptimePrint("Bun__allocationCounter__{s}", .{full_name}),
            .section = "__DATA,BUNHEAPCNT",
        });
    }

    return &static.active_allocation_counter;
}

pub fn allocator(comptime T: type) std.mem.Allocator {
    const zone = getZoneT(T);
    return zone.allocator(T);
}

pub fn namedAllocator(comptime name: [:0]const u8) std.mem.Allocator {
    // For named allocators, we don't have a type to track
    const zone = getZone("Bun__" ++ name);

    const S = struct {
        fn rawAlloc(zone_ptr: *anyopaque, len: usize, alignment: std.mem.Alignment, _: usize) ?[*]u8 {
            return Zone.alignedAlloc(@ptrCast(zone_ptr), len, alignment);
        }

        fn resize(_: *anyopaque, buf: []u8, _: std.mem.Alignment, new_len: usize, _: usize) bool {
            if (new_len <= buf.len) {
                return true;
            }

            const full_len = Zone.alignedAllocSize(buf.ptr);
            if (new_len <= full_len) {
                return true;
            }

            return false;
        }

        fn rawFree(zone_ptr: *anyopaque, buf: []u8, _: std.mem.Alignment, _: usize) void {
            Zone.malloc_zone_free(@ptrCast(zone_ptr), @ptrCast(buf.ptr));
        }
    };

    const vtable = comptime std.mem.Allocator.VTable{
        .alloc = &S.rawAlloc,
        .resize = &S.resize,
        .remap = &std.mem.Allocator.noRemap,
        .free = &S.rawFree,
    };

    return .{
        .vtable = &vtable,
        .ptr = zone,
    };
}

pub fn getZoneT(comptime T: type) *Zone {
    return getZone(comptime "Bun__" ++ heapLabel(T));
}

pub fn getZone(comptime name: [:0]const u8) *Zone {
    comptime bun.assert(enabled);

    const static = struct {
        pub var zone: *Zone = undefined;
        pub fn initOnce() void {
            zone = Zone.init(name);
        }

        pub var once = std.once(initOnce);
    };

    static.once.call();
    return static.zone;
}

pub const Zone = opaque {
    pub fn init(comptime name: [:0]const u8) *Zone {
        const zone = malloc_create_zone(0, 0);

        malloc_set_zone_name(zone, name.ptr);

        return zone;
    }

    fn alignedAlloc(zone: *Zone, len: usize, alignment: std.mem.Alignment) ?[*]u8 {
        // The posix_memalign only accepts alignment values that are a
        // multiple of the pointer size
        const eff_alignment = @max(alignment.toByteUnits(), @sizeOf(usize));
        const ptr = malloc_zone_memalign(zone, eff_alignment, len);
        return @as(?[*]u8, @ptrCast(ptr));
    }

    fn alignedAllocSize(ptr: [*]u8) usize {
        return std.c.malloc_size(ptr);
    }

    pub fn allocator(zone: *Zone, comptime T: type) std.mem.Allocator {
        const S = struct {
            fn rawAlloc(zone_ptr: *anyopaque, len: usize, alignment: std.mem.Alignment, _: usize) ?[*]u8 {
                const result = Zone.alignedAlloc(@ptrCast(zone_ptr), len, alignment);
                if (result) |_| {
                    if (comptime enabled) {
                        _ = getAllocationCounter(T).fetchAdd(1, .monotonic);
                    }
                }
                return result;
            }

            fn resize(_: *anyopaque, buf: []u8, _: std.mem.Alignment, new_len: usize, _: usize) bool {
                if (new_len <= buf.len) {
                    return true;
                }

                const full_len = Zone.alignedAllocSize(buf.ptr);
                if (new_len <= full_len) {
                    return true;
                }

                return false;
            }

            fn rawFree(zone_ptr: *anyopaque, buf: []u8, _: std.mem.Alignment, _: usize) void {
                if (comptime enabled) {
                    _ = getAllocationCounter(T).fetchSub(1, .monotonic);
                }
                Zone.malloc_zone_free(@ptrCast(zone_ptr), @ptrCast(buf.ptr));
            }
        };

        const vtable = comptime std.mem.Allocator.VTable{
            .alloc = &S.rawAlloc,
            .resize = &S.resize,
            .remap = &std.mem.Allocator.noRemap,
            .free = &S.rawFree,
        };

        return .{
            .vtable = &vtable,
            .ptr = zone,
        };
    }

    /// Create a single-item pointer with initialized data.
    pub inline fn create(zone: *Zone, comptime T: type, data: T) *T {
        const alloc = zone.allocator(T);
        const ptr = alloc.create(T) catch bun.outOfMemory();
        ptr.* = data;
        return ptr;
    }

    /// Free a single-item pointer
    pub inline fn destroy(zone: *Zone, comptime T: type, ptr: *T) void {
        const alloc = zone.allocator(T);
        alloc.destroy(ptr);
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
