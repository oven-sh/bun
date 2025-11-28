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
redirection_file: std.array_list.Managed(u8),
exit_code: ExitCode = 0,

pub const ParentPtr = StatePtrUnion(.{
    Pipeline,
    Binary,
    Stmt,
});

pub const ChildPtr = StatePtrUnion(.{
    Script,
    Expansion,
});

pub fn format(this: *const Subshell, writer: *std.Io.Writer) !void {
    try writer.print("Subshell(0x{x})", .{@intFromPtr(this)});
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellExecEnv,
    node: *const ast.Subshell,
    parent: ParentPtr,
    io: IO,
) *Subshell {
    const subshell = parent.create(Subshell);
    subshell.* = .{
        .base = State.initWithNewAllocScope(.subshell, interpreter, shell_state),
        .node = node,
        .parent = parent,
        .io = io,
        .redirection_file = undefined,
    };
    subshell.redirection_file = std.array_list.Managed(u8).init(subshell.base.allocator());
    return subshell;
}

pub fn initDupeShellState(
    interpreter: *Interpreter,
    shell_state: *ShellExecEnv,
    node: *const ast.Subshell,
    parent: ParentPtr,
    io: IO,
) bun.sys.Maybe(*Subshell) {
    const subshell = parent.create(Subshell);
    subshell.* = .{
        .base = State.initWithNewAllocScope(.subshell, interpreter, shell_state),
        .node = node,
        .parent = parent,
        .io = io,
        .redirection_file = undefined,
    };
    subshell.base.shell = switch (shell_state.dupeForSubshell(subshell.base.allocScope(), subshell.base.allocator(), io, .subshell)) {
        .result => |s| s,
        .err => |e| {
            parent.destroy(subshell);
            return .{ .err = e };
        },
    };
    subshell.redirection_file = std.array_list.Managed(u8).init(subshell.base.allocator());
    return .{ .result = subshell };
}

pub fn start(this: *Subshell) Yield {
    log("{f} start", .{this});
    const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
    return script.start();
}

pub fn next(this: *Subshell) Yield {
    while (this.state != .done) {
        switch (this.state) {
            .idle => {
                this.state = .{
                    .expanding_redirect = .{ .expansion = undefined },
                };
                return .{ .subshell = this };
            },
            .expanding_redirect => {
                if (this.state.expanding_redirect.idx >= 1) {
                    return this.transitionToExec();
                }
                this.state.expanding_redirect.idx += 1;

                // Get the node to expand otherwise go straight to
                // `expanding_args` state
                const node_to_expand = brk: {
                    if (this.node.redirect != null and this.node.redirect.? == .atom) break :brk &this.node.redirect.?.atom;
                    return this.transitionToExec();
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

                return this.state.expanding_redirect.expansion.start();
            },
            .wait_write_err, .exec => return .suspended,
            .done => @panic("This should not be possible."),
        }
    }

    return this.parent.childDone(this, 0);
}

pub fn transitionToExec(this: *Subshell) Yield {
    log("{f} transitionToExec", .{this});
    const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
    this.state = .exec;
    return script.start();
}

pub fn childDone(this: *Subshell, child_ptr: ChildPtr, exit_code: ExitCode) Yield {
    this.exit_code = exit_code;
    if (child_ptr.ptr.is(Expansion) and exit_code != 0) {
        if (exit_code != 0) {
            const err = this.state.expanding_redirect.expansion.state.err;
            defer err.deinit(bun.default_allocator);
            this.state.expanding_redirect.expansion.deinit();
            return this.writeFailingError("{f}\n", .{err});
        }
        child_ptr.deinit();
        return .{ .subshell = this };
    }

    if (child_ptr.ptr.is(Script)) {
        child_ptr.deinit();
        return this.parent.childDone(this, exit_code);
    }

    bun.shell.unreachableState("Subshell.childDone", "expected Script or Expansion");
}

pub fn onIOWriterChunk(this: *Subshell, _: usize, err: ?jsc.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .wait_write_err);
    }

    if (err) |e| {
        e.deref();
    }

    this.state = .done;
    return this.parent.childDone(this, this.exit_code);
}

pub fn deinit(this: *Subshell) void {
    this.base.shell.deinit();
    this.io.deref();
    this.redirection_file.deinit();
    this.base.endScope();
    this.parent.destroy(this);
}

pub fn writeFailingError(this: *Subshell, comptime fmt: []const u8, args: anytype) Yield {
    const handler = struct {
        fn enqueueCb(ctx: *Subshell) void {
            ctx.state = .wait_write_err;
        }
    };
    return this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
}

const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;

const shell = bun.shell;
const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
const ast = bun.shell.AST;

const Interpreter = bun.shell.Interpreter;
const Binary = bun.shell.Interpreter.Binary;
const Expansion = bun.shell.Interpreter.Expansion;
const IO = bun.shell.Interpreter.IO;
const Pipeline = bun.shell.Interpreter.Pipeline;
const Script = bun.shell.Interpreter.Script;
const ShellExecEnv = Interpreter.ShellExecEnv;
const State = bun.shell.Interpreter.State;
const Stmt = bun.shell.Interpreter.Stmt;

const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const log = bun.shell.interpret.log;
