const std = @import("std");
pub usingnamespace @import("strings.zig");
pub const Environment = @import("env.zig");

pub const default_allocator: *std.mem.Allocator = if (isTest)
    std.heap.c_allocator
else
    @import("./memory_allocator.zig").c_allocator;

pub const C = @import("c.zig");

pub usingnamespace Environment;

pub const FeatureFlags = @import("feature_flags.zig");
const root = @import("root");

pub const Output = struct {
    // These are threadlocal so we don't have stdout/stderr writing on top of each other
    threadlocal var source: Source = undefined;
    threadlocal var source_set: bool = false;

    // These are not threadlocal so we avoid opening stdout/stderr for every thread
    var stderr_stream: Source.StreamType = undefined;
    var stdout_stream: Source.StreamType = undefined;
    var stdout_stream_set = false;
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
            source_set = true;
            return Source{
                .stream = stream,
                .error_stream = err,
                .buffered_stream = BufferedStream{ .unbuffered_writer = stream.writer() },
                .buffered_error_stream = BufferedStream{ .unbuffered_writer = err.writer() },
            };
        }

        pub fn configureThread() void {
            std.debug.assert(stdout_stream_set);
            source = Source.init(stdout_stream, stderr_stream);
        }

        pub fn set(_source: *Source) void {
            source = _source.*;
            source_set = true;

            if (!stdout_stream_set) {
                stdout_stream_set = true;

                enable_ansi_colors = _source.error_stream.supportsAnsiEscapeCodes();

                is_stdout_piped = !_source.stream.isTty();
                is_stderr_piped = !_source.error_stream.isTty();

                stdout_stream = _source.stream;
                stderr_stream = _source.error_stream;
            }
        }
    };
    pub var enable_ansi_colors = isNative;
    pub var enable_buffering = true;
    pub var is_stdout_piped = false;
    pub var is_stderr_piped = false;

    pub inline fn isEmojiEnabled() bool {
        return enable_ansi_colors and !isWindows;
    }

    pub fn initTest() void {
        var in = std.io.getStdErr();
        var src = Output.Source.init(in, in);
        Output.Source.set(&src);
    }
    pub fn enableBuffering() void {
        enable_buffering = true;
    }

    pub fn disableBuffering() void {
        Output.flush();
        enable_buffering = false;
    }

    pub const WriterType: type = @typeInfo(std.meta.declarationInfo(Source.StreamType, "writer").data.Fn.fn_type).Fn.return_type.?;

    pub fn errorWriter() WriterType {
        std.debug.assert(source_set);
        return source.error_stream.writer();
    }

    pub fn errorStream() Source.StreamType {
        std.debug.assert(source_set);
        return source.error_stream;
    }

    pub fn writer() WriterType {
        std.debug.assert(source_set);
        return source.stream.writer();
    }

    pub fn flush() void {
        if (isNative and source_set) {
            source.buffered_stream.flush() catch {};
            source.buffered_error_stream.flush() catch {};
            // source.stream.flush() catch {};
            // source.error_stream.flush() catch {};
        }
    }

    pub fn printElapsed(elapsed: f64) void {
        Output.prettyError("<r><d>[<b>{d:>.2}ms<r><d>]<r>", .{elapsed});
    }

    pub fn printStartEnd(start: i128, end: i128) void {
        const elapsed = @divTrunc(end - start, @as(i128, std.time.ns_per_ms));
        printElapsed(@intToFloat(f64, elapsed));
    }

    pub fn printTimer(timer: *std.time.Timer) void {
        const elapsed = @divTrunc(timer.read(), @as(u64, std.time.ns_per_ms));
        printElapsed(@intToFloat(f64, elapsed));
    }

    pub fn printErrorable(comptime fmt: string, args: anytype) !void {
        if (comptime isWasm) {
            try source.stream.seekTo(0);
            try source.stream.writer().print(fmt, args);
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
        std.debug.assert(source_set);
        if (fmt[fmt.len - 1] != '\n') {
            return print(fmt ++ "\n", args);
        }

        return print(fmt, args);
    }

    pub fn print(comptime fmt: string, args: anytype) void {
        std.debug.assert(source_set);

        if (comptime isWasm) {
            source.stream.seekTo(0) catch return;
            source.stream.writer().print(fmt, args) catch return;

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
    const ED = "\x1b[";
    pub const color_map = std.ComptimeStringMap(string, .{
        &.{ "black", ED ++ "30m" },
        &.{ "blue", ED ++ "34m" },
        &.{ "b", ED ++ "1m" },
        &.{ "d", ED ++ "2m" },
        &.{ "cyan", ED ++ "36m" },
        &.{ "green", ED ++ "32m" },
        &.{ "magenta", ED ++ "35m" },
        &.{ "red", ED ++ "31m" },
        &.{ "white", ED ++ "37m" },
        &.{ "yellow", ED ++ "33m" },
    });

    pub fn prettyFmt(comptime fmt: string, comptime is_enabled: bool) string {
        comptime var new_fmt: [fmt.len * 4]u8 = undefined;
        comptime var new_fmt_i: usize = 0;

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
                        if (color_map.get(color_name)) |color_name_literal| {
                            break :color_picker color_name_literal;
                        } else if (std.mem.eql(u8, color_name, "r")) {
                            is_reset = true;
                            break :color_picker "";
                        } else {
                            @compileError("Invalid color name passed: " ++ color_name);
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

        return comptime new_fmt[0..new_fmt_i];
    }

    pub fn prettyWithPrinter(comptime fmt: string, args: anytype, comptime printer: anytype, comptime l: Level) void {
        if (comptime l == .Warn) {
            if (level == .Error) return;
        }

        if (enable_ansi_colors) {
            printer(comptime prettyFmt(fmt, true), args);
        } else {
            printer(comptime prettyFmt(fmt, false), args);
        }
    }

    pub fn pretty(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, print, .Error);
    }

    pub fn prettyln(comptime fmt: string, args: anytype) void {
        if (enable_ansi_colors) {
            println(comptime prettyFmt(fmt, true), args);
        } else {
            println(comptime prettyFmt(fmt, false), args);
        }
    }

    pub fn printErrorln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return printError(fmt ++ "\n", args);
        }

        return printError(fmt, args);
    }

    pub fn prettyError(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, printError, .Error);
    }

    pub fn prettyErrorln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return prettyWithPrinter(
                fmt ++ "\n",
                args,
                printError,
                .Error,
            );
        }

        return prettyWithPrinter(
            fmt,
            args,
            printError,
            .Error,
        );
    }

    pub const Level = enum(u8) {
        Warn,
        Error,
    };

    pub var level = if (isDebug) Level.Warn else Level.Error;

    pub fn prettyWarn(comptime fmt: string, args: anytype) void {
        prettyWithPrinter(fmt, args, printError, .Warn);
    }

    pub fn prettyWarnln(comptime fmt: string, args: anytype) void {
        if (fmt[fmt.len - 1] != '\n') {
            return prettyWithPrinter(fmt ++ "\n", args, printError, .Warn);
        }

        return prettyWithPrinter(fmt, args, printError, .Warn);
    }

    pub fn errorLn(comptime fmt: string, args: anytype) void {
        return printErrorln(fmt, args);
    }

    pub fn printError(comptime fmt: string, args: anytype) void {
        if (comptime isWasm) {
            source.error_stream.seekTo(0) catch return;
            source.error_stream.writer().print(fmt, args) catch unreachable;
            root.console_error(root.Uint8Array.fromSlice(source.err_buffer[0..source.error_stream.pos]));
        } else {
            std.fmt.format(source.error_stream.writer(), fmt, args) catch unreachable;
        }
    }
};

pub const Global = struct {
    pub const build_id = std.fmt.parseInt(u64, std.mem.trim(u8, @embedFile("../build-id"), "\n \r\t"), 10) catch unreachable;
    pub const package_json_version = if (isDebug)
        std.fmt.comptimePrint("0.0.{d}_debug", .{build_id})
    else
        std.fmt.comptimePrint("0.0.{d}", .{build_id});

    pub fn panic(comptime fmt: string, args: anytype) noreturn {
        @setCold(true);
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
        @setCold(true);

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
        @setCold(true);
        Global.panic("Not implemented yet!!!!!", .{});
    }

    // Make sure we always print any leftover
    pub fn crash() noreturn {
        @setCold(true);
        Output.flush();
        std.os.exit(1);
    }
};

pub const FileDescriptorType = if (isBrowser) u0 else std.os.fd_t;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = if (isWindows or isBrowser) u0 else std.os.fd_t;
