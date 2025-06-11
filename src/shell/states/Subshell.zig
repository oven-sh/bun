pub const Subshell = @This();

base: State,
node: *const ast.Subshell,
parent: ParentPtr,
io: IO,
state: union(enum) {
    idle,
    expanding_redirect: struct {
        idx: u32 = 0,
        expansion: Expansion,
    },
    exec,
    wait_write_err,
    done,
} = .idle,
redirection_file: std.ArrayList(u8),
exit_code: ExitCode = 0,

pub const ParentPtr = StatePtrUnion(.{
    Pipeline,
    Binary,
    Stmt,
});

pub const ChildPtr = StatePtrUnion(.{
    Script,
    Subshell,
    Expansion,
});

pub fn format(this: *const Subshell, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try writer.print("Subshell(0x{x})", .{@intFromPtr(this)});
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellState,
    node: *const ast.Subshell,
    parent: ParentPtr,
    io: IO,
) *Subshell {
    return bun.new(Subshell, .{
        .base = .{ .kind = .condexpr, .interpreter = interpreter, .shell = shell_state },
        .node = node,
        .parent = parent,
        .io = io,
        .redirection_file = std.ArrayList(u8).init(bun.default_allocator),
    });
}

pub fn start(this: *Subshell) void {
    log("{} start", .{this});
    const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
    script.start();
}

pub fn next(this: *Subshell) void {
    while (this.state != .done) {
        switch (this.state) {
            .idle => {
                this.state = .{
                    .expanding_redirect = .{ .expansion = undefined },
                };
                this.next();
            },
            .expanding_redirect => {
                if (this.state.expanding_redirect.idx >= 1) {
                    this.transitionToExec();
                    return;
                }
                this.state.expanding_redirect.idx += 1;

                // Get the node to expand otherwise go straight to
                // `expanding_args` state
                const node_to_expand = brk: {
                    if (this.node.redirect != null and this.node.redirect.? == .atom) break :brk &this.node.redirect.?.atom;
                    this.transitionToExec();
                    return;
                };

                Expansion.init(
                    this.base.interpreter,
                    this.base.shell,
                    &this.state.expanding_redirect.expansion,
                    node_to_expand,
                    Expansion.ParentPtr.init(this),
                    .{
                        .single = .{
                            .list = &this.redirection_file,
                        },
                    },
                    this.io.copy(),
                );

                this.state.expanding_redirect.expansion.start();
                return;
            },
            .wait_write_err, .exec => return,
            .done => @panic("This should not be possible."),
        }
    }

    this.parent.childDone(this, 0);
}

pub fn transitionToExec(this: *Subshell) void {
    log("{} transitionToExec", .{this});
    const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
    this.state = .exec;
    script.start();
}

pub fn childDone(this: *Subshell, child_ptr: ChildPtr, exit_code: ExitCode) void {
    defer child_ptr.deinit();
    this.exit_code = exit_code;
    if (child_ptr.ptr.is(Expansion) and exit_code != 0) {
        if (exit_code != 0) {
            const err = this.state.expanding_redirect.expansion.state.err;
            defer err.deinit(bun.default_allocator);
            this.state.expanding_redirect.expansion.deinit();
            this.writeFailingError("{}\n", .{err});
            return;
        }
        this.next();
    }

    if (child_ptr.ptr.is(Script)) {
        this.parent.childDone(this, exit_code);
        return;
    }
}

pub fn onIOWriterChunk(this: *Subshell, _: usize, err: ?JSC.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .wait_write_err);
    }

    if (err) |e| {
        e.deref();
    }

    this.state = .done;
    this.parent.childDone(this, this.exit_code);
}

pub fn deinit(this: *Subshell) void {
    this.base.shell.deinit();
    this.io.deref();
    this.redirection_file.deinit();
    bun.destroy(this);
}

pub fn writeFailingError(this: *Subshell, comptime fmt: []const u8, args: anytype) void {
    const handler = struct {
        fn enqueueCb(ctx: *Subshell) void {
            ctx.state = .wait_write_err;
        }
    };
    this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
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

const Assigns = bun.shell.Interpreter.Assigns;
const Script = bun.shell.Interpreter.Script;
const Async = bun.shell.Interpreter.Async;
const Cmd = bun.shell.Interpreter.Cmd;
const If = bun.shell.Interpreter.If;
const CondExpr = bun.shell.Interpreter.CondExpr;
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

const windows = bun.windows;
const uv = windows.libuv;
