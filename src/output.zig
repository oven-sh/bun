const Output = @This();
const std = @import("std");
const Environment = @import("./env.zig");
const string = @import("./global.zig").string;
const root = @import("root");
const strings = @import("./global.zig").strings;
const StringTypes = @import("./global.zig").StringTypes;
const Global = @import("./global.zig").Global;
const ComptimeStringMap = @import("./global.zig").ComptimeStringMap;
const use_mimalloc = @import("./global.zig").use_mimalloc;

const SystemTimer = @import("./system_timer.zig").Timer;

// These are threadlocal so we don't have stdout/stderr writing on top of each other
threadlocal var source: Source = undefined;
threadlocal var source_set: bool = false;

// These are not threadlocal so we avoid opening stdout/stderr for every thread
var stderr_stream: Source.StreamType = undefined;
var stdout_stream: Source.StreamType = undefined;
var stdout_stream_set = false;

pub var terminal_size: std.os.winsize = .{
    .ws_row = 0,
    .ws_col = 0,
    .ws_xpixel = 0,
    .ws_ypixel = 0,
};

pub const Source = struct {
    pub const StreamType: type = brk: {
        if (Environment.isWasm) {
            break :brk std.io.FixedBufferStream([]u8);
        } else {
            break :brk std.fs.File;
            // var stdout = std.io.getStdOut();
            // return @TypeOf(std.io.bufferedWriter(stdout.writer()));
        }
    };
    pub const BufferedStream: type = struct {
        fn getBufferedStream() type {
            if (comptime Environment.isWasm)
                return StreamType;

            return std.io.BufferedWriter(4096, @TypeOf(StreamType.writer(undefined)));
        }
    }.getBufferedStream();

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
        if (comptime Environment.isDebug) {
            if (comptime use_mimalloc) {
                if (!source_set) {
                    const Mimalloc = @import("./allocators/mimalloc.zig");
                    Mimalloc.mi_option_set(.show_errors, 1);
                }
            }
        }
        source_set = true;

        return Source{
            .stream = stream,
            .error_stream = err,
            .buffered_stream = if (Environment.isNative)
                BufferedStream{ .unbuffered_writer = stream.writer() }
            else
                stream,
            .buffered_error_stream = if (Environment.isNative)
                BufferedStream{ .unbuffered_writer = err.writer() }
            else
                err,
        };
    }

    pub fn configureThread() void {
        if (source_set) return;
        std.debug.assert(stdout_stream_set);
        source = Source.init(stdout_stream, stderr_stream);
    }

    pub fn configureNamedThread(name: StringTypes.stringZ) void {
        Global.setThreadName(name);
        configureThread();
    }

    fn isForceColor() ?bool {
        if (std.os.getenvZ("NO_COLOR") != null) return false;
        const force_color_str = std.os.getenvZ("FORCE_COLOR") orelse return null;
        return force_color_str.len == 0 or
            strings.eqlComptime(force_color_str, "TRUE") or
            strings.eqlComptime(force_color_str, "ON") or
            strings.eqlComptime(force_color_str, "YES") or
            strings.eqlComptime(force_color_str, "1") or
            strings.eqlComptime(force_color_str, " ");
    }

    fn isColorTerminal() bool {
        if (isForceColor()) |val| return val;
        if (std.os.getenvZ("COLOR_TERM")) |color_term| return !strings.eqlComptime(color_term, "0");

        if (std.os.getenvZ("TERM")) |term| {
            if (strings.eqlComptime(term, "dumb")) return false;

            return true;
        }

        return false;
    }

    pub fn set(_source: *Source) void {
        source = _source.*;

        source_set = true;
        if (!stdout_stream_set) {
            stdout_stream_set = true;
            if (comptime Environment.isNative) {
                var is_color_terminal: ?bool = null;
                if (_source.stream.isTty()) {
                    stdout_descriptor_type = OutputStreamDescriptor.terminal;
                    is_color_terminal = is_color_terminal orelse isColorTerminal();
                    enable_ansi_colors_stdout = is_color_terminal.?;
                } else if (isForceColor()) |val| {
                    enable_ansi_colors_stdout = val;
                } else {
                    enable_ansi_colors_stdout = false;
                }

                if (_source.error_stream.isTty()) {
                    stderr_descriptor_type = OutputStreamDescriptor.terminal;
                    is_color_terminal = is_color_terminal orelse isColorTerminal();
                    enable_ansi_colors_stderr = is_color_terminal.?;
                } else if (isForceColor()) |val| {
                    enable_ansi_colors_stderr = val;
                } else {
                    enable_ansi_colors_stderr = false;
                }

                enable_ansi_colors = enable_ansi_colors_stderr or enable_ansi_colors_stdout;
            }

            stdout_stream = _source.stream;
            stderr_stream = _source.error_stream;
        }
    }
};

pub const OutputStreamDescriptor = enum {
    unknown,
    // file,
    // pipe,
    terminal,
};

pub var enable_ansi_colors = Environment.isNative;
pub var enable_ansi_colors_stderr = Environment.isNative;
pub var enable_ansi_colors_stdout = Environment.isNative;
pub var enable_buffering = Environment.isNative;

pub var stderr_descriptor_type = OutputStreamDescriptor.unknown;
pub var stdout_descriptor_type = OutputStreamDescriptor.unknown;

pub inline fn isEmojiEnabled() bool {
    return enable_ansi_colors and !Environment.isWindows;
}

var _source_for_test: if (Environment.isTest) Output.Source else void = undefined;
var _source_for_test_set = false;
pub fn initTest() void {
    if (_source_for_test_set) return;
    _source_for_test_set = true;
    var in = std.io.getStdErr();
    var out = std.io.getStdOut();
    _source_for_test = Output.Source.init(out, in);
    Output.Source.set(&_source_for_test);
}
pub fn enableBuffering() void {
    if (comptime Environment.isNative) enable_buffering = true;
}

pub fn disableBuffering() void {
    Output.flush();
    if (comptime Environment.isNative) enable_buffering = false;
}

pub fn panic(comptime fmt: string, args: anytype) noreturn {
    if (Output.isEmojiEnabled()) {
        std.debug.panic(comptime Output.prettyFmt(fmt, true), args);
    } else {
        std.debug.panic(comptime Output.prettyFmt(fmt, false), args);
    }
}

pub const WriterType: type = @TypeOf(Source.StreamType.writer(undefined));

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

pub fn resetTerminal() void {
    if (!enable_ansi_colors) {
        return;
    }

    if (enable_ansi_colors_stderr) {
        _ = source.error_stream.write("\x1b[H\x1b[2J") catch 0;
    } else {
        _ = source.stream.write("\x1b[H\x1b[2J") catch 0;
    }
}

pub fn flush() void {
    if (Environment.isNative and source_set) {
        source.buffered_stream.flush() catch {};
        source.buffered_error_stream.flush() catch {};
        // source.stream.flush() catch {};
        // source.error_stream.flush() catch {};
    }
}

inline fn printElapsedToWithCtx(elapsed: f64, comptime printerFn: anytype, comptime has_ctx: bool, ctx: anytype) void {
    switch (elapsed) {
        0...1500 => {
            const fmt = "<r><d>[<b>{d:>.2}ms<r><d>]<r>";
            const args = .{elapsed};
            if (comptime has_ctx) {
                printerFn(ctx, fmt, args);
            } else {
                printerFn(fmt, args);
            }
        },
        else => {
            const fmt = "<r><d>[<b>{d:>.2}s<r><d>]<r>";
            const args = .{elapsed / 1000.0};

            if (comptime has_ctx) {
                printerFn(ctx, fmt, args);
            } else {
                printerFn(fmt, args);
            }
        },
    }
}

pub fn printElapsedTo(elapsed: f64, comptime printerFn: anytype, ctx: anytype) void {
    printElapsedToWithCtx(elapsed, printerFn, true, ctx);
}

pub fn printElapsed(elapsed: f64) void {
    printElapsedToWithCtx(elapsed, Output.prettyError, false, void{});
}

pub fn printElapsedStdout(elapsed: f64) void {
    printElapsedToWithCtx(elapsed, Output.pretty, false, void{});
}

pub fn printStartEnd(start: i128, end: i128) void {
    const elapsed = @divTrunc(end - start, @as(i128, std.time.ns_per_ms));
    printElapsed(@intToFloat(f64, elapsed));
}

pub fn printStartEndStdout(start: i128, end: i128) void {
    const elapsed = @divTrunc(end - start, @as(i128, std.time.ns_per_ms));
    printElapsedStdout(@intToFloat(f64, elapsed));
}

pub fn printTimer(timer: *SystemTimer) void {
    if (comptime Environment.isWasm) return;
    const elapsed = @divTrunc(timer.read(), @as(u64, std.time.ns_per_ms));
    printElapsed(@intToFloat(f64, elapsed));
}

pub fn printErrorable(comptime fmt: string, args: anytype) !void {
    if (comptime Environment.isWasm) {
        try source.stream.seekTo(0);
        try source.stream.writer().print(fmt, args);
        root.console_error(root.Uint8Array.fromSlice(source.stream.buffer[0..source.stream.pos]));
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

pub inline fn debug(comptime fmt: string, args: anytype) void {
    if (comptime Environment.isRelease) return;
    prettyErrorln("\n<d>DEBUG:<r> " ++ fmt, args);
    flush();
}

pub fn _debug(comptime fmt: string, args: anytype) void {
    std.debug.assert(source_set);
    if (fmt[fmt.len - 1] != '\n') {
        return print(fmt ++ "\n", args);
    }

    return print(fmt, args);
}

pub fn print(comptime fmt: string, args: anytype) void {
    if (comptime Environment.isWasm) {
        source.stream.pos = 0;
        std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        root.console_log(root.Uint8Array.fromSlice(source.stream.buffer[0..source.stream.pos]));
    } else {
        std.debug.assert(source_set);

        if (enable_buffering) {
            std.fmt.format(source.buffered_stream.writer(), fmt, args) catch unreachable;
        } else {
            std.fmt.format(writer(), fmt, args) catch unreachable;
        }
    }
}

/// Debug-only logs which should not appear in release mode
/// To enable a specific log at runtime, set the environment variable
///   BUN_DEBUG_${TAG} to 1
/// For example, to enable the "foo" log, set the environment variable
///   BUN_DEBUG_foo=1
/// To enable all logs, set the environment variable
///   BUN_DEBUG_ALL=1
const _log_fn = fn (comptime fmt: string, args: anytype) callconv(.Inline) void;
pub fn scoped(comptime tag: @Type(.EnumLiteral), comptime disabled: bool) _log_fn {
    if (comptime !Environment.isDebug) {
        return struct {
            pub inline fn log(comptime _: string, _: anytype) void {}
        }.log;
    }

    return struct {
        const BufferedWriter = Source.BufferedStream;
        var buffered_writer: BufferedWriter = undefined;
        var out: BufferedWriter.Writer = undefined;
        var out_set = false;
        var really_disable = disabled;
        var evaluated_disable = false;

        /// Debug-only logs which should not appear in release mode
        /// To enable a specific log at runtime, set the environment variable
        ///   BUN_DEBUG_${TAG} to 1
        /// For example, to enable the "foo" log, set the environment variable
        ///   BUN_DEBUG_foo=1
        /// To enable all logs, set the environment variable
        ///   BUN_DEBUG_ALL=1
        pub inline fn log(comptime fmt: string, args: anytype) void {
            if (!evaluated_disable) {
                evaluated_disable = true;
                if (std.os.getenv("BUN_DEBUG_ALL") != null or
                    std.os.getenv("BUN_DEBUG_" ++ @tagName(tag)) != null)
                {
                    really_disable = false;
                }
            }

            if (really_disable)
                return;

            if (!out_set) {
                buffered_writer = .{
                    .unbuffered_writer = writer(),
                };
                out = buffered_writer.writer();
                out_set = true;
            }

            if (comptime fmt[fmt.len - 1] != '\n') {
                return log(fmt ++ "\n", args);
            }

            if (Output.enable_ansi_colors_stderr) {
                out.print(comptime prettyFmt("<r><d>[" ++ @tagName(tag) ++ "]<r> " ++ fmt, true), args) catch unreachable;
                buffered_writer.flush() catch unreachable;
            } else {
                out.print(comptime prettyFmt("<r><d>[" ++ @tagName(tag) ++ "]<r> " ++ fmt, false), args) catch unreachable;
                buffered_writer.flush() catch unreachable;
            }
        }
    }.log;
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
pub const ED = "\x1b[";
pub const color_map = ComptimeStringMap(string, .{
    &.{ "black", ED ++ "30m" },
    &.{ "blue", ED ++ "34m" },
    &.{ "b", ED ++ "1m" },
    &.{ "d", ED ++ "2m" },
    &.{ "i", ED ++ "3m" },
    &.{ "cyan", ED ++ "36m" },
    &.{ "green", ED ++ "32m" },
    &.{ "magenta", ED ++ "35m" },
    &.{ "red", ED ++ "31m" },
    &.{ "white", ED ++ "37m" },
    &.{ "yellow", ED ++ "33m" },
});
pub const RESET = "\x1b[0m";
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
                        const reset_sequence = RESET;
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

    if (if (comptime l == Level.stdout) enable_ansi_colors_stdout else enable_ansi_colors_stderr) {
        printer(comptime prettyFmt(fmt, true), args);
    } else {
        printer(comptime prettyFmt(fmt, false), args);
    }
}

pub fn prettyWithPrinterFn(comptime fmt: string, args: anytype, comptime printFn: anytype, ctx: anytype) void {
    if (enable_ansi_colors) {
        printFn(ctx, comptime prettyFmt(fmt, true), args);
    } else {
        printFn(ctx, comptime prettyFmt(fmt, false), args);
    }
}

pub fn pretty(comptime fmt: string, args: anytype) void {
    prettyWithPrinter(fmt, args, print, .stdout);
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
    stdout,
};

pub var level = if (Environment.isDebug) Level.Warn else Level.Error;

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
    if (comptime Environment.isWasm) {
        source.error_stream.seekTo(0) catch return;
        source.error_stream.writer().print(fmt, args) catch unreachable;
        root.console_error(root.Uint8Array.fromSlice(source.err_buffer[0..source.error_stream.pos]));
    } else {
        if (enable_buffering)
            std.fmt.format(source.buffered_error_stream.writer(), fmt, args) catch {}
        else
            std.fmt.format(source.error_stream.writer(), fmt, args) catch {};
    }
}
