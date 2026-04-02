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
    return .{ .subshell = this };
}

pub fn next(this: *Subshell) Yield {
    while (this.state != .done) {
        switch (this.state) {
            .idle => {
                // If there are no redirections, go straight to exec
                if (this.node.redirect == null) {
                    return this.transitionToExec();
                }
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
                // exec state
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

    if (this.node.redirect != null) {
        if (this.applyRedirections()) |yield| return yield;
    }

    const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
    this.state = .exec;
    return script.start();
}

fn applyRedirections(this: *Subshell) ?Yield {
    const redirect_flags = this.node.redirect_flags;

    if (this.node.redirect) |file| {
        switch (file) {
            .atom => {
                if (this.redirection_file.items.len == 0) {
                    return this.writeFailingError("bun: ambiguous redirect\n", .{});
                }

                // Regular files are not pollable on linux and macos
                const is_pollable: bool = if (bun.Environment.isPosix) false else true;

                const path = this.redirection_file.items[0..this.redirection_file.items.len -| 1 :0];
                const perm = 0o666;

                var pollable = false;
                var is_socket = false;
                var is_nonblocking = false;

                const redirfd = redirfd: {
                    if (redirect_flags.stdin) {
                        break :redirfd switch (ShellSyscall.openat(this.base.shell.cwd_fd, path, redirect_flags.toFlags(), perm)) {
                            .err => |e| {
                                return this.writeFailingError("bun: {f}: {s}\n", .{ e.toShellSystemError().message, path });
                            },
                            .result => |f| f,
                        };
                    }

                    const result = bun.io.openForWritingImpl(
                        this.base.shell.cwd_fd,
                        path,
                        redirect_flags.toFlags(),
                        perm,
                        &pollable,
                        &is_socket,
                        false,
                        &is_nonblocking,
                        void,
                        {},
                        struct {
                            fn onForceSyncOrIsaTTY(_: void) void {}
                        }.onForceSyncOrIsaTTY,
                        shell.interpret.isPollableFromMode,
                        ShellSyscall.openat,
                    );

                    break :redirfd switch (result) {
                        .err => |e| {
                            return this.writeFailingError("bun: {f}: {s}\n", .{ e.toShellSystemError().message, path });
                        },
                        .result => |f| {
                            if (bun.Environment.isWindows) {
                                switch (f.makeLibUVOwnedForSyscall(.open, .close_on_fail)) {
                                    .err => |e| {
                                        return this.writeFailingError("bun: {f}: {s}\n", .{ e.toShellSystemError().message, path });
                                    },
                                    .result => |f2| break :redirfd f2,
                                }
                            }
                            break :redirfd f;
                        },
                    };
                };

                if (redirect_flags.stdin) {
                    this.io.stdin.deref();
                    this.io.stdin = .{ .fd = IOReader.init(redirfd, this.base.eventLoop()) };
                }

                if (!redirect_flags.stdout and !redirect_flags.stderr) {
                    return null;
                }

                const redirect_writer: *IOWriter = .init(
                    redirfd,
                    .{ .pollable = is_pollable, .nonblocking = is_nonblocking, .is_socket = is_socket },
                    this.base.eventLoop(),
                );
                defer redirect_writer.deref();

                if (redirect_flags.duplicate_out) {
                    this.io.stdout.deref();
                    this.io.stdout = .{ .fd = .{ .writer = redirect_writer.dupeRef() } };
                    this.io.stderr.deref();
                    this.io.stderr = .{ .fd = .{ .writer = redirect_writer.dupeRef() } };
                } else {
                    if (redirect_flags.stdout) {
                        this.io.stdout.deref();
                        this.io.stdout = .{ .fd = .{ .writer = redirect_writer.dupeRef() } };
                    }
                    if (redirect_flags.stderr) {
                        this.io.stderr.deref();
                        this.io.stderr = .{ .fd = .{ .writer = redirect_writer.dupeRef() } };
                    }
                }
            },
            .jsbuf => {
                // JS buffer redirections for subshells are not yet supported
                return this.writeFailingError("bun: JS object redirections in subshells are not supported\n", .{});
            },
        }
    } else if (redirect_flags.duplicate_out) {
        if (redirect_flags.stdout) {
            this.io.stderr.deref();
            this.io.stderr = this.io.stdout.ref();
        }

        if (redirect_flags.stderr) {
            this.io.stdout.deref();
            this.io.stdout = this.io.stderr.ref();
        }
    }

    return null;
}

pub fn childDone(this: *Subshell, child_ptr: ChildPtr, exit_code: ExitCode) Yield {
    this.exit_code = exit_code;
    if (child_ptr.ptr.is(Expansion)) {
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
const IOReader = bun.shell.Interpreter.IOReader;
const IOWriter = bun.shell.Interpreter.IOWriter;
const Pipeline = bun.shell.Interpreter.Pipeline;
const Script = bun.shell.Interpreter.Script;
const ShellExecEnv = Interpreter.ShellExecEnv;
const State = bun.shell.Interpreter.State;
const Stmt = bun.shell.Interpreter.Stmt;

const ShellSyscall = shell.interpret.ShellSyscall;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const log = bun.shell.interpret.log;
