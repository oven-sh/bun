const std = @import("std");
const posix = std.posix;

fn setup_sigactions(act: ?*const posix.Sigaction) !void {
    try posix.sigaction(posix.SIG.ABRT, act, null);
    try posix.sigaction(posix.SIG.BUS, act, null);
    try posix.sigaction(posix.SIG.FPE, act, null);
    try posix.sigaction(posix.SIG.ILL, act, null);
    try posix.sigaction(posix.SIG.SEGV, act, null);
    try posix.sigaction(posix.SIG.TRAP, act, null);
}

const builtin = @import("builtin");
const ErrorCallback = *const fn (sig: i32, addr: usize) void;
pub var on_error: ?ErrorCallback = null;
noinline fn sigaction_handler(sig: i32, info: *const std.posix.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
    // Prevent recursive calls
    setup_sigactions(null) catch unreachable;

    const addr = switch (builtin.target.os.tag) {
        .linux => @intFromPtr(info.fields.sigfault.addr),
        .macos, .freebsd => @intFromPtr(info.addr),
        .netbsd => @intFromPtr(info.info.reason.fault.addr),
        .openbsd => @intFromPtr(info.data.fault.addr),
        .solaris => @intFromPtr(info.reason.fault.addr),
        else => @compileError("unreachable"),
    };
    if (on_error) |handle| handle(sig, addr);
}

noinline fn sigpipe_handler(_: i32, _: *const std.posix.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
    const bun = @import("root").bun;
    bun.Output.debug("SIGPIPE received\n", .{});
}

pub fn reloadHandlers() !void {
    if (comptime @import("root").bun.Environment.isWindows) {
        return @import("root").bun.todo(@src(), {});
    }
    try posix.sigaction(posix.SIG.PIPE, null, null);
    try setup_sigactions(null);

    var act = posix.Sigaction{
        .handler = .{ .sigaction = sigaction_handler },
        .mask = posix.empty_sigset,
        .flags = (posix.SA.SIGINFO | posix.SA.RESTART | posix.SA.RESETHAND),
    };

    try setup_sigactions(&act);
    @import("root").bun.spawn.WaiterThread.reloadHandlers();
    bun_ignore_sigpipe();
}
pub fn start() !void {
    var act = posix.Sigaction{
        .handler = .{ .sigaction = sigaction_handler },
        .mask = posix.empty_sigset,
        .flags = (posix.SA.SIGINFO | posix.SA.RESTART | posix.SA.RESETHAND),
    };

    try setup_sigactions(&act);
    bun_ignore_sigpipe();
    @import("root").bun.spawn.WaiterThread.reloadHandlers();
}

extern fn bun_ignore_sigpipe() void;
