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

pub fn start(this: *If) Yield {
    return .{ .@"if" = this };
}

pub fn next(this: *If) Yield {
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
                                    return this.parent.childDone(this, 0);
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
                            return this.parent.childDone(this, this.state.exec.last_exit_code);
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
                                return this.parent.childDone(this, 0);
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
                            return this.parent.childDone(this, this.state.exec.last_exit_code);
                        },
                    }
                }

                const idx = this.state.exec.stmt_idx;
                this.state.exec.stmt_idx += 1;
                const stmt = this.state.exec.stmts.getConst(idx);
                var newstmt = Stmt.init(this.base.interpreter, this.base.shell, stmt, this, this.io.copy());
                return newstmt.start();
            },
            .waiting_write_err => return .suspended, // yield execution
            .done => @panic("This code should not be reachable"),
        }
    }

    return this.parent.childDone(this, 0);
}

pub fn deinit(this: *If) void {
    log("{} deinit", .{this});
    this.io.deref();
    bun.destroy(this);
}

pub fn childDone(this: *If, child: ChildPtr, exit_code: ExitCode) Yield {
    defer child.deinit();

    if (this.state != .exec) {
        @panic("Expected `exec` state in If, this indicates a bug in Bun. Please file a GitHub issue.");
    }

    var exec = &this.state.exec;
    exec.last_exit_code = exit_code;

    switch (exec.state) {
        .cond => return .{ .@"if" = this },
        .then => return .{ .@"if" = this },
        .elif => {
            // if (exit_code == 0) {
            //     exec.stmts = this.node.else_parts.getConst(exec.state.elif.idx + 1);
            //     exec.state = .then;
            //     exec.stmt_idx = 0;
            //     this.next();
            //     return;
            // }
            return .{ .@"if" = this };
        },
        .@"else" => return .{ .@"if" = this },
    }
}

const std = @import("std");
const bun = @import("bun");
const Yield = bun.shell.Yield;
const shell = bun.shell;

const Interpreter = bun.shell.Interpreter;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const ast = bun.shell.AST;
const ExitCode = bun.shell.ExitCode;
const ShellState = Interpreter.ShellState;
const State = bun.shell.Interpreter.State;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;

const Async = bun.shell.Interpreter.Async;
const Binary = bun.shell.Interpreter.Binary;
const Stmt = bun.shell.Interpreter.Stmt;
const Pipeline = bun.shell.Interpreter.Pipeline;

const SmolList = bun.shell.SmolList;
