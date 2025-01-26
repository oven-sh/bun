//! This file contains Bun's crash handler. In debug builds, we are able to
//! print backtraces that are mapped to source code. In release builds, we do
//! not have debug symbols in the binary. Bun's solution to this is called
//! a "trace string", a url with compressed encoding of the captured
//! backtrace. Version 1 trace strings contain the following information:
//!
//! - What version and commit of Bun captured the backtrace.
//! - The platform the backtrace was captured on.
//! - The list of addresses with ASLR removed, ready to be remapped.
//! - If panicking, the message that was panicked with.
//!
//! These can be demangled using Bun's remapping API, which has cached
//! versions of all debug symbols for all versions of Bun. Hosting this keeps
//! users from having to download symbols, which can be very large.
//!
//! The remapper is open source: https://github.com/oven-sh/bun.report
//!
//! A lot of this handler is based on the Zig Standard Library implementation
//! for std.debug.panicImpl and their code for gathering backtraces.
const std = @import("std");
const bun = @import("root").bun;
const builtin = @import("builtin");
const mimalloc = @import("allocators/mimalloc.zig");
const SourceMap = @import("./sourcemap/sourcemap.zig");
const windows = std.os.windows;
const Output = bun.Output;
const Global = bun.Global;
const Features = bun.Analytics.Features;
const debug = std.debug;

/// Set this to false if you want to disable all uses of this panic handler.
/// This is useful for testing as a crash in here will not 'panicked during a panic'.
pub const enable = true;

/// Overridable with BUN_CRASH_REPORT_URL environment variable.
const default_report_base_url = "https://bun.report";

/// Only print the `Bun has crashed` message once. Once this is true, control
/// flow is not returned to the main application.
var has_printed_message = false;

/// Non-zero whenever the program triggered a panic.
/// The counter is incremented/decremented atomically.
var panicking = std.atomic.Value(u8).init(0);

// Locked to avoid interleaving panic messages from multiple threads.
// TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
var panic_mutex = bun.Mutex{};

/// Counts how many times the panic handler is invoked by this thread.
/// This is used to catch and handle panics triggered by the panic handler.
threadlocal var panic_stage: usize = 0;

threadlocal var inside_native_plugin: ?[*:0]const u8 = null;

export fn CrashHandler__setInsideNativePlugin(name: ?[*:0]const u8) callconv(.C) void {
    inside_native_plugin = name;
}

/// This can be set by various parts of the codebase to indicate a broader
/// action being taken. It is printed when a crash happens, which can help
/// narrow down what the bug is. Example: "Crashed while parsing /path/to/file.js"
///
/// Some of these are enabled in release builds, which may encourage users to
/// attach the affected files to crash report. Others, which may have low crash
/// rate or only crash due to assertion failures, are debug-only. See `Action`.
pub threadlocal var current_action: ?Action = null;

var before_crash_handlers: std.ArrayListUnmanaged(struct { *anyopaque, *const OnBeforeCrash }) = .{};

// TODO: I don't think it's safe to lock/unlock a mutex inside a signal handler.
var before_crash_handlers_mutex: bun.Mutex = .{};

const CPUFeatures = @import("./bun.js/bindings/CPUFeatures.zig").CPUFeatures;

/// This structure and formatter must be kept in sync with `bun.report`'s decoder implementation.
pub const CrashReason = union(enum) {
    /// From @panic()
    panic: []const u8,

    /// "reached unreachable code"
    @"unreachable",

    segmentation_fault: usize,
    illegal_instruction: usize,

    /// Posix-only
    bus_error: usize,
    /// Posix-only
    floating_point_error: usize,
    /// Windows-only
    datatype_misalignment,
    /// Windows-only
    stack_overflow,

    /// Either `main` returned an error, or somewhere else in the code a trace string is printed.
    zig_error: anyerror,

    out_of_memory,

    pub fn format(reason: CrashReason, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (reason) {
            .panic => |message| try writer.print("{s}", .{message}),
            .@"unreachable" => try writer.writeAll("reached unreachable code"),
            .segmentation_fault => |addr| try writer.print("Segmentation fault at address 0x{X}", .{addr}),
            .illegal_instruction => |addr| try writer.print("Illegal instruction at address 0x{X}", .{addr}),
            .bus_error => |addr| try writer.print("Bus error at address 0x{X}", .{addr}),
            .floating_point_error => |addr| try writer.print("Floating point error at address 0x{X}", .{addr}),
            .datatype_misalignment => try writer.writeAll("Unaligned memory access"),
            .stack_overflow => try writer.writeAll("Stack overflow"),
            .zig_error => |err| try writer.print("error.{s}", .{@errorName(err)}),
            .out_of_memory => try writer.writeAll("Bun ran out of memory"),
        }
    }
};

pub const Action = union(enum) {
    parse: []const u8,
    visit: []const u8,
    print: []const u8,

    /// bun.bundle_v2.LinkerContext.generateCompileResultForJSChunk
    bundle_generate_chunk: if (bun.Environment.isDebug) struct {
        context: *const anyopaque, // unfortunate dependency loop workaround
        chunk: *const bun.bundle_v2.Chunk,
        part_range: *const bun.bundle_v2.PartRange,

        pub fn linkerContext(data: *const @This()) *const bun.bundle_v2.LinkerContext {
            return @ptrCast(@alignCast(data.context));
        }
    } else void,

    resolver: if (bun.Environment.isDebug) struct {
        source_dir: []const u8,
        import_path: []const u8,
        kind: bun.ImportKind,
    } else void,

    pub fn format(act: Action, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (act) {
            .parse => |path| try writer.print("parsing {s}", .{path}),
            .visit => |path| try writer.print("visiting {s}", .{path}),
            .print => |path| try writer.print("printing {s}", .{path}),
            .bundle_generate_chunk => |data| if (bun.Environment.isDebug) {
                try writer.print(
                    \\generating bundler chunk
                    \\  chunk entry point: {?s}
                    \\  source: {?s}
                    \\  part range: {d}..{d}
                ,
                    .{
                        if (data.part_range.source_index.isValid()) data.linkerContext().parse_graph.input_files
                            .items(.source)[data.chunk.entry_point.source_index]
                            .path.text else null,
                        if (data.part_range.source_index.isValid()) data.linkerContext().parse_graph.input_files
                            .items(.source)[data.part_range.source_index.get()]
                            .path.text else null,
                        data.part_range.part_index_begin,
                        data.part_range.part_index_end,
                    },
                );
            },
            .resolver => |res| if (bun.Environment.isDebug) {
                try writer.print("resolving {s} from {s} ({s})", .{
                    res.import_path,
                    res.source_dir,
                    res.kind.label(),
                });
            },
        }
    }
};

/// This function is invoked when a crash happens. A crash is classified in `CrashReason`.
pub fn crashHandler(
    reason: CrashReason,
    // TODO: if both of these are specified, what is supposed to happen?
    error_return_trace: ?*std.builtin.StackTrace,
    begin_addr: ?usize,
) noreturn {
    @setCold(true);

    if (bun.Environment.isDebug)
        bun.Output.disableScopedDebugWriter();

    var trace_str_buf = std.BoundedArray(u8, 1024){};

    nosuspend switch (panic_stage) {
        0 => {
            bun.maybeHandlePanicDuringProcessReload();

            panic_stage = 1;
            _ = panicking.fetchAdd(1, .seq_cst);

            if (before_crash_handlers_mutex.tryLock()) {
                for (before_crash_handlers.items) |item| {
                    const ptr, const cb = item;
                    cb(ptr);
                }
            }

            {
                panic_mutex.lock();
                defer panic_mutex.unlock();

                // Use an raw unbuffered writer to stderr to avoid losing information on
                // panic in a panic. There is also a possibility that `Output` related code
                // is not configured correctly, so that would also mask the message.
                //
                // Output.errorWriter() is not used here because it may not be configured
                // if the program crashes immediately at startup.
                const writer = std.io.getStdErr().writer();

                // The format of the panic trace is slightly different in debug
                // builds. Mainly, we demangle the backtrace immediately instead
                // of using a trace string.
                //
                // To make the release-mode behavior easier to demo, debug mode
                // checks for this CLI flag.
                const debug_trace = bun.Environment.isDebug and check_flag: {
                    for (bun.argv) |arg| {
                        if (bun.strings.eqlComptime(arg, "--debug-crash-handler-use-trace-string")) {
                            break :check_flag false;
                        }
                    }
                    // Act like release build when explicitly enabling reporting
                    if (isReportingEnabled()) break :check_flag false;

                    break :check_flag true;
                };

                if (!has_printed_message) {
                    Output.flush();
                    Output.Source.Stdio.restore();

                    writer.writeAll("=" ** 60 ++ "\n") catch std.posix.abort();
                    printMetadata(writer) catch std.posix.abort();

                    if (inside_native_plugin) |name| {
                        const native_plugin_name = name;
                        const fmt =
                            \\
                            \\Bun has encountered a crash while running the <red><d>"{s}"<r> native plugin.
                            \\
                            \\This indicates either a bug in the native plugin or in Bun.
                            \\
                        ;
                        writer.print(Output.prettyFmt(fmt, true), .{native_plugin_name}) catch std.posix.abort();
                    }
                } else {
                    if (Output.enable_ansi_colors) {
                        writer.writeAll(Output.prettyFmt("<red>", true)) catch std.posix.abort();
                    }
                    writer.writeAll("oh no") catch std.posix.abort();
                    if (Output.enable_ansi_colors) {
                        writer.writeAll(Output.prettyFmt("<r><d>: multiple threads are crashing<r>\n", true)) catch std.posix.abort();
                    } else {
                        writer.writeAll(Output.prettyFmt(": multiple threads are crashing\n", true)) catch std.posix.abort();
                    }
                }

                if (reason != .out_of_memory or debug_trace) {
                    if (Output.enable_ansi_colors) {
                        writer.writeAll(Output.prettyFmt("<red>", true)) catch std.posix.abort();
                    }

                    writer.writeAll("panic") catch std.posix.abort();

                    if (Output.enable_ansi_colors) {
                        writer.writeAll(Output.prettyFmt("<r><d>", true)) catch std.posix.abort();
                    }

                    if (bun.CLI.Cli.is_main_thread) {
                        writer.writeAll("(main thread)") catch std.posix.abort();
                    } else switch (bun.Environment.os) {
                        .windows => {
                            var name: std.os.windows.PWSTR = undefined;
                            const result = bun.windows.GetThreadDescription(std.os.windows.kernel32.GetCurrentThread(), &name);
                            if (std.os.windows.HRESULT_CODE(result) == .SUCCESS and name[0] != 0) {
                                writer.print("({})", .{bun.fmt.utf16(bun.span(name))}) catch std.posix.abort();
                            } else {
                                writer.print("(thread {d})", .{std.os.windows.kernel32.GetCurrentThreadId()}) catch std.posix.abort();
                            }
                        },
                        .mac, .linux => {},
                        else => @compileError("TODO"),
                    }

                    writer.writeAll(": ") catch std.posix.abort();
                    if (Output.enable_ansi_colors) {
                        writer.writeAll(Output.prettyFmt("<r>", true)) catch std.posix.abort();
                    }
                    writer.print("{}\n", .{reason}) catch std.posix.abort();
                }

                if (current_action) |action| {
                    writer.print("Crashed while {}\n", .{action}) catch std.posix.abort();
                }

                var addr_buf: [10]usize = undefined;
                var trace_buf: std.builtin.StackTrace = undefined;

                // If a trace was not provided, compute one now
                const trace = error_return_trace orelse get_backtrace: {
                    trace_buf = std.builtin.StackTrace{
                        .index = 0,
                        .instruction_addresses = &addr_buf,
                    };
                    std.debug.captureStackTrace(begin_addr orelse @returnAddress(), &trace_buf);
                    break :get_backtrace &trace_buf;
                };

                if (debug_trace) {
                    has_printed_message = true;

                    dumpStackTrace(trace.*);

                    trace_str_buf.writer().print("{}", .{TraceString{
                        .trace = trace,
                        .reason = reason,
                        .action = .view_trace,
                    }}) catch std.posix.abort();
                } else {
                    if (!has_printed_message) {
                        has_printed_message = true;
                        writer.writeAll("oh no") catch std.posix.abort();
                        if (Output.enable_ansi_colors) {
                            writer.writeAll(Output.prettyFmt("<r><d>:<r> ", true)) catch std.posix.abort();
                        } else {
                            writer.writeAll(Output.prettyFmt(": ", true)) catch std.posix.abort();
                        }
                        if (inside_native_plugin) |name| {
                            const native_plugin_name = name;
                            writer.print(Output.prettyFmt(
                                \\Bun has encountered a crash while running the <red><d>"{s}"<r> native plugin.
                                \\
                                \\To send a redacted crash report to Bun's team,
                                \\please file a GitHub issue using the link below:
                                \\
                                \\
                            , true), .{native_plugin_name}) catch std.posix.abort();
                        } else if (reason == .out_of_memory) {
                            writer.writeAll(
                                \\Bun has ran out of memory.
                                \\
                                \\To send a redacted crash report to Bun's team,
                                \\please file a GitHub issue using the link below:
                                \\
                                \\
                            ) catch std.posix.abort();
                        } else {
                            writer.writeAll(
                                \\Bun has crashed. This indicates a bug in Bun, not your code.
                                \\
                                \\To send a redacted crash report to Bun's team,
                                \\please file a GitHub issue using the link below:
                                \\
                                \\
                            ) catch std.posix.abort();
                        }
                    }

                    if (Output.enable_ansi_colors) {
                        writer.print(Output.prettyFmt("<cyan>", true), .{}) catch std.posix.abort();
                    }

                    writer.writeAll(" ") catch std.posix.abort();

                    trace_str_buf.writer().print("{}", .{TraceString{
                        .trace = trace,
                        .reason = reason,
                        .action = .open_issue,
                    }}) catch std.posix.abort();

                    writer.writeAll(trace_str_buf.slice()) catch std.posix.abort();

                    writer.writeAll("\n") catch std.posix.abort();
                }

                if (Output.enable_ansi_colors) {
                    writer.writeAll(Output.prettyFmt("<r>\n", true)) catch std.posix.abort();
                } else {
                    writer.writeAll("\n") catch std.posix.abort();
                }
            }

            // Be aware that this function only lets one thread return from it.
            // This is important so that we do not try to run the following reload logic twice.
            waitForOtherThreadToFinishPanicking();

            report(trace_str_buf.slice());

            // At this point, the crash handler has performed it's job. Reset the segfault handler
            // so that a crash will actually crash. We need this because we want the process to
            // exit with a signal, and allow tools to be able to gather core dumps.
            //
            // This is done so late (in comparison to the Zig Standard Library's panic handler)
            // because if multiple threads segfault (more often the case on Windows), we don't
            // want another thread to interrupt the crashing of the first one.
            resetSegfaultHandler();

            if (bun.auto_reload_on_crash and
                // Do not reload if the panic arose FROM the reload function.
                !bun.isProcessReloadInProgressOnAnotherThread())
            {
                // attempt to prevent a double panic
                bun.auto_reload_on_crash = false;

                Output.prettyErrorln("<d>--- Bun is auto-restarting due to crash <d>[time: <b>{d}<r><d>] ---<r>", .{
                    @max(std.time.milliTimestamp(), 0),
                });
                Output.flush();

                comptime bun.assert(void == @TypeOf(bun.reloadProcess(bun.default_allocator, false, true)));
                bun.reloadProcess(bun.default_allocator, false, true);
            }
        },
        inline 1, 2 => |t| {
            if (t == 1) {
                panic_stage = 2;

                resetSegfaultHandler();
                Output.flush();
            }
            panic_stage = 3;

            // A panic happened while trying to print a previous panic message,
            // we're still holding the mutex but that's fine as we're going to
            // call abort()
            const stderr = std.io.getStdErr().writer();
            stderr.print("\npanic: {s}\n", .{reason}) catch std.posix.abort();
            stderr.print("panicked during a panic. Aborting.\n", .{}) catch std.posix.abort();
        },
        3 => {
            // Panicked while printing "Panicked during a panic."
            panic_stage = 4;
        },
        else => {
            // Panicked or otherwise looped into the panic handler while trying to exit.
            std.posix.abort();
        },
    };

    crash();
}

/// This is called when `main` returns a Zig error.
/// We don't want to treat it as a crash under certain error codes.
pub fn handleRootError(err: anyerror, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    var show_trace = bun.Environment.isDebug;

    switch (err) {
        error.OutOfMemory => bun.outOfMemory(),

        error.InvalidArgument,
        error.@"Invalid Bunfig",
        error.InstallFailed,
        => if (!show_trace) Global.exit(1),

        error.SyntaxError => {
            Output.err("SyntaxError", "An error occurred while parsing code", .{});
        },

        error.CurrentWorkingDirectoryUnlinked => {
            Output.errGeneric(
                "The current working directory was deleted, so that command didn't work. Please cd into a different directory and try again.",
                .{},
            );
        },

        error.SystemFdQuotaExceeded => {
            if (comptime bun.Environment.isPosix) {
                const limit = if (std.posix.getrlimit(.NOFILE)) |limit| limit.cur else |_| null;
                if (comptime bun.Environment.isMac) {
                    Output.prettyError(
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
                            bun.fmt.nullableFallback(limit, "<unknown>"),
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
                            bun.fmt.nullableFallback(limit, "<unknown>"),
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
        },

        error.ProcessFdQuotaExceeded => {
            if (comptime bun.Environment.isPosix) {
                const limit = if (std.posix.getrlimit(.NOFILE)) |limit| limit.cur else |_| null;
                if (comptime bun.Environment.isMac) {
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
                            bun.fmt.nullableFallback(limit, "<unknown>"),
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
                            bun.fmt.nullableFallback(limit, "<unknown>"),
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
        },

        // The usage of `unreachable` in Zig's std.posix may cause the file descriptor problem to show up as other errors
        error.NotOpenForReading, error.Unexpected => {
            if (comptime bun.Environment.isPosix) {
                const limit = std.posix.getrlimit(.NOFILE) catch std.mem.zeroes(std.posix.rlimit);

                if (limit.cur > 0 and limit.cur < (8192 * 2)) {
                    Output.prettyError(
                        \\
                        \\<r><red>error<r>: An unknown error occurred, possibly due to low max file descriptors <d>(<red>Unexpected<r><d>)<r>
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

                    if (bun.Environment.isLinux) {
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
                    } else if (bun.Environment.isMac) {
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
                    Output.errGeneric(
                        "An unknown error occurred <d>(<red>{s}<r><d>)<r>",
                        .{@errorName(err)},
                    );
                    show_trace = true;
                }
            } else {
                Output.errGeneric(
                    \\An unknown error occurred <d>(<red>{s}<r><d>)<r>
                ,
                    .{@errorName(err)},
                );
                show_trace = true;
            }
        },

        error.ENOENT, error.FileNotFound => {
            Output.err(
                "ENOENT",
                "Bun could not find a file, and the code that produces this error is missing a better error.",
                .{},
            );
        },

        error.MissingPackageJSON => {
            Output.errGeneric(
                "Bun could not find a package.json file to install from",
                .{},
            );
            Output.note("Run \"bun init\" to initialize a project", .{});
        },

        else => {
            Output.errGeneric(
                if (bun.Environment.isDebug)
                    "'main' returned <red>error.{s}<r>"
                else
                    "An internal error occurred (<red>{s}<r>)",
                .{@errorName(err)},
            );
            show_trace = true;
        },
    }

    if (show_trace) {
        verbose_error_trace = show_trace;
        handleErrorReturnTraceExtra(err, error_return_trace, true);
    }

    Global.exit(1);
}

pub fn panicImpl(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace, begin_addr: ?usize) noreturn {
    @setCold(true);
    crashHandler(
        if (bun.strings.eqlComptime(msg, "reached unreachable code"))
            .{ .@"unreachable" = {} }
        else
            .{ .panic = msg },
        error_return_trace,
        begin_addr orelse @returnAddress(),
    );
}

fn panicBuiltin(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace, begin_addr: ?usize) noreturn {
    std.debug.panicImpl(error_return_trace, begin_addr, msg);
}

pub const panic = if (enable) panicImpl else panicBuiltin;

pub fn reportBaseUrl() []const u8 {
    const static = struct {
        var base_url: ?[]const u8 = null;
    };
    return static.base_url orelse {
        const computed = computed: {
            if (bun.getenvZ("BUN_CRASH_REPORT_URL")) |url| {
                break :computed bun.strings.withoutTrailingSlash(url);
            }
            break :computed default_report_base_url;
        };
        static.base_url = computed;
        return computed;
    };
}

const arch_display_string = if (bun.Environment.isAarch64)
    if (bun.Environment.isMac) "Silicon" else "arm64"
else
    "x64";

const metadata_version_line = std.fmt.comptimePrint(
    "Bun {s}v{s} {s} {s}{s}\n",
    .{
        if (bun.Environment.isDebug) "Debug " else if (bun.Environment.is_canary) "Canary " else "",
        Global.package_json_version_with_sha,
        bun.Environment.os.displayString(),
        arch_display_string,
        if (bun.Environment.baseline) " (baseline)" else "",
    },
);

fn handleSegfaultPosix(sig: i32, info: *const std.posix.siginfo_t, _: ?*const anyopaque) callconv(.C) noreturn {
    const addr = switch (bun.Environment.os) {
        .linux => @intFromPtr(info.fields.sigfault.addr),
        .mac => @intFromPtr(info.addr),
        else => @compileError(unreachable),
    };

    crashHandler(
        switch (sig) {
            std.posix.SIG.SEGV => .{ .segmentation_fault = addr },
            std.posix.SIG.ILL => .{ .illegal_instruction = addr },
            std.posix.SIG.BUS => .{ .bus_error = addr },
            std.posix.SIG.FPE => .{ .floating_point_error = addr },

            // we do not register this handler for other signals
            else => unreachable,
        },
        null,
        @returnAddress(),
    );
}

var did_register_sigaltstack = false;
var sigaltstack: [512 * 1024]u8 = undefined;

pub fn updatePosixSegfaultHandler(act: ?*std.posix.Sigaction) !void {
    if (act) |act_| {
        if (!did_register_sigaltstack) {
            var stack: std.c.stack_t = .{
                .flags = 0,
                .size = sigaltstack.len,
                .sp = &sigaltstack,
            };

            if (std.c.sigaltstack(&stack, null) == 0) {
                act_.flags |= std.posix.SA.ONSTACK;
                did_register_sigaltstack = true;
            }
        }
    }

    try std.posix.sigaction(std.posix.SIG.SEGV, act, null);
    try std.posix.sigaction(std.posix.SIG.ILL, act, null);
    try std.posix.sigaction(std.posix.SIG.BUS, act, null);
    try std.posix.sigaction(std.posix.SIG.FPE, act, null);
}

var windows_segfault_handle: ?windows.HANDLE = null;

pub fn resetOnPosix() void {
    var act = std.posix.Sigaction{
        .handler = .{ .sigaction = handleSegfaultPosix },
        .mask = std.posix.empty_sigset,
        .flags = (std.posix.SA.SIGINFO | std.posix.SA.RESTART | std.posix.SA.RESETHAND),
    };
    updatePosixSegfaultHandler(&act) catch {};
}

pub fn init() void {
    if (!enable) return;
    switch (bun.Environment.os) {
        .windows => {
            windows_segfault_handle = windows.kernel32.AddVectoredExceptionHandler(0, handleSegfaultWindows);
        },
        .mac, .linux => {
            resetOnPosix();
        },
        else => @compileError("TODO"),
    }
}

pub fn resetSegfaultHandler() void {
    if (!enable) return;

    if (bun.Environment.os == .windows) {
        if (windows_segfault_handle) |handle| {
            const rc = windows.kernel32.RemoveVectoredExceptionHandler(handle);
            windows_segfault_handle = null;
            bun.assert(rc != 0);
        }
        return;
    }

    var act = std.posix.Sigaction{
        .handler = .{ .handler = std.posix.SIG.DFL },
        .mask = std.posix.empty_sigset,
        .flags = 0,
    };
    // To avoid a double-panic, do nothing if an error happens here.
    updatePosixSegfaultHandler(&act) catch {};
}

pub fn handleSegfaultWindows(info: *windows.EXCEPTION_POINTERS) callconv(windows.WINAPI) c_long {
    crashHandler(
        switch (info.ExceptionRecord.ExceptionCode) {
            windows.EXCEPTION_DATATYPE_MISALIGNMENT => .{ .datatype_misalignment = {} },
            windows.EXCEPTION_ACCESS_VIOLATION => .{ .segmentation_fault = info.ExceptionRecord.ExceptionInformation[1] },
            windows.EXCEPTION_ILLEGAL_INSTRUCTION => .{ .illegal_instruction = info.ContextRecord.getRegs().ip },
            windows.EXCEPTION_STACK_OVERFLOW => .{ .stack_overflow = {} },

            // exception used for thread naming
            // https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-studio-2017/debugger/how-to-set-a-thread-name-in-native-code?view=vs-2017#set-a-thread-name-by-throwing-an-exception
            // related commit
            // https://github.com/go-delve/delve/pull/1384
            bun.windows.MS_VC_EXCEPTION => return bun.windows.EXCEPTION_CONTINUE_EXECUTION,

            else => return windows.EXCEPTION_CONTINUE_SEARCH,
        },
        null,
        @intFromPtr(info.ExceptionRecord.ExceptionAddress),
    );
}

extern "C" fn gnu_get_libc_version() ?[*:0]const u8;

pub fn printMetadata(writer: anytype) !void {
    if (Output.enable_ansi_colors) {
        try writer.writeAll(Output.prettyFmt("<r><d>", true));
    }

    var is_ancient_cpu = false;

    try writer.writeAll(metadata_version_line);
    {
        const platform = bun.Analytics.GenerateHeader.GeneratePlatform.forOS();
        const cpu_features = CPUFeatures.get();
        if (bun.Environment.isLinux and !bun.Environment.isMusl) {
            const version = gnu_get_libc_version() orelse "";
            const kernel_version = bun.Analytics.GenerateHeader.GeneratePlatform.kernelVersion();
            if (platform.os == .wsl) {
                try writer.print("WSL Kernel v{d}.{d}.{d} | glibc v{s}\n", .{ kernel_version.major, kernel_version.minor, kernel_version.patch, bun.sliceTo(version, 0) });
            } else {
                try writer.print("Linux Kernel v{d}.{d}.{d} | glibc v{s}\n", .{ kernel_version.major, kernel_version.minor, kernel_version.patch, bun.sliceTo(version, 0) });
            }
        } else if (bun.Environment.isLinux and bun.Environment.isMusl) {
            const kernel_version = bun.Analytics.GenerateHeader.GeneratePlatform.kernelVersion();
            try writer.print("Linux Kernel v{d}.{d}.{d} | musl\n", .{ kernel_version.major, kernel_version.minor, kernel_version.patch });
        } else if (bun.Environment.isMac) {
            try writer.print("macOS v{s}\n", .{platform.version});
        } else if (bun.Environment.isWindows) {
            try writer.print("Windows v{s}\n", .{std.zig.system.windows.detectRuntimeVersion()});
        }

        if (comptime bun.Environment.isX64) {
            if (!cpu_features.avx and !cpu_features.avx2 and !cpu_features.avx512) {
                is_ancient_cpu = true;
            }
        }

        if (!cpu_features.isEmpty()) {
            try writer.print("CPU: {}\n", .{cpu_features});
        }

        try writer.print("Args: ", .{});
        var arg_chars_left: usize = if (bun.Environment.isDebug) 4096 else 196;
        for (bun.argv, 0..) |arg, i| {
            if (i != 0) try writer.writeAll(" ");
            try bun.fmt.quotedWriter(writer, arg[0..@min(arg.len, arg_chars_left)]);
            arg_chars_left -|= arg.len;
            if (arg_chars_left == 0) {
                try writer.writeAll("...");
                break;
            }
        }
    }
    try writer.print("\n{}", .{bun.Analytics.Features.formatter()});

    if (bun.use_mimalloc) {
        var elapsed_msecs: usize = 0;
        var user_msecs: usize = 0;
        var system_msecs: usize = 0;
        var current_rss: usize = 0;
        var peak_rss: usize = 0;
        var current_commit: usize = 0;
        var peak_commit: usize = 0;
        var page_faults: usize = 0;
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
        try writer.print("Elapsed: {d}ms | User: {d}ms | Sys: {d}ms\n", .{
            elapsed_msecs,
            user_msecs,
            system_msecs,
        });
        try writer.print("RSS: {:<3.2} | Peak: {:<3.2} | Commit: {:<3.2} | Faults: {d}\n", .{
            std.fmt.fmtIntSizeDec(current_rss),
            std.fmt.fmtIntSizeDec(peak_rss),
            std.fmt.fmtIntSizeDec(current_commit),
            page_faults,
        });
    }

    if (Output.enable_ansi_colors) {
        try writer.writeAll(Output.prettyFmt("<r>", true));
    }
    try writer.writeAll("\n");

    if (comptime bun.Environment.isX64) {
        if (is_ancient_cpu) {
            try writer.writeAll("CPU lacks AVX support. Please consider upgrading to a newer CPU.\n");
        }
    }
}

fn waitForOtherThreadToFinishPanicking() void {
    if (panicking.fetchSub(1, .seq_cst) != 1) {
        // Another thread is panicking, wait for the last one to finish
        // and call abort()
        if (builtin.single_threaded) unreachable;

        // Sleep forever without hammering the CPU
        var futex = std.atomic.Value(u32).init(0);
        while (true) bun.Futex.waitForever(&futex, 0);
        comptime unreachable;
    }
}

/// This is to be called by any thread that is attempting to exit the process.
/// If another thread is panicking, this will sleep this thread forever, under
/// the assumption that the crash handler will terminate the program.
///
/// There have been situations in the past where a bundler thread starts
/// panicking, but the main thread ends up marking a test as passing and then
/// exiting with code zero before the crash handler can finish the crash.
pub fn sleepForeverIfAnotherThreadIsCrashing() void {
    if (panicking.load(.acquire) > 0) {
        // Sleep forever without hammering the CPU
        var futex = std.atomic.Value(u32).init(0);
        while (true) bun.Futex.waitForever(&futex, 0);
        comptime unreachable;
    }
}

/// Each platform is encoded as a single character. It is placed right after the
/// slash after the version, so someone just reading the trace string can tell
/// what platform it came from. L, M, and W are for Linux, macOS, and Windows,
/// with capital letters indicating aarch64, lowercase indicating x86_64.
///
/// eg: 'https://bun.report/1.1.3/we04c...
//                                ^ this tells you it is windows x86_64
///
/// Baseline gets a weirder encoding of a mix of b and e.
const Platform = enum(u8) {
    linux_x86_64 = 'l',
    linux_x86_64_baseline = 'B',
    linux_aarch64 = 'L',

    mac_x86_64_baseline = 'b',
    mac_x86_64 = 'm',
    mac_aarch64 = 'M',

    windows_x86_64 = 'w',
    windows_x86_64_baseline = 'e',

    const current = @field(Platform, @tagName(bun.Environment.os) ++
        "_" ++ @tagName(builtin.target.cpu.arch) ++
        (if (bun.Environment.baseline) "_baseline" else ""));
};

/// Note to the decoder on how to process this string. This ensures backwards
/// compatibility with older versions of the tracestring.
///
/// '1' - original. uses 7 char hash with VLQ encoded stack-frames
/// '2' - same as '1' but this build is known to be a canary build
const version_char = if (bun.Environment.is_canary)
    "2"
else
    "1";

const git_sha = if (bun.Environment.git_sha.len > 0) bun.Environment.git_sha[0..7] else "unknown";

const StackLine = struct {
    address: i32,
    // null -> from bun.exe
    object: ?[]const u8,

    /// `null` implies the trace is not known.
    pub fn fromAddress(addr: usize, name_bytes: []u8) ?StackLine {
        return switch (bun.Environment.os) {
            .windows => {
                const module = bun.windows.getModuleHandleFromAddress(addr) orelse
                    return null;

                const base_address = @intFromPtr(module);

                var temp: [512]u16 = undefined;
                const name = bun.windows.getModuleNameW(module, &temp) orelse
                    return null;

                const image_path = bun.windows.exePathW();

                return .{
                    // To remap this, `pdb-addr2line --exe bun.pdb 0x123456`
                    .address = @intCast(addr - base_address),

                    .object = if (!std.mem.eql(u16, name, image_path)) name: {
                        const basename = name[if (std.mem.lastIndexOfAny(u16, name, &[_]u16{ '\\', '/' })) |i|
                            // skip the last slash
                            i + 1
                        else
                            0..];
                        break :name bun.strings.convertUTF16toUTF8InBuffer(name_bytes, basename) catch null;
                    } else null,
                };
            },
            .mac => {
                // This code is slightly modified from std.debug.DebugInfo.lookupModuleNameDyld
                // https://github.com/ziglang/zig/blob/215de3ee67f75e2405c177b262cb5c1cd8c8e343/lib/std/debug.zig#L1783
                const address = if (addr == 0) 0 else addr - 1;

                const image_count = std.c._dyld_image_count();

                var i: u32 = 0;
                while (i < image_count) : (i += 1) {
                    const header = std.c._dyld_get_image_header(i) orelse continue;
                    const base_address = @intFromPtr(header);
                    if (address < base_address) continue;
                    // This 'slide' is the ASLR offset. Subtract from `address` to get a stable address
                    const vmaddr_slide = std.c._dyld_get_image_vmaddr_slide(i);

                    var it = std.macho.LoadCommandIterator{
                        .ncmds = header.ncmds,
                        .buffer = @alignCast(@as(
                            [*]u8,
                            @ptrFromInt(@intFromPtr(header) + @sizeOf(std.macho.mach_header_64)),
                        )[0..header.sizeofcmds]),
                    };

                    while (it.next()) |cmd| switch (cmd.cmd()) {
                        .SEGMENT_64 => {
                            const segment_cmd = cmd.cast(std.macho.segment_command_64).?;
                            if (!bun.strings.eqlComptime(segment_cmd.segName(), "__TEXT")) continue;

                            const original_address = address - vmaddr_slide;
                            const seg_start = segment_cmd.vmaddr;
                            const seg_end = seg_start + segment_cmd.vmsize;
                            if (original_address >= seg_start and original_address < seg_end) {
                                // Subtract ASLR value for stable address
                                const stable_address: usize = @intCast(address - vmaddr_slide);

                                if (i == 0) {
                                    const image_relative_address = stable_address - seg_start;
                                    if (image_relative_address > std.math.maxInt(i32)) {
                                        return null;
                                    }

                                    // To remap this, you have to add the offset (which is going to be 0x100000000),
                                    // and then you can run it through `llvm-symbolizer --obj bun-with-symbols 0x123456`
                                    // The reason we are subtracting this known offset is mostly just so that we can
                                    // fit it within a signed 32-bit integer. The VLQs will be shorter too.
                                    return .{
                                        .object = null,
                                        .address = @intCast(image_relative_address),
                                    };
                                } else {
                                    // these libraries are not interesting, mark as unknown
                                    return null;
                                }

                                return null;
                            }
                        },
                        else => {},
                    };
                }

                return null;
            },
            else => {
                // This code is slightly modified from std.debug.DebugInfo.lookupModuleDl
                // https://github.com/ziglang/zig/blob/215de3ee67f75e2405c177b262cb5c1cd8c8e343/lib/std/debug.zig#L2024
                var ctx: struct {
                    // Input
                    address: usize,
                    i: usize = 0,
                    // Output
                    result: ?StackLine = null,
                } = .{ .address = addr -| 1 };
                const CtxTy = @TypeOf(ctx);

                std.posix.dl_iterate_phdr(&ctx, error{Found}, struct {
                    fn callback(info: *std.posix.dl_phdr_info, _: usize, context: *CtxTy) !void {
                        defer context.i += 1;

                        if (context.address < info.dlpi_addr) return;
                        const phdrs = info.dlpi_phdr[0..info.dlpi_phnum];
                        for (phdrs) |*phdr| {
                            if (phdr.p_type != std.elf.PT_LOAD) continue;

                            // Overflowing addition is used to handle the case of VSDOs
                            // having a p_vaddr = 0xffffffffff700000
                            const seg_start = info.dlpi_addr +% phdr.p_vaddr;
                            const seg_end = seg_start + phdr.p_memsz;
                            if (context.address >= seg_start and context.address < seg_end) {
                                // const name = bun.sliceTo(info.dlpi_name, 0) orelse "";
                                context.result = .{
                                    .address = @intCast(context.address - info.dlpi_addr),
                                    .object = null,
                                };
                                return error.Found;
                            }
                        }
                    }
                }.callback) catch {};

                return ctx.result;
            },
        };
    }

    pub fn writeEncoded(self: ?StackLine, writer: anytype) !void {
        const known = self orelse {
            try writer.writeAll("_");
            return;
        };

        if (known.object) |object| {
            try SourceMap.encodeVLQ(1).writeTo(writer);
            try SourceMap.encodeVLQ(@intCast(object.len)).writeTo(writer);
            try writer.writeAll(object);
        }

        try SourceMap.encodeVLQ(known.address).writeTo(writer);
    }

    pub fn format(line: StackLine, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try writer.print("0x{x}{s}{s}", .{
            if (bun.Environment.isMac) @as(u64, line.address) + 0x100000000 else line.address,
            if (line.object != null) " @ " else "",
            line.object orelse "",
        });
    }

    pub fn writeDecoded(self: ?StackLine, writer: anytype) !void {
        const known = self orelse {
            try writer.print("???", .{});
            return;
        };
        try known.format("", .{}, writer);
    }
};

const TraceString = struct {
    trace: *const std.builtin.StackTrace,
    reason: CrashReason,
    action: TraceString.Action,

    const Action = enum {
        /// Open a pre-filled GitHub issue with the expanded trace
        open_issue,
        /// View the trace with nothing else
        view_trace,
    };

    pub fn format(self: TraceString, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        encodeTraceString(self, writer) catch return;
    }
};

fn encodeTraceString(opts: TraceString, writer: anytype) !void {
    try writer.writeAll(reportBaseUrl());
    try writer.writeAll(
        "/" ++
            bun.Environment.version_string ++
            "/" ++
            .{@intFromEnum(Platform.current)},
    );
    try writer.writeByte(if (bun.CLI.Cli.cmd) |cmd| cmd.char() else '_');

    try writer.writeAll(version_char ++ git_sha);

    const packed_features = bun.analytics.packedFeatures();
    try writeU64AsTwoVLQs(writer, @bitCast(packed_features));

    var name_bytes: [1024]u8 = undefined;

    for (opts.trace.instruction_addresses[0..opts.trace.index]) |addr| {
        const line = StackLine.fromAddress(addr, &name_bytes);
        try StackLine.writeEncoded(line, writer);
    }

    try writer.writeAll(comptime zero_vlq: {
        const vlq = SourceMap.encodeVLQ(0);
        break :zero_vlq vlq.bytes[0..vlq.len];
    });

    // The following switch must be kept in sync with `bun.report`'s decoder implementation.
    switch (opts.reason) {
        .panic => |message| {
            try writer.writeByte('0');

            var compressed_bytes: [2048]u8 = undefined;
            var len: usize = compressed_bytes.len;
            const ret: bun.zlib.ReturnCode = @enumFromInt(bun.zlib.compress2(&compressed_bytes, &len, message.ptr, message.len, 9));
            const compressed = switch (ret) {
                .Ok => compressed_bytes[0..len],
                // Insufficient memory.
                .MemError => return error.OutOfMemory,
                // The buffer dest was not large enough to hold the compressed data.
                .BufError => return error.NoSpaceLeft,

                // The level was not Z_DEFAULT_LEVEL, or was not between 0 and 9.
                // This is technically possible but impossible because we pass 9.
                .StreamError => return error.Unexpected,
                else => return error.Unexpected,
            };

            var b64_bytes: [2048]u8 = undefined;
            if (bun.base64.encodeLen(compressed) > b64_bytes.len) {
                return error.NoSpaceLeft;
            }
            const b64_len = bun.base64.encode(&b64_bytes, compressed);

            try writer.writeAll(std.mem.trimRight(u8, b64_bytes[0..b64_len], "="));
        },

        .@"unreachable" => try writer.writeByte('1'),

        .segmentation_fault => |addr| {
            try writer.writeByte('2');
            try writeU64AsTwoVLQs(writer, addr);
        },
        .illegal_instruction => |addr| {
            try writer.writeByte('3');
            try writeU64AsTwoVLQs(writer, addr);
        },
        .bus_error => |addr| {
            try writer.writeByte('4');
            try writeU64AsTwoVLQs(writer, addr);
        },
        .floating_point_error => |addr| {
            try writer.writeByte('5');
            try writeU64AsTwoVLQs(writer, addr);
        },

        .datatype_misalignment => try writer.writeByte('6'),
        .stack_overflow => try writer.writeByte('7'),

        .zig_error => |err| {
            try writer.writeByte('8');
            try writer.writeAll(@errorName(err));
        },

        .out_of_memory => try writer.writeByte('9'),
    }

    if (opts.action == .view_trace) {
        try writer.writeAll("/view");
    }
}

fn writeU64AsTwoVLQs(writer: anytype, addr: usize) !void {
    const first = SourceMap.encodeVLQ(@bitCast(@as(u32, @intCast((addr & 0xFFFFFFFF00000000) >> 32))));
    const second = SourceMap.encodeVLQ(@bitCast(@as(u32, @intCast(addr & 0xFFFFFFFF))));
    try first.writeTo(writer);
    try second.writeTo(writer);
}

fn isReportingEnabled() bool {
    // If trying to test the crash handler backend, implicitly enable reporting
    if (bun.getenvZ("BUN_CRASH_REPORT_URL")) |value| {
        return value.len > 0;
    }

    // Environment variable to specifically enable or disable reporting
    if (bun.getenvZ("BUN_ENABLE_CRASH_REPORTING")) |value| {
        if (value.len > 0) {
            if (bun.strings.eqlComptime(value, "1")) {
                return true;
            }
            return false;
        }
    }

    // Debug builds shouldn't report to the default url by default
    if (bun.Environment.isDebug)
        return false;

    // Honor DO_NOT_TRACK
    if (!bun.analytics.isEnabled())
        return false;

    if (bun.Environment.is_canary)
        return true;

    // Change in v1.1.10: enable crash reporter auto upload on macOS and Windows.
    if (bun.Environment.isMac or bun.Environment.isWindows) {
        return true;
    }

    return false;
}

/// Bun automatically reports crashes on Windows and macOS
///
/// These URLs contain no source code or personally-identifiable
/// information (PII). The stackframes point to Bun's open-source native code
/// (not user code), and are safe to share publicly and with the Bun team.
fn report(url: []const u8) void {
    if (!isReportingEnabled()) return;

    switch (bun.Environment.os) {
        .windows => {
            var process: std.os.windows.PROCESS_INFORMATION = undefined;
            var startup_info = std.os.windows.STARTUPINFOW{
                .cb = @sizeOf(std.os.windows.STARTUPINFOW),
                .lpReserved = null,
                .lpDesktop = null,
                .lpTitle = null,
                .dwX = 0,
                .dwY = 0,
                .dwXSize = 0,
                .dwYSize = 0,
                .dwXCountChars = 0,
                .dwYCountChars = 0,
                .dwFillAttribute = 0,
                .dwFlags = 0,
                .wShowWindow = 0,
                .cbReserved2 = 0,
                .lpReserved2 = null,
                .hStdInput = null,
                .hStdOutput = null,
                .hStdError = null,
                // .hStdInput = bun.win32.STDIN_FD.cast(),
                // .hStdOutput = bun.win32.STDOUT_FD.cast(),
                // .hStdError = bun.win32.STDERR_FD.cast(),
            };
            var cmd_line = std.BoundedArray(u16, 4096){};
            cmd_line.appendSliceAssumeCapacity(std.unicode.utf8ToUtf16LeStringLiteral("powershell -ExecutionPolicy Bypass -Command \"try{Invoke-RestMethod -Uri '"));
            {
                const encoded = bun.strings.convertUTF8toUTF16InBuffer(cmd_line.unusedCapacitySlice(), url);
                cmd_line.len += @intCast(encoded.len);
            }
            cmd_line.appendSlice(std.unicode.utf8ToUtf16LeStringLiteral("/ack'|out-null}catch{}\"")) catch return;
            cmd_line.append(0) catch return;
            const cmd_line_slice = cmd_line.buffer[0 .. cmd_line.len - 1 :0];
            const spawn_result = std.os.windows.kernel32.CreateProcessW(
                null,
                cmd_line_slice,
                null,
                null,
                1, // true
                0,
                null,
                null,
                &startup_info,
                &process,
            );

            // we don't care what happens with the process
            _ = spawn_result;
        },
        .mac, .linux => {
            var buf: bun.PathBuffer = undefined;
            var buf2: bun.PathBuffer = undefined;
            const curl = bun.which(
                &buf,
                bun.getenvZ("PATH") orelse return,
                bun.getcwd(&buf2) catch return,
                "curl",
            ) orelse return;
            var cmd_line = std.BoundedArray(u8, 4096){};
            cmd_line.appendSlice(url) catch return;
            cmd_line.appendSlice("/ack") catch return;
            cmd_line.append(0) catch return;

            var argv = [_:null]?[*:0]const u8{
                curl,
                "-fsSL",
                cmd_line.buffer[0..cmd_line.len :0],
            };
            const result = std.c.fork();
            switch (result) {
                // success and failure cases: ignore the result
                else => return,
                // child
                0 => {
                    inline for (0..2) |i| {
                        _ = std.c.close(i);
                    }
                    _ = std.c.execve(argv[0].?, &argv, std.c.environ);
                    std.c.exit(0);
                },
            }
        },
        else => @compileError("NOT IMPLEMENTED"),
    }
}

/// Crash. Make sure segfault handlers are off so that this doesnt trigger the crash handler.
/// This causes a segfault on posix systems to try to get a core dump.
fn crash() noreturn {
    switch (bun.Environment.os) {
        .windows => {
            std.posix.abort();
        },
        else => {
            // Install default handler so that the tkill below will terminate.
            const sigact = std.posix.Sigaction{ .handler = .{ .handler = std.posix.SIG.DFL }, .mask = std.posix.empty_sigset, .flags = 0 };
            inline for (.{
                std.posix.SIG.SEGV,
                std.posix.SIG.ILL,
                std.posix.SIG.BUS,
                std.posix.SIG.ABRT,
                std.posix.SIG.FPE,
                std.posix.SIG.HUP,
                std.posix.SIG.TERM,
            }) |sig| {
                std.posix.sigaction(sig, &sigact, null) catch {};
            }

            @trap();
        },
    }
}

pub var verbose_error_trace = false;

noinline fn coldHandleErrorReturnTrace(err_int_workaround_for_zig_ccall_bug: std.meta.Int(.unsigned, @bitSizeOf(anyerror)), trace: *std.builtin.StackTrace, comptime is_root: bool) void {
    @setCold(true);
    const err = @errorFromInt(err_int_workaround_for_zig_ccall_bug);

    // The format of the panic trace is slightly different in debug
    // builds Mainly, we demangle the backtrace immediately instead
    // of using a trace string.
    //
    // To make the release-mode behavior easier to demo, debug mode
    // checks for this CLI flag.
    const is_debug = bun.Environment.isDebug and check_flag: {
        for (bun.argv) |arg| {
            if (bun.strings.eqlComptime(arg, "--debug-crash-handler-use-trace-string")) {
                break :check_flag false;
            }
        }
        break :check_flag true;
    };

    if (is_debug) {
        if (is_root) {
            if (verbose_error_trace) {
                Output.note("Release build will not have this trace by default:", .{});
            }
        } else {
            Output.note(
                "caught error.{s}:",
                .{@errorName(err)},
            );
        }
        Output.flush();
        dumpStackTrace(trace.*);
    } else {
        const ts = TraceString{
            .trace = trace,
            .reason = .{ .zig_error = err },
            .action = .view_trace,
        };
        if (is_root) {
            Output.prettyErrorln(
                \\
                \\To send a redacted crash report to Bun's team,
                \\please file a GitHub issue using the link below:
                \\
                \\ <cyan>{}<r>
                \\
            ,
                .{ts},
            );
        } else {
            Output.prettyErrorln(
                "<cyan>trace<r>: error.{s}: <d>{}<r>",
                .{ @errorName(err), ts },
            );
        }
    }
}

inline fn handleErrorReturnTraceExtra(err: anyerror, maybe_trace: ?*std.builtin.StackTrace, comptime is_root: bool) void {
    if (!builtin.have_error_return_tracing) return;
    if (!verbose_error_trace and !is_root) return;

    if (maybe_trace) |trace| {
        coldHandleErrorReturnTrace(@intFromError(err), trace, is_root);
    }
}

/// In many places we catch errors, the trace for them is absorbed and only a
/// single line (the error name) is printed. When this is set, we will print
/// trace strings for those errors (or full stacks in debug builds).
///
/// This can be enabled by passing `--verbose-error-trace` to the CLI.
/// In release builds with error return tracing enabled, this is also exposed.
/// You can test if this feature is available by checking `bun --help` for the flag.
pub inline fn handleErrorReturnTrace(err: anyerror, maybe_trace: ?*std.builtin.StackTrace) void {
    handleErrorReturnTraceExtra(err, maybe_trace, false);
}

const stdDumpStackTrace = debug.dumpStackTrace;

/// Version of the standard library dumpStackTrace that has some fallbacks for
/// cases where such logic fails to run.
pub fn dumpStackTrace(trace: std.builtin.StackTrace) void {
    Output.flush();
    const stderr = std.io.getStdErr().writer();
    if (!bun.Environment.isDebug) {
        // debug symbols aren't available, lets print a tracestring
        stderr.print("View Debug Trace: {}\n", .{TraceString{
            .action = .view_trace,
            .reason = .{ .zig_error = error.DumpStackTrace },
            .trace = &trace,
        }}) catch {};
        return;
    }

    switch (bun.Environment.os) {
        .windows => attempt_dump: {
            // Windows has issues with opening the PDB file sometimes.
            const debug_info = debug.getSelfDebugInfo() catch |err| {
                stderr.print("Unable to dump stack trace: Unable to open debug info: {s}\n", .{@errorName(err)}) catch return;
                break :attempt_dump;
            };
            var arena = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            debug.writeStackTrace(trace, stderr, arena.allocator(), debug_info, std.io.tty.detectConfig(std.io.getStdErr())) catch |err| {
                stderr.print("Unable to dump stack trace: {s}\nFallback trace:\n", .{@errorName(err)}) catch return;
                break :attempt_dump;
            };
            return;
        },
        .linux => {
            // Linux doesnt seem to be able to decode it's own debug info.
            // TODO(@paperdave): see if zig 0.14 fixes this
        },
        else => {
            stdDumpStackTrace(trace);
            return;
        },
    }

    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var sfa = std.heap.stackFallback(16384, arena.allocator());
    const alloc = sfa.get();

    var argv = std.ArrayList([]const u8).init(alloc);

    const program = switch (bun.Environment.os) {
        .windows => "pdb-addr2line",
        else => "llvm-symbolizer",
    };
    argv.append(program) catch return;

    argv.append("--exe") catch return;
    argv.append(
        switch (bun.Environment.os) {
            .windows => brk: {
                const image_path = bun.strings.toUTF8Alloc(alloc, bun.windows.exePathW()) catch return;
                break :brk std.mem.concat(alloc, u8, &.{
                    image_path[0 .. image_path.len - 3],
                    "pdb",
                }) catch return;
            },
            else => bun.selfExePath() catch return,
        },
    ) catch return;

    var name_bytes: [1024]u8 = undefined;
    for (trace.instruction_addresses[0..trace.index]) |addr| {
        const line = StackLine.fromAddress(addr, &name_bytes) orelse
            continue;
        argv.append(std.fmt.allocPrint(alloc, "0x{X}", .{line.address}) catch return) catch return;
    }

    // std.process is used here because bun.spawnSync with libuv does not work within
    // the crash handler.
    const proc = std.process.Child.run(.{
        .allocator = alloc,
        .argv = argv.items,
    }) catch {
        stderr.print("Failed to invoke command: {s}\n", .{bun.fmt.fmtSlice(argv.items, " ")}) catch return;
        return;
    };
    if (proc.term != .Exited or proc.term.Exited != 0) {
        stderr.print("Failed to invoke command: {s}\n", .{bun.fmt.fmtSlice(argv.items, " ")}) catch return;
    }
    defer alloc.free(proc.stderr);
    defer alloc.free(proc.stdout);
    stderr.writeAll(proc.stdout) catch return;
    stderr.writeAll(proc.stderr) catch return;
}

pub fn dumpCurrentStackTrace(first_address: ?usize) void {
    var addrs: [32]usize = undefined;
    var stack: std.builtin.StackTrace = .{ .index = 0, .instruction_addresses = &addrs };
    std.debug.captureStackTrace(first_address orelse @returnAddress(), &stack);
    dumpStackTrace(stack);
}

/// A variant of `std.builtin.StackTrace` that stores its data within itself
/// instead of being a pointer. This allows storing captured stack traces
/// for later printing.
pub const StoredTrace = struct {
    data: [31]usize,
    index: usize,

    pub const empty: StoredTrace = .{
        .data = .{0} ** 31,
        .index = 0,
    };

    pub fn trace(stored: *StoredTrace) std.builtin.StackTrace {
        return .{
            .index = stored.index,
            .instruction_addresses = &stored.data,
        };
    }

    pub fn capture(begin: ?usize) StoredTrace {
        var stored: StoredTrace = StoredTrace.empty;
        var frame = stored.trace();
        std.debug.captureStackTrace(begin orelse @returnAddress(), &frame);
        stored.index = frame.index;
        return stored;
    }

    pub fn from(stack_trace: ?*std.builtin.StackTrace) StoredTrace {
        if (stack_trace) |stack| {
            var data: [31]usize = undefined;
            @memset(&data, 0);
            const items = @min(stack.instruction_addresses.len, 31);
            @memcpy(data[0..items], stack.instruction_addresses[0..items]);
            return .{
                .data = data,
                .index = @min(items, stack.index),
            };
        } else {
            return empty;
        }
    }
};

pub const js_bindings = struct {
    const JSC = bun.JSC;
    const JSValue = JSC.JSValue;

    pub fn generate(global: *JSC.JSGlobalObject) JSC.JSValue {
        const obj = JSC.JSValue.createEmptyObject(global, 3);
        inline for (.{
            .{ "getMachOImageZeroOffset", jsGetMachOImageZeroOffset },
            .{ "getFeaturesAsVLQ", jsGetFeaturesAsVLQ },
            .{ "getFeatureData", jsGetFeatureData },

            .{ "segfault", jsSegfault },
            .{ "panic", jsPanic },
            .{ "rootError", jsRootError },
            .{ "outOfMemory", jsOutOfMemory },
            .{ "raiseIgnoringPanicHandler", jsRaiseIgnoringPanicHandler },
        }) |tuple| {
            const name = JSC.ZigString.static(tuple[0]);
            obj.put(global, name, JSC.createCallback(global, name, 1, tuple[1]));
        }
        return obj;
    }

    pub fn jsGetMachOImageZeroOffset(_: *bun.JSC.JSGlobalObject, _: *bun.JSC.CallFrame) bun.JSError!JSValue {
        if (!bun.Environment.isMac) return .undefined;

        const header = std.c._dyld_get_image_header(0) orelse return .undefined;
        const base_address = @intFromPtr(header);
        const vmaddr_slide = std.c._dyld_get_image_vmaddr_slide(0);

        return JSValue.jsNumber(base_address - vmaddr_slide);
    }

    pub fn jsSegfault(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        @setRuntimeSafety(false);
        const ptr: [*]align(1) u64 = @ptrFromInt(0xDEADBEEF);
        ptr[0] = 0xDEADBEEF;
        std.mem.doNotOptimizeAway(&ptr);
        return .undefined;
    }

    pub fn jsPanic(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        bun.crash_handler.panicImpl("invoked crashByPanic() handler", null, null);
    }

    pub fn jsRootError(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        bun.crash_handler.handleRootError(error.Test, null);
    }

    pub fn jsOutOfMemory(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        bun.outOfMemory();
    }

    pub fn jsRaiseIgnoringPanicHandler(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        bun.Global.raiseIgnoringPanicHandler(.SIGSEGV);
    }

    pub fn jsGetFeaturesAsVLQ(global: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const bits = bun.Analytics.packedFeatures();
        var buf = std.BoundedArray(u8, 16){};
        writeU64AsTwoVLQs(buf.writer(), @bitCast(bits)) catch {
            // there is definitely enough space in the bounded array
            unreachable;
        };
        var str = bun.String.createLatin1(buf.slice());
        return str.transferToJS(global);
    }

    pub fn jsGetFeatureData(global: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const obj = JSValue.createEmptyObject(global, 5);
        const list = bun.Analytics.packed_features_list;
        const array = JSValue.createEmptyArray(global, list.len);
        for (list, 0..) |feature, i| {
            array.putIndex(global, @intCast(i), bun.String.static(feature).toJS(global));
        }
        obj.put(global, JSC.ZigString.static("features"), array);
        obj.put(global, JSC.ZigString.static("version"), bun.String.init(Global.package_json_version).toJS(global));
        obj.put(global, JSC.ZigString.static("is_canary"), JSC.JSValue.jsBoolean(bun.Environment.is_canary));

        // This is the source of truth for the git sha.
        // Not the github ref or the git tag.
        obj.put(global, JSC.ZigString.static("revision"), bun.String.init(bun.Environment.git_sha).toJS(global));

        obj.put(global, JSC.ZigString.static("generated_at"), JSValue.jsNumberFromInt64(@max(std.time.milliTimestamp(), 0)));
        return obj;
    }
};

const OnBeforeCrash = fn (opaque_ptr: *anyopaque) void;

/// For large codebases such as bun.bake.DevServer, it may be helpful
/// to dump a large amount of state to a file to aid debugging a crash.
///
/// Pre-crash handlers are likely, but not guaranteed to call. Errors are ignored.
pub fn appendPreCrashHandler(comptime T: type, ptr: *T, comptime handler: fn (*T) anyerror!void) !void {
    const wrap = struct {
        fn onCrash(opaque_ptr: *anyopaque) void {
            handler(@ptrCast(@alignCast(opaque_ptr))) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
            };
        }
    };

    before_crash_handlers_mutex.lock();
    defer before_crash_handlers_mutex.unlock();
    try before_crash_handlers.append(bun.default_allocator, .{ ptr, wrap.onCrash });
}

pub fn removePreCrashHandler(ptr: *anyopaque) void {
    before_crash_handlers_mutex.lock();
    defer before_crash_handlers_mutex.unlock();
    const index = for (before_crash_handlers.items, 0..) |item, i| {
        if (item.@"0" == ptr) break i;
    } else return;
    _ = before_crash_handlers.orderedRemove(index);
}
