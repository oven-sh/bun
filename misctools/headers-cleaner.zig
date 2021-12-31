const std = @import("std");

pub fn main() anyerror!void {
    const headers_zig_file_src: std.builtin.SourceLocation = @src();
    var paths = [_][]const u8{ std.mem.span(headers_zig_file_src.file), "../../src/javascript/jsc/bindings/headers.zig" };
    const headers_zig_file = try std.fs.path.resolve(std.heap.c_allocator, &paths);
    std.debug.print("Writing to {s}", .{headers_zig_file});
    var headers_zig: std.fs.File = try std.fs.openFileAbsolute(headers_zig_file, .{ .write = true });
    var contents = try headers_zig.readToEndAlloc(std.heap.page_allocator, headers_zig.getEndPos() catch unreachable);
    const last_extern_i = std.mem.lastIndexOf(u8, contents, "pub extern fn") orelse @panic("Expected contents");
    const last_newline = std.mem.indexOf(u8, contents[last_extern_i..], "\n") orelse @panic("Expected newline");
    const to_splice = "// GENERATED CODE - DO NOT MODIFY BY HAND\n\n";
    var new_contents = try std.heap.page_allocator.alloc(u8, contents.len + to_splice.len);
    std.mem.copy(u8, new_contents, to_splice);
    std.mem.copy(u8, new_contents[to_splice.len..], contents);
    var i: usize = to_splice.len;
    var remainder = new_contents[i..];
    while (remainder.len > 0) {
        i = (std.mem.indexOf(u8, remainder, "\npub const struct_b") orelse break);
        var begin = remainder[i..];

        const end_struct = (std.mem.indexOf(u8, begin, "\n};\n") orelse break) + "\n};\n".len;

        std.mem.set(u8, begin[1 .. end_struct + 3], ' ');
        remainder = begin[end_struct..];
    }
    i = to_splice.len;
    remainder = new_contents[i..];
    while (remainder.len > 0) {
        i = (std.mem.indexOf(u8, remainder, "\npub const struct_") orelse break);
        var begin = remainder[i..];
        var end_struct = (std.mem.indexOf(u8, begin, "opaque {};") orelse break);
        end_struct += (std.mem.indexOf(u8, begin[end_struct..], "\n") orelse break);
        i = 0;

        std.mem.set(u8, begin[1..end_struct], ' ');
        remainder = begin[end_struct..];
    }

    const HARDCODE = [_][]const u8{
        "[*c][*c]JSC__Exception",
        "*?*JSC__Exception     ",
        "[*c]?*anyopaque",
        "[*c]*anyopaque",
    };
    i = 0;
    while (i < HARDCODE.len) : (i += 2) {
        _ = std.mem.replace(u8, new_contents, HARDCODE[i], HARDCODE[i + 1], new_contents);
    }

    const js_value_start = std.mem.indexOf(u8, new_contents, "pub const JSC__JSValue") orelse unreachable;
    const js_value_end = std.mem.indexOf(u8, new_contents[js_value_start..], "\n") orelse unreachable;
    std.mem.set(u8, new_contents[js_value_start..][0..js_value_end], ' ');

    try headers_zig.seekTo(0);
    try headers_zig.writeAll(new_contents);
    try headers_zig.setEndPos(last_newline + last_extern_i + to_splice.len);
}
