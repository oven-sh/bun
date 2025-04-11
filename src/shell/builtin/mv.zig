opts: Opts = .{},
args: struct {
    sources: []const [*:0]const u8 = &[_][*:0]const u8{},
    target: [:0]const u8 = &[0:0]u8{},
    target_fd: ?bun.FileDescriptor = null,
} = .{},
state: union(enum) {
    idle,
    check_target: struct {
        task: ShellMvCheckTargetTask,
        state: union(enum) {
            running,
            done,
        },
    },
    executing: struct {
        task_count: usize,
        tasks_done: usize = 0,
        error_signal: std.atomic.Value(bool),
        tasks: []ShellMvBatchedTask,
        err: ?Syscall.Error = null,
    },
    done,
    waiting_write_err: struct {
        exit_code: ExitCode,
    },
    err,
} = .idle,

pub const ShellMvCheckTargetTask = struct {
    mv: *Mv,

    cwd: bun.FileDescriptor,
    target: [:0]const u8,
    result: ?Maybe(?bun.FileDescriptor) = null,

    task: ShellTask(@This(), runFromThreadPool, runFromMainThread, debug),

    pub fn runFromThreadPool(this: *@This()) void {
        const fd = switch (ShellSyscall.openat(this.cwd, this.target, bun.O.RDONLY | bun.O.DIRECTORY, 0)) {
            .err => |e| {
                switch (e.getErrno()) {
                    bun.C.E.NOTDIR => {
                        this.result = .{ .result = null };
                    },
                    else => {
                        this.result = .{ .err = e };
                    },
                }
                return;
            },
            .result => |fd| fd,
        };
        this.result = .{ .result = fd };
    }

    pub fn runFromMainThread(this: *@This()) void {
        this.mv.checkTargetTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }
};

pub const ShellMvBatchedTask = struct {
    const BATCH_SIZE = 5;

    mv: *Mv,
    sources: []const [*:0]const u8,
    target: [:0]const u8,
    target_fd: ?bun.FileDescriptor,
    cwd: bun.FileDescriptor,
    error_signal: *std.atomic.Value(bool),

    err: ?Syscall.Error = null,

    task: ShellTask(@This(), runFromThreadPool, runFromMainThread, debug),
    event_loop: JSC.EventLoopHandle,

    pub fn runFromThreadPool(this: *@This()) void {
        // Moving multiple entries into a directory
        if (this.sources.len > 1) return this.moveMultipleIntoDir();

        const src = this.sources[0][0..std.mem.len(this.sources[0]) :0];
        // Moving entry into directory
        if (this.target_fd) |fd| {
            _ = fd;

            var buf: bun.PathBuffer = undefined;
            _ = this.moveInDir(src, &buf);
            return;
        }

        switch (Syscall.renameat(this.cwd, src, this.cwd, this.target)) {
            .err => |e| {
                if (e.getErrno() == .NOTDIR) {
                    this.err = e.withPath(this.target);
                } else this.err = e;
            },
            else => {},
        }
    }

    pub fn moveInDir(this: *@This(), src: [:0]const u8, buf: *bun.PathBuffer) bool {
        const path_in_dir_ = bun.path.normalizeBuf(ResolvePath.basename(src), buf, .auto);
        if (path_in_dir_.len + 1 >= buf.len) {
            this.err = Syscall.Error.fromCode(bun.C.E.NAMETOOLONG, .rename);
            return false;
        }
        buf[path_in_dir_.len] = 0;
        const path_in_dir = buf[0..path_in_dir_.len :0];

        switch (Syscall.renameat(this.cwd, src, this.target_fd.?, path_in_dir)) {
            .err => |e| {
                const target_path = ResolvePath.joinZ(&[_][]const u8{
                    this.target,
                    ResolvePath.basename(src),
                }, .auto);

                this.err = e.withPath(bun.default_allocator.dupeZ(u8, target_path[0..]) catch bun.outOfMemory());
                return false;
            },
            else => {},
        }

        return true;
    }

    fn moveMultipleIntoDir(this: *@This()) void {
        var buf: bun.PathBuffer = undefined;
        var fixed_alloc = std.heap.FixedBufferAllocator.init(buf[0..bun.MAX_PATH_BYTES]);

        for (this.sources) |src_raw| {
            if (this.error_signal.load(.seq_cst)) return;
            defer fixed_alloc.reset();

            const src = src_raw[0..std.mem.len(src_raw) :0];
            if (!this.moveInDir(src, &buf)) {
                return;
            }
        }
    }

    /// From the man pages of `mv`:
    /// ```txt
    /// As the rename(2) call does not work across file systems, mv uses cp(1) and rm(1) to accomplish the move.  The effect is equivalent to:
    ///     rm -f destination_path && \
    ///     cp -pRP source_file destination && \
    ///     rm -rf source_file
    /// ```
    fn moveAcrossFilesystems(this: *@This(), src: [:0]const u8, dest: [:0]const u8) void {
        _ = this;
        _ = src;
        _ = dest;

        // TODO
    }

    pub fn runFromMainThread(this: *@This()) void {
        this.mv.batchedMoveTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }
};

pub fn start(this: *Mv) Maybe(void) {
    return this.next();
}

pub fn writeFailingError(this: *Mv, buf: []const u8, exit_code: ExitCode) Maybe(void) {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .{ .waiting_write_err = .{ .exit_code = exit_code } };
        this.bltn().stderr.enqueue(this, buf, safeguard);
        return Maybe(void).success;
    }

    _ = this.bltn().writeNoIO(.stderr, buf);

    this.bltn().done(exit_code);
    return Maybe(void).success;
}

pub fn next(this: *Mv) Maybe(void) {
    while (!(this.state == .done or this.state == .err)) {
        switch (this.state) {
            .idle => {
                if (this.parseOpts().asErr()) |e| {
                    const buf = switch (e) {
                        .illegal_option => |opt_str| this.bltn().fmtErrorArena(.mv, "illegal option -- {s}\n", .{opt_str}),
                        .show_usage => Builtin.Kind.mv.usageString(),
                    };

                    return this.writeFailingError(buf, 1);
                }
                this.state = .{
                    .check_target = .{
                        .task = ShellMvCheckTargetTask{
                            .mv = this,
                            .cwd = this.bltn().parentCmd().base.shell.cwd_fd,
                            .target = this.args.target,
                            .task = .{
                                .event_loop = this.bltn().parentCmd().base.eventLoop(),
                                .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.bltn().parentCmd().base.eventLoop()),
                            },
                        },
                        .state = .running,
                    },
                };
                this.state.check_target.task.task.schedule();
                return Maybe(void).success;
            },
            .check_target => {
                if (this.state.check_target.state == .running) return Maybe(void).success;
                const check_target = &this.state.check_target;

                if (comptime bun.Environment.allow_assert) {
                    assert(check_target.task.result != null);
                }

                const maybe_fd: ?bun.FileDescriptor = switch (check_target.task.result.?) {
                    .err => |e| brk: {
                        switch (e.getErrno()) {
                            bun.C.E.NOENT => {
                                // Means we are renaming entry, not moving to a directory
                                if (this.args.sources.len == 1) break :brk null;

                                const buf = this.bltn().fmtErrorArena(.mv, "{s}: No such file or directory\n", .{this.args.target});
                                return this.writeFailingError(buf, 1);
                            },
                            else => {
                                const sys_err = e.toShellSystemError();
                                const buf = this.bltn().fmtErrorArena(.mv, "{s}: {s}\n", .{ sys_err.path.byteSlice(), sys_err.message.byteSlice() });
                                return this.writeFailingError(buf, 1);
                            },
                        }
                    },
                    .result => |maybe_fd| maybe_fd,
                };

                // Trying to move multiple files into a file
                if (maybe_fd == null and this.args.sources.len > 1) {
                    const buf = this.bltn().fmtErrorArena(.mv, "{s} is not a directory\n", .{this.args.target});
                    return this.writeFailingError(buf, 1);
                }

                const count_per_task = ShellMvBatchedTask.BATCH_SIZE;

                const task_count = brk: {
                    const sources_len: f64 = @floatFromInt(this.args.sources.len);
                    const batch_size: f64 = @floatFromInt(count_per_task);
                    const task_count: usize = @intFromFloat(@ceil(sources_len / batch_size));
                    break :brk task_count;
                };

                this.args.target_fd = maybe_fd;
                const cwd_fd = this.bltn().parentCmd().base.shell.cwd_fd;
                const tasks = this.bltn().arena.allocator().alloc(ShellMvBatchedTask, task_count) catch bun.outOfMemory();
                // Initialize tasks
                {
                    var i: usize = 0;
                    while (i < tasks.len) : (i += 1) {
                        const start_idx = i * count_per_task;
                        const end_idx = @min(start_idx + count_per_task, this.args.sources.len);
                        const sources = this.args.sources[start_idx..end_idx];

                        tasks[i] = ShellMvBatchedTask{
                            .mv = this,
                            .cwd = cwd_fd,
                            .target = this.args.target,
                            .target_fd = this.args.target_fd,
                            .sources = sources,
                            // We set this later
                            .error_signal = undefined,
                            .task = .{
                                .event_loop = this.bltn().parentCmd().base.eventLoop(),
                                .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.bltn().parentCmd().base.eventLoop()),
                            },
                            .event_loop = this.bltn().parentCmd().base.eventLoop(),
                        };
                    }
                }

                this.state = .{
                    .executing = .{
                        .task_count = task_count,
                        .error_signal = std.atomic.Value(bool).init(false),
                        .tasks = tasks,
                    },
                };

                for (this.state.executing.tasks) |*t| {
                    t.error_signal = &this.state.executing.error_signal;
                    t.task.schedule();
                }

                return Maybe(void).success;
            },
            // Shouldn't happen
            .executing => {},
            .waiting_write_err => {
                return Maybe(void).success;
            },
            .done, .err => unreachable,
        }
    }

    switch (this.state) {
        .done => this.bltn().done(0),
        else => this.bltn().done(1),
    }

    return Maybe(void).success;
}

pub fn onIOWriterChunk(this: *Mv, _: usize, e: ?JSC.SystemError) void {
    defer if (e) |err| err.deref();
    switch (this.state) {
        .waiting_write_err => {
            if (e != null) {
                this.state = .err;
                _ = this.next();
                return;
            }
            this.bltn().done(this.state.waiting_write_err.exit_code);
            return;
        },
        else => @panic("Invalid state"),
    }
}

pub fn checkTargetTaskDone(this: *Mv, task: *ShellMvCheckTargetTask) void {
    _ = task;

    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .check_target);
        assert(this.state.check_target.task.result != null);
    }

    this.state.check_target.state = .done;
    _ = this.next();
    return;
}

pub fn batchedMoveTaskDone(this: *Mv, task: *ShellMvBatchedTask) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .executing);
        assert(this.state.executing.tasks_done < this.state.executing.task_count);
    }

    var exec = &this.state.executing;

    if (task.err) |err| {
        exec.error_signal.store(true, .seq_cst);
        if (exec.err == null) {
            exec.err = err;
        } else {
            bun.default_allocator.free(err.path);
        }
    }

    exec.tasks_done += 1;
    if (exec.tasks_done >= exec.task_count) {
        if (exec.err) |err| {
            const e = err.toShellSystemError();
            const buf = this.bltn().fmtErrorArena(.mv, "{}: {}\n", .{ e.path, e.message });
            _ = this.writeFailingError(buf, err.errno);
            return;
        }
        this.state = .done;

        _ = this.next();
        return;
    }
}

pub fn deinit(this: *Mv) void {
    if (this.args.target_fd != null and this.args.target_fd.? != bun.invalid_fd) {
        _ = Syscall.close(this.args.target_fd.?);
    }
}

const Opts = struct {
    /// `-f`
    ///
    /// Do not prompt for confirmation before overwriting the destination path.  (The -f option overrides any previous -i or -n options.)
    force_overwrite: bool = true,
    /// `-h`
    ///
    /// If the target operand is a symbolic link to a directory, do not follow it.  This causes the mv utility to rename the file source to the destination path target rather than moving source into the
    /// directory referenced by target.
    no_dereference: bool = false,
    /// `-i`
    ///
    /// Cause mv to write a prompt to standard error before moving a file that would overwrite an existing file.  If the response from the standard input begins with the character ‘y’ or ‘Y’, the move is
    /// attempted.  (The -i option overrides any previous -f or -n options.)
    interactive_mode: bool = false,
    /// `-n`
    ///
    /// Do not overwrite an existing file.  (The -n option overrides any previous -f or -i options.)
    no_overwrite: bool = false,
    /// `-v`
    ///
    /// Cause mv to be verbose, showing files after they are moved.
    verbose_output: bool = false,

    const ParseError = union(enum) {
        illegal_option: []const u8,
        show_usage,
    };
};

pub fn parseOpts(this: *Mv) Result(void, Opts.ParseError) {
    const filepath_args = switch (this.parseFlags()) {
        .ok => |args| args,
        .err => |e| return .{ .err = e },
    };

    if (filepath_args.len < 2) {
        return .{ .err = .show_usage };
    }

    this.args.sources = filepath_args[0 .. filepath_args.len - 1];
    this.args.target = std.mem.span(filepath_args[filepath_args.len - 1]);

    return .ok;
}

pub fn parseFlags(this: *Mv) Result([]const [*:0]const u8, Opts.ParseError) {
    const args = this.bltn().argsSlice();
    var idx: usize = 0;
    if (args.len == 0) {
        return .{ .err = .show_usage };
    }

    while (idx < args.len) : (idx += 1) {
        const flag = args[idx];
        switch (this.parseFlag(flag[0..std.mem.len(flag)])) {
            .done => {
                const filepath_args = args[idx..];
                return .{ .ok = filepath_args };
            },
            .continue_parsing => {},
            .illegal_option => |opt_str| return .{ .err = .{ .illegal_option = opt_str } },
        }
    }

    return .{ .err = .show_usage };
}

pub fn parseFlag(this: *Mv, flag: []const u8) union(enum) { continue_parsing, done, illegal_option: []const u8 } {
    if (flag.len == 0) return .done;
    if (flag[0] != '-') return .done;

    const small_flags = flag[1..];
    for (small_flags) |char| {
        switch (char) {
            'f' => {
                this.opts.force_overwrite = true;
                this.opts.interactive_mode = false;
                this.opts.no_overwrite = false;
            },
            'h' => {
                this.opts.no_dereference = true;
            },
            'i' => {
                this.opts.interactive_mode = true;
                this.opts.force_overwrite = false;
                this.opts.no_overwrite = false;
            },
            'n' => {
                this.opts.no_overwrite = true;
                this.opts.force_overwrite = false;
                this.opts.interactive_mode = false;
            },
            'v' => {
                this.opts.verbose_output = true;
            },
            else => {
                return .{ .illegal_option = "-" };
            },
        }
    }

    return .continue_parsing;
}

pub inline fn bltn(this: *Mv) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("mv", this));
    return @fieldParentPtr("impl", impl);
}

// --
const debug = bun.Output.scoped(.ShellCat, true);
const Mv = @This();

const Syscall = bun.sys;
const ShellTask = interpreter.ShellTask;
const assert = bun.assert;
const std = @import("std");
const bun = @import("root").bun;
const shell = bun.shell;
const ExitCode = shell.ExitCode;
const IOReader = shell.IOReader;
const IOWriter = shell.IOWriter;
const IO = shell.IO;
const IOVector = shell.IOVector;
const IOVectorSlice = shell.IOVectorSlice;
const IOVectorSliceMut = shell.IOVectorSliceMut;
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;

const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;
const ParseError = interpreter.ParseError;
const ParseFlagResult = interpreter.ParseFlagResult;
const ReadChunkAction = interpreter.ReadChunkAction;
const FlagParser = interpreter.FlagParser;
const ShellSyscall = interpreter.ShellSyscall;
const unsupportedFlag = interpreter.unsupportedFlag;
const ResolvePath = bun.path;
