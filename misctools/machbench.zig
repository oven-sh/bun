// most of this file is copy pasted from other files in misctools
const std = @import("std");
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
const clap = @import("../src/deps/zig-clap/clap.zig");

const URL = @import("../src/url.zig").URL;
const Headers = bun.http.Headers;
const Method = @import("../src/http/method.zig").Method;
const ColonListType = @import("../src/cli/colon_list_type.zig").ColonListType;
const HeadersTuple = ColonListType(string, noop_resolver);
const path_handler = @import("../src/resolver/resolve_path.zig");
const NetworkThread = bun.http.NetworkThread;
const HTTP = bun.http;
fn noop_resolver(in: string) !string {
    return in;
}

var waker: bun.Async.Waker = undefined;

fn spamMe(count: usize) void {
    Output.Source.configureNamedThread("1");
    defer Output.flush();
    var timer = std.time.Timer.start() catch unreachable;

    var i: usize = 0;
    while (i < count) : (i += 1) {
        waker.wake() catch unreachable;
    }
    Output.prettyErrorln("[EVFILT_MACHPORT] Sent {any}", .{bun.fmt.fmtDuration(timer.read())});
}
const thread_count = 1;
pub fn machMain(runs: usize) anyerror!void {
    defer Output.flush();
    waker = try bun.Async.Waker.init(bun.default_allocator);

    var args = try std.process.argsAlloc(bun.default_allocator);
    const count = std.fmt.parseInt(usize, args[args.len - 1], 10) catch 1024;
    var elapsed: u64 = 0;

    var remaining_runs: usize = runs;
    while (remaining_runs > 0) : (remaining_runs -= 1) {
        var threads: [thread_count]std.Thread = undefined;
        var j: usize = 0;
        while (j < thread_count) : (j += 1) {
            threads[j] = try std.Thread.spawn(.{}, spamMe, .{count});
        }

        var timer = try std.time.Timer.start();
        var i: usize = 0;
        while (i < count * thread_count) : (i += 1) {
            i += try waker.wait();
        }

        j = 0;
        while (j < thread_count) : (j += 1) {
            threads[j].join();
        }
        elapsed += timer.read();
    }

    Output.prettyErrorln("[EVFILT_MACHPORT] Recv {any}", .{bun.fmt.fmtDuration(elapsed)});
}
var user_waker: bun.Async.UserFilterWaker = undefined;

fn spamMeUserFilter(count: usize) void {
    Output.Source.configureNamedThread("2");
    defer Output.flush();
    var timer = std.time.Timer.start() catch unreachable;
    var i: usize = 0;
    while (i < count * thread_count) : (i += 1) {
        user_waker.wake() catch unreachable;
    }

    Output.prettyErrorln("[EVFILT_USER]     Sent {any}", .{bun.fmt.fmtDuration(timer.read())});
}
pub fn userMain(runs: usize) anyerror!void {
    defer Output.flush();
    user_waker = try bun.Async.UserFilterWaker.init(bun.default_allocator);

    var args = try std.process.argsAlloc(bun.default_allocator);
    const count = std.fmt.parseInt(usize, args[args.len - 1], 10) catch 1024;
    var remaining_runs = runs;
    var elapsed: u64 = 0;

    while (remaining_runs > 0) : (remaining_runs -= 1) {
        var threads: [thread_count]std.Thread = undefined;
        var j: usize = 0;
        while (j < thread_count) : (j += 1) {
            threads[j] = try std.Thread.spawn(.{}, spamMeUserFilter, .{count});
        }

        var timer = try std.time.Timer.start();
        var i: usize = 0;
        while (i < count) {
            i += try user_waker.wait();
        }

        j = 0;
        while (j < thread_count) : (j += 1) {
            threads[j].join();
        }
        elapsed += timer.read();
    }

    Output.prettyErrorln("[EVFILT_USER]     Recv {any}", .{bun.fmt.fmtDuration(elapsed)});
    Output.flush();
}

pub fn main() anyerror!void {
    var stdout_ = std.io.getStdOut();
    var stderr_ = std.io.getStdErr();
    var output_source = Output.Source.init(stdout_, stderr_);
    Output.Source.set(&output_source);

    var args = try std.process.argsAlloc(bun.default_allocator);
    const count = std.fmt.parseInt(usize, args[args.len - 1], 10) catch 1024;
    Output.prettyErrorln("For {d} messages and {d} threads:", .{ count, thread_count });
    Output.flush();
    defer Output.flush();
    const runs = if (std.posix.getenv("RUNS")) |run_count| try std.fmt.parseInt(usize, run_count, 10) else 1;

    if (std.posix.getenv("NO_MACH") == null)
        try machMain(runs);

    if (std.posix.getenv("NO_USER") == null)
        try userMain(runs);
}
