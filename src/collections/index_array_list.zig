/// A space-efficient array list for storing indices that automatically
/// chooses the smallest integer type needed to represent all values.
///
/// This data structure optimizes memory usage by starting with u8 storage
/// and dynamically upgrading to larger integer types (u16, u24, u32) only
/// when values exceed the current type's range. This is particularly useful
/// for storing indices, offsets, or other non-negative integers where the
/// maximum value is not known in advance.
///
/// Features:
/// - Automatic type promotion: starts with u8, upgrades to u16/u24/u32 as needed
/// - Memory efficient: uses the smallest possible integer type for the data
/// - Zero-cost abstractions: no runtime overhead for type checking once established
/// - Compatible with standard ArrayList operations
///
/// Use cases:
/// - Source map line/column mappings where most values are small
/// - Array indices where the array size grows dynamically
/// - Offset tables where most offsets fit in smaller types
/// - Any scenario where you're storing many small integers with occasional large values
///
/// Example:
/// ```zig
/// var list = IndexArrayList.init(allocator, 16);
/// try list.append(allocator, 10);    // stored as u8
/// try list.append(allocator, 300);   // upgrades to u16, copies existing data
/// try list.append(allocator, 70000); // upgrades to u32, copies existing data
/// ```
///
/// Memory layout transitions:
/// - Initial: u8 array (1 byte per element)
/// - After value > 255: u16 array (2 bytes per element)
/// - After value > 65535: u24 array (3 bytes per element)
/// - After value > 16777215: u32 array (4 bytes per element)
///
/// Note: u24 is used as an intermediate step to save memory when values
/// fit in 24 bits but exceed 16 bits, which is common in large source maps.
pub const IndexArrayList = union(Size) {
    u8: bun.BabyList(u8),
    u16: bun.BabyList(u16),
    u24: bun.BabyList(u24),
    u32: bun.BabyList(u32),

    pub const empty = IndexArrayList{ .u8 = .{} };

    pub fn init(allocator: std.mem.Allocator, initial_capacity: usize) !IndexArrayList {
        return .{ .u8 = try bun.BabyList(u8).initCapacity(allocator, initial_capacity) };
    }

    fn copyTIntoT2(comptime T1: type, src: []const T1, comptime T2: type, dst: []T2) void {
        for (src, dst) |item, *dest| {
            dest.* = @intCast(item);
        }
    }

    pub const Slice = union(Size) {
        u8: []const u8,
        u16: []const u16,
        u24: []const u24,
        u32: []const u32,

        pub fn len(self: Slice) usize {
            return switch (self) {
                .u8 => self.u8.len,
                .u16 => self.u16.len,
                .u24 => self.u24.len,
                .u32 => self.u32.len,
            };
        }
    };

    pub fn items(self: *const IndexArrayList) Slice {
        return switch (self.*) {
            .u8 => |*list| .{ .u8 = list.sliceConst() },
            .u16 => |*list| .{ .u16 = list.sliceConst() },
            .u24 => |*list| .{ .u24 = list.sliceConst() },
            .u32 => |*list| .{ .u32 = list.sliceConst() },
        };
    }

    pub fn append(self: *IndexArrayList, allocator: std.mem.Allocator, value: u32) !void {
        const target_size: usize = switch (value) {
            std.math.minInt(u8)...std.math.maxInt(u8) => 1,
            std.math.maxInt(u8) + 1...std.math.maxInt(u16) => 2,
            std.math.maxInt(u16) + 1...std.math.maxInt(u24) => 3,
            std.math.maxInt(u24) + 1...std.math.maxInt(u32) => 4,
        };

        const current_size: usize = switch (self.*) {
            .u8 => 1,
            .u16 => 2,
            .u24 => 3,
            .u32 => 4,
        };

        if (current_size < target_size) {
            self.* = switch (target_size) {
                2 => .{
                    .u16 = brk: {
                        var new_list = try bun.BabyList(u16).initCapacity(allocator, self.u8.len + 1);
                        new_list.len = self.u8.len;
                        copyTIntoT2(u8, self.u8.sliceConst(), u16, new_list.slice());
                        self.deinit(allocator);
                        break :brk new_list;
                    },
                },
                3 => .{
                    .u24 = brk: {
                        var new_list = try bun.BabyList(u24).initCapacity(allocator, self.u16.len + 1);
                        new_list.len = self.u16.len;
                        copyTIntoT2(u16, self.u16.sliceConst(), u24, new_list.slice());
                        self.deinit(allocator);
                        break :brk new_list;
                    },
                },
                4 => .{
                    .u32 = brk: {
                        var new_list = try bun.BabyList(u32).initCapacity(allocator, self.u24.len + 1);
                        new_list.len = self.u24.len;
                        copyTIntoT2(u24, self.u24.sliceConst(), u32, new_list.slice());
                        self.deinit(allocator);
                        break :brk new_list;
                    },
                },
                else => unreachable,
            };
        }

        switch (self.*) {
            .u8 => |*list| try list.append(allocator, &[_]u8{@intCast(value)}),
            .u16 => |*list| try list.append(allocator, &[_]u16{@intCast(value)}),
            .u24 => |*list| try list.append(allocator, &[_]u24{@intCast(value)}),
            .u32 => |*list| try list.append(allocator, &[_]u32{@intCast(value)}),
        }
    }

    pub fn deinit(self: *IndexArrayList, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .u8 => |*list| list.deinitWithAllocator(allocator),
            .u16 => |*list| list.deinitWithAllocator(allocator),
            .u24 => |*list| list.deinitWithAllocator(allocator),
            .u32 => |*list| list.deinitWithAllocator(allocator),
        }
    }

    const Size = enum {
        u8,
        u16,
        u24,
        u32,
    };
};

const bun = @import("bun");
const std = @import("std");
