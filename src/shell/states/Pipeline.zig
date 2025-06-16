pub const Pipeline = @This();

base: State,
node: *const ast.Pipeline,
/// Based on precedence rules pipeline can only be child of a stmt or
/// binary
parent: ParentPtr,
exited_count: u32,
cmds: ?[]CmdOrResult,
pipes: ?[]Pipe,
io: IO,
state: union(enum) {
    idle,
    executing,
    waiting_write_err,
    done,
} = .idle,

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
    shell_state: *ShellState,
    node: *const ast.Pipeline,
    parent: ParentPtr,
    io: IO,
) *Pipeline {
    const pipeline = interpreter.allocator.create(Pipeline) catch bun.outOfMemory();
    pipeline.* = .{
        .base = .{ .kind = .pipeline, .interpreter = interpreter, .shell = shell_state },
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

fn writeFailingError(this: *Pipeline, comptime fmt: []const u8, args: anytype) void {
    const handler = struct {
        fn enqueueCb(ctx: *Pipeline) void {
            ctx.state = .waiting_write_err;
        }
    };
    this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
}

fn setupCommands(this: *Pipeline) bun.shell.interpret.CoroutineResult {
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

    this.cmds = if (cmd_count >= 1) this.base.interpreter.allocator.alloc(CmdOrResult, this.node.items.len) catch bun.outOfMemory() else null;
    if (this.cmds == null) return .cont;
    var pipes = this.base.interpreter.allocator.alloc(Pipe, if (cmd_count > 1) cmd_count - 1 else 1) catch bun.outOfMemory();

    if (cmd_count > 1) {
        var pipes_set: u32 = 0;
        if (Pipeline.initializePipes(pipes, &pipes_set).asErr()) |err| {
            for (pipes[0..pipes_set]) |*pipe| {
                closefd(pipe[0]);
                closefd(pipe[1]);
            }
            const system_err = err.toShellSystemError();
            this.writeFailingError("bun: {s}\n", .{system_err.message});
            return .yield;
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
                const subshell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, cmd_io, .pipeline)) {
                    .result => |s| s,
                    .err => |err| {
                        const system_err = err.toShellSystemError();
                        this.writeFailingError("bun: {s}\n", .{system_err.message});
                        return .yield;
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

    return .cont;
}

pub fn start(this: *Pipeline) void {
    if (this.setupCommands() == .yield) return;

    if (this.state == .waiting_write_err or this.state == .done) return;
    const cmds = this.cmds orelse {
        this.state = .done;
        this.parent.childDone(this, 0);
        return;
    };

    if (comptime bun.Environment.allow_assert) {
        assert(this.exited_count == 0);
    }
    log("pipeline start {x} (count={d})", .{ @intFromPtr(this), this.node.items.len });
    if (this.node.items.len == 0) {
        this.state = .done;
        this.parent.childDone(this, 0);
        return;
    }

    for (cmds) |*cmd_or_result| {
        assert(cmd_or_result.* == .cmd);
        log("Pipeline start cmd", .{});
        var cmd = cmd_or_result.cmd;
        cmd.call("start", .{}, void);
    }
}

pub fn onIOWriterChunk(this: *Pipeline, _: usize, err: ?JSC.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_write_err);
    }

    if (err) |e| {
        this.base.throw(&shell.ShellErr.newSys(e));
        return;
    }

    this.state = .done;
    this.parent.childDone(this, 0);
}

pub fn childDone(this: *Pipeline, child: ChildPtr, exit_code: ExitCode) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.cmds.?.len > 0);
    }

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

    log("pipeline child done {x} ({d}) i={d}", .{ @intFromPtr(this), exit_code, idx });
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

    if (this.exited_count >= this.cmds.?.len) {
        var last_exit_code: ExitCode = 0;
        for (this.cmds.?) |cmd_or_result| {
            if (cmd_or_result == .result) {
                last_exit_code = cmd_or_result.result;
                break;
            }
        }
        this.state = .done;
        this.parent.childDone(this, last_exit_code);
        return;
    }
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
        this.base.interpreter.allocator.free(pipes);
    }
    if (this.cmds) |cmds| {
        this.base.interpreter.allocator.free(cmds);
    }
    this.io.deref();
    this.base.interpreter.allocator.destroy(this);
}

fn initializePipes(pipes: []Pipe, set_count: *u32) Maybe(void) {
    for (pipes) |*pipe| {
        if (bun.Environment.isWindows) {
            var fds: [2]uv.uv_file = undefined;
            if (uv.uv_pipe(&fds, 0, 0).errEnum()) |e| {
                return .{ .err = Syscall.Error.fromCode(e, .pipe) };
            }
            pipe[0] = .fromUV(fds[0]);
            pipe[1] = .fromUV(fds[1]);
        } else {
            switch (bun.sys.socketpair(
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
    return Maybe(void).success;
}

fn writePipe(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO, evtloop: JSC.EventLoopHandle) IO.OutKind {
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

fn readPipe(pipes: []Pipe, proc_idx: usize, io: *IO, evtloop: JSC.EventLoopHandle) IO.InKind {
    // First command in the pipeline should read from stdin
    if (proc_idx == 0) return io.stdin.ref();
    return .{ .fd = IOReader.init(pipes[proc_idx - 1][0], evtloop) };
}

const std = @import("std");
const bun = @import("bun");
const shell = bun.shell;

const Interpreter = bun.shell.Interpreter;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const ast = bun.shell.AST;
const ExitCode = bun.shell.ExitCode;
const ShellState = Interpreter.ShellState;
const State = bun.shell.Interpreter.State;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;
const Pipe = bun.shell.interpret.Pipe;
const closefd = bun.shell.interpret.closefd;
const IOReader = bun.shell.Interpreter.IOReader;
const IOWriter = bun.shell.Interpreter.IOWriter;

const Assigns = bun.shell.Interpreter.Assigns;
const Async = bun.shell.Interpreter.Async;
const Cmd = bun.shell.Interpreter.Cmd;
const If = bun.shell.Interpreter.If;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Binary = bun.shell.Interpreter.Binary;
const Subshell = bun.shell.Interpreter.Subshell;
const Stmt = bun.shell.Interpreter.Stmt;

const JSC = bun.JSC;
const Maybe = JSC.Maybe;
const assert = bun.assert;
const Syscall = bun.shell.interpret.Syscall;

const windows = bun.windows;
const uv = windows.libuv;
