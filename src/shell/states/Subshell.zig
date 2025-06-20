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

pub fn start(this: *Subshell) Yield {
    log("{} start", .{this});
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
    log("{} transitionToExec", .{this});
    const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
    this.state = .exec;
    return script.start();
}

pub fn childDone(this: *Subshell, child_ptr: ChildPtr, exit_code: ExitCode) Yield {
    defer child_ptr.deinit();
    this.exit_code = exit_code;
    if (child_ptr.ptr.is(Expansion) and exit_code != 0) {
        if (exit_code != 0) {
            const err = this.state.expanding_redirect.expansion.state.err;
            defer err.deinit(bun.default_allocator);
            this.state.expanding_redirect.expansion.deinit();
            return this.writeFailingError("{}\n", .{err});
        }
        return .{ .subshell = this };
    }

    if (child_ptr.ptr.is(Script)) {
        return this.parent.childDone(this, exit_code);
    }

    bun.shell.unreachableState("Subshell.childDone", "expected Script or Expansion");
}

pub fn onIOWriterChunk(this: *Subshell, _: usize, err: ?JSC.SystemError) Yield {
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
    bun.destroy(this);
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

const Script = bun.shell.Interpreter.Script;
const Binary = bun.shell.Interpreter.Binary;
const Expansion = bun.shell.Interpreter.Expansion;
const Stmt = bun.shell.Interpreter.Stmt;
const Pipeline = bun.shell.Interpreter.Pipeline;

const JSC = bun.JSC;
const assert = bun.assert;
