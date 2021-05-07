const std = @import("std");
pub usingnamespace @import("strings.zig");

pub const Output = struct {
    var source: *Source = undefined;
    pub const Source = struct {
        const StreamType = comptime {
            if (std.builtin.target.isWasm()) {
                return std.io.FixedBufferStream([]u8);
            } else {
                return std.fs.File;
            }
        };
        stream: StreamType,
        error_stream: StreamType,
        out_buffer: []u8 = &([_]u8{}),
        err_buffer: []u8 = &([_]u8{}),

        pub fn init(
            stream: StreamType,
            err: StreamType,
        ) Source {
            return Source{ .stream = stream, .error_stream = err };
        }

        pub fn set(_source: *Source) void {
            source = _source;
        }
    };

    pub fn print(comptime fmt: string, args: anytype) void {
        if (comptime std.builtin.target.isWasm()) {
            source.stream.pos = 0;
            std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
            const root = @import("root");
            // root.console_log(@ptrToInt(&source.out_buffer), source.stream.pos);
        } else {
            std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        }
    }
    pub fn printError(comptime fmt: string, args: anytype) void {
        if (comptime std.builtin.target.isWasm()) {
            source.error_stream.pos = 0;
            std.fmt.format(source.error_stream.writer(), fmt, args) catch unreachable;
            const root = @import("root");
            // root.console_error(@ptrToInt(&source.err_buffer), source.error_stream.pos);
        } else {
            std.fmt.format(source.error_stream.writer(), fmt, args) catch unreachable;
        }
    }
};

pub const Global = struct {
    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        if (comptime std.builtin.target.isWasm()) {
            Output.printError(fmt, args);
            @panic(fmt);
        } else {
            std.debug.panic(fmt, args);
        }
    }
};
