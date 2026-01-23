const Mkdir = @This();

opts: Opts = .{},
state: union(enum) {
    idle,
    exec: struct {
        started: bool = false,
        tasks_count: usize = 0,
        tasks_done: usize = 0,
        output_waiting: u16 = 0,
        output_done: u16 = 0,
        args: []const [*:0]const u8,
        err: ?jsc.SystemError = null,
    },
    waiting_write_err,
    done,
} = .idle,

pub fn onIOWriterChunk(this: *Mkdir, _: usize, e: ?jsc.SystemError) Yield {
    if (e) |err| err.deref();

    switch (this.state) {
        .waiting_write_err => return this.bltn().done(1),
        .exec => {
            this.state.exec.output_done += 1;
        },
        .idle, .done => @panic("Invalid state"),
    }

    return this.next();
}

pub fn writeFailingError(this: *Mkdir, buf: []const u8, exit_code: ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);
    // if (this.bltn().writeNoIO(.stderr, buf).asErr()) |e| {
    //     return .{ .err = e };
    // }

    return this.bltn().done(exit_code);
}

pub fn start(this: *Mkdir) Yield {
    const filepath_args = switch (this.opts.parse(this.bltn().argsSlice())) {
        .ok => |filepath_args| filepath_args,
        .err => |e| {
            const buf = switch (e) {
                .illegal_option => |opt_str| this.bltn().fmtErrorArena(.mkdir, "illegal option -- {s}\n", .{opt_str}),
                .show_usage => Builtin.Kind.mkdir.usageString(),
                .unsupported => |unsupported| this.bltn().fmtErrorArena(.mkdir, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
            };

            return this.writeFailingError(buf, 1);
        },
    } orelse {
        return this.writeFailingError(Builtin.Kind.mkdir.usageString(), 1);
    };

    this.state = .{
        .exec = .{
            .args = filepath_args,
        },
    };

    return this.next();
}

pub fn next(this: *Mkdir) Yield {
    switch (this.state) {
        .idle => @panic("Invalid state"),
        .exec => {
            var exec = &this.state.exec;
            if (exec.started) {
                if (this.state.exec.tasks_done >= this.state.exec.tasks_count and this.state.exec.output_done >= this.state.exec.output_waiting) {
                    const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                    if (this.state.exec.err) |e| e.deref();
                    this.state = .done;
                    return this.bltn().done(exit_code);
                }
                return .suspended;
            }

            exec.started = true;
            exec.tasks_count = exec.args.len;

            for (exec.args) |dir_to_mk_| {
                const dir_to_mk = dir_to_mk_[0..std.mem.len(dir_to_mk_) :0];
                var task = ShellMkdirTask.create(this, this.opts, dir_to_mk, this.bltn().parentCmd().base.shell.cwdZ());
                task.schedule();
            }
            return .suspended;
        },
        .waiting_write_err => return .failed,
        .done => return this.bltn().done(0),
    }
}

pub fn onShellMkdirTaskDone(this: *Mkdir, task: *ShellMkdirTask) void {
    defer task.deinit();
    this.state.exec.tasks_done += 1;
    var output = task.takeOutput();
    const err = task.err;
    const output_task: *ShellMkdirOutputTask = bun.new(ShellMkdirOutputTask, .{
        .parent = this,
        .output = .{ .arrlist = output.moveToUnmanaged() },
        .state = .waiting_write_err,
    });

    if (err) |e| {
        const error_string = this.bltn().taskErrorToString(.mkdir, e);
        this.state.exec.err = e;
        output_task.start(error_string).run();
        return;
    }
    output_task.start(null).run();
}

pub const ShellMkdirOutputTask = OutputTask(Mkdir, .{
    .writeErr = ShellMkdirOutputTaskVTable.writeErr,
    .onWriteErr = ShellMkdirOutputTaskVTable.onWriteErr,
    .writeOut = ShellMkdirOutputTaskVTable.writeOut,
    .onWriteOut = ShellMkdirOutputTaskVTable.onWriteOut,
    .onDone = ShellMkdirOutputTaskVTable.onDone,
});

const ShellMkdirOutputTaskVTable = struct {
    pub fn writeErr(this: *Mkdir, childptr: anytype, errbuf: []const u8) ?Yield {
        if (this.bltn().stderr.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            return this.bltn().stderr.enqueue(childptr, errbuf, safeguard);
        }
        _ = this.bltn().writeNoIO(.stderr, errbuf);
        return null;
    }

    pub fn onWriteErr(this: *Mkdir) void {
        this.state.exec.output_done += 1;
    }

    pub fn writeOut(this: *Mkdir, childptr: anytype, output: *OutputSrc) ?Yield {
        if (this.bltn().stdout.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            const slice = output.slice();
            log("THE SLICE: {d} {s}", .{ slice.len, slice });
            return this.bltn().stdout.enqueue(childptr, slice, safeguard);
        }
        _ = this.bltn().writeNoIO(.stdout, output.slice());
        return null;
    }

    pub fn onWriteOut(this: *Mkdir) void {
        this.state.exec.output_done += 1;
    }

    pub fn onDone(this: *Mkdir) Yield {
        return this.next();
    }
};

pub fn deinit(this: *Mkdir) void {
    _ = this;
}

pub const ShellMkdirTask = struct {
    mkdir: *Mkdir,

    opts: Opts,
    filepath: [:0]const u8,
    cwd_path: [:0]const u8,
    created_directories: ArrayList(u8),

    err: ?jsc.SystemError = null,
    task: jsc.WorkPoolTask = .{ .callback = &runFromThreadPool },
    event_loop: jsc.EventLoopHandle,
    concurrent_task: jsc.EventLoopTask,

    pub fn deinit(this: *ShellMkdirTask) void {
        this.created_directories.deinit();
        bun.default_allocator.destroy(this);
    }

    fn takeOutput(this: *ShellMkdirTask) ArrayList(u8) {
        const out = this.created_directories;
        this.created_directories = ArrayList(u8).init(bun.default_allocator);
        return out;
    }

    pub fn format(this: *const ShellMkdirTask, writer: *std.Io.Writer) !void {
        try writer.print("ShellMkdirTask(0x{x}, filepath={s})", .{ @intFromPtr(this), this.filepath });
    }

    pub fn create(
        mkdir: *Mkdir,
        opts: Opts,
        filepath: [:0]const u8,
        cwd_path: [:0]const u8,
    ) *ShellMkdirTask {
        const task = bun.handleOom(bun.default_allocator.create(ShellMkdirTask));
        const evtloop = mkdir.bltn().parentCmd().base.eventLoop();
        task.* = ShellMkdirTask{
            .mkdir = mkdir,
            .opts = opts,
            .cwd_path = cwd_path,
            .filepath = filepath,
            .created_directories = ArrayList(u8).init(bun.default_allocator),
            .event_loop = evtloop,
            .concurrent_task = jsc.EventLoopTask.fromEventLoop(evtloop),
        };
        return task;
    }

    pub fn schedule(this: *@This()) void {
        debug("{f} schedule", .{this});
        WorkPool.schedule(&this.task);
    }

    pub fn runFromMainThread(this: *@This()) void {
        debug("{f} runFromJS", .{this});
        this.mkdir.onShellMkdirTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }

    fn runFromThreadPool(task: *jsc.WorkPoolTask) void {
        var this: *ShellMkdirTask = @fieldParentPtr("task", task);
        debug("{f} runFromThreadPool", .{this});

        // We have to give an absolute path to our mkdir
        // implementation for it to work with cwd
        const filepath: [:0]const u8 = brk: {
            if (ResolvePath.Platform.auto.isAbsolute(this.filepath)) break :brk this.filepath;
            const parts: []const []const u8 = &.{
                this.cwd_path[0..],
                this.filepath[0..],
            };
            break :brk ResolvePath.joinZ(parts, .auto);
        };

        var node_fs = jsc.Node.fs.NodeFS{};
        // Recursive
        if (this.opts.parents) {
            const args = jsc.Node.fs.Arguments.Mkdir{
                .path = jsc.Node.PathLike{ .string = bun.PathString.init(filepath) },
                .recursive = true,
                .always_return_none = true,
            };

            var vtable = MkdirVerboseVTable{ .inner = this, .active = this.opts.verbose };

            switch (node_fs.mkdirRecursiveImpl(args, *MkdirVerboseVTable, &vtable)) {
                .result => {},
                .err => |e| {
                    this.err = e.withPath(bun.handleOom(bun.default_allocator.dupe(u8, filepath))).toShellSystemError();
                    std.mem.doNotOptimizeAway(&node_fs);
                },
            }
        } else {
            const args = jsc.Node.fs.Arguments.Mkdir{
                .path = jsc.Node.PathLike{ .string = bun.PathString.init(filepath) },
                .recursive = false,
                .always_return_none = true,
            };
            switch (node_fs.mkdirNonRecursive(args)) {
                .result => {
                    if (this.opts.verbose) {
                        bun.handleOom(this.created_directories.appendSlice(filepath[0..filepath.len]));
                        bun.handleOom(this.created_directories.append('\n'));
                    }
                },
                .err => |e| {
                    this.err = e.withPath(bun.handleOom(bun.default_allocator.dupe(u8, filepath))).toShellSystemError();
                    std.mem.doNotOptimizeAway(&node_fs);
                },
            }
        }

        if (this.event_loop == .js) {
            this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    const MkdirVerboseVTable = struct {
        inner: *ShellMkdirTask,
        active: bool,

        pub fn onCreateDir(vtable: *@This(), dirpath: bun.OSPathSliceZ) void {
            if (!vtable.active) return;
            if (bun.Environment.isWindows) {
                var buf: bun.PathBuffer = undefined;
                const str = bun.strings.fromWPath(&buf, dirpath[0..dirpath.len]);
                bun.handleOom(vtable.inner.created_directories.appendSlice(str));
                bun.handleOom(vtable.inner.created_directories.append('\n'));
            } else {
                bun.handleOom(vtable.inner.created_directories.appendSlice(dirpath));
                bun.handleOom(vtable.inner.created_directories.append('\n'));
            }
            return;
        }
    };
};

const Opts = struct {
    /// -m, --mode
    ///
    /// set file mode (as in chmod), not a=rwx - umask
    mode: ?u32 = null,

    /// -p, --parents
    ///
    /// no error if existing, make parent directories as needed,
    /// with their file modes unaffected by any -m option.
    parents: bool = false,

    /// -v, --verbose
    ///
    /// print a message for each created directory
    verbose: bool = false,

    const Parse = FlagParser(*@This());

    pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
        return Parse.parseFlags(opts, args);
    }

    pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
        if (bun.strings.eqlComptime(flag, "--mode")) {
            return .{ .unsupported = "--mode" };
        } else if (bun.strings.eqlComptime(flag, "--parents")) {
            this.parents = true;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--vebose")) {
            this.verbose = true;
            return .continue_parsing;
        }

        return null;
    }

    pub fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
        switch (char) {
            'm' => {
                return .{ .unsupported = "-m " };
            },
            'p' => {
                this.parents = true;
            },
            'v' => {
                this.verbose = true;
            },
            else => {
                return .{ .illegal_option = smallflags[1 + i ..] };
            },
        }

        return null;
    }
};

pub inline fn bltn(this: *Mkdir) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("mkdir", this));
    return @fieldParentPtr("impl", impl);
}

// --
const debug = bun.Output.scoped(.ShellMkdir, .hidden);

const log = debug;

const std = @import("std");
const ArrayList = std.array_list.Managed;

const interpreter = @import("../interpreter.zig");
const FlagParser = interpreter.FlagParser;
const Interpreter = interpreter.Interpreter;
const OutputSrc = interpreter.OutputSrc;
const OutputTask = interpreter.OutputTask;
const ParseError = interpreter.ParseError;
const ParseFlagResult = interpreter.ParseFlagResult;

const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;

const bun = @import("bun");
const ResolvePath = bun.path;

const jsc = bun.jsc;
const WorkPool = bun.jsc.WorkPool;

const shell = bun.shell;
const ExitCode = shell.ExitCode;
const Yield = bun.shell.Yield;
