const std = @import("std");

fn setup_sigactions(act: ?*const os.Sigaction) !void {
    try os.sigaction(os.SIG.ABRT, act, null);
    try os.sigaction(os.SIG.BUS, act, null);
    try os.sigaction(os.SIG.FPE, act, null);
    try os.sigaction(os.SIG.ILL, act, null);
    try os.sigaction(os.SIG.SEGV, act, null);
    try os.sigaction(os.SIG.TRAP, act, null);
}

const builtin = @import("builtin");
const ErrorCallback = *const fn (sig: i32, addr: usize) void;
var on_error: ?ErrorCallback = null;
noinline fn sigaction_handler(sig: i32, info: *const std.os.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
    // Prevent recursive calls
    setup_sigactions(null) catch unreachable;

    const addr = switch (comptime builtin.target.os.tag) {
        .linux => @ptrToInt(info.fields.sigfault.addr),
        .macos, .freebsd => @ptrToInt(info.addr),
        .netbsd => @ptrToInt(info.info.reason.fault.addr),
        .openbsd => @ptrToInt(info.data.fault.addr),
        .solaris => @ptrToInt(info.reason.fault.addr),
        else => unreachable,
    };
    if (on_error) |handle| handle(sig, addr);
}

noinline fn sigpipe_handler(_: i32, _: *const std.os.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
    const bun = @import("root").bun;
    bun.Output.debug("SIGPIPE received\n", .{});
}

pub fn reloadHandlers() !void {
    try os.sigaction(os.SIG.PIPE, null, null);
    try setup_sigactions(null);

    var act = os.Sigaction{
        .handler = .{ .sigaction = sigaction_handler },
        .mask = os.empty_sigset,
        .flags = (os.SA.SIGINFO | os.SA.RESTART | os.SA.RESETHAND),
    };

    try setup_sigactions(&act);

    bun_ignore_sigpipe();
}
const os = std.os;
pub fn start() !void {
    var act = os.Sigaction{
        .handler = .{ .sigaction = sigaction_handler },
        .mask = os.empty_sigset,
        .flags = (os.SA.SIGINFO | os.SA.RESTART | os.SA.RESETHAND),
    };

    try setup_sigactions(&act);
    bun_ignore_sigpipe();
}

extern fn bun_ignore_sigpipe() void;
