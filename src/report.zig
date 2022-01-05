const std = @import("std");
const logger = @import("logger.zig");
const root = @import("root");
const _global = @import("global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const CLI = @import("./cli.zig").Cli;
const Features = @import("./analytics/analytics_thread.zig").Features;
const HTTP = @import("http").AsyncHTTP;
const CrashReporter = @import("crash_reporter");

const Report = @This();

var crash_reporter_path: [1024]u8 = undefined;
pub fn printMetadata() void {
    @setCold(true);
    const cmd_label: string = if (CLI.cmd) |tag| @tagName(tag) else "Unknown";

    const platform = if (Environment.isMac) "macOS" else "Linux";
    const arch = if (Environment.isAarch64)
        if (Environment.isMac) "Silicon" else "arm64"
    else
        "x64";

    Output.prettyError(
        \\
        \\<r>–––– bun meta ––––
    ++ "\nBun v" ++ Global.package_json_version ++ " " ++ platform ++ " " ++ arch ++ "\n" ++
        \\{s}: {}
        \\
    , .{
        cmd_label,
        Features.formatter(),
    });

    const http_count = HTTP.active_requests_count.loadUnchecked();
    if (http_count > 0)
        Output.prettyError(
            \\HTTP: {d}
            \\
        , .{http_count});

    if (comptime _global.use_mimalloc) {
        var elapsed_msecs: usize = 0;
        var user_msecs: usize = 0;
        var system_msecs: usize = 0;
        var current_rss: usize = 0;
        var peak_rss: usize = 0;
        var current_commit: usize = 0;
        var peak_commit: usize = 0;
        var page_faults: usize = 0;
        const mimalloc = @import("allocators/mimalloc.zig");
        mimalloc.mi_process_info(
            &elapsed_msecs,
            &user_msecs,
            &system_msecs,
            &current_rss,
            &peak_rss,
            &current_commit,
            &peak_commit,
            &page_faults,
        );
        Output.prettyError("Elapsed: {d}ms | User: {d}ms | Sys: {d}ms\nRSS: {:<3.2} | Peak: {:<3.2} | Commit: {:<3.2} | Faults: {d}\n", .{
            elapsed_msecs,
            user_msecs,
            system_msecs,
            std.fmt.fmtIntSizeDec(current_rss),
            std.fmt.fmtIntSizeDec(peak_rss),
            std.fmt.fmtIntSizeDec(current_commit),
            page_faults,
        });
    }

    Output.prettyError("–––– bun meta ––––\n", .{});
}
var has_printed_fatal = false;
var has_printed_crash = false;
pub fn fatal(err_: ?anyerror, msg_: ?string) void {
    const had_printed_fatal = has_printed_fatal;
    if (!has_printed_fatal) {
        has_printed_fatal = true;

        if (err_) |err| {
            if (Output.isEmojiEnabled()) {
                Output.prettyError(
                    "\n<r><red>error<r><d>:<r> <b>{s}<r>\n",
                    .{@errorName(err)},
                );
            } else {
                Output.prettyError(
                    "\n<r>error: {s}\n\n",
                    .{@errorName(err)},
                );
            }
        }

        if (msg_) |msg| {
            const msg_ptr = @ptrToInt(msg.ptr);
            if (msg_ptr > 0) {
                const len = @maximum(@minimum(msg.len, 1024), 0);

                if (len > 0) {
                    if (Output.isEmojiEnabled()) {
                        Output.prettyError(
                            "\n<r><red>uh-oh<r><d>:<r> <b>{s}<r>\n",
                            .{msg[0..len]},
                        );
                    } else {
                        Output.prettyError(
                            "\n<r>an uh-oh: {s}\n\n",
                            .{msg[0..len]},
                        );
                    }
                }
            }
        }

        if (err_ == null) {
            if (Output.isEmojiEnabled()) {
                if (msg_ == null and err_ == null) {
                    Output.prettyError("<r><red>", .{});
                } else {
                    Output.prettyError("<r>", .{});
                }
                Output.prettyErrorln("bun will crash now<r> 😭😭😭\n", .{});
            } else {
                Output.printError("bun has crashed :'(\n", .{});
            }
        }
        Output.flush();

        printMetadata();

        Output.flush();
    }

    // It only is a real crash report if it's not coming from Zig
    if (err_ == null and msg_ == null and !has_printed_crash) {
        var path = CrashReporter.crashReportPath(&crash_reporter_path);

        if (path.len > 0) {
            has_printed_crash = true;

            if (std.os.getenvZ("HOME")) |home| {
                if (strings.hasPrefix(path, home) and home.len > 1) {
                    crash_reporter_path[home.len - 1] = '~';
                    crash_reporter_path[home.len] = '/';
                    path = path[home.len - 1 ..];
                }
            }
            Output.prettyErrorln("Crash report saved to:\n  {s}\n", .{path});
            if (!had_printed_fatal) Output.prettyError("Ask for #help in https://bun.sh/discord or go to https://bun.sh/issues. Please include the crash report. \n\n", .{});
            Output.flush();

            std.os.exit(1);
        }
    }

    if (!had_printed_fatal) {
        Output.prettyError("\nAsk for #help in https://bun.sh/discord or go to https://bun.sh/issues\n\n", .{});
        Output.flush();
    }
}

var globalError_ranOnce = false;

pub noinline fn globalError(err: anyerror) noreturn {
    @setCold(true);

    if (@atomicRmw(bool, &globalError_ranOnce, .Xchg, true, .Monotonic)) {
        std.os.exit(1);
    }

    switch (err) {
        error.CurrentWorkingDirectoryUnlinked => {
            Output.prettyError(
                "\n<r><red>error: <r>The current working directory was deleted, so that command didn't work. Please cd into a different directory and try again.",
                .{},
            );
            Output.flush();
            std.os.exit(1);
        },
        error.SystemFdQuotaExceeded => {
            const limit = std.os.getrlimit(.NOFILE) catch std.mem.zeroes(std.os.rlimit);
            if (comptime Environment.isMac) {
                Output.prettyError(
                    \\
                    \\<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>
                    \\
                    \\<d>Current limit: {d}<r>
                    \\
                    \\To fix this, try running:
                    \\ 
                    \\  <cyan>sudo launchctl limit maxfiles 2147483646<r>
                    \\  <cyan>ulimit -n 2147483646<r>
                    \\
                    \\That will only work until you reboot.
                    \\
                ,
                    .{
                        limit.cur,
                    },
                );
            } else {
                Output.prettyError(
                    \\
                    \\<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>
                    \\
                    \\<d>Current limit: {d}<r>
                    \\
                    \\To fix this, try running:
                    \\ 
                    \\  <cyan>sudo echo -e "\nfs.file-max=2147483646\n" >> /etc/sysctl.conf<r>
                    \\  <cyan>sudo sysctl -p<r>
                    \\  <cyan>ulimit -n 2147483646<r>
                    \\
                ,
                    .{
                        limit.cur,
                    },
                );

                if (std.os.getenv("USER")) |user| {
                    if (user.len > 0) {
                        Output.prettyError(
                            \\
                            \\If that still doesn't work, you may need to add these lines to /etc/security/limits.conf:
                            \\
                            \\ <cyan>{s} soft nofile 2147483646<r>
                            \\ <cyan>{s} hard nofile 2147483646<r>
                            \\
                        ,
                            .{ user, user },
                        );
                    }
                }
            }

            Output.flush();
            std.os.exit(1);
        },
        error.ProcessFdQuotaExceeded => {
            const limit = std.os.getrlimit(.NOFILE) catch std.mem.zeroes(std.os.rlimit);
            if (comptime Environment.isMac) {
                Output.prettyError(
                    \\
                    \\<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>
                    \\
                    \\<d>Current limit: {d}<r>
                    \\
                    \\To fix this, try running:
                    \\ 
                    \\  <cyan>ulimit -n 2147483646<r>
                    \\
                    \\You may also need to run:
                    \\
                    \\  <cyan>sudo launchctl limit maxfiles 2147483646<r>
                    \\
                ,
                    .{
                        limit.cur,
                    },
                );
            } else {
                Output.prettyError(
                    \\
                    \\<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>
                    \\
                    \\<d>Current limit: {d}<r>
                    \\
                    \\To fix this, try running:
                    \\ 
                    \\  <cyan>ulimit -n 2147483646<r>
                    \\
                    \\That will only work for the current shell. To fix this for the entire system, run:
                    \\
                    \\  <cyan>sudo echo -e "\nfs.file-max=2147483646\n" >> /etc/sysctl.conf<r>
                    \\  <cyan>sudo sysctl -p<r>
                    \\
                ,
                    .{
                        limit.cur,
                    },
                );

                if (std.os.getenv("USER")) |user| {
                    if (user.len > 0) {
                        Output.prettyError(
                            \\
                            \\If that still doesn't work, you may need to add these lines to /etc/security/limits.conf:
                            \\
                            \\ <cyan>{s} soft nofile 2147483646<r>
                            \\ <cyan>{s} hard nofile 2147483646<r>
                            \\
                        ,
                            .{ user, user },
                        );
                    }
                }
            }

            Output.flush();
            std.os.exit(1);
        },
        // The usage of `unreachable` in Zig's std.os may cause the file descriptor problem to show up as other errors
        error.NotOpenForReading, error.Unexpected => {
            const limit = std.os.getrlimit(.NOFILE) catch std.mem.zeroes(std.os.rlimit);

            if (limit.cur > 0 and limit.cur < (8096 * 2)) {
                Output.prettyError(
                    \\
                    \\<r><red>error<r>: An unknown error ocurred, possibly due to low max file descriptors <d>(<red>Unexpected<r><d>)<r>
                    \\
                    \\<d>Current limit: {d}<r>
                    \\
                    \\To fix this, try running:
                    \\ 
                    \\  <cyan>ulimit -n 2147483646<r>
                    \\
                ,
                    .{
                        limit.cur,
                    },
                );

                if (Environment.isLinux) {
                    if (std.os.getenv("USER")) |user| {
                        if (user.len > 0) {
                            Output.prettyError(
                                \\
                                \\If that still doesn't work, you may need to add these lines to /etc/security/limits.conf:
                                \\
                                \\ <cyan>{s} soft nofile 2147483646<r>
                                \\ <cyan>{s} hard nofile 2147483646<r>
                                \\
                            ,
                                .{
                                    user,
                                    user,
                                },
                            );
                        }
                    }
                } else if (Environment.isMac) {
                    Output.prettyError(
                        \\
                        \\If that still doesn't work, you may need to run:
                        \\
                        \\  <cyan>sudo launchctl limit maxfiles 2147483646<r>
                        \\
                    ,
                        .{},
                    );
                }

                Output.flush();
                std.os.exit(1);
            }
        },
        error.FileNotFound => {
            Output.prettyError(
                "\n<r><red>error<r><d>:<r> <b>FileNotFound<r>\nbun could not find a file, and the code that produces this error is missing a better error.\n",
                .{},
            );
            Output.flush();

            Report.printMetadata();

            Output.flush();

            print_stacktrace: {
                var debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                var trace = @errorReturnTrace() orelse break :print_stacktrace;
                Output.disableBuffering();
                std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.debug.detectTTYConfig()) catch break :print_stacktrace;
            }

            std.os.exit(1);
        },
        error.MissingPackageJSON => {
            Output.prettyError(
                "\n<r><red>error<r><d>:<r> <b>MissingPackageJSON<r>\nbun could not find a package.json file.\n",
                .{},
            );
            Output.flush();
            std.os.exit(1);
        },
        else => {},
    }

    Report.fatal(err, null);

    print_stacktrace: {
        var debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
        var trace = @errorReturnTrace() orelse break :print_stacktrace;
        Output.disableBuffering();
        std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.debug.detectTTYConfig()) catch break :print_stacktrace;
    }

    std.os.exit(1);
}
