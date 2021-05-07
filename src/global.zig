const std = @import("std");
pub usingnamespace @import("strings.zig");

pub const Output = struct {
    pub const source = comptime {
        if (std.builtin.os.tag == .wasi) {
            return @import("./output_wasi.zig");
        } else if (std.builtin.target.isWasm()) {
            return @import("./output_wasm.zig");
        } else {
            return @import("./output_native.zig");
        }
    };

    pub fn print(comptime fmt: string, args: anytype) void {
        if (comptime std.builtin.target.isWasm()) {
            std.fmt.format(source.writer, fmt, args) catch unreachable;
        } else {
            std.fmt.format(source.writer orelse unreachable, fmt, args) catch unreachable;
        }
    }
    pub fn printError(comptime fmt: string, args: anytype) void {
        if (comptime std.builtin.target.isWasm()) {
            std.fmt.format(source.writer, fmt, args) catch unreachable;
        } else {
            std.fmt.format(source.writer orelse unreachable, fmt, args) catch unreachable;
        }
    }
};

pub const Global = struct {
    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        if (comptime std.builtin.target.isWasm()) {
            @panic(fmt);
        } else {
            std.debug.panic(fmt, args);
        }
    }
};
