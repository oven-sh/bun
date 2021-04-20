const std = @import("std");
const lex = @import("js_lexer.zig");
const alloc = @import("alloc.zig");

pub fn main() anyerror!void {
    const args = try std.process.argsAlloc(alloc.dynamic);
    const stdout = std.io.getStdOut();
    const stderr = std.io.getStdErr();

    if (args.len < 1) {
        const len = stderr.write("Pass a file path");
        return;
    }

    // const path = try std.fs.realpathAlloc(alloc.dynamic, args[args.len - 1]);
    // const file = try std.fs.openFileAbsolute(path, std.fs.File.OpenFlags{});
    // const bytes = try file.readToEndAlloc(alloc.dynamic, std.math.maxInt(usize));
}
