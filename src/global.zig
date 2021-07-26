const std = @import("std");
pub usingnamespace @import("strings.zig");

pub const C = @import("c.zig");
pub usingnamespace @import("env.zig");

pub const FeatureFlags = @import("feature_flags.zig");

pub const Output = struct {
    threadlocal var source: Source = undefined;
    pub const Source = struct {
        pub const StreamType: type = brk: {
            if (isWasm) {
                break :brk std.io.FixedBufferStream([]u8);
            } else {
                break :brk std.fs.File;
                // var stdout = std.io.getStdOut();
                // return @TypeOf(std.io.bufferedWriter(stdout.writer()));
            }
        };
        pub const BufferedStream: type = std.io.BufferedWriter(4096, @typeInfo(std.meta.declarationInfo(StreamType, "writer").data.Fn.fn_type).Fn.return_type.?);

        buffered_stream: BufferedStream,
        buffered_error_stream: BufferedStream,

        stream: StreamType,
        error_stream: StreamType,
        out_buffer: []u8 = &([_]u8{}),
        err_buffer: []u8 = &([_]u8{}),

        pub fn init(
            stream: StreamType,
            err: StreamType,
        ) Source {
            return Source{
                .stream = stream,
                .error_stream = err,
                .buffered_stream = BufferedStream{ .unbuffered_writer = stream.writer() },
                .buffered_error_stream = BufferedStream{ .unbuffered_writer = err.writer() },
            };
        }

        pub fn set(_source: *Source) void {
            source = _source.*;
        }
    };
    pub var enable_ansi_colors = isNative;
    pub var enable_buffering = true;

    pub fn enableBuffering() void {
        enable_buffering = true;
    }

    pub fn disableBuffering() void {
        Output.flush();
        enable_buffering = false;
    }

    pub const WriterType: type = @typeInfo(std.meta.declarationInfo(Source.StreamType, "writer").data.Fn.fn_type).Fn.return_type.?;

    pub fn errorWriter() WriterType {
        return source.error_stream.writer();
    }

    pub fn writer() WriterType {
        return source.stream.writer();
    }

    pub fn flush() void {
        if (isNative) {
            source.buffered_stream.flush() catch {};
            source.buffered_error_stream.flush() catch {};
            // source.stream.flush() catch {};
            // source.error_stream.flush() catch {};
        }
    }

    pub fn printErrorable(comptime fmt: string, args: anytype) !void {
        if (comptime isWasm) {
            try source.stream.seekTo(0);
            try source.stream.writer().print(fmt, args);
            const root = @import("root");
            root.console_log(root.Uint8Array.fromSlice(source.out_buffer[0..source.stream.pos]));
        } else {
            std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        }
    }

    pub fn println(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return print(fmt ++ "\n", args);
        }

        return print(fmt, args);
    }

    pub const debug = if (isDebug) _debug else _noop;

    fn _noop(comptime fmt: string, args: anytype) void {}

    pub fn _debug(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return print(fmt ++ "\n", args);
        }

        return print(fmt, args);
    }

    pub fn print(comptime fmt: string, args: anytype) void {
        if (comptime isWasm) {
            source.stream.seekTo(0) catch return;
            source.stream.writer().print(fmt, args) catch return;
            const root = @import("root");
            root.console_log(root.Uint8Array.fromSlice(source.out_buffer[0..source.stream.pos]));
        } else {
            if (enable_buffering) {
                std.fmt.format(source.buffered_stream.writer(), fmt, args) catch unreachable;
            } else {
                std.fmt.format(writer(), fmt, args) catch unreachable;
            }
        }
    }

    // Valid colors:
    // <black>
    // <blue>
    // <cyan>
    // <green>
    // <magenta>
    // <red>
    // <white>
    // <yellow>
    // <b> - bold
    // <d> - dim
    // </r> - reset
    // <r> - reset
    fn _pretty(comptime fmt: string, args: anytype, comptime printer: anytype, comptime is_enabled: bool) void {
        comptime var new_fmt: [fmt.len * 4]u8 = undefined;
        comptime var new_fmt_i: usize = 0;
        comptime const ED = "\x1b[";

        @setEvalBranchQuota(9999);
        comptime var i: usize = 0;
        comptime while (i < fmt.len) {
            const c = fmt[i];
            switch (c) {
                '\\' => {
                    i += 1;
                    if (fmt.len < i) {
                        switch (fmt[i]) {
                            '<', '>' => {
                                i += 1;
                            },
                            else => {
                                new_fmt[new_fmt_i] = '\\';
                                new_fmt_i += 1;
                                new_fmt[new_fmt_i] = fmt[i];
                                new_fmt_i += 1;
                            },
                        }
                    }
                },
                '>' => {
                    i += 1;
                },
                '{' => {
                    while (fmt.len > i and fmt[i] != '}') {
                        new_fmt[new_fmt_i] = fmt[i];
                        new_fmt_i += 1;
                        i += 1;
                    }
                },
                '<' => {
                    i += 1;
                    var is_reset = fmt[i] == '/';
                    if (is_reset) i += 1;
                    var start: usize = i;
                    while (i < fmt.len and fmt[i] != '>') {
                        i += 1;
                    }

                    const color_name = fmt[start..i];
                    const color_str = color_picker: {
                        if (std.mem.eql(u8, color_name, "black")) {
                            break :color_picker ED ++ "30m";
                        } else if (std.mem.eql(u8, color_name, "blue")) {
                            break :color_picker ED ++ "34m";
                        } else if (std.mem.eql(u8, color_name, "b")) {
                            break :color_picker ED ++ "1m";
                        } else if (std.mem.eql(u8, color_name, "d")) {
                            break :color_picker ED ++ "2m";
                        } else if (std.mem.eql(u8, color_name, "cyan")) {
                            break :color_picker ED ++ "36m";
                        } else if (std.mem.eql(u8, color_name, "green")) {
                            break :color_picker ED ++ "32m";
                        } else if (std.mem.eql(u8, color_name, "magenta")) {
                            break :color_picker ED ++ "35m";
                        } else if (std.mem.eql(u8, color_name, "red")) {
                            break :color_picker ED ++ "31m";
                        } else if (std.mem.eql(u8, color_name, "white")) {
                            break :color_picker ED ++ "37m";
                        } else if (std.mem.eql(u8, color_name, "yellow")) {
                            break :color_picker ED ++ "33m";
                        } else if (std.mem.eql(u8, color_name, "r")) {
                            is_reset = true;
                            break :color_picker "";
                        } else {
                            @compileError("Invalid color name passed:" ++ color_name);
                        }
                    };
                    var orig = new_fmt_i;

                    if (is_enabled) {
                        if (!is_reset) {
                            orig = new_fmt_i;
                            new_fmt_i += color_str.len;
                            std.mem.copy(u8, new_fmt[orig..new_fmt_i], color_str);
                        }

                        if (is_reset) {
                            const reset_sequence = "\x1b[0m";
                            orig = new_fmt_i;
                            new_fmt_i += reset_sequence.len;
                            std.mem.copy(u8, new_fmt[orig..new_fmt_i], reset_sequence);
                        }
                    }
                },

                else => {
                    new_fmt[new_fmt_i] = fmt[i];
                    new_fmt_i += 1;
                    i += 1;
                },
            }
        };
        printer(new_fmt[0..new_fmt_i], args);
    }

    pub fn prettyWithPrinter(comptime fmt: string, args: anytype, printer: anytype) void {
        if (enable_ansi_colors) {
            _pretty(fmt, args, printer, true);
        } else {
            _pretty(fmt, args, printer, false);
        }
    }

    pub fn pretty(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, print);
    }

    pub fn prettyln(comptime fmt: string, args: anytype) void {
        if (enable_ansi_colors) {
            _pretty(fmt, args, println, true);
        } else {
            _pretty(fmt, args, println, false);
        }
    }

    pub fn printErrorln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return printError(fmt ++ "\n", args);
        }

        return printError(fmt, args);
    }

    pub fn prettyError(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, printError);
    }

    pub fn prettyErrorln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return prettyWithPrinter(
                fmt ++ "\n",
                args,
                printError,
            );
        }

        return prettyWithPrinter(
            fmt,
            args,
            printError,
        );
    }

    pub fn errorLn(comptime fmt: string, args: anytype) void {
        return printErrorln(fmt, args);
    }

    pub fn printError(comptime fmt: string, args: anytype) void {
        if (comptime isWasm) {
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
        if (comptime isWasm) {
            Output.printErrorln(fmt, args);
            Output.flush();
            @panic(fmt);
        } else {
            Output.prettyErrorln(fmt, args);
            Output.flush();
            std.debug.panic(fmt, args);
        }
    }

    // std.debug.assert but happens at runtime
    pub fn invariant(condition: bool, comptime fmt: string, args: anytype) void {
        if (!condition) {
            _invariant(fmt, args);
        }
    }

    inline fn _invariant(comptime fmt: string, args: anytype) noreturn {
        if (comptime isWasm) {
            Output.printErrorln(fmt, args);
            Output.flush();
            @panic(fmt);
        } else {
            Output.prettyErrorln(fmt, args);
            Output.flush();
            std.os.exit(1);
        }
    }

    pub fn notimpl() noreturn {
        Global.panic("Not implemented yet!!!!!", .{});
    }

    // Make sure we always print any leftover
    pub fn crash() noreturn {
        Output.flush();
        std.os.exit(1);
    }
};

pub const FileDescriptorType = if (isBrowser) u0 else std.os.fd_t;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = if (isWindows or isBrowser) u0 else std.os.fd_t;

pub const PathBuilder = struct {
    const StringBuilderType = NewStringBuilder(std.fs.MAX_PATH_BYTES);
    builder: StringBuilderType = StringBuilderType.init(),

    pub fn init() PathBuilder {
        return PathBuilder{};
    }

    fn load(this: *PathBuilder) void {
        return @call(.{ .modifier = .always_inline }, StringBuilderType.load, .{this.builder});
    }

    pub fn append(this: *PathBuilder, str: string) void {
        return @call(.{ .modifier = .always_inline }, StringBuilderType.append, .{ this.builder, str });
    }

    pub fn pop(this: *PathBuilder, count: usize) void {
        return @call(.{ .modifier = .always_inline }, StringBuilderType.pop, .{ this.builder, count });
    }

    pub fn str(this: *PathBuilder) string {
        return @call(.{ .modifier = .always_inline }, StringBuilderType.str, .{this.builder});
    }

    pub fn reset(this: *PathBuilder) void {
        return @call(.{ .modifier = .always_inline }, StringBuilderType.reset, .{this.builder});
    }
};
