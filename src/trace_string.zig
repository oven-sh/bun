//! TODO: document this
//!
//! This file is heavily inspired off of std.debug.panicImpl, but instead of
//! dumping addresses in release mode, it finds the offsets of these functions
//! and encodes them into a short string that can be compactly shared to the
//! GitHub issue tracker. This allows the binary to not contain any debug
//! symbols (makes it a smaller download), makes traces more concise in the
//! console, and still helps us debug crashes easily.
//!
//! Trace strings can be remapped using a remote service, which has a copy
//! of every version since this new panic handler was implemented (v1.1.4).
//!
//! TODO: instructions to fetch that
//!
const std = @import("std");
const builtin = @import("builtin");

const mimalloc = @import("allocators/mimalloc.zig");
const bun = @import("root").bun;

const SourceMap = @import("./sourcemap/sourcemap.zig");

const report_base_url = "https://bun.report/";

var has_printed_message = false;

/// Non-zero whenever the program triggered a panic.
/// The counter is incremented/decremented atomically.
var panicking = std.atomic.Value(u8).init(0);

// Locked to avoid interleaving panic messages from multiple threads.
var panic_mutex = std.Thread.Mutex{};

/// Counts how many times the panic handler is invoked by this thread.
/// This is used to catch and handle panics triggered by the panic handler.
threadlocal var panic_stage: usize = 0;

pub fn panic(msg: []const u8, maybe_trace: ?*std.builtin.StackTrace, begin_addr: ?usize) noreturn {
    @setCold(true);

    nosuspend switch (panic_stage) {
        0 => {
            panic_stage = 1;
            _ = panicking.fetchAdd(1, .SeqCst);

            {
                panic_mutex.lock();
                defer panic_mutex.unlock();

                bun.Output.flush();

                const writer = bun.Output.errorWriter();

                if (!has_printed_message) {
                    has_printed_message = true;
                    writer.writeAll("=" ** 60 ++ "\n") catch std.os.abort();
                    bun.Output.err("oh no",
                        \\Bun has crashed. This indicates a bug in Bun, and
                        \\should be reported as a GitHub issue.
                        \\
                        \\
                    , .{});
                    bun.Output.flush();
                    printMetadata(writer) catch std.os.abort();
                }

                if (bun.Output.enable_ansi_colors) {
                    writer.writeAll(bun.Output.prettyFmt("<red>", true)) catch std.os.abort();
                }

                writer.writeAll("panic") catch std.os.abort();
                switch (bun.Environment.os) {
                    .windows => {
                        var name: std.os.windows.PWSTR = undefined;
                        const result = bun.windows.GetThreadDescription(std.os.windows.kernel32.GetCurrentThread(), &name);
                        if (std.os.windows.HRESULT_CODE(result) == .SUCCESS and name[0] != 0) {
                            writer.print("({})", .{bun.fmt.utf16(bun.span(name))}) catch std.os.abort();
                        } else {
                            writer.print("(thread {d})", .{std.os.windows.kernel32.GetCurrentThreadId()}) catch std.os.abort();
                        }
                    },
                    else => @compileError("TODO"),
                }

                writer.writeAll(": ") catch std.os.abort();
                writer.writeAll(msg) catch std.os.abort();

                if (bun.Output.enable_ansi_colors) {
                    writer.writeAll(bun.Output.prettyFmt("<r>\n", true)) catch std.os.abort();
                } else {
                    writer.writeAll("\n") catch std.os.abort();
                }

                var addr_buf: [32]usize = undefined;
                var trace_buf: std.builtin.StackTrace = undefined;

                // If a trace was not provided, compute one now
                const trace = (maybe_trace orelse compute_now: {
                    trace_buf = std.builtin.StackTrace{
                        .index = 0,
                        .instruction_addresses = &addr_buf,
                    };
                    std.debug.captureStackTrace(begin_addr orelse @returnAddress(), &trace_buf);
                    break :compute_now &trace_buf;
                });

                writer.writeAll("Please report this panic as a GitHub issue using this link:\n") catch std.os.abort();
                if (bun.Output.enable_ansi_colors) {
                    writer.print(bun.Output.prettyFmt("<cyan>", true), .{}) catch std.os.abort();
                }

                encode(trace, msg, writer) catch std.os.abort();

                if (bun.Output.enable_ansi_colors) {
                    writer.writeAll(bun.Output.prettyFmt("<r>\n", true)) catch std.os.abort();
                } else {
                    writer.writeAll("\n") catch std.os.abort();
                }

                bun.Output.flush();
            }

            waitForOtherThreadToFinishPanicking();
        },
        1 => {
            // A panic happened while trying to print a previous panic message,
            // we're still holding the mutex but that's fine as we're going to
            // call abort()
            const stderr = std.io.getStdErr().writer();
            stderr.print("panic: {s}\n", .{msg}) catch std.os.abort();
            stderr.print("panicked during a panic. Aborting.\n", .{}) catch std.os.abort();
        },
        else => {
            // Panicked while printing "Panicked during a panic."
        },
    };

    switch (bun.Environment.os) {
        .windows => {
            std.os.abort();
        },
        else => {
            // Cause a segfault to make sure a core dump is generated if such is enabled
            const act = std.os.Sigaction{
                .handler = .{ .sigaction = @ptrCast(@alignCast(std.os.SIG.DFL)) },
                .mask = std.os.empty_sigset,
                .flags = 0,
            };
            std.os.sigaction(std.os.SIG.SEGV, &act, null) catch std.os.abort();
        },
    }
}

const arch_display_string = if (bun.Environment.isAarch64)
    if (bun.Environment.isMac) "Silicon" else "arm64"
else
    "x64";

const metadata_version_line = std.fmt.comptimePrint(
    "Bun v{s} {s} {s}{s}\n",
    .{
        bun.Global.package_json_version_with_sha,
        bun.Environment.os.displayString(),
        arch_display_string,
        if (bun.Environment.baseline) " (baseline)" else "",
    },
);

pub fn printMetadata(writer: anytype) !void {
    try writer.writeAll(metadata_version_line);
    try writer.print("Cmd: {s}\n", .{if (bun.CLI.Cli.cmd) |cmd| @tagName(cmd) else "unknown"});
    try writer.print("{}", .{bun.Analytics.Features.formatter()});

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
        try writer.print("Elapsed: {d}ms | User: {d}ms | Sys: {d}ms\nRSS: {:<3.2} | Peak: {:<3.2} | Commit: {:<3.2} | Faults: {d}\n", .{
            elapsed_msecs,
            user_msecs,
            system_msecs,
            std.fmt.fmtIntSizeDec(current_rss),
            std.fmt.fmtIntSizeDec(peak_rss),
            std.fmt.fmtIntSizeDec(current_commit),
            page_faults,
        });
    }

    try writer.writeAll("\n");
}

fn waitForOtherThreadToFinishPanicking() void {
    if (panicking.fetchSub(1, .SeqCst) != 1) {
        // Another thread is panicking, wait for the last one to finish
        // and call abort()
        if (builtin.single_threaded) unreachable;

        // Sleep forever without hammering the CPU
        var futex = std.atomic.Value(u32).init(0);
        while (true) std.Thread.Futex.wait(&futex, 0);
        comptime unreachable;
    }
}

/// Each platform is encoded is a single character. It is placed right after the
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

    macos_x86_64_baseline = 'b',
    macos_x86_64 = 'm',
    macos_aarch64 = 'M',

    windows_x86_64 = 'w',
    windows_x86_64_baseline = 'e',

    const current = @field(Platform, @tagName(bun.Environment.os) ++
        "_" ++ @tagName(builtin.target.cpu.arch)) ++
        (if (bun.Environment.isBaseline) "_baseline" else "");
};

const header = std.fmt.comptimePrint(
    "{s}/{c}{s}1",
    .{
        bun.Environment.version_string,
        @intFromEnum(Platform.current),
        if (bun.Environment.git_sha.len > 0) bun.Environment.git_sha[0..7] else "unknown",
    },
);

const EncodeOptions = struct {
    trace: *std.builtin.StackTrace,
    msg: ?[]const u8,
    include_features: bool,
    action: Action,

    const Action = enum {
        /// Open a pre-filled GitHub issue with the expanded trace
        open_issue,
        /// View the trace with nothing else
        view_trace,
    };
};

fn encode(opts: EncodeOptions, writer: anytype) !void {
    try writer.writeAll(report_base_url ++ header);

    const image_path = bun.windows.exePathW();

    for (opts.trace.instruction_addresses[0..opts.trace.index]) |addr| {
        const module = bun.windows.getModuleHandleFromAddress(addr) orelse {
            try writer.writeAll("_");
            continue;
        };
        const base_address = @intFromPtr(module);
        var name_bytes: [512]u16 = undefined;
        var name_bytes_utf8: [1024]u8 = undefined;
        const name = bun.windows.getModuleNameW(module, &name_bytes) orelse {
            try writer.writeAll("_");
            continue;
        };
        if (!std.mem.eql(u16, name, image_path)) {
            try writer.writeAll(comptime one_vlq: {
                const vlq = SourceMap.encodeVLQ(1);
                break :one_vlq vlq.bytes[0..vlq.len];
            });

            const utf8_name = try bun.strings.convertUTF16toUTF8InBuffer(&name_bytes_utf8, name);
            const vlq_name = SourceMap.encodeVLQ(@intCast(utf8_name.len));
            try writer.writeAll(vlq_name.bytes[0..vlq_name.len]);
            try writer.writeAll(utf8_name);
        }

        const offset = addr - base_address;
        const vlq = SourceMap.encodeVLQ(@intCast(offset));
        try writer.writeAll(vlq.bytes[0..vlq.len]);
    }

    try writer.writeAll(comptime zero_vlq: {
        const vlq = SourceMap.encodeVLQ(0);
        break :zero_vlq vlq.bytes[0..vlq.len];
    });

    if (opts.msg) |message| {
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

        try writer.writeAll(b64_bytes[0..b64_len]);
    }

    if (opts.include_features) {
        try writer.writeAll("_");
        //  TODO
    }

    if (opts.action == .view_trace) {
        try writer.writeAll("/view");
    }
}
