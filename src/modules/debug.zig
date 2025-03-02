//! Assertions, panics, and other utilities
const std = @import("std");
const bun = @import("root").bun;

// TODO: isolate from "bun.zig"
const Output = bun.Output;
const Environment = bun.Environment;
const callconv_inline = bun.callconv_inline;

const ASSERTION_FAILURE_MSG = "Internal assertion failure";
noinline fn assertionFailure() noreturn {
    if (@inComptime()) {
        @compileError("assertion failure");
    } else {
        @branchHint(.cold);
        Output.panic(ASSERTION_FAILURE_MSG, .{});
    }
}

noinline fn assertionFailureAtLocation(src: std.builtin.SourceLocation) noreturn {
    if (@inComptime()) {
        @compileError(std.fmt.comptimePrint("assertion failure"));
    } else {
        @branchHint(.cold);
        Output.panic(ASSERTION_FAILURE_MSG ++ "at {s}:{d}:{d}", .{ src.file, src.line, src.column });
    }
}

noinline fn assertionFailureWithMsg(comptime msg: []const u8, args: anytype) noreturn {
    if (@inComptime()) {
        @compileError(std.fmt.comptimePrint("assertion failure: " ++ msg, args));
    } else {
        @branchHint(.cold);
        Output.panic(ASSERTION_FAILURE_MSG ++ ": " ++ msg, .args);
    }
}

/// Like `assert`, but checks only run in debug builds.
///
/// Please wrap expensive checks in an `if` statement.
/// ```zig
/// if (comptime bun.Environment.isDebug) {
///   const expensive = doExpensiveCheck();
///   bun.debug.debugAssert(expensive);
/// }
/// ```
pub fn debugAssert(cheap_value_only_plz: bool) callconv(callconv_inline) void {
    if (comptime !Environment.isDebug) {
        return;
    }

    if (!cheap_value_only_plz) {
        unreachable;
    }
}

/// Asserts that some condition holds. Assertions are stripped in release builds.
///
/// Please use `assertf` in new code.
///
/// Be careful what expressions you pass to this function; if the compiler cannot
/// determine that `ok` has no side effects, the argument expression may not be removed
/// from the binary. This includes calls to extern functions.
///
/// Wrap expensive checks in an `if` statement.
/// ```zig
/// if (comptime bun.Environment.allow_assert) {
///   const expensive = doExpensiveCheck();
///   bun.assert(expensive);
/// }
/// ```
///
/// Use `assertRelease` for assertions that should not be stripped in release builds.
pub fn assert(ok: bool) callconv(callconv_inline) void {
    if (comptime !Environment.allow_assert) {
        return;
    }

    if (!ok) {
        if (comptime Environment.isDebug) unreachable;
        assertionFailure();
    }
}

/// Asserts that some condition holds. Assertions are stripped in release builds.
///
/// Please note that messages will be shown to users in crash reports.
///
/// Be careful what expressions you pass to this function; if the compiler cannot
/// determine that `ok` has no side effects, the argument expression may not be removed
/// from the binary. This includes calls to extern functions.
///
/// Wrap expensive checks in an `if` statement.
/// ```zig
/// if (comptime bun.Environment.allow_assert) {
///   const expensive = doExpensiveCheck();
///   bun.assert(expensive, "Something happened: {}", .{ expensive });
/// }
/// ```
///
/// Use `assertRelease` for assertions that should not be stripped in release builds.
pub fn assertf(ok: bool, comptime format: []const u8, args: anytype) callconv(callconv_inline) void {
    if (comptime !Environment.allow_assert) {
        return;
    }

    if (!ok) {
        if (comptime Environment.isDebug) unreachable;
        assertionFailureWithMsg(format, args);
    }
}

/// Asserts that some condition holds. These assertions are not stripped
/// in any build mode. Use `assert` to have assertions stripped in release
/// builds.
pub fn releaseAssert(ok: bool, comptime msg: []const u8, args: anytype) callconv(callconv_inline) void {
    if (!ok) {
        @branchHint(.unlikely);
        Output.panic(ASSERTION_FAILURE_MSG ++ ": " ++ msg, args);
    }
}

pub fn assertWithLocation(value: bool, src: std.builtin.SourceLocation) callconv(callconv_inline) void {
    if (comptime !Environment.allow_assert) {
        return;
    }

    if (!value) {
        if (comptime Environment.isDebug) unreachable;
        assertionFailureAtLocation(src);
    }
}

/// This has no effect on the real code but capturing 'a' and 'b' into
/// parameters makes assertion failures much easier inspect in a debugger.
pub inline fn assert_eql(a: anytype, b: anytype) void {
    if (@inComptime()) {
        if (a != b) {
            @compileLog(a);
            @compileLog(b);
            @compileError("A != B");
        }
    }
    if (!Environment.allow_assert) return;
    if (a != b) {
        Output.panic("Assertion failure: {any} != {any}", .{ a, b });
    }
}

/// This has no effect on the real code but capturing 'a' and 'b' into
/// parameters makes assertion failures much easier inspect in a debugger.
pub fn assert_neql(a: anytype, b: anytype) callconv(callconv_inline) void {
    return assert(a != b);
}

pub fn unsafeAssert(condition: bool) callconv(callconv_inline) void {
    if (!condition) unreachable;
}

/// Do not use this function, call std.debug.panic directly.
///
/// This function used to panic in debug, and be `unreachable` in release
/// however, if something is possibly reachable, it should not be marked unreachable.
/// It now panics in all release modes.
pub inline fn unreachablePanic(comptime fmts: []const u8, args: anytype) noreturn {
    @branchHint(.cold);
    std.debug.panic(fmts, args);
}

const TODO_LOG = Output.scoped(.TODO, false);
pub inline fn todo(src: std.builtin.SourceLocation, value: anytype) @TypeOf(value) {
    if (comptime Environment.allow_assert) {
        TODO_LOG("{s}() at {s}:{d}:{d}", .{ src.fn_name, src.file, src.line, src.column });
    }

    return value;
}

pub fn todoPanic(src: std.builtin.SourceLocation, comptime format: []const u8, args: anytype) noreturn {
    @branchHint(.cold);
    bun.Analytics.Features.todo_panic = 1;
    Output.panic("TODO: " ++ format ++ " ({s}:{d})", args ++ .{ src.file, src.line });
}
