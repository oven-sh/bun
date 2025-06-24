//! A state node which represents the execution of a shell script. This struct
//! is used for both top-level scripts and also expansions (when running a
//! command substitution) and subshells.
pub const Script = @This();

base: State,
node: *const ast.Script,
io: IO,
parent: ParentPtr,
state: union(enum) {
    normal: struct {
        idx: usize = 0,
    },
} = .{ .normal = .{} },

pub const ParentPtr = StatePtrUnion(.{
    Interpreter,
    Expansion,
    Subshell,
});

pub const ChildPtr = struct {
    val: *Stmt,
    pub inline fn init(child: *Stmt) ChildPtr {
        return .{ .val = child };
    }
    pub inline fn deinit(this: ChildPtr) void {
        this.val.deinit();
    }
};

pub fn format(this: *const Script, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try writer.print("Script(0x{x}, stmts={d})", .{ @intFromPtr(this), this.node.stmts.len });
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellState,
    node: *const ast.Script,
    parent_ptr: ParentPtr,
    io: IO,
) *Script {
    const script = interpreter.allocator.create(Script) catch bun.outOfMemory();
    script.* = .{
        .base = .{ .kind = .script, .interpreter = interpreter, .shell = shell_state },
        .node = node,
        .parent = parent_ptr,
        .io = io,
    };
    log("{} init", .{script});
    return script;
}

fn getIO(this: *Script) IO {
    return this.io;
}

pub fn start(this: *Script) Yield {
    if (this.node.stmts.len == 0)
        return this.finish(0);
    return .{ .script = this };
}

pub fn next(this: *Script) Yield {
    switch (this.state) {
        .normal => {
            if (this.state.normal.idx >= this.node.stmts.len) return .suspended;
            const stmt_node = &this.node.stmts[this.state.normal.idx];
            this.state.normal.idx += 1;
            var io = this.getIO();
            var stmt = Stmt.init(this.base.interpreter, this.base.shell, stmt_node, this, io.ref().*);
            return stmt.start();
        },
    }
}

fn finish(this: *Script, exit_code: ExitCode) Yield {
    if (this.parent.ptr.is(Interpreter)) {
        log("Interpreter script finish", .{});
        return this.base.interpreter.childDone(InterpreterChildPtr.init(this), exit_code);
    }

    return this.parent.childDone(this, exit_code);
}

pub fn childDone(this: *Script, child: ChildPtr, exit_code: ExitCode) Yield {
    child.deinit();
    if (this.state.normal.idx >= this.node.stmts.len) {
        return this.finish(exit_code);
    }
    return this.next();
}

pub fn deinit(this: *Script) void {
    log("Script(0x{x}) deinit", .{@intFromPtr(this)});
    this.io.deref();
    if (!this.parent.ptr.is(Interpreter) and !this.parent.ptr.is(Subshell)) {
        // The shell state is owned by the parent when the parent is Interpreter or Subshell
        // Otherwise this Script represents a command substitution which is duped from the parent
        // and must be deinitalized.
        this.base.shell.deinit();
    }

    bun.default_allocator.destroy(this);
}

pub fn deinitFromInterpreter(this: *Script) void {
    log("Script(0x{x}) deinitFromInterpreter", .{@intFromPtr(this)});
    this.io.deinit();
    // Let the interpreter deinitialize the shell state
    // this.base.shell.deinitImpl(false, false);
    bun.default_allocator.destroy(this);
}

const std = @import("std");
const bun = @import("bun");
const Yield = bun.shell.Yield;

const Interpreter = bun.shell.Interpreter;
const InterpreterChildPtr = Interpreter.InterpreterChildPtr;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const ast = bun.shell.AST;
const ExitCode = bun.shell.ExitCode;
const ShellState = Interpreter.ShellState;
const State = bun.shell.Interpreter.State;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;

const Subshell = bun.shell.Interpreter.Subshell;
const Expansion = bun.shell.Interpreter.Expansion;
const Stmt = bun.shell.Interpreter.Stmt;
