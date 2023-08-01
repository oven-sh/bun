const std = @import("std");

const UnboundedQueue = @import("../unbounded_queue.zig").UnboundedQueue;
const Path = @import("../../resolver/resolve_path.zig");
const Fs = @import("../../fs.zig");
const Mutex = @import("../../lock.zig").Lock;
const FSEvents = @import("./fs_events.zig");

const bun = @import("root").bun;
const Output = bun.Output;
const Environment = bun.Environment;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const string = bun.string;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;

const sync = @import("../../sync.zig");
const Semaphore = sync.Semaphore;

var default_manager_mutex: Mutex = Mutex.init();
var default_manager: ?*PathWatcherManager = null;

pub const PathWatcherManager = struct {
    const GenericWatcher = @import("../../watcher.zig");
    const options = @import("../../options.zig");
    pub const Watcher = GenericWatcher.NewWatcher(*PathWatcherManager);
    const log = Output.scoped(.PathWatcherManager, false);
    main_watcher: ?*Watcher,

    watchers: bun.BabyList(?*PathWatcher) = .{},
    watcher_count: u32 = 0,
    vm: *JSC.VirtualMachine,
    file_paths: bun.StringHashMap(PathInfo),
    current_fd_task: bun.FDHashMap(*DirectoryRegisterTask),
    deinit_on_last_watcher: bool = false,
    pending_tasks: u32 = 0,
    deinit_on_last_task: bool = false,
    mutex: Mutex,
    const PathInfo = struct {
        fd: StoredFileDescriptorType = 0,
        is_file: bool = true,
        path: [:0]const u8,
        dirname: string,
        refs: u32 = 0,
        hash: Watcher.HashType,
    };

    // TODO: switch to using JSC.Maybe to avoid using "unreachable" and improve error messages
    fn _fdFromAbsolutePathZ(
        this: *PathWatcherManager,
        path: [:0]const u8,
    ) !PathInfo {
        this.mutex.lock();
        defer this.mutex.unlock();

        if (this.file_paths.getEntry(path)) |entry| {
            var info = entry.value_ptr;
            info.refs += 1;
            return info.*;
        }
        const cloned_path = try bun.default_allocator.dupeZ(u8, path);
        errdefer bun.default_allocator.destroy(cloned_path);

        if (std.fs.openIterableDirAbsoluteZ(cloned_path, .{
            .access_sub_paths = true,
        })) |iterable_dir| {
            const result = PathInfo{
                .fd = iterable_dir.dir.fd,
                .is_file = false,
                .path = cloned_path,
                .dirname = cloned_path,
                .hash = Watcher.getHash(cloned_path),
                .refs = 1,
            };
            _ = try this.file_paths.put(cloned_path, result);
            return result;
        } else |err| {
            if (err == error.NotDir) {
                var file = try std.fs.openFileAbsoluteZ(cloned_path, .{ .mode = .read_only });
                const result = PathInfo{
                    .fd = file.handle,
                    .is_file = true,
                    .path = cloned_path,
                    // if is really a file we need to get the dirname
                    .dirname = std.fs.path.dirname(cloned_path) orelse cloned_path,
                    .hash = Watcher.getHash(cloned_path),
                    .refs = 1,
                };
                _ = try this.file_paths.put(cloned_path, result);
                return result;
            } else {
                return err;
            }
        }

        unreachable;
    }

    pub fn init(vm: *JSC.VirtualMachine) !*PathWatcherManager {
        const this = try bun.default_allocator.create(PathWatcherManager);
        errdefer bun.default_allocator.destroy(this);
        var watchers = bun.BabyList(?*PathWatcher).initCapacity(bun.default_allocator, 1) catch |err| {
            bun.default_allocator.destroy(this);
            return err;
        };
        errdefer watchers.deinitWithAllocator(bun.default_allocator);
        const main_watcher = try Watcher.init(
            this,
            vm.bundler.fs,
            bun.default_allocator,
        );
        var manager = PathWatcherManager{
            .file_paths = bun.StringHashMap(PathInfo).init(bun.default_allocator),
            .current_fd_task = bun.FDHashMap(*DirectoryRegisterTask).init(bun.default_allocator),
            .watchers = watchers,
            .main_watcher = main_watcher,
            .vm = vm,
            .watcher_count = 0,
            .mutex = Mutex.init(),
        };

        this.* = manager;
        try main_watcher.start();
        return this;
    }

    pub fn onFileUpdate(
        this: *PathWatcherManager,
        events: []GenericWatcher.WatchEvent,
        changed_files: []?[:0]u8,
        watchlist: GenericWatcher.Watchlist,
    ) void {
        var slice = watchlist.slice();
        const file_paths = slice.items(.file_path);

        var counts = slice.items(.count);
        const kinds = slice.items(.kind);
        var _on_file_update_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        var ctx = this.main_watcher.?;
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
                log("[watch] {s} ({s}, {})", .{ file_path, @tagName(kind), event.op });
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
                                    if (path.len == 0) {
                                        while (path.len > 0) {
                                            if (bun.strings.startsWithChar(path, '/')) {
                                                path = path[1..];
                                                break;
                                            } else {
                                                path = path[1..];
                                            }
                                        }
                                    } else {
                                        // Skip forward slash
                                        path = path[1..];
                                    }
                                }

                                // Do not emit events from subdirectories (without option set)
                                if (path.len == 0 or (bun.strings.containsChar(path, '/') and !watcher.recursive)) {
                                    continue;
                                }
                                watcher.emit(path, hash, timestamp, true, event_type);
                            }
                        }
                    }
                },
                .directory => {
                    const affected = event.names(changed_files);

                    for (affected) |changed_name_| {
                        const changed_name: []const u8 = bun.asByteSlice(changed_name_.?);
                        if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                        var file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);

                        @memcpy(_on_file_update_path_buf[0..file_path_without_trailing_slash.len], file_path_without_trailing_slash);

                        _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                        @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len + 1 ..][0..changed_name.len], changed_name);
                        const len = file_path_without_trailing_slash.len + changed_name.len;
                        const path_slice = _on_file_update_path_buf[0 .. len + 1];

                        const hash = Watcher.getHash(path_slice);

                        // skip consecutive duplicates
                        const event_type: PathWatcher.EventType = .rename; // renaming folders, creating folder or files will be always be rename
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

                                    if (path.len == 0) {
                                        while (path.len > 0) {
                                            if (bun.strings.startsWithChar(path, '/')) {
                                                path = path[1..];
                                                break;
                                            } else {
                                                path = path[1..];
                                            }
                                        }
                                    } else {
                                        // Skip forward slash
                                        path = path[1..];
                                    }
                                }

                                // Do not emit events from subdirectories (without option set)
                                if (path.len == 0 or (bun.strings.containsChar(path, '/') and !watcher.recursive)) {
                                    continue;
                                }

                                watcher.emit(path, hash, timestamp, false, event_type);
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
        err: anyerror,
    ) void {
        this.mutex.lock();
        const watchers = this.watchers.slice();
        const timestamp = std.time.milliTimestamp();

        // stop all watchers
        for (watchers) |w| {
            if (w) |watcher| {
                log("[watch] error: {s}", .{@errorName(err)});
                watcher.emit(@errorName(err), 0, timestamp, false, .@"error");
                watcher.flush();
            }
        }

        // we need a new manager at this point
        default_manager_mutex.lock();
        defer default_manager_mutex.unlock();
        default_manager = null;
        this.mutex.unlock();
        // watcher will be in a invalid state
        this.main_watcher = null;
        // deinit when no more watchers are registered
        this.deinit();
    }

    pub const DirectoryRegisterTask = struct {
        manager: *PathWatcherManager,
        path: PathInfo,
        task: JSC.WorkPoolTask = .{ .callback = callback },
        watcher_list: bun.BabyList(*PathWatcher) = .{},

        pub fn callback(task: *JSC.WorkPoolTask) void {
            var routine = @fieldParentPtr(@This(), "task", task);
            defer routine.deinit();
            routine.run();
        }

        fn schedule(manager: *PathWatcherManager, watcher: *PathWatcher, path: PathInfo) !void {
            manager.mutex.lock();
            defer manager.mutex.unlock();
            // keep the path alive
            manager._incrementPathRefNoLock(path.path);
            errdefer manager._decrementPathRef(path.path);

            // use the same thread for the same fd to avoid race conditions
            if (manager.current_fd_task.getEntry(path.fd)) |entry| {
                var routine = entry.value_ptr.*;
                watcher.mutex.lock();
                defer watcher.mutex.unlock();
                watcher.pending_directories += 1;
                routine.watcher_list.push(bun.default_allocator, watcher) catch |err| {
                    watcher.pending_directories -= 1;
                    return err;
                };
                return;
            }
            var routine = try bun.default_allocator.create(DirectoryRegisterTask);
            routine.* = DirectoryRegisterTask{
                .manager = manager,
                .path = path,
                .watcher_list = bun.BabyList(*PathWatcher).initCapacity(bun.default_allocator, 1) catch |err| {
                    bun.default_allocator.destroy(routine);
                    return err;
                },
            };
            errdefer routine.deinit();
            try routine.watcher_list.push(bun.default_allocator, watcher);
            watcher.mutex.lock();
            defer watcher.mutex.unlock();
            watcher.pending_directories += 1;

            manager.current_fd_task.put(path.fd, routine) catch |err| {
                watcher.pending_directories -= 1;
                return err;
            };
            manager.pending_tasks += 1;
            JSC.WorkPool.schedule(&routine.task);
            return;
        }

        fn getNext(this: *DirectoryRegisterTask) ?*PathWatcher {
            this.manager.mutex.lock();
            defer this.manager.mutex.unlock();

            const watcher = this.watcher_list.popOrNull();
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
            buf: *[bun.MAX_PATH_BYTES + 1]u8,
        ) !void {
            const manager = this.manager;
            const path = this.path;
            const fd = path.fd;
            var iter = (std.fs.IterableDir{ .dir = std.fs.Dir{
                .fd = fd,
            } }).iterate();
            defer {
                watcher.mutex.lock();
                watcher.pending_directories -= 1;

                if (watcher.pending_directories == 0 and watcher.finalized) {
                    watcher.mutex.unlock();
                    watcher.deinit();
                } else {
                    watcher.mutex.unlock();
                }
            }

            // now we iterate over all files and directories
            while (try iter.next()) |entry| {
                var parts = [2]string{ path.path, entry.name };
                var entry_path = Path.joinAbsStringBuf(
                    Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(),
                    buf,
                    &parts,
                    .auto,
                );

                buf[entry_path.len] = 0;
                var entry_path_z = buf[0..entry_path.len :0];

                var child_path = try manager._fdFromAbsolutePathZ(entry_path_z);
                watcher.mutex.lock();
                watcher.file_paths.push(bun.default_allocator, child_path.path) catch |err| {
                    watcher.mutex.unlock();
                    manager._decrementPathRef(entry_path_z);
                    return err;
                };
                watcher.mutex.unlock();

                // we need to call this unlocked
                if (child_path.is_file) {
                    if (manager.main_watcher) |main_watcher| {
                        try main_watcher.addFile(child_path.fd, child_path.path, child_path.hash, options.Loader.file, 0, null, false);
                    } else {
                        // watcher died just stop
                        break;
                    }
                } else {
                    if (watcher.recursive and !watcher.finalized) {
                        // this may trigger another thread with is desired when available to watch long trees
                        try manager._addDirectory(watcher, child_path);
                    }
                }
            }
        }

        fn run(this: *DirectoryRegisterTask) void {
            var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;

            while (this.getNext()) |watcher| {
                this.processWatcher(watcher, &buf) catch |err| {
                    log("[watch] error registering directory: {s}", .{@errorName(err)});
                    watcher.emit(@errorName(err), 0, std.time.milliTimestamp(), false, .@"error");
                    watcher.flush();
                };
            }

            this.manager.mutex.lock();
            this.manager.pending_tasks -= 1;
            if (this.manager.deinit_on_last_task and this.manager.pending_tasks == 0) {
                this.manager.mutex.unlock();
                this.manager.deinit();
            } else {
                this.manager.mutex.unlock();
            }
        }

        fn deinit(this: *DirectoryRegisterTask) void {
            bun.default_allocator.destroy(this);
        }
    };

    // this should only be called if thread pool is not null
    fn _addDirectory(this: *PathWatcherManager, watcher: *PathWatcher, path: PathInfo) !void {
        const fd = path.fd;
        if (this.main_watcher) |main_watcher| {
            try main_watcher.addDirectory(fd, path.path, path.hash, false);

            return try DirectoryRegisterTask.schedule(this, watcher, path);
        }
        watcher.emit("Unable to watch directory", 0, std.time.milliTimestamp(), false, .@"error");
        watcher.flush();
    }

    fn registerWatcher(this: *PathWatcherManager, watcher: *PathWatcher) !void {
        this.mutex.lock();

        if (this.watcher_count == this.watchers.len) {
            this.watcher_count += 1;
            this.watchers.push(bun.default_allocator, watcher) catch |err| {
                this.watcher_count -= 1;
                this.mutex.unlock();
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

        this.mutex.unlock();

        const path = watcher.path;
        if (this.main_watcher) |main_watcher| {
            if (path.is_file) {
                try main_watcher.addFile(path.fd, path.path, path.hash, options.Loader.file, 0, null, false);
            } else {
                if (comptime Environment.isMac) {
                    if (watcher.fsevents_watcher != null) {
                        return;
                    }
                }
                try this._addDirectory(watcher, path);
            }
        } else {
            if (path.is_file) {
                watcher.emit("Unable to watch file", 0, std.time.milliTimestamp(), false, .@"error");
            } else {
                watcher.emit("Unable to watch directory", 0, std.time.milliTimestamp(), false, .@"error");
            }
            watcher.flush();
        }
    }

    fn _incrementPathRefNoLock(this: *PathWatcherManager, file_path: [:0]const u8) void {
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
                    if (this.main_watcher) |main_watcher| {
                        main_watcher.remove(path.hash);
                    }
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

                    watcher.mutex.lock();
                    while (watcher.file_paths.popOrNull()) |file_path| {
                        this._decrementPathRefNoLock(file_path);
                    }
                    watcher.mutex.unlock();
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

        if (this.pending_tasks > 0) {
            // deinit when all tasks are done
            this.deinit_on_last_task = true;
            return;
        }

        if (this.main_watcher) |main_watcher| {
            main_watcher.deinit(false);
        }

        if (this.watcher_count > 0) {
            while (this.watchers.popOrNull()) |watcher| {
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
            std.os.close(path.fd);
            bun.default_allocator.destroy(path.path);
        }

        this.file_paths.deinit();

        this.watchers.deinitWithAllocator(bun.default_allocator);

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
    finalized: bool = false,
    // only used on macOS
    resolved_path: ?string = null,
    pub const ChangeEvent = struct {
        hash: PathWatcherManager.Watcher.HashType = 0,
        event_type: EventType = .change,
        time_stamp: i64 = 0,
    };

    pub const EventType = enum {
        rename,
        change,
        @"error",
    };
    const Callback = *const fn (ctx: ?*anyopaque, path: string, is_file: bool, event_type: EventType) void;
    const UpdateEndCallback = *const fn (ctx: ?*anyopaque) void;

    pub fn init(manager: *PathWatcherManager, path: PathWatcherManager.PathInfo, recursive: bool, callback: Callback, updateEndCallback: UpdateEndCallback, ctx: ?*anyopaque) !*PathWatcher {
        var this = try bun.default_allocator.create(PathWatcher);

        if (comptime Environment.isMac) {
            if (!path.is_file) {
                var buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
                const resolved_path_temp = std.os.getFdPath(path.fd, &buffer) catch |err| {
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
                        bun.cast(FSEvents.FSEventsWatcher.Callback, callback),
                        bun.cast(FSEvents.FSEventsWatcher.UpdateEndCallback, updateEndCallback),
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
                    .mutex = Mutex.init(),
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
            .mutex = Mutex.init(),
            .file_paths = bun.BabyList([:0]const u8).initCapacity(bun.default_allocator, 1) catch |err| {
                bun.default_allocator.destroy(this);
                return err;
            },
        };

        errdefer this.deinit();

        try manager.registerWatcher(this);
        return this;
    }

    pub fn emit(this: *PathWatcher, path: string, hash: PathWatcherManager.Watcher.HashType, time_stamp: i64, is_file: bool, event_type: EventType) void {
        if (this.finalized) return;
        const time_diff = time_stamp - this.last_change_event.time_stamp;
        // skip consecutive duplicates
        if ((this.last_change_event.time_stamp == 0 or time_diff > 1) or this.last_change_event.event_type != event_type and this.last_change_event.hash != hash) {
            this.last_change_event.time_stamp = time_stamp;
            this.last_change_event.event_type = event_type;
            this.last_change_event.hash = hash;
            this.needs_flush = true;
            this.callback(this.ctx, path, is_file, event_type);
        }
    }

    pub fn flush(this: *PathWatcher) void {
        this.needs_flush = false;

        if (this.finalized) return;
        this.flushCallback(this.ctx);
    }

    pub fn deinit(this: *PathWatcher) void {
        this.mutex.lock();
        this.finalized = true;
        if (this.pending_directories > 0) {
            // will be freed on last directory
            this.mutex.unlock();
            return;
        }
        this.mutex.unlock();

        if (this.manager) |manager| {
            if (comptime Environment.isMac) {
                if (this.fsevents_watcher) |watcher| {
                    // first unregister on FSEvents
                    watcher.deinit();
                    manager.unregisterWatcher(this);
                } else {
                    manager.unregisterWatcher(this);
                    this.file_paths.deinitWithAllocator(bun.default_allocator);
                }
            } else {
                manager.unregisterWatcher(this);
                this.file_paths.deinitWithAllocator(bun.default_allocator);
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
    callback: PathWatcher.Callback,
    updateEnd: PathWatcher.UpdateEndCallback,
    ctx: ?*anyopaque,
) !*PathWatcher {
    if (default_manager) |manager| {
        const path_info = try manager._fdFromAbsolutePathZ(path);
        errdefer manager._decrementPathRef(path);
        return try PathWatcher.init(manager, path_info, recursive, callback, updateEnd, ctx);
    } else {
        default_manager_mutex.lock();
        defer default_manager_mutex.unlock();
        if (default_manager == null) {
            default_manager = try PathWatcherManager.init(vm);
        }
        const manager = default_manager.?;
        const path_info = try manager._fdFromAbsolutePathZ(path);
        errdefer manager._decrementPathRef(path);
        return try PathWatcher.init(manager, path_info, recursive, callback, updateEnd, ctx);
    }
}
