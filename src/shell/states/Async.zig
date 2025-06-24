pub const Async = @This();

base: State,
node: *const ast.Expr,
parent: ParentPtr,
io: IO,
state: union(enum) {
    idle,
    exec: struct {
        child: ?ChildPtr = null,
    },
    done: ExitCode,
} = .idle,
event_loop: JSC.EventLoopHandle,
concurrent_task: JSC.EventLoopTask,

pub const ParentPtr = StatePtrUnion(.{
    Binary,
    Stmt,
});

pub const ChildPtr = StatePtrUnion(.{
    Pipeline,
    Cmd,
    If,
    CondExpr,
});

pub fn format(this: *const Async, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try writer.print("Async(0x{x}, child={s})", .{ @intFromPtr(this), @tagName(this.node.*) });
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellState,
    node: *const ast.Expr,
    parent: ParentPtr,
    io: IO,
) *Async {
    interpreter.async_commands_executing += 1;
    return bun.new(Async, .{
        .base = .{ .kind = .@"async", .interpreter = interpreter, .shell = shell_state },
        .node = node,
        .parent = parent,
        .io = io,
        .event_loop = interpreter.event_loop,
        .concurrent_task = JSC.EventLoopTask.fromEventLoop(interpreter.event_loop),
    });
}

pub fn start(this: *Async) Yield {
    log("{} start", .{this});
    this.enqueueSelf();
    return this.parent.childDone(this, 0);
}

pub fn next(this: *Async) Yield {
    log("{} next {s}", .{ this, @tagName(this.state) });
    switch (this.state) {
        .idle => {
            this.state = .{ .exec = .{} };
            this.enqueueSelf();
            return .suspended;
        },
        .exec => {
            if (this.state.exec.child) |child| {
                return child.start();
            }

            const child = brk: {
                switch (this.node.*) {
                    .pipeline => break :brk ChildPtr.init(Pipeline.init(
                        this.base.interpreter,
                        this.base.shell,
                        this.node.pipeline,
                        Pipeline.ParentPtr.init(this),
                        this.io.copy(),
                    )),
                    .cmd => break :brk ChildPtr.init(Cmd.init(
                        this.base.interpreter,
                        this.base.shell,
                        this.node.cmd,
                        Cmd.ParentPtr.init(this),
                        this.io.copy(),
                    )),
                    .@"if" => break :brk ChildPtr.init(If.init(
                        this.base.interpreter,
                        this.base.shell,
                        this.node.@"if",
                        If.ParentPtr.init(this),
                        this.io.copy(),
                    )),
                    .condexpr => break :brk ChildPtr.init(CondExpr.init(
                        this.base.interpreter,
                        this.base.shell,
                        this.node.condexpr,
                        CondExpr.ParentPtr.init(this),
                        this.io.copy(),
                    )),
                    else => {
                        @panic("Encountered an unexpected child of an async command, this indicates a bug in Bun. Please open a GitHub issue.");
                    },
                }
            };
            this.state.exec.child = child;
            this.enqueueSelf();
            return .suspended;
        },
        .done => {
            this.base.interpreter.asyncCmdDone(this);
            return .done;
        },
    }
}

pub fn enqueueSelf(this: *Async) void {
    if (this.event_loop == .js) {
        this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
    } else {
        this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
    }
}

pub fn childDone(this: *Async, child_ptr: ChildPtr, exit_code: ExitCode) Yield {
    log("{} childDone", .{this});
    child_ptr.deinit();
    this.state = .{ .done = exit_code };
    this.enqueueSelf();
    return .suspended;
}

/// This function is purposefully empty as a hack to ensure Async runs in the background while appearing to
/// the parent that it is done immediately.
///
/// For example, in a script like `sleep 1 & echo hello`, the `sleep 1` part needs to appear as done immediately so the parent doesn't wait for
/// it and instead immediately moves to executing the next command.
///
/// Actual deinitialization is executed once this Async calls `this.base.interpreter.asyncCmdDone(this)`, where the interpreter will call `.actuallyDeinit()`
pub fn deinit(this: *Async) void {
    _ = this;
}

pub fn actuallyDeinit(this: *Async) void {
    this.io.deref();
    bun.destroy(this);
}

pub fn runFromMainThread(this: *Async) void {
    this.next().run();
}

pub fn runFromMainThreadMini(this: *Async, _: *void) void {
    this.runFromMainThread();
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

const Cmd = bun.shell.Interpreter.Cmd;
const If = bun.shell.Interpreter.If;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Binary = bun.shell.Interpreter.Binary;
const Stmt = bun.shell.Interpreter.Stmt;
const Pipeline = bun.shell.Interpreter.Pipeline;

const JSC = bun.JSC;
