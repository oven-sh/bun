pub const Stmt = @This();

base: State,
node: *const ast.Stmt,
parent: ParentPtr,
idx: usize,
last_exit_code: ?ExitCode,
currently_executing: ?ChildPtr,
io: IO,

pub const ParentPtr = StatePtrUnion(.{
    Script,
    If,
});

pub const ChildPtr = StatePtrUnion(.{
    Async,
    Binary,
    Pipeline,
    Cmd,
    Assigns,
    If,
    CondExpr,
    Subshell,
});

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellExecEnv,
    node: *const ast.Stmt,
    parent: anytype,
    io: IO,
) *Stmt {
    const parent_ptr = switch (@TypeOf(parent)) {
        ParentPtr => parent,
        else => ParentPtr.init(parent),
    };
    var script = parent_ptr.create(Stmt);
    script.base = State.initWithNewAllocScope(.stmt, interpreter, shell_state);
    script.node = node;
    script.parent = parent_ptr;
    script.idx = 0;
    script.last_exit_code = null;
    script.currently_executing = null;
    script.io = io;
    log("Stmt(0x{x}) init", .{@intFromPtr(script)});
    return script;
}

pub fn start(this: *Stmt) Yield {
    if (bun.Environment.allow_assert) {
        assert(this.idx == 0);
        assert(this.last_exit_code == null);
        assert(this.currently_executing == null);
    }
    return .{ .stmt = this };
}

pub fn next(this: *Stmt) Yield {
    if (this.idx >= this.node.exprs.len)
        return this.parent.childDone(this, this.last_exit_code orelse 0);

    const child = &this.node.exprs[this.idx];
    switch (child.*) {
        .binary => {
            const binary = Binary.init(this.base.interpreter, this.base.shell, child.binary, Binary.ParentPtr.init(this), this.io.copy());
            this.currently_executing = ChildPtr.init(binary);
            return binary.start();
        },
        .cmd => {
            const cmd = Cmd.init(this.base.interpreter, this.base.shell, child.cmd, Cmd.ParentPtr.init(this), this.io.copy());
            this.currently_executing = ChildPtr.init(cmd);
            return cmd.start();
        },
        .pipeline => {
            const pipeline = Pipeline.init(this.base.interpreter, this.base.shell, child.pipeline, Pipeline.ParentPtr.init(this), this.io.copy());
            this.currently_executing = ChildPtr.init(pipeline);
            return pipeline.start();
        },
        .assign => |assigns| {
            const assign_machine = Assigns.init(this.base.interpreter, this.base.shell, assigns, .shell, Assigns.ParentPtr.init(this), this.io.copy());
            return assign_machine.start();
        },
        .subshell => {
            var script = switch (Subshell.initDupeShellState(
                this.base.interpreter,
                this.base.shell,
                child.subshell,
                Subshell.ParentPtr.init(this),
                this.io.copy(),
            )) {
                .result => |s| s,
                .err => |e| {
                    this.base.throw(&bun.shell.ShellErr.newSys(e));
                    return .failed;
                },
            };
            return script.start();
        },
        .@"if" => {
            const if_clause = If.init(this.base.interpreter, this.base.shell, child.@"if", If.ParentPtr.init(this), this.io.copy());
            return if_clause.start();
        },
        .condexpr => {
            const condexpr = CondExpr.init(this.base.interpreter, this.base.shell, child.condexpr, CondExpr.ParentPtr.init(this), this.io.copy());
            return condexpr.start();
        },
        .async => {
            const async = Async.init(this.base.interpreter, this.base.shell, child.async, Async.ParentPtr.init(this), this.io.copy());
            return async.start();
        },
    }
}

pub fn childDone(this: *Stmt, child: ChildPtr, exit_code: ExitCode) Yield {
    const data = child.ptr.repr.data;
    log("child done Stmt {x} child({s})={x} exit={d}", .{ @intFromPtr(this), child.tagName(), @as(usize, @intCast(child.ptr.repr._ptr)), exit_code });
    this.last_exit_code = exit_code;
    this.idx += 1;
    const data2 = child.ptr.repr.data;
    log("{d} {d}", .{ data, data2 });
    child.deinit();
    this.currently_executing = null;
    return this.next();
}

pub fn deinit(this: *Stmt) void {
    log("Stmt(0x{x}) deinit", .{@intFromPtr(this)});
    this.io.deinit();
    if (this.currently_executing) |child| {
        child.deinit();
    }
    this.base.endScope();
    this.parent.destroy(this);
}

const bun = @import("bun");
const assert = bun.assert;

const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
const ast = bun.shell.AST;

const Interpreter = bun.shell.Interpreter;
const Assigns = bun.shell.Interpreter.Assigns;
const Async = bun.shell.Interpreter.Async;
const Binary = bun.shell.Interpreter.Binary;
const Cmd = bun.shell.Interpreter.Cmd;
const CondExpr = bun.shell.Interpreter.CondExpr;
const IO = bun.shell.Interpreter.IO;
const If = bun.shell.Interpreter.If;
const Pipeline = bun.shell.Interpreter.Pipeline;
const Script = bun.shell.Interpreter.Script;
const ShellExecEnv = Interpreter.ShellExecEnv;
const State = bun.shell.Interpreter.State;
const Subshell = bun.shell.Interpreter.Subshell;

const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const log = bun.shell.interpret.log;
