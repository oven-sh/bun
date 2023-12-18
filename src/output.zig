const Output = @This();
const bun = @import("root").bun;
const std = @import("std");
const Environment = @import("./env.zig");
const string = @import("root").bun.string;
const root = @import("root");
const strings = @import("root").bun.strings;
const StringTypes = @import("root").bun.StringTypes;
const Global = @import("root").bun.Global;
const ComptimeStringMap = @import("root").bun.ComptimeStringMap;
const use_mimalloc = @import("root").bun.use_mimalloc;
const writeStream = std.json.writeStream;
const WriteStream = std.json.WriteStream;

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
        err_stream: StreamType,
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
            .error_stream = err_stream,
            .buffered_stream = if (Environment.isNative)
                BufferedStream{ .unbuffered_writer = stream.writer() }
            else
                stream,
            .buffered_error_stream = if (Environment.isNative)
                BufferedStream{ .unbuffered_writer = err_stream.writer() }
            else
                err_stream,
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

    pub fn isNoColor() bool {
        const no_color = bun.getenvZ("NO_COLOR") orelse return false;
        // https://no-color.org/
        // "when present and not an empty string (regardless of its value)"
        return no_color.len != 0;
    }

    pub fn isForceColor() bool {
        const force_color = bun.getenvZ("FORCE_COLOR") orelse return false;
        // Supported by Node.js, if set will ignore NO_COLOR.
        // - "1", "true", or "" to indicate 16-color support
        // - "2" to indicate 256-color support
        // - "3" to indicate 16 million-color support
        return force_color.len == 0 or
            strings.eqlComptime(force_color, "1") or
            strings.eqlComptime(force_color, "true") or
            strings.eqlComptime(force_color, "2") or
            strings.eqlComptime(force_color, "3");
    }

    pub fn isColorTerminal() bool {
        if (bun.getenvZ("COLORTERM")) |color_term| {
            return !strings.eqlComptime(color_term, "0");
        }
        if (bun.getenvZ("TERM")) |term| {
            return !strings.eqlComptime(term, "dumb");
        }
        if (Environment.isWindows) {
            // https://github.com/chalk/supports-color/blob/d4f413efaf8da045c5ab440ed418ef02dbb28bf1/index.js#L100C11-L112
            // Windows 10 build 10586 is the first Windows release that supports 256 colors.
            // Windows 10 build 14931 is the first release that supports 16m/TrueColor.
            // Every other version supports 16 colors.
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
                var enable_color: ?bool = null;
                if (isForceColor()) {
                    enable_color = true;
                } else if (isNoColor() or !isColorTerminal()) {
                    enable_color = false;
                }

                const is_stdout_tty = _source.stream.isTty();
                if (is_stdout_tty) {
                    stdout_descriptor_type = OutputStreamDescriptor.terminal;
                }

                const is_stderr_tty = _source.error_stream.isTty();
                if (is_stderr_tty) {
                    stderr_descriptor_type = OutputStreamDescriptor.terminal;
                }

                enable_ansi_colors_stdout = enable_color orelse is_stdout_tty;
                enable_ansi_colors_stderr = enable_color orelse is_stderr_tty;
                enable_ansi_colors = enable_ansi_colors_stdout or enable_ansi_colors_stderr;
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
pub var is_verbose = false;
pub var is_github_action = false;

pub var stderr_descriptor_type = OutputStreamDescriptor.unknown;
pub var stdout_descriptor_type = OutputStreamDescriptor.unknown;

pub inline fn isEmojiEnabled() bool {
    return enable_ansi_colors and !Environment.isWindows;
}

pub fn isGithubAction() bool {
    if (bun.getenvZ("GITHUB_ACTIONS")) |value| {
        return strings.eqlComptime(value, "true");
    }
    return false;
}

pub fn isVerbose() bool {
    // Set by Github Actions when a workflow is run using debug mode.
    if (bun.getenvZ("RUNNER_DEBUG")) |value| {
        if (strings.eqlComptime(value, "1")) {
            return true;
        }
    }
    return false;
}

var _source_for_test: if (Environment.isTest) Output.Source else void = undefined;
var _source_for_test_set = false;
pub fn initTest() void {
    if (_source_for_test_set) return;
    _source_for_test_set = true;
    const in = std.io.getStdErr();
    const out = std.io.getStdOut();
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

pub fn resetTerminalAll() void {
    if (enable_ansi_colors_stderr)
        _ = source.error_stream.write("\x1b[H\x1b[2J") catch 0;
    if (enable_ansi_colors_stdout)
        _ = source.stream.write("\x1b[H\x1b[2J") catch 0;
}

/// Write buffered stdout & stderr to the terminal.
/// Must be called before the process exits or the buffered output will be lost.
/// Bun automatically calls this function in Global.exit().
pub fn flush() void {
    if (Environment.isNative and source_set) {
        source.buffered_stream.flush() catch {};
        source.buffered_error_stream.flush() catch {};
        // source.stream.flush() catch {};
        // source.error_stream.flush() catch {};
    }
}

pub const ElapsedFormatter = struct {
    colors: bool,
    duration_ns: u64 = 0,

    pub fn format(self: ElapsedFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer_: anytype) !void {
        switch (self.duration_ns) {
            0...std.time.ns_per_ms * 10 => {
                const fmt_str = "<r><d>[{d:>.2}ms<r><d>]<r>";
                switch (self.colors) {
                    inline else => |colors| try writer_.print(comptime prettyFmt(fmt_str, colors), .{@as(f64, @floatFromInt(self.duration_ns)) / std.time.ns_per_ms}),
                }
            },
            std.time.ns_per_ms * 8_000...std.math.maxInt(u64) => {
                const fmt_str = "<r><d>[<r><yellow>{d:>.2}ms<r><d>]<r>";

                switch (self.colors) {
                    inline else => |colors| try writer_.print(comptime prettyFmt(fmt_str, colors), .{@as(f64, @floatFromInt(self.duration_ns)) / std.time.ns_per_ms}),
                }
            },
            else => {
                const fmt_str = "<r><d>[<b>{d:>.2}ms<r><d>]<r>";

                switch (self.colors) {
                    inline else => |colors| try writer_.print(comptime prettyFmt(fmt_str, colors), .{@as(f64, @floatFromInt(self.duration_ns)) / std.time.ns_per_ms}),
                }
            },
        }
    }
};

inline fn printElapsedToWithCtx(elapsed: f64, comptime printerFn: anytype, comptime has_ctx: bool, ctx: anytype) void {
    switch (@as(i64, @intFromFloat(@round(elapsed)))) {
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

pub noinline fn printElapsedTo(elapsed: f64, comptime printerFn: anytype, ctx: anytype) void {
    printElapsedToWithCtx(elapsed, printerFn, true, ctx);
}

pub fn printElapsed(elapsed: f64) void {
    printElapsedToWithCtx(elapsed, Output.prettyError, false, {});
}

pub fn printElapsedStdout(elapsed: f64) void {
    printElapsedToWithCtx(elapsed, Output.pretty, false, {});
}

pub fn printElapsedStdoutTrim(elapsed: f64) void {
    switch (@as(i64, @intFromFloat(@round(elapsed)))) {
        0...1500 => {
            const fmt = "<r><d>[<b>{d:>}ms<r><d>]<r>";
            const args = .{elapsed};
            pretty(fmt, args);
        },
        else => {
            const fmt = "<r><d>[<b>{d:>}s<r><d>]<r>";
            const args = .{elapsed / 1000.0};

            pretty(fmt, args);
        },
    }
}

pub fn printStartEnd(start: i128, end: i128) void {
    const elapsed = @divTrunc(@as(i64, @truncate(end - start)), @as(i64, std.time.ns_per_ms));
    printElapsed(@as(f64, @floatFromInt(elapsed)));
}

pub fn printStartEndStdout(start: i128, end: i128) void {
    const elapsed = @divTrunc(@as(i64, @truncate(end - start)), @as(i64, std.time.ns_per_ms));
    printElapsedStdout(@as(f64, @floatFromInt(elapsed)));
}

pub fn printTimer(timer: *SystemTimer) void {
    if (comptime Environment.isWasm) return;
    const elapsed = @divTrunc(timer.read(), @as(u64, std.time.ns_per_ms));
    printElapsed(@as(f64, @floatFromInt(elapsed)));
}

pub noinline fn printErrorable(comptime fmt: string, args: anytype) !void {
    if (comptime Environment.isWasm) {
        try source.stream.seekTo(0);
        try source.stream.writer().print(fmt, args);
        root.console_error(root.Uint8Array.fromSlice(source.stream.buffer[0..source.stream.pos]));
    } else {
        std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
    }
}

/// Print to stdout
/// This will appear in the terminal, including in production.
/// Text automatically buffers
pub noinline fn println(comptime fmt: string, args: anytype) void {
    if (fmt.len == 0 or fmt[fmt.len - 1] != '\n') {
        return print(fmt ++ "\n", args);
    }

    return print(fmt, args);
}

/// Print to stdout, but only in debug builds.
/// Text automatically buffers
pub inline fn debug(comptime fmt: string, args: anytype) void {
    if (comptime Environment.isRelease) return;
    prettyErrorln("\n<d>DEBUG:<r> " ++ fmt, args);
    flush();
}

pub inline fn _debug(comptime fmt: string, args: anytype) void {
    std.debug.assert(source_set);
    println(fmt, args);
}

// callconv is a workaround for a zig wasm bug?
pub noinline fn print(comptime fmt: string, args: anytype) callconv(std.builtin.CallingConvention.Unspecified) void {
    if (comptime Environment.isWasm) {
        source.stream.pos = 0;
        std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        root.console_log(root.Uint8Array.fromSlice(source.stream.buffer[0..source.stream.pos]));
    } else {
        if (comptime Environment.allow_assert)
            std.debug.assert(source_set);

        // There's not much we can do if this errors. Especially if it's something like BrokenPipe.
        if (enable_buffering) {
            std.fmt.format(source.buffered_stream.writer(), fmt, args) catch {};
        } else {
            std.fmt.format(writer(), fmt, args) catch {};
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
const _log_fn = fn (comptime fmt: string, args: anytype) void;
pub fn scoped(comptime tag: @Type(.EnumLiteral), comptime disabled: bool) _log_fn {
    if (comptime !Environment.isDebug or !Environment.isNative) {
        return struct {
            pub fn log(comptime _: string, _: anytype) void {}
        }.log;
    }

    return struct {
        const BufferedWriter = Source.BufferedStream;
        var buffered_writer: BufferedWriter = undefined;
        var out: BufferedWriter.Writer = undefined;
        var out_set = false;
        var really_disable = disabled;
        var evaluated_disable = false;
        var lock = std.Thread.Mutex{};

        /// Debug-only logs which should not appear in release mode
        /// To enable a specific log at runtime, set the environment variable
        ///   BUN_DEBUG_${TAG} to 1
        /// For example, to enable the "foo" log, set the environment variable
        ///   BUN_DEBUG_foo=1
        /// To enable all logs, set the environment variable
        ///   BUN_DEBUG_ALL=1
        pub fn log(comptime fmt: string, args: anytype) void {
            if (fmt.len == 0 or fmt[fmt.len - 1] != '\n') {
                return log(fmt ++ "\n", args);
            }

            if (!evaluated_disable) {
                evaluated_disable = true;
                if (bun.getenvZ("BUN_DEBUG_ALL") != null or
                    bun.getenvZ("BUN_DEBUG_" ++ @tagName(tag)) != null)
                {
                    really_disable = false;
                } else if (bun.getenvZ("BUN_DEBUG_QUIET_LOGS") != null) {
                    really_disable = true;
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

            lock.lock();
            defer lock.unlock();

            if (Output.enable_ansi_colors_stderr) {
                out.print(comptime prettyFmt("<r><d>[" ++ @tagName(tag) ++ "]<r> " ++ fmt, true), args) catch {
                    really_disable = true;
                    return;
                };
                buffered_writer.flush() catch {
                    really_disable = true;
                    return;
                };
            } else {
                out.print(comptime prettyFmt("<r><d>[" ++ @tagName(tag) ++ "]<r> " ++ fmt, false), args) catch {
                    really_disable = true;
                    return;
                };
                buffered_writer.flush() catch {
                    really_disable = true;
                    return;
                };
            }
        }
    }.log;
}

// Valid "colors":
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
const RESET: string = "\x1b[0m";
pub fn prettyFmt(comptime fmt: string, comptime is_enabled: bool) string {
    if (comptime @import("root").bun.fast_debug_build_mode)
        return fmt;

    comptime var new_fmt: [fmt.len * 4]u8 = undefined;
    comptime var new_fmt_i: usize = 0;

    @setEvalBranchQuota(9999);
    comptime var i: usize = 0;
    comptime while (i < fmt.len) {
        const c = fmt[i];
        switch (c) {
            '\\' => {
                i += 1;
                if (i < fmt.len) {
                    switch (fmt[i]) {
                        '<', '>' => {
                            new_fmt[new_fmt_i] = fmt[i];
                            new_fmt_i += 1;
                            i += 1;
                        },
                        else => {
                            new_fmt[new_fmt_i] = '\\';
                            new_fmt_i += 1;
                            new_fmt[new_fmt_i] = fmt[i];
                            new_fmt_i += 1;
                            i += 1;
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
                const start: usize = i;
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

                if (is_enabled) {
                    for (if (is_reset) RESET else color_str) |ch| {
                        new_fmt[new_fmt_i] = ch;
                        new_fmt_i += 1;
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

pub noinline fn prettyWithPrinter(comptime fmt: string, args: anytype, comptime printer: anytype, comptime l: Destination) void {
    if (if (comptime l == .stdout) enable_ansi_colors_stdout else enable_ansi_colors_stderr) {
        printer(comptime prettyFmt(fmt, true), args);
    } else {
        printer(comptime prettyFmt(fmt, false), args);
    }
}

pub noinline fn prettyWithPrinterFn(comptime fmt: string, args: anytype, comptime printFn: anytype, ctx: anytype) void {
    if (comptime @import("root").bun.fast_debug_build_mode)
        return printFn(ctx, comptime prettyFmt(fmt, false), args);

    if (enable_ansi_colors) {
        printFn(ctx, comptime prettyFmt(fmt, true), args);
    } else {
        printFn(ctx, comptime prettyFmt(fmt, false), args);
    }
}

pub noinline fn pretty(comptime fmt: string, args: anytype) void {
    prettyWithPrinter(fmt, args, print, .stdout);
}

/// Like Output.println, except it will automatically strip ansi color codes if
/// the terminal doesn't support them.
pub fn prettyln(comptime fmt: string, args: anytype) void {
    prettyWithPrinter(fmt, args, println, .stdout);
}

pub noinline fn printErrorln(comptime fmt: string, args: anytype) void {
    if (fmt.len == 0 or fmt[fmt.len - 1] != '\n') {
        return printError(fmt ++ "\n", args);
    }

    return printError(fmt, args);
}

pub noinline fn prettyError(comptime fmt: string, args: anytype) void {
    prettyWithPrinter(fmt, args, printError, .stderr);
}

/// Print to stderr with ansi color codes automatically stripped out if the
/// terminal doesn't support them. Text is buffered
pub fn prettyErrorln(comptime fmt: string, args: anytype) void {
    prettyWithPrinter(fmt, args, printErrorln, .stderr);
}

pub const Destination = enum(u8) {
    stderr,
    stdout,
};

pub noinline fn printError(comptime fmt: string, args: anytype) void {
    if (comptime Environment.isWasm) {
        source.error_stream.seekTo(0) catch return;
        source.error_stream.writer().print(fmt, args) catch unreachable;
        root.console_error(root.Uint8Array.fromSlice(source.err_buffer[0..source.error_stream.pos]));
    } else {
        // There's not much we can do if this errors. Especially if it's something like BrokenPipe
        if (enable_buffering)
            std.fmt.format(source.buffered_error_stream.writer(), fmt, args) catch {}
        else
            std.fmt.format(source.error_stream.writer(), fmt, args) catch {};
    }
}

pub const DebugTimer = struct {
    timer: @import("root").bun.DebugOnly(std.time.Timer) = undefined,

    pub fn start() DebugTimer {
        if (comptime Environment.isDebug) {
            return DebugTimer{
                .timer = std.time.Timer.start() catch unreachable,
            };
        } else {
            return .{};
        }
    }

    pub const WriteError = error{};

    pub fn format(self: DebugTimer, comptime _: []const u8, opts: std.fmt.FormatOptions, writer_: anytype) WriteError!void {
        if (comptime Environment.isDebug) {
            var timer = self.timer;
            var _opts = opts;
            _opts.precision = 3;
            std.fmt.formatFloatDecimal(
                @as(f64, @floatCast(@as(f64, @floatFromInt(timer.read())) / std.time.ns_per_ms)),
                _opts,
                writer_,
            ) catch unreachable;
            writer_.writeAll("ms") catch {};
        }
    }
};

/// Print a blue note message
pub inline fn note(comptime fmt: []const u8, args: anytype) void {
    prettyErrorln("<blue>note<r><d>:<r> " ++ fmt, args);
}

/// Print a yellow warning message
pub inline fn warn(comptime fmt: []const u8, args: anytype) void {
    prettyErrorln("<yellow>warn<r><d>:<r> " ++ fmt, args);
}

/// Print a yellow warning message, only in debug mode
pub inline fn debugWarn(comptime fmt: []const u8, args: anytype) void {
    if (Environment.isDebug)
        prettyErrorln("<yellow>debug warn<r><d>:<r> " ++ fmt, args);
}

/// Print a red error message. The first argument takes an `error_name` value, which can be either
/// be a Zig error, or a string or enum. The error name is converted to a string and displayed
/// in place of "error:", making it useful to print things like "EACCES: Couldn't open package.json"
pub inline fn err(error_name: anytype, comptime fmt: []const u8, args: anytype) void {
    const display_name, const is_comptime_name = display_name: {
        const T = @TypeOf(error_name);
        const info = @typeInfo(T);

        // Zig string literals are of type *const [n:0]u8
        // we assume that no one will pass this type from not using a string literal.
        if (info == .Pointer and info.Pointer.size == .One and info.Pointer.is_const) {
            const child_info = @typeInfo(info.Pointer.child);
            if (child_info == .Array and child_info.Array.child == u8) {
                if (child_info.Array.len == 0) @compileError("Output.err should not be passed an empty string (use errGeneric)");
                break :display_name .{ error_name, true };
            }
        }

        // other zig strings we shall treat as dynamic
        if (comptime bun.trait.isZigString(T)) {
            break :display_name .{ error_name, false };
        }

        // error unions
        if (info == .ErrorSet) {
            if (info.ErrorSet) |errors| {
                if (errors.len == 0) {
                    @compileError("Output.err was given an empty error set");
                }

                // TODO: convert zig errors to errno for better searchability?
                if (errors.len == 1) break :display_name .{ comptime @errorName(errors[0]), true };
            }

            break :display_name .{ @errorName(error_name), false };
        }

        // enum literals
        if (info == .EnumLiteral) {
            const tag = @tagName(info);
            comptime std.debug.assert(tag.len > 0); // how?
            if (tag[0] != 'E') break :display_name .{ "E" ++ tag, true };
            break :display_name .{ tag, true };
        }

        // enums
        if (info == .Enum) {
            const errno: bun.C.SystemErrno = @enumFromInt(@intFromEnum(info));
            break :display_name .{ @tagName(errno), false };
        }

        @compileLog(error_name);
        @compileError("err() was given unsupported type: " ++ @typeName(T) ++ " (." ++ @tagName(info) ++ ")");
    };

    // if the name is known at compile time, we can do better and use it at compile time
    if (comptime is_comptime_name) {
        prettyErrorln("<red>" ++ display_name ++ "<r><d>:<r> " ++ fmt, args);
    } else {
        prettyErrorln("<red>{s}<r><d>:<r> " ++ fmt, .{display_name} ++ args);
    }
}

/// Print a red error message with "error: " as the prefix. For custom prefixes see `err()`
pub inline fn errGeneric(comptime fmt: []const u8, args: anytype) void {
    prettyErrorln("<red>error<r><d>:<r> " ++ fmt, args);
}
