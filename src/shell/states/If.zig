pub const If = @This();

base: State,
node: *const ast.If,
parent: ParentPtr,
io: IO,
state: union(enum) {
    idle,
    exec: struct {
        state: union(enum) {
            cond,
            then,
            elif: struct {
                idx: u32 = 0,
            },
            @"else",
        },
        stmts: *const SmolList(ast.Stmt, 1),
        stmt_idx: u32 = 0,
        last_exit_code: ExitCode = 0,
    },
    waiting_write_err,
    done,
} = .idle,

pub const ParentPtr = StatePtrUnion(.{
    Stmt,
    Binary,
    Pipeline,
    Async,
});

pub const ChildPtr = StatePtrUnion(.{
    Stmt,
});

pub fn format(this: *const If, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try writer.print("If(0x{x}, state={s})", .{ @intFromPtr(this), @tagName(this.state) });
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellState,
    node: *const ast.If,
    parent: ParentPtr,
    io: IO,
) *If {
    return bun.new(If, .{
        .base = .{ .kind = .cmd, .interpreter = interpreter, .shell = shell_state },
        .node = node,
        .parent = parent,
        .io = io,
    });
}

pub fn start(this: *If) void {
    this.next();
}

fn next(this: *If) void {
    while (this.state != .done) {
        switch (this.state) {
            .idle => {
                this.state = .{ .exec = .{ .state = .cond, .stmts = &this.node.cond } };
            },
            .exec => {
                const stmts = this.state.exec.stmts;
                // Executed all the stmts in the condition/branch
                if (this.state.exec.stmt_idx >= stmts.len()) {
                    switch (this.state.exec.state) {
                        // Move to the then, elif, or else branch based on the exit code
                        // and the amount of else parts
                        .cond => {
                            if (this.state.exec.last_exit_code == 0) {
                                this.state.exec.state = .then;
                                this.state.exec.stmt_idx = 0;
                                this.state.exec.stmts = &this.node.then;
                                continue;
                            }
                            switch (this.node.else_parts.len()) {
                                0 => {
                                    this.parent.childDone(this, 0);
                                    return;
                                },
                                1 => {
                                    this.state.exec.state = .@"else";
                                    this.state.exec.stmt_idx = 0;
                                    this.state.exec.stmts = this.node.else_parts.getConst(0);
                                    continue;
                                },
                                else => {
                                    this.state.exec.state = .{ .elif = .{} };
                                    this.state.exec.stmt_idx = 0;
                                    this.state.exec.stmts = this.node.else_parts.getConst(0);
                                    continue;
                                },
                            }
                        },
                        // done
                        .then => {
                            this.parent.childDone(this, this.state.exec.last_exit_code);
                            return;
                        },
                        // if succesful, execute the elif's then branch
                        // otherwise, move to the next elif, or to the final else if it exists
                        .elif => {
                            if (this.state.exec.last_exit_code == 0) {
                                this.state.exec.stmts = this.node.else_parts.getConst(this.state.exec.state.elif.idx + 1);
                                this.state.exec.stmt_idx = 0;
                                this.state.exec.state = .then;
                                continue;
                            }

                            this.state.exec.state.elif.idx += 2;

                            if (this.state.exec.state.elif.idx >= this.node.else_parts.len()) {
                                this.parent.childDone(this, 0);
                                return;
                            }

                            if (this.state.exec.state.elif.idx == this.node.else_parts.len() -| 1) {
                                this.state.exec.state = .@"else";
                                this.state.exec.stmt_idx = 0;
                                this.state.exec.stmts = this.node.else_parts.lastUncheckedConst();
                                continue;
                            }

                            this.state.exec.stmt_idx = 0;
                            this.state.exec.stmts = this.node.else_parts.getConst(this.state.exec.state.elif.idx);
                            continue;
                        },
                        .@"else" => {
                            this.parent.childDone(this, this.state.exec.last_exit_code);
                            return;
                        },
                    }
                }

                const idx = this.state.exec.stmt_idx;
                this.state.exec.stmt_idx += 1;
                const stmt = this.state.exec.stmts.getConst(idx);
                var newstmt = Stmt.init(this.base.interpreter, this.base.shell, stmt, this, this.io.copy());
                newstmt.start();
                return;
            },
            .waiting_write_err => return, // yield execution
            .done => @panic("This code should not be reachable"),
        }
    }

    this.parent.childDone(this, 0);
}

pub fn deinit(this: *If) void {
    log("{} deinit", .{this});
    this.io.deref();
    bun.destroy(this);
}

pub fn childDone(this: *If, child: ChildPtr, exit_code: ExitCode) void {
    defer child.deinit();

    if (this.state != .exec) {
        @panic("Expected `exec` state in If, this indicates a bug in Bun. Please file a GitHub issue.");
    }

    var exec = &this.state.exec;
    exec.last_exit_code = exit_code;

    switch (exec.state) {
        .cond => this.next(),
        .then => this.next(),
        .elif => {
            // if (exit_code == 0) {
            //     exec.stmts = this.node.else_parts.getConst(exec.state.elif.idx + 1);
            //     exec.state = .then;
            //     exec.stmt_idx = 0;
            //     this.next();
            //     return;
            // }
            this.next();
            return;
        },
        .@"else" => this.next(),
    }
}

const std = @import("std");
const bun = @import("bun");
const shell = bun.shell;

const Allocator = std.mem.Allocator;

const Interpreter = bun.shell.Interpreter;
const InterpreterChildPtr = Interpreter.InterpreterChildPtr;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const ast = bun.shell.AST;
const ExitCode = bun.shell.ExitCode;
const GlobWalker = bun.shell.interpret.GlobWalker;
const ShellState = Interpreter.ShellState;
const StateKind = bun.shell.interpret.StateKind;
const State = bun.shell.Interpreter.State;
const throwShellErr = bun.shell.interpret.throwShellErr;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;
const EnvStr = bun.shell.interpret.EnvStr;
const Pipe = bun.shell.interpret.Pipe;
const closefd = bun.shell.interpret.closefd;
const IOReader = bun.shell.Interpreter.IOReader;
const IOWriter = bun.shell.Interpreter.IOWriter;
const ShellSyscall = bun.shell.interpret.ShellSyscall;

const Assigns = bun.shell.Interpreter.Assigns;
const Script = bun.shell.Interpreter.Script;
const Subshell = bun.shell.Interpreter.Subshell;
const Cmd = bun.shell.Interpreter.Cmd;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Async = bun.shell.Interpreter.Async;
const Binary = bun.shell.Interpreter.Binary;
const Expansion = bun.shell.Interpreter.Expansion;
const Stmt = bun.shell.Interpreter.Stmt;
const Pipeline = bun.shell.Interpreter.Pipeline;

const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const Maybe = JSC.Maybe;
const assert = bun.assert;
const Arena = bun.shell.interpret.Arena;
const Braces = bun.shell.interpret.Braces;
const OOM = bun.shell.interpret.OOM;
const WorkPoolTask = bun.shell.interpret.WorkPoolTask;
const WorkPool = bun.shell.interpret.WorkPool;
const Syscall = bun.shell.interpret.Syscall;
const ShellTask = bun.shell.interpret.ShellTask;
const SmolList = bun.shell.SmolList;

const windows = bun.windows;
const uv = windows.libuv;
