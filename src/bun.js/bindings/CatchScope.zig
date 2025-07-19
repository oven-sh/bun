// TODO determine size and alignment automatically
const size = 56;
const alignment = 8;

/// Binding for JSC::CatchScope. This should be used rarely, only at translation boundaries between
/// JSC's exception checking and Zig's. Make sure not to move it after creation. Use this if you are
/// making an external call that has no other way to indicate an exception.
///
/// ```zig
/// // Declare a CatchScope surrounding the call that may throw an exception
/// var scope: CatchScope = undefined;
/// scope.init(global, @src());
/// defer scope.deinit();
///
/// const value: i32 = external_call(vm, foo, bar, baz);
/// // Calling returnIfException() suffices to prove that we checked for an exception.
/// // This function's caller does not need to use a CatchScope or ThrowScope
/// // because it can use Zig error unions.
/// try scope.returnIfException();
/// return value;
/// ```
pub const CatchScope = struct {
    bytes: [size]u8 align(alignment),
    /// Pointer to `bytes`, set by `init()`, used to assert that the location did not change
    location: if (Environment.ci_assert) *u8 else void,

    pub fn init(
        self: *CatchScope,
        global: *jsc.JSGlobalObject,
        src: std.builtin.SourceLocation,
    ) void {
        CatchScope__construct(
            &self.bytes,
            global,
            src.fn_name,
            src.file,
            src.line,
            size,
            alignment,
        );

        self.* = .{
            .bytes = self.bytes,
            .location = if (Environment.ci_assert) &self.bytes[0],
        };
    }

    /// Generate a useful message including where the exception was thrown.
    /// Only intended to be called when there is a pending exception.
    fn assertionFailure(self: *CatchScope, proof: *jsc.Exception) noreturn {
        _ = proof;
        bun.assert(self.location == &self.bytes[0]);
        CatchScope__assertNoException(&self.bytes);
        @panic("assertionFailure called without a pending exception");
    }

    pub fn hasException(self: *CatchScope) bool {
        return self.exception() != null;
    }

    /// Get the thrown exception if it exists (like scope.exception() in C++)
    pub fn exception(self: *CatchScope) ?*jsc.Exception {
        if (comptime Environment.ci_assert) bun.assert(self.location == &self.bytes[0]);
        return CatchScope__pureException(&self.bytes);
    }

    pub fn clearException(self: *CatchScope) void {
        if (comptime Environment.ci_assert) bun.assert(self.location == &self.bytes[0]);
        return CatchScope__clearException(&self.bytes);
    }

    /// Get the thrown exception if it exists, or if an unhandled trap causes an exception to be thrown
    pub fn exceptionIncludingTraps(self: *CatchScope) ?*jsc.Exception {
        if (comptime Environment.ci_assert) bun.assert(self.location == &self.bytes[0]);
        return CatchScope__exceptionIncludingTraps(&self.bytes);
    }

    /// Intended for use with `try`. Returns if there is already a pending exception or if traps cause
    /// an exception to be thrown (this is the same as how RETURN_IF_EXCEPTION behaves in C++)
    pub fn returnIfException(self: *CatchScope) bun.JSError!void {
        if (self.exceptionIncludingTraps() != null) return error.JSError;
    }

    /// Asserts there has not been any exception thrown.
    pub fn assertNoException(self: *CatchScope) void {
        if (comptime Environment.ci_assert) {
            if (self.exception()) |e| self.assertionFailure(e);
        }
    }

    /// Asserts that there is or is not an exception according to the value of `should_have_exception`.
    /// Prefer over `assert(scope.hasException() == ...)` because if there is an unexpected exception,
    /// this function prints a trace of where it was thrown.
    pub fn assertExceptionPresenceMatches(self: *CatchScope, should_have_exception: bool) void {
        if (comptime Environment.ci_assert) {
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
        if (self.exception()) |e| {
            if (jsc.JSValue.fromCell(e).isTerminationException())
                return error.JSExecutionTerminated
            else if (comptime Environment.ci_assert)
                self.assertionFailure(e);
            // Unconditionally panicking here is worse for our users.
        }
    }

    pub fn deinit(self: *CatchScope) void {
        if (comptime Environment.ci_assert) bun.assert(self.location == &self.bytes[0]);
        CatchScope__destruct(&self.bytes);
        self.bytes = undefined;
    }
};

/// Limited subset of CatchScope functionality, for when you have a different way to detect
/// exceptions and you only need a CatchScope to prove that you are checking exceptions correctly.
/// Gated by `Environment.ci_assert`.
///
/// ```zig
/// var scope: ExceptionValidationScope = undefined;
/// // these do nothing when ci_assert == false
/// scope.init(global, @src());
/// defer scope.deinit();
///
/// const maybe_empty: JSValue = externalFunction(global, foo, bar, baz);
/// // does nothing when ci_assert == false
/// // with assertions on, this call serves as proof that you checked for an exception
/// scope.assertExceptionPresenceMatches(maybe_empty == .zero);
/// // you decide whether to return JSError using the return value instead of the scope
/// return if (value == .zero) error.JSError else value;
/// ```
pub const ExceptionValidationScope = struct {
    scope: if (Environment.ci_assert) CatchScope else void,

    pub fn init(
        self: *ExceptionValidationScope,
        global: *jsc.JSGlobalObject,
        src: std.builtin.SourceLocation,
    ) void {
        if (Environment.ci_assert) self.scope.init(global, src);
    }

    /// Asserts there has not been any exception thrown.
    pub fn assertNoException(self: *ExceptionValidationScope) void {
        if (Environment.ci_assert) {
            self.scope.assertNoException();
        }
    }

    /// Asserts that there is or is not an exception according to the value of `should_have_exception`.
    /// Prefer over `assert(scope.hasException() == ...)` because if there is an unexpected exception,
    /// this function prints a trace of where it was thrown.
    pub fn assertExceptionPresenceMatches(self: *ExceptionValidationScope, should_have_exception: bool) void {
        if (Environment.ci_assert) {
            self.scope.assertExceptionPresenceMatches(should_have_exception);
        }
    }

    /// If no exception, returns.
    /// If termination exception, returns JSExecutionTerminated (so you can `try`)
    /// If non-termination exception, assertion failure.
    pub fn assertNoExceptionExceptTermination(self: *ExceptionValidationScope) bun.JSExecutionTerminated!void {
        if (Environment.ci_assert) {
            return self.scope.assertNoExceptionExceptTermination();
        }
    }

    /// Inconveniently named on purpose; this is only needed for some weird edge cases
    pub fn hasExceptionOrFalseWhenAssertionsAreDisabled(self: *ExceptionValidationScope) bool {
        return if (Environment.ci_assert) self.scope.hasException() else false;
    }

    pub fn deinit(self: *ExceptionValidationScope) void {
        if (Environment.ci_assert) self.scope.deinit();
    }
};

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
extern fn CatchScope__clearException(ptr: *align(alignment) [size]u8) void;
/// returns if an exception was already thrown, or if a trap (like another thread requesting
/// termination) causes an exception to be thrown
extern fn CatchScope__exceptionIncludingTraps(ptr: *align(alignment) [size]u8) ?*jsc.Exception;
extern fn CatchScope__assertNoException(ptr: *align(alignment) [size]u8) void;
extern fn CatchScope__destruct(ptr: *align(alignment) [size]u8) void;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
