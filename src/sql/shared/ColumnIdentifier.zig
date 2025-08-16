pub const ColumnIdentifier = union(enum) {
    name: Data,
    index: u32,
    duplicate: void,

    pub fn init(name: Data) !@This() {
        if (switch (name.slice().len) {
            1..."4294967295".len => true,
            0 => return .{ .name = .{ .empty = {} } },
            else => false,
        }) might_be_int: {
            // use a u64 to avoid overflow
            var int: u64 = 0;
            for (name.slice()) |byte| {
                int = int * 10 + switch (byte) {
                    '0'...'9' => @as(u64, byte - '0'),
                    else => break :might_be_int,
                };
            }

            // JSC only supports indexed property names up to 2^32
            if (int < std.math.maxInt(u32))
                return .{ .index = @intCast(int) };
        }

        return .{ .name = .{ .owned = try name.toOwned() } };
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .name => |*name| name.deinit(),
            else => {},
        }
    }
};

const std = @import("std");
const Data = @import("../shared/Data.zig").Data;
