const Ls = @This();

opts: Opts = .{},

state: union(enum) {
    idle,
    exec: struct {
        err: ?Syscall.Error = null,
        task_count: std.atomic.Value(usize),
        tasks_done: usize = 0,
        output_waiting: usize = 0,
        output_done: usize = 0,
    },
    waiting_write_err,
    done,
} = .idle,

alloc_scope: shell.AllocScope,

pub fn start(this: *Ls) Yield {
    return this.next();
}

pub fn writeFailingError(this: *Ls, buf: []const u8, exit_code: ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);

    return this.bltn().done(exit_code);
}

fn next(this: *Ls) Yield {
    while (!(this.state == .done)) {
        switch (this.state) {
            .idle => {
                // Will be null if called with no args, in which case we just run once with "." directory
                const paths: ?[]const [*:0]const u8 = switch (this.parseOpts()) {
                    .ok => |paths| paths,
                    .err => |e| {
                        const buf = switch (e) {
                            .illegal_option => |opt_str| this.bltn().fmtErrorArena(.ls, "illegal option -- {s}\n", .{opt_str}),
                            .show_usage => Builtin.Kind.ls.usageString(),
                        };

                        return this.writeFailingError(buf, 1);
                    },
                };

                const task_count = if (paths) |p| p.len else 1;

                this.state = .{
                    .exec = .{
                        .task_count = std.atomic.Value(usize).init(task_count),
                    },
                };

                const cwd = this.bltn().cwd;
                if (paths) |p| {
                    const print_directory = p.len > 1;
                    for (p) |path_raw| {
                        const path = bun.handleOom(this.alloc_scope.allocator().dupeZ(u8, path_raw[0..std.mem.len(path_raw) :0]));
                        var task = ShellLsTask.create(
                            this,
                            this.opts,
                            &this.state.exec.task_count,
                            cwd,
                            path,
                            true,
                            this.bltn().eventLoop(),
                        );
                        task.print_directory = print_directory;
                        task.schedule();
                    }
                } else {
                    var task = ShellLsTask.create(
                        this,
                        this.opts,
                        &this.state.exec.task_count,
                        cwd,
                        ".",
                        false,
                        this.bltn().eventLoop(),
                    );
                    task.schedule();
                }
            },
            .exec => {
                log("Ls(0x{x}, state=exec) Check: tasks_done={d} task_count={d} output_done={d} output_waiting={d}", .{
                    @intFromPtr(this),
                    this.state.exec.tasks_done,
                    this.state.exec.task_count.load(.monotonic),
                    this.state.exec.output_done,
                    this.state.exec.output_waiting,
                });
                // It's done
                if (this.state.exec.tasks_done >= this.state.exec.task_count.load(.monotonic) and this.state.exec.output_done >= this.state.exec.output_waiting) {
                    const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                    if (this.state.exec.err) |*err| err.deinitWithAllocator(this.alloc_scope.allocator());
                    this.state = .done;
                    return this.bltn().done(exit_code);
                }
                return .suspended;
            },
            .waiting_write_err => {
                return .failed;
            },
            .done => unreachable,
        }
    }

    return this.bltn().done(0);
}

pub fn deinit(this: *Ls) void {
    this.alloc_scope.endScope();
}

pub fn onIOWriterChunk(this: *Ls, _: usize, e: ?jsc.SystemError) Yield {
    if (e) |err| err.deref();
    if (this.state == .waiting_write_err) {
        return this.bltn().done(1);
    }
    this.state.exec.output_done += 1;
    return this.next();
}

pub fn onShellLsTaskDone(this: *Ls, task: *ShellLsTask) void {
    this.state.exec.tasks_done += 1;
    var output = task.takeOutput();

    // TODO: Reuse the *ShellLsTask allocation
    const output_task: *ShellLsOutputTask = bun.new(ShellLsOutputTask, .{
        .parent = this,
        .output = .{
            .arrlist = brk: {
                // TODO: This is a quick fix, we should refactor shell.OutputTask to
                // also track allocations properly.
                this.alloc_scope.leakSlice(output.items);
                break :brk output.moveToUnmanaged();
            },
        },
        .state = .waiting_write_err,
    });

    if (task.err) |*err_ptr| {
        const error_string = error_string: {
            if (this.state.exec.err == null) {
                this.state.exec.err = err_ptr.*;
                break :error_string this.bltn().taskErrorToString(.ls, this.state.exec.err.?);
            }
            var err = err_ptr.*;
            defer err.deinitWithAllocator(this.alloc_scope.allocator());
            break :error_string this.bltn().taskErrorToString(.ls, err);
        };
        task.err = null;
        task.deinit();
        output_task.start(error_string).run();
        return;
    }
    task.deinit();
    output_task.start(null).run();
}

pub const ShellLsOutputTask = OutputTask(Ls, .{
    .writeErr = ShellLsOutputTaskVTable.writeErr,
    .onWriteErr = ShellLsOutputTaskVTable.onWriteErr,
    .writeOut = ShellLsOutputTaskVTable.writeOut,
    .onWriteOut = ShellLsOutputTaskVTable.onWriteOut,
    .onDone = ShellLsOutputTaskVTable.onDone,
});

const ShellLsOutputTaskVTable = struct {
    pub fn writeErr(this: *Ls, childptr: anytype, errbuf: []const u8) ?Yield {
        log("ShellLsOutputTaskVTable.writeErr(0x{x}, {s})", .{ @intFromPtr(this), errbuf });
        if (this.bltn().stderr.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            return this.bltn().stderr.enqueue(childptr, errbuf, safeguard);
        }
        _ = this.bltn().writeNoIO(.stderr, errbuf);
        return null;
    }

    pub fn onWriteErr(this: *Ls) void {
        log("ShellLsOutputTaskVTable.onWriteErr(0x{x})", .{@intFromPtr(this)});
        this.state.exec.output_done += 1;
    }

    pub fn writeOut(this: *Ls, childptr: anytype, output: *OutputSrc) ?Yield {
        log("ShellLsOutputTaskVTable.writeOut(0x{x}, {s})", .{ @intFromPtr(this), output.slice() });
        if (this.bltn().stdout.needsIO()) |safeguard| {
            this.state.exec.output_waiting += 1;
            return this.bltn().stdout.enqueue(childptr, output.slice(), safeguard);
        }
        log("ShellLsOutputTaskVTable.writeOut(0x{x}, {s}) no IO", .{ @intFromPtr(this), output.slice() });
        _ = this.bltn().writeNoIO(.stdout, output.slice());
        return null;
    }

    pub fn onWriteOut(this: *Ls) void {
        log("ShellLsOutputTaskVTable.onWriteOut(0x{x})", .{@intFromPtr(this)});
        this.state.exec.output_done += 1;
    }

    pub fn onDone(this: *Ls) Yield {
        log("ShellLsOutputTaskVTable.onDone(0x{x})", .{@intFromPtr(this)});
        return this.next();
    }
};

pub const ShellLsTask = struct {
    const debug = bun.Output.scoped(.ShellLsTask, .hidden);
    ls: *Ls,
    opts: Opts,

    print_directory: bool = false,
    owned_string: bool,
    task_count: *std.atomic.Value(usize),

    cwd: bun.FileDescriptor,
    path: [:0]const u8 = &[0:0]u8{},
    output: std.array_list.Managed(u8),
    is_absolute: bool = false,
    err: ?Syscall.Error = null,
    result_kind: enum { file, dir, idk } = .idk,
    /// Cached current time (seconds since epoch) for formatting timestamps.
    /// Cached once per task to avoid repeated syscalls.
    #now_secs: u64 = 0,

    event_loop: jsc.EventLoopHandle,
    concurrent_task: jsc.EventLoopTask,
    task: jsc.WorkPoolTask = .{ .callback = workPoolCallback },

    pub fn schedule(this: *@This()) void {
        jsc.WorkPool.schedule(&this.task);
    }

    pub fn create(
        ls: *Ls,
        opts: Opts,
        task_count: *std.atomic.Value(usize),
        cwd: bun.FileDescriptor,
        path: [:0]const u8,
        owned_string: bool,
        event_loop: jsc.EventLoopHandle,
    ) *@This() {
        // We're going to free `task.path` so ensure it is allocated in this
        // scope and NOT a string literal or other string we don't own.
        if (owned_string) ls.alloc_scope.assertInScope(path);

        const task = bun.handleOom(ls.alloc_scope.allocator().create(@This()));
        task.* = @This(){
            .ls = ls,
            .opts = opts,
            .cwd = cwd,
            .concurrent_task = jsc.EventLoopTask.fromEventLoop(event_loop),
            .event_loop = event_loop,
            .task_count = task_count,
            .path = path,
            .output = std.array_list.Managed(u8).init(ls.alloc_scope.allocator()),
            .owned_string = owned_string,
        };

        return task;
    }

    pub fn enqueue(this: *@This(), path: [:0]const u8) void {
        debug("enqueue: {s}", .{path});
        const new_path = this.join(
            this.ls.alloc_scope.allocator(),
            &[_][]const u8{
                this.path[0..this.path.len],
                path[0..path.len],
            },
            this.is_absolute,
        );

        var subtask = @This().create(this.ls, this.opts, this.task_count, this.cwd, new_path, true, this.event_loop);
        _ = this.task_count.fetchAdd(1, .monotonic);
        subtask.print_directory = true;
        subtask.schedule();
    }

    inline fn join(_: *@This(), alloc: Allocator, subdir_parts: []const []const u8, is_absolute: bool) [:0]const u8 {
        if (!is_absolute) {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path
            return bun.handleOom(std.fs.path.joinZ(alloc, subdir_parts));
        }

        const out = bun.handleOom(alloc.dupeZ(u8, bun.path.join(subdir_parts, .auto)));

        return out;
    }

    pub fn run(this: *@This()) void {
        // Cache current time once per task for timestamp formatting
        if (this.opts.long_listing) {
            this.#now_secs = @intCast(std.time.timestamp());
        }

        const fd = switch (ShellSyscall.openat(this.cwd, this.path, bun.O.RDONLY | bun.O.DIRECTORY, 0)) {
            .err => |e| {
                switch (e.getErrno()) {
                    .NOENT => {
                        this.err = this.errorWithPath(e, this.path);
                    },
                    .NOTDIR => {
                        this.result_kind = .file;
                        this.addEntry(this.path, this.cwd);
                    },
                    else => {
                        this.err = this.errorWithPath(e, this.path);
                    },
                }
                return;
            },
            .result => |fd| fd,
        };

        defer {
            fd.close();
            debug("run done", .{});
        }

        if (!this.opts.list_directories) {
            if (this.print_directory) {
                const writer = this.output.writer();
                bun.handleOom(writer.print("{s}:\n", .{this.path}));
            }

            var iterator = DirIterator.iterate(fd, .u8);
            var entry = iterator.next();

            // If `-a` is used, "." and ".." should show up as results. However,
            // our `DirIterator` abstraction skips them, so let's just add them
            // now.
            this.addDotEntriesIfNeeded(fd);

            while (switch (entry) {
                .err => |e| {
                    this.err = this.errorWithPath(e, this.path);
                    return;
                },
                .result => |ent| ent,
            }) |current| : (entry = iterator.next()) {
                this.addEntry(current.name.sliceAssumeZ(), fd);
                if (current.kind == .directory and this.opts.recursive) {
                    this.enqueue(current.name.sliceAssumeZ());
                }
            }

            return;
        }

        const writer = this.output.writer();
        bun.handleOom(writer.print("{s}\n", .{this.path}));
        return;
    }

    fn shouldSkipEntry(this: *@This(), name: [:0]const u8) bool {
        if (this.opts.show_all) return false;

        // Show all directory entries whose name begin with a dot (`.`), EXCEPT
        // `.` and `..`
        if (this.opts.show_almost_all) {
            if (bun.strings.eqlComptime(name, ".") or bun.strings.eqlComptime(name, "..")) return true;
        } else {
            if (bun.strings.startsWith(name, ".")) return true;
        }

        return false;
    }

    // TODO more complex output like multi-column
    fn addEntry(this: *@This(), name: [:0]const u8, dir_fd: bun.FileDescriptor) void {
        const skip = this.shouldSkipEntry(name);
        debug("Entry: (skip={}) {s} :: {s}", .{ skip, this.path, name });
        if (skip) return;

        if (this.opts.long_listing) {
            this.addEntryLong(name, dir_fd);
        } else {
            bun.handleOom(this.output.ensureUnusedCapacity(name.len + 1));
            bun.handleOom(this.output.appendSlice(name));
            bun.handleOom(this.output.append('\n'));
        }
    }

    fn addEntryLong(this: *@This(), name: [:0]const u8, dir_fd: bun.FileDescriptor) void {
        // Use lstatat to not follow symlinks (so symlinks show as 'l' type)
        const stat_result = Syscall.lstatat(dir_fd, name);
        const stat = switch (stat_result) {
            .err => {
                // If stat fails, just output the name with placeholders
                const writer = this.output.writer();
                bun.handleOom(writer.print("?????????? ? ? ? ?            ? {s}\n", .{name}));
                return;
            },
            .result => |s| s,
        };

        const writer = this.output.writer();

        // File type and permissions
        const mode: u32 = @intCast(stat.mode);
        const file_type = getFileTypeChar(mode);
        const perms = formatPermissions(mode);

        // Number of hard links
        const nlink: u64 = @intCast(stat.nlink);

        // Owner and group (numeric)
        const uid: u64 = @intCast(stat.uid);
        const gid: u64 = @intCast(stat.gid);

        // File size
        const size: i64 = @intCast(stat.size);

        // Modification time
        const mtime = stat.mtime();
        const time_str = formatTime(@intCast(mtime.sec), this.#now_secs);

        bun.handleOom(writer.print("{c}{s} {d: >3} {d: >5} {d: >5} {d: >8} {s} {s}\n", .{
            file_type,
            &perms,
            nlink,
            uid,
            gid,
            size,
            &time_str,
            name,
        }));
    }

    fn getFileTypeChar(mode: u32) u8 {
        const file_type = mode & bun.S.IFMT;
        return switch (file_type) {
            bun.S.IFDIR => 'd',
            bun.S.IFLNK => 'l',
            bun.S.IFBLK => 'b',
            bun.S.IFCHR => 'c',
            bun.S.IFIFO => 'p',
            bun.S.IFSOCK => 's',
            else => '-', // IFREG or unknown
        };
    }

    fn formatPermissions(mode: u32) [9]u8 {
        var perms: [9]u8 = undefined;
        // Owner permissions
        perms[0] = if (mode & bun.S.IRUSR != 0) 'r' else '-';
        perms[1] = if (mode & bun.S.IWUSR != 0) 'w' else '-';
        // Owner execute with setuid handling
        const owner_exec = mode & bun.S.IXUSR != 0;
        const setuid = mode & bun.S.ISUID != 0;
        perms[2] = if (setuid)
            (if (owner_exec) 's' else 'S')
        else
            (if (owner_exec) 'x' else '-');

        // Group permissions
        perms[3] = if (mode & bun.S.IRGRP != 0) 'r' else '-';
        perms[4] = if (mode & bun.S.IWGRP != 0) 'w' else '-';
        // Group execute with setgid handling
        const group_exec = mode & bun.S.IXGRP != 0;
        const setgid = mode & bun.S.ISGID != 0;
        perms[5] = if (setgid)
            (if (group_exec) 's' else 'S')
        else
            (if (group_exec) 'x' else '-');

        // Other permissions
        perms[6] = if (mode & bun.S.IROTH != 0) 'r' else '-';
        perms[7] = if (mode & bun.S.IWOTH != 0) 'w' else '-';
        // Other execute with sticky bit handling
        const other_exec = mode & bun.S.IXOTH != 0;
        const sticky = mode & bun.S.ISVTX != 0;
        perms[8] = if (sticky)
            (if (other_exec) 't' else 'T')
        else
            (if (other_exec) 'x' else '-');

        return perms;
    }

    fn formatTime(timestamp: i64, now_secs: u64) [12]u8 {
        var buf: [12]u8 = undefined;
        // Format as "Mon DD HH:MM" for recent files (within 6 months)
        // or "Mon DD  YYYY" for older files
        const epoch_secs: u64 = if (timestamp < 0) 0 else @intCast(timestamp);
        const epoch = std.time.epoch.EpochSeconds{ .secs = epoch_secs };
        const day_seconds = epoch.getDaySeconds();
        const year_day = epoch.getEpochDay().calculateYearDay();

        const month_names = [_][]const u8{ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        const month_day = year_day.calculateMonthDay();
        const month_name = month_names[month_day.month.numeric() - 1];

        // Check if file is older than 6 months (approximately 180 days)
        const six_months_secs: u64 = 180 * 24 * 60 * 60;
        const is_recent = epoch_secs > now_secs -| six_months_secs and epoch_secs <= now_secs + six_months_secs;

        if (is_recent) {
            const hours = day_seconds.getHoursIntoDay();
            const minutes = day_seconds.getMinutesIntoHour();

            _ = std.fmt.bufPrint(&buf, "{s} {d:0>2} {d:0>2}:{d:0>2}", .{
                month_name,
                month_day.day_index + 1,
                hours,
                minutes,
            }) catch {
                @memcpy(&buf, "??? ?? ??:??");
            };
        } else {
            // Show year for old files
            const year = year_day.year;

            _ = std.fmt.bufPrint(&buf, "{s} {d:0>2}  {d:4}", .{
                month_name,
                month_day.day_index + 1,
                year,
            }) catch {
                @memcpy(&buf, "??? ??  ????");
            };
        }

        return buf;
    }

    fn addDotEntriesIfNeeded(this: *@This(), dir_fd: bun.FileDescriptor) void {
        // `.addEntry()` already checks will check if we can add "." and ".." to
        // the result
        this.addEntry(".", dir_fd);
        this.addEntry("..", dir_fd);
    }

    fn errorWithPath(this: *@This(), err: Syscall.Error, path: [:0]const u8) Syscall.Error {
        debug("Ls(0x{x}).errorWithPath({s})", .{ @intFromPtr(this), path });
        return err.withPath(bun.handleOom(this.ls.alloc_scope.allocator().dupeZ(u8, path[0..path.len])));
    }

    pub fn workPoolCallback(task: *jsc.WorkPoolTask) void {
        var this: *@This() = @fieldParentPtr("task", task);
        this.run();
        this.doneLogic();
    }

    fn doneLogic(this: *@This()) void {
        debug("Done", .{});
        if (this.event_loop == .js) {
            this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn takeOutput(this: *@This()) std.array_list.Managed(u8) {
        const ret = this.output;
        this.output = std.array_list.Managed(u8).init(this.ls.alloc_scope.allocator());
        return ret;
    }

    pub fn runFromMainThread(this: *@This()) void {
        debug("runFromMainThread", .{});
        this.ls.onShellLsTaskDone(this);
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }

    pub fn deinit(this: *@This()) void {
        debug("deinit {s}", .{"free"});
        if (this.owned_string) this.ls.alloc_scope.allocator().free(this.path);
        if (this.err) |*err| err.deinitWithAllocator(this.ls.alloc_scope.allocator());
        this.output.deinit();
        this.ls.alloc_scope.allocator().destroy(this);
    }
};

const Opts = struct {
    /// `-a`, `--all`
    /// Do not ignore entries starting with .
    show_all: bool = false,

    /// `-A`, `--almost-all`
    /// Include directory entries whose names begin with a dot (‘.’) except for
    /// `.` and `..`
    show_almost_all: bool = false,

    /// `--author`
    /// With -l, print the author of each file
    show_author: bool = false,

    /// `-b`, `--escape`
    /// Print C-style escapes for nongraphic characters
    escape: bool = false,

    /// `--block-size=SIZE`
    /// With -l, scale sizes by SIZE when printing them; e.g., '--block-size=M'
    block_size: ?usize = null,

    /// `-B`, `--ignore-backups`
    /// Do not list implied entries ending with ~
    ignore_backups: bool = false,

    /// `-c`
    /// Sort by, and show, ctime (time of last change of file status information); affects sorting and display based on options
    use_ctime: bool = false,

    /// `-C`
    /// List entries by columns
    list_by_columns: bool = false,

    /// `--color[=WHEN]`
    /// Color the output; WHEN can be 'always', 'auto', or 'never'
    color: ?[]const u8 = null,

    /// `-d`, `--directory`
    /// List directories themselves, not their contents
    list_directories: bool = false,

    /// `-D`, `--dired`
    /// Generate output designed for Emacs' dired mode
    dired_mode: bool = false,

    /// `-f`
    /// List all entries in directory order
    unsorted: bool = false,

    /// `-F`, `--classify[=WHEN]`
    /// Append indicator (one of */=>@|) to entries; WHEN can be 'always', 'auto', or 'never'
    classify: ?[]const u8 = null,

    /// `--file-type`
    /// Likewise, except do not append '*'
    file_type: bool = false,

    /// `--format=WORD`
    /// Specify format: 'across', 'commas', 'horizontal', 'long', 'single-column', 'verbose', 'vertical'
    format: ?[]const u8 = null,

    /// `--full-time`
    /// Like -l --time-style=full-iso
    full_time: bool = false,

    /// `-g`
    /// Like -l, but do not list owner
    no_owner: bool = false,

    /// `--group-directories-first`
    /// Group directories before files
    group_directories_first: bool = false,

    /// `-G`, `--no-group`
    /// In a long listing, don't print group names
    no_group: bool = false,

    /// `-h`, `--human-readable`
    /// With -l and -s, print sizes like 1K 234M 2G etc.
    human_readable: bool = false,

    /// `--si`
    /// Use powers of 1000 not 1024 for sizes
    si_units: bool = false,

    /// `-H`, `--dereference-command-line`
    /// Follow symbolic links listed on the command line
    dereference_cmd_symlinks: bool = false,

    /// `--dereference-command-line-symlink-to-dir`
    /// Follow each command line symbolic link that points to a directory
    dereference_cmd_dir_symlinks: bool = false,

    /// `--hide=PATTERN`
    /// Do not list entries matching shell PATTERN
    hide_pattern: ?[]const u8 = null,

    /// `--hyperlink[=WHEN]`
    /// Hyperlink file names; WHEN can be 'always', 'auto', or 'never'
    hyperlink: ?[]const u8 = null,

    /// `--indicator-style=WORD`
    /// Append indicator with style to entry names: 'none', 'slash', 'file-type', 'classify'
    indicator_style: ?[]const u8 = null,

    /// `-i`, `--inode`
    /// Print the index number of each file
    show_inode: bool = false,

    /// `-I`, `--ignore=PATTERN`
    /// Do not list entries matching shell PATTERN
    ignore_pattern: ?[]const u8 = null,

    /// `-k`, `--kibibytes`
    /// Default to 1024-byte blocks for file system usage
    kibibytes: bool = false,

    /// `-l`
    /// Use a long listing format
    long_listing: bool = false,

    /// `-L`, `--dereference`
    /// Show information for the file the symbolic link references
    dereference: bool = false,

    /// `-m`
    /// Fill width with a comma separated list of entries
    comma_separated: bool = false,

    /// `-n`, `--numeric-uid-gid`
    /// Like -l, but list numeric user and group IDs
    numeric_uid_gid: bool = false,

    /// `-N`, `--literal`
    /// Print entry names without quoting
    literal: bool = false,

    /// `-o`
    /// Like -l, but do not list group information
    no_group_info: bool = false,

    /// `-p`, `--indicator-style=slash`
    /// Append / indicator to directories
    slash_indicator: bool = false,

    /// `-q`, `--hide-control-chars`
    /// Print ? instead of nongraphic characters
    hide_control_chars: bool = false,

    /// `--show-control-chars`
    /// Show nongraphic characters as-is
    show_control_chars: bool = false,

    /// `-Q`, `--quote-name`
    /// Enclose entry names in double quotes
    quote_name: bool = false,

    /// `--quoting-style=WORD`
    /// Use quoting style for entry names
    quoting_style: ?[]const u8 = null,

    /// `-r`, `--reverse`
    /// Reverse order while sorting
    reverse_order: bool = false,

    /// `-R`, `--recursive`
    /// List subdirectories recursively
    recursive: bool = false,

    /// `-s`, `--size`
    /// Print the allocated size of each file, in blocks
    show_size: bool = false,

    /// `-S`
    /// Sort by file size, largest first
    sort_by_size: bool = false,

    /// `--sort=WORD`
    /// Sort by a specified attribute
    sort_method: ?[]const u8 = null,

    /// `--time=WORD`
    /// Select which timestamp to use for display or sorting
    time_method: ?[]const u8 = null,

    /// `--time-style=TIME_STYLE`
    /// Time/date format with -l
    time_style: ?[]const u8 = null,

    /// `-t`
    /// Sort by time, newest first
    sort_by_time: bool = false,

    /// `-T`, `--tabsize=COLS`
    /// Assume tab stops at each specified number of columns
    tabsize: ?usize = null,

    /// `-u`
    /// Sort by, and show, access time
    use_atime: bool = false,

    /// `-U`
    /// Do not sort; list entries in directory order
    no_sort: bool = false,

    /// `-v`
    /// Natural sort of (version) numbers within text
    natural_sort: bool = false,

    /// `-w`, `--width=COLS`
    /// Set output width to specified number of columns
    output_width: ?usize = null,

    /// `-x`
    /// List entries by lines instead of by columns
    list_by_lines: bool = false,

    /// `-X`
    /// Sort alphabetically by entry extension
    sort_by_extension: bool = false,

    /// `-Z`, `--context`
    /// Print any security context of each file
    show_context: bool = false,

    /// `--zero`
    /// End each output line with NUL, not newline
    end_with_nul: bool = false,

    /// `-1`
    /// List one file per line
    one_file_per_line: bool = false,

    /// `--help`
    /// Display help and exit
    show_help: bool = false,

    /// `--version`
    /// Output version information and exit
    show_version: bool = false,

    /// Custom parse error for invalid options
    const ParseError = union(enum) {
        illegal_option: []const u8,
        show_usage,
    };
};

pub fn parseOpts(this: *Ls) Result(?[]const [*:0]const u8, Opts.ParseError) {
    return this.parseFlags();
}

pub fn parseFlags(this: *Ls) Result(?[]const [*:0]const u8, Opts.ParseError) {
    const args = this.bltn().argsSlice();
    var idx: usize = 0;
    if (args.len == 0) {
        return .{ .ok = null };
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

    return .{ .ok = null };
}

pub fn parseFlag(this: *Ls, flag: []const u8) union(enum) { continue_parsing, done, illegal_option: []const u8 } {
    if (flag.len == 0) return .done;
    if (flag[0] != '-') return .done;

    // FIXME windows
    if (flag.len == 1) return .{ .illegal_option = "-" };

    const small_flags = flag[1..];
    for (small_flags) |char| {
        switch (char) {
            'a' => {
                this.opts.show_all = true;
            },
            'A' => {
                this.opts.show_almost_all = true;
            },
            'b' => {
                this.opts.escape = true;
            },
            'B' => {
                this.opts.ignore_backups = true;
            },
            'c' => {
                this.opts.use_ctime = true;
            },
            'C' => {
                this.opts.list_by_columns = true;
            },
            'd' => {
                this.opts.list_directories = true;
            },
            'D' => {
                this.opts.dired_mode = true;
            },
            'f' => {
                this.opts.unsorted = true;
            },
            'F' => {
                this.opts.classify = "always";
            },
            'g' => {
                this.opts.no_owner = true;
            },
            'G' => {
                this.opts.no_group = true;
            },
            'h' => {
                this.opts.human_readable = true;
            },
            'H' => {
                this.opts.dereference_cmd_symlinks = true;
            },
            'i' => {
                this.opts.show_inode = true;
            },
            'I' => {
                this.opts.ignore_pattern = ""; // This will require additional logic to handle patterns
            },
            'k' => {
                this.opts.kibibytes = true;
            },
            'l' => {
                this.opts.long_listing = true;
            },
            'L' => {
                this.opts.dereference = true;
            },
            'm' => {
                this.opts.comma_separated = true;
            },
            'n' => {
                this.opts.numeric_uid_gid = true;
            },
            'N' => {
                this.opts.literal = true;
            },
            'o' => {
                this.opts.no_group_info = true;
            },
            'p' => {
                this.opts.slash_indicator = true;
            },
            'q' => {
                this.opts.hide_control_chars = true;
            },
            'Q' => {
                this.opts.quote_name = true;
            },
            'r' => {
                this.opts.reverse_order = true;
            },
            'R' => {
                this.opts.recursive = true;
            },
            's' => {
                this.opts.show_size = true;
            },
            'S' => {
                this.opts.sort_by_size = true;
            },
            't' => {
                this.opts.sort_by_time = true;
            },
            'T' => {
                this.opts.tabsize = 8; // Default tab size, needs additional handling for custom sizes
            },
            'u' => {
                this.opts.use_atime = true;
            },
            'U' => {
                this.opts.no_sort = true;
            },
            'v' => {
                this.opts.natural_sort = true;
            },
            'w' => {
                this.opts.output_width = 0; // Default to no limit, needs additional handling for custom widths
            },
            'x' => {
                this.opts.list_by_lines = true;
            },
            'X' => {
                this.opts.sort_by_extension = true;
            },
            'Z' => {
                this.opts.show_context = true;
            },
            '1' => {
                this.opts.one_file_per_line = true;
            },
            else => {
                return .{ .illegal_option = flag[1..2] };
            },
        }
    }

    return .continue_parsing;
}

pub inline fn bltn(this: *Ls) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("ls", this));
    return @fieldParentPtr("impl", impl);
}

const log = bun.Output.scoped(.ls, .hidden);

const std = @import("std");
const Allocator = std.mem.Allocator;

const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const OutputSrc = interpreter.OutputSrc;
const OutputTask = interpreter.OutputTask;
const ParseError = interpreter.ParseError;
const ShellSyscall = interpreter.ShellSyscall;

const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;

const bun = @import("bun");
const DirIterator = bun.DirIterator;
const Syscall = bun.sys;
const jsc = bun.jsc;

const shell = bun.shell;
const ExitCode = shell.ExitCode;
const Yield = bun.shell.Yield;
