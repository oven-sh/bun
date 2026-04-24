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
        // deinit() may destroy(this). Defer it until after unlock so we don't
        // unlock() a freed mutex. Zig defers fire LIFO, so registering this
        // defer before the lock/unlock pair makes it fire last (after unlock).
        var should_deinit = false;
        defer if (should_deinit) this.deinit();

        this.mutex.lock();
        defer this.mutex.unlock();
        this.pending_tasks -= 1;
        if (this.deinit_on_last_task and this.pending_tasks == 0) {
            this.has_pending_tasks.store(false, .release);
            should_deinit = true;
        }
    }

    fn _fdFromAbsolutePathZ(
        this: *PathWatcherManager,
        path: [:0]const u8,
    ) bun.sys.Maybe(PathInfo) {
        return this._fdFromAbsolutePathZImpl(path, .allow_file);
    }

    /// Directory-only variant of `_fdFromAbsolutePathZ`. Returns `ENOTDIR`
    /// (without creating a `PathInfo` entry) when the target is a regular
    /// file — the caller never gets back an `is_file` `PathInfo` and therefore
    /// never has to release a fresh refs=1 entry via `_decrementPathRef`,
    /// which would acquire `manager.mutex` then `Watcher.mutex` (via
    /// `main_watcher.remove` on hash) and deadlock against the watcher
    /// thread's `Watcher.mutex → manager.mutex` ordering in `onFileUpdate`.
    ///
    /// Used by `NewSubdirTask` because a merged inotify event may OR-in
    /// `IN_ISDIR` from a sibling name in the same batch (e.g. `mkdir sub;
    /// touch file.txt`), causing the `file.txt` name to be queued as a
    /// "new subdirectory" candidate; this helper lets the task reject
    /// non-directories cleanly without ever taking ownership of an fd.
    fn _dirFdFromAbsolutePathZ(
        this: *PathWatcherManager,
        path: [:0]const u8,
    ) bun.sys.Maybe(PathInfo) {
        return this._fdFromAbsolutePathZImpl(path, .dir_only);
    }

    fn _fdFromAbsolutePathZImpl(
        this: *PathWatcherManager,
        path: [:0]const u8,
        comptime mode: enum { allow_file, dir_only },
    ) bun.sys.Maybe(PathInfo) {
        this.mutex.lock();
        defer this.mutex.unlock();

        if (this.file_paths.getEntry(path)) |entry| {
            var info = entry.value_ptr;
            if (mode == .dir_only and info.is_file) {
                return .{ .err = .{
                    .errno = @truncate(@intFromEnum(bun.sys.E.NOTDIR)),
                    .syscall = .open,
                } };
            }
            info.refs += 1;
            return .{ .result = info.* };
        }

        switch (switch (Environment.os) {
            else => bun.sys.open(path, bun.O.DIRECTORY | bun.O.RDONLY, 0),
            // windows bun.sys.open does not pass iterable=true,
            .windows => bun.sys.openDirAtWindowsA(bun.FD.cwd(), path, .{ .iterable = true, .read_only = true }),
        }) {
            .err => |e| {
                if (mode == .allow_file and e.errno == @intFromEnum(bun.sys.E.NOTDIR)) {
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

        // Subdirectories created or moved into a watched tree during this
        // batch. Registering a new inotify watch touches manager.mutex and
        // Watcher.mutex, both of which are held (transitively) right now —
        // onFileUpdate runs inside INotifyWatcher.watchLoopCycle with
        // Watcher.mutex held. Defer registration to a WorkPool task that
        // runs after both locks are released.
        var new_subdirs: NewSubdirTask.List = .{};
        defer if (new_subdirs.count > 0) NewSubdirTask.schedule(this, new_subdirs);

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

                    // kqueue NOTE_WRITE on a directory carries no filenames, so
                    // `affected` is always empty on FreeBSD (macOS bypasses this
                    // via FSEvents). Emit a single nameless 'rename' so the JS
                    // callback fires — matches libuv's FreeBSD behavior, where
                    // the caller is expected to re-scan.
                    if (comptime Environment.isFreeBSD) {
                        if (affected.len == 0 and (event.op.write or event.op.delete or event.op.rename)) {
                            const dir_hash = Watcher.getHash(file_path);
                            for (watchers) |w| {
                                const watcher = w orelse continue;
                                const entry_point = watcher.path.dirname;
                                if (watcher.path.is_file or file_path.len < entry_point.len or !bun.strings.startsWith(file_path, entry_point)) {
                                    continue;
                                }
                                watcher.emit((PathWatcher.EventType.rename).toEvent(""), dir_hash, timestamp, false);
                            }
                        }
                    }

                    // IN_ISDIR is set on the event mask when the event concerns
                    // a subdirectory. Pair with IN_CREATE/IN_MOVED_TO to detect
                    // a newly-created subdirectory that recursive watchers need
                    // to start watching.
                    const is_new_subdir = Environment.isLinux and event.op.is_dir and (event.op.create or event.op.move_to);

                    for (affected) |changed_name_| {
                        const changed_name: []const u8 = bun.asByteSlice(changed_name_.?);
                        if (changed_name.len == 0) continue;

                        // Pre-existing: suppress editor swap/backup files (`.foo.swp`,
                        // `~foo`) from user-visible events. We still have to *register*
                        // dotfile-named subdirectories for recursive watchers below
                        // though, otherwise `.next/`, `.nuxt/`, `.cache/` created at
                        // runtime would be blind spots (inconsistent with the initial
                        // scan in `DirectoryRegisterTask.processWatcher`, which has no
                        // such filter).
                        const skip_emit = changed_name[0] == '~' or changed_name[0] == '.';

                        // Fast path: the common noisy case (every `.foo.swp` write, every
                        // `~backup` save) never needs to compute `path_slice` or iterate
                        // watchers because neither the emit nor the subdir-register gate
                        // will fire. `is_new_subdir` is loop-invariant, so this branch
                        // only short-circuits events that would have produced no
                        // observable effect.
                        if (skip_emit and !is_new_subdir) continue;

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

                                // A new subdirectory appeared under a recursive watcher's tree.
                                // Queue a task that will open it and register a fresh inotify
                                // watch — without this, events for files created inside the new
                                // subdirectory would never fire (#29677). Ownership of the
                                // refPendingDirectory ref transfers into NewSubdirTask; `add` is
                                // infallible (aborts on OOM) so there is no rollback path that
                                // would re-enter `manager.mutex` via `unrefPendingDirectory →
                                // PathWatcher.deinit → unregisterWatcher`.
                                //
                                // Runs even when `skip_emit` is true so dot-prefixed build
                                // output dirs (`.next`, `.nuxt`, `.cache`) are registered —
                                // matches `processWatcher`'s unconditional initial-scan
                                // registration.
                                if (is_new_subdir and watcher.recursive and watcher.refPendingDirectory()) {
                                    new_subdirs.add(watcher, path_slice);
                                }

                                if (!skip_emit) {
                                    watcher.emit(event_type.toEvent(path), hash, timestamp, false);
                                }
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
            // unrefPendingDirectory() may cascade through PathWatcher.deinit()
            // → manager.unregisterWatcher() → manager.deinit() → destroy(manager).
            // Register this defer FIRST so it fires LAST (after the errdefer
            // below and after manager.mutex is released).
            var needs_unref_pending_directory = false;
            defer if (needs_unref_pending_directory) watcher.unrefPendingDirectory();

            // keep the path alive. errdefer registered after the defer above so
            // LIFO ordering fires _decrementPathRef BEFORE unrefPendingDirectory
            // — otherwise the latter could destroy(manager) and this would UAF.
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
                            needs_unref_pending_directory = true;
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
                        needs_unref_pending_directory = true;
                        return err;
                    };
                } else {
                    return error.UnexpectedFailure;
                }
                manager.current_fd_task.put(path.fd, routine) catch |err| {
                    needs_unref_pending_directory = true;
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
                    const append_result = watcher.file_paths.append(bun.default_allocator, child_path.path);
                    watcher.mutex.unlock();
                    // On error, drop the ref we took in _fdFromAbsolutePathZ. Must do
                    // this AFTER releasing watcher.mutex: _decrementPathRef acquires
                    // manager.mutex, and unregisterWatcher acquires manager.mutex before
                    // watcher.mutex — inverting here would AB/BA deadlock.
                    append_result catch |err| {
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

    /// WorkPool task that registers inotify watches for subdirectories that
    /// appeared inside a recursive `fs.watch()` tree after the watcher started.
    ///
    /// Created inside `onFileUpdate` (which runs holding Watcher.mutex and
    /// takes manager.mutex). Actual registration — `_fdFromAbsolutePathZ`,
    /// `main_watcher.addDirectory` — takes both of those mutexes, so it must
    /// run on a WorkPool thread after `onFileUpdate` returns and both locks
    /// are released.
    pub const NewSubdirTask = struct {
        manager: *PathWatcherManager,
        entries: List,
        task: jsc.WorkPoolTask = .{ .callback = callback },

        /// Small inline list that holds a handful of (watcher, absolute path)
        /// pairs. `onFileUpdate` can produce a burst of these when a directory
        /// tree is moved in, but typical batches have 0–1.
        pub const List = struct {
            /// Heap-allocated entries. Null when count == 0 to avoid
            /// allocating on the common empty path.
            items: ?[*]Entry = null,
            count: u32 = 0,
            capacity: u32 = 0,

            pub const Entry = struct {
                watcher: *PathWatcher,
                path: [:0]u8,
            };

            /// Append. Small allocations — follow the file's `bun.handleOom`
            /// convention (see `_fdFromAbsolutePathZImpl`) and abort on OOM
            /// rather than propagating a rollback path that would need to
            /// `unrefPendingDirectory()` inside `manager.mutex`, re-entering
            /// the mutex via `PathWatcher.deinit → unregisterWatcher` if the
            /// watcher was closed in the race window.
            pub fn add(this: *List, watcher: *PathWatcher, abs_path: []const u8) void {
                if (this.count == this.capacity) {
                    const new_cap: u32 = if (this.capacity == 0) 4 else this.capacity * 2;
                    if (this.items) |p| {
                        const old_slice = p[0..this.capacity];
                        const resized = bun.handleOom(bun.default_allocator.realloc(old_slice, new_cap));
                        this.items = resized.ptr;
                    } else {
                        const fresh = bun.handleOom(bun.default_allocator.alloc(Entry, new_cap));
                        this.items = fresh.ptr;
                    }
                    this.capacity = new_cap;
                }
                const dup = bun.handleOom(bun.default_allocator.dupeZ(u8, abs_path));
                this.items.?[this.count] = .{ .watcher = watcher, .path = dup };
                this.count += 1;
            }

            pub fn slice(this: *const List) []Entry {
                return if (this.items) |p| p[0..this.count] else &[_]Entry{};
            }

            pub fn deinit(this: *List) void {
                if (this.items) |p| {
                    bun.default_allocator.free(p[0..this.capacity]);
                    this.items = null;
                    this.count = 0;
                    this.capacity = 0;
                }
            }
        };

        pub fn schedule(manager: *PathWatcherManager, entries: List) void {
            // Keep the manager alive until the task runs. If refPendingTask
            // fails (manager is shutting down), skip registration but still
            // release the per-watcher refs we took in onFileUpdate.
            if (!manager.refPendingTask()) {
                for (entries.slice()) |entry| {
                    entry.watcher.unrefPendingDirectory();
                    bun.default_allocator.free(entry.path);
                }
                var mut_entries = entries;
                mut_entries.deinit();
                return;
            }
            const task = bun.handleOom(bun.default_allocator.create(NewSubdirTask));
            task.* = .{ .manager = manager, .entries = entries };
            jsc.WorkPool.schedule(&task.task);
        }

        fn callback(task: *jsc.WorkPoolTask) void {
            const self: *NewSubdirTask = @fieldParentPtr("task", task);
            defer {
                var entries = self.entries;
                entries.deinit();
                self.manager.unrefPendingTask();
                bun.default_allocator.destroy(self);
            }
            for (self.entries.slice()) |entry| {
                defer {
                    entry.watcher.unrefPendingDirectory();
                    bun.default_allocator.free(entry.path);
                }
                // Watcher may have been closed between queueing and now.
                if (entry.watcher.isClosed()) continue;

                // Resolve the absolute path to a directory PathInfo. Uses the
                // directory-only helper so a sibling-triggered false positive
                // (e.g. `mkdir sub; touch file.txt` merges into one event with
                // `is_dir` OR'd over both names) fails with NOTDIR instead of
                // opening the regular file and creating a refs=1 PathInfo
                // that would need a lock-inverting cleanup — see
                // `_dirFdFromAbsolutePathZ` for the full deadlock trace.
                //
                // Other benign cases that land here: the subdirectory was
                // deleted, moved, or symlinked to a non-directory between
                // IN_CREATE and the WorkPool pickup. All skip cleanly.
                const path_info = switch (self.manager._dirFdFromAbsolutePathZ(entry.path)) {
                    .result => |p| p,
                    .err => |err| {
                        log("[watch] _registerNewSubdirectory({s}) lookup: {f}", .{ entry.path, err });
                        continue;
                    },
                };

                // Track this subdirectory against the watcher so its path
                // reference is released when the watcher is unregistered.
                // handleOom on append — the rollback path would need to
                // clean up the refs=1 entry from `manager.file_paths` while
                // skipping `main_watcher.remove` (Watcher.mutex would
                // AB/BA-deadlock against the watcher thread's
                // Watcher→manager ordering). Aborting on OOM matches the
                // rest of the file's `bun.handleOom` convention.
                {
                    entry.watcher.mutex.lock();
                    defer entry.watcher.mutex.unlock();
                    bun.handleOom(entry.watcher.file_paths.append(bun.default_allocator, path_info.path));
                }

                switch (self.manager._addDirectory(entry.watcher, path_info)) {
                    .err => |err| {
                        log("[watch] _registerNewSubdirectory({s}) addDirectory: {f}", .{ entry.path, err });
                        // Leave the ref + file_paths entry in place; the watcher's
                        // deinit path walks file_paths and decrements refs correctly.
                    },
                    .result => {},
                }
            }
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

    // unregister is always called from main thread
    fn unregisterWatcher(this: *PathWatcherManager, watcher: *PathWatcher) void {
        // Must defer deinit() to AFTER releasing this.mutex, for two reasons:
        // 1. deinit() re-acquires this.mutex when hasPendingTasks() is true.
        //    The mutex is non-recursive, so calling deinit() while holding
        //    the lock self-deadlocks (observed as __ulock_wait2 hang on macOS).
        // 2. deinit() may destroy(this). Unlocking a freed mutex is UAF.
        // Zig defers fire LIFO, so registering this defer before the lock/unlock
        // pair makes it fire last (after unlock).
        var should_deinit = false;
        defer if (should_deinit) this.deinit();

        this.mutex.lock();
        defer this.mutex.unlock();

        var watchers = this.watchers.slice();

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

        should_deinit = this.deinit_on_last_watcher and this.watcher_count == 0;
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
                        bun.default_allocator.free(resolved_path);
                        bun.default_allocator.destroy(this);
                        return err;
                    },
                    .manager = manager,
                    .recursive = recursive,
                    .flushCallback = updateEndCallback,
                    .file_paths = .{},
                    .ctx = ctx,
                    .mutex = .{},
                    .resolved_path = resolved_path,
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
        // deinit() calls setClosed() which re-locks this.mutex, and may then
        // proceed to destroy(this). Defer it until after unlock so we don't
        // self-deadlock or unlock() a freed mutex. Zig defers fire LIFO, so
        // registering this defer before the lock/unlock pair makes it fire last.
        var should_deinit = false;
        defer if (should_deinit) this.deinit();

        this.mutex.lock();
        defer this.mutex.unlock();
        this.pending_directories -= 1;
        if (this.isClosed() and this.pending_directories == 0) {
            this.has_pending_directories.store(false, .release);
            should_deinit = true;
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
