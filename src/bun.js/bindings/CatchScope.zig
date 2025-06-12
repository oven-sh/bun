//! Binding for JSC::CatchScope. This should be used rarely, only at translation boundaries between
//! JSC's exception checking and Zig's. Make sure not to move it after creation. For instance:
//!
//! ```zig
//! // Declare a CatchScope surrounding the call that may throw an exception
//! var scope: CatchScope = undefined;
//! scope.init(vm, @src());
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
/// do not merge this struct with a manual size and alignment!
const size = 56;
const alignment = 8;

bytes: [size]u8 align(alignment),
vm: *jsc.VM,
/// Pointer to `bytes`, set by `init()`, used to assert that the location did not change
location: if (Environment.allow_assert) *u8 else void,
enabled: bool,

pub fn init(
    self: *CatchScope,
    vm: *jsc.VM,
    src: std.builtin.SourceLocation,
    /// If not enabled, the scope does nothing (it never has an exception).
    /// If you need to do something different when there is an exception, leave enabled.
    /// If you are only using the scope to prove you handle exceptions correctly, you can pass
    /// `Environment.allow_assert` as `enabled`.
    enabled: bool,
) void {
    if (enabled) {
        CatchScope__construct(
            &self.bytes,
            vm,
            src.fn_name,
            src.file,
            src.line,
            @sizeOf(@TypeOf(self.bytes)),
            @typeInfo(CatchScope).@"struct".fields[0].alignment,
        );
    }
    self.* = .{
        .bytes = self.bytes,
        .vm = vm,
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

pub fn exception(self: *CatchScope) ?*jsc.Exception {
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    if (!self.enabled) return null;
    return CatchScope__exception(&self.bytes);
}

pub fn zigError(self: *CatchScope) ?bun.JSError {
    return if (self.hasException()) error.JSError else null;
}

/// If no exception, returns.
/// If termination exception, returns JSExecutionTerminated (so you can `try`)
/// If non-termination exception, assertion failure.
pub fn assertNoExceptionExceptTermination(self: *CatchScope) bun.JSExecutionTerminated!void {
    return if (self.exception()) |e|
        if (jsc.JSValue.fromCell(e).isTerminationException(self.vm))
            error.JSExecutionTerminated
        else
            self.assertionFailure(e)
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
    vm: *jsc.VM,
    function: [*:0]const u8,
    file: [*:0]const u8,
    line: c_uint,
    size: usize,
    alignment: usize,
) void;
extern fn CatchScope__exception(ptr: *align(alignment) [size]u8) ?*jsc.Exception;
extern fn CatchScope__assertNoException(ptr: *align(alignment) [size]u8) void;
extern fn CatchScope__destruct(ptr: *align(alignment) [size]u8) void;

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Environment = bun.Environment;
