const std = @import("std");
const assert = std.debug.assert;
const mem = std.mem;
const testing = std.testing;

/// An array that efficiently tracks which elements are in use.
/// The pointers are intended to be stable
/// Sorta related to https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2021/p0447r15.html
pub fn HiveArray(comptime T: type, comptime capacity: u16) type {
    return struct {
        const Self = @This();
        buffer: [capacity]T = undefined,
        available: std.bit_set.IntegerBitSet(capacity) = std.bit_set.IntegerBitSet(capacity).initFull(),
        pub const size = capacity;

        pub fn init() Self {
            return .{};
        }

        pub fn get(self: *Self) ?*T {
            const index = self.available.findFirstSet() orelse return null;
            self.available.unset(index);
            return &self.buffer[index];
        }

        pub fn at(self: *Self, index: u16) *T {
            assert(index < capacity);
            return &self.buffer[index];
        }

        pub fn claim(self: *Self, index: u16) void {
            assert(index < capacity);
            assert(self.available.isSet(index));
            self.available.unset(index);
        }

        pub fn indexOf(self: *const Self, value: *const T) ?u63 {
            const start = &self.buffer;
            const end = @ptrCast([*]const T, start) + capacity;
            if (!(@ptrToInt(value) >= @ptrToInt(start) and @ptrToInt(value) < @ptrToInt(end)))
                return null;

            // aligned to the size of T
            const index = (@ptrToInt(value) - @ptrToInt(start)) / @sizeOf(T);
            assert(index < capacity);
            assert(&self.buffer[index] == value);
            return @truncate(u63, index);
        }

        pub fn in(self: *const Self, value: *const T) bool {
            const start = &self.buffer;
            const end = @ptrCast([*]const T, start) + capacity;
            return (@ptrToInt(value) >= @ptrToInt(start) and @ptrToInt(value) < @ptrToInt(end));
        }

        pub fn put(self: *Self, value: *T) bool {
            const index = self.indexOf(value) orelse return false;

            assert(!self.available.isSet(index));
            assert(&self.buffer[index] == value);

            value.* = undefined;

            self.available.set(index);
            return true;
        }

        pub const Fallback = struct {
            hive: HiveArray(T, capacity),
            allocator: std.mem.Allocator,

            pub const This = @This();

            pub fn init(allocator: std.mem.Allocator) This {
                return .{
                    .allocator = allocator,
                    .hive = HiveArray(T, capacity).init(),
                };
            }

            pub fn get(self: *This) *T {
                if (self.hive.get()) |value| {
                    return value;
                }

                return self.allocator.create(T) catch unreachable;
            }

            pub fn put(self: *This, value: *T) void {
                if (self.hive.put(value)) return;

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
        var b = a.get().?;
        try testing.expect(a.get().? != b);
        try testing.expectEqual(a.indexOf(b), 0);
        try testing.expect(a.put(b));
        try testing.expect(a.get().? == b);
        var c = a.get().?;
        c.* = 123;
        var d: Int = 12345;
        try testing.expect(a.put(&d) == false);
        try testing.expect(a.in(&d) == false);
    }

    a.available = @TypeOf(a.available).initFull();
    {
        var i: u63 = 0;
        while (i < size) {
            var b = a.get().?;
            try testing.expectEqual(a.indexOf(b), i);
            try testing.expect(a.put(b));
            try testing.expect(a.get().? == b);
            i = i + 1;
        }
        i = 0;
        while (i < size) : (i += 1) {
            try testing.expect(a.get() == null);
        }
    }
}
