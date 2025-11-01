pub const Pipeline = @This();

base: State,
node: *const ast.Pipeline,
/// Based on precedence rules pipeline can only be child of a stmt or
/// binary
///
/// *WARNING*: Do not directly call `this.parent.childDone`, it should
///            be handed in `Pipeline.next()`
parent: ParentPtr,
exited_count: u32,
cmds: ?[]CmdOrResult,
pipes: ?[]Pipe,
io: IO,
state: union(enum) {
    starting_cmds: struct {
        idx: u32,
    },
    pending,
    waiting_write_err,
    done: struct {
        exit_code: ExitCode = 0,
    },
} = .{ .starting_cmds = .{ .idx = 0 } },

pub const ParentPtr = StatePtrUnion(.{
    Stmt,
    Binary,
    Async,
});

pub const ChildPtr = StatePtrUnion(.{
    Cmd,
    Assigns,
    If,
    CondExpr,
    Subshell,
});

const PipelineItem = bun.TaggedPointerUnion(.{
    Cmd,
    If,
    CondExpr,
    Subshell,
});

const CmdOrResult = union(enum) {
    cmd: PipelineItem,
    result: ExitCode,
};

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellExecEnv,
    node: *const ast.Pipeline,
    parent: ParentPtr,
    io: IO,
) *Pipeline {
    const pipeline = parent.create(Pipeline);
    pipeline.* = .{
        .base = State.initWithNewAllocScope(.pipeline, interpreter, shell_state),
        .node = node,
        .parent = parent,
        .exited_count = 0,
        .cmds = null,
        .pipes = null,
        .io = io,
    };

    return pipeline;
}

fn getIO(this: *Pipeline) IO {
    return this.io;
}

fn writeFailingError(this: *Pipeline, comptime fmt: []const u8, args: anytype) Yield {
    const handler = struct {
        fn enqueueCb(ctx: *Pipeline) void {
            ctx.state = .waiting_write_err;
        }
    };
    return this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
}

fn setupCommands(this: *Pipeline) ?Yield {
    const cmd_count = brk: {
        var i: u32 = 0;
        for (this.node.items) |*item| {
            if (switch (item.*) {
                .assigns => false,
                else => true,
            }) i += 1;
        }
        break :brk i;
    };

    this.cmds = if (cmd_count >= 1) bun.handleOom(this.base.allocator().alloc(CmdOrResult, cmd_count)) else null;
    if (this.cmds == null) return null;
    var pipes = bun.handleOom(this.base.allocator().alloc(Pipe, if (cmd_count > 1) cmd_count - 1 else 1));

    if (cmd_count > 1) {
        var pipes_set: u32 = 0;
        if (Pipeline.initializePipes(pipes, &pipes_set).asErr()) |err| {
            for (pipes[0..pipes_set]) |*pipe| {
                closefd(pipe[0]);
                closefd(pipe[1]);
            }
            const system_err = err.toShellSystemError();
            return this.writeFailingError("bun: {f}\n", .{system_err.message});
        }
    }

    var i: u32 = 0;
    const evtloop = this.base.eventLoop();
    for (this.node.items) |*item| {
        switch (item.*) {
            .@"if", .cmd, .condexpr, .subshell => {
                var cmd_io = this.getIO();
                const stdin = if (cmd_count > 1) Pipeline.readPipe(pipes, i, &cmd_io, evtloop) else cmd_io.stdin.ref();
                const stdout = if (cmd_count > 1) Pipeline.writePipe(pipes, i, cmd_count, &cmd_io, evtloop) else cmd_io.stdout.ref();
                cmd_io.stdin = stdin;
                cmd_io.stdout = stdout;
                _ = cmd_io.stderr.ref();
                const subshell_state = switch (this.base.shell.dupeForSubshell(this.base.allocScope(), this.base.allocator(), cmd_io, .pipeline)) {
                    .result => |s| s,
                    .err => |err| {
                        const system_err = err.toShellSystemError();
                        return this.writeFailingError("bun: {f}\n", .{system_err.message});
                    },
                };
                this.cmds.?[i] = .{
                    .cmd = switch (item.*) {
                        .@"if" => PipelineItem.init(If.init(this.base.interpreter, subshell_state, item.@"if", If.ParentPtr.init(this), cmd_io)),
                        .cmd => PipelineItem.init(Cmd.init(this.base.interpreter, subshell_state, item.cmd, Cmd.ParentPtr.init(this), cmd_io)),
                        .condexpr => PipelineItem.init(CondExpr.init(this.base.interpreter, subshell_state, item.condexpr, CondExpr.ParentPtr.init(this), cmd_io)),
                        .subshell => PipelineItem.init(Subshell.init(this.base.interpreter, subshell_state, item.subshell, Subshell.ParentPtr.init(this), cmd_io)),
                        else => @panic("Pipeline runnable should be a command or an if conditional, this appears to be a bug in Bun."),
                    },
                };
                i += 1;
            },
            // in a pipeline assignments have no effect
            .assigns => {},
        }
    }

    this.pipes = pipes;

    return null;
}

pub fn start(this: *Pipeline) Yield {
    if (this.setupCommands()) |yield| return yield;
    if (this.state == .waiting_write_err or this.state == .done) return .suspended;
    if (this.cmds == null) {
        this.state = .{ .done = .{} };
        return .done;
    }

    assert(this.exited_count == 0);

    log("pipeline start {x} (count={d})", .{ @intFromPtr(this), this.node.items.len });

    if (this.node.items.len == 0) {
        this.state = .{ .done = .{} };
        return .done;
    }

    return .{ .pipeline = this };
}

pub fn next(this: *Pipeline) Yield {
    switch (this.state) {
        .starting_cmds => {
            const cmds = this.cmds.?;
            const idx = this.state.starting_cmds.idx;
            if (idx >= cmds.len) {
                this.state = .pending;
                return .suspended;
            }
            log("Pipeline(0x{x}) starting cmd {d}/{d}", .{ @intFromPtr(this), idx + 1, cmds.len });
            this.state.starting_cmds.idx += 1;
            const cmd_or_result = cmds[idx];
            assert(cmd_or_result == .cmd);
            return cmd_or_result.cmd.call("start", .{}, Yield);
        },
        .pending => shell.unreachableState("Pipeline.next", "pending"),
        .waiting_write_err => shell.unreachableState("Pipeline.next", "waiting_write_err"),
        .done => return this.parent.childDone(this, this.state.done.exit_code),
    }
}

pub fn onIOWriterChunk(this: *Pipeline, _: usize, err: ?jsc.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_write_err);
    }

    if (err) |e| {
        this.base.throw(&shell.ShellErr.newSys(e));
        return .failed;
    }

    this.state = .{ .done = .{} };
    return .done;
}

pub fn childDone(this: *Pipeline, child: ChildPtr, exit_code: ExitCode) Yield {
    assert(this.cmds.?.len > 0);

    const idx = brk: {
        const ptr_value: u64 = @bitCast(child.ptr.repr);
        _ = ptr_value;
        for (this.cmds.?, 0..) |cmd_or_result, i| {
            if (cmd_or_result == .cmd) {
                const ptr = @as(usize, cmd_or_result.cmd.repr._ptr);
                if (ptr == @as(usize, @intCast(child.ptr.repr._ptr))) break :brk i;
            }
        }
        @panic("Invalid pipeline state");
    };

    log("Pipeline(0x{x}) child done ({d}) i={d}", .{ @intFromPtr(this), exit_code, idx });
    // We duped the subshell for commands in the pipeline so we need to
    // deinitialize it.
    if (child.ptr.is(Cmd)) {
        const cmd = child.as(Cmd);
        cmd.base.shell.deinit();
    } else if (child.ptr.is(If)) {
        const if_clause = child.as(If);
        if_clause.base.shell.deinit();
    } else if (child.ptr.is(CondExpr)) {
        const condexpr = child.as(CondExpr);
        condexpr.base.shell.deinit();
    } else if (child.ptr.is(Assigns)) {
        // We don't do anything here since assigns have no effect in a pipeline
    } else if (child.ptr.is(Subshell)) {
        // Subshell already deinitializes its shell state so don't need to do anything here
    }

    child.deinit();
    this.cmds.?[idx] = .{ .result = exit_code };
    this.exited_count += 1;

    log("Pipeline(0x{x}) check exited_count={d} cmds.len={d}", .{ @intFromPtr(this), this.exited_count, this.cmds.?.len });
    if (this.exited_count >= this.cmds.?.len) {
        var last_exit_code: ExitCode = 0;
        var i: i64 = @as(i64, @intCast(this.cmds.?.len)) - 1;
        while (i > 0) : (i -= 1) {
            const cmd_or_result = this.cmds.?[@intCast(i)];
            if (cmd_or_result == .result) {
                last_exit_code = cmd_or_result.result;
                break;
            }
        }
        this.state = .{ .done = .{ .exit_code = last_exit_code } };
        return .{ .pipeline = this };
    }

    return .suspended;
}

pub fn deinit(this: *Pipeline) void {
    // If commands was zero then we didn't allocate anything
    if (this.cmds == null) return;
    for (this.cmds.?) |*cmd_or_result| {
        if (cmd_or_result.* == .cmd) {
            cmd_or_result.cmd.call("deinit", .{}, void);
        }
    }
    if (this.pipes) |pipes| {
        this.base.allocator().free(pipes);
    }
    if (this.cmds) |cmds| {
        this.base.allocator().free(cmds);
    }
    this.io.deref();
    this.base.endScope();
    this.parent.destroy(this);
}

fn initializePipes(pipes: []Pipe, set_count: *u32) Maybe(void) {
    for (pipes) |*pipe| {
        if (bun.Environment.isWindows) {
            pipe.* = switch (bun.sys.pipe()) {
                .result => |p| p,
                .err => |e| return .{ .err = e },
            };
        } else {
            switch (bun.sys.socketpairForShell(
                // switch (bun.sys.socketpair(
                std.posix.AF.UNIX,
                std.posix.SOCK.STREAM,
                0,
                .blocking,
            )) {
                .result => |fds| pipe.* = fds,
                .err => |err| return .{ .err = err },
            }
        }
        set_count.* += 1;
    }
    return .success;
}

fn writePipe(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO, evtloop: jsc.EventLoopHandle) IO.OutKind {
    // Last command in the pipeline should write to stdout
    if (proc_idx == cmd_count - 1) return io.stdout.ref();
    return .{
        .fd = .{
            .writer = IOWriter.init(pipes[proc_idx][1], .{
                .pollable = true,
                .is_socket = bun.Environment.isPosix,
            }, evtloop),
        },
    };
}

fn readPipe(pipes: []Pipe, proc_idx: usize, io: *IO, evtloop: jsc.EventLoopHandle) IO.InKind {
    // First command in the pipeline should read from stdin
    if (proc_idx == 0) return io.stdin.ref();
    return .{ .fd = IOReader.init(pipes[proc_idx - 1][0], evtloop) };
}

const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;
const Maybe = bun.sys.Maybe;

const shell = bun.shell;
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
const IOReader = bun.shell.Interpreter.IOReader;
const IOWriter = bun.shell.Interpreter.IOWriter;
const If = bun.shell.Interpreter.If;
const ShellExecEnv = Interpreter.ShellExecEnv;
const State = bun.shell.Interpreter.State;
const Stmt = bun.shell.Interpreter.Stmt;
const Subshell = bun.shell.Interpreter.Subshell;

const Pipe = bun.shell.interpret.Pipe;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const closefd = bun.shell.interpret.closefd;
const log = bun.shell.interpret.log;
