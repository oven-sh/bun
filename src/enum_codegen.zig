pub const bun = @import("./bun.zig");

const std = @import("std");

pub fn main() !void {
    var buf = std.io.bufferedWriter(std.io.getStdOut().writer());
    defer buf.flush() catch {};
    const w = buf.writer();

    inline for (.{
        // sort-lines: start
        .{ "DevServerIncomingMessageId", @import("./bake/DevServer.zig").IncomingMessageId },
        .{ "DevServerMessageId", @import("./bake/DevServer.zig").MessageId },
        .{ "SerializedFailureErrorKind", @import("./bake/DevServer.zig").SerializedFailure.ErrorKind },
        .{ "Target", @import("./options.zig").Target },
        .{ "SourceMapOption", @import("./options.zig").SourceMapOption },
        .{ "Loader", @import("./options.zig").Loader },
        .{ "ImportKind", @import("./import_record.zig").ImportKind },
        // sort-lines: end
    }) |entry| {
        const name, const enum_type = entry;

        try w.print("/* {s} */\n", .{@typeName(enum_type)});
        try w.print("export const enum {s} {{\n", .{name});
        for (std.enums.values(enum_type)) |tag| {
            try w.print("  {} = {d},\n", .{ bun.fmt.quote(@tagName(tag)), @intFromEnum(tag) });
        }
        try w.writeAll("};\n");
        try w.writeAll("\n");
    }
}
