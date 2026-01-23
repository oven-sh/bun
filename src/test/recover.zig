// Copyright © 2024 Dimitris Dinodimos.

//! Panic recover.
//! Regains control of the calling thread when the function panics or behaves
//! undefined.

const Context = if (builtin.os.tag == .windows)
    std.os.windows.CONTEXT
else if (builtin.os.tag == .linux and builtin.abi == .musl)
    musl.jmp_buf
else
    std.c.ucontext_t;

threadlocal var top_ctx: ?*const Context = null;

/// Returns if there was no recover call in current thread.
/// Otherwise, does not return and execution continues from the current thread
/// recover call.
/// Call from root source file panic handler.
pub fn panicked() void {
    if (top_ctx) |ctx| {
        setContext(ctx);
    }
}

// comptime function that extends T by combining its error set with error.Panic
fn ExtErrType(T: type) type {
    const E = error{Panic};
    const info = @typeInfo(T);
    if (info != .error_union) {
        return E!T;
    }
    return (info.error_union.error_set || E)!(info.error_union.payload);
}

// comptime function that returns the return type of function `func`
fn ReturnType(func: anytype) type {
    const ti = @typeInfo(@TypeOf(func));
    return ti.@"fn".return_type.?;
}

pub fn callForTest(
    test_func: *const fn () anyerror!void,
) anyerror!void {
    const prev_ctx: ?*const Context = top_ctx;
    var ctx: Context = std.mem.zeroes(Context);
    getContext(&ctx);
    if (top_ctx != prev_ctx) {
        top_ctx = prev_ctx;
        return error.Panic;
    }
    top_ctx = &ctx;
    defer top_ctx = prev_ctx;
    return @call(.auto, test_func, .{});
}

/// Calls `func` with `args`, guarding from runtime errors.
/// Returns `error.Panic` when recovers from runtime error.
/// Otherwise returns the return value of func.
pub fn call(
    func: anytype,
    args: anytype,
) ExtErrType(ReturnType(func)) {
    const prev_ctx: ?*const Context = top_ctx;
    var ctx: Context = std.mem.zeroes(Context);
    getContext(&ctx);
    if (top_ctx != prev_ctx) {
        top_ctx = prev_ctx;
        return error.Panic;
    }
    top_ctx = &ctx;
    defer top_ctx = prev_ctx;
    return @call(.auto, func, args);
}

// windows
extern "ntdll" fn RtlRestoreContext(
    ContextRecord: *const CONTEXT,
    ExceptionRecord: ?*const EXCEPTION_RECORD,
) callconv(.winapi) noreturn;

// darwin, bsd, gnu linux
extern "c" fn setcontext(ucp: *const std.c.ucontext_t) noreturn;

// linux musl
const musl = struct {
    const jmp_buf = @cImport(@cInclude("setjmp.h")).jmp_buf;
    extern fn setjmp(env: *jmp_buf) c_int;
    extern fn longjmp(env: *const jmp_buf, val: c_int) noreturn;
};

inline fn getContext(ctx: *Context) void {
    if (builtin.os.tag == .windows) {
        std.os.windows.ntdll.RtlCaptureContext(ctx);
    } else if (builtin.os.tag == .linux and builtin.abi == .musl) {
        _ = musl.setjmp(ctx);
    } else {
        _ = std.debug.getContext(ctx);
    }
}

inline fn setContext(ctx: *const Context) noreturn {
    if (builtin.os.tag == .windows) {
        RtlRestoreContext(ctx, null);
    } else if (builtin.os.tag == .linux and builtin.abi == .musl) {
        musl.longjmp(ctx, 1);
    } else {
        setcontext(ctx);
    }
}

/// Panic handler that if there is a recover call in current thread continues
/// from recover call. Otherwise calls the default panic.
/// Install at root source file as `pub const panic = @import("recover").panic;`
pub const panic: type = std.debug.FullPanic(
    struct {
        pub fn panic(
            msg: []const u8,
            first_trace_addr: ?usize,
        ) noreturn {
            panicked();
            std.debug.defaultPanic(msg, first_trace_addr);
        }
    }.panic,
);

const builtin = @import("builtin");
const std = @import("std");

const CONTEXT = std.os.windows.CONTEXT;
const EXCEPTION_RECORD = std.os.windows.EXCEPTION_RECORD;
