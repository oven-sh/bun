const std = @import("std");
const logger = @import("root").bun.logger;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const CLI = @import("./cli.zig").Cli;
const Features = @import("./analytics/analytics_thread.zig").Features;
const Platform = @import("./analytics/analytics_thread.zig").GenerateHeader.GeneratePlatform;
const HTTP = @import("root").bun.http.AsyncHTTP;
const CrashReporter = @import("./crash_reporter.zig");

const Report = @This();

var crash_report_writer: CrashReportWriter = CrashReportWriter{ .file = null };
const CrashWritable = if (Environment.isWasm) std.io.fixedBufferStream([2048]u8) else std.fs.File.Writer;
var crash_reporter_path: [1024]u8 = undefined;
pub const CrashReportWriter = struct {
    file: ?std.io.BufferedWriter(4096, CrashWritable) = null,
    file_path: []const u8 = "",

    pub fn printFrame(_: ?*anyopaque, frame: CrashReporter.StackFrame) void {
        const function_name = if (frame.function_name.len > 0) frame.function_name else "[function ?]";
        const filename = if (frame.filename.len > 0) frame.function_name else "[file ?]";
        const fmt = bun.fmt.hexIntUpper(frame.pc);
        crash_report_writer.print("[0x{any}] - <b>{s}<r> {s}:{d}\n", .{ fmt, function_name, filename, frame.line_number });
    }

    pub fn dump() void {
        if (comptime !Environment.isWasm)
            CrashReporter.print();
    }

    pub fn done() void {
        if (comptime !Environment.isWasm)
            CrashReporter.print();
    }

    pub fn print(this: *CrashReportWriter, comptime fmt: string, args: anytype) void {
        Output.prettyError(fmt, args);
        if (this.file) |*file| {
            var writer = file.writer();
            writer.print(comptime Output.prettyFmt(fmt, false), args) catch {};
        }
    }

    pub fn flush(this: *CrashReportWriter) void {
        if (this.file) |*file| {
            file.flush() catch {};
        }
        Output.flush();
    }

    pub fn generateFile(this: *CrashReportWriter) void {
        if (this.file != null) return;

        var base_dir: []const u8 = ".";
        if (bun.getenvZ("BUN_INSTALL")) |install_dir| {
            base_dir = strings.withoutTrailingSlash(install_dir);
        } else if (bun.getenvZ(bun.DotEnv.home_env)) |home_dir| {
            base_dir = strings.withoutTrailingSlash(home_dir);
        }
        const file_path = std.fmt.bufPrintZ(
            &crash_reporter_path,
            "{s}/.bun-crash/v{s}-{d}.crash",
            .{ base_dir, Global.package_json_version, @as(u64, @intCast(@max(std.time.milliTimestamp(), 0))) },
        ) catch return;

        if (bun.path.nextDirname(file_path)) |dirname| {
            _ = bun.sys.mkdirA(dirname, 0);
        }

        const call = bun.sys.open(file_path, std.os.O.TRUNC, 0).unwrap() catch return;
        var file = call.asFile();
        this.file = std.io.bufferedWriter(
            file.writer(),
        );
        this.file_path = bun.asByteSlice(file_path);
    }

    pub fn printPath(this: *CrashReportWriter) void {
        var display_path = this.file_path;

        if (this.file_path.len > 0) {
            var tilda = false;
            if (bun.getenvZ(bun.DotEnv.home_env)) |home_dir| {
                if (strings.hasPrefix(display_path, home_dir)) {
                    display_path = display_path[home_dir.len..];
                    tilda = true;
                }
            }

            if (tilda) {
                Output.prettyError("\nCrash report saved to:\n  <b>~{s}<r>\n", .{display_path});
            } else {
                Output.prettyError("\nCrash report saved to:\n  <b>{s}<r>\n", .{display_path});
            }
        }
    }
};

pub fn printMetadata() void {
    @setCold(true);
    crash_report_writer.generateFile();

    const cmd_label: string = if (CLI.cmd) |tag| @tagName(tag) else "Unknown";

    const platform = comptime Environment.os.displayString();
    const arch = comptime if (Environment.isAarch64)
        if (Environment.isMac) "Silicon" else "arm64"
    else
        "x64";

    const analytics_platform = Platform.forOS();

    crash_report_writer.print(
        \\
        \\<r>----- bun meta -----
    ++ "\nBun v" ++ Global.package_json_version_with_sha ++ " " ++ platform ++ " " ++ arch ++ " {s}\n" ++
        \\{s}: {}
        \\
    , .{
        analytics_platform.version,
        cmd_label,
        Features.formatter(),
    });

    const http_count = HTTP.active_requests_count.raw;
    if (http_count > 0)
        crash_report_writer.print(
            \\HTTP: {d}
            \\
        , .{http_count});

    if (comptime bun.use_mimalloc) {
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
        crash_report_writer.print("Elapsed: {d}ms | User: {d}ms | Sys: {d}ms\nRSS: {:<3.2} | Peak: {:<3.2} | Commit: {:<3.2} | Faults: {d}\n", .{
            elapsed_msecs,
            user_msecs,
            system_msecs,
            std.fmt.fmtIntSizeDec(current_rss),
            std.fmt.fmtIntSizeDec(peak_rss),
            std.fmt.fmtIntSizeDec(current_commit),
            page_faults,
        });
    }

    crash_report_writer.print("----- bun meta -----\n", .{});
}
var has_printed_fatal = false;
var has_printed_crash = false;
pub fn fatal(err_: ?anyerror, msg_: ?string) void {
    const had_printed_fatal = has_printed_fatal;
    if (!has_printed_fatal) {
        has_printed_fatal = true;
        crash_report_writer.generateFile();

        if (err_) |err| {
            if (Output.isEmojiEnabled()) {
                crash_report_writer.print(
                    "\n<r><red>error<r><d>:<r> <b>{s}<r>\n",
                    .{@errorName(err)},
                );
            } else {
                crash_report_writer.print(
                    "\n<r>error: {s}\n\n",
                    .{@errorName(err)},
                );
            }
        }

        if (msg_) |msg| {
            const msg_ptr = @intFromPtr(msg.ptr);
            if (msg_ptr > 0) {
                const len = @max(@min(msg.len, 1024), 0);

                if (len > 0) {
                    if (Output.isEmojiEnabled()) {
                        crash_report_writer.print(
                            "\n<r><red>uh-oh<r><d>:<r> <b>{s}<r>\n",
                            .{msg[0..len]},
                        );
                    } else {
                        crash_report_writer.print(
                            "\n<r>Panic: {s}\n\n",
                            .{msg[0..len]},
                        );
                    }
                }
            }
        }

        if (err_ == null) {
            if (Output.isEmojiEnabled()) {
                if (msg_ == null and err_ == null) {
                    crash_report_writer.print("<r><red>", .{});
                } else {
                    crash_report_writer.print("<r>", .{});
                }
                crash_report_writer.print("bun will crash now<r> 😭😭😭\n", .{});
            } else {
                crash_report_writer.print("bun has crashed :'(\n", .{});
            }
        }
        crash_report_writer.flush();

        printMetadata();

        crash_report_writer.flush();

        // TODO(@paperdave):
        // Bun__crashReportDumpStackTrace does not work on Windows, even in a debug build
        // It is fine to skip this because in release we ship with ReleaseSafe
        // because zig's panic handler will also trigger right after
        if (!Environment.isWindows) {
            // It only is a real crash report if it's not coming from Zig
            if (comptime !@import("root").bun.JSC.is_bindgen) {
                std.mem.doNotOptimizeAway(&Bun__crashReportWrite);
                Bun__crashReportDumpStackTrace(&crash_report_writer);
            }

            crash_report_writer.flush();
        }

        crash_report_writer.printPath();
    }

    if (!had_printed_fatal) {
        if (Environment.isWindows) {
            // TODO(@paperdave) change this to the original one once bun windows is stable
            crash_report_writer.print("\nSearch GitHub issues https://bun.sh/issues or join in #windows channel in https://bun.sh/discord\n\n", .{});
        } else {
            crash_report_writer.print("\nSearch GitHub issues https://bun.sh/issues or ask for #help in https://bun.sh/discord\n\n", .{});
        }
        crash_report_writer.flush();
    }
}

var globalError_ranOnce = false;
var error_return_trace: ?*std.builtin.StackTrace = null;

export fn Bun__crashReportWrite(ctx: *CrashReportWriter, bytes_ptr: [*]const u8, len: usize) void {
    if (!Environment.isWindows) {
        if (error_return_trace) |trace| {
            if (len > 0) {
                ctx.print("{s}\n{}", .{ bytes_ptr[0..len], trace });
            } else {
                ctx.print("{}\n", .{trace});
            }
            return;
        }
    }

    if (len > 0) {
        ctx.print("{s}\n", .{bytes_ptr[0..len]});
    }
}

extern "C" fn Bun__crashReportDumpStackTrace(ctx: *anyopaque) void;

pub noinline fn handleCrash(signal: i32, addr: usize) void {
    const had_printed_fatal = has_printed_fatal;
    if (has_printed_fatal) return;
    has_printed_fatal = true;

    crash_report_writer.generateFile();

    const name = switch (signal) {
        std.os.SIG.SEGV => error.SegmentationFault,
        std.os.SIG.ILL => error.InstructionError,
        std.os.SIG.BUS => error.BusError,
        else => error.Crash,
    };

    crash_report_writer.print(
        "\n<r><red>{s}<d> at 0x{any}\n\n",
        .{ @errorName(name), bun.fmt.hexIntUpper(addr) },
    );
    printMetadata();
    if (comptime Environment.isDebug and !Environment.isWindows) {
        error_return_trace = @errorReturnTrace();
    }

    if (!Environment.isWindows) {
        if (comptime !@import("root").bun.JSC.is_bindgen) {
            std.mem.doNotOptimizeAway(&Bun__crashReportWrite);
            Bun__crashReportDumpStackTrace(&crash_report_writer);
        }
    }

    if (!had_printed_fatal) {
        crash_report_writer.print("\nAsk for #help in https://bun.sh/discord or go to https://bun.sh/issues\n\n", .{});
    }
    crash_report_writer.flush();

    if (crash_report_writer.file) |file| {
        // don't handle return codes here
        _ = std.os.system.close(file.unbuffered_writer.context.handle);
    }

    crash_report_writer.file = null;
    if (!Environment.isWindows) {
        if (error_return_trace) |trace| {
            std.debug.dumpStackTrace(trace.*);
        }
    }
    Global.runExitCallbacks();
    std.c._exit(128 + @as(u8, @truncate(@as(u8, @intCast(@max(signal, 0))))));
}

pub noinline fn globalError(err: anyerror, trace_: @TypeOf(@errorReturnTrace())) noreturn {
    @setCold(true);

    error_return_trace = trace_;

    if (@atomicRmw(bool, &globalError_ranOnce, .Xchg, true, .Monotonic)) {
        Global.exit(1);
    }

    switch (err) {
        // error.BrokenPipe => {
        //     if (comptime Environment.isNative) {
        //         // if stdout/stderr was closed, we don't need to print anything
        //         std.c._exit(bun.JSC.getGlobalExitCodeForPipeFailure());
        //     }
        // },
        error.SyntaxError => {
            Output.prettyError(
                "\n<r><red>SyntaxError<r><d>:<r> An error occurred while parsing code",
                .{},
            );
            Global.exit(1);
        },
        error.OutOfMemory => {
            Output.prettyError(
                "\n<r><red>OutOfMemory<r><d>:<r> There might be an infinite loop somewhere",
                .{},
            );
            printMetadata();
            Global.exit(1);
        },
        error.CurrentWorkingDirectoryUnlinked => {
            Output.prettyError(
                "\n<r><red>error: <r>The current working directory was deleted, so that command didn't work. Please cd into a different directory and try again.",
                .{},
            );
            Global.exit(1);
        },
        error.InvalidArgument, error.InstallFailed, error.InvalidPackageJSON => {
            Global.exit(1);
        },
        error.SystemFdQuotaExceeded => {
            if (comptime Environment.isPosix) {
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

                    if (bun.getenvZ("USER")) |user| {
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
            } else {
                Output.prettyError(
                    \\<r><red>error<r>: Your computer ran out of file descriptors <d>(<red>SystemFdQuotaExceeded<r><d>)<r>
                ,
                    .{},
                );
            }

            Global.exit(1);
        },
        error.@"Invalid Bunfig" => {
            Global.exit(1);
        },
        error.ProcessFdQuotaExceeded => {
            if (comptime Environment.isPosix) {
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

                    if (bun.getenvZ("USER")) |user| {
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
            } else {
                Output.prettyErrorln(
                    \\<r><red>error<r>: bun ran out of file descriptors <d>(<red>ProcessFdQuotaExceeded<r><d>)<r>
                ,
                    .{},
                );
            }

            Global.exit(1);
        },
        // The usage of `unreachable` in Zig's std.os may cause the file descriptor problem to show up as other errors
        error.NotOpenForReading, error.Unexpected => {
            if (!Environment.isWindows) {
                if (trace_) |trace| {
                    print_stacktrace: {
                        const debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                        Output.disableBuffering();
                        std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.io.tty.detectConfig(std.io.getStdErr())) catch break :print_stacktrace;
                    }
                }
            }

            if (comptime Environment.isPosix) {
                const limit = std.os.getrlimit(.NOFILE) catch std.mem.zeroes(std.os.rlimit);

                if (limit.cur > 0 and limit.cur < (8192 * 2)) {
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
                        if (bun.getenvZ("USER")) |user| {
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
                } else {
                    Output.prettyError(
                        \\<r><red>error<r>: An unknown error ocurred <d>(<red>Unexpected<r><d>)<r>
                    ,
                        .{},
                    );
                }

                Global.exit(1);
            }
        },
        error.ENOENT, error.FileNotFound => {
            Output.prettyError(
                "\n<r><red>error<r><d>:<r> <b>FileNotFound<r>\nBun could not find a file, and the code that produces this error is missing a better error.\n",
                .{},
            );
            Output.flush();

            Report.printMetadata();

            Output.flush();

            if (!Environment.isWindows) {
                if (trace_) |trace| {
                    print_stacktrace: {
                        const debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                        Output.disableBuffering();
                        std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.io.tty.detectConfig(std.io.getStdErr())) catch break :print_stacktrace;
                    }
                }
            }

            Global.exit(1);
        },
        error.MissingPackageJSON => {
            Output.prettyError(
                "\n<r><red>error<r><d>:<r> <b>MissingPackageJSON<r>\nBun could not find a package.json file.\n",
                .{},
            );
            if (!Environment.isWindows) {
                if (trace_) |trace| {
                    print_stacktrace: {
                        const debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                        Output.disableBuffering();
                        std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.io.tty.detectConfig(std.io.getStdErr())) catch break :print_stacktrace;
                    }
                }
            }

            Global.exit(1);
        },
        else => {},
    }

    Report.fatal(err, null);
    if (!Environment.isWindows) {
        if (trace_) |trace| {
            print_stacktrace: {
                const debug_info = std.debug.getSelfDebugInfo() catch break :print_stacktrace;
                Output.disableBuffering();
                std.debug.writeStackTrace(trace.*, Output.errorWriter(), default_allocator, debug_info, std.io.tty.detectConfig(std.io.getStdErr())) catch break :print_stacktrace;
            }
        }
    }

    if (bun.auto_reload_on_crash) {
        // attempt to prevent a double panic
        bun.auto_reload_on_crash = false;

        Output.prettyErrorln("<d>---<r> Bun is auto-restarting due to crash <d>[time: <b>{d}<r><d>] ---<r>", .{@max(std.time.milliTimestamp(), 0)});
        Output.flush();
        bun.reloadProcess(bun.default_allocator, false);
    }

    Global.exit(1);
}
