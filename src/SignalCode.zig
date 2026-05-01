pub const SignalCode = enum(u8) {
    SIGHUP = 1,
    SIGINT = 2,
    SIGQUIT = 3,
    SIGILL = 4,
    SIGTRAP = 5,
    SIGABRT = 6,
    SIGBUS = 7,
    SIGFPE = 8,
    SIGKILL = 9,
    SIGUSR1 = 10,
    SIGSEGV = 11,
    SIGUSR2 = 12,
    SIGPIPE = 13,
    SIGALRM = 14,
    SIGTERM = 15,
    SIG16 = 16,
    SIGCHLD = 17,
    SIGCONT = 18,
    SIGSTOP = 19,
    SIGTSTP = 20,
    SIGTTIN = 21,
    SIGTTOU = 22,
    SIGURG = 23,
    SIGXCPU = 24,
    SIGXFSZ = 25,
    SIGVTALRM = 26,
    SIGPROF = 27,
    SIGWINCH = 28,
    SIGIO = 29,
    SIGPWR = 30,
    SIGSYS = 31,
    _,

    // The `subprocess.kill()` method sends a signal to the child process. If no
    // argument is given, the process will be sent the 'SIGTERM' signal.
    pub const default = SignalCode.SIGTERM;
    pub const Map = ComptimeEnumMap(SignalCode);
    pub fn name(value: SignalCode) ?[]const u8 {
        if (@intFromEnum(value) <= @intFromEnum(SignalCode.SIGSYS)) {
            return asByteSlice(@tagName(value));
        }

        return null;
    }

    pub fn valid(value: SignalCode) bool {
        return @intFromEnum(value) <= @intFromEnum(SignalCode.SIGSYS) and @intFromEnum(value) >= @intFromEnum(SignalCode.SIGHUP);
    }

    /// Shell scripts use exit codes 128 + signal number
    /// https://tldp.org/LDP/abs/html/exitcodes.html
    pub fn toExitCode(value: SignalCode) ?u8 {
        return switch (@intFromEnum(value)) {
            1...31 => 128 +% @intFromEnum(value),
            else => null,
        };
    }

    pub fn description(signal: SignalCode) ?[]const u8 {
        // Description names copied from fish
        // https://github.com/fish-shell/fish-shell/blob/00ffc397b493f67e28f18640d3de808af29b1434/fish-rust/src/signal.rs#L420
        return switch (signal) {
            .SIGHUP => "Terminal hung up",
            .SIGINT => "Quit request",
            .SIGQUIT => "Quit request",
            .SIGILL => "Illegal instruction",
            .SIGTRAP => "Trace or breakpoint trap",
            .SIGABRT => "Abort",
            .SIGBUS => "Misaligned address error",
            .SIGFPE => "Floating point exception",
            .SIGKILL => "Forced quit",
            .SIGUSR1 => "User defined signal 1",
            .SIGUSR2 => "User defined signal 2",
            .SIGSEGV => "Address boundary error",
            .SIGPIPE => "Broken pipe",
            .SIGALRM => "Timer expired",
            .SIGTERM => "Polite quit request",
            .SIGCHLD => "Child process status changed",
            .SIGCONT => "Continue previously stopped process",
            .SIGSTOP => "Forced stop",
            .SIGTSTP => "Stop request from job control (^Z)",
            .SIGTTIN => "Stop from terminal input",
            .SIGTTOU => "Stop from terminal output",
            .SIGURG => "Urgent socket condition",
            .SIGXCPU => "CPU time limit exceeded",
            .SIGXFSZ => "File size limit exceeded",
            .SIGVTALRM => "Virtual timefr expired",
            .SIGPROF => "Profiling timer expired",
            .SIGWINCH => "Window size change",
            .SIGIO => "I/O on asynchronous file descriptor is possible",
            .SIGSYS => "Bad system call",
            .SIGPWR => "Power failure",
            else => null,
        };
    }

    pub fn from(value: anytype) SignalCode {
        return @enumFromInt(std.mem.asBytes(&value)[0]);
    }

    // This wrapper struct is lame, what if bun's color formatter was more versatile
    const Fmt = struct {
        signal: SignalCode,
        enable_ansi_colors: bool,
        pub fn format(this: Fmt, writer: *std.Io.Writer) !void {
            const signal = this.signal;
            switch (this.enable_ansi_colors) {
                inline else => |enable_ansi_colors| {
                    if (signal.name()) |str| if (signal.description()) |desc| {
                        try writer.print(Output.prettyFmt("{s} <d>({s})<r>", enable_ansi_colors), .{ str, desc });
                        return;
                    };
                    try writer.print("code {d}", .{@intFromEnum(signal)});
                },
            }
        }
    };

    pub fn fmt(signal: SignalCode, enable_ansi_colors: bool) Fmt {
        return .{ .signal = signal, .enable_ansi_colors = enable_ansi_colors };
    }

    pub fn fromJS(arg: jsc.JSValue, globalThis: *jsc.JSGlobalObject) !SignalCode {
        if (arg.getNumber()) |sig64| {
            // Node does this:
            if (std.math.isNan(sig64)) {
                return SignalCode.default;
            }

            // This matches node behavior, minus some details with the error messages: https://gist.github.com/Jarred-Sumner/23ba38682bf9d84dff2f67eb35c42ab6
            if (std.math.isInf(sig64) or @trunc(sig64) != sig64) {
                return globalThis.throwInvalidArguments("Unknown signal", .{});
            }

            if (sig64 < 0) {
                return globalThis.throwInvalidArguments("Invalid signal: must be >= 0", .{});
            }

            if (sig64 > 31) {
                return globalThis.throwInvalidArguments("Invalid signal: must be < 32", .{});
            }

            const code: SignalCode = @enumFromInt(@as(u8, @intFromFloat(sig64)));
            return code;
        } else if (arg.isString()) {
            if (arg.asString().length() == 0) {
                return SignalCode.default;
            }
            const signal_code = try arg.toEnum(globalThis, "signal", SignalCode);
            return signal_code;
        } else if (!arg.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("Invalid signal: must be a string or an integer", .{});
        }

        return SignalCode.default;
    }
};

const std = @import("std");

const bun = @import("bun");
const ComptimeEnumMap = bun.ComptimeEnumMap;
const Output = bun.Output;
const asByteSlice = bun.asByteSlice;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
