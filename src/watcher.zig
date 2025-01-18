const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const stringZ = bun.stringZ;
const FeatureFlags = bun.FeatureFlags;
const options = @import("./options.zig");

const Mutex = bun.Mutex;
const Futex = @import("./futex.zig");
pub const WatchItemIndex = u16;
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;

const log = bun.Output.scoped(.watcher, false);

const WATCHER_MAX_LIST = 8096;

const INotify = struct {
    loaded_inotify: bool = false,
    inotify_fd: EventListIndex = 0,

    eventlist: EventListBuffer = undefined,
    eventlist_ptrs: [128]*const INotifyEvent = undefined,

    watch_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    coalesce_interval: isize = 100_000,

    pub const EventListIndex = c_int;
    const EventListBuffer = [@sizeOf([128]INotifyEvent) + (128 * bun.MAX_PATH_BYTES + (128 * @alignOf(INotifyEvent)))]u8;

    pub const INotifyEvent = extern struct {
        watch_descriptor: c_int,
        mask: u32,
        cookie: u32,
        name_len: u32,

        pub fn name(this: *const INotifyEvent) [:0]u8 {
            if (comptime Environment.allow_assert) bun.assert(this.name_len > 0);

            // the name_len field is wrong
            // it includes alignment / padding
            // but it is a sentineled value
            // so we can just trim it to the first null byte
            return bun.sliceTo(@as([*:0]u8, @ptrFromInt(@intFromPtr(&this.name_len) + @sizeOf(u32))), 0)[0.. :0];
        }
    };

    pub fn watchPath(this: *INotify, pathname: [:0]const u8) bun.JSC.Maybe(EventListIndex) {
        bun.assert(this.loaded_inotify);
        const old_count = this.watch_count.fetchAdd(1, .release);
        defer if (old_count == 0) Futex.wake(&this.watch_count, 10);
        const watch_file_mask = std.os.linux.IN.EXCL_UNLINK | std.os.linux.IN.MOVE_SELF | std.os.linux.IN.DELETE_SELF | std.os.linux.IN.MOVED_TO | std.os.linux.IN.MODIFY;
        return .{
            .result = std.posix.inotify_add_watchZ(this.inotify_fd, pathname, watch_file_mask) catch |err| return .{
                .err = .{
                    .errno = @truncate(@intFromEnum(switch (err) {
                        error.FileNotFound => bun.C.E.NOENT,
                        error.AccessDenied => bun.C.E.ACCES,
                        error.SystemResources => bun.C.E.NOMEM,
                        error.Unexpected => bun.C.E.INVAL,
                        error.NotDir => bun.C.E.NOTDIR,
                        error.NameTooLong => bun.C.E.NAMETOOLONG,
                        error.UserResourceLimitReached => bun.C.E.MFILE,
                        error.WatchAlreadyExists => bun.C.E.EXIST,
                    })),
                    .syscall = .watch,
                },
            },
        };
    }

    pub fn watchDir(this: *INotify, pathname: [:0]const u8) bun.JSC.Maybe(EventListIndex) {
        bun.assert(this.loaded_inotify);
        const old_count = this.watch_count.fetchAdd(1, .release);
        defer if (old_count == 0) Futex.wake(&this.watch_count, 10);
        const watch_dir_mask = std.os.linux.IN.EXCL_UNLINK | std.os.linux.IN.DELETE | std.os.linux.IN.DELETE_SELF | std.os.linux.IN.CREATE | std.os.linux.IN.MOVE_SELF | std.os.linux.IN.ONLYDIR | std.os.linux.IN.MOVED_TO;
        return .{
            .result = std.posix.inotify_add_watchZ(this.inotify_fd, pathname, watch_dir_mask) catch |err| return .{
                .err = .{
                    .errno = @truncate(@intFromEnum(switch (err) {
                        error.FileNotFound => bun.C.E.NOENT,
                        error.AccessDenied => bun.C.E.ACCES,
                        error.SystemResources => bun.C.E.NOMEM,
                        error.Unexpected => bun.C.E.INVAL,
                        error.NotDir => bun.C.E.NOTDIR,
                        error.NameTooLong => bun.C.E.NAMETOOLONG,
                        error.UserResourceLimitReached => bun.C.E.MFILE,
                        error.WatchAlreadyExists => bun.C.E.EXIST,
                    })),
                    .syscall = .watch,
                },
            },
        };
    }

    pub fn unwatch(this: *INotify, wd: EventListIndex) void {
        bun.assert(this.loaded_inotify);
        _ = this.watch_count.fetchSub(1, .release);
        std.os.inotify_rm_watch(this.inotify_fd, wd);
    }

    pub fn init(this: *INotify, _: []const u8) !void {
        bun.assert(!this.loaded_inotify);
        this.loaded_inotify = true;

        if (bun.getenvZ("BUN_INOTIFY_COALESCE_INTERVAL")) |env| {
            this.coalesce_interval = std.fmt.parseInt(isize, env, 10) catch 100_000;
        }

        this.inotify_fd = try std.posix.inotify_init1(std.os.linux.IN.CLOEXEC);
    }

    pub fn read(this: *INotify) bun.JSC.Maybe([]*const INotifyEvent) {
        bun.assert(this.loaded_inotify);

        restart: while (true) {
            Futex.waitForever(&this.watch_count, 0);

            const rc = std.posix.system.read(
                this.inotify_fd,
                @as([*]u8, @ptrCast(@alignCast(&this.eventlist))),
                @sizeOf(EventListBuffer),
            );

            const errno = std.posix.errno(rc);
            switch (errno) {
                .SUCCESS => {
                    var len = @as(usize, @intCast(rc));

                    if (len == 0) return .{ .result = &[_]*INotifyEvent{} };

                    // IN_MODIFY is very noisy
                    // we do a 0.1ms sleep to try to coalesce events better
                    if (len < (@sizeOf(EventListBuffer) / 2)) {
                        var fds = [_]std.posix.pollfd{.{
                            .fd = this.inotify_fd,
                            .events = std.posix.POLL.IN | std.posix.POLL.ERR,
                            .revents = 0,
                        }};
                        var timespec = std.posix.timespec{ .tv_sec = 0, .tv_nsec = this.coalesce_interval };
                        if ((std.posix.ppoll(&fds, &timespec, null) catch 0) > 0) {
                            while (true) {
                                const new_rc = std.posix.system.read(
                                    this.inotify_fd,
                                    @as([*]u8, @ptrCast(@alignCast(&this.eventlist))) + len,
                                    @sizeOf(EventListBuffer) - len,
                                );
                                const e = std.posix.errno(new_rc);
                                switch (e) {
                                    .SUCCESS => {
                                        len += @as(usize, @intCast(new_rc));
                                    },
                                    .AGAIN => continue,
                                    .INTR => continue,
                                    else => return .{ .err = .{
                                        .errno = @truncate(@intFromEnum(e)),
                                        .syscall = .read,
                                    } },
                                }
                                break;
                            }
                        }
                    }

                    // This is what replit does as of Jaunary 2023.
                    // 1) CREATE .http.ts.3491171321~
                    // 2) OPEN .http.ts.3491171321~
                    // 3) ATTRIB .http.ts.3491171321~
                    // 4) MODIFY .http.ts.3491171321~
                    // 5) CLOSE_WRITE,CLOSE .http.ts.3491171321~
                    // 6) MOVED_FROM .http.ts.3491171321~
                    // 7) MOVED_TO http.ts
                    // We still don't correctly handle MOVED_FROM && MOVED_TO it seems.

                    var count: u32 = 0;
                    var i: u32 = 0;
                    while (i < len) : (i += @sizeOf(INotifyEvent)) {
                        @setRuntimeSafety(false);
                        const event = @as(*INotifyEvent, @ptrCast(@alignCast(this.eventlist[i..][0..@sizeOf(INotifyEvent)])));
                        i += event.name_len;

                        this.eventlist_ptrs[count] = event;
                        count += 1;
                    }

                    return .{ .result = this.eventlist_ptrs[0..count] };
                },
                .AGAIN => continue :restart,
                else => return .{ .err = .{
                    .errno = @truncate(@intFromEnum(errno)),
                    .syscall = .read,
                } },
            }
        }
    }

    pub fn stop(this: *INotify) void {
        if (this.inotify_fd != 0) {
            _ = bun.sys.close(bun.toFD(this.inotify_fd));
            this.inotify_fd = 0;
        }
    }
};

const DarwinWatcher = struct {
    pub const EventListIndex = u32;

    const KEvent = std.c.Kevent;

    // Internal
    changelist: [128]KEvent = undefined,

    // Everything being watched
    eventlist: [WATCHER_MAX_LIST]KEvent = undefined,
    eventlist_index: EventListIndex = 0,

    fd: bun.FileDescriptor = bun.invalid_fd,

    pub fn init(this: *DarwinWatcher, _: []const u8) !void {
        const fd = try std.posix.kqueue();
        if (fd == 0) return error.KQueueError;
        this.fd = bun.toFD(fd);
    }

    pub fn stop(this: *DarwinWatcher) void {
        if (this.fd.isValid()) {
            _ = bun.sys.close(this.fd);
            this.fd = bun.invalid_fd;
        }
    }
};

const WindowsWatcher = struct {
    mutex: Mutex = .{},
    iocp: w.HANDLE = undefined,
    watcher: DirWatcher = undefined,

    const w = std.os.windows;
    pub const EventListIndex = c_int;

    const Error = error{
        IocpFailed,
        ReadDirectoryChangesFailed,
        CreateFileFailed,
        InvalidPath,
    };

    const Action = enum(w.DWORD) {
        Added = w.FILE_ACTION_ADDED,
        Removed = w.FILE_ACTION_REMOVED,
        Modified = w.FILE_ACTION_MODIFIED,
        RenamedOld = w.FILE_ACTION_RENAMED_OLD_NAME,
        RenamedNew = w.FILE_ACTION_RENAMED_NEW_NAME,
    };

    const FileEvent = struct {
        action: Action,
        filename: []u16 = undefined,
    };

    const DirWatcher = struct {
        // must be initialized to zero (even though it's never read or written in our code),
        // otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
        overlapped: w.OVERLAPPED = std.mem.zeroes(w.OVERLAPPED),
        buf: [64 * 1024]u8 align(@alignOf(w.FILE_NOTIFY_INFORMATION)) = undefined,
        dirHandle: w.HANDLE,

        // invalidates any EventIterators
        fn prepare(this: *DirWatcher) bun.JSC.Maybe(void) {
            const filter = w.FILE_NOTIFY_CHANGE_FILE_NAME | w.FILE_NOTIFY_CHANGE_DIR_NAME | w.FILE_NOTIFY_CHANGE_LAST_WRITE | w.FILE_NOTIFY_CHANGE_CREATION;
            if (w.kernel32.ReadDirectoryChangesW(this.dirHandle, &this.buf, this.buf.len, 1, filter, null, &this.overlapped, null) == 0) {
                const err = w.kernel32.GetLastError();
                log("failed to start watching directory: {s}", .{@tagName(err)});
                return .{ .err = .{
                    .errno = @intFromEnum(bun.C.SystemErrno.init(err) orelse bun.C.SystemErrno.EINVAL),
                    .syscall = .watch,
                } };
            }
            log("read directory changes!", .{});
            return .{ .result = {} };
        }
    };

    const EventIterator = struct {
        watcher: *DirWatcher,
        offset: usize = 0,
        hasNext: bool = true,

        pub fn next(this: *EventIterator) ?FileEvent {
            if (!this.hasNext) return null;
            const info_size = @sizeOf(w.FILE_NOTIFY_INFORMATION);
            const info: *w.FILE_NOTIFY_INFORMATION = @alignCast(@ptrCast(this.watcher.buf[this.offset..].ptr));
            const name_ptr: [*]u16 = @alignCast(@ptrCast(this.watcher.buf[this.offset + info_size ..]));
            const filename: []u16 = name_ptr[0 .. info.FileNameLength / @sizeOf(u16)];

            const action: Action = @enumFromInt(info.Action);

            if (info.NextEntryOffset == 0) {
                this.hasNext = false;
            } else {
                this.offset += @as(usize, info.NextEntryOffset);
            }

            return FileEvent{
                .action = action,
                .filename = filename,
            };
        }
    };

    pub fn init(this: *WindowsWatcher, root: []const u8) !void {
        var pathbuf: bun.WPathBuffer = undefined;
        const wpath = bun.strings.toNTPath(&pathbuf, root);
        const path_len_bytes: u16 = @truncate(wpath.len * 2);
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = @constCast(wpath.ptr),
        };
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = null,
            .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
        var handle: w.HANDLE = w.INVALID_HANDLE_VALUE;
        var io: w.IO_STATUS_BLOCK = undefined;
        const rc = w.ntdll.NtCreateFile(
            &handle,
            w.FILE_LIST_DIRECTORY,
            &attr,
            &io,
            null,
            0,
            w.FILE_SHARE_READ | w.FILE_SHARE_WRITE | w.FILE_SHARE_DELETE,
            w.FILE_OPEN,
            w.FILE_DIRECTORY_FILE | w.FILE_OPEN_FOR_BACKUP_INTENT,
            null,
            0,
        );

        if (rc != .SUCCESS) {
            const err = bun.windows.Win32Error.fromNTStatus(rc);
            log("failed to open directory for watching: {s}", .{@tagName(err)});
            return Error.CreateFileFailed;
        }
        errdefer _ = w.kernel32.CloseHandle(handle);

        this.iocp = try w.CreateIoCompletionPort(handle, null, 0, 1);
        errdefer _ = w.kernel32.CloseHandle(this.iocp);

        this.watcher = .{ .dirHandle = handle };
    }

    const Timeout = enum(w.DWORD) {
        infinite = w.INFINITE,
        minimal = 1,
        none = 0,
    };

    // wait until new events are available
    pub fn next(this: *WindowsWatcher, timeout: Timeout) bun.JSC.Maybe(?EventIterator) {
        switch (this.watcher.prepare()) {
            .err => |err| {
                log("prepare() returned error", .{});
                return .{ .err = err };
            },
            .result => {},
        }

        var nbytes: w.DWORD = 0;
        var key: w.ULONG_PTR = 0;
        var overlapped: ?*w.OVERLAPPED = null;
        while (true) {
            const rc = w.kernel32.GetQueuedCompletionStatus(this.iocp, &nbytes, &key, &overlapped, @intFromEnum(timeout));
            if (rc == 0) {
                const err = w.kernel32.GetLastError();
                if (err == .TIMEOUT or err == .WAIT_TIMEOUT) {
                    return .{ .result = null };
                } else {
                    log("GetQueuedCompletionStatus failed: {s}", .{@tagName(err)});
                    return .{ .err = .{
                        .errno = @intFromEnum(bun.C.SystemErrno.init(err) orelse bun.C.SystemErrno.EINVAL),
                        .syscall = .watch,
                    } };
                }
            }

            if (overlapped) |ptr| {
                // ignore possible spurious events
                if (ptr != &this.watcher.overlapped) {
                    continue;
                }
                if (nbytes == 0) {
                    // shutdown notification
                    // TODO close handles?
                    log("shutdown notification in WindowsWatcher.next", .{});
                    return .{ .err = .{
                        .errno = @intFromEnum(bun.C.SystemErrno.ESHUTDOWN),
                        .syscall = .watch,
                    } };
                }
                return .{ .result = EventIterator{ .watcher = &this.watcher } };
            } else {
                log("GetQueuedCompletionStatus returned no overlapped event", .{});
                return .{ .err = .{
                    .errno = @truncate(@intFromEnum(bun.C.E.INVAL)),
                    .syscall = .watch,
                } };
            }
        }
    }

    pub fn stop(this: *WindowsWatcher) void {
        w.CloseHandle(this.watcher.dirHandle);
        w.CloseHandle(this.iocp);
    }
};

const PlatformWatcher = if (Environment.isMac)
    DarwinWatcher
else if (Environment.isLinux)
    INotify
else if (Environment.isWindows)
    WindowsWatcher
else
    @compileError("Unsupported platform");

pub const WatchEvent = struct {
    index: WatchItemIndex,
    op: Op,
    name_off: u8 = 0,
    name_len: u8 = 0,

    pub fn ignoreINotifyEvent(event: INotify.INotifyEvent) bool {
        var stack: WatchEvent = undefined;
        stack.fromINotify(event, 0);
        return @as(std.meta.Int(.unsigned, @bitSizeOf(Op)), @bitCast(stack.op)) == 0;
    }

    pub fn names(this: WatchEvent, buf: []?[:0]u8) []?[:0]u8 {
        if (this.name_len == 0) return &[_]?[:0]u8{};
        return buf[this.name_off..][0..this.name_len];
    }

    const KEvent = std.c.Kevent;

    pub const Sorter = void;

    pub fn sortByIndex(_: Sorter, event: WatchEvent, rhs: WatchEvent) bool {
        return event.index < rhs.index;
    }

    pub fn merge(this: *WatchEvent, other: WatchEvent) void {
        this.name_len += other.name_len;
        this.op = Op{
            .delete = this.op.delete or other.op.delete,
            .metadata = this.op.metadata or other.op.metadata,
            .rename = this.op.rename or other.op.rename,
            .write = this.op.write or other.op.write,
        };
    }

    pub fn fromKEvent(this: *WatchEvent, kevent: KEvent) void {
        this.* =
            WatchEvent{
            .op = Op{
                .delete = (kevent.fflags & std.c.NOTE_DELETE) > 0,
                .metadata = (kevent.fflags & std.c.NOTE_ATTRIB) > 0,
                .rename = (kevent.fflags & (std.c.NOTE_RENAME | std.c.NOTE_LINK)) > 0,
                .write = (kevent.fflags & std.c.NOTE_WRITE) > 0,
            },
            .index = @as(WatchItemIndex, @truncate(kevent.udata)),
        };
    }

    pub fn fromINotify(this: *WatchEvent, event: INotify.INotifyEvent, index: WatchItemIndex) void {
        this.* = WatchEvent{
            .op = Op{
                .delete = (event.mask & std.os.linux.IN.DELETE_SELF) > 0 or (event.mask & std.os.linux.IN.DELETE) > 0,
                .rename = (event.mask & std.os.linux.IN.MOVE_SELF) > 0,
                .move_to = (event.mask & std.os.linux.IN.MOVED_TO) > 0,
                .write = (event.mask & std.os.linux.IN.MODIFY) > 0,
            },
            .index = index,
        };
    }

    pub fn fromFileNotify(this: *WatchEvent, event: WindowsWatcher.FileEvent, index: WatchItemIndex) void {
        this.* = WatchEvent{
            .op = Op{
                .delete = event.action == .Removed,
                .rename = event.action == .RenamedOld,
                .write = event.action == .Modified,
            },
            .index = index,
        };
    }

    pub const Op = packed struct {
        delete: bool = false,
        metadata: bool = false,
        rename: bool = false,
        write: bool = false,
        move_to: bool = false,

        pub fn merge(before: Op, after: Op) Op {
            return .{
                .delete = before.delete or after.delete,
                .write = before.write or after.write,
                .metadata = before.metadata or after.metadata,
                .rename = before.rename or after.rename,
                .move_to = before.move_to or after.move_to,
            };
        }

        pub fn format(op: Op, comptime _: []const u8, _: std.fmt.FormatOptions, w: anytype) !void {
            try w.writeAll("{");
            var first = true;
            inline for (comptime std.meta.fieldNames(Op)) |name| {
                if (@field(op, name)) {
                    if (!first) {
                        try w.writeAll(",");
                    }
                    first = false;
                    try w.writeAll(name);
                }
            }
            try w.writeAll("}");
        }
    };
};

pub const WatchItem = struct {
    file_path: string,
    // filepath hash for quick comparison
    hash: u32,
    loader: options.Loader,
    fd: bun.FileDescriptor,
    count: u32,
    parent_hash: u32,
    kind: Kind,
    package_json: ?*PackageJSON,
    eventlist_index: if (Environment.isLinux) PlatformWatcher.EventListIndex else u0 = 0,

    pub const Kind = enum { file, directory };
};

pub const WatchList = std.MultiArrayList(WatchItem);
pub const HashType = u32;

pub fn getHash(filepath: string) HashType {
    return @as(HashType, @truncate(bun.hash(filepath)));
}

// TODO: Rename to `Watcher` and make a top-level struct.
// `if(true)` is to reduce git diff from when it was changed
// from a comptime function to a basic struct.
pub const NewWatcher = if (true)
    struct {
        const Watcher = @This();

        pub const Event = WatchEvent;
        pub const Item = WatchItem;
        pub const ItemList = WatchList;

        watchlist: WatchList,
        watched_count: usize = 0,
        mutex: Mutex,

        platform: PlatformWatcher = PlatformWatcher{},

        // User-facing
        watch_events: [128]WatchEvent = undefined,
        changed_filepaths: [128]?[:0]u8 = [_]?[:0]u8{null} ** 128,

        ctx: *anyopaque,
        onFileUpdate: *const fn (this: *anyopaque, events: []WatchEvent, changed_files: []?[:0]u8, watchlist: WatchList) void,
        onError: *const fn (this: *anyopaque, err: bun.sys.Error) void,

        fs: *bun.fs.FileSystem,
        allocator: std.mem.Allocator,
        watchloop_handle: ?std.Thread.Id = null,
        cwd: string,
        thread: std.Thread = undefined,
        running: bool = true,
        close_descriptors: bool = false,

        evict_list: [WATCHER_MAX_LIST]WatchItemIndex = undefined,
        evict_list_i: WatchItemIndex = 0,

        thread_lock: bun.DebugThreadLock = bun.DebugThreadLock.unlocked,

        const no_watch_item: WatchItemIndex = std.math.maxInt(WatchItemIndex);

        pub fn init(comptime T: type, ctx: *T, fs: *bun.fs.FileSystem, allocator: std.mem.Allocator) !*Watcher {
            const wrapped = struct {
                fn onFileUpdateWrapped(ctx_opaque: *anyopaque, events: []WatchEvent, changed_files: []?[:0]u8, watchlist: WatchList) void {
                    T.onFileUpdate(@alignCast(@ptrCast(ctx_opaque)), events, changed_files, watchlist);
                }
                fn onErrorWrapped(ctx_opaque: *anyopaque, err: bun.sys.Error) void {
                    if (@hasDecl(T, "onWatchError")) {
                        T.onWatchError(@alignCast(@ptrCast(ctx_opaque)), err);
                    } else {
                        T.onError(@alignCast(@ptrCast(ctx_opaque)), err);
                    }
                }
            };

            const watcher = try allocator.create(Watcher);
            errdefer allocator.destroy(watcher);

            watcher.* = Watcher{
                .fs = fs,
                .allocator = allocator,
                .watched_count = 0,
                .watchlist = WatchList{},
                .mutex = .{},
                .cwd = fs.top_level_dir,

                .ctx = ctx,
                .onFileUpdate = &wrapped.onFileUpdateWrapped,
                .onError = &wrapped.onErrorWrapped,
            };

            try PlatformWatcher.init(&watcher.platform, fs.top_level_dir);

            return watcher;
        }

        pub fn start(this: *Watcher) !void {
            bun.assert(this.watchloop_handle == null);
            this.thread = try std.Thread.spawn(.{}, Watcher.watchLoop, .{this});
        }

        pub fn deinit(this: *Watcher, close_descriptors: bool) void {
            if (this.watchloop_handle != null) {
                this.mutex.lock();
                defer this.mutex.unlock();
                this.close_descriptors = close_descriptors;
                this.running = false;
            } else {
                if (close_descriptors and this.running) {
                    const fds = this.watchlist.items(.fd);
                    for (fds) |fd| {
                        _ = bun.sys.close(fd);
                    }
                }
                this.watchlist.deinit(this.allocator);
                const allocator = this.allocator;
                allocator.destroy(this);
            }
        }

        // This must only be called from the watcher thread
        pub fn watchLoop(this: *Watcher) !void {
            this.watchloop_handle = std.Thread.getCurrentId();
            this.thread_lock.lock();
            Output.Source.configureNamedThread("File Watcher");

            defer Output.flush();
            if (FeatureFlags.verbose_watcher) Output.prettyln("Watcher started", .{});

            switch (this._watchLoop()) {
                .err => |err| {
                    this.watchloop_handle = null;
                    this.platform.stop();
                    if (this.running) {
                        this.onError(this.ctx, err);
                    }
                },
                .result => {},
            }

            // deinit and close descriptors if needed
            if (this.close_descriptors) {
                const fds = this.watchlist.items(.fd);
                for (fds) |fd| {
                    _ = bun.sys.close(fd);
                }
            }
            this.watchlist.deinit(this.allocator);

            const allocator = this.allocator;
            allocator.destroy(this);
        }

        pub fn flushEvictions(this: *Watcher) void {
            if (this.evict_list_i == 0) return;
            defer this.evict_list_i = 0;

            // swapRemove messes up the order
            // But, it only messes up the order if any elements in the list appear after the item being removed
            // So if we just sort the list by the biggest index first, that should be fine
            std.sort.pdq(
                WatchItemIndex,
                this.evict_list[0..this.evict_list_i],
                {},
                comptime std.sort.desc(WatchItemIndex),
            );

            var slice = this.watchlist.slice();
            const fds = slice.items(.fd);
            var last_item = no_watch_item;

            for (this.evict_list[0..this.evict_list_i]) |item| {
                // catch duplicates, since the list is sorted, duplicates will appear right after each other
                if (item == last_item) continue;

                if (!Environment.isWindows) {
                    // on mac and linux we can just close the file descriptor
                    // TODO do we need to call inotify_rm_watch on linux?
                    _ = bun.sys.close(fds[item]);
                }
                last_item = item;
            }

            last_item = no_watch_item;
            // This is split into two passes because reading the slice while modified is potentially unsafe.
            for (this.evict_list[0..this.evict_list_i]) |item| {
                if (item == last_item) continue;
                this.watchlist.swapRemove(item);
                last_item = item;
            }
        }

        fn _watchLoop(this: *Watcher) bun.JSC.Maybe(void) {
            if (Environment.isMac) {
                bun.assert(this.platform.fd.isValid());
                const KEvent = std.c.Kevent;

                var changelist_array: [128]KEvent = std.mem.zeroes([128]KEvent);
                var changelist = &changelist_array;
                while (true) {
                    defer Output.flush();

                    var count_ = std.posix.system.kevent(
                        this.platform.fd.cast(),
                        @as([*]KEvent, changelist),
                        0,
                        @as([*]KEvent, changelist),
                        128,

                        null,
                    );

                    // Give the events more time to coalesce
                    if (count_ < 128 / 2) {
                        const remain = 128 - count_;
                        var timespec = std.posix.timespec{ .tv_sec = 0, .tv_nsec = 100_000 };
                        const extra = std.posix.system.kevent(
                            this.platform.fd.cast(),
                            @as([*]KEvent, changelist[@as(usize, @intCast(count_))..].ptr),
                            0,
                            @as([*]KEvent, changelist[@as(usize, @intCast(count_))..].ptr),
                            remain,

                            &timespec,
                        );

                        count_ += extra;
                    }

                    var changes = changelist[0..@as(usize, @intCast(@max(0, count_)))];
                    var watchevents = this.watch_events[0..changes.len];
                    var out_len: usize = 0;
                    if (changes.len > 0) {
                        watchevents[0].fromKEvent(changes[0]);
                        out_len = 1;
                        var prev_event = changes[0];
                        for (changes[1..]) |event| {
                            if (prev_event.udata == event.udata) {
                                var new: WatchEvent = undefined;
                                new.fromKEvent(event);
                                watchevents[out_len - 1].merge(new);
                                continue;
                            }

                            watchevents[out_len].fromKEvent(event);
                            prev_event = event;
                            out_len += 1;
                        }

                        watchevents = watchevents[0..out_len];
                    }

                    this.mutex.lock();
                    defer this.mutex.unlock();
                    if (this.running) {
                        this.onFileUpdate(this.ctx, watchevents, this.changed_filepaths[0..watchevents.len], this.watchlist);
                    } else {
                        break;
                    }
                }
            } else if (Environment.isLinux) {
                restart: while (true) {
                    defer Output.flush();

                    var events = switch (this.platform.read()) {
                        .result => |result| result,
                        .err => |err| return .{ .err = err },
                    };
                    if (events.len == 0) continue :restart;

                    // TODO: is this thread safe?
                    var remaining_events = events.len;

                    const eventlist_index = this.watchlist.items(.eventlist_index);

                    while (remaining_events > 0) {
                        var name_off: u8 = 0;
                        var temp_name_list: [128]?[:0]u8 = undefined;
                        var temp_name_off: u8 = 0;

                        const slice = events[0..@min(128, remaining_events, this.watch_events.len)];
                        var watchevents = this.watch_events[0..slice.len];
                        var watch_event_id: u32 = 0;
                        for (slice) |event| {
                            watchevents[watch_event_id].fromINotify(
                                event.*,
                                @as(
                                    WatchItemIndex,
                                    @intCast(std.mem.indexOfScalar(
                                        INotify.EventListIndex,
                                        eventlist_index,
                                        event.watch_descriptor,
                                    ) orelse continue),
                                ),
                            );
                            temp_name_list[temp_name_off] = if (event.name_len > 0)
                                event.name()
                            else
                                null;
                            watchevents[watch_event_id].name_off = temp_name_off;
                            watchevents[watch_event_id].name_len = @as(u8, @intFromBool((event.name_len > 0)));
                            temp_name_off += @as(u8, @intFromBool((event.name_len > 0)));

                            watch_event_id += 1;
                        }

                        var all_events = watchevents[0..watch_event_id];
                        std.sort.pdq(WatchEvent, all_events, {}, WatchEvent.sortByIndex);

                        var last_event_index: usize = 0;
                        var last_event_id: INotify.EventListIndex = std.math.maxInt(INotify.EventListIndex);

                        for (all_events, 0..) |_, i| {
                            if (all_events[i].name_len > 0) {
                                this.changed_filepaths[name_off] = temp_name_list[all_events[i].name_off];
                                all_events[i].name_off = name_off;
                                name_off += 1;
                            }

                            if (all_events[i].index == last_event_id) {
                                all_events[last_event_index].merge(all_events[i]);
                                continue;
                            }
                            last_event_index = i;
                            last_event_id = all_events[i].index;
                        }
                        if (all_events.len == 0) continue :restart;

                        this.mutex.lock();
                        defer this.mutex.unlock();
                        if (this.running) {
                            this.onFileUpdate(this.ctx, all_events[0 .. last_event_index + 1], this.changed_filepaths[0 .. name_off + 1], this.watchlist);
                        } else {
                            break;
                        }
                        remaining_events -= slice.len;
                    }
                }
            } else if (Environment.isWindows) {
                log("_watchLoop", .{});
                var buf: bun.PathBuffer = undefined;
                const root = this.fs.top_level_dir;
                @memcpy(buf[0..root.len], root);
                const needs_slash = root.len == 0 or !bun.strings.charIsAnySlash(root[root.len - 1]);
                if (needs_slash) {
                    buf[root.len] = '\\';
                }
                const baseidx = if (needs_slash) root.len + 1 else root.len;
                restart: while (true) {
                    var event_id: usize = 0;

                    // first wait has infinite timeout - we're waiting for the next event and don't want to spin
                    var timeout = WindowsWatcher.Timeout.infinite;
                    while (true) {
                        var iter = switch (this.platform.next(timeout)) {
                            .err => |err| return .{ .err = err },
                            .result => |iter| iter orelse break,
                        };
                        // after the first wait, we want to coalesce further events but don't want to wait for them
                        // NOTE: using a 1ms timeout would be ideal, but that actually makes the thread wait for at least 10ms more than it should
                        // Instead we use a 0ms timeout, which may not do as much coalescing but is more responsive.
                        timeout = WindowsWatcher.Timeout.none;
                        const item_paths = this.watchlist.items(.file_path);
                        log("number of watched items: {d}", .{item_paths.len});
                        while (iter.next()) |event| {
                            const convert_res = bun.strings.copyUTF16IntoUTF8(buf[baseidx..], []const u16, event.filename, false);
                            const eventpath = buf[0 .. baseidx + convert_res.written];

                            log("watcher update event: (filename: {s}, action: {s}", .{ eventpath, @tagName(event.action) });

                            // TODO this probably needs a more sophisticated search algorithm in the future
                            // Possible approaches:
                            // - Keep a sorted list of the watched paths and perform a binary search. We could use a bool to keep
                            //   track of whether the list is sorted and only sort it when we detect a change.
                            // - Use a prefix tree. Potentially more efficient for large numbers of watched paths, but complicated
                            //   to implement and maintain.
                            // - others that i'm not thinking of

                            for (item_paths, 0..) |path_, item_idx| {
                                var path = path_;
                                if (path.len > 0 and bun.strings.charIsAnySlash(path[path.len - 1])) {
                                    path = path[0 .. path.len - 1];
                                }
                                // log("checking path: {s}\n", .{path});
                                // check if the current change applies to this item
                                // if so, add it to the eventlist
                                const rel = bun.path.isParentOrEqual(eventpath, path);
                                // skip unrelated items
                                if (rel == .unrelated) continue;
                                // if the event is for a parent dir of the item, only emit it if it's a delete or rename
                                if (rel == .parent and (event.action != .Removed or event.action != .RenamedOld)) continue;
                                this.watch_events[event_id].fromFileNotify(event, @truncate(item_idx));
                                event_id += 1;
                            }
                        }
                    }
                    if (event_id == 0) {
                        continue :restart;
                    }

                    // log("event_id: {d}\n", .{event_id});

                    var all_events = this.watch_events[0..event_id];
                    std.sort.pdq(WatchEvent, all_events, {}, WatchEvent.sortByIndex);

                    var last_event_index: usize = 0;
                    var last_event_id: INotify.EventListIndex = std.math.maxInt(INotify.EventListIndex);

                    for (all_events, 0..) |_, i| {
                        // if (all_events[i].name_len > 0) {
                        // this.changed_filepaths[name_off] = temp_name_list[all_events[i].name_off];
                        // all_events[i].name_off = name_off;
                        // name_off += 1;
                        // }

                        if (all_events[i].index == last_event_id) {
                            all_events[last_event_index].merge(all_events[i]);
                            continue;
                        }
                        last_event_index = i;
                        last_event_id = all_events[i].index;
                    }
                    if (all_events.len == 0) continue :restart;
                    all_events = all_events[0 .. last_event_index + 1];

                    log("calling onFileUpdate (all_events.len = {d})", .{all_events.len});

                    this.onFileUpdate(this.ctx, all_events, this.changed_filepaths[0 .. last_event_index + 1], this.watchlist);
                }
            }

            return .{ .result = {} };
        }

        fn appendFileAssumeCapacity(
            this: *Watcher,
            fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            parent_hash: HashType,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
        ) bun.JSC.Maybe(void) {
            if (comptime Environment.isWindows) {
                // on windows we can only watch items that are in the directory tree of the top level dir
                const rel = bun.path.isParentOrEqual(this.fs.top_level_dir, file_path);
                if (rel == .unrelated) {
                    Output.warn("File {s} is not in the project directory and will not be watched\n", .{file_path});
                    return .{ .result = {} };
                }
            }

            const watchlist_id = this.watchlist.len;

            const file_path_: string = if (comptime copy_file_path)
                bun.asByteSlice(this.allocator.dupeZ(u8, file_path) catch bun.outOfMemory())
            else
                file_path;

            var item = WatchItem{
                .file_path = file_path_,
                .fd = fd,
                .hash = hash,
                .count = 0,
                .loader = loader,
                .parent_hash = parent_hash,
                .package_json = package_json,
                .kind = .file,
            };

            if (comptime Environment.isMac) {
                const KEvent = std.c.Kevent;

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
                var event = std.mem.zeroes(KEvent);

                event.flags = std.c.EV_ADD | std.c.EV_CLEAR | std.c.EV_ENABLE;
                // we want to know about the vnode
                event.filter = std.c.EVFILT_VNODE;

                event.fflags = std.c.NOTE_WRITE | std.c.NOTE_RENAME | std.c.NOTE_DELETE;

                // id
                event.ident = @intCast(fd.int());

                // Store the hash for fast filtering later
                event.udata = @as(usize, @intCast(watchlist_id));
                var events: [1]KEvent = .{event};

                // This took a lot of work to figure out the right permutation
                // Basically:
                // - We register the event here.
                // our while(true) loop above receives notification of changes to any of the events created here.
                _ = std.posix.system.kevent(
                    this.platform.fd.cast(),
                    @as([]KEvent, events[0..1]).ptr,
                    1,
                    @as([]KEvent, events[0..1]).ptr,
                    0,
                    null,
                );
            } else if (comptime Environment.isLinux) {
                // var file_path_to_use_ = std.mem.trimRight(u8, file_path_, "/");
                // var buf: [bun.MAX_PATH_BYTES+1]u8 = undefined;
                // bun.copy(u8, &buf, file_path_to_use_);
                // buf[file_path_to_use_.len] = 0;
                var buf = file_path_.ptr;
                const slice: [:0]const u8 = buf[0..file_path_.len :0];
                item.eventlist_index = switch (this.platform.watchPath(slice)) {
                    .err => |err| return .{ .err = err },
                    .result => |r| r,
                };
            }

            this.watchlist.appendAssumeCapacity(item);
            return .{ .result = {} };
        }

        fn appendDirectoryAssumeCapacity(
            this: *Watcher,
            stored_fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            comptime copy_file_path: bool,
        ) bun.JSC.Maybe(WatchItemIndex) {
            if (comptime Environment.isWindows) {
                // on windows we can only watch items that are in the directory tree of the top level dir
                const rel = bun.path.isParentOrEqual(this.fs.top_level_dir, file_path);
                if (rel == .unrelated) {
                    Output.warn("Directory {s} is not in the project directory and will not be watched\n", .{file_path});
                    return .{ .result = no_watch_item };
                }
            }

            const fd = brk: {
                if (stored_fd != .zero) break :brk stored_fd;
                break :brk switch (bun.sys.openA(file_path, 0, 0)) {
                    .err => |err| return .{ .err = err },
                    .result => |fd| fd,
                };
            };

            const parent_hash = getHash(bun.fs.PathName.init(file_path).dirWithTrailingSlash());

            const file_path_: string = if (comptime copy_file_path)
                bun.asByteSlice(this.allocator.dupeZ(u8, file_path) catch bun.outOfMemory())
            else
                file_path;

            const watchlist_id = this.watchlist.len;

            var item = WatchItem{
                .file_path = file_path_,
                .fd = fd,
                .hash = hash,
                .count = 0,
                .loader = options.Loader.file,
                .parent_hash = parent_hash,
                .kind = .directory,
                .package_json = null,
            };

            if (Environment.isMac) {
                const KEvent = std.c.Kevent;

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
                var event = std.mem.zeroes(KEvent);

                event.flags = std.c.EV_ADD | std.c.EV_CLEAR | std.c.EV_ENABLE;
                // we want to know about the vnode
                event.filter = std.c.EVFILT_VNODE;

                // monitor:
                // - Write
                // - Rename
                // - Delete
                event.fflags = std.c.NOTE_WRITE | std.c.NOTE_RENAME | std.c.NOTE_DELETE;

                // id
                event.ident = @intCast(fd.int());

                // Store the hash for fast filtering later
                event.udata = @as(usize, @intCast(watchlist_id));
                var events: [1]KEvent = .{event};

                // This took a lot of work to figure out the right permutation
                // Basically:
                // - We register the event here.
                // our while(true) loop above receives notification of changes to any of the events created here.
                _ = std.posix.system.kevent(
                    this.platform.fd.cast(),
                    @as([]KEvent, events[0..1]).ptr,
                    1,
                    @as([]KEvent, events[0..1]).ptr,
                    0,
                    null,
                );
            } else if (Environment.isLinux) {
                const file_path_to_use_ = std.mem.trimRight(u8, file_path_, "/");
                var buf: bun.PathBuffer = undefined;
                bun.copy(u8, &buf, file_path_to_use_);
                buf[file_path_to_use_.len] = 0;
                const slice: [:0]u8 = buf[0..file_path_to_use_.len :0];
                item.eventlist_index = switch (this.platform.watchDir(slice)) {
                    .err => |err| return .{ .err = err },
                    .result => |r| r,
                };
            }

            this.watchlist.appendAssumeCapacity(item);
            return .{
                .result = @as(WatchItemIndex, @truncate(this.watchlist.len - 1)),
            };
        }

        // Below is platform-independent

        pub fn appendFileMaybeLock(
            this: *Watcher,
            fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            dir_fd: bun.FileDescriptor,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
            comptime lock: bool,
        ) bun.JSC.Maybe(void) {
            if (comptime lock) this.mutex.lock();
            defer if (comptime lock) this.mutex.unlock();
            bun.assert(file_path.len > 1);
            const pathname = bun.fs.PathName.init(file_path);

            const parent_dir = pathname.dirWithTrailingSlash();
            const parent_dir_hash: HashType = getHash(parent_dir);

            var parent_watch_item: ?WatchItemIndex = null;
            const autowatch_parent_dir = (comptime FeatureFlags.watch_directories) and this.isEligibleDirectory(parent_dir);
            if (autowatch_parent_dir) {
                var watchlist_slice = this.watchlist.slice();

                if (dir_fd != .zero) {
                    const fds = watchlist_slice.items(.fd);
                    if (std.mem.indexOfScalar(bun.FileDescriptor, fds, dir_fd)) |i| {
                        parent_watch_item = @as(WatchItemIndex, @truncate(i));
                    }
                }

                if (parent_watch_item == null) {
                    const hashes = watchlist_slice.items(.hash);
                    if (std.mem.indexOfScalar(HashType, hashes, parent_dir_hash)) |i| {
                        parent_watch_item = @as(WatchItemIndex, @truncate(i));
                    }
                }
            }
            this.watchlist.ensureUnusedCapacity(this.allocator, 1 + @as(usize, @intCast(@intFromBool(parent_watch_item == null)))) catch bun.outOfMemory();

            if (autowatch_parent_dir) {
                parent_watch_item = parent_watch_item orelse switch (this.appendDirectoryAssumeCapacity(dir_fd, parent_dir, parent_dir_hash, copy_file_path)) {
                    .err => |err| return .{ .err = err },
                    .result => |r| r,
                };
            }

            switch (this.appendFileAssumeCapacity(
                fd,
                file_path,
                hash,
                loader,
                parent_dir_hash,
                package_json,
                copy_file_path,
            )) {
                .err => |err| return .{ .err = err },
                .result => {},
            }

            if (comptime FeatureFlags.verbose_watcher) {
                if (strings.indexOf(file_path, this.cwd)) |i| {
                    Output.prettyln("<r><d>Added <b>./{s}<r><d> to watch list.<r>", .{file_path[i + this.cwd.len ..]});
                } else {
                    Output.prettyln("<r><d>Added <b>{s}<r><d> to watch list.<r>", .{file_path});
                }
            }

            return .{ .result = {} };
        }

        inline fn isEligibleDirectory(this: *Watcher, dir: string) bool {
            return strings.contains(dir, this.fs.top_level_dir) and !strings.contains(dir, "node_modules");
        }

        pub fn appendFile(
            this: *Watcher,
            fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            dir_fd: bun.FileDescriptor,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
        ) bun.JSC.Maybe(void) {
            return appendFileMaybeLock(this, fd, file_path, hash, loader, dir_fd, package_json, copy_file_path, true);
        }

        pub fn addDirectory(
            this: *Watcher,
            fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            comptime copy_file_path: bool,
        ) bun.JSC.Maybe(WatchItemIndex) {
            this.mutex.lock();
            defer this.mutex.unlock();

            if (this.indexOf(hash)) |idx| {
                return .{ .result = @truncate(idx) };
            }

            this.watchlist.ensureUnusedCapacity(this.allocator, 1) catch bun.outOfMemory();

            return this.appendDirectoryAssumeCapacity(fd, file_path, hash, copy_file_path);
        }

        pub fn addFile(
            this: *Watcher,
            fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            dir_fd: bun.FileDescriptor,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
        ) bun.JSC.Maybe(void) {
            // This must lock due to concurrent transpiler
            this.mutex.lock();
            defer this.mutex.unlock();

            if (this.indexOf(hash)) |index| {
                if (comptime FeatureFlags.atomic_file_watcher) {
                    // On Linux, the file descriptor might be out of date.
                    if (fd.int() > 0) {
                        var fds = this.watchlist.items(.fd);
                        fds[index] = fd;
                    }
                }
                return .{ .result = {} };
            }

            return this.appendFileMaybeLock(fd, file_path, hash, loader, dir_fd, package_json, copy_file_path, false);
        }

        pub fn indexOf(this: *Watcher, hash: HashType) ?u32 {
            for (this.watchlist.items(.hash), 0..) |other, i| {
                if (hash == other) {
                    return @as(u32, @truncate(i));
                }
            }
            return null;
        }

        pub fn remove(this: *Watcher, hash: HashType) void {
            this.mutex.lock();
            defer this.mutex.unlock();
            if (this.indexOf(hash)) |index| {
                this.removeAtIndex(@truncate(index), hash, &[_]HashType{}, .file);
            }
        }

        pub fn removeAtIndex(this: *Watcher, index: WatchItemIndex, hash: HashType, parents: []HashType, comptime kind: WatchItem.Kind) void {
            bun.assert(index != no_watch_item);

            this.evict_list[this.evict_list_i] = index;
            this.evict_list_i += 1;

            if (comptime kind == .directory) {
                for (parents) |parent| {
                    if (parent == hash) {
                        this.evict_list[this.evict_list_i] = @as(WatchItemIndex, @truncate(parent));
                        this.evict_list_i += 1;
                    }
                }
            }
        }

        pub fn getResolveWatcher(watcher: *Watcher) bun.resolver.AnyResolveWatcher {
            return bun.resolver.ResolveWatcher(*@This(), onMaybeWatchDirectory).init(watcher);
        }

        pub fn onMaybeWatchDirectory(watch: *Watcher, file_path: string, dir_fd: bun.StoredFileDescriptorType) void {
            // We don't want to watch:
            // - Directories outside the root directory
            // - Directories inside node_modules
            if (std.mem.indexOf(u8, file_path, "node_modules") == null and std.mem.indexOf(u8, file_path, watch.fs.top_level_dir) != null) {
                _ = watch.addDirectory(dir_fd, file_path, getHash(file_path), false);
            }
        }
    };
