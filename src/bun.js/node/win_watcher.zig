const std = @import("std");
const bun = @import("root").bun;
const windows = bun.windows;
const uv = windows.libuv;
const Path = @import("../../resolver/resolve_path.zig");
const Fs = @import("../../fs.zig");
const Mutex = @import("../../lock.zig").Lock;
const string = bun.string;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Output = bun.Output;
const Watcher = @import("../../watcher.zig");

var default_manager: ?*PathWatcherManager = null;

// TODO: make this a generic so we can reuse code with path_watcher
// TODO: we probably should use native instead of libuv abstraction here for better performance
pub const PathWatcherManager = struct {
    const options = @import("../../options.zig");
    const log = Output.scoped(.PathWatcherManager, false);

    watchers: bun.BabyList(?*PathWatcher) = .{},
    watcher_count: u32 = 0,
    vm: *JSC.VirtualMachine,
    file_paths: bun.StringHashMap(PathInfo),
    deinit_on_last_watcher: bool = false,
    const PathInfo = struct {
        fd: StoredFileDescriptorType = .zero,
        is_file: bool = true,
        path: [:0]const u8,
        dirname: string,
        refs: u32 = 0,
        hash: Watcher.HashType,
    };

    pub usingnamespace bun.New(PathWatcherManager);

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
        errdefer bun.default_allocator.free(cloned_path);

        const dir = bun.openDirAbsolute(cloned_path[0..cloned_path.len]) catch |err| {
            log("openDirAbsolute({s}) err {}", .{ cloned_path, err });
            if (err == error.ENOTDIR) {
                const file = try bun.openFileZ(cloned_path, .{ .mode = .read_only });
                const result = PathInfo{
                    .fd = bun.toFD(file.handle),
                    .is_file = true,
                    .path = cloned_path,
                    // if is really a file we need to get the dirname
                    .dirname = Path.dirname(cloned_path, .windows),
                    .hash = Watcher.getHash(cloned_path),
                    .refs = 1,
                };
                _ = try this.file_paths.put(cloned_path, result);
                return result;
            }
            return err;
        };
        const result = PathInfo{
            .fd = bun.toFD(dir.fd),
            .is_file = false,
            .path = cloned_path,
            .dirname = cloned_path,
            .hash = Watcher.getHash(cloned_path),
            .refs = 1,
        };
        _ = try this.file_paths.put(cloned_path, result);
        return result;
    }

    pub fn init(vm: *JSC.VirtualMachine) !*PathWatcherManager {
        var watchers = try bun.BabyList(?*PathWatcher).initCapacity(bun.default_allocator, 1);
        errdefer watchers.deinitWithAllocator(bun.default_allocator);

        var this = PathWatcherManager.new(.{
            .file_paths = bun.StringHashMap(PathInfo).init(bun.default_allocator),
            .watchers = watchers,
            .vm = vm,
            .watcher_count = 0,
        });
        errdefer this.destroy();
        return this;
    }

    fn registerWatcher(this: *PathWatcherManager, watcher: *PathWatcher) !void {
        if (this.watcher_count == this.watchers.len) {
            this.watcher_count += 1;
            this.watchers.push(bun.default_allocator, watcher) catch |err| {
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

    fn _incrementPathRef(this: *PathWatcherManager, file_path: [:0]const u8) void {
        if (this.file_paths.getEntry(file_path)) |entry| {
            var path = entry.value_ptr;
            if (path.refs > 0) {
                path.refs += 1;
            }
        }
    }

    fn _decrementPathRef(this: *PathWatcherManager, file_path: [:0]const u8) void {
        if (this.file_paths.getEntry(file_path)) |entry| {
            var path = entry.value_ptr;
            if (path.refs > 0) {
                path.refs -= 1;
                if (path.refs == 0) {
                    const path_ = path.path;
                    _ = this.file_paths.remove(path_);
                    bun.default_allocator.free(path_);
                }
            }
        }
    }

    // unregister is always called form main thread
    fn unregisterWatcher(this: *PathWatcherManager, watcher: *PathWatcher) void {
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

                    this._decrementPathRef(watcher.path.path);
                    break;
                }
            }
        }
    }
    fn deinit(this: *PathWatcherManager) void {
        // enable to create a new manager
        if (default_manager == this) {
            default_manager = null;
        }

        // only deinit if no watchers are registered
        if (this.watcher_count > 0) {
            // wait last watcher to close
            this.deinit_on_last_watcher = true;
            return;
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
            _ = bun.sys.close(path.fd);
            bun.default_allocator.free(path.path);
        }

        this.file_paths.deinit();

        this.watchers.deinitWithAllocator(bun.default_allocator);

        this.destroy();
    }
};

pub const PathWatcher = struct {
    handle: uv.uv_fs_event_t,
    ctx: ?*anyopaque,
    recursive: bool,
    callback: Callback,
    flushCallback: UpdateEndCallback,
    manager: ?*PathWatcherManager,
    path: PathWatcherManager.PathInfo,
    last_change_event: ChangeEvent = .{},
    closed: bool = false,
    needs_flush: bool = false,

    pub usingnamespace bun.New(PathWatcher);

    const log = Output.scoped(.PathWatcher, false);

    pub const ChangeEvent = struct {
        hash: Watcher.HashType = 0,
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

    fn uvEventCallback(event: *uv.uv_fs_event_t, filename: [*c]const u8, events: c_int, status: c_int) callconv(.C) void {
        if (event.data == null) return;
        const this = bun.cast(*PathWatcher, event.data);

        const manager = this.manager orelse return;

        const timestamp = std.time.milliTimestamp();

        if (status < 0) {
            const err_name = uv.uv_err_name(status);
            const err = err_name[0..bun.len(err_name)];
            this.emit(err, 0, timestamp, false, .@"error");
            this.flush();
            return;
        }

        const path = if (filename) |file| file[0..bun.len(file) :0] else return;
        // if we are watching a file we already have the file info
        const path_info = if (this.path.is_file) this.path else brk: {
            // we need the absolute path to get the file info
            var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
            var parts = [_]string{ this.path.path, path };
            @memcpy(buf[0..this.path.path.len], this.path.path);
            buf[this.path.path.len] = std.fs.path.sep;
            const cwd_z = buf[0 .. this.path.path.len + 1];
            var joined_buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
            const file_path = Path.joinAbsStringBuf(
                cwd_z,
                &joined_buf,
                &parts,
                .windows,
            );

            joined_buf[file_path.len] = 0;
            const file_path_z = joined_buf[0..file_path.len :0];
            break :brk manager._fdFromAbsolutePathZ(file_path_z) catch return;
        };

        defer {
            if (!this.path.is_file) {
                manager._decrementPathRef(path_info.path);
            }
        }
        defer this.flush();
        // events always use the relative path
        this.emit(path, path_info.hash, timestamp, path_info.is_file, if (events & uv.UV_RENAME != 0) .rename else .change);
    }

    pub fn init(manager: *PathWatcherManager, path: PathWatcherManager.PathInfo, recursive: bool, callback: Callback, updateEndCallback: UpdateEndCallback, ctx: ?*anyopaque) !*PathWatcher {
        var this = PathWatcher.new(.{
            .handle = std.mem.zeroes(uv.uv_fs_event_t),
            .path = path,
            .callback = callback,
            .manager = manager,
            .recursive = recursive,
            .flushCallback = updateEndCallback,
            .ctx = ctx,
        });
        errdefer this.deinit();

        if (uv.uv_fs_event_init(manager.vm.uvLoop(), &this.handle) != 0) {
            return error.FailedToInitializeFSEvent;
        }
        this.handle.data = this;

        const event_path = brk: {
            var outbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const size = bun.sys.readlink(path.path, &outbuf).unwrap() catch break :brk path.path;
            if (size >= bun.MAX_PATH_BYTES) break :brk path.path;
            outbuf[size] = 0;
            break :brk outbuf[0..size];
        };

        // UV_FS_EVENT_RECURSIVE only works for Windows and OSX
        if (uv.uv_fs_event_start(&this.handle, PathWatcher.uvEventCallback, event_path.ptr, if (recursive) uv.UV_FS_EVENT_RECURSIVE else 0) != 0) {
            return error.FailedToStartFSEvent;
        }
        // we handle this in node_fs_watcher
        uv.uv_unref(@ptrCast(&this.handle));

        try manager.registerWatcher(this);
        return this;
    }

    pub fn emit(this: *PathWatcher, path: string, hash: Watcher.HashType, time_stamp: i64, is_file: bool, event_type: EventType) void {
        const time_diff = time_stamp - this.last_change_event.time_stamp;
        // skip consecutive duplicates
        if ((this.last_change_event.time_stamp == 0 or time_diff > 1) or this.last_change_event.event_type != event_type and this.last_change_event.hash != hash) {
            this.last_change_event.time_stamp = time_stamp;
            this.last_change_event.event_type = event_type;
            this.last_change_event.hash = hash;
            this.needs_flush = true;
            if (this.closed) return;
            this.callback(this.ctx, path, is_file, event_type);
        }
    }

    pub fn flush(this: *PathWatcher) void {
        this.needs_flush = false;
        if (this.closed) return;
        this.flushCallback(this.ctx);
    }

    fn uvClosedCallback(handler: *anyopaque) callconv(.C) void {
        const event = bun.cast(*uv.uv_fs_event_t, handler);
        const this = bun.cast(*PathWatcher, event.data);
        this.destroy();
    }

    pub fn deinit(this: *PathWatcher) void {
        this.closed = false;

        if (this.manager) |manager| {
            manager.unregisterWatcher(this);
        }
        if (uv.uv_is_closed(@ptrCast(&this.handle))) {
            this.destroy();
        } else {
            _ = uv.uv_fs_event_stop(&this.handle);
            _ = uv.uv_close(@ptrCast(&this.handle), PathWatcher.uvClosedCallback);
        }
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
    if (!bun.Environment.isWindows) {
        @panic("win_watcher should only be used on Windows");
    }

    if (default_manager) |manager| {
        const path_info = try manager._fdFromAbsolutePathZ(path);
        errdefer manager._decrementPathRef(path);
        return try PathWatcher.init(manager, path_info, recursive, callback, updateEnd, ctx);
    } else {
        if (default_manager == null) {
            default_manager = try PathWatcherManager.init(vm);
        }
        const manager = default_manager.?;
        const path_info = try manager._fdFromAbsolutePathZ(path);
        errdefer manager._decrementPathRef(path);
        return try PathWatcher.init(manager, path_info, recursive, callback, updateEnd, ctx);
    }
}
