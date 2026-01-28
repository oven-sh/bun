var default_manager_mutex: Mutex = .{};
var default_manager: ?*PathWatcherManager = null;

pub const PathWatcherManager = struct {
    const options = @import("../../options.zig");
    const log = Output.scoped(.PathWatcherManager, .visible);
    main_watcher: *Watcher,

    watchers: bun.BabyList(?*PathWatcher) = .{},
    watcher_count: u32 = 0,
    vm: *jsc.VirtualMachine,
    file_paths: bun.StringHashMap(PathInfo),
    current_fd_task: bun.FDHashMap(*DirectoryRegisterTask),
    deinit_on_last_watcher: bool = false,
    pending_tasks: u32 = 0,
    deinit_on_last_task: bool = false,
    has_pending_tasks: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    mutex: Mutex,
    const PathInfo = struct {
        fd: FD = .invalid,
        is_file: bool = true,
        path: [:0]const u8,
        dirname: string,
        refs: u32 = 0,
        hash: Watcher.HashType,
    };

    fn refPendingTask(this: *PathWatcherManager) bool {
        this.mutex.lock();
        defer this.mutex.unlock();
        if (this.deinit_on_last_task) return false;
        this.pending_tasks += 1;
        this.has_pending_tasks.store(true, .release);
        return true;
    }

    fn hasPendingTasks(this: *PathWatcherManager) callconv(.c) bool {
        return this.has_pending_tasks.load(.acquire);
    }

    fn unrefPendingTask(this: *PathWatcherManager) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        this.pending_tasks -= 1;
        if (this.deinit_on_last_task and this.pending_tasks == 0) {
            this.has_pending_tasks.store(false, .release);
            this.deinit();
        }
    }

    fn _fdFromAbsolutePathZ(
        this: *PathWatcherManager,
        path: [:0]const u8,
    ) bun.sys.Maybe(PathInfo) {
        this.mutex.lock();
        defer this.mutex.unlock();

        if (this.file_paths.getEntry(path)) |entry| {
            var info = entry.value_ptr;
            info.refs += 1;
            return .{ .result = info.* };
        }

        switch (switch (Environment.os) {
            else => bun.sys.open(path, bun.O.DIRECTORY | bun.O.RDONLY, 0),
            // windows bun.sys.open does not pass iterable=true,
            .windows => bun.sys.openDirAtWindowsA(bun.FD.cwd(), path, .{ .iterable = true, .read_only = true }),
        }) {
            .err => |e| {
                if (e.errno == @intFromEnum(bun.sys.E.NOTDIR)) {
                    const file = switch (bun.sys.open(path, 0, 0)) {
                        .err => |file_err| return .{ .err = file_err.withPath(path) },
                        .result => |r| r,
                    };
                    const cloned_path = bun.handleOom(bun.default_allocator.dupeZ(u8, path));
                    const result = PathInfo{
                        .fd = file,
                        .is_file = true,
                        .path = cloned_path,
                        // if is really a file we need to get the dirname
                        .dirname = std.fs.path.dirname(cloned_path) orelse cloned_path,
                        .hash = Watcher.getHash(cloned_path),
                        .refs = 1,
                    };
                    _ = bun.handleOom(this.file_paths.put(cloned_path, result));
                    return .{ .result = result };
                }
                return .{ .err = e.withPath(path) };
            },
            .result => |iterable_dir| {
                const cloned_path = bun.handleOom(bun.default_allocator.dupeZ(u8, path));
                const result = PathInfo{
                    .fd = iterable_dir,
                    .is_file = false,
                    .path = cloned_path,
                    .dirname = cloned_path,
                    .hash = Watcher.getHash(cloned_path),
                    .refs = 1,
                };
                _ = bun.handleOom(this.file_paths.put(cloned_path, result));
                return .{ .result = result };
            },
        }
    }

    const PathWatcherManagerError = std.mem.Allocator.Error ||
        std.posix.KQueueError ||
        error{KQueueError} ||
        std.posix.INotifyInitError ||
        std.Thread.SpawnError;

    pub fn init(vm: *jsc.VirtualMachine) PathWatcherManagerError!*PathWatcherManager {
        const this = bun.handleOom(bun.default_allocator.create(PathWatcherManager));
        errdefer bun.default_allocator.destroy(this);
        var watchers = bun.handleOom(bun.BabyList(?*PathWatcher).initCapacity(bun.default_allocator, 1));
        errdefer watchers.deinit(bun.default_allocator);

        const manager = PathWatcherManager{
            .file_paths = bun.StringHashMap(PathInfo).init(bun.default_allocator),
            .current_fd_task = bun.FDHashMap(*DirectoryRegisterTask).init(bun.default_allocator),
            .watchers = watchers,
            .main_watcher = try Watcher.init(
                PathWatcherManager,
                this,
                vm.transpiler.fs,
                bun.default_allocator,
            ),
            .vm = vm,
            .watcher_count = 0,
            .mutex = .{},
        };

        this.* = manager;
        try this.main_watcher.start();
        return this;
    }

    pub fn onFileUpdate(
        this: *PathWatcherManager,
        events: []Watcher.WatchEvent,
        changed_files: []?[:0]u8,
        watchlist: Watcher.WatchList,
    ) void {
        var slice = watchlist.slice();
        const file_paths = slice.items(.file_path);

        var counts = slice.items(.count);
        const kinds = slice.items(.kind);
        var _on_file_update_path_buf: bun.PathBuffer = undefined;

        var ctx = this.main_watcher;
        defer ctx.flushEvictions();

        const timestamp = std.time.milliTimestamp();

        this.mutex.lock();
        defer this.mutex.unlock();

        const watchers = this.watchers.slice();

        for (events) |event| {
            if (event.index >= file_paths.len) continue;
            const file_path = file_paths[event.index];
            const update_count = counts[event.index] + 1;
            counts[event.index] = update_count;
            const kind = kinds[event.index];

            if (comptime Environment.isDebug) {
                log("[watch] {s} ({s}, {f})", .{ file_path, @tagName(kind), event.op });
            }

            switch (kind) {
                .file => {
                    if (event.op.delete) {
                        ctx.removeAtIndex(
                            event.index,
                            0,
                            &.{},
                            .file,
                        );
                    }

                    if (event.op.write or event.op.delete or event.op.rename) {
                        const event_type: PathWatcher.EventType = if (event.op.delete or event.op.rename or event.op.move_to) .rename else .change;
                        const hash = Watcher.getHash(file_path);

                        for (watchers) |w| {
                            if (w) |watcher| {
                                if (comptime Environment.isMac) {
                                    if (watcher.fsevents_watcher != null) continue;
                                }
                                const entry_point = watcher.path.dirname;
                                var path = file_path;

                                if (path.len < entry_point.len) {
                                    continue;
                                }
                                if (watcher.path.is_file) {
                                    if (watcher.path.hash != hash) {
                                        continue;
                                    }
                                } else {
                                    if (!bun.strings.startsWith(path, entry_point)) {
                                        continue;
                                    }
                                }
                                // Remove common prefix, unless the watched folder is "/"
                                if (!(path.len == 1 and entry_point[0] == '/')) {
                                    path = path[entry_point.len..];

                                    // Ignore events with path equal to directory itself
                                    if (path.len <= 1) {
                                        continue;
                                    }

                                    if (bun.strings.startsWithChar(path, '/')) {
                                        // Skip forward slash
                                        path = path[1..];
                                    }
                                }

                                // Do not emit events from subdirectories (without option set)
                                if (path.len == 0 or (bun.strings.containsChar(path, '/') and !watcher.recursive)) {
                                    continue;
                                }
                                watcher.emit(event_type.toEvent(path), hash, timestamp, true);
                            }
                        }
                    }
                },
                .directory => {
                    const affected = event.names(changed_files);

                    for (affected) |changed_name_| {
                        const changed_name: []const u8 = bun.asByteSlice(changed_name_.?);
                        if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                        const file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);

                        @memcpy(_on_file_update_path_buf[0..file_path_without_trailing_slash.len], file_path_without_trailing_slash);

                        _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                        @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len + 1 ..][0..changed_name.len], changed_name);
                        const len = file_path_without_trailing_slash.len + changed_name.len;
                        const path_slice = _on_file_update_path_buf[0 .. len + 1];

                        const hash = Watcher.getHash(path_slice);

                        // skip consecutive duplicates
                        // If it's a create, delete, rename, or move event, emit "rename"
                        // If it's a pure write (modify) event, emit "change"
                        const event_type: PathWatcher.EventType = if (event.op.create or event.op.delete or event.op.rename or event.op.move_to) .rename else .change;
                        for (watchers) |w| {
                            if (w) |watcher| {
                                if (comptime Environment.isMac) {
                                    if (watcher.fsevents_watcher != null) continue;
                                }
                                const entry_point = watcher.path.dirname;
                                var path = path_slice;

                                if (watcher.path.is_file or path.len < entry_point.len or !bun.strings.startsWith(path, entry_point)) {
                                    continue;
                                }
                                // Remove common prefix, unless the watched folder is "/"
                                if (!(path.len == 1 and entry_point[0] == '/')) {
                                    path = path[entry_point.len..];

                                    // Skip leading slash
                                    if (bun.strings.startsWithChar(path, '/')) {
                                        path = path[1..];
                                    }
                                }

                                // Do not emit events from subdirectories (without option set)
                                if (path.len == 0 or (bun.strings.containsChar(path, '/') and !watcher.recursive)) {
                                    continue;
                                }

                                watcher.emit(event_type.toEvent(path), hash, timestamp, false);
                            }
                        }
                    }
                },
            }
        }

        if (comptime Environment.isDebug) {
            Output.flush();
        }
        for (watchers) |w| {
            if (w) |watcher| {
                if (watcher.needs_flush) watcher.flush();
            }
        }
    }

    pub fn onError(
        this: *PathWatcherManager,
        err: bun.sys.Error,
    ) void {
        {
            this.mutex.lock();
            defer this.mutex.unlock();
            const watchers = this.watchers.slice();
            const timestamp = std.time.milliTimestamp();

            // stop all watchers
            for (watchers) |w| {
                if (w) |watcher| {
                    log("[watch] error: {f}", .{err});
                    watcher.emit(.{ .@"error" = err }, 0, timestamp, false);
                    watcher.flush();
                }
            }

            // we need a new manager at this point
            default_manager_mutex.lock();
            defer default_manager_mutex.unlock();
            default_manager = null;
        }

        // deinit manager when all watchers are closed
        this.deinit();
    }

    pub const DirectoryRegisterTask = struct {
        manager: *PathWatcherManager,
        path: PathInfo,
        task: jsc.WorkPoolTask = .{ .callback = callback },
        watcher_list: bun.BabyList(*PathWatcher) = .{},

        pub fn callback(task: *jsc.WorkPoolTask) void {
            var routine: *@This() = @fieldParentPtr("task", task);
            defer routine.deinit();
            routine.run();
        }

        fn schedule(manager: *PathWatcherManager, watcher: *PathWatcher, path: PathInfo) !void {
            // keep the path alive
            manager._incrementPathRef(path.path);
            errdefer manager._decrementPathRef(path.path);
            var routine: *DirectoryRegisterTask = undefined;
            {
                manager.mutex.lock();
                defer manager.mutex.unlock();

                // use the same thread for the same fd to avoid race conditions
                if (manager.current_fd_task.getEntry(path.fd)) |entry| {
                    routine = entry.value_ptr.*;

                    if (watcher.refPendingDirectory()) {
                        routine.watcher_list.append(bun.default_allocator, watcher) catch |err| {
                            watcher.unrefPendingDirectory();
                            return err;
                        };
                    } else {
                        return error.UnexpectedFailure;
                    }
                    return;
                }

                routine = try bun.default_allocator.create(DirectoryRegisterTask);
                routine.* = DirectoryRegisterTask{
                    .manager = manager,
                    .path = path,
                    .watcher_list = bun.BabyList(*PathWatcher).initCapacity(bun.default_allocator, 1) catch |err| {
                        bun.default_allocator.destroy(routine);
                        return err;
                    },
                };
                errdefer routine.deinit();
                if (watcher.refPendingDirectory()) {
                    routine.watcher_list.append(bun.default_allocator, watcher) catch |err| {
                        watcher.unrefPendingDirectory();
                        return err;
                    };
                } else {
                    return error.UnexpectedFailure;
                }
                manager.current_fd_task.put(path.fd, routine) catch |err| {
                    watcher.unrefPendingDirectory();
                    return err;
                };
            }
            if (manager.refPendingTask()) {
                jsc.WorkPool.schedule(&routine.task);
                return;
            }
            return error.UnexpectedFailure;
        }

        fn getNext(this: *DirectoryRegisterTask) ?*PathWatcher {
            this.manager.mutex.lock();
            defer this.manager.mutex.unlock();

            const watcher = this.watcher_list.pop();
            if (watcher == null) {
                // no more work todo, release the fd and path
                _ = this.manager.current_fd_task.remove(this.path.fd);
                this.manager._decrementPathRefNoLock(this.path.path);
                return null;
            }
            return watcher;
        }

        fn processWatcher(
            this: *DirectoryRegisterTask,
            watcher: *PathWatcher,
            buf: *bun.PathBuffer,
        ) bun.sys.Maybe(void) {
            if (Environment.isWindows) @compileError("use win_watcher.zig");

            const manager = this.manager;
            const path = this.path;
            const fd = path.fd;
            var iter = fd.stdDir().iterate();

            // now we iterate over all files and directories
            while (iter.next() catch |err| {
                return .{
                    .err = .{
                        .errno = @truncate(@intFromEnum(switch (err) {
                            error.AccessDenied, error.PermissionDenied => bun.sys.E.ACCES,
                            error.SystemResources => bun.sys.E.NOMEM,
                            error.Unexpected,
                            error.InvalidUtf8,
                            => bun.sys.E.INVAL,
                        })),
                        .syscall = .watch,
                    },
                };
            }) |entry| {
                var parts = [2]string{ path.path, entry.name };
                const entry_path = Path.joinAbsStringBuf(
                    Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(),
                    buf,
                    &parts,
                    .auto,
                );

                buf[entry_path.len] = 0;
                const entry_path_z = buf[0..entry_path.len :0];

                const child_path = switch (manager._fdFromAbsolutePathZ(entry_path_z)) {
                    .result => |result| result,
                    .err => |e| return .{ .err = e },
                };

                {
                    watcher.mutex.lock();
                    defer watcher.mutex.unlock();
                    watcher.file_paths.append(bun.default_allocator, child_path.path) catch |err| {
                        manager._decrementPathRef(entry_path_z);
                        return switch (err) {
                            error.OutOfMemory => .{ .err = .{
                                .errno = @truncate(@intFromEnum(bun.sys.E.NOMEM)),
                                .syscall = .watch,
                            } },
                        };
                    };
                }

                // we need to call this unlocked
                if (child_path.is_file) {
                    switch (manager.main_watcher.addFile(
                        child_path.fd,
                        child_path.path,
                        child_path.hash,
                        options.Loader.file,
                        .invalid,
                        null,
                        false,
                    )) {
                        .err => |err| return .{ .err = err },
                        .result => {},
                    }
                } else {
                    if (watcher.recursive and !watcher.isClosed()) {
                        // this may trigger another thread with is desired when available to watch long trees
                        switch (manager._addDirectory(watcher, child_path)) {
                            .err => |err| return .{ .err = err.withPath(child_path.path) },
                            .result => {},
                        }
                    }
                }
            }
            return .success;
        }

        fn run(this: *DirectoryRegisterTask) void {
            if (comptime Environment.isWindows) {
                return bun.todo(@src(), {});
            }

            var buf: bun.PathBuffer = undefined;

            while (this.getNext()) |watcher| {
                defer watcher.unrefPendingDirectory();
                switch (this.processWatcher(watcher, &buf)) {
                    .err => |err| {
                        log("[watch] error registering directory: {f}", .{err});
                        watcher.emit(.{ .@"error" = err }, 0, std.time.milliTimestamp(), false);
                        watcher.flush();
                    },
                    .result => {},
                }
            }

            this.manager.unrefPendingTask();
        }

        fn deinit(this: *DirectoryRegisterTask) void {
            bun.default_allocator.destroy(this);
        }
    };

    // this should only be called if thread pool is not null
    fn _addDirectory(this: *PathWatcherManager, watcher: *PathWatcher, path: PathInfo) bun.sys.Maybe(void) {
        const fd = path.fd;
        switch (this.main_watcher.addDirectory(fd, path.path, path.hash, false)) {
            .err => |err| return .{ .err = err.withPath(path.path) },
            .result => {},
        }

        return .{
            .result = DirectoryRegisterTask.schedule(this, watcher, path) catch |err| return .{
                .err = .{
                    .errno = @truncate(@intFromEnum(switch (err) {
                        error.OutOfMemory => bun.sys.E.NOMEM,
                        error.UnexpectedFailure => bun.sys.E.INVAL,
                    })),
                },
            },
        };
    }

    // register is always called form main thread
    fn registerWatcher(this: *PathWatcherManager, watcher: *PathWatcher) !void {
        {
            this.mutex.lock();
            defer this.mutex.unlock();

            if (this.watcher_count == this.watchers.len) {
                this.watcher_count += 1;
                this.watchers.append(bun.default_allocator, watcher) catch |err| {
                    this.watcher_count -= 1;
                    return err;
                };
            } else {
                var watchers = this.watchers.slice();
                for (watchers, 0..) |w, i| {
                    if (w == null) {
                        watchers[i] = watcher;
                        this.watcher_count += 1;
                        break;
                    }
                }
            }
        }

        const path = watcher.path;
        if (path.is_file) {
            try this.main_watcher.addFile(path.fd, path.path, path.hash, .file, .invalid, null, false).unwrap();
        } else {
            if (comptime Environment.isMac) {
                if (watcher.fsevents_watcher != null) {
                    return;
                }
            }
            try this._addDirectory(watcher, path).unwrap();
        }
    }

    fn _incrementPathRef(this: *PathWatcherManager, file_path: [:0]const u8) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        if (this.file_paths.getEntry(file_path)) |entry| {
            var path = entry.value_ptr;
            if (path.refs > 0) {
                path.refs += 1;
            }
        }
    }

    fn _decrementPathRefNoLock(this: *PathWatcherManager, file_path: [:0]const u8) void {
        if (this.file_paths.getEntry(file_path)) |entry| {
            var path = entry.value_ptr;
            if (path.refs > 0) {
                path.refs -= 1;
                if (path.refs == 0) {
                    const path_ = path.path;
                    this.main_watcher.remove(path.hash);
                    _ = this.file_paths.remove(path_);
                    bun.default_allocator.free(path_);
                }
            }
        }
    }

    fn _decrementPathRef(this: *PathWatcherManager, file_path: [:0]const u8) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        this._decrementPathRefNoLock(file_path);
    }

    // unregister is always called form main thread
    fn unregisterWatcher(this: *PathWatcherManager, watcher: *PathWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();

        var watchers = this.watchers.slice();
        defer {
            if (this.deinit_on_last_watcher and this.watcher_count == 0) {
                this.deinit();
            }
        }

        for (watchers, 0..) |w, i| {
            if (w) |item| {
                if (item == watcher) {
                    watchers[i] = null;
                    // if is the last one just pop
                    if (i == watchers.len - 1) {
                        this.watchers.len -= 1;
                    }
                    this.watcher_count -= 1;

                    this._decrementPathRefNoLock(watcher.path.path);
                    if (comptime Environment.isMac) {
                        if (watcher.fsevents_watcher != null) {
                            break;
                        }
                    }

                    {
                        watcher.mutex.lock();
                        defer watcher.mutex.unlock();
                        while (watcher.file_paths.pop()) |file_path| {
                            this._decrementPathRefNoLock(file_path);
                        }
                    }
                    break;
                }
            }
        }
    }

    fn deinit(this: *PathWatcherManager) void {
        // enable to create a new manager
        default_manager_mutex.lock();
        defer default_manager_mutex.unlock();
        if (default_manager == this) {
            default_manager = null;
        }

        // only deinit if no watchers are registered
        if (this.watcher_count > 0) {
            // wait last watcher to close
            this.deinit_on_last_watcher = true;
            return;
        }

        if (this.hasPendingTasks()) {
            this.mutex.lock();
            defer this.mutex.unlock();
            // deinit when all tasks are done
            this.deinit_on_last_task = true;
            return;
        }

        this.main_watcher.deinit(false);

        if (this.watcher_count > 0) {
            while (this.watchers.pop()) |watcher| {
                if (watcher) |w| {
                    // unlink watcher
                    w.manager = null;
                }
            }
        }

        // close all file descriptors and free paths
        var it = this.file_paths.iterator();
        while (it.next()) |*entry| {
            const path = entry.value_ptr.*;
            path.fd.close();
            bun.default_allocator.free(path.path);
        }

        this.file_paths.deinit();
        this.watchers.deinit(bun.default_allocator);
        this.current_fd_task.deinit();
        bun.default_allocator.destroy(this);
    }
};

pub const PathWatcher = struct {
    path: PathWatcherManager.PathInfo,
    callback: Callback,
    flushCallback: UpdateEndCallback,
    manager: ?*PathWatcherManager,
    recursive: bool,
    needs_flush: bool = false,
    ctx: ?*anyopaque,
    // all watched file paths (including subpaths) except by path it self
    file_paths: bun.BabyList([:0]const u8) = .{},
    last_change_event: ChangeEvent = .{},
    // on MacOS we use this to watch for changes on directories and subdirectories
    fsevents_watcher: ?*FSEvents.FSEventsWatcher,
    mutex: Mutex,
    pending_directories: u32 = 0,
    // only used on macOS
    resolved_path: ?string = null,
    has_pending_directories: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    closed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    pub const ChangeEvent = struct {
        hash: Watcher.HashType = 0,
        event_type: EventType = .change,
        time_stamp: i64 = 0,
    };

    pub const EventType = enum {
        rename,
        change,

        pub fn toEvent(event_type: EventType, path: FSWatcher.EventPathString) Event {
            return switch (event_type) {
                inline else => |t| @unionInit(Event, @tagName(t), path),
            };
        }
    };

    pub const Callback = *const fn (ctx: ?*anyopaque, detail: Event, is_file: bool) void;
    const UpdateEndCallback = *const fn (ctx: ?*anyopaque) void;

    pub fn init(manager: *PathWatcherManager, path: PathWatcherManager.PathInfo, recursive: bool, callback: Callback, updateEndCallback: UpdateEndCallback, ctx: ?*anyopaque) !*PathWatcher {
        var this = try bun.default_allocator.create(PathWatcher);

        if (comptime Environment.isMac) {
            if (!path.is_file) {
                var buffer: bun.PathBuffer = undefined;
                const resolved_path_temp = std.os.getFdPath(path.fd.cast(), &buffer) catch |err| {
                    bun.default_allocator.destroy(this);
                    return err;
                };
                const resolved_path = bun.default_allocator.dupeZ(u8, resolved_path_temp) catch |err| {
                    bun.default_allocator.destroy(this);
                    return err;
                };
                this.resolved_path = resolved_path;
                this.* = PathWatcher{
                    .path = path,
                    .callback = callback,
                    .fsevents_watcher = FSEvents.watch(
                        resolved_path,
                        recursive,
                        callback,
                        updateEndCallback,
                        bun.cast(*anyopaque, ctx),
                    ) catch |err| {
                        bun.default_allocator.destroy(this);
                        return err;
                    },
                    .manager = manager,
                    .recursive = recursive,
                    .flushCallback = updateEndCallback,
                    .file_paths = .{},
                    .ctx = ctx,
                    .mutex = .{},
                };

                errdefer this.deinit();

                // TODO: unify better FSEvents with PathWatcherManager
                try manager.registerWatcher(this);

                return this;
            }
        }

        this.* = PathWatcher{
            .fsevents_watcher = null,
            .path = path,
            .callback = callback,
            .manager = manager,
            .recursive = recursive,
            .flushCallback = updateEndCallback,
            .ctx = ctx,
            .mutex = .{},
            .file_paths = bun.BabyList([:0]const u8).initCapacity(bun.default_allocator, 1) catch |err| {
                bun.default_allocator.destroy(this);
                return err;
            },
        };

        errdefer this.deinit();

        try manager.registerWatcher(this);
        return this;
    }

    pub fn refPendingDirectory(this: *PathWatcher) bool {
        this.mutex.lock();
        defer this.mutex.unlock();
        if (this.isClosed()) return false;
        this.pending_directories += 1;
        this.has_pending_directories.store(true, .release);
        return true;
    }

    pub fn hasPendingDirectories(this: *PathWatcher) callconv(.c) bool {
        return this.has_pending_directories.load(.acquire);
    }

    pub fn isClosed(this: *PathWatcher) bool {
        return this.closed.load(.acquire);
    }

    pub fn setClosed(this: *PathWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        this.closed.store(true, .release);
    }

    pub fn unrefPendingDirectory(this: *PathWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        this.pending_directories -= 1;
        if (this.isClosed() and this.pending_directories == 0) {
            this.has_pending_directories.store(false, .release);
            this.deinit();
        }
    }

    pub fn emit(this: *PathWatcher, event: Event, hash: Watcher.HashType, time_stamp: i64, is_file: bool) void {
        switch (event) {
            .change, .rename => {
                const event_type = switch (event) {
                    inline .change, .rename => |_, t| @field(EventType, @tagName(t)),
                    else => unreachable, // above switch guarentees this subset
                };

                const time_diff = time_stamp - this.last_change_event.time_stamp;
                if (!((this.last_change_event.time_stamp == 0 or time_diff > 1) or
                    this.last_change_event.event_type != event_type and
                        this.last_change_event.hash != hash))
                {
                    // skip consecutive duplicates
                    return;
                }

                this.last_change_event.time_stamp = time_stamp;
                this.last_change_event.event_type = event_type;
            },
            else => {},
        }

        this.needs_flush = true;
        if (this.isClosed()) {
            return;
        }
        this.callback(this.ctx, event, is_file);
    }

    pub fn flush(this: *PathWatcher) void {
        this.needs_flush = false;
        if (this.isClosed()) return;
        this.flushCallback(this.ctx);
    }

    pub fn detach(this: *PathWatcher, _: *anyopaque) void {
        this.deinit();
    }

    pub fn deinit(this: *PathWatcher) void {
        this.setClosed();
        if (this.hasPendingDirectories()) {
            // will be freed on last directory
            return;
        }

        if (this.manager) |manager| {
            if (comptime Environment.isMac) {
                if (this.fsevents_watcher) |watcher| {
                    // first unregister on FSEvents
                    watcher.deinit();
                    manager.unregisterWatcher(this);
                } else {
                    manager.unregisterWatcher(this);
                    this.file_paths.deinit(bun.default_allocator);
                }
            } else {
                manager.unregisterWatcher(this);
                this.file_paths.deinit(bun.default_allocator);
            }
        }

        if (comptime Environment.isMac) {
            if (this.resolved_path) |path| {
                bun.default_allocator.free(path);
            }
        }

        bun.default_allocator.destroy(this);
    }
};

pub fn watch(
    vm: *VirtualMachine,
    path: [:0]const u8,
    recursive: bool,
    comptime callback: PathWatcher.Callback,
    comptime updateEnd: PathWatcher.UpdateEndCallback,
    ctx: ?*anyopaque,
) bun.sys.Maybe(*PathWatcher) {
    const manager = default_manager orelse brk: {
        default_manager_mutex.lock();
        defer default_manager_mutex.unlock();
        if (default_manager == null) {
            default_manager = PathWatcherManager.init(vm) catch |e| {
                return .{ .err = .{
                    .errno = @truncate(@intFromEnum(switch (e) {
                        error.SystemResources, error.LockedMemoryLimitExceeded, error.OutOfMemory => bun.sys.E.NOMEM,

                        error.ProcessFdQuotaExceeded,
                        error.SystemFdQuotaExceeded,
                        error.ThreadQuotaExceeded,
                        => bun.sys.E.MFILE,

                        error.Unexpected => bun.sys.E.NOMEM,

                        error.KQueueError => bun.sys.E.INVAL,
                    })),
                    .syscall = .watch,
                } };
            };
        }
        break :brk default_manager.?;
    };

    const path_info = switch (manager._fdFromAbsolutePathZ(path)) {
        .result => |result| result,
        .err => |_err| {
            var err = _err;
            err.syscall = .watch;
            return .{ .err = err };
        },
    };

    const watcher = PathWatcher.init(manager, path_info, recursive, callback, updateEnd, ctx) catch |e| {
        bun.handleErrorReturnTrace(e, @errorReturnTrace());
        manager._decrementPathRef(path);

        return .{ .err = .{
            .errno = @truncate(@intFromEnum(switch (e) {
                error.Unexpected,
                error.UnexpectedFailure,
                error.WatchAlreadyExists,
                error.NameTooLong,
                error.BadPathName,
                error.InvalidUtf8,
                error.InvalidWtf8,
                => bun.sys.E.INVAL,

                error.OutOfMemory,
                error.SystemResources,
                => bun.sys.E.NOMEM,

                error.FileNotFound,
                error.NetworkNotFound,
                error.NoDevice,
                => bun.sys.E.NOENT,

                error.DeviceBusy => bun.sys.E.BUSY,
                error.AccessDenied => bun.sys.E.PERM,
                error.InvalidHandle => bun.sys.E.BADF,
                error.SymLinkLoop => bun.sys.E.LOOP,
                error.NotDir => bun.sys.E.NOTDIR,

                error.ProcessFdQuotaExceeded,
                error.SystemFdQuotaExceeded,
                error.UserResourceLimitReached,
                => bun.sys.E.MFILE,

                else => bun.sys.E.INVAL,
            })),
            .syscall = .watch,
        } };
    };

    return .{ .result = watcher };
}

const string = []const u8;

const FSEvents = @import("./fs_events.zig");
const Fs = @import("../../fs.zig");
const Path = @import("../../resolver/resolve_path.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Mutex = bun.Mutex;
const Output = bun.Output;
const Watcher = bun.Watcher;

const FSWatcher = bun.api.node.fs.Watcher;
const Event = FSWatcher.Event;

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
