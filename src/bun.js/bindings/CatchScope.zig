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
/// Pointer to `bytes`, set by `init()`, used to assert that the location did not change
location: if (Environment.allow_assert) *u8 else void,

pub fn init(self: *CatchScope, vm: *jsc.VM, src: std.builtin.SourceLocation) void {
    CatchScope__construct(
        &self.bytes,
        vm,
        src.fn_name,
        src.file,
        src.line,
        @sizeOf(@TypeOf(self.bytes)),
        @typeInfo(CatchScope).@"struct".fields[0].alignment,
    );
    if (Environment.allow_assert) self.location = &self.bytes[0];
}

pub fn hasException(self: *CatchScope) bool {
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    return CatchScope__hasException(&self.bytes);
}

pub fn deinit(self: *CatchScope) void {
    if (Environment.allow_assert) bun.assert(self.location == &self.bytes[0]);
    CatchScope__destruct(&self.bytes);
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
extern fn CatchScope__hasException(ptr: *align(alignment) [size]u8) bool;
extern fn CatchScope__destruct(ptr: *align(alignment) [size]u8) void;

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Environment = bun.Environment;
