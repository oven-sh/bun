const Environment = @import("../env.zig");
pub const backtrace_state = struct_backtrace_state;
pub const struct_backtrace_state = opaque {};
pub const backtrace_error_callback = ?fn (
    ?*anyopaque,
    [*c]const u8,
    c_int,
) callconv(.C) void;
pub extern fn backtrace_create_state(
    filename: [*c]const u8,
    threaded: c_int,
    error_callback: backtrace_error_callback,
    data: ?*anyopaque,
) ?*struct_backtrace_state;
pub const backtrace_full_callback = ?fn (
    ?*anyopaque,
    usize,
    [*c]const u8,
    c_int,
    [*c]const u8,
) callconv(.C) c_int;
pub extern fn backtrace_full(
    state: ?*struct_backtrace_state,
    skip: c_int,
    callback: backtrace_full_callback,
    error_callback: backtrace_error_callback,
    data: ?*anyopaque,
) c_int;
pub const backtrace_simple_callback = ?fn (?*anyopaque, usize) callconv(.C) c_int;
pub extern fn backtrace_simple(
    state: ?*struct_backtrace_state,
    skip: c_int,
    callback: backtrace_simple_callback,
    error_callback: backtrace_error_callback,
    data: ?*anyopaque,
) c_int;
pub extern fn backtrace_print(state: ?*struct_backtrace_state, skip: c_int, [*c]anyopaque) void;
pub extern fn backtrace_pcinfo(
    state: ?*struct_backtrace_state,
    pc: usize,
    callback: backtrace_full_callback,
    error_callback: backtrace_error_callback,
    data: ?*anyopaque,
) c_int;
pub const backtrace_syminfo_callback = ?fn (?*anyopaque, usize, [*c]const u8, usize, usize) callconv(.C) void;
pub extern fn backtrace_syminfo(
    state: ?*struct_backtrace_state,
    addr: usize,
    callback: backtrace_syminfo_callback,
    error_callback: backtrace_error_callback,
    data: ?*anyopaque,
) c_int;

pub const BACKTRACE_SUPPORTED = @as(c_int, 1);
pub const BACKTRACE_USES_MALLOC = @as(c_int, 0);
pub const BACKTRACE_SUPPORTS_THREADS = @as(c_int, 1);
pub const BACKTRACE_SUPPORTS_DATA = @as(c_int, 1);

fn error_callback(data: *anyopaque, msg: [*c]u8, errnum: c_int) callconv(.C) void {
    _ = data;
    _ = msg;
    _ = errnum;
}

pub const StackFrame = struct {
    pc: usize,
    filename: []const u8,
    function_name: []const u8,
    line_number: c_int,
};

pub const PrintCallback = fn (ctx: ?*anyopaque, frame: StackFrame) void;

var callback: PrintCallback = undefined;
var callback_ctx: ?*anyopaque = null;

const std = @import("std");

noinline fn full_callback(_: ?*anyopaque, pc: usize, filename: [*c]const u8, line_number: c_int, function_name: [*c]const u8) callconv(.C) c_int {
    var stack_frame = StackFrame{
        .pc = pc,
        .line_number = line_number,
        .function_name = if (function_name) |fn_| std.mem.span(fn_) else "",
        .filename = if (filename) |fn_| std.mem.span(fn_) else "",
    };
    callback(callback_ctx, stack_frame);
    return 0;
}

var state: ?*backtrace_state = null;
pub inline fn print() void {
    if (Environment.isMac) return;
    state = backtrace_create_state(null, BACKTRACE_SUPPORTS_THREADS, null, null);
    _ = backtrace_full(state, 2, full_callback, null, null);
}

const builtin = @import("builtin");
const ErrorCallback = fn (sig: i32, addr: usize) void;
var on_error: ?ErrorCallback = null;
noinline fn sigaction_handler(sig: i32, info: *const std.os.siginfo_t, _: ?*const anyopaque) callconv(.C) void {
    // Prevent recursive calls
    os.sigaction(os.SIG.ABRT, null, null);
    os.sigaction(os.SIG.BUS, null, null);
    os.sigaction(os.SIG.FPE, null, null);
    os.sigaction(os.SIG.ILL, null, null);
    os.sigaction(os.SIG.SEGV, null, null);
    os.sigaction(os.SIG.TRAP, null, null);

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

pub fn reloadHandlers() void {
    os.sigaction(os.SIG.ABRT, null, null);
    os.sigaction(os.SIG.BUS, null, null);
    os.sigaction(os.SIG.FPE, null, null);
    os.sigaction(os.SIG.ILL, null, null);
    os.sigaction(os.SIG.SEGV, null, null);
    os.sigaction(os.SIG.TRAP, null, null);

    var act = os.Sigaction{
        .handler = .{ .sigaction = sigaction_handler },
        .mask = os.empty_sigset,
        .flags = (os.SA.SIGINFO | os.SA.RESTART | os.SA.RESETHAND),
    };

    os.sigaction(os.SIG.ABRT, &act, null);
    os.sigaction(os.SIG.BUS, &act, null);
    os.sigaction(os.SIG.FPE, &act, null);
    os.sigaction(os.SIG.ILL, &act, null);
    os.sigaction(os.SIG.SEGV, &act, null);
    os.sigaction(os.SIG.TRAP, &act, null);
}
const os = std.os;
pub fn start(ctx: ?*anyopaque, callback_: PrintCallback, onError: ErrorCallback) void {
    callback_ctx = ctx;
    callback = callback_;
    on_error = onError;

    var act = os.Sigaction{
        .handler = .{ .sigaction = sigaction_handler },
        .mask = os.empty_sigset,
        .flags = (os.SA.SIGINFO | os.SA.RESTART | os.SA.RESETHAND),
    };

    os.sigaction(os.SIG.ABRT, &act, null);
    os.sigaction(os.SIG.BUS, &act, null);
    os.sigaction(os.SIG.FPE, &act, null);
    os.sigaction(os.SIG.ILL, &act, null);
    os.sigaction(os.SIG.SEGV, &act, null);
    os.sigaction(os.SIG.TRAP, &act, null);
}
