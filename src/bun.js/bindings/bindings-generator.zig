const Bindings = @import("bindings.zig");
const Exports = @import("exports.zig");
const HeaderGen = @import("./header-gen.zig").HeaderGen;
const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const io = std.io;
const fs = std.fs;
const process = std.process;
const ChildProcess = std.ChildProcess;
const Progress = std.Progress;
const mem = std.mem;
const testing = std.testing;
const Allocator = std.mem.Allocator;

pub const bindgen = true;

const JSC = bun.JSC;

const Classes = JSC.GlobalClasses;

pub fn main() anyerror!void {
    const allocator = std.heap.c_allocator;
    const src: std.builtin.SourceLocation = @src();
    const src_path = comptime bun.Environment.base_path ++ std.fs.path.dirname(src.file).?;
    {
        const paths = [_][]const u8{ src_path, "headers.h" };
        const paths2 = [_][]const u8{ src_path, "headers-cpp.h" };
        const paths4 = [_][]const u8{ src_path, "ZigGeneratedCode.cpp" };

        const cpp = try std.fs.createFileAbsolute(try std.fs.path.join(allocator, &paths2), .{});
        const file = try std.fs.createFileAbsolute(try std.fs.path.join(allocator, &paths), .{});
        const generated = try std.fs.createFileAbsolute(try std.fs.path.join(allocator, &paths4), .{});

        const HeaderGenerator = HeaderGen(
            Bindings,
            Exports,
            "src/bun.js/bindings/bindings.zig",
        );
        HeaderGenerator.exec(HeaderGenerator{}, file, cpp, generated);
    }
    // TODO: finish this
    const use_cpp_generator = false;
    if (use_cpp_generator) {
        comptime var i: usize = 0;
        inline while (i < Classes.len) : (i += 1) {
            const Class = Classes[i];
            const paths = [_][]const u8{ src_path, Class.name ++ ".generated.h" };
            const headerFilePath = try std.fs.path.join(
                allocator,
                &paths,
            );
            const implFilePath = try std.fs.path.join(
                allocator,
                &[_][]const u8{ std.fs.path.dirname(src.file) orelse return error.BadPath, Class.name ++ ".generated.cpp" },
            );
            var headerFile = try std.fs.createFileAbsolute(headerFilePath, .{});
            const header_writer = headerFile.writer();
            var implFile = try std.fs.createFileAbsolute(implFilePath, .{});
            try Class.@"generateC++Header"(header_writer);
            try Class.@"generateC++Class"(implFile.writer());
            headerFile.close();
            implFile.close();
        }
    }
}
