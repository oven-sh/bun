opts: Opts = .{},
state: union(enum) {
    idle,
    exec: struct {
        target_path: [:0]const u8,
        paths_to_copy: []const [*:0]const u8,
        started: bool = false,
        /// this is thread safe as it is only incremented
        /// and decremented on the main thread by this struct
        tasks_count: u32 = 0,
        output_waiting: u32 = 0,
        output_done: u32 = 0,
        err: ?bun.shell.ShellErr = null,

        ebusy: if (bun.Environment.isWindows) EbusyState else struct {} = .{},
    },
    ebusy: struct {
        state: EbusyState,
        idx: usize = 0,
        main_exit_code: ExitCode = 0,
    },
    waiting_write_err,
    done,
} = .idle,

pub fn format(this: *const Cp, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try writer.print("Cp(0x{x})", .{@intFromPtr(this)});
}

/// On Windows it is possible to get an EBUSY error very simply
/// by running the following command:
///
/// `cp myfile.txt myfile.txt mydir/`
///
/// Bearing in mind that the shell cp implementation creates a
/// ShellCpTask for each source file, it's possible for one of the
/// tasks to get EBUSY while trying to access the source file or the
/// destination file.
///
/// But it's fine to ignore the EBUSY error since at
/// least one of them will succeed anyway.
///
/// We handle this _after_ all the tasks have been
/// executed, to avoid complicated synchronization on multiple
/// threads, because the precise src or dest for each argument is
/// not known until its corresponding ShellCpTask is executed by the
/// threadpool.
const EbusyState = struct {
    tasks: std.ArrayListUnmanaged(*ShellCpTask) = .{},
    absolute_targets: bun.StringArrayHashMapUnmanaged(void) = .{},
    absolute_srcs: bun.StringArrayHashMapUnmanaged(void) = .{},

    pub fn deinit(this: *EbusyState) void {
        // The tasks themselves are freed in `ignoreEbusyErrorIfPossible()`
        this.tasks.deinit(bun.default_allocator);
        for (this.absolute_targets.keys()) |tgt| {
            bun.default_allocator.free(tgt);
        }
        this.absolute_targets.deinit(bun.default_allocator);
        for (this.absolute_srcs.keys()) |tgt| {
            bun.default_allocator.free(tgt);
        }
        this.absolute_srcs.deinit(bun.default_allocator);
    }
};

pub fn start(this: *Cp) Yield {
    const maybe_filepath_args = switch (this.opts.parse(this.bltn().argsSlice())) {
        .ok => |args| args,
        .err => |e| {
            const buf = switch (e) {
                .illegal_option => |opt_str| this.bltn().fmtErrorArena(.cp, "illegal option -- {s}\n", .{opt_str}),
                .show_usage => Builtin.Kind.cp.usageString(),
                .unsupported => |unsupported| this.bltn().fmtErrorArena(.cp, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
            };

            return this.writeFailingError(buf, 1);
        },
    };

    if (maybe_filepath_args == null or maybe_filepath_args.?.len <= 1) {
        return this.writeFailingError(Builtin.Kind.cp.usageString(), 1);
    }

    const args = maybe_filepath_args orelse unreachable;
    const paths_to_copy = args[0 .. args.len - 1];
    const tgt_path = std.mem.span(args[args.len - 1]);

    this.state = .{ .exec = .{
        .target_path = tgt_path,
        .paths_to_copy = paths_to_copy,
    } };

    return this.next();
}

pub fn ignoreEbusyErrorIfPossible(this: *Cp) Yield {
    if (!bun.Environment.isWindows) @compileError("dont call this plz");

    if (this.state.ebusy.idx < this.state.ebusy.state.tasks.items.len) {
        outer_loop: for (this.state.ebusy.state.tasks.items[this.state.ebusy.idx..], 0..) |task_, i| {
            const task: *ShellCpTask = task_;
            const failure_src = task.src_absolute.?;
            const failure_tgt = task.tgt_absolute.?;
            if (this.state.ebusy.state.absolute_targets.get(failure_tgt)) |_| {
                task.deinit();
                continue :outer_loop;
            }
            if (this.state.ebusy.state.absolute_srcs.get(failure_src)) |_| {
                task.deinit();
                continue :outer_loop;
            }
            this.state.ebusy.idx += i + 1;
            return this.printShellCpTask(task);
        }
    }

    this.state.ebusy.state.deinit();
    const exit_code = this.state.ebusy.main_exit_code;
    this.state = .done;
    return this.bltn().done(exit_code);
}

pub fn next(this: *Cp) Yield {
    while (this.state != .done) {
        switch (this.state) {
            .idle => @panic("Invalid state for \"Cp\": idle, this indicates a bug in Bun. Please file a GitHub issue"),
            .exec => {
                var exec = &this.state.exec;
                if (exec.started) {
                    if (this.state.exec.tasks_count <= 0 and this.state.exec.output_done >= this.state.exec.output_waiting) {
                        const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                        if (this.state.exec.err != null) {
                            this.state.exec.err.?.deinit(bun.default_allocator);
                        }
                        if (comptime bun.Environment.isWindows) {
                            if (exec.ebusy.tasks.items.len > 0) {
                                this.state = .{ .ebusy = .{ .state = this.state.exec.ebusy, .main_exit_code = exit_code } };
                                continue;
                            }
                            exec.ebusy.deinit();
                        }
                        this.state = .done;
                        return this.bltn().done(exit_code);
                    }
                    return .suspended;
                }

                exec.started = true;
                exec.tasks_count = @intCast(exec.paths_to_copy.len);

                const cwd_path = this.bltn().parentCmd().base.shell.cwdZ();

                // Launch a task for each argument
                for (exec.paths_to_copy) |path_raw| {
                    const path = std.mem.span(path_raw);
                    const cp_task = ShellCpTask.create(this, this.bltn().eventLoop(), this.opts, 1 + exec.paths_to_copy.len, path, exec.target_path, cwd_path);
                    cp_task.schedule();
                }
                return .suspended;
            },
            .ebusy => {
                if (comptime bun.Environment.isWindows) {
                    return this.ignoreEbusyErrorIfPossible();
                }
                @panic("Should only be called on Windows");
            },
            .waiting_write_err => return .failed,
            .done => unreachable,
        }
    }

    return this.bltn().done(0);
}

pub fn deinit(cp: *Cp) void {
    assert(cp.state == .done or cp.state == .waiting_write_err);
}

pub fn writeFailingError(this: *Cp, buf: []const u8, exit_code: ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);

    return this.bltn().done(exit_code);
}

pub fn onIOWriterChunk(this: *Cp, _: usize, e: ?JSC.SystemError) Yield {
    if (e) |err| err.deref();
    if (this.state == .waiting_write_err) {
        return this.bltn().done(1);
    }
    this.state.exec.output_done += 1;
    return this.next();
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("cp", this));
    return @fieldParentPtr("impl", impl);
}

pub fn onShellCpTaskDone(this: *Cp, task: *ShellCpTask) void {
    assert(this.state == .exec);
    log("task done: 0x{x} {d}", .{ @intFromPtr(task), this.state.exec.tasks_count });
    this.state.exec.tasks_count -= 1;

    if (comptime bun.Environment.isWindows) {
        if (task.err) |*err| {
            if (err.* == .sys and
                err.sys.getErrno() == .BUSY and
                (task.tgt_absolute != null and
                    err.sys.path.eqlUTF8(task.tgt_absolute.?)) or
                (task.src_absolute != null and
                    err.sys.path.eqlUTF8(task.src_absolute.?)))
            {
                log("{} got ebusy {d} {d}", .{ this, this.state.exec.ebusy.tasks.items.len, this.state.exec.paths_to_copy.len });
                this.state.exec.ebusy.tasks.append(bun.default_allocator, task) catch bun.outOfMemory();
                this.next().run();
                return;
            }
        } else {
            const tgt_absolute = task.tgt_absolute;
            task.tgt_absolute = null;
            if (tgt_absolute) |tgt| this.state.exec.ebusy.absolute_targets.put(bun.default_allocator, tgt, {}) catch bun.outOfMemory();
            const src_absolute = task.src_absolute;
            task.src_absolute = null;
            if (src_absolute) |tgt| this.state.exec.ebusy.absolute_srcs.put(bun.default_allocator, tgt, {}) catch bun.outOfMemory();
        }
    }

    this.printShellCpTask(task).run();
}

pub fn printShellCpTask(this: *Cp, task: *ShellCpTask) Yield {
    // Deinitialize this task as we are starting a new one
    defer task.deinit();

    var output = task.takeOutput();

    const output_task: *ShellCpOutputTask = bun.new(ShellCpOutputTask, .{
        .parent = this,
        .output = .{ .arrlist = output.moveToUnmanaged() },
        .state = .waiting_write_err,
    });
    if (bun.take(&task.err)) |err| {
        this.state.exec.err = err;
        const error_string = this.bltn().taskErrorToString(.cp, this.state.exec.err.?);
        return output_task.start(error_string);
    }
    return output_task.start(null);
}

pub const ShellCpOutputTask = OutputTask(Cp, .{
    .writeErr = ShellCpOutputTaskVTable.writeErr,
    .onWriteErr = ShellCpOutputTaskVTable.onWriteErr,
    .writeOut = ShellCpOutputTaskVTable.writeOut,
    .onWriteOut = ShellCpOutputTaskVTable.onWriteOut,
    .onDone = ShellCpOutputTaskVTable.onDone,
});

const ShellCpOutputTaskVTable = struct {
    pub fn writeErr(this: *Cp, childptr: anytype, errbuf: []const u8) ?Yield {
        if (this.bltn().stderr.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            return this.bltn().stderr.enqueue(childptr, errbuf, safeguard);
        }
        _ = this.bltn().writeNoIO(.stderr, errbuf);
        return null;
    }

    pub fn onWriteErr(this: *Cp) void {
        this.state.exec.output_done += 1;
    }

    pub fn writeOut(this: *Cp, childptr: anytype, output: *OutputSrc) ?Yield {
        if (this.bltn().stdout.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            return this.bltn().stdout.enqueue(childptr, output.slice(), safeguard);
        }
        _ = this.bltn().writeNoIO(.stdout, output.slice());
        return null;
    }

    pub fn onWriteOut(this: *Cp) void {
        this.state.exec.output_done += 1;
    }

    pub fn onDone(this: *Cp) Yield {
        return this.next();
    }
};

pub const ShellCpTask = struct {
    cp: *Cp,

    opts: Opts,
    operands: usize = 0,
    src: [:0]const u8,
    tgt: [:0]const u8,
    src_absolute: ?[:0]const u8 = null,
    tgt_absolute: ?[:0]const u8 = null,
    cwd_path: [:0]const u8,
    verbose_output_lock: bun.Mutex = .{},
    verbose_output: ArrayList(u8) = ArrayList(u8).init(bun.default_allocator),

    task: JSC.WorkPoolTask = .{ .callback = &runFromThreadPool },
    event_loop: JSC.EventLoopHandle,
    concurrent_task: JSC.EventLoopTask,
    err: ?bun.shell.ShellErr = null,

    const debug = bun.Output.scoped(.ShellCpTask, false);

    fn deinit(this: *ShellCpTask) void {
        debug("deinit", .{});
        this.verbose_output.deinit();
        if (this.err) |*e| {
            e.deinit(bun.default_allocator);
        }
        if (this.src_absolute) |sc| {
            bun.default_allocator.free(sc);
        }
        if (this.tgt_absolute) |tc| {
            bun.default_allocator.free(tc);
        }
        bun.destroy(this);
    }

    pub fn schedule(this: *@This()) void {
        debug("schedule", .{});
        WorkPool.schedule(&this.task);
    }

    pub fn create(
        cp: *Cp,
        evtloop: JSC.EventLoopHandle,
        opts: Opts,
        operands: usize,
        src: [:0]const u8,
        tgt: [:0]const u8,
        cwd_path: [:0]const u8,
    ) *ShellCpTask {
        return bun.new(ShellCpTask, ShellCpTask{
            .cp = cp,
            .operands = operands,
            .opts = opts,
            .src = src,
            .tgt = tgt,
            .cwd_path = cwd_path,
            .event_loop = evtloop,
            .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
        });
    }

    fn takeOutput(this: *ShellCpTask) ArrayList(u8) {
        const out = this.verbose_output;
        this.verbose_output = ArrayList(u8).init(bun.default_allocator);
        return out;
    }

    pub fn ensureDest(nodefs: *JSC.Node.fs.NodeFS, dest: bun.OSPathSliceZ) Maybe(void) {
        return switch (nodefs.mkdirRecursiveOSPath(dest, JSC.Node.Arguments.Mkdir.DefaultMode, false)) {
            .err => |err| Maybe(void){ .err = err },
            .result => Maybe(void).success,
        };
    }

    pub fn hasTrailingSep(path: [:0]const u8) bool {
        if (path.len == 0) return false;
        return ResolvePath.Platform.auto.isSeparator(path[path.len - 1]);
    }

    const Kind = enum {
        file,
        dir,
    };

    pub fn isDir(_: *ShellCpTask, path: [:0]const u8) Maybe(bool) {
        if (bun.Environment.isWindows) {
            const attributes = bun.sys.getFileAttributes(path[0..path.len]) orelse {
                const err: Syscall.Error = .{
                    .errno = @intFromEnum(bun.sys.SystemErrno.ENOENT),
                    .syscall = .copyfile,
                    .path = path,
                };
                return .{ .err = err };
            };

            return .{ .result = attributes.is_directory };
        }
        const stat = switch (Syscall.lstat(path)) {
            .result => |x| x,
            .err => |e| {
                return .{ .err = e };
            },
        };
        return .{ .result = bun.S.ISDIR(stat.mode) };
    }

    fn enqueueToEventLoop(this: *ShellCpTask) void {
        if (this.event_loop == .js) {
            this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn runFromMainThread(this: *ShellCpTask) void {
        debug("runFromMainThread", .{});
        this.cp.onShellCpTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *ShellCpTask, _: *void) void {
        this.runFromMainThread();
    }

    pub fn runFromThreadPool(task: *WorkPoolTask) void {
        debug("runFromThreadPool", .{});
        var this: *@This() = @fieldParentPtr("task", task);
        if (this.runFromThreadPoolImpl()) |e| {
            this.err = e;
            this.enqueueToEventLoop();
            return;
        }
    }

    fn runFromThreadPoolImpl(this: *ShellCpTask) ?bun.shell.ShellErr {
        var buf2: bun.PathBuffer = undefined;
        var buf3: bun.PathBuffer = undefined;
        // We have to give an absolute path to our cp
        // implementation for it to work with cwd
        const src: [:0]const u8 = brk: {
            if (ResolvePath.Platform.auto.isAbsolute(this.src)) break :brk this.src;
            const parts: []const []const u8 = &.{
                this.cwd_path[0..],
                this.src[0..],
            };
            break :brk ResolvePath.joinZ(parts, .auto);
        };
        var tgt: [:0]const u8 = brk: {
            if (ResolvePath.Platform.auto.isAbsolute(this.tgt)) break :brk this.tgt;
            const parts: []const []const u8 = &.{
                this.cwd_path[0..],
                this.tgt[0..],
            };
            break :brk ResolvePath.joinZBuf(buf2[0..bun.MAX_PATH_BYTES], parts, .auto);
        };

        // Cases:
        // SRC       DEST
        // ----------------
        // file   -> file
        // file   -> folder
        // folder -> folder
        // ----------------
        // We need to check dest to see what it is
        // If it doesn't exist we need to create it
        const src_is_dir = switch (this.isDir(src)) {
            .result => |x| x,
            .err => |e| return bun.shell.ShellErr.newSys(e),
        };

        // Any source directory without -R is an error
        if (src_is_dir and !this.opts.recursive) {
            const errmsg = std.fmt.allocPrint(bun.default_allocator, "{s} is a directory (not copied)", .{this.src}) catch bun.outOfMemory();
            return .{ .custom = errmsg };
        }

        if (!src_is_dir and bun.strings.eql(src, tgt)) {
            const errmsg = std.fmt.allocPrint(bun.default_allocator, "{s} and {s} are identical (not copied)", .{ this.src, this.src }) catch bun.outOfMemory();
            return .{ .custom = errmsg };
        }

        const tgt_is_dir: bool, const tgt_exists: bool = switch (this.isDir(tgt)) {
            .result => |is_dir| .{ is_dir, true },
            .err => |e| brk: {
                if (e.getErrno() == .NOENT) {
                    // If it has a trailing directory separator, its a directory
                    const is_dir = hasTrailingSep(tgt);
                    break :brk .{ is_dir, false };
                }
                return bun.shell.ShellErr.newSys(e);
            },
        };

        var copying_many = false;

        // Note:
        // The following logic is based on the POSIX spec:
        //   https://man7.org/linux/man-pages/man1/cp.1p.html

        // Handle the "1st synopsis": source_file -> target_file
        if (!src_is_dir and !tgt_is_dir and this.operands == 2) {
            // Don't need to do anything here
        }
        // Handle the "2nd synopsis": -R source_files... -> target
        else if (this.opts.recursive) {
            if (tgt_exists) {
                const basename = ResolvePath.basename(src[0..src.len]);
                const parts: []const []const u8 = &.{
                    tgt[0..tgt.len],
                    basename,
                };
                tgt = ResolvePath.joinZBuf(buf3[0..bun.MAX_PATH_BYTES], parts, .auto);
            } else if (this.operands == 2) {
                // source_dir -> new_target_dir
            } else {
                const errmsg = std.fmt.allocPrint(bun.default_allocator, "directory {s} does not exist", .{this.tgt}) catch bun.outOfMemory();
                return .{ .custom = errmsg };
            }
            copying_many = true;
        }
        // Handle the "3rd synopsis": source_files... -> target
        else {
            if (src_is_dir) return .{ .custom = std.fmt.allocPrint(bun.default_allocator, "{s} is a directory (not copied)", .{this.src}) catch bun.outOfMemory() };
            if (!tgt_exists or !tgt_is_dir) return .{ .custom = std.fmt.allocPrint(bun.default_allocator, "{s} is not a directory", .{this.tgt}) catch bun.outOfMemory() };
            const basename = ResolvePath.basename(src[0..src.len]);
            const parts: []const []const u8 = &.{
                tgt[0..tgt.len],
                basename,
            };
            tgt = ResolvePath.joinZBuf(buf3[0..bun.MAX_PATH_BYTES], parts, .auto);
            copying_many = true;
        }

        this.src_absolute = bun.default_allocator.dupeZ(u8, src[0..src.len]) catch bun.outOfMemory();
        this.tgt_absolute = bun.default_allocator.dupeZ(u8, tgt[0..tgt.len]) catch bun.outOfMemory();

        const args = JSC.Node.fs.Arguments.Cp{
            .src = JSC.Node.PathLike{ .string = bun.PathString.init(this.src_absolute.?) },
            .dest = JSC.Node.PathLike{ .string = bun.PathString.init(this.tgt_absolute.?) },
            .flags = .{
                .mode = @enumFromInt(0),
                .recursive = this.opts.recursive,
                .force = true,
                .errorOnExist = false,
                .deinit_paths = false,
            },
        };

        debug("Scheduling {s} -> {s}", .{ this.src_absolute.?, this.tgt_absolute.? });
        if (this.event_loop == .js) {
            const vm: *JSC.VirtualMachine = this.event_loop.js.getVmImpl();
            debug("Yoops", .{});
            _ = bun.api.node.fs.ShellAsyncCpTask.createWithShellTask(
                vm.global,
                args,
                vm,
                bun.ArenaAllocator.init(bun.default_allocator),
                this,
                false,
            );
        } else {
            _ = bun.api.node.fs.ShellAsyncCpTask.createMini(
                args,
                this.event_loop.mini,
                bun.ArenaAllocator.init(bun.default_allocator),
                this,
            );
        }

        return null;
    }

    fn onSubtaskFinish(this: *ShellCpTask, err: Maybe(void)) void {
        debug("onSubtaskFinish", .{});
        if (err.asErr()) |e| {
            this.err = bun.shell.ShellErr.newSys(e);
        }
        this.enqueueToEventLoop();
    }

    pub fn onCopyImpl(this: *ShellCpTask, src: [:0]const u8, dest: [:0]const u8) void {
        this.verbose_output_lock.lock();
        log("onCopy: {s} -> {s}\n", .{ src, dest });
        defer this.verbose_output_lock.unlock();
        var writer = this.verbose_output.writer();
        writer.print("{s} -> {s}\n", .{ src, dest }) catch bun.outOfMemory();
    }

    pub fn cpOnCopy(this: *ShellCpTask, src_: anytype, dest_: anytype) void {
        if (!this.opts.verbose) return;
        if (comptime bun.Environment.isPosix) return this.onCopyImpl(src_, dest_);

        var buf: bun.PathBuffer = undefined;
        var buf2: bun.PathBuffer = undefined;
        const src: [:0]const u8 = switch (@TypeOf(src_)) {
            [:0]const u8, [:0]u8 => src_,
            [:0]const u16, [:0]u16 => bun.strings.fromWPath(buf[0..], src_),
            else => @compileError("Invalid type: " ++ @typeName(@TypeOf(src_))),
        };
        const dest: [:0]const u8 = switch (@TypeOf(dest_)) {
            [:0]const u8, [:0]u8 => src_,
            [:0]const u16, [:0]u16 => bun.strings.fromWPath(buf2[0..], dest_),
            else => @compileError("Invalid type: " ++ @typeName(@TypeOf(dest_))),
        };
        this.onCopyImpl(src, dest);
    }

    pub fn cpOnFinish(this: *ShellCpTask, result: Maybe(void)) void {
        this.onSubtaskFinish(result);
    }
};

const Opts = packed struct(u16) {
    /// -f
    ///
    /// If the destination file cannot be opened, remove it and create a
    /// new file, without prompting for confirmation regardless of its
    /// permissions.  (The -f option overrides any previous -n option.) The
    /// target file is not unlinked before the copy.  Thus, any existing access
    /// rights will be retained.
    remove_and_create_new_file_if_not_found: bool = false,

    /// -H
    ///
    /// Take actions based on the type and contents of the file
    /// referenced by any symbolic link specified as a
    /// source_file operand.
    dereference_command_line_symlinks: bool = false,

    /// -i
    ///
    /// Write a prompt to standard error before copying to any
    /// existing non-directory destination file. If the
    /// response from the standard input is affirmative, the
    /// copy shall be attempted; otherwise, it shall not.
    interactive: bool = false,

    /// -L
    ///
    /// Take actions based on the type and contents of the file
    /// referenced by any symbolic link specified as a
    /// source_file operand or any symbolic links encountered
    /// during traversal of a file hierarchy.
    dereference_all_symlinks: bool = false,

    /// -P
    ///
    /// Take actions on any symbolic link specified as a
    /// source_file operand or any symbolic link encountered
    /// during traversal of a file hierarchy.
    preserve_symlinks: bool = false,

    /// -p
    ///
    /// Duplicate the following characteristics of each source
    /// file in the corresponding destination file:
    /// 1. The time of last data modification and time of last
    ///    access.
    /// 2. The user ID and group ID.
    /// 3. The file permission bits and the S_ISUID and
    ///    S_ISGID bits.
    preserve_file_attributes: bool = false,

    /// -R
    ///
    /// Copy file hierarchies.
    recursive: bool = false,

    /// -v
    ///
    /// Cause cp to be verbose, showing files as they are copied.
    verbose: bool = false,

    /// -n
    ///
    /// Do not overwrite an existing file.  (The -n option overrides any previous -f or -i options.)
    overwrite_existing_file: bool = true,

    _padding: u7 = 0,

    const Parse = FlagParser(*@This());

    pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
        return Parse.parseFlags(opts, args);
    }

    pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
        _ = this;
        _ = flag;
        return null;
    }

    pub fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
        switch (char) {
            'f' => {
                return .{ .unsupported = unsupportedFlag("-f") };
            },
            'H' => {
                return .{ .unsupported = unsupportedFlag("-H") };
            },
            'i' => {
                return .{ .unsupported = unsupportedFlag("-i") };
            },
            'L' => {
                return .{ .unsupported = unsupportedFlag("-L") };
            },
            'P' => {
                return .{ .unsupported = unsupportedFlag("-P") };
            },
            'p' => {
                return .{ .unsupported = unsupportedFlag("-P") };
            },
            'R' => {
                this.recursive = true;
                return .continue_parsing;
            },
            'v' => {
                this.verbose = true;
                return .continue_parsing;
            },
            'n' => {
                this.overwrite_existing_file = true;
                this.remove_and_create_new_file_if_not_found = false;
                return .continue_parsing;
            },
            else => {
                return .{ .illegal_option = smallflags[i..] };
            },
        }

        return null;
    }
};

// --
const log = bun.Output.scoped(.cp, true);
const ArrayList = std.ArrayList;
const Syscall = bun.sys;
const bun = @import("bun");
const shell = bun.shell;
const Yield = shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;
const ParseError = interpreter.ParseError;
const ParseFlagResult = interpreter.ParseFlagResult;
const ExitCode = shell.ExitCode;
const Cp = @This();
const OutputTask = interpreter.OutputTask;
const assert = bun.assert;

const OutputSrc = interpreter.OutputSrc;
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");
const FlagParser = interpreter.FlagParser;

const unsupportedFlag = interpreter.unsupportedFlag;
const WorkPool = JSC.WorkPool;
const WorkPoolTask = JSC.WorkPoolTask;
const ResolvePath = bun.path;
