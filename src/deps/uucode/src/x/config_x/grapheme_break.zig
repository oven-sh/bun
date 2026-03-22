fn compute(
    allocator: std.mem.Allocator,
    cp: u21,
    data: anytype,
    backing: anytype,
    tracking: anytype,
) std.mem.Allocator.Error!void {
    _ = allocator;
    _ = cp;
    _ = backing;
    _ = tracking;

    data.grapheme_break_no_control = switch (data.grapheme_break) {
        .control, .cr, .lf => .other,
        inline else => |tag| comptime std.meta.stringToEnum(
            types_x.GraphemeBreakNoControl,
            @tagName(tag),
        ) orelse unreachable,
    };
}

pub const grapheme_break_no_control = config.Extension{
    .inputs = &.{
        "grapheme_break",
    },
    .compute = &compute,
    .fields = &.{
        .{ .name = "grapheme_break_no_control", .type = types_x.GraphemeBreakNoControl },
    },
};

const config = @import("./config.zig");
const std = @import("std");
const types_x = @import("./types.x.zig");
