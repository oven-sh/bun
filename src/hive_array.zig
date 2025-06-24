const std = @import("std");
const bun = @import("bun");
const assert = bun.assert;
const mem = std.mem;
const testing = std.testing;

/// An array that efficiently tracks which elements are in use.
/// The pointers are intended to be stable
/// Sorta related to https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0447r15.html
pub fn HiveArray(comptime T: type, comptime capacity: u16) type {
    return struct {
        const Self = @This();

        buffer: [capacity]T,
        used: bun.bit_set.IntegerBitSet(capacity),

        pub const size = capacity;

        /// This is deliberately a `var` instead of a `const`.
        ///
        /// https://github.com/ziglang/zig/issues/22462
        /// https://github.com/ziglang/zig/issues/21988
        pub var empty: Self = .{
            .buffer = undefined,
            .used = .initEmpty(),
        };

        pub fn init() Self {
            return .{
                .buffer = undefined,
                .used = .initEmpty(),
            };
        }

        pub fn get(self: *Self) ?*T {
            const index = self.used.findFirstUnset() orelse return null;
            self.used.set(index);
            return &self.buffer[index];
        }

        pub fn at(self: *Self, index: u16) *T {
            assert(index < capacity);
            return &self.buffer[index];
        }

        pub fn claim(self: *Self, index: u16) void {
            assert(index < capacity);
            assert(!self.used.isSet(index));
            self.used.set(index);
        }

        pub fn indexOf(self: *const Self, value: *const T) ?u32 {
            const start = &self.buffer;
            const end = @as([*]const T, @ptrCast(start)) + capacity;
            if (!(@intFromPtr(value) >= @intFromPtr(start) and @intFromPtr(value) < @intFromPtr(end)))
                return null;

            // aligned to the size of T
            const index = (@intFromPtr(value) - @intFromPtr(start)) / @sizeOf(T);
            assert(index < capacity);
            assert(&self.buffer[index] == value);
            return @as(u32, @intCast(index));
        }

        pub fn in(self: *const Self, value: *const T) bool {
            const start = &self.buffer;
            const end = @as([*]const T, @ptrCast(start)) + capacity;
            return (@intFromPtr(value) >= @intFromPtr(start) and @intFromPtr(value) < @intFromPtr(end));
        }

        pub fn put(self: *Self, value: *T) bool {
            const index = self.indexOf(value) orelse return false;

            assert(self.used.isSet(index));
            assert(&self.buffer[index] == value);

            value.* = undefined;

            self.used.unset(index);
            return true;
        }

        pub const Fallback = struct {
            hive: if (capacity > 0) Self else void,
            allocator: std.mem.Allocator,

            pub const This = @This();

            pub fn init(allocator: std.mem.Allocator) This {
                return .{
                    .allocator = allocator,
                    .hive = if (comptime capacity > 0) Self.empty,
                };
            }

            pub fn get(self: *This) *T {
                if (comptime capacity > 0) {
                    if (self.hive.get()) |value| {
                        return value;
                    }
                }

                return self.allocator.create(T) catch bun.outOfMemory();
            }

            pub fn getAndSeeIfNew(self: *This, new: *bool) *T {
                if (comptime capacity > 0) {
                    if (self.hive.get()) |value| {
                        new.* = false;
                        return value;
                    }
                }

                return self.allocator.create(T) catch bun.outOfMemory();
            }

            pub fn tryGet(self: *This) !*T {
                if (comptime capacity > 0) {
                    if (self.hive.get()) |value| {
                        return value;
                    }
                }

                return try self.allocator.create(T);
            }

            pub fn in(self: *const This, value: *const T) bool {
                if (comptime capacity > 0) {
                    if (self.hive.in(value)) return true;
                }

                return false;
            }

            pub fn put(self: *This, value: *T) void {
                if (comptime capacity > 0) {
                    if (self.hive.put(value)) return;
                }

                self.allocator.destroy(value);
            }
        };
    };
}

test "HiveArray" {
    const size = 64;

    // Choose an integer with a weird alignment
    const Int = u127;

    var a = HiveArray(Int, size).init();

    {
        const b = a.get().?;
        try testing.expect(a.get().? != b);
        try testing.expectEqual(a.indexOf(b), 0);
        try testing.expect(a.put(b));
        try testing.expect(a.get().? == b);
        const c = a.get().?;
        c.* = 123;
        var d: Int = 12345;
        try testing.expect(a.put(&d) == false);
        try testing.expect(a.in(&d) == false);
    }

    a.used = @TypeOf(a.used).initEmpty();
    {
        for (0..size) |i| {
            const b = a.get().?;
            try testing.expectEqual(a.indexOf(b), i);
            try testing.expect(a.put(b));
            try testing.expect(a.get().? == b);
        }
        for (0..size) |_| {
            try testing.expect(a.get() == null);
        }
    }
}
