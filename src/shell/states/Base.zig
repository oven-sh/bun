//! This is the base header struct that all state nodes include in their layout.
//!
//! TODO: Is this still needed?

const Base = @This();

kind: StateKind,
interpreter: *Interpreter,
/// This type is borrowed or owned in specific cases. This affects whether or
/// not this state node should be responsible for deinitializing this
/// `*ShellExecEnv`.
///
/// Q: When is this the `shell: *ShellExecEnv` field owned?
/// A: When we must create a new shell execution environment. This is
///    essentially all locations where `shell.dupeForSubshell(...)` is called:
///
///    1. A `Script` owns it's shell execution environment
///    2. Each command in a pipeline is executed in it's own shell execution
///       environment.
///    3. Subshells
///    4. Command substitutions
///
/// When `shell: *ShellExecEnv` is owned it must be deinitialized. That is why you
/// only see `this.base.shell.deinit()` in `Script`, `Subshell`, and the
/// children of a `Pipeline`.
shell: *ShellExecEnv,
__alloc_scope: if (bun.Environment.enableAllocScopes) AllocScope else void,

const AllocScope = union(enum) {
    owned: bun.AllocationScope,
    borrowed: *bun.AllocationScope,

    pub fn deinit(this: *AllocScope) void {
        if (comptime bun.Environment.enableAllocScopes) {
            if (this.* == .owned) this.owned.deinit();
        }
    }

    pub fn allocator(this: *AllocScope) std.mem.Allocator {
        return switch (this.*) {
            .borrowed => |scope| scope.allocator(),
            .owned => |*scope| scope.allocator(),
        };
    }

    pub fn scopedAllocator(this: *AllocScope) *bun.AllocationScope {
        return switch (this.*) {
            .borrowed => |scope| scope,
            .owned => |*scope| scope,
        };
    }

    pub fn leakSlice(this: *AllocScope, memory: anytype) void {
        if (comptime bun.Environment.enableAllocScopes) {
            _ = @typeInfo(@TypeOf(memory)).pointer;
            this.scopedAllocator().trackExternalFree(memory, null) catch |err|
                std.debug.panic("invalid free: {}", .{err});
        }
    }
};

/// Creates a _new_ allocation scope for this state node.
pub fn initWithNewAllocScope(kind: StateKind, interpreter: *Interpreter, shell: *ShellExecEnv) Base {
    return .{
        .kind = kind,
        .interpreter = interpreter,
        .shell = shell,
        .__alloc_scope = if (comptime bun.Environment.enableAllocScopes) .{ .owned = bun.AllocationScope.init(bun.default_allocator) } else {},
    };
}

/// This will use the allocation scope provided by `scope`
pub fn initBorrowedAllocScope(kind: StateKind, interpreter: *Interpreter, shell: *ShellExecEnv, scope: if (bun.Environment.enableAllocScopes) *bun.AllocationScope else void) Base {
    return .{
        .kind = kind,
        .interpreter = interpreter,
        .shell = shell,
        .__alloc_scope = if (comptime bun.Environment.enableAllocScopes) .{ .borrowed = scope } else {},
    };
}

/// This ends the allocation scope associated with this state node.
///
/// If the allocation scope is borrowed from the parent, this does nothing.
///
/// This also does nothing in release builds.
pub fn endScope(this: *Base) void {
    if (comptime bun.Environment.enableAllocScopes) {
        this.__alloc_scope.deinit();
    }
}

pub inline fn eventLoop(this: *const Base) jsc.EventLoopHandle {
    return this.interpreter.event_loop;
}

/// FIXME: We should get rid of this
pub fn throw(this: *const Base, err: *const bun.shell.ShellErr) void {
    throwShellErr(err, this.eventLoop()) catch {}; //TODO:
}

pub fn rootIO(this: *const Base) *const IO {
    return this.interpreter.rootIO();
}

pub fn allocator(this: *Base) std.mem.Allocator {
    if (comptime bun.Environment.enableAllocScopes) {
        return this.__alloc_scope.allocator();
    }
    return bun.default_allocator;
}

pub fn allocScope(this: *Base) if (bun.Environment.enableAllocScopes) *bun.AllocationScope else void {
    if (comptime bun.Environment.enableAllocScopes) {
        return switch (this.__alloc_scope) {
            .borrowed => |scope| scope,
            .owned => |*scope| scope,
        };
    }
    return {};
}

/// Stop tracking `memory`
pub fn leakSlice(this: *Base, memory: anytype) void {
    if (comptime bun.Environment.enableAllocScopes) {
        this.__alloc_scope.leakSlice(memory);
    }
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const Interpreter = bun.shell.Interpreter;
const IO = bun.shell.Interpreter.IO;
const ShellExecEnv = Interpreter.ShellExecEnv;

const StateKind = bun.shell.interpret.StateKind;
const throwShellErr = bun.shell.interpret.throwShellErr;
