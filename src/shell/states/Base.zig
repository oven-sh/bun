//! This is a header struct that all state nodes include
//! in their layout.
//!
//! TODO: Is this still needed?
const Base = @This();

kind: StateKind,
interpreter: *Interpreter,
shell: *ShellState,
__alloc_scope: if (bun.Environment.isDebug) AllocScope else void,

const AllocScope = union(enum) {
    owned: bun.AllocationScope,
    borrowed: *bun.AllocationScope,

    pub fn deinit(this: *AllocScope) void {
        if (comptime bun.Environment.isDebug) {
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
        if (comptime bun.Environment.isDebug) {
            _ = @typeInfo(@TypeOf(memory)).pointer;
            bun.assert(!this.scopedAllocator().trackExternalFree(memory, null));
        }
    }
};

pub fn init(kind: StateKind, interpreter: *Interpreter, shell: *ShellState) Base {
    return .{
        .kind = kind,
        .interpreter = interpreter,
        .shell = shell,
        .__alloc_scope = if (comptime bun.Environment.isDebug) .{ .owned = bun.AllocationScope.init(bun.default_allocator) } else {},
    };
}

pub fn initBorrowedAllocScope(kind: StateKind, interpreter: *Interpreter, shell: *ShellState, scope: if (bun.Environment.isDebug) *bun.AllocationScope else void) Base {
    return .{
        .kind = kind,
        .interpreter = interpreter,
        .shell = shell,
        .__alloc_scope = if (comptime bun.Environment.isDebug) .{ .borrowed = scope } else {},
    };
}

pub fn deinit(this: *Base) void {
    if (comptime bun.Environment.isDebug) {
        this.__alloc_scope.deinit();
    }
}

pub inline fn eventLoop(this: *const Base) JSC.EventLoopHandle {
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
    if (comptime bun.Environment.isDebug) {
        return this.__alloc_scope.allocator();
    }
    return bun.default_allocator;
}

pub fn allocScope(this: *Base) if (bun.Environment.isDebug) *bun.AllocationScope else void {
    if (comptime bun.Environment.isDebug) {
        return switch (this.__alloc_scope) {
            .borrowed => |scope| scope,
            .owned => |*scope| scope,
        };
    }
    return {};
}

/// Stop tracking `memory`
pub fn leakSlice(this: *Base, memory: anytype) void {
    if (comptime bun.Environment.isDebug) {
        this.__alloc_scope.leakSlice(memory);
    }
}

// pub fn scopedAllocator(this: *const Base) bun.AllocationScope {
//     if (comptime bun.Environment.isDebug) {
//         return this.__alloc_scope;
//     }
//     return bun.AllocationScope.init(bun.default_allocator);
// }

const std = @import("std");
const bun = @import("bun");

const Interpreter = bun.shell.Interpreter;
const ShellState = Interpreter.ShellState;
const StateKind = bun.shell.interpret.StateKind;
const throwShellErr = bun.shell.interpret.throwShellErr;
const IO = bun.shell.Interpreter.IO;

const JSC = bun.JSC;
