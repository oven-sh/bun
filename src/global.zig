const std = @import("std");
pub usingnamespace @import("strings.zig");

pub const BuildTarget = enum { native, wasm, wasi };
pub const build_target: BuildTarget = comptime {
    if (std.Target.current.isWasm() and std.Target.current.getOsTag() == .wasi) {
        return BuildTarget.wasi;
    } else if (std.Target.current.isWasm()) {
        return BuildTarget.wasm;
    } else {
        return BuildTarget.native;
    }
};

pub const isWasm = build_target == .wasm;
pub const isNative = build_target == .native;
pub const isWasi = build_target == .wasi;

pub const isDebug = std.builtin.Mode.Debug == std.builtin.mode;

pub const Output = struct {
    var source: *Source = undefined;
    pub const Source = struct {
        const StreamType = comptime {
            if (isWasm) {
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

    pub fn printErrorable(comptime fmt: string, args: anytype) !void {
        if (isWasm) {
            try source.stream.seekTo(0);
            try source.stream.writer().print(fmt, args);
            const root = @import("root");
            root.console_log(root.Uint8Array.fromSlice(source.out_buffer[0..source.stream.pos]));
        } else {
            std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        }
    }

    pub fn print(comptime fmt: string, args: anytype) void {
        if (isWasm) {
            source.stream.seekTo(0) catch return;
            source.stream.writer().print(fmt, args) catch return;
            const root = @import("root");
            root.console_log(root.Uint8Array.fromSlice(source.out_buffer[0..source.stream.pos]));
        } else {
            std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        }
    }
    pub fn printError(comptime fmt: string, args: anytype) void {
        if (isWasm) {
            source.error_stream.seekTo(0) catch return;
            source.error_stream.writer().print(fmt, args) catch unreachable;
            const root = @import("root");
            root.console_error(root.Uint8Array.fromSlice(source.err_buffer[0..source.error_stream.pos]));
        } else {
            std.fmt.format(source.error_stream.writer(), fmt, args) catch unreachable;
        }
    }
};

pub const Global = struct {
    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        if (isWasm) {
            Output.print(fmt, args);
            @panic(fmt);
        } else {
            std.debug.panic(fmt, args);
        }
    }
    pub fn notimpl() noreturn {
        Global.panic("Not implemented yet!!!!!", .{});
    }
};
