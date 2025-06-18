//! Binding for JSC::CatchScope. This should be used rarely, only at translation boundaries between
//! JSC's exception checking and Zig's. Make sure not to move it after creation. For instance:
//!
//! ```zig
//! // Declare a CatchScope surrounding the call that may throw an exception
//! var scope: CatchScope = undefined;
//! scope.init(global, @src(), .assertions_only);
//! defer scope.deinit();
//!
//! const value = external_call(vm, foo, bar, baz);
//! // Calling hasException() suffices to prove that we checked for an exception.
//! // This function's caller does not need to use a CatchScope or ThrowScope
//! // because it can use Zig error unions.
//! if (Environment.allow_assert) assert((value == .zero) == scope.hasException());
//! return if (value == .zero) error.JSError else value;
//! ```

const CatchScope = @This();

/// TODO determine size and alignment automatically
const size = 56;
const alignment = 8;

bytes: [size]u8 align(alignment),
global: *jsc.JSGlobalObject,
/// Pointer to `bytes`, set by `init()`, used to assert that the location did not change
location: if (Environment.allow_assert) *u8 else void,
enabled: bool,

pub const Enable = enum {
    /// You are using the CatchScope to check for exceptions.
    enabled,
    /// You have another way to detect exceptions and are only using the CatchScope to prove that
    /// exceptions are checked.
    ///
    /// This CatchScope will only do anything when assertions are enabled. Otherwise, init and
    /// deinit do nothing and it always reports there is no exception.
    assertions_only,
};

pub fn init(
    self: *CatchScope,
    global: *jsc.JSGlobalObject,
    src: std.builtin.SourceLocation,
    /// If not enabled, the scope does nothing (it never has an exception).
    /// If you need to do something different when there is an exception, leave enabled.
    /// If you are only using the scope to prove you handle exceptions correctly, you can pass
    /// `Environment.allow_assert` as `enabled`.
    enable_condition: Enable,
) void {
    const enabled = switch (enable_condition) {
        .enabled => true,
        .assertions_only => Environment.allow_assert,
    };
    if (enabled) {
        CatchScope__construct(
            &self.bytes,
            global,
            src.fn_name,
            src.file,
            src.line,
            @sizeOf(@TypeOf(self.bytes)),
            @typeInfo(CatchScope).@"struct".fields[0].alignment,
        );
    }
    self.* = .{
        .bytes = self.bytes,
        .global = global,
        .location = if (Environment.allow_assert) &self.bytes[0],
        .enabled = enabled,
    };
}

/// Generate a useful message including where the exception was thrown.
/// Only intended to be called when there is a pending exception.
fn assertionFailure(self: *CatchScope, proof: *jsc.Exception) noreturn {
    _ = proof;
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    CatchScope__assertNoException(&self.bytes);
    @panic("assertionFailure called without a pending exception");
}

pub fn hasException(self: *CatchScope) bool {
    return self.exception() != null;
}

/// Get the thrown exception if it exists (like scope.exception() in C++)
pub fn exception(self: *CatchScope) ?*jsc.Exception {
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    if (!self.enabled) return null;
    return CatchScope__pureException(&self.bytes);
}

/// Get the thrown exception if it exists, or if an unhandled trap causes an exception to be thrown
pub fn exceptionIncludingTraps(self: *CatchScope) ?*jsc.Exception {
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    if (!self.enabled) return null;
    return CatchScope__exceptionIncludingTraps(&self.bytes);
}

/// Intended for use with `try`. Returns if there is already a pending exception or if traps cause
/// an exception to be thrown (this is the same as how RETURN_IF_EXCEPTION behaves in C++)
pub fn returnIfException(self: *CatchScope) bun.JSError!void {
    if (self.exceptionIncludingTraps() != null) return error.JSError;
}

/// Asserts there has not been any exception thrown.
pub fn assertNoException(self: *CatchScope) void {
    if (Environment.allow_assert) {
        if (self.exception()) |e| self.assertionFailure(e);
    }
}

/// Asserts that there is or is not an exception according to the value of `should_have_exception`.
/// Prefer over `assert(scope.hasException() == ...)` because if there is an unexpected exception,
/// this function prints a trace of where it was thrown.
pub fn assertExceptionPresenceMatches(self: *CatchScope, should_have_exception: bool) void {
    if (Environment.allow_assert) {
        // paranoid; will only fail if you manually changed enabled to false
        bun.assert(self.enabled);
        if (should_have_exception) {
            bun.assertf(self.hasException(), "Expected an exception to be thrown", .{});
        } else {
            self.assertNoException();
        }
    }
}

/// If no exception, returns.
/// If termination exception, returns JSExecutionTerminated (so you can `try`)
/// If non-termination exception, assertion failure.
pub fn assertNoExceptionExceptTermination(self: *CatchScope) bun.JSExecutionTerminated!void {
    bun.assert(self.enabled);
    return if (self.exception()) |e|
        if (jsc.JSValue.fromCell(e).isTerminationException(self.global.vm()))
            error.JSExecutionTerminated
        else if (Environment.allow_assert)
            self.assertionFailure(e)
        else
            // we got an exception other than the termination one, but we can't assert.
            // treat this like the termination exception so we still bail out
            error.JSExecutionTerminated
    else {};
}

pub fn deinit(self: *CatchScope) void {
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    if (!self.enabled) return;
    CatchScope__destruct(&self.bytes);
    self.bytes = undefined;
}

extern fn CatchScope__construct(
    ptr: *align(alignment) [size]u8,
    global: *jsc.JSGlobalObject,
    function: [*:0]const u8,
    file: [*:0]const u8,
    line: c_uint,
    size: usize,
    alignment: usize,
) void;
/// only returns exceptions that have already been thrown. does not check traps
extern fn CatchScope__pureException(ptr: *align(alignment) [size]u8) ?*jsc.Exception;
/// returns if an exception was already thrown, or if a trap (like another thread requesting
/// termination) causes an exception to be thrown
extern fn CatchScope__exceptionIncludingTraps(ptr: *align(alignment) [size]u8) ?*jsc.Exception;
extern fn CatchScope__assertNoException(ptr: *align(alignment) [size]u8) void;
extern fn CatchScope__destruct(ptr: *align(alignment) [size]u8) void;

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Environment = bun.Environment;
