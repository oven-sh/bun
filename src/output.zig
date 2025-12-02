// These are threadlocal so we don't have stdout/stderr writing on top of each other
threadlocal var source: Source = undefined;
threadlocal var source_set: bool = false;

// These are not threadlocal so we avoid opening stdout/stderr for every thread
var stderr_stream: Source.StreamType = undefined;
var stdout_stream: Source.StreamType = undefined;
var stdout_stream_set = false;

// Track which stdio descriptors are TTYs (0=stdin, 1=stdout, 2=stderr)
pub export var bun_stdio_tty: [3]i32 = .{ 0, 0, 0 };

pub var terminal_size: std.posix.winsize = .{
    .row = 0,
    .col = 0,
    .xpixel = 0,
    .ypixel = 0,
};

pub const Source = struct {
    pub const StreamType: type = brk: {
        if (Environment.isWasm) {
            break :brk std.io.FixedBufferStream([]u8);
        } else {
            break :brk File;
            // var stdout = std.fs.File.stdout();
            // return @TypeOf(bun.deprecated.bufferedWriter(stdout.writer()));
        }
    };

    stdout_buffer: [4096]u8,
    stderr_buffer: [4096]u8,
    buffered_stream_backing: @TypeOf(StreamType.quietWriter(undefined)).Adapter,
    buffered_error_stream_backing: @TypeOf(StreamType.quietWriter(undefined)).Adapter,
    buffered_stream: *std.Io.Writer,
    buffered_error_stream: *std.Io.Writer,

    stream_backing: @TypeOf(StreamType.quietWriter(undefined)).Adapter,
    error_stream_backing: @TypeOf(StreamType.quietWriter(undefined)).Adapter,
    stream: *std.Io.Writer,
    error_stream: *std.Io.Writer,

    raw_stream: StreamType,
    raw_error_stream: StreamType,
    out_buffer: []u8 = &([_]u8{}),
    err_buffer: []u8 = &([_]u8{}),

    pub fn init(
        out: *Source,
        stream: StreamType,
        err_stream: StreamType,
    ) void {
        if ((comptime Environment.isDebug and use_mimalloc) and !source_set) {
            bun.mimalloc.mi_option_set(.show_errors, 1);
        }
        source_set = true;

        out.* = .{
            .raw_stream = stream,
            .raw_error_stream = err_stream,

            .stdout_buffer = undefined,
            .stderr_buffer = undefined,
            .buffered_stream = undefined,
            .buffered_stream_backing = undefined,
            .buffered_error_stream_backing = undefined,
            .buffered_error_stream = undefined,

            .stream_backing = undefined,
            .error_stream_backing = undefined,
            .stream = undefined,
            .error_stream = undefined,
        };

        out.buffered_stream_backing = out.raw_stream.quietWriter().adaptToNewApi(&out.stdout_buffer);
        out.buffered_error_stream_backing = out.raw_error_stream.quietWriter().adaptToNewApi(&out.stderr_buffer);
        out.buffered_stream = &out.buffered_stream_backing.new_interface;
        out.buffered_error_stream = &out.buffered_error_stream_backing.new_interface;

        out.stream_backing = out.raw_stream.quietWriter().adaptToNewApi(&.{});
        out.error_stream_backing = out.raw_error_stream.quietWriter().adaptToNewApi(&.{});
        out.stream = &out.stream_backing.new_interface;
        out.error_stream = &out.error_stream_backing.new_interface;
    }

    pub fn configureThread() void {
        if (source_set) return;
        bun.debugAssert(stdout_stream_set);
        source.init(stdout_stream, stderr_stream);
        bun.StackCheck.configureThread();
    }

    pub fn configureNamedThread(name: [:0]const u8) void {
        Global.setThreadName(name);
        configureThread();
    }

    pub fn isNoColor() bool {
        return bun.env_var.NO_COLOR.get();
    }

    pub fn getForceColorDepth() ?ColorDepth {
        const force_color = bun.env_var.FORCE_COLOR.get() orelse return null;
        // Supported by Node.js, if set will ignore NO_COLOR.
        // - "0" to indicate no color support
        // - "1", "true", or "" to indicate 16-color support
        // - "2" to indicate 256-color support
        // - "3" to indicate 16 million-color support
        return switch (force_color) {
            0 => .none,
            1 => .@"16",
            2 => .@"256",
            else => .@"16m",
        };
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

    const WindowsStdio = struct {
        const w = bun.windows;

        /// At program start, we snapshot the console modes of standard in, out, and err
        /// so that we can restore them at program exit if they change. Restoration is
        /// best-effort, and may not be applied if the process is killed abruptly.
        pub var console_mode = [3]?u32{ null, null, null };
        pub var console_codepage = @as(u32, 0);
        pub var console_output_codepage = @as(u32, 0);

        pub export fn Bun__restoreWindowsStdio() callconv(.c) void {
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

            const fd_internals = @import("./fd.zig");
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

            console_codepage = c.GetConsoleCP();
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

            const stdout = bun.sys.File.from(std.fs.File.stdout());
            const stderr = bun.sys.File.from(std.fs.File.stderr());

            Source.setInit(stdout, stderr);

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

        const term = bun.env_var.TERM.get() orelse "";
        if (strings.eqlComptime(term, "dumb")) {
            return;
        }

        if (bun.env_var.TMUX.get() != null) {
            lazy_color_depth = .@"256";
            return;
        }

        if (bun.env_var.CI.get() != null) {
            lazy_color_depth = .@"16";
            return;
        }

        if (bun.env_var.TERM_PROGRAM.get()) |term_program| {
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

        if (bun.env_var.COLORTERM.get()) |color_term| {
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

    pub fn setInit(stdout: StreamType, stderr: StreamType) void {
        source.init(stdout, stderr);

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
            }

            stdout_stream = stdout;
            stderr_stream = stderr;
        }
    }
};

pub const OutputStreamDescriptor = enum {
    unknown,
    // file,
    // pipe,
    terminal,
};

pub const enable_ansi_colors = @compileError("Deprecated to prevent accidentally using the wrong one. Use enable_ansi_colors_stdout or enable_ansi_colors_stderr instead.");
pub var enable_ansi_colors_stderr = Environment.isNative;
pub var enable_ansi_colors_stdout = Environment.isNative;
pub var enable_buffering = Environment.isNative;
pub var is_verbose = false;
pub var is_github_action = false;

pub var stderr_descriptor_type = OutputStreamDescriptor.unknown;
pub var stdout_descriptor_type = OutputStreamDescriptor.unknown;

pub inline fn isStdoutTTY() bool {
    return bun_stdio_tty[1] != 0;
}

pub inline fn isStderrTTY() bool {
    return bun_stdio_tty[2] != 0;
}

pub inline fn isStdinTTY() bool {
    return bun_stdio_tty[0] != 0;
}

pub fn isGithubAction() bool {
    if (bun.env_var.GITHUB_ACTIONS.get()) {
        // Do not print github annotations for AI agents because that wastes the context window.
        return !isAIAgent();
    }
    return false;
}

pub fn isAIAgent() bool {
    const get_is_agent = struct {
        var value = false;
        fn evaluate() bool {
            if (bun.env_var.AGENT.get()) |env| {
                return strings.eqlComptime(env, "1");
            }

            if (isVerbose()) {
                return false;
            }

            // Claude Code.
            if (bun.env_var.CLAUDECODE.get()) {
                return true;
            }

            // Replit.
            if (bun.env_var.REPL_ID.get()) {
                return true;
            }

            // TODO: add environment variable for Gemini
            // Gemini does not appear to add any environment variables to identify it.

            // TODO: add environment variable for Codex
            // codex does not appear to add any environment variables to identify it.

            // TODO: add environment variable for Cursor Background Agents
            // cursor does not appear to add any environment variables to identify it.

            return false;
        }

        fn setValue() void {
            value = evaluate();
        }

        var once = std.once(setValue);

        pub fn isEnabled() bool {
            once.call();
            return value;
        }
    };

    return get_is_agent.isEnabled();
}

pub fn isVerbose() bool {
    // Set by Github Actions when a workflow is run using debug mode.
    return bun.env_var.RUNNER_DEBUG.get();
}

pub fn enableBuffering() void {
    if (comptime Environment.isNative) enable_buffering = true;
}

const EnableBufferingScope = struct {
    prev_buffering: bool,
    pub fn init() EnableBufferingScope {
        const prev_buffering = enable_buffering;
        enable_buffering = true;
        return .{ .prev_buffering = prev_buffering };
    }

    /// Does not call Output.flush().
    pub fn deinit(self: EnableBufferingScope) void {
        enable_buffering = self.prev_buffering;
    }
};

pub fn enableBufferingScope() EnableBufferingScope {
    return EnableBufferingScope.init();
}

pub fn disableBuffering() void {
    flush();
    if (comptime Environment.isNative) enable_buffering = false;
}

pub fn panic(comptime fmt: string, args: anytype) noreturn {
    @branchHint(.cold);

    if (enable_ansi_colors_stderr) {
        std.debug.panic(comptime prettyFmt(fmt, true), args);
    } else {
        std.debug.panic(comptime prettyFmt(fmt, false), args);
    }
}

pub const WriterType: type = @TypeOf(Source.StreamType.quietWriter(undefined));

pub fn rawErrorWriter() Source.StreamType {
    bun.debugAssert(source_set);
    return source.raw_error_stream;
}

// TODO: investigate migrating this to the buffered one.
pub fn errorWriter() *std.Io.Writer {
    bun.debugAssert(source_set);
    return source.error_stream;
}

pub fn errorWriterBuffered() *std.Io.Writer {
    bun.debugAssert(source_set);
    return source.buffered_error_stream;
}

// TODO: investigate returning the buffered_error_stream
pub fn errorStream() *std.Io.Writer {
    bun.debugAssert(source_set);
    return source.error_stream;
}

pub fn rawWriter() Source.StreamType {
    bun.debugAssert(source_set);
    return source.raw_stream;
}

pub fn writer() *std.Io.Writer {
    bun.debugAssert(source_set);
    return source.stream;
}

pub fn writerBuffered() *std.Io.Writer {
    bun.debugAssert(source_set);
    return source.buffered_stream;
}

pub fn resetTerminal() void {
    if (!enable_ansi_colors_stderr and !enable_ansi_colors_stdout) {
        return;
    }

    if (enable_ansi_colors_stderr) {
        source.error_stream.writeAll("\x1B[2J\x1B[3J\x1B[H") catch {};
    } else {
        source.stream.writeAll("\x1B[2J\x1B[3J\x1B[H") catch {};
    }
}

pub fn resetTerminalAll() void {
    if (enable_ansi_colors_stderr)
        source.error_stream.writeAll("\x1B[2J\x1B[3J\x1B[H") catch {};
    if (enable_ansi_colors_stdout)
        source.stream.writeAll("\x1B[2J\x1B[3J\x1B[H") catch {};
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

    pub fn format(self: ElapsedFormatter, writer_: *std.Io.Writer) !void {
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
        source.stream.writer().print(fmt, args) catch unreachable;
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
pub noinline fn print(comptime fmt: string, args: anytype) callconv(std.builtin.CallingConvention.auto) void {
    if (comptime Environment.isWasm) {
        source.stream.pos = 0;
        source.stream.writer().print(fmt, args) catch unreachable;
        root.console_log(root.Uint8Array.fromSlice(source.stream.buffer[0..source.stream.pos]));
    } else {
        bun.debugAssert(source_set);

        // There's not much we can do if this errors. Especially if it's something like BrokenPipe.
        if (enable_buffering) {
            source.buffered_stream.print(fmt, args) catch {};
        } else {
            writer().print(fmt, args) catch {};
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

pub const Visibility = enum {
    /// Hide logs for this scope by default.
    hidden,
    /// Show logs for this scope by default.
    visible,

    /// Show logs for this scope by default if and only if `condition` is true.
    pub fn visibleIf(condition: bool) Visibility {
        return if (condition) .visible else .hidden;
    }
};

pub fn Scoped(comptime tag: anytype, comptime visibility: Visibility) type {
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

    return ScopedLogger(&tagname, visibility);
}

fn ScopedLogger(comptime tagname: []const u8, comptime visibility: Visibility) type {
    if (comptime !Environment.enable_logs) {
        return struct {
            pub inline fn isVisible() bool {
                return false;
            }
            pub fn log(comptime _: string, _: anytype) callconv(bun.callconv_inline) void {}
        };
    }

    return struct {
        var buffer: [4096]u8 = undefined;
        var buffered_writer: File.QuietWriter.Adapter = undefined;
        var out: *std.Io.Writer = undefined;
        var out_set = false;
        var really_disable = std.atomic.Value(bool).init(visibility == .hidden);

        var lock = bun.Mutex{};

        var is_visible_once = std.once(evaluateIsVisible);

        fn evaluateIsVisible() void {
            if (bun.getenvZAnyCase("BUN_DEBUG_" ++ tagname)) |val| {
                really_disable.store(strings.eqlComptime(val, "0"), .monotonic);
            } else if (bun.env_var.BUN_DEBUG_ALL.get()) |val| {
                really_disable.store(!val, .monotonic);
            } else if (bun.env_var.BUN_DEBUG_QUIET_LOGS.get()) |val| {
                really_disable.store(really_disable.load(.monotonic) or val, .monotonic);
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
                buffered_writer = scopedWriter().adaptToNewApi(&buffer);
                out = &buffered_writer.new_interface;
                out_set = true;
            }
            lock.lock();
            defer lock.unlock();

            switch (enable_ansi_colors_stdout and source_set and scopedWriter().context.handle == rawWriter().handle) {
                inline else => |use_ansi| {
                    out.print(comptime prettyFmt("<r><d>[" ++ tagname ++ "]<r> " ++ fmt, use_ansi), args) catch {
                        really_disable.store(true, .monotonic);
                        return;
                    };
                    out.flush() catch {
                        really_disable.store(true, .monotonic);
                        return;
                    };
                },
            }
        }
    };
}

pub fn scoped(comptime tag: anytype, comptime visibility: Visibility) LogFunction {
    return Scoped(tag, visibility).log;
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
            source.buffered_error_stream.print(fmt, args) catch {}
        else
            source.error_stream.print(fmt, args) catch {};
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

    pub fn format(self: DebugTimer, w: *std.Io.Writer) std.Io.Writer.Error!void {
        if (comptime Environment.isDebug) {
            var timer = self.timer;
            try w.print("{d:.3}ms", .{@as(f64, @floatFromInt(timer.read())) / std.time.ns_per_ms});
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

    if (bun.env_var.BUN_DEBUG.get()) |path| {
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

    ScopedDebugWriter.scoped_file_writer = source.raw_stream.quietWriter();
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
    return errGeneric("{f}", .{formatter});
}

pub var buffered_stdin = bun.deprecated.BufferedReader(4096, File.Reader){
    .unbuffered_reader = .{ .context = .{ .handle = if (Environment.isWindows) undefined else .stdin() } },
    .buf = undefined,
};

const string = []const u8;

/// https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036
pub const synchronized_start = "\x1b[?2026h";

/// https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036
pub const synchronized_end = "\x1b[?2026l";

/// https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036
pub fn synchronized() Synchronized {
    return Synchronized.begin();
}
pub const Synchronized = struct {
    pub fn begin() Synchronized {
        if (Environment.isPosix) {
            print(synchronized_start, .{});
        }
        return .{};
    }

    pub fn end(_: @This()) void {
        if (Environment.isPosix) {
            print(synchronized_end, .{});
        }
    }
};

const Environment = @import("./env.zig");
const root = @import("root");
const std = @import("std");
const SystemTimer = @import("./system_timer.zig").Timer;

const bun = @import("bun");
const ComptimeStringMap = bun.ComptimeStringMap;
const Global = bun.Global;
const c = bun.c;
const strings = bun.strings;
const use_mimalloc = bun.use_mimalloc;
const File = bun.sys.File;
