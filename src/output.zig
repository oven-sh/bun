const bun = @import("bun");
const std = @import("std");
const Environment = @import("./env.zig");
const string = bun.string;
const root = @import("root");
const strings = bun.strings;
const StringTypes = bun.StringTypes;
const Global = bun.Global;
const ComptimeStringMap = bun.ComptimeStringMap;
const use_mimalloc = bun.use_mimalloc;
const c = bun.c;

const SystemTimer = @import("./system_timer.zig").Timer;

// These are threadlocal so we don't have stdout/stderr writing on top of each other
threadlocal var source: Source = undefined;
threadlocal var source_set: bool = false;

// These are not threadlocal so we avoid opening stdout/stderr for every thread
var stderr_stream: Source.StreamType = undefined;
var stdout_stream: Source.StreamType = undefined;
var stdout_stream_set = false;
const File = bun.sys.File;
pub var terminal_size: std.posix.winsize = .{
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
            break :brk File;
            // var stdout = std.io.getStdOut();
            // return @TypeOf(std.io.bufferedWriter(stdout.writer()));
        }
    };
    pub const BufferedStream: type = struct {
        fn getBufferedStream() type {
            if (comptime Environment.isWasm)
                return StreamType;

            return std.io.BufferedWriter(4096, @TypeOf(StreamType.quietWriter(undefined)));
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
                BufferedStream{ .unbuffered_writer = stream.quietWriter() }
            else
                stream,
            .buffered_error_stream = if (Environment.isNative)
                BufferedStream{ .unbuffered_writer = err_stream.quietWriter() }
            else
                err_stream,
        };
    }

    pub fn configureThread() void {
        if (source_set) return;
        bun.debugAssert(stdout_stream_set);
        source = Source.init(stdout_stream, stderr_stream);
        bun.StackCheck.configureThread();
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

    pub fn getForceColorDepth() ?ColorDepth {
        const force_color = bun.getenvZ("FORCE_COLOR") orelse return null;
        // Supported by Node.js, if set will ignore NO_COLOR.
        // - "0" to indicate no color support
        // - "1", "true", or "" to indicate 16-color support
        // - "2" to indicate 256-color support
        // - "3" to indicate 16 million-color support
        if (strings.eqlComptime(force_color, "1") or strings.eqlComptime(force_color, "true") or strings.eqlComptime(force_color, "")) {
            return ColorDepth.@"16";
        }

        if (strings.eqlComptime(force_color, "2")) {
            return ColorDepth.@"256";
        }
        if (strings.eqlComptime(force_color, "3")) {
            return ColorDepth.@"16m";
        }

        return ColorDepth.none;
    }

    pub fn isForceColor() bool {
        return (getForceColorDepth() orelse ColorDepth.none) != .none;
    }

    pub fn isColorTerminal() bool {
        if (Environment.isWindows) {
            // https://github.com/chalk/supports-color/blob/d4f413efaf8da045c5ab440ed418ef02dbb28bf1/index.js#L100C11-L112
            // Windows 10 build 10586 is the first Windows release that supports 256 colors.
            // Windows 10 build 14931 is the first release that supports 16m/TrueColor.
            // Every other version supports 16 colors.
            return true;
        }

        return colorDepth() != .none;
    }

    export var bun_stdio_tty: [3]i32 = .{ 0, 0, 0 };

    const WindowsStdio = struct {
        const w = bun.windows;

        /// At program start, we snapshot the console modes of standard in, out, and err
        /// so that we can restore them at program exit if they change. Restoration is
        /// best-effort, and may not be applied if the process is killed abruptly.
        pub var console_mode = [3]?u32{ null, null, null };
        pub var console_codepage = @as(u32, 0);
        pub var console_output_codepage = @as(u32, 0);

        pub export fn Bun__restoreWindowsStdio() callconv(.C) void {
            restore();
        }
        comptime {
            if (Environment.isWindows) {
                _ = &Bun__restoreWindowsStdio;
            }
        }

        pub fn restore() void {
            const peb = std.os.windows.peb();
            const stdout = peb.ProcessParameters.hStdOutput;
            const stderr = peb.ProcessParameters.hStdError;
            const stdin = peb.ProcessParameters.hStdInput;

            const handles = &.{ &stdin, &stdout, &stderr };
            inline for (console_mode, handles) |mode, handle| {
                if (mode) |m| {
                    _ = c.SetConsoleMode(handle.*, m);
                }
            }

            if (console_output_codepage != 0)
                _ = c.SetConsoleOutputCP(console_output_codepage);

            if (console_codepage != 0)
                _ = c.SetConsoleCP(console_codepage);
        }

        pub fn init() void {
            w.libuv.uv_disable_stdio_inheritance();

            const stdin = std.os.windows.GetStdHandle(std.os.windows.STD_INPUT_HANDLE) catch w.INVALID_HANDLE_VALUE;
            const stdout = std.os.windows.GetStdHandle(std.os.windows.STD_OUTPUT_HANDLE) catch w.INVALID_HANDLE_VALUE;
            const stderr = std.os.windows.GetStdHandle(std.os.windows.STD_ERROR_HANDLE) catch w.INVALID_HANDLE_VALUE;

            const fd_internals = @import("fd.zig");
            const INVALID_HANDLE_VALUE = std.os.windows.INVALID_HANDLE_VALUE;
            fd_internals.windows_cached_stderr = if (stderr != INVALID_HANDLE_VALUE) .fromSystem(stderr) else .invalid;
            fd_internals.windows_cached_stdout = if (stdout != INVALID_HANDLE_VALUE) .fromSystem(stdout) else .invalid;
            fd_internals.windows_cached_stdin = if (stdin != INVALID_HANDLE_VALUE) .fromSystem(stdin) else .invalid;
            if (Environment.isDebug) fd_internals.windows_cached_fd_set = true;

            buffered_stdin.unbuffered_reader.context.handle = .stdin();

            // https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp
            const CP_UTF8 = 65001;
            console_output_codepage = c.GetConsoleOutputCP();
            _ = c.SetConsoleOutputCP(CP_UTF8);

            console_codepage = c.GetConsoleOutputCP();
            _ = c.SetConsoleCP(CP_UTF8);

            var mode: w.DWORD = undefined;
            if (c.GetConsoleMode(stdin, &mode) != 0) {
                console_mode[0] = mode;
                bun_stdio_tty[0] = 1;
                // There are no flags to set on standard in, but just in case something
                // later modifies the mode, we can still reset it at the end of program run
                //
                // In the past, Bun would set ENABLE_VIRTUAL_TERMINAL_INPUT, which was not
                // intentionally set for any purpose, and instead only caused problems.
            }

            if (c.GetConsoleMode(stdout, &mode) != 0) {
                console_mode[1] = mode;
                bun_stdio_tty[1] = 1;
                _ = c.SetConsoleMode(stdout, w.ENABLE_PROCESSED_OUTPUT | std.os.windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING | w.ENABLE_WRAP_AT_EOL_OUTPUT | mode);
            }

            if (c.GetConsoleMode(stderr, &mode) != 0) {
                console_mode[2] = mode;
                bun_stdio_tty[2] = 1;
                _ = c.SetConsoleMode(stderr, w.ENABLE_PROCESSED_OUTPUT | std.os.windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING | w.ENABLE_WRAP_AT_EOL_OUTPUT | mode);
            }
        }
    };

    pub const Stdio = struct {
        extern "c" var bun_is_stdio_null: [3]i32;

        pub fn isStderrNull() bool {
            return bun_is_stdio_null[2] == 1;
        }

        pub fn isStdoutNull() bool {
            return bun_is_stdio_null[1] == 1;
        }

        pub fn isStdinNull() bool {
            return bun_is_stdio_null[0] == 1;
        }

        pub extern "c" fn bun_initialize_process() void;
        pub fn init() void {
            bun_initialize_process();

            if (Environment.isWindows) {
                WindowsStdio.init();
            }

            const stdout = bun.sys.File.from(std.io.getStdOut());
            const stderr = bun.sys.File.from(std.io.getStdErr());

            Source.init(stdout, stderr)
                .set();

            if (comptime Environment.isDebug or Environment.enable_logs) {
                initScopedDebugWriterAtStartup();
            }
        }

        pub extern "c" fn bun_restore_stdio() void;
        pub fn restore() void {
            if (Environment.isWindows) {
                WindowsStdio.restore();
            } else {
                bun_restore_stdio();
            }
        }
    };

    pub const ColorDepth = enum {
        none,
        @"16",
        @"256",
        @"16m",
    };
    var lazy_color_depth: ColorDepth = .none;
    var color_depth_once = std.once(getColorDepthOnce);
    fn getColorDepthOnce() void {
        if (getForceColorDepth()) |depth| {
            lazy_color_depth = depth;
            return;
        }

        if (isNoColor()) {
            return;
        }

        const term = bun.getenvZ("TERM") orelse "";
        if (strings.eqlComptime(term, "dumb")) {
            return;
        }

        if (bun.getenvZ("TMUX") != null) {
            lazy_color_depth = .@"256";
            return;
        }

        if (bun.getenvZ("CI")) |ci| {
            inline for (.{ "APPVEYOR", "BUILDKITE", "CIRCLECI", "DRONE", "GITHUB_ACTIONS", "GITLAB_CI", "TRAVIS" }) |ci_env| {
                if (strings.eqlComptime(ci, ci_env)) {
                    lazy_color_depth = .@"256";
                    return;
                }
            }

            lazy_color_depth = .@"16";
            return;
        }

        if (bun.getenvZ("TERM_PROGRAM")) |term_program| {
            const use_16m = .{
                "ghostty",
                "MacTerm",
                "WezTerm",
                "HyperTerm",
                "iTerm.app",
            };
            inline for (use_16m) |program| {
                if (strings.eqlComptime(term_program, program)) {
                    lazy_color_depth = .@"16m";
                    return;
                }
            }
        }

        var has_color_term_set = false;

        if (bun.getenvZ("COLORTERM")) |color_term| {
            if (strings.eqlComptime(color_term, "truecolor") or strings.eqlComptime(color_term, "24bit")) {
                lazy_color_depth = .@"16m";
                return;
            }
            has_color_term_set = true;
        }

        if (term.len > 0) {
            if (strings.hasPrefixComptime(term, "xterm-256")) {
                lazy_color_depth = .@"256";
                return;
            }
            const pairs = .{
                .{ "st", ColorDepth.@"16" },
                .{ "hurd", ColorDepth.@"16" },
                .{ "eterm", ColorDepth.@"16" },
                .{ "gnome", ColorDepth.@"16" },
                .{ "kterm", ColorDepth.@"16" },
                .{ "mosh", ColorDepth.@"16m" },
                .{ "putty", ColorDepth.@"16" },
                .{ "cons25", ColorDepth.@"16" },
                .{ "cygwin", ColorDepth.@"16" },
                .{ "dtterm", ColorDepth.@"16" },
                .{ "mlterm", ColorDepth.@"16" },
                .{ "console", ColorDepth.@"16" },
                .{ "jfbterm", ColorDepth.@"16" },
                .{ "konsole", ColorDepth.@"16" },
                .{ "terminator", ColorDepth.@"16m" },
                .{ "xterm-ghostty", ColorDepth.@"16m" },
                .{ "rxvt-unicode-24bit", ColorDepth.@"16m" },
            };

            inline for (pairs) |pair| {
                if (strings.eqlComptime(term, pair[0])) {
                    lazy_color_depth = pair[1];
                    return;
                }
            }

            if (strings.includes(term, "con") or
                strings.includes(term, "ansi") or
                strings.includes(term, "rxvt") or
                strings.includes(term, "color") or
                strings.includes(term, "linux") or
                strings.includes(term, "vt100") or
                strings.includes(term, "xterm") or
                strings.includes(term, "screen"))
            {
                lazy_color_depth = .@"16";
                return;
            }
        }

        if (has_color_term_set) {
            lazy_color_depth = .@"16";
            return;
        }

        lazy_color_depth = .none;
    }
    pub fn colorDepth() ColorDepth {
        color_depth_once.call();
        return lazy_color_depth;
    }

    pub fn set(new_source: *const Source) void {
        source = new_source.*;

        source_set = true;
        if (!stdout_stream_set) {
            stdout_stream_set = true;
            if (comptime Environment.isNative) {
                const is_stdout_tty = bun_stdio_tty[1] != 0;
                if (is_stdout_tty) {
                    stdout_descriptor_type = OutputStreamDescriptor.terminal;
                }

                const is_stderr_tty = bun_stdio_tty[2] != 0;
                if (is_stderr_tty) {
                    stderr_descriptor_type = OutputStreamDescriptor.terminal;
                }

                var enable_color: ?bool = null;
                if (isForceColor()) {
                    enable_color = true;
                } else if (isNoColor()) {
                    enable_color = false;
                } else if (isColorTerminal() and (is_stdout_tty or is_stderr_tty)) {
                    enable_color = true;
                }

                enable_ansi_colors_stdout = enable_color orelse is_stdout_tty;
                enable_ansi_colors_stderr = enable_color orelse is_stderr_tty;
                enable_ansi_colors = enable_ansi_colors_stdout or enable_ansi_colors_stderr;
            }

            stdout_stream = new_source.stream;
            stderr_stream = new_source.error_stream;
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
    return enable_ansi_colors;
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

pub fn enableBuffering() void {
    if (comptime Environment.isNative) enable_buffering = true;
}

pub fn disableBuffering() void {
    flush();
    if (comptime Environment.isNative) enable_buffering = false;
}

pub fn panic(comptime fmt: string, args: anytype) noreturn {
    @branchHint(.cold);

    if (isEmojiEnabled()) {
        std.debug.panic(comptime prettyFmt(fmt, true), args);
    } else {
        std.debug.panic(comptime prettyFmt(fmt, false), args);
    }
}

pub const WriterType: type = @TypeOf(Source.StreamType.quietWriter(undefined));

// TODO: investigate migrating this to the buffered one.
pub fn errorWriter() WriterType {
    bun.debugAssert(source_set);
    return source.error_stream.quietWriter();
}

pub fn errorWriterBuffered() Source.BufferedStream.Writer {
    bun.debugAssert(source_set);
    return source.buffered_error_stream.writer();
}

// TODO: investigate returning the buffered_error_stream
pub fn errorStream() Source.StreamType {
    bun.debugAssert(source_set);
    return source.error_stream;
}

pub fn writer() WriterType {
    bun.debugAssert(source_set);
    return source.stream.quietWriter();
}

pub fn resetTerminal() void {
    if (!enable_ansi_colors) {
        return;
    }

    if (enable_ansi_colors_stderr) {
        _ = source.error_stream.write("\x1B[2J\x1B[3J\x1B[H").unwrap() catch 0;
    } else {
        _ = source.stream.write("\x1B[2J\x1B[3J\x1B[H").unwrap() catch 0;
    }
}

pub fn resetTerminalAll() void {
    if (enable_ansi_colors_stderr)
        _ = source.error_stream.write("\x1B[2J\x1B[3J\x1B[H").unwrap() catch 0;
    if (enable_ansi_colors_stdout)
        _ = source.stream.write("\x1B[2J\x1B[3J\x1B[H").unwrap() catch 0;
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
    printElapsedToWithCtx(elapsed, prettyError, false, {});
}

pub fn printElapsedStdout(elapsed: f64) void {
    printElapsedToWithCtx(elapsed, pretty, false, {});
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
pub fn debug(comptime fmt: string, args: anytype) void {
    if (!Environment.isDebug) return;
    prettyErrorln("<d>DEBUG:<r> " ++ fmt, args);
    flush();
}

pub inline fn _debug(comptime fmt: string, args: anytype) void {
    bun.debugAssert(source_set);
    println(fmt, args);
}

// callconv is a workaround for a zig wasm bug?
pub noinline fn print(comptime fmt: string, args: anytype) callconv(std.builtin.CallingConvention.Unspecified) void {
    if (comptime Environment.isWasm) {
        source.stream.pos = 0;
        std.fmt.format(source.stream.writer(), fmt, args) catch unreachable;
        root.console_log(root.Uint8Array.fromSlice(source.stream.buffer[0..source.stream.pos]));
    } else {
        bun.debugAssert(source_set);

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
pub const LogFunction = fn (comptime fmt: string, args: anytype) callconv(bun.callconv_inline) void;

pub fn Scoped(comptime tag: anytype, comptime disabled: bool) type {
    const tagname = comptime if (!Environment.enable_logs) .{} else brk: {
        const input = switch (@TypeOf(tag)) {
            @Type(.enum_literal) => @tagName(tag),
            else => tag,
        };
        var ascii_slice: [input.len]u8 = undefined;
        for (input, &ascii_slice) |in, *out| {
            out.* = std.ascii.toLower(in);
        }
        break :brk ascii_slice;
    };

    return ScopedLogger(&tagname, disabled);
}

fn ScopedLogger(comptime tagname: []const u8, comptime disabled: bool) type {
    if (comptime !Environment.enable_logs) {
        return struct {
            pub inline fn isVisible() bool {
                return false;
            }
            pub fn log(comptime _: string, _: anytype) callconv(bun.callconv_inline) void {}
        };
    }

    return struct {
        const BufferedWriter = std.io.BufferedWriter(4096, bun.sys.File.QuietWriter);

        var buffered_writer: BufferedWriter = undefined;
        var out: BufferedWriter.Writer = undefined;
        var out_set = false;
        var really_disable = std.atomic.Value(bool).init(disabled);

        var lock = bun.Mutex{};

        var is_visible_once = std.once(evaluateIsVisible);

        fn evaluateIsVisible() void {
            if (bun.getenvZAnyCase("BUN_DEBUG_" ++ tagname)) |val| {
                really_disable.store(strings.eqlComptime(val, "0"), .monotonic);
            } else if (bun.getenvZAnyCase("BUN_DEBUG_ALL")) |val| {
                really_disable.store(strings.eqlComptime(val, "0"), .monotonic);
            } else if (bun.getenvZAnyCase("BUN_DEBUG_QUIET_LOGS")) |val| {
                really_disable.store(really_disable.load(.monotonic) or !strings.eqlComptime(val, "0"), .monotonic);
            } else {
                for (bun.argv) |arg| {
                    if (strings.eqlCaseInsensitiveASCII(arg, comptime "--debug-" ++ tagname, true)) {
                        really_disable.store(false, .monotonic);
                        break;
                    } else if (strings.eqlCaseInsensitiveASCII(arg, comptime "--debug-all", true)) {
                        really_disable.store(false, .monotonic);
                        break;
                    }
                }
            }
        }

        pub fn isVisible() bool {
            is_visible_once.call();
            return !really_disable.load(.monotonic);
        }

        /// Debug-only logs which should not appear in release mode
        /// To enable a specific log at runtime, set the environment variable
        ///   BUN_DEBUG_${TAG} to 1
        /// For example, to enable the "foo" log, set the environment variable
        ///   BUN_DEBUG_foo=1
        /// To enable all logs, set the environment variable
        ///   BUN_DEBUG_ALL=1
        pub fn log(comptime fmt: string, args: anytype) void {
            if (!source_set) return;
            if (fmt.len == 0 or fmt[fmt.len - 1] != '\n') {
                return log(fmt ++ "\n", args);
            }

            if (ScopedDebugWriter.disable_inside_log > 0) {
                return;
            }

            if (bun.crash_handler.isPanicking()) return;

            if (Environment.enable_logs) ScopedDebugWriter.disable_inside_log += 1;
            defer {
                if (Environment.enable_logs)
                    ScopedDebugWriter.disable_inside_log -= 1;
            }

            if (!isVisible())
                return;

            if (!out_set) {
                buffered_writer = .{
                    .unbuffered_writer = scopedWriter(),
                };
                out = buffered_writer.writer();
                out_set = true;
            }
            lock.lock();
            defer lock.unlock();

            if (enable_ansi_colors_stdout and source_set and buffered_writer.unbuffered_writer.context.handle == writer().context.handle) {
                out.print(comptime prettyFmt("<r><d>[" ++ tagname ++ "]<r> " ++ fmt, true), args) catch {
                    really_disable.store(true, .monotonic);
                    return;
                };
                buffered_writer.flush() catch {
                    really_disable.store(true, .monotonic);
                    return;
                };
            } else {
                out.print(comptime prettyFmt("<r><d>[" ++ tagname ++ "]<r> " ++ fmt, false), args) catch {
                    really_disable.store(true, .monotonic);
                    return;
                };
                buffered_writer.flush() catch {
                    really_disable.store(true, .monotonic);
                    return;
                };
            }
        }
    };
}

pub fn scoped(comptime tag: anytype, comptime disabled: bool) LogFunction {
    return Scoped(
        tag,
        disabled,
    ).log;
}

pub fn up(n: usize) void {
    print("\x1B[{d}A", .{n});
}
pub fn clearToEnd() void {
    print("\x1B[0J", .{});
}

// Valid "colors":
// <black>
// <blue>
// <cyan>
// <green>
// <bggreen>
// <magenta>
// <red>
// <bgred>
// <white>
// <yellow>
// <b> - bold
// <d> - dim
// </r> - reset
// <r> - reset
const CSI = "\x1b[";
pub const color_map = ComptimeStringMap(string, .{
    &.{ "b", CSI ++ "1m" },
    &.{ "d", CSI ++ "2m" },
    &.{ "i", CSI ++ "3m" },
    &.{ "u", CSI ++ "4m" },
    &.{ "black", CSI ++ "30m" },
    &.{ "red", CSI ++ "31m" },
    &.{ "green", CSI ++ "32m" },
    &.{ "yellow", CSI ++ "33m" },
    &.{ "blue", CSI ++ "34m" },
    &.{ "magenta", CSI ++ "35m" },
    &.{ "cyan", CSI ++ "36m" },
    &.{ "white", CSI ++ "37m" },
    &.{ "bgred", CSI ++ "41m" },
    &.{ "bggreen", CSI ++ "42m" },
});
const RESET: string = "\x1b[0m";
pub fn prettyFmt(comptime fmt: string, comptime is_enabled: bool) [:0]const u8 {
    if (comptime bun.fast_debug_build_mode)
        return fmt ++ "\x00";

    comptime var new_fmt: [fmt.len * 4]u8 = undefined;
    comptime var new_fmt_i: usize = 0;

    @setEvalBranchQuota(9999);
    comptime var i: usize = 0;
    comptime while (i < fmt.len) {
        switch (fmt[i]) {
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

    return comptime (new_fmt[0..new_fmt_i].* ++ .{0})[0..new_fmt_i :0];
}

pub noinline fn prettyWithPrinter(comptime fmt: string, args: anytype, comptime printer: anytype, comptime l: Destination) void {
    if (if (comptime l == .stdout) enable_ansi_colors_stdout else enable_ansi_colors_stderr) {
        printer(comptime prettyFmt(fmt, true), args);
    } else {
        printer(comptime prettyFmt(fmt, false), args);
    }
}

pub noinline fn prettyWithPrinterFn(comptime fmt: string, args: anytype, comptime printFn: anytype, ctx: anytype) void {
    if (comptime bun.fast_debug_build_mode)
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

/// Pretty-print a command that will be run.
/// $ bun run foo
fn printCommand(argv: anytype, comptime destination: Destination) void {
    const prettyFn = if (destination == .stdout) pretty else prettyError;
    const printFn = if (destination == .stdout) print else printError;
    switch (@TypeOf(argv)) {
        [][:0]const u8, []const []const u8, []const []u8, [][]const u8 => {
            prettyFn("<r><d><magenta>$<r> <d><b>", .{});
            printFn("{s}", .{argv[0]});
            if (argv.len > 1) {
                for (argv[1..]) |arg| {
                    printFn(" {s}", .{arg});
                }
            }
            prettyFn("<r>\n", .{});
        },
        []const u8, []u8, [:0]const u8, [:0]u8 => {
            prettyFn("<r><d><magenta>$<r> <d><b>{s}<r>\n", .{argv});
        },
        else => {
            @compileLog(argv);
            @compileError("command() was given unsupported type: " ++ @typeName(@TypeOf(argv)));
        },
    }
    flush();
}

pub fn commandOut(argv: anytype) void {
    printCommand(argv, .stdout);
}

pub fn command(argv: anytype) void {
    printCommand(argv, .stderr);
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
    timer: bun.DebugOnly(std.time.Timer) = undefined,

    pub inline fn start() DebugTimer {
        if (comptime Environment.isDebug) {
            return DebugTimer{
                .timer = std.time.Timer.start() catch unreachable,
            };
        } else {
            return .{};
        }
    }

    pub const WriteError = error{};

    pub fn format(self: DebugTimer, comptime _: []const u8, _: std.fmt.FormatOptions, w: anytype) WriteError!void {
        if (comptime Environment.isDebug) {
            var timer = self.timer;
            w.print("{d:.3}ms", .{@as(f64, @floatFromInt(timer.read())) / std.time.ns_per_ms}) catch unreachable;
        }
    }
};

/// Print a blue note message to stderr
pub inline fn note(comptime fmt: []const u8, args: anytype) void {
    prettyErrorln("<blue>note<r><d>:<r> " ++ fmt, args);
}

/// Print a yellow warning message to stderr
pub inline fn warn(comptime fmt: []const u8, args: anytype) void {
    prettyErrorln("<yellow>warn<r><d>:<r> " ++ fmt, args);
}

/// Print a yellow warning message, only in debug mode
pub inline fn debugWarn(comptime fmt: []const u8, args: anytype) void {
    if (bun.Environment.isDebug) {
        prettyErrorln("<yellow>debug warn<r><d>:<r> " ++ fmt, args);
        flush();
    }
}

/// Print a red error message. The first argument takes an `error_name` value, which can be either
/// be a Zig error, or a string or enum. The error name is converted to a string and displayed
/// in place of "error:", making it useful to print things like "EACCES: Couldn't open package.json"
pub inline fn err(error_name: anytype, comptime fmt: []const u8, args: anytype) void {
    const T = @TypeOf(error_name);
    const info = @typeInfo(T);

    if (comptime T == bun.sys.Error or info == .pointer and info.pointer.child == bun.sys.Error) {
        const e: bun.sys.Error = error_name;
        const tag_name, const sys_errno = e.getErrorCodeTagName() orelse {
            err("unknown error", fmt, args);
            return;
        };
        if (bun.sys.coreutils_error_map.get(sys_errno)) |label| {
            prettyErrorln("<r><red>{s}<r><d>:<r> {s}: " ++ fmt ++ " <d>({s})<r>", .{ tag_name, label } ++ args ++ .{@tagName(e.syscall)});
        } else {
            prettyErrorln("<r><red>{s}<r><d>:<r> " ++ fmt ++ " <d>({s})<r>", .{tag_name} ++ args ++ .{@tagName(e.syscall)});
        }
        return;
    }

    const display_name, const is_comptime_name = display_name: {
        // Zig string literals are of type *const [n:0]u8
        // we assume that no one will pass this type from not using a string literal.
        if (info == .pointer and info.pointer.size == .one and info.pointer.is_const) {
            const child_info = @typeInfo(info.pointer.child);
            if (child_info == .array and child_info.array.child == u8) {
                if (child_info.array.len == 0) @compileError("Output.err should not be passed an empty string (use errGeneric)");
                break :display_name .{ error_name, true };
            }
        }

        // other zig strings we shall treat as dynamic
        if (comptime bun.trait.isZigString(T)) {
            break :display_name .{ error_name, false };
        }

        // error unions
        if (info == .error_set) {
            if (info.error_set) |errors| {
                if (errors.len == 0) {
                    @compileError("Output.err was given an empty error set");
                }

                // TODO: convert zig errors to errno for better searchability?
                if (errors.len == 1) break :display_name .{ errors[0].name, true };
            }

            break :display_name .{ @errorName(error_name), false };
        }

        // enum literals
        if (info == .enum_literal) {
            const tag = @tagName(info);
            comptime bun.assert(tag.len > 0); // how?
            if (tag[0] != 'E') break :display_name .{ "E" ++ tag, true };
            break :display_name .{ tag, true };
        }

        // enums
        if (info == .@"enum") {
            const errno: bun.sys.SystemErrno = @enumFromInt(@intFromEnum(info));
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

pub const ScopedDebugWriter = struct {
    pub var scoped_file_writer: File.QuietWriter = undefined;
    pub threadlocal var disable_inside_log: isize = 0;
};
pub fn disableScopedDebugWriter() void {
    if (!@inComptime()) {
        ScopedDebugWriter.disable_inside_log += 1;
    }
}
pub fn enableScopedDebugWriter() void {
    if (!@inComptime()) {
        ScopedDebugWriter.disable_inside_log -= 1;
    }
}

extern "c" fn getpid() c_int;

pub fn initScopedDebugWriterAtStartup() void {
    bun.debugAssert(source_set);

    if (bun.getenvZ("BUN_DEBUG")) |path| {
        if (path.len > 0 and !strings.eql(path, "0") and !strings.eql(path, "false")) {
            if (std.fs.path.dirname(path)) |dir| {
                std.fs.cwd().makePath(dir) catch {};
            }

            // do not use libuv through this code path, since it might not be initialized yet.
            const pid = std.fmt.allocPrint(bun.default_allocator, "{d}", .{getpid()}) catch @panic("failed to allocate path");
            defer bun.default_allocator.free(pid);

            const path_fmt = std.mem.replaceOwned(u8, bun.default_allocator, path, "{pid}", pid) catch @panic("failed to allocate path");
            defer bun.default_allocator.free(path_fmt);

            const fd: bun.FD = .fromStdFile(std.fs.cwd().createFile(path_fmt, .{
                .mode = if (Environment.isPosix) 0o644 else 0,
            }) catch |open_err| {
                panic("Failed to open file for debug output: {s} ({s})", .{ @errorName(open_err), path });
            });
            _ = fd.truncate(0); // windows
            ScopedDebugWriter.scoped_file_writer = fd.quietWriter();
            return;
        }
    }

    ScopedDebugWriter.scoped_file_writer = source.stream.quietWriter();
}
fn scopedWriter() File.QuietWriter {
    if (comptime !Environment.isDebug and !Environment.enable_logs) {
        @compileError("scopedWriter() should only be called in debug mode");
    }

    return ScopedDebugWriter.scoped_file_writer;
}

/// Print a red error message with "error: " as the prefix. For custom prefixes see `err()`
pub inline fn errGeneric(comptime fmt: []const u8, args: anytype) void {
    prettyErrorln("<r><red>error<r><d>:<r> " ++ fmt, args);
}

/// Print a red error message with "error: " as the prefix and a formatted message.
pub inline fn errFmt(formatter: anytype) void {
    return errGeneric("{}", .{formatter});
}

pub var buffered_stdin = std.io.BufferedReader(4096, File.Reader){
    .unbuffered_reader = .{ .context = .{ .handle = if (Environment.isWindows) undefined else .stdin() } },
};
