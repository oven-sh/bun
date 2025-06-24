opts: Opts,
state: union(enum) {
    idle,
    parse_opts: struct {
        args_slice: []const [*:0]const u8,
        idx: u32 = 0,
        state: union(enum) {
            normal,
            wait_write_err,
        } = .normal,
    },
    exec: struct {
        // task: RmTask,
        filepath_args: []const [*:0]const u8,
        total_tasks: usize,
        err: ?Syscall.Error = null,
        lock: bun.Mutex = bun.Mutex{},
        error_signal: std.atomic.Value(bool) = .{ .raw = false },
        output_done: std.atomic.Value(usize) = .{ .raw = 0 },
        output_count: std.atomic.Value(usize) = .{ .raw = 0 },
        state: union(enum) {
            idle,
            waiting: struct {
                tasks_done: usize = 0,
            },

            pub fn tasksDone(this: *@This()) usize {
                return switch (this.*) {
                    .idle => 0,
                    .waiting => this.waiting.tasks_done,
                };
            }
        },

        fn incrementOutputCount(this: *@This(), comptime thevar: @Type(.enum_literal)) void {
            var atomicvar = &@field(this, @tagName(thevar));
            const result = atomicvar.fetchAdd(1, .seq_cst);
            log("[rm] {s}: {d} + 1", .{ @tagName(thevar), result });
            return;
        }

        fn getOutputCount(this: *@This(), comptime thevar: @Type(.enum_literal)) usize {
            var atomicvar = &@field(this, @tagName(thevar));
            return atomicvar.load(.seq_cst);
        }
    },
    done: struct { exit_code: ExitCode },
    waiting_write_err,
    err: ExitCode,
} = .idle,

pub const Opts = struct {
    /// `--no-preserve-root` / `--preserve-root`
    ///
    /// If set to false, then allow the recursive removal of the root directory.
    /// Safety feature to prevent accidental deletion of the root directory.
    preserve_root: bool = true,

    /// `-f`, `--force`
    ///
    /// Ignore nonexistent files and arguments, never prompt.
    force: bool = false,

    /// Configures how the user should be prompted on removal of files.
    prompt_behaviour: PromptBehaviour = .never,

    /// `-r`, `-R`, `--recursive`
    ///
    /// Remove directories and their contents recursively.
    recursive: bool = false,

    /// `-v`, `--verbose`
    ///
    /// Explain what is being done (prints which files/dirs are being deleted).
    verbose: bool = false,

    /// `-d`, `--dir`
    ///
    /// Remove empty directories. This option permits you to remove a directory
    /// without specifying `-r`/`-R`/`--recursive`, provided that the directory is
    /// empty.
    remove_empty_dirs: bool = false,

    const PromptBehaviour = union(enum) {
        /// `--interactive=never`
        ///
        /// Default
        never,

        /// `-I`, `--interactive=once`
        ///
        /// Once before removing more than three files, or when removing recursively.
        once: struct {
            removed_count: u32 = 0,
        },

        /// `-i`, `--interactive=always`
        ///
        /// Prompt before every removal.
        always,
    };
};

pub fn start(this: *Rm) Yield {
    return this.next();
}

pub noinline fn next(this: *Rm) Yield {
    while (this.state != .done and this.state != .err) {
        switch (this.state) {
            .waiting_write_err => return .suspended,
            .idle => {
                this.state = .{
                    .parse_opts = .{
                        .args_slice = this.bltn().argsSlice(),
                    },
                };
                continue;
            },
            .parse_opts => {
                var parse_opts = &this.state.parse_opts;
                switch (parse_opts.state) {
                    .normal => {
                        // This means there were no arguments or only
                        // flag arguments meaning no positionals, in
                        // either case we must print the usage error
                        // string
                        if (parse_opts.idx >= parse_opts.args_slice.len) {
                            const error_string = Builtin.Kind.usageString(.rm);
                            if (this.bltn().stderr.needsIO()) |safeguard| {
                                parse_opts.state = .wait_write_err;
                                return this.bltn().stderr.enqueue(this, error_string, safeguard);
                            }

                            _ = this.bltn().writeNoIO(.stderr, error_string);

                            return this.bltn().done(1);
                        }

                        const idx = parse_opts.idx;

                        const arg_raw = parse_opts.args_slice[idx];
                        const arg = arg_raw[0..std.mem.len(arg_raw)];

                        switch (parseFlag(&this.opts, this.bltn(), arg)) {
                            .continue_parsing => {
                                parse_opts.idx += 1;
                                continue;
                            },
                            .done => {
                                if (this.opts.recursive) {
                                    this.opts.remove_empty_dirs = true;
                                }

                                if (this.opts.prompt_behaviour != .never) {
                                    const buf = "rm: \"-i\" is not supported yet";
                                    if (this.bltn().stderr.needsIO()) |safeguard| {
                                        parse_opts.state = .wait_write_err;
                                        return this.bltn().stderr.enqueue(this, buf, safeguard);
                                    }

                                    _ = this.bltn().writeNoIO(.stderr, buf);
                                    return this.bltn().done(1);
                                }

                                const filepath_args_start = idx;
                                const filepath_args = parse_opts.args_slice[filepath_args_start..];

                                // Check that non of the paths will delete the root
                                {
                                    var buf: bun.PathBuffer = undefined;
                                    const cwd = switch (Syscall.getcwd(&buf)) {
                                        .err => |err| {
                                            const errbuf = this.bltn().fmtErrorArena(
                                                .rm,
                                                "{s}: {s}",
                                                .{ "getcwd", err.msg() orelse "failed to get cwd" },
                                            );
                                            return this.writeFailingError(errbuf, 1);
                                        },
                                        .result => |cwd| cwd,
                                    };

                                    for (filepath_args) |filepath| {
                                        const path = filepath[0..bun.len(filepath)];
                                        const resolved_path = if (ResolvePath.Platform.auto.isAbsolute(path)) path else bun.path.join(&[_][]const u8{ cwd, path }, .auto);
                                        const is_root = brk: {
                                            const normalized = bun.path.normalizeString(resolved_path, false, .auto);
                                            const dirname = ResolvePath.dirname(normalized, .auto);
                                            const is_root = std.mem.eql(u8, dirname, "");
                                            break :brk is_root;
                                        };

                                        if (is_root) {
                                            if (this.bltn().stderr.needsIO()) |safeguard| {
                                                parse_opts.state = .wait_write_err;
                                                return this.bltn().stderr.enqueueFmtBltn(this, .rm, "\"{s}\" may not be removed\n", .{resolved_path}, safeguard);
                                            }

                                            const error_string = this.bltn().fmtErrorArena(.rm, "\"{s}\" may not be removed\n", .{resolved_path});

                                            _ = this.bltn().writeNoIO(.stderr, error_string);

                                            return this.bltn().done(1);
                                        }
                                    }
                                }

                                const total_tasks = filepath_args.len;
                                this.state = .{
                                    .exec = .{
                                        .filepath_args = filepath_args,
                                        .total_tasks = total_tasks,
                                        .state = .idle,
                                        .output_done = std.atomic.Value(usize).init(0),
                                        .output_count = std.atomic.Value(usize).init(0),
                                    },
                                };
                                // this.state.exec.task.schedule();
                                // return Maybe(void).success;
                                continue;
                            },
                            .illegal_option => {
                                const error_string = "rm: illegal option -- -\n";
                                if (this.bltn().stderr.needsIO()) |safeguard| {
                                    parse_opts.state = .wait_write_err;
                                    return this.bltn().stderr.enqueue(this, error_string, safeguard);
                                }

                                _ = this.bltn().writeNoIO(.stderr, error_string);

                                return this.bltn().done(1);
                            },
                            .illegal_option_with_flag => {
                                const flag = arg;
                                if (this.bltn().stderr.needsIO()) |safeguard| {
                                    parse_opts.state = .wait_write_err;
                                    return this.bltn().stderr.enqueueFmtBltn(this, .rm, "illegal option -- {s}\n", .{flag[1..]}, safeguard);
                                }
                                const error_string = this.bltn().fmtErrorArena(.rm, "illegal option -- {s}\n", .{flag[1..]});

                                _ = this.bltn().writeNoIO(.stderr, error_string);

                                return this.bltn().done(1);
                            },
                        }
                    },
                    .wait_write_err => {
                        @panic("Invalid");
                        // // Errored
                        // if (parse_opts.state.wait_write_err.err) |e| {
                        //     this.state = .{ .err = e };
                        //     continue;
                        // }

                        // // Done writing
                        // if (this.state.parse_opts.state.wait_write_err.remain() == 0) {
                        //     this.state = .{ .done = .{ .exit_code = 0 } };
                        //     continue;
                        // }

                        // // yield execution to continue writing
                        // return Maybe(void).success;
                    },
                }
            },
            .exec => {
                const cwd = this.bltn().parentCmd().base.shell.cwd_fd;
                // Schedule task
                if (this.state.exec.state == .idle) {
                    this.state.exec.state = .{ .waiting = .{} };
                    for (this.state.exec.filepath_args) |root_raw| {
                        const root = root_raw[0..std.mem.len(root_raw)];
                        const root_path_string = bun.PathString.init(root[0..root.len]);
                        const is_absolute = ResolvePath.Platform.auto.isAbsolute(root);
                        var task = ShellRmTask.create(root_path_string, this, cwd, &this.state.exec.error_signal, is_absolute);
                        task.schedule();
                        // task.
                    }
                }

                // do nothing
                return .suspended;
            },
            .done, .err => unreachable,
        }
    }

    switch (this.state) {
        .done => return this.bltn().done(0),
        .err => return this.bltn().done(this.state.err),
        else => unreachable,
    }
}

pub fn onIOWriterChunk(this: *Rm, _: usize, e: ?JSC.SystemError) Yield {
    log("Rm(0x{x}).onIOWriterChunk()", .{@intFromPtr(this)});
    if (comptime bun.Environment.allow_assert) {
        assert((this.state == .parse_opts and this.state.parse_opts.state == .wait_write_err) or
            (this.state == .exec and this.state.exec.state == .waiting and this.state.exec.output_count.load(.seq_cst) > 0) or
            this.state == .waiting_write_err);
    }

    if (this.state == .exec and this.state.exec.state == .waiting) {
        log("Rm(0x{x}) output done={d} output count={d}", .{ @intFromPtr(this), this.state.exec.getOutputCount(.output_done), this.state.exec.getOutputCount(.output_count) });
        this.state.exec.incrementOutputCount(.output_done);
        if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks and this.state.exec.getOutputCount(.output_done) >= this.state.exec.getOutputCount(.output_count)) {
            const code: ExitCode = if (this.state.exec.err != null) 1 else 0;
            return this.bltn().done(code);
        }
        return .suspended;
    }

    if (e != null) {
        defer e.?.deref();
        this.state = .{ .err = @intFromEnum(e.?.getErrno()) };
        return this.bltn().done(e.?.getErrno());
    }

    return this.bltn().done(1);
}

pub fn deinit(this: *Rm) void {
    _ = this;
}

pub inline fn bltn(this: *Rm) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("rm", this));
    return @fieldParentPtr("impl", impl);
}

const ParseFlagsResult = enum {
    continue_parsing,
    done,
    illegal_option,
    illegal_option_with_flag,
};

fn parseFlag(this: *Opts, _: *Builtin, flag: []const u8) ParseFlagsResult {
    if (flag.len == 0) return .done;
    if (flag[0] != '-') return .done;
    if (flag.len > 2 and flag[1] == '-') {
        if (bun.strings.eqlComptime(flag, "--preserve-root")) {
            this.preserve_root = true;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--no-preserve-root")) {
            this.preserve_root = false;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--recursive")) {
            this.recursive = true;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--verbose")) {
            this.verbose = true;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--dir")) {
            this.remove_empty_dirs = true;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--interactive=never")) {
            this.prompt_behaviour = .never;
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--interactive=once")) {
            this.prompt_behaviour = .{ .once = .{} };
            return .continue_parsing;
        } else if (bun.strings.eqlComptime(flag, "--interactive=always")) {
            this.prompt_behaviour = .always;
            return .continue_parsing;
        }

        return .illegal_option;
    }

    const small_flags = flag[1..];
    for (small_flags) |char| {
        switch (char) {
            'f' => {
                this.force = true;
                this.prompt_behaviour = .never;
            },
            'r', 'R' => {
                this.recursive = true;
            },
            'v' => {
                this.verbose = true;
            },
            'd' => {
                this.remove_empty_dirs = true;
            },
            'i' => {
                this.prompt_behaviour = .{ .once = .{} };
            },
            'I' => {
                this.prompt_behaviour = .always;
            },
            else => {
                return .illegal_option_with_flag;
            },
        }
    }

    return .continue_parsing;
}

pub fn onShellRmTaskDone(this: *Rm, task: *ShellRmTask) void {
    var exec = &this.state.exec;
    const tasks_done = switch (exec.state) {
        .idle => @panic("Invalid state"),
        .waiting => brk: {
            exec.state.waiting.tasks_done += 1;
            const amt = exec.state.waiting.tasks_done;
            if (task.err) |err| {
                exec.err = err;
                const error_string = this.bltn().taskErrorToString(.rm, err);
                if (this.bltn().stderr.needsIO()) |safeguard| {
                    log("Rm(0x{x}) task=0x{x} ERROR={s}", .{ @intFromPtr(this), @intFromPtr(task), error_string });
                    exec.incrementOutputCount(.output_count);
                    this.bltn().stderr.enqueue(this, error_string, safeguard).run();
                    return;
                } else {
                    _ = this.bltn().writeNoIO(.stderr, error_string);
                }
            }
            break :brk amt;
        },
    };

    log("ShellRmTask(0x{x}, task={s})", .{ @intFromPtr(task), task.root_path });
    // Wait until all tasks done and all output is written
    if (tasks_done >= this.state.exec.total_tasks and
        exec.getOutputCount(.output_done) >= exec.getOutputCount(.output_count))
    {
        this.state = .{ .done = .{ .exit_code = if (exec.err) |theerr| theerr.errno else 0 } };
        this.next().run();
    }
}

fn writeVerbose(this: *Rm, verbose: *ShellRmTask.DirTask) Yield {
    if (this.bltn().stdout.needsIO()) |safeguard| {
        const buf = verbose.takeDeletedEntries();
        defer buf.deinit();
        return this.bltn().stdout.enqueue(this, buf.items, safeguard);
    }
    _ = this.bltn().writeNoIO(.stdout, verbose.deleted_entries.items);
    _ = this.state.exec.incrementOutputCount(.output_done);
    if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks and this.state.exec.getOutputCount(.output_done) >= this.state.exec.getOutputCount(.output_count)) {
        return this.bltn().done(if (this.state.exec.err != null) @as(ExitCode, 1) else @as(ExitCode, 0));
    }
    return .done;
}

pub const ShellRmTask = struct {
    const debug = bun.Output.scoped(.AsyncRmTask, true);

    rm: *Rm,
    opts: Opts,

    cwd: bun.FileDescriptor,
    cwd_path: ?CwdPath = if (bun.Environment.isPosix) 0 else null,

    root_task: DirTask,
    root_path: bun.PathString = bun.PathString.empty,
    root_is_absolute: bool,

    error_signal: *std.atomic.Value(bool),
    err_mutex: bun.Mutex = .{},
    err: ?Syscall.Error = null,

    event_loop: JSC.EventLoopHandle,
    concurrent_task: JSC.EventLoopTask,
    task: JSC.WorkPoolTask = .{
        .callback = workPoolCallback,
    },
    join_style: JoinStyle,

    /// On Windows we allow posix path separators
    /// But this results in weird looking paths if we use our path.join function which uses the platform separator:
    /// `foo/bar + baz -> foo/bar\baz`
    ///
    /// So detect which path separator the user is using and prefer that.
    /// If both are used, pick the first one.
    const JoinStyle = union(enum) {
        posix,
        windows,

        pub fn fromPath(p: bun.PathString) JoinStyle {
            if (comptime bun.Environment.isPosix) return .posix;
            const backslash = std.mem.indexOfScalar(u8, p.slice(), '\\') orelse std.math.maxInt(usize);
            const forwardslash = std.mem.indexOfScalar(u8, p.slice(), '/') orelse std.math.maxInt(usize);
            if (forwardslash <= backslash)
                return .posix;
            return .windows;
        }
    };

    const CwdPath = if (bun.Environment.isWindows) [:0]const u8 else u0;

    const ParentRmTask = @This();

    pub const DirTask = struct {
        task_manager: *ParentRmTask,
        parent_task: ?*DirTask,
        path: [:0]const u8,
        is_absolute: bool = false,
        subtask_count: std.atomic.Value(usize),
        need_to_wait: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
        deleting_after_waiting_for_children: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
        kind_hint: EntryKindHint,
        task: JSC.WorkPoolTask = .{ .callback = runFromThreadPool },
        deleted_entries: std.ArrayList(u8),
        concurrent_task: JSC.EventLoopTask,

        const EntryKindHint = enum { idk, dir, file };

        pub fn takeDeletedEntries(this: *DirTask) std.ArrayList(u8) {
            debug("DirTask(0x{x} path={s}) takeDeletedEntries", .{ @intFromPtr(this), this.path });
            const ret = this.deleted_entries;
            this.deleted_entries = std.ArrayList(u8).init(ret.allocator);
            return ret;
        }

        pub fn runFromMainThread(this: *DirTask) void {
            debug("DirTask(0x{x}, path={s}) runFromMainThread", .{ @intFromPtr(this), this.path });
            this.task_manager.rm.writeVerbose(this).run();
        }

        pub fn runFromMainThreadMini(this: *DirTask, _: *void) void {
            this.runFromMainThread();
        }

        pub fn runFromThreadPool(task: *JSC.WorkPoolTask) void {
            var this: *DirTask = @fieldParentPtr("task", task);
            this.runFromThreadPoolImpl();
        }

        fn runFromThreadPoolImpl(this: *DirTask) void {
            defer {
                if (!this.deleting_after_waiting_for_children.load(.seq_cst)) {
                    this.postRun();
                }
            }

            // Root, get cwd path on windows
            if (bun.Environment.isWindows) {
                if (this.parent_task == null) {
                    var buf: bun.PathBuffer = undefined;
                    const cwd_path = switch (Syscall.getFdPath(this.task_manager.cwd, &buf)) {
                        .result => |p| bun.default_allocator.dupeZ(u8, p) catch bun.outOfMemory(),
                        .err => |err| {
                            debug("[runFromThreadPoolImpl:getcwd] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                            this.task_manager.err_mutex.lock();
                            defer this.task_manager.err_mutex.unlock();
                            if (this.task_manager.err == null) {
                                this.task_manager.err = err;
                                this.task_manager.error_signal.store(true, .seq_cst);
                            }
                            return;
                        },
                    };
                    this.task_manager.cwd_path = cwd_path;
                }
            }

            debug("DirTask: {s}", .{this.path});
            this.is_absolute = ResolvePath.Platform.auto.isAbsolute(this.path[0..this.path.len]);
            switch (this.task_manager.removeEntry(this, this.is_absolute)) {
                .err => |err| {
                    debug("[runFromThreadPoolImpl] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                    this.task_manager.err_mutex.lock();
                    defer this.task_manager.err_mutex.unlock();
                    if (this.task_manager.err == null) {
                        this.task_manager.err = err;
                        this.task_manager.error_signal.store(true, .seq_cst);
                    } else {
                        var err2 = err;
                        err2.deinit();
                    }
                },
                .result => {},
            }
        }

        fn handleErr(this: *DirTask, err: Syscall.Error) void {
            debug("[handleErr] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
            this.task_manager.err_mutex.lock();
            defer this.task_manager.err_mutex.unlock();
            if (this.task_manager.err == null) {
                this.task_manager.err = err;
                this.task_manager.error_signal.store(true, .seq_cst);
            } else {
                this.task_manager.err.?.deinit();
            }
        }

        pub fn postRun(this: *DirTask) void {
            debug("DirTask(0x{x}, path={s}) postRun", .{ @intFromPtr(this), this.path });
            // // This is true if the directory has subdirectories
            // // that need to be deleted
            if (this.need_to_wait.load(.seq_cst)) return;

            // We have executed all the children of this task
            if (this.subtask_count.fetchSub(1, .seq_cst) == 1) {
                defer {
                    if (this.task_manager.opts.verbose)
                        this.queueForWrite()
                    else
                        this.deinit();
                }

                // If we have a parent and we are the last child, now we can delete the parent
                if (this.parent_task != null) {
                    // It's possible that we queued this subdir task and it finished, while the parent
                    // was still in the `removeEntryDir` function
                    const tasks_left_before_decrement = this.parent_task.?.subtask_count.fetchSub(1, .seq_cst);
                    const parent_still_in_remove_entry_dir = !this.parent_task.?.need_to_wait.load(.monotonic);
                    if (!parent_still_in_remove_entry_dir and tasks_left_before_decrement == 2) {
                        this.parent_task.?.deleteAfterWaitingForChildren();
                    }
                    return;
                }

                // Otherwise we are root task
                this.task_manager.finishConcurrently();
            }

            // Otherwise need to wait
        }

        pub fn deleteAfterWaitingForChildren(this: *DirTask) void {
            debug("DirTask(0x{x}, path={s}) deleteAfterWaitingForChildren", .{ @intFromPtr(this), this.path });
            // `runFromMainThreadImpl` has a `defer this.postRun()` so need to set this to true to skip that
            this.deleting_after_waiting_for_children.store(true, .seq_cst);
            this.need_to_wait.store(false, .seq_cst);
            var do_post_run = true;
            defer {
                if (do_post_run) this.postRun();
            }
            if (this.task_manager.error_signal.load(.seq_cst)) {
                return;
            }

            switch (this.task_manager.removeEntryDirAfterChildren(this)) {
                .err => |e| {
                    debug("[deleteAfterWaitingForChildren] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(e.getErrno()), e.path });
                    this.task_manager.err_mutex.lock();
                    defer this.task_manager.err_mutex.unlock();
                    if (this.task_manager.err == null) {
                        this.task_manager.err = e;
                    } else {
                        bun.default_allocator.free(e.path);
                    }
                },
                .result => |deleted| {
                    if (!deleted) {
                        do_post_run = false;
                    }
                },
            }
        }

        pub fn queueForWrite(this: *DirTask) void {
            log("DirTask(0x{x}, path={s}) queueForWrite to_write={d}", .{ @intFromPtr(this), this.path, this.deleted_entries.items.len });
            if (this.deleted_entries.items.len == 0) return;
            if (this.task_manager.event_loop == .js) {
                this.task_manager.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
            } else {
                this.task_manager.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn deinit(this: *DirTask) void {
            this.deleted_entries.deinit();
            // The root's path string is from Rm's argv so don't deallocate it
            // And the root task is actually a field on the struct of the AsyncRmTask so don't deallocate it either
            if (this.parent_task != null) {
                bun.default_allocator.free(this.path);
                bun.default_allocator.destroy(this);
            }
        }
    };

    pub fn create(root_path: bun.PathString, rm: *Rm, cwd: bun.FileDescriptor, error_signal: *std.atomic.Value(bool), is_absolute: bool) *ShellRmTask {
        const task = bun.default_allocator.create(ShellRmTask) catch bun.outOfMemory();
        task.* = ShellRmTask{
            .rm = rm,
            .opts = rm.opts,
            .cwd = cwd,
            .root_path = root_path,
            .root_task = DirTask{
                .task_manager = task,
                .parent_task = null,
                .path = root_path.sliceAssumeZ(),
                .subtask_count = std.atomic.Value(usize).init(1),
                .kind_hint = .idk,
                .deleted_entries = std.ArrayList(u8).init(bun.default_allocator),
                .concurrent_task = JSC.EventLoopTask.fromEventLoop(rm.bltn().eventLoop()),
            },
            .event_loop = rm.bltn().parentCmd().base.eventLoop(),
            .concurrent_task = JSC.EventLoopTask.fromEventLoop(rm.bltn().eventLoop()),
            .error_signal = error_signal,
            .root_is_absolute = is_absolute,
            .join_style = JoinStyle.fromPath(root_path),
        };
        return task;
    }

    pub fn schedule(this: *@This()) void {
        JSC.WorkPool.schedule(&this.task);
    }

    pub fn enqueue(this: *ShellRmTask, parent_dir: *DirTask, path: [:0]const u8, is_absolute: bool, kind_hint: DirTask.EntryKindHint) void {
        if (this.error_signal.load(.seq_cst)) {
            return;
        }
        const new_path = this.join(
            bun.default_allocator,
            &[_][]const u8{
                parent_dir.path[0..parent_dir.path.len],
                path[0..path.len],
            },
            is_absolute,
        );
        this.enqueueNoJoin(parent_dir, new_path, kind_hint);
    }

    pub fn enqueueNoJoin(this: *ShellRmTask, parent_task: *DirTask, path: [:0]const u8, kind_hint: DirTask.EntryKindHint) void {
        defer debug("enqueue: {s} {s}", .{ path, @tagName(kind_hint) });

        if (this.error_signal.load(.seq_cst)) {
            return;
        }

        var subtask = bun.default_allocator.create(DirTask) catch bun.outOfMemory();
        subtask.* = DirTask{
            .task_manager = this,
            .path = path,
            .parent_task = parent_task,
            .subtask_count = std.atomic.Value(usize).init(1),
            .kind_hint = kind_hint,
            .deleted_entries = std.ArrayList(u8).init(bun.default_allocator),
            .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.event_loop),
        };

        const count = parent_task.subtask_count.fetchAdd(1, .monotonic);
        if (comptime bun.Environment.allow_assert) {
            assert(count > 0);
        }

        JSC.WorkPool.schedule(&subtask.task);
    }

    pub fn getcwd(this: *ShellRmTask) bun.FileDescriptor {
        return this.cwd;
    }

    pub fn verboseDeleted(this: *@This(), dir_task: *DirTask, path: [:0]const u8) Maybe(void) {
        debug("deleted: {s}", .{path[0..path.len]});
        if (!this.opts.verbose) return Maybe(void).success;
        if (dir_task.deleted_entries.items.len == 0) {
            debug("DirTask(0x{x}, {s}) Incrementing output count (deleted={s})", .{ @intFromPtr(dir_task), dir_task.path, path });
            _ = this.rm.state.exec.incrementOutputCount(.output_count);
        }
        dir_task.deleted_entries.appendSlice(path[0..path.len]) catch bun.outOfMemory();
        dir_task.deleted_entries.append('\n') catch bun.outOfMemory();
        return Maybe(void).success;
    }

    pub fn finishConcurrently(this: *ShellRmTask) void {
        debug("finishConcurrently", .{});
        if (this.event_loop == .js) {
            this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn bufJoin(this: *ShellRmTask, buf: *bun.PathBuffer, parts: []const []const u8, _: Syscall.Tag) Maybe([:0]const u8) {
        if (this.join_style == .posix) {
            return .{ .result = ResolvePath.joinZBuf(buf, parts, .posix) };
        } else return .{ .result = ResolvePath.joinZBuf(buf, parts, .windows) };
    }

    pub fn removeEntry(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool) Maybe(void) {
        var remove_child_vtable = RemoveFileVTable{
            .task = this,
            .child_of_dir = false,
        };
        var buf: bun.PathBuffer = undefined;
        switch (dir_task.kind_hint) {
            .idk, .file => return this.removeEntryFile(dir_task, dir_task.path, is_absolute, &buf, &remove_child_vtable),
            .dir => return this.removeEntryDir(dir_task, is_absolute, &buf),
        }
    }

    fn removeEntryDir(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
        const path = dir_task.path;
        const dirfd = this.cwd;
        debug("removeEntryDir({s})", .{path});

        // If `-d` is specified without `-r` then we can just use `rmdirat`
        if (this.opts.remove_empty_dirs and !this.opts.recursive) out_to_iter: {
            var delete_state = RemoveFileParent{
                .task = this,
                .treat_as_dir = true,
                .allow_enqueue = false,
            };
            while (delete_state.treat_as_dir) {
                switch (ShellSyscall.rmdirat(dirfd, path)) {
                    .result => return Maybe(void).success,
                    .err => |e| {
                        switch (e.getErrno()) {
                            .NOENT => {
                                if (this.opts.force) return this.verboseDeleted(dir_task, path);
                                return .{ .err = this.errorWithPath(e, path) };
                            },
                            .NOTDIR => {
                                delete_state.treat_as_dir = false;
                                if (this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, &delete_state).asErr()) |err| {
                                    return .{ .err = this.errorWithPath(err, path) };
                                }
                                if (!delete_state.treat_as_dir) return Maybe(void).success;
                                if (delete_state.treat_as_dir) break :out_to_iter;
                            },
                            else => return .{ .err = this.errorWithPath(e, path) },
                        }
                    },
                }
            }
        }

        if (!this.opts.recursive) {
            return Maybe(void).initErr(Syscall.Error.fromCode(bun.sys.E.ISDIR, .TODO).withPath(bun.default_allocator.dupeZ(u8, dir_task.path) catch bun.outOfMemory()));
        }

        const flags = bun.O.DIRECTORY | bun.O.RDONLY;
        const fd = switch (ShellSyscall.openat(dirfd, path, flags, 0)) {
            .result => |fd| fd,
            .err => |e| {
                switch (e.getErrno()) {
                    .NOENT => {
                        if (this.opts.force) return this.verboseDeleted(dir_task, path);
                        return .{ .err = this.errorWithPath(e, path) };
                    },
                    .NOTDIR => {
                        return this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, &DummyRemoveFile.dummy);
                    },
                    else => return .{ .err = this.errorWithPath(e, path) },
                }
            },
        };

        var close_fd = true;
        defer {
            // On posix we can close the file descriptor whenever, but on Windows
            // we need to close it BEFORE we delete
            if (close_fd) {
                fd.close();
            }
        }

        if (this.error_signal.load(.seq_cst)) {
            return Maybe(void).success;
        }

        var iterator = DirIterator.iterate(fd.stdDir(), .u8);
        var entry = iterator.next();

        var remove_child_vtable = RemoveFileVTable{
            .task = this,
            .child_of_dir = true,
        };

        var i: usize = 0;
        while (switch (entry) {
            .err => |err| {
                return .{ .err = this.errorWithPath(err, path) };
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            debug("dir({s}) entry({s}, {s})", .{ path, current.name.slice(), @tagName(current.kind) });
            // TODO this seems bad maybe better to listen to kqueue/epoll event
            if (fastMod(i, 4) == 0 and this.error_signal.load(.seq_cst)) return Maybe(void).success;

            defer i += 1;
            switch (current.kind) {
                .directory => {
                    this.enqueue(dir_task, current.name.sliceAssumeZ(), is_absolute, .dir);
                },
                else => {
                    const name = current.name.sliceAssumeZ();
                    const file_path = switch (this.bufJoin(
                        buf,
                        &[_][]const u8{
                            path[0..path.len],
                            name[0..name.len],
                        },
                        .unlink,
                    )) {
                        .err => |e| return .{ .err = e },
                        .result => |p| p,
                    };

                    switch (this.removeEntryFile(dir_task, file_path, is_absolute, buf, &remove_child_vtable)) {
                        .err => |e| return .{ .err = this.errorWithPath(e, current.name.sliceAssumeZ()) },
                        .result => {},
                    }
                },
            }
        }

        // Need to wait for children to finish
        if (dir_task.subtask_count.load(.seq_cst) > 1) {
            close_fd = true;
            dir_task.need_to_wait.store(true, .seq_cst);
            return Maybe(void).success;
        }

        if (this.error_signal.load(.seq_cst)) return Maybe(void).success;

        if (bun.Environment.isWindows) {
            close_fd = false;
            fd.close();
        }

        debug("[removeEntryDir] remove after children {s}", .{path});
        switch (ShellSyscall.unlinkatWithFlags(this.getcwd(), path, std.posix.AT.REMOVEDIR)) {
            .result => {
                switch (this.verboseDeleted(dir_task, path)) {
                    .err => |e| return .{ .err = e },
                    else => {},
                }
                return Maybe(void).success;
            },
            .err => |e| {
                switch (e.getErrno()) {
                    .NOENT => {
                        if (this.opts.force) {
                            switch (this.verboseDeleted(dir_task, path)) {
                                .err => |e2| return .{ .err = e2 },
                                else => {},
                            }
                            return Maybe(void).success;
                        }

                        return .{ .err = this.errorWithPath(e, path) };
                    },
                    else => return .{ .err = e },
                }
            },
        }
    }

    const DummyRemoveFile = struct {
        var dummy: @This() = std.mem.zeroes(@This());

        pub fn onIsDir(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
            _ = this; // autofix
            _ = parent_dir_task; // autofix
            _ = path; // autofix
            _ = is_absolute; // autofix
            _ = buf; // autofix

            return Maybe(void).success;
        }

        pub fn onDirNotEmpty(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
            _ = this; // autofix
            _ = parent_dir_task; // autofix
            _ = path; // autofix
            _ = is_absolute; // autofix
            _ = buf; // autofix

            return Maybe(void).success;
        }
    };

    const RemoveFileVTable = struct {
        task: *ShellRmTask,
        child_of_dir: bool,

        pub fn onIsDir(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
            if (this.child_of_dir) {
                this.task.enqueueNoJoin(parent_dir_task, bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory(), .dir);
                return Maybe(void).success;
            }
            return this.task.removeEntryDir(parent_dir_task, is_absolute, buf);
        }

        pub fn onDirNotEmpty(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
            if (this.child_of_dir) return .{ .result = this.task.enqueueNoJoin(parent_dir_task, bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory(), .dir) };
            return this.task.removeEntryDir(parent_dir_task, is_absolute, buf);
        }
    };

    const RemoveFileParent = struct {
        task: *ShellRmTask,
        treat_as_dir: bool,
        allow_enqueue: bool = true,
        enqueued: bool = false,

        pub fn onIsDir(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
            _ = parent_dir_task; // autofix
            _ = path; // autofix
            _ = is_absolute; // autofix
            _ = buf; // autofix

            this.treat_as_dir = true;
            return Maybe(void).success;
        }

        pub fn onDirNotEmpty(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer) Maybe(void) {
            _ = is_absolute; // autofix
            _ = buf; // autofix

            this.treat_as_dir = true;
            if (this.allow_enqueue) {
                this.task.enqueueNoJoin(parent_dir_task, path, .dir);
                this.enqueued = true;
            }
            return Maybe(void).success;
        }
    };

    fn removeEntryDirAfterChildren(this: *ShellRmTask, dir_task: *DirTask) Maybe(bool) {
        debug("remove entry after children: {s}", .{dir_task.path});
        const dirfd = this.cwd;
        var state = RemoveFileParent{
            .task = this,
            .treat_as_dir = true,
        };
        while (true) {
            if (state.treat_as_dir) {
                log("rmdirat({}, {s})", .{ dirfd, dir_task.path });
                switch (ShellSyscall.rmdirat(dirfd, dir_task.path)) {
                    .result => {
                        _ = this.verboseDeleted(dir_task, dir_task.path);
                        return .{ .result = true };
                    },
                    .err => |e| {
                        switch (e.getErrno()) {
                            .NOENT => {
                                if (this.opts.force) {
                                    _ = this.verboseDeleted(dir_task, dir_task.path);
                                    return .{ .result = true };
                                }
                                return .{ .err = this.errorWithPath(e, dir_task.path) };
                            },
                            .NOTDIR => {
                                state.treat_as_dir = false;
                                continue;
                            },
                            else => return .{ .err = this.errorWithPath(e, dir_task.path) },
                        }
                    },
                }
            } else {
                var buf: bun.PathBuffer = undefined;
                if (this.removeEntryFile(dir_task, dir_task.path, dir_task.is_absolute, &buf, &state).asErr()) |e| {
                    return .{ .err = e };
                }
                if (state.enqueued) return .{ .result = false };
                if (state.treat_as_dir) continue;
                return .{ .result = true };
            }
        }
    }

    fn removeEntryFile(this: *ShellRmTask, parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *bun.PathBuffer, vtable: anytype) Maybe(void) {
        const VTable = std.meta.Child(@TypeOf(vtable));
        const Handler = struct {
            pub fn onIsDir(vtable_: anytype, parent_dir_task_: *DirTask, path_: [:0]const u8, is_absolute_: bool, buf_: *bun.PathBuffer) Maybe(void) {
                if (@hasDecl(VTable, "onIsDir")) {
                    return VTable.onIsDir(vtable_, parent_dir_task_, path_, is_absolute_, buf_);
                }
                return Maybe(void).success;
            }

            pub fn onDirNotEmpty(vtable_: anytype, parent_dir_task_: *DirTask, path_: [:0]const u8, is_absolute_: bool, buf_: *bun.PathBuffer) Maybe(void) {
                if (@hasDecl(VTable, "onDirNotEmpty")) {
                    return VTable.onDirNotEmpty(vtable_, parent_dir_task_, path_, is_absolute_, buf_);
                }
                return Maybe(void).success;
            }
        };
        const dirfd = this.cwd;
        switch (ShellSyscall.unlinkatWithFlags(dirfd, path, 0)) {
            .result => return this.verboseDeleted(parent_dir_task, path),
            .err => |e| {
                debug("unlinkatWithFlags({s}) = {s}", .{ path, @tagName(e.getErrno()) });
                switch (e.getErrno()) {
                    bun.sys.E.NOENT => {
                        if (this.opts.force)
                            return this.verboseDeleted(parent_dir_task, path);

                        return .{ .err = this.errorWithPath(e, path) };
                    },
                    bun.sys.E.ISDIR => {
                        return Handler.onIsDir(vtable, parent_dir_task, path, is_absolute, buf);
                    },
                    // This might happen if the file is actually a directory
                    bun.sys.E.PERM => {
                        switch (builtin.os.tag) {
                            // non-Linux POSIX systems and Windows return EPERM when trying to delete a directory, so
                            // we need to handle that case specifically and translate the error
                            .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris, .illumos, .windows => {
                                // If we are allowed to delete directories then we can call `unlink`.
                                // If `path` points to a directory, then it is deleted (if empty) or we handle it as a directory
                                // If it's actually a file, we get an error so we don't need to call `stat` to check that.
                                if (this.opts.recursive or this.opts.remove_empty_dirs) {
                                    return switch (ShellSyscall.unlinkatWithFlags(this.getcwd(), path, std.posix.AT.REMOVEDIR)) {
                                        // it was empty, we saved a syscall
                                        .result => return this.verboseDeleted(parent_dir_task, path),
                                        .err => |e2| {
                                            return switch (e2.getErrno()) {
                                                // not empty, process directory as we would normally
                                                .NOTEMPTY => {
                                                    // this.enqueueNoJoin(parent_dir_task, path, .dir);
                                                    // return Maybe(void).success;
                                                    return Handler.onDirNotEmpty(vtable, parent_dir_task, path, is_absolute, buf);
                                                },
                                                // actually a file, the error is a permissions error
                                                .NOTDIR => .{ .err = this.errorWithPath(e, path) },
                                                else => .{ .err = this.errorWithPath(e2, path) },
                                            };
                                        },
                                    };
                                }

                                // We don't know if it was an actual permissions error or it was a directory so we need to try to delete it as a directory
                                return Handler.onIsDir(vtable, parent_dir_task, path, is_absolute, buf);
                            },
                            else => {},
                        }

                        return .{ .err = this.errorWithPath(e, path) };
                    },
                    else => return .{ .err = this.errorWithPath(e, path) },
                }
            },
        }
    }

    fn errorWithPath(this: *ShellRmTask, err: Syscall.Error, path: [:0]const u8) Syscall.Error {
        _ = this;
        return err.withPath(bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory());
    }

    inline fn join(this: *ShellRmTask, alloc: Allocator, subdir_parts: []const []const u8, is_absolute: bool) [:0]const u8 {
        _ = this;
        if (!is_absolute) {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path
            return std.fs.path.joinZ(alloc, subdir_parts) catch bun.outOfMemory();
        }

        const out = alloc.dupeZ(u8, bun.path.join(subdir_parts, .auto)) catch bun.outOfMemory();

        return out;
    }

    pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *ShellRmTask = @alignCast(@fieldParentPtr("task", task));
        this.root_task.runFromThreadPoolImpl();
    }

    pub fn runFromMainThread(this: *ShellRmTask) void {
        this.rm.onShellRmTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *ShellRmTask, _: *void) void {
        this.rm.onShellRmTaskDone(this);
    }

    pub fn deinit(this: *ShellRmTask) void {
        bun.default_allocator.destroy(this);
    }
};

inline fn fastMod(val: anytype, comptime rhs: comptime_int) @TypeOf(val) {
    const Value = @typeInfo(@TypeOf(val));
    if (Value != .int) @compileError("LHS of fastMod should be an int");
    if (Value.int.signedness != .unsigned) @compileError("LHS of fastMod should be unsigned");
    if (!comptime std.math.isPowerOfTwo(rhs)) @compileError("RHS of fastMod should be power of 2");

    return val & (rhs - 1);
}

pub fn writeFailingError(this: *Rm, buf: []const u8, exit_code: ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);

    return this.bltn().done(exit_code);
}

const log = bun.Output.scoped(.Rm, true);
const bun = @import("bun");
const shell = bun.shell;
const Yield = shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const ExitCode = shell.ExitCode;
const Rm = @This();
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");

const ShellSyscall = interpreter.ShellSyscall;
const Syscall = bun.sys;
const assert = bun.assert;
const ResolvePath = bun.path;
const Allocator = std.mem.Allocator;
const DirIterator = bun.DirIterator;
const builtin = @import("builtin");
