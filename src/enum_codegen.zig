pub const bun = @import("./bun.zig");

const std = @import("std");

pub fn main() !void {
    var buf = std.io.bufferedWriter(std.io.getStdOut().writer());
    defer buf.flush() catch {};
    const w = buf.writer();

    var jsonw = std.json.writeStream(w, .{ .whitespace = .indent_2 });

    try jsonw.beginObject();
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
        try jsonw.objectField(name);
        try jsonw.beginObject();

        try jsonw.objectField("tag");
        const tag_int = @typeInfo(@typeInfo(enum_type).Enum.tag_type).Int;
        const tag_rounded = std.fmt.comptimePrint("{c}{d}", .{
            switch (tag_int.signedness) {
                .signed => 'i',
                .unsigned => 'u',
            },
            comptime std.mem.alignForward(u16, tag_int.bits, 8),
        });
        try jsonw.write(tag_rounded);

        try jsonw.objectField("values");
        try jsonw.beginArray();

        // try w.print("/* {s} */\n", .{@typeName(enum_type)});
        // try w.print("export const enum {s} {{\n", .{name});
        for (std.enums.values(enum_type)) |tag| {
            //     try w.print("  {} = {d},\n", .{ bun.fmt.quote(@tagName(tag)), @intFromEnum(tag) });
            try jsonw.beginObject();

            try jsonw.objectField("name");
            try jsonw.write(@tagName(tag));

            try jsonw.objectField("value");
            try jsonw.write(@as(i52, @intFromEnum(tag)));

            try jsonw.endObject();
        }
        // try w.writeAll("};\n");
        // try w.writeAll("\n");

        try jsonw.endArray();
        try jsonw.endObject();
    }
    try jsonw.endObject();
    jsonw.deinit();
}
