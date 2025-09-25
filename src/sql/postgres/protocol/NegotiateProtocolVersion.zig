version: int4 = 0,
unrecognized_options: std.ArrayListUnmanaged(String) = .{},

pub fn decodeInternal(
    this: *@This(),
    comptime Container: type,
    reader: NewReader(Container),
) !void {
    const length = try reader.length();
    bun.assert(length >= 4);

    const version = try reader.int4();
    this.* = .{
        .version = version,
    };

    const unrecognized_options_count: u32 = @intCast(@max(try reader.int4(), 0));
    try this.unrecognized_options.ensureTotalCapacity(bun.default_allocator, unrecognized_options_count);
    errdefer {
        for (this.unrecognized_options.items) |*option| {
            option.deinit();
        }
        this.unrecognized_options.deinit(bun.default_allocator);
    }
    for (0..unrecognized_options_count) |_| {
        var option = try reader.readZ();
        if (option.slice().len == 0) break;
        defer option.deinit();
        this.unrecognized_options.appendAssumeCapacity(
            String.borrowUTF8(option),
        );
    }
}

const std = @import("std");
const NewReader = @import("./NewReader.zig").NewReader;

const int_types = @import("../types/int_types.zig");
const int4 = int_types.int4;

const bun = @import("bun");
const String = bun.String;
