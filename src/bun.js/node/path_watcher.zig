const std = @import("std");

const UnboundedQueue = @import("../unbounded_queue.zig").UnboundedQueue;
const Path = @import("../../resolver/resolve_path.zig");
const Fs = @import("../../fs.zig");
const Mutex = @import("../../lock.zig").Lock;

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
    main_watcher: *Watcher,

    watchers: bun.BabyList(?*PathWatcher) = .{},
    watcher_count: u32 = 0,
    vm: *JSC.VirtualMachine,
    file_paths: bun.StringHashMap(PathInfo),
    deinit_on_last_watcher: bool = false,
    mutex: Mutex,

    const PathInfo = struct {
        fd: StoredFileDescriptorType = 0,
        is_file: bool = true,
        path: [:0]const u8,
        dirname: string,
        refs: u32 = 0,
        hash: Watcher.HashType,
    };

    fn _fdFromAbsolutePathZ(
        this: *PathWatcherManager,
        path: [:0]const u8,
    ) !PathInfo {
        if (this.file_paths.getEntry(path)) |entry| {
            var info = entry.value_ptr;
            info.refs += 1;
            return info.*;
        }
        const cloned_path = try bun.default_allocator.dupeZ(u8, path);
        errdefer bun.default_allocator.destroy(cloned_path);

        var stat = try bun.C.lstat_absolute(cloned_path);
        var result = PathInfo{
            .path = cloned_path,
            .dirname = cloned_path,
            .hash = Watcher.getHash(cloned_path),
            .refs = 1,
        };

        switch (stat.kind) {
            .sym_link => {
                var file = try std.fs.openFileAbsoluteZ(cloned_path, .{ .mode = .read_only });
                result.fd = file.handle;
                const _stat = try file.stat();

                result.is_file = _stat.kind != .directory;
                if (result.is_file) {
                    result.dirname = std.fs.path.dirname(cloned_path) orelse cloned_path;
                }
            },
            .directory => {
                const dir = (try std.fs.openIterableDirAbsoluteZ(cloned_path, .{
                    .access_sub_paths = true,
                })).dir;
                result.fd = dir.fd;
                result.is_file = false;
            },
            else => {
                const file = try std.fs.openFileAbsoluteZ(cloned_path, .{ .mode = .read_only });
                result.fd = file.handle;
                result.is_file = true;
                result.dirname = std.fs.path.dirname(cloned_path) orelse cloned_path;
            },
        }

        _ = try this.file_paths.put(cloned_path, result);
        return result;
    }

    pub fn init(vm: *JSC.VirtualMachine) !*PathWatcherManager {
        const this = try bun.default_allocator.create(PathWatcherManager);
        errdefer bun.default_allocator.destroy(this);
        var watchers = bun.BabyList(?*PathWatcher).initCapacity(bun.default_allocator, 1) catch |err| {
            bun.default_allocator.destroy(this);
            return err;
        };
        errdefer watchers.deinitWithAllocator(bun.default_allocator);
        var manager = PathWatcherManager{
            .file_paths = bun.StringHashMap(PathInfo).init(bun.default_allocator),
            .watchers = watchers,
            .main_watcher = try Watcher.init(
                this,
                vm.bundler.fs,
                bun.default_allocator,
            ),
            .vm = vm,
            .watcher_count = 0,
            .mutex = Mutex.init(),
        };

        this.* = manager;
        try this.main_watcher.start();
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

        var ctx = this.main_watcher;
        defer ctx.flushEvictions();

        const timestamp = std.time.milliTimestamp();

        this.mutex.lock();
        defer this.mutex.unlock();

        const watchers = this.watchers.slice();

        for (events) |event| {
            const file_path = file_paths[event.index];
            const update_count = counts[event.index] + 1;
            counts[event.index] = update_count;
            const kind = kinds[event.index];

            if (comptime Environment.isDebug) {
                Output.prettyErrorln("[watch] {s} ({s}, {})", .{ file_path, @tagName(kind), event.op });
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
                                const entry_point = watcher.path.dirname;
                                var path = file_path;

                                if (path.len < entry_point.len or !bun.strings.startsWith(path, entry_point)) {
                                    continue;
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
                                const entry_point = watcher.path.dirname;
                                var path = path_slice;

                                if (path.len < entry_point.len or !bun.strings.startsWith(path, entry_point)) {
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
                watcher.emit(@errorName(err), 0, timestamp, false, .@"error");
                watcher.flush();
            }
        }

        // we need a new manager at this point
        default_manager_mutex.lock();
        defer default_manager_mutex.unlock();
        default_manager = null;

        // deinit manager when all watchers are closed
        this.mutex.unlock();
        this.deinit();
    }

    fn addDirectory(this: *PathWatcherManager, watcher: *PathWatcher, path: PathInfo, buf: *[bun.MAX_PATH_BYTES + 1]u8) !void {
        const fd = path.fd;
        try this.main_watcher.addDirectory(fd, path.path, path.hash, false);

        var iter = (std.fs.IterableDir{ .dir = std.fs.Dir{
            .fd = fd,
        } }).iterate();

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

            var child_path = try this._fdFromAbsolutePathZ(entry_path_z);
            errdefer this._decrementPathRef(entry_path_z);
            try watcher.file_paths.push(bun.default_allocator, child_path.path);

            if (child_path.is_file) {
                try this.main_watcher.addFile(child_path.fd, child_path.path, child_path.hash, options.Loader.file, 0, null, false);
            } else {
                if (watcher.recursive) {
                    try this.addDirectory(watcher, child_path, buf);
                }
            }
        }
    }

    fn registerWatcher(this: *PathWatcherManager, watcher: *PathWatcher) !void {
        this.mutex.lock();
        defer this.mutex.unlock();

        if (this.watcher_count == this.watchers.len) {
            this.watcher_count += 1;
            this.watchers.push(bun.default_allocator, watcher) catch unreachable;
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
        const path = watcher.path;
        if (path.is_file) {
            try this.main_watcher.addFile(path.fd, path.path, path.hash, options.Loader.file, 0, null, false);
        } else {
            var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
            try this.addDirectory(watcher, path, &buf);
        }
    }

    fn _decrementPathRef(this: *PathWatcherManager, file_path: [:0]const u8) void {
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

                    while (watcher.file_paths.popOrNull()) |file_path| {
                        this._decrementPathRef(file_path);
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

        this.main_watcher.deinit(false);

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
        // this.mutex.deinit();

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
        this.* = PathWatcher{
            .path = path,
            .callback = callback,
            .manager = manager,
            .recursive = recursive,
            .flushCallback = updateEndCallback,
            .ctx = ctx,
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
        this.flushCallback(this.ctx);
    }

    pub fn deinit(this: *PathWatcher) void {
        if (this.manager) |manager| {
            manager.unregisterWatcher(this);
        }
        this.file_paths.deinitWithAllocator(bun.default_allocator);

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
