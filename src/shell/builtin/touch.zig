opts: Opts = .{},
state: union(enum) {
    idle,
    exec: struct {
        started: bool = false,
        tasks_count: usize = 0,
        tasks_done: usize = 0,
        output_done: usize = 0,
        output_waiting: usize = 0,
        started_output_queue: bool = false,
        args: []const [*:0]const u8,
        err: ?JSC.SystemError = null,
    },
    waiting_write_err,
    done,
} = .idle,

pub fn format(this: *const Touch, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
    _ = fmt; // autofix
    _ = opts; // autofix
    try writer.print("Touch(0x{x}, state={s})", .{ @intFromPtr(this), @tagName(this.state) });
}

pub fn deinit(this: *Touch) void {
    log("{} deinit", .{this});
}

pub fn start(this: *Touch) Yield {
    const filepath_args = switch (this.opts.parse(this.bltn().argsSlice())) {
        .ok => |filepath_args| filepath_args,
        .err => |e| {
            const buf = switch (e) {
                .illegal_option => |opt_str| this.bltn().fmtErrorArena(.touch, "illegal option -- {s}\n", .{opt_str}),
                .show_usage => Builtin.Kind.touch.usageString(),
                .unsupported => |unsupported| this.bltn().fmtErrorArena(.touch, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
            };

            return this.writeFailingError(buf, 1);
        },
    } orelse {
        return this.writeFailingError(Builtin.Kind.touch.usageString(), 1);
    };

    this.state = .{
        .exec = .{
            .args = filepath_args,
        },
    };

    return this.next();
}

pub fn next(this: *Touch) Yield {
    switch (this.state) {
        .idle => @panic("Invalid state"),
        .exec => {
            var exec = &this.state.exec;
            if (exec.started) {
                if (this.state.exec.tasks_done >= this.state.exec.tasks_count and this.state.exec.output_done >= this.state.exec.output_waiting) {
                    const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                    this.state = .done;
                    return this.bltn().done(exit_code);
                }
                return .suspended;
            }

            exec.started = true;
            exec.tasks_count = exec.args.len;

            for (exec.args) |dir_to_mk_| {
                const dir_to_mk = dir_to_mk_[0..std.mem.len(dir_to_mk_) :0];
                var task = ShellTouchTask.create(this, this.opts, dir_to_mk, this.bltn().parentCmd().base.shell.cwdZ());
                task.schedule();
            }
            return .suspended;
        },
        .waiting_write_err => return .failed,
        .done => return this.bltn().done(0),
    }
}

pub fn onIOWriterChunk(this: *Touch, _: usize, e: ?JSC.SystemError) Yield {
    if (this.state == .waiting_write_err) {
        return this.bltn().done(1);
    }

    if (e) |err| err.deref();

    return this.next();
}

pub fn writeFailingError(this: *Touch, buf: []const u8, exit_code: ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);

    return this.bltn().done(exit_code);
}

pub fn onShellTouchTaskDone(this: *Touch, task: *ShellTouchTask) void {
    log("{} onShellTouchTaskDone {} tasks_done={d} tasks_count={d}", .{ this, task, this.state.exec.tasks_done, this.state.exec.tasks_count });

    defer bun.default_allocator.destroy(task);
    this.state.exec.tasks_done += 1;
    const err = task.err;

    if (err) |e| {
        const output_task: *ShellTouchOutputTask = bun.new(ShellTouchOutputTask, .{
            .parent = this,
            .output = .{ .arrlist = .{} },
            .state = .waiting_write_err,
        });
        const error_string = this.bltn().taskErrorToString(.touch, e);
        this.state.exec.err = e;
        output_task.start(error_string).run();
        return;
    }

    this.next().run();
}

pub const ShellTouchOutputTask = OutputTask(Touch, .{
    .writeErr = ShellTouchOutputTaskVTable.writeErr,
    .onWriteErr = ShellTouchOutputTaskVTable.onWriteErr,
    .writeOut = ShellTouchOutputTaskVTable.writeOut,
    .onWriteOut = ShellTouchOutputTaskVTable.onWriteOut,
    .onDone = ShellTouchOutputTaskVTable.onDone,
});

const ShellTouchOutputTaskVTable = struct {
    pub fn writeErr(this: *Touch, childptr: anytype, errbuf: []const u8) ?Yield {
        if (this.bltn().stderr.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            return this.bltn().stderr.enqueue(childptr, errbuf, safeguard);
        }
        _ = this.bltn().writeNoIO(.stderr, errbuf);
        return null;
    }

    pub fn onWriteErr(this: *Touch) void {
        this.state.exec.output_done += 1;
    }

    pub fn writeOut(this: *Touch, childptr: anytype, output: *OutputSrc) ?Yield {
        if (this.bltn().stdout.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            const slice = output.slice();
            log("THE SLICE: {d} {s}", .{ slice.len, slice });
            return this.bltn().stdout.enqueue(childptr, slice, safeguard);
        }
        _ = this.bltn().writeNoIO(.stdout, output.slice());
        return null;
    }

    pub fn onWriteOut(this: *Touch) void {
        this.state.exec.output_done += 1;
    }

    pub fn onDone(this: *Touch) Yield {
        return this.next();
    }
};

pub const ShellTouchTask = struct {
    touch: *Touch,

    opts: Opts,
    filepath: [:0]const u8,
    cwd_path: [:0]const u8,

    err: ?JSC.SystemError = null,
    task: JSC.WorkPoolTask = .{ .callback = &runFromThreadPool },
    event_loop: JSC.EventLoopHandle,
    concurrent_task: JSC.EventLoopTask,

    pub fn format(this: *const ShellTouchTask, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        _ = fmt; // autofix
        _ = opts; // autofix
        try writer.print("ShellTouchTask(0x{x}, filepath={s})", .{ @intFromPtr(this), this.filepath });
    }

    pub fn deinit(this: *ShellTouchTask) void {
        if (this.err) |*e| {
            e.deref();
        }
        bun.default_allocator.destroy(this);
    }

    pub fn create(touch: *Touch, opts: Opts, filepath: [:0]const u8, cwd_path: [:0]const u8) *ShellTouchTask {
        const task = bun.default_allocator.create(ShellTouchTask) catch bun.outOfMemory();
        task.* = ShellTouchTask{
            .touch = touch,
            .opts = opts,
            .cwd_path = cwd_path,
            .filepath = filepath,
            .event_loop = touch.bltn().eventLoop(),
            .concurrent_task = JSC.EventLoopTask.fromEventLoop(touch.bltn().eventLoop()),
        };
        return task;
    }

    pub fn schedule(this: *@This()) void {
        debug("{} schedule", .{this});
        WorkPool.schedule(&this.task);
    }

    pub fn runFromMainThread(this: *@This()) void {
        debug("{} runFromJS", .{this});
        this.touch.onShellTouchTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }

    fn runFromThreadPool(task: *JSC.WorkPoolTask) void {
        var this: *ShellTouchTask = @fieldParentPtr("task", task);
        debug("{} runFromThreadPool", .{this});

        // We have to give an absolute path
        const filepath: [:0]const u8 = brk: {
            if (ResolvePath.Platform.auto.isAbsolute(this.filepath)) break :brk this.filepath;
            const parts: []const []const u8 = &.{
                this.cwd_path[0..],
                this.filepath[0..],
            };
            break :brk ResolvePath.joinZ(parts, .auto);
        };

        var node_fs = JSC.Node.fs.NodeFS{};
        const milliseconds: f64 = @floatFromInt(std.time.milliTimestamp());
        const atime: JSC.Node.TimeLike = if (bun.Environment.isWindows) milliseconds / 1000.0 else JSC.Node.TimeLike{
            .sec = @intFromFloat(@divFloor(milliseconds, std.time.ms_per_s)),
            .nsec = @intFromFloat(@mod(milliseconds, std.time.ms_per_s) * std.time.ns_per_ms),
        };
        const mtime = atime;
        const args = JSC.Node.fs.Arguments.Utimes{
            .atime = atime,
            .mtime = mtime,
            .path = .{ .string = bun.PathString.init(filepath) },
        };
        if (node_fs.utimes(args, .sync).asErr()) |err| out: {
            if (err.getErrno() == .NOENT) {
                const perm = 0o664;
                switch (Syscall.open(filepath, bun.O.CREAT | bun.O.WRONLY, perm)) {
                    .result => |fd| {
                        fd.close();
                        break :out;
                    },
                    .err => |e| {
                        this.err = e.withPath(bun.default_allocator.dupe(u8, filepath) catch bun.outOfMemory()).toShellSystemError();
                        break :out;
                    },
                }
            }
            this.err = err.withPath(bun.default_allocator.dupe(u8, filepath) catch bun.outOfMemory()).toShellSystemError();
        }

        if (this.event_loop == .js) {
            this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }
};

const Opts = struct {
    /// -a
    ///
    /// change only the access time
    access_time_only: bool = false,

    /// -c, --no-create
    ///
    /// do not create any files
    no_create: bool = false,

    /// -d, --date=STRING
    ///
    /// parse STRING and use it instead of current time
    date: ?[]const u8 = null,

    /// -h, --no-dereference
    ///
    /// affect each symbolic link instead of any referenced file
    /// (useful only on systems that can change the timestamps of a symlink)
    no_dereference: bool = false,

    /// -m
    ///
    /// change only the modification time
    modification_time_only: bool = false,

    /// -r, --reference=FILE
    ///
    /// use this file's times instead of current time
    reference: ?[]const u8 = null,

    /// -t STAMP
    ///
    /// use [[CC]YY]MMDDhhmm[.ss] instead of current time
    timestamp: ?[]const u8 = null,

    /// --time=WORD
    ///
    /// change the specified time:
    /// WORD is access, atime, or use: equivalent to -a
    /// WORD is modify or mtime: equivalent to -m
    time: ?[]const u8 = null,

    const Parse = FlagParser(*@This());

    pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
        return Parse.parseFlags(opts, args);
    }

    pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
        _ = this;
        if (bun.strings.eqlComptime(flag, "--no-create")) {
            return .{
                .unsupported = unsupportedFlag("--no-create"),
            };
        }

        if (bun.strings.eqlComptime(flag, "--date")) {
            return .{
                .unsupported = unsupportedFlag("--date"),
            };
        }

        if (bun.strings.eqlComptime(flag, "--reference")) {
            return .{
                .unsupported = unsupportedFlag("--reference=FILE"),
            };
        }

        if (bun.strings.eqlComptime(flag, "--time")) {
            return .{
                .unsupported = unsupportedFlag("--reference=FILE"),
            };
        }

        return null;
    }

    pub fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
        _ = this;
        switch (char) {
            'a' => {
                return .{ .unsupported = unsupportedFlag("-a") };
            },
            'c' => {
                return .{ .unsupported = unsupportedFlag("-c") };
            },
            'd' => {
                return .{ .unsupported = unsupportedFlag("-d") };
            },
            'h' => {
                return .{ .unsupported = unsupportedFlag("-h") };
            },
            'm' => {
                return .{ .unsupported = unsupportedFlag("-m") };
            },
            'r' => {
                return .{ .unsupported = unsupportedFlag("-r") };
            },
            't' => {
                return .{ .unsupported = unsupportedFlag("-t") };
            },
            else => {
                return .{ .illegal_option = smallflags[1 + i ..] };
            },
        }

        return null;
    }
};

pub inline fn bltn(this: *Touch) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("touch", this));
    return @fieldParentPtr("impl", impl);
}

// --
const debug = bun.Output.scoped(.ShellTouch, true);
const Touch = @This();
const log = debug;
const std = @import("std");
const bun = @import("bun");
const Yield = bun.shell.Yield;
const shell = bun.shell;
const ExitCode = shell.ExitCode;
const JSC = bun.JSC;
const WorkPool = bun.JSC.WorkPool;
const ResolvePath = bun.path;
const Syscall = bun.sys;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;
const ParseError = interpreter.ParseError;
const ParseFlagResult = interpreter.ParseFlagResult;
const FlagParser = interpreter.FlagParser;
const unsupportedFlag = interpreter.unsupportedFlag;
const OutputTask = interpreter.OutputTask;
const OutputSrc = interpreter.OutputSrc;
