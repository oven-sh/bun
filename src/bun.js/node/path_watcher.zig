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
        return this.refPendingTaskNoLock();
    }

    fn refPendingTaskNoLock(this: *PathWatcherManager) bool {
        if (this.deinit_on_last_task) return false;
        this.pending_tasks += 1;
        this.has_pending_tasks.store(true, .release);
        return true;
    }

    fn hasPendingTasks(this: *PathWatcherManager) callconv(.c) bool {
        return this.has_pending_tasks.load(.acquire);
    }

    fn unrefPendingTask(this: *PathWatcherManager) void {
        const should_deinit = blk: {
            this.mutex.lock();
            defer this.mutex.unlock();
            this.pending_tasks -= 1;
            if (this.pending_tasks == 0) {
                this.has_pending_tasks.store(false, .release);
                break :blk this.deinit_on_last_task;
            }
            break :blk false;
        };
        if (should_deinit) {
            this.deinit();
        }
    }

    fn _fdFromAbsolutePathZ(
        this: *PathWatcherManager,
        path: [:0]const u8,
    ) bun.sys.Maybe(PathInfo) {
        return this._fdFromAbsolutePathZImpl(path, .allow_file);
    }

    // Open path as a directory only. If it's a file (or was replaced by one
    // since readdir), return NOTDIR instead of falling back to a file open.
    // Used by recursive subdirectory discovery where we never want file fds.
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
                    .errno = @intFromEnum(bun.sys.E.NOTDIR),
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
        if (comptime Environment.isLinux) {
            this.main_watcher.platform.extra_mask = std.os.linux.IN.ATTRIB | std.os.linux.IN.MOVED_FROM;
        }
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

        // Subdirectories created during this batch that recursive watchers need
        // to register. Collected under manager.mutex, then handed to a WorkPool
        // task because _fdFromAbsolutePathZ/_addDirectory take manager.mutex
        // AND main_watcher.addDirectory takes Watcher.mutex — both of which are
        // held by the caller (watchLoopCycle) at this point. The pending-task
        // ref is taken inside the manager.mutex scoped block to avoid an AB/BA
        // deadlock with unregisterWatcher (which takes manager.mutex then
        // Watcher.mutex via main_watcher.remove).
        var new_subdirs: bun.BabyList(NewSubdirBatch.Entry) = .{};
        var task_referenced = false;
        defer if (task_referenced) {
            NewSubdirBatch.scheduleAlreadyReferenced(this, new_subdirs);
        } else {
            // Can't call unrefPendingDirectory synchronously here because
            // onFileUpdate runs inside watchLoopCycle which holds Watcher.mutex.
            // If unref triggers deinit → unregisterWatcher → _decrementPathRef
            // → main_watcher.remove → Watcher.mutex.lock, we'd self-deadlock.
            // Schedule cleanup on a WorkPool thread instead.
            if (new_subdirs.len > 0) {
                NewSubdirBatch.scheduleCleanupOnly(this, new_subdirs);
            } else {
                new_subdirs.deinit(bun.default_allocator);
            }
        };

        {
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

                        if (event.op.write or event.op.delete or event.op.rename or event.op.metadata) {
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
                            if (changed_name.len == 0) continue;

                            const file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);

                            @memcpy(_on_file_update_path_buf[0..file_path_without_trailing_slash.len], file_path_without_trailing_slash);

                            _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                            @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len + 1 ..][0..changed_name.len], changed_name);
                            const len = file_path_without_trailing_slash.len + changed_name.len;
                            const path_slice = _on_file_update_path_buf[0 .. len + 1];

                            const hash = Watcher.getHash(path_slice);

                            // If it's a create, delete, rename, or move event, emit "rename".
                            // If it's a write (modify) or metadata (attrib) event, emit "change".
                            const event_type: PathWatcher.EventType = if (event.op.create or event.op.delete or event.op.rename or event.op.move_to) .rename else .change;

                            // A subdirectory was created or moved in — recursive
                            // watchers need an inotify watch on it to see changes
                            // inside. Queue registration for after we release the
                            // lock. We may over-queue if files and subdirs arrive
                            // in the same merged event (is_dir is OR'd), but the
                            // registration path handles non-directories gracefully.
                            const maybe_new_subdir = Environment.isLinux and event.op.is_dir and (event.op.create or event.op.move_to);

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

                                    if (maybe_new_subdir and watcher.recursive and watcher.refPendingDirectory()) {
                                        _on_file_update_path_buf[len + 1] = 0;
                                        const abs_path_z = _on_file_update_path_buf[0 .. len + 1 :0];
                                        const dup = bun.handleOom(bun.default_allocator.dupeZ(u8, abs_path_z));
                                        bun.handleOom(new_subdirs.append(bun.default_allocator, .{ .watcher = watcher, .path = dup }));
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

            if (new_subdirs.len > 0) {
                task_referenced = this.refPendingTaskNoLock();
            }
        }
    }

    // When a recursive watcher observes IN_CREATE|IN_ISDIR or
    // IN_MOVED_TO|IN_ISDIR, the new subdirectory needs an inotify watch so
    // changes inside it are reported. Registration must happen on a WorkPool
    // thread because onFileUpdate is called with Watcher.mutex held (from
    // INotifyWatcher.watchLoopCycle) and _addDirectory → addDirectory re-locks it.
    const NewSubdirBatch = struct {
        manager: *PathWatcherManager,
        entries: bun.BabyList(Entry),
        task: jsc.WorkPoolTask = .{ .callback = callback },

        const Entry = struct { watcher: *PathWatcher, path: [:0]u8 };

        fn scheduleAlreadyReferenced(manager: *PathWatcherManager, entries: bun.BabyList(Entry)) void {
            const batch = bun.handleOom(bun.default_allocator.create(NewSubdirBatch));
            batch.* = .{ .manager = manager, .entries = entries };
            jsc.WorkPool.schedule(&batch.task);
        }

        /// Schedule a WorkPool task that only unrefs pending directories and
        /// frees paths — no registration. Used when refPendingTask fails
        /// (manager shutting down) but we still hold refPendingDirectory refs
        /// that can't be released synchronously (Watcher.mutex is held).
        fn scheduleCleanupOnly(manager: *PathWatcherManager, entries: bun.BabyList(Entry)) void {
            const batch = bun.handleOom(bun.default_allocator.create(NewSubdirBatch));
            batch.* = .{ .manager = manager, .entries = entries };
            batch.task = .{ .callback = cleanupCallback };
            jsc.WorkPool.schedule(&batch.task);
        }

        fn callback(task: *jsc.WorkPoolTask) void {
            const batch: *NewSubdirBatch = @fieldParentPtr("task", task);
            defer {
                for (batch.entries.slice()) |item| bun.default_allocator.free(item.path);
                batch.entries.deinit(bun.default_allocator);
                batch.manager.unrefPendingTask();
                bun.default_allocator.destroy(batch);
            }
            for (batch.entries.slice()) |item| {
                batch.manager._registerNewSubdirectory(item.watcher, item.path);
                item.watcher.unrefPendingDirectory();
            }
        }

        fn cleanupCallback(task: *jsc.WorkPoolTask) void {
            const batch: *NewSubdirBatch = @fieldParentPtr("task", task);
            defer {
                for (batch.entries.slice()) |item| bun.default_allocator.free(item.path);
                batch.entries.deinit(bun.default_allocator);
                bun.default_allocator.destroy(batch);
            }
            for (batch.entries.slice()) |item| {
                item.watcher.unrefPendingDirectory();
            }
        }
    };

    fn _registerNewSubdirectory(this: *PathWatcherManager, watcher: *PathWatcher, path_z: [:0]const u8) void {
        if (watcher.isClosed()) return;

        const child_path = switch (this._dirFdFromAbsolutePathZ(path_z)) {
            .result => |r| r,
            .err => return, // race: moved/deleted/replaced, or not a directory
        };

        {
            watcher.mutex.lock();
            defer watcher.mutex.unlock();
            watcher.file_paths.append(bun.default_allocator, child_path.path) catch {
                // Don't call _decrementPathRefAndClose here — watcher.mutex
                // is held and _decrementPathRef would lock manager.mutex
                // (AB/BA with unregisterWatcher on OOM). Let
                // unregisterWatcher handle cleanup.
                return;
            };
        }

        switch (this._addDirectory(watcher, child_path)) {
            .err => |err| {
                log("[watch] failed to register new subdirectory {s}: {f}", .{ path_z, err });
                // Don't clean up here — the path is in both manager.file_paths
                // (with refs=1) and watcher.file_paths. Calling
                // _decrementPathRefAndClose would free the path string while
                // watcher.file_paths still holds the pointer (use-after-free).
                // unregisterWatcher will drain watcher.file_paths and call
                // _decrementPathRefNoLock for each, which handles both the
                // main_watcher.remove and fd close correctly.
            },
            .result => {},
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
            var routine: *DirectoryRegisterTask = undefined;
            var pending_removal: ?PendingRemoval = null;
            defer if (pending_removal) |r| PendingRemoval.flush(&.{r}, manager.main_watcher);
            {
                manager.mutex.lock();
                defer manager.mutex.unlock();

                // use the same thread for the same fd to avoid race conditions
                if (manager.current_fd_task.getEntry(path.fd)) |entry| {
                    routine = entry.value_ptr.*;

                    // Dedup: don't add the same watcher twice for the same
                    // directory (can happen when processWatcher and
                    // _registerNewSubdirectory race on the same subdirectory).
                    for (routine.watcher_list.slice()) |w| {
                        if (w == watcher) return;
                    }

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

                // Only increment path ref for new tasks — the reuse path
                // above doesn't need an extra ref since the existing task
                // already holds one via its initial schedule() call.
                // Inline the increment since we already hold manager.mutex.
                if (manager.file_paths.getEntry(path.path)) |entry| {
                    if (entry.value_ptr.refs > 0) entry.value_ptr.refs += 1;
                }

                routine = bun.default_allocator.create(DirectoryRegisterTask) catch |err| {
                    pending_removal = manager._decrementPathRefNoLock(path.path);
                    return err;
                };
                routine.* = DirectoryRegisterTask{
                    .manager = manager,
                    .path = path,
                    .watcher_list = bun.BabyList(*PathWatcher).initCapacity(bun.default_allocator, 1) catch |err| {
                        pending_removal = manager._decrementPathRefNoLock(path.path);
                        bun.default_allocator.destroy(routine);
                        return err;
                    },
                };
                errdefer {
                    routine.deinit();
                    pending_removal = manager._decrementPathRefNoLock(path.path);
                }
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
            var removal: ?PendingRemoval = null;
            const watcher = blk: {
                this.manager.mutex.lock();
                defer this.manager.mutex.unlock();

                const w = this.watcher_list.pop();
                if (w == null) {
                    _ = this.manager.current_fd_task.remove(this.path.fd);
                    removal = this.manager._decrementPathRefNoLock(this.path.path);
                    break :blk @as(?*PathWatcher, null);
                }
                break :blk w;
            };
            if (removal) |r| PendingRemoval.flush(&.{r}, this.manager.main_watcher);
            return watcher;
        }

        fn processWatcher(
            this: *DirectoryRegisterTask,
            watcher: *PathWatcher,
            buf: *bun.PathBuffer,
        ) bun.sys.Maybe(void) {
            if (Environment.isWindows) @compileError("use win_watcher.zig");

            // For recursive watches, enumerate all children. Emit a synthetic
            // 'rename' for each (matching Node.js's recursive_watch.js, which
            // emits on discovery). This also covers the race where a file is
            // created in a new subdirectory before the inotify watch is added —
            // the inotify IN_CREATE is missed but the scan finds the file.
            // For subdirectories, also register an inotify watch and recurse.
            // Non-recursive watches never reach this function — _addDirectory
            // short-circuits before scheduling the task.
            bun.debugAssert(watcher.recursive);

            const manager = this.manager;
            const path = this.path;
            const fd = path.fd;
            var iter = fd.stdDir().iterate();
            const timestamp = std.time.milliTimestamp();
            const entry_point = watcher.path.dirname;

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
                if (watcher.isClosed()) break;

                var parts = [2]string{ path.path, entry.name };
                const entry_path = Path.joinAbsStringBuf(
                    Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(),
                    buf,
                    &parts,
                    .auto,
                );
                const hash = Watcher.getHash(entry_path);

                // Emit 'rename' for this entry, relative to the watch root.
                // Skip if the entry is outside the root (shouldn't happen in
                // practice, but the same guard exists in onFileUpdate).
                if (entry_path.len > entry_point.len and bun.strings.startsWith(entry_path, entry_point)) {
                    var rel: []const u8 = entry_path[entry_point.len..];
                    if (bun.strings.startsWithChar(rel, '/')) rel = rel[1..];
                    if (rel.len > 0) {
                        watcher.emit(PathWatcher.EventType.rename.toEvent(rel), hash, timestamp, entry.kind != .directory);
                    }
                }

                // Only recurse into subdirectories. Node.js's recursive_watch.js
                // recurses only if file.isDirectory() && !file.isSymbolicLink().
                if (entry.kind != .directory) continue;
                buf[entry_path.len] = 0;
                const entry_path_z = buf[0..entry_path.len :0];

                const child_path = switch (manager._dirFdFromAbsolutePathZ(entry_path_z)) {
                    .result => |result| result,
                    .err => |e| switch (e.getErrno()) {
                        // Skip subdirectories we can't open: permission
                        // denied, raced with deletion or replacement by a
                        // non-directory, or circular symlink.
                        .ACCES, .PERM, .NOENT, .NOTDIR, .LOOP => continue,
                        else => return .{ .err = e },
                    },
                };

                {
                    watcher.mutex.lock();
                    defer watcher.mutex.unlock();
                    watcher.file_paths.append(bun.default_allocator, child_path.path) catch |err| {
                        manager._decrementPathRefAndClose(entry_path_z);
                        return switch (err) {
                            error.OutOfMemory => .{ .err = .{
                                .errno = @truncate(@intFromEnum(bun.sys.E.NOMEM)),
                                .syscall = .watch,
                            } },
                        };
                    };
                }

                // Add inotify watch on the subdirectory and schedule a task
                // to scan its children. On failure, the fd stays in file_paths
                // and watcher.file_paths — cleanup happens in unregisterWatcher.
                switch (manager._addDirectory(watcher, child_path)) {
                    .err => |err| return .{ .err = err.withPath(child_path.path) },
                    .result => {},
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
                    },
                    .result => {},
                }
                if (watcher.needs_flush) watcher.flush();
            }

            this.manager.unrefPendingTask();
        }

        fn deinit(this: *DirectoryRegisterTask) void {
            this.watcher_list.deinit(bun.default_allocator);
            bun.default_allocator.destroy(this);
        }
    };

    // this should only be called if thread pool is not null
    fn _addDirectory(this: *PathWatcherManager, watcher: *PathWatcher, path: PathInfo) bun.sys.Maybe(void) {
        const fd = path.fd;
        // clone_file_path=true so the watchlist owns its own copy of the
        // path string. This decouples watchlist lifetime from file_paths
        // hashmap lifetime — _decrementPathRefNoLock can free the hashmap
        // string without leaving a dangling .file_path in the watchlist
        // that inotify events would dereference before flushEvictions runs.
        switch (this.main_watcher.addDirectory(fd, path.path, path.hash, true)) {
            .err => |err| return .{ .err = err.withPath(path.path) },
            .result => {},
        }

        // Non-recursive watches need only the directory inotify watch — no
        // child enumeration. This matches libuv's uv_fs_event_start(), which
        // calls inotify_add_watch once and never iterates directory contents.
        if (!watcher.recursive) return .success;

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

    const PendingRemoval = struct {
        hash: Watcher.HashType,
        fd: bun.FileDescriptor,
        path: [:0]const u8,

        // Called WITHOUT manager.mutex held. main_watcher.remove takes
        // Watcher.mutex — calling it under manager.mutex would AB/BA with
        // the watcher thread (watchLoopCycle holds Watcher.mutex, then
        // onFileUpdate takes manager.mutex).
        fn flush(removals: []const PendingRemoval, main_watcher: *Watcher) void {
            for (removals) |r| {
                // Watchlist holds its own clone (clone_file_path=true), so
                // freeing r.path is safe regardless of evict outcome.
                // flushEvictions closes the fd + frees the clone; if the
                // entry was never in the watchlist, close here.
                const evicted = main_watcher.remove(r.hash);
                if (!evicted) r.fd.close();
                bun.default_allocator.free(r.path);
            }
        }
    };

    // Decrements refcount under manager.mutex. If refs reach zero, removes
    // the hashmap entry and returns the hash/fd/path for the caller to
    // flush OUTSIDE manager.mutex (via PendingRemoval.flush).
    fn _decrementPathRefNoLock(this: *PathWatcherManager, file_path: [:0]const u8) ?PendingRemoval {
        if (this.file_paths.getEntry(file_path)) |entry| {
            var path = entry.value_ptr;
            if (path.refs > 0) {
                path.refs -= 1;
                if (path.refs == 0) {
                    const path_ = path.path;
                    const fd = path.fd;
                    const hash = path.hash;
                    _ = this.file_paths.remove(path_);
                    return .{ .hash = hash, .fd = fd, .path = path_ };
                }
            }
        }
        return null;
    }

    fn _decrementPathRef(this: *PathWatcherManager, file_path: [:0]const u8) void {
        const removal = blk: {
            this.mutex.lock();
            defer this.mutex.unlock();
            break :blk this._decrementPathRefNoLock(file_path);
        };
        if (removal) |r| {
            PendingRemoval.flush(&.{r}, this.main_watcher);
        }
    }

    const _decrementPathRefAndClose = _decrementPathRef;

    // unregister is always called from main thread.
    // Phase 1 (under manager.mutex): remove watcher from the list, collect
    //   pending removals from refcount decrements.
    // Phase 2 (outside manager.mutex): call main_watcher.remove + close fd
    //   + free path for each removal. main_watcher.remove takes Watcher.mutex
    //   which the watcher thread holds during onFileUpdate → manager.mutex,
    //   so holding manager.mutex here would AB/BA deadlock.
    fn unregisterWatcher(this: *PathWatcherManager, watcher: *PathWatcher) void {
        var removals: bun.BabyList(PendingRemoval) = .{};
        defer removals.deinit(bun.default_allocator);

        const should_deinit = blk: {
            this.mutex.lock();
            defer this.mutex.unlock();

            var watchers = this.watchers.slice();

            for (watchers, 0..) |w, i| {
                if (w) |item| {
                    if (item == watcher) {
                        watchers[i] = null;
                        if (i == watchers.len - 1) {
                            this.watchers.len -= 1;
                        }
                        this.watcher_count -= 1;

                        if (this._decrementPathRefNoLock(watcher.path.path)) |r| {
                            bun.handleOom(removals.append(bun.default_allocator, r));
                        }

                        if (comptime Environment.isMac) {
                            if (watcher.fsevents_watcher != null) {
                                break;
                            }
                        }

                        {
                            watcher.mutex.lock();
                            defer watcher.mutex.unlock();
                            while (watcher.file_paths.pop()) |file_path| {
                                if (this._decrementPathRefNoLock(file_path)) |r| {
                                    bun.handleOom(removals.append(bun.default_allocator, r));
                                }
                            }
                        }
                        break;
                    }
                }
            }

            break :blk this.deinit_on_last_watcher and this.watcher_count == 0;
        };

        PendingRemoval.flush(removals.slice(), this.main_watcher);

        if (should_deinit) {
            this.deinit();
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
        const should_deinit = blk: {
            this.mutex.lock();
            defer this.mutex.unlock();
            this.pending_directories -= 1;
            if (this.pending_directories == 0) {
                this.has_pending_directories.store(false, .release);
                break :blk this.isClosed();
            }
            break :blk false;
        };
        if (should_deinit) {
            this.deinit();
        }
    }

    pub fn emit(this: *PathWatcher, event: Event, hash: Watcher.HashType, time_stamp: i64, is_file: bool) void {
        // Serialize access — emit can be called from both the watcher thread
        // (onFileUpdate) and WorkPool threads (processWatcher, error paths).
        this.mutex.lock();
        defer this.mutex.unlock();

        switch (event) {
            .change, .rename => {
                const event_type = switch (event) {
                    inline .change, .rename => |_, t| @field(EventType, @tagName(t)),
                    else => unreachable, // above switch guarentees this subset
                };

                const time_diff = time_stamp - this.last_change_event.time_stamp;
                // Skip consecutive duplicates: same event type AND same
                // file (hash) within 1ms. Both conditions must match to
                // suppress — different files with the same timestamp
                // (e.g. synthetic events from directory scan) must not
                // be dropped.
                if (!((this.last_change_event.time_stamp == 0 or time_diff > 1) or
                    this.last_change_event.event_type != event_type or
                    this.last_change_event.hash != hash))
                {
                    // skip consecutive duplicates
                    return;
                }

                this.last_change_event.time_stamp = time_stamp;
                this.last_change_event.event_type = event_type;
                this.last_change_event.hash = hash;
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
        this.mutex.lock();
        defer this.mutex.unlock();
        this.needs_flush = false;
        if (this.isClosed()) return;
        this.flushCallback(this.ctx);
    }

    pub fn detach(this: *PathWatcher, _: *anyopaque) void {
        this.deinit();
    }

    pub fn deinit(this: *PathWatcher) void {
        // Atomically set closed and check pending_directories under a single
        // mutex scope to prevent TOCTOU race with unrefPendingDirectory —
        // without this, both threads could decide to run the cleanup path.
        const has_pending = blk: {
            this.mutex.lock();
            defer this.mutex.unlock();
            this.closed.store(true, .release);
            break :blk this.pending_directories > 0;
        };
        if (has_pending) {
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
