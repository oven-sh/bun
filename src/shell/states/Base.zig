//! This is a header struct that all state nodes include
//! in their layout.
//!
//! TODO: Is this still needed?
const Base = @This();

kind: StateKind,
interpreter: *Interpreter,
shell: *ShellState,

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

const bun = @import("bun");

const Interpreter = bun.shell.Interpreter;
const ShellState = Interpreter.ShellState;
const StateKind = bun.shell.interpret.StateKind;
const throwShellErr = bun.shell.interpret.throwShellErr;
const IO = bun.shell.Interpreter.IO;

const JSC = bun.JSC;
