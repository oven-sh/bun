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

const Mutex = @import("./lock.zig").Lock;
const Futex = @import("./futex.zig");
pub const WatchItemIndex = u16;
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;

// TODO @gvilums
// This entire file is a mess - rework it to be more maintainable

const WATCHER_MAX_LIST = 8096;

pub const INotify = struct {
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
            if (comptime Environment.allow_assert) std.debug.assert(this.name_len > 0);

            // the name_len field is wrong
            // it includes alignment / padding
            // but it is a sentineled value
            // so we can just trim it to the first null byte
            return bun.sliceTo(@as([*:0]u8, @ptrFromInt(@intFromPtr(&this.name_len) + @sizeOf(u32))), 0)[0.. :0];
        }
    };

    pub fn watchPath(this: *INotify, pathname: [:0]const u8) !EventListIndex {
        std.debug.assert(this.loaded_inotify);
        const old_count = this.watch_count.fetchAdd(1, .Release);
        defer if (old_count == 0) Futex.wake(&this.watch_count, 10);
        const watch_file_mask = std.os.linux.IN.EXCL_UNLINK | std.os.linux.IN.MOVE_SELF | std.os.linux.IN.DELETE_SELF | std.os.linux.IN.MOVED_TO | std.os.linux.IN.MODIFY;
        return std.os.inotify_add_watchZ(this.inotify_fd, pathname, watch_file_mask);
    }

    pub fn watchDir(this: *INotify, pathname: [:0]const u8) !EventListIndex {
        std.debug.assert(this.loaded_inotify);
        const old_count = this.watch_count.fetchAdd(1, .Release);
        defer if (old_count == 0) Futex.wake(&this.watch_count, 10);
        const watch_dir_mask = std.os.linux.IN.EXCL_UNLINK | std.os.linux.IN.DELETE | std.os.linux.IN.DELETE_SELF | std.os.linux.IN.CREATE | std.os.linux.IN.MOVE_SELF | std.os.linux.IN.ONLYDIR | std.os.linux.IN.MOVED_TO;
        return std.os.inotify_add_watchZ(this.inotify_fd, pathname, watch_dir_mask);
    }

    pub fn unwatch(this: *INotify, wd: EventListIndex) void {
        std.debug.assert(this.loaded_inotify);
        _ = this.watch_count.fetchSub(1, .Release);
        std.os.inotify_rm_watch(this.inotify_fd, wd);
    }

    pub fn init(this: *INotify, _: std.mem.Allocator) !void {
        std.debug.assert(!this.loaded_inotify);
        this.loaded_inotify = true;

        if (bun.getenvZ("BUN_INOTIFY_COALESCE_INTERVAL")) |env| {
            this.coalesce_interval = std.fmt.parseInt(isize, env, 10) catch 100_000;
        }

        this.inotify_fd = try std.os.inotify_init1(std.os.linux.IN.CLOEXEC);
    }

    pub fn read(this: *INotify) ![]*const INotifyEvent {
        std.debug.assert(this.loaded_inotify);

        restart: while (true) {
            Futex.wait(&this.watch_count, 0, null) catch unreachable;
            const rc = std.os.system.read(
                this.inotify_fd,
                @as([*]u8, @ptrCast(@alignCast(&this.eventlist))),
                @sizeOf(EventListBuffer),
            );

            switch (std.os.errno(rc)) {
                .SUCCESS => {
                    var len = @as(usize, @intCast(rc));

                    if (len == 0) return &[_]*INotifyEvent{};

                    // IN_MODIFY is very noisy
                    // we do a 0.1ms sleep to try to coalesce events better
                    if (len < (@sizeOf(EventListBuffer) / 2)) {
                        var fds = [_]std.os.pollfd{.{
                            .fd = this.inotify_fd,
                            .events = std.os.POLL.IN | std.os.POLL.ERR,
                            .revents = 0,
                        }};
                        var timespec = std.os.timespec{ .tv_sec = 0, .tv_nsec = this.coalesce_interval };
                        if ((std.os.ppoll(&fds, &timespec, null) catch 0) > 0) {
                            while (true) {
                                const new_rc = std.os.system.read(
                                    this.inotify_fd,
                                    @as([*]u8, @ptrCast(@alignCast(&this.eventlist))) + len,
                                    @sizeOf(EventListBuffer) - len,
                                );
                                switch (std.os.errno(new_rc)) {
                                    .SUCCESS => {
                                        len += @as(usize, @intCast(new_rc));
                                    },
                                    .AGAIN => continue,
                                    .INTR => continue,
                                    .INVAL => return error.ShortRead,
                                    .BADF => return error.INotifyFailedToStart,
                                    else => unreachable,
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

                    return this.eventlist_ptrs[0..count];
                },
                .AGAIN => continue :restart,
                .INVAL => return error.ShortRead,
                .BADF => return error.INotifyFailedToStart,

                else => unreachable,
            }
        }
        unreachable;
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

    fd: i32 = 0,

    pub fn init(this: *DarwinWatcher, _: std.mem.Allocator) !void {
        this.fd = try std.os.kqueue();
        if (this.fd == 0) return error.KQueueError;
    }

    pub fn stop(this: *DarwinWatcher) void {
        if (this.fd != 0) {
            _ = bun.sys.close(this.fd);
        }
        this.fd = 0;
    }
};

pub const WindowsWatcher = struct {
    iocp: w.HANDLE = undefined,
    allocator: std.mem.Allocator = undefined,
    watchers: std.ArrayListUnmanaged(*DirWatcher) = std.ArrayListUnmanaged(*DirWatcher){},

    const w = std.os.windows;
    pub const EventListIndex = c_int;

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

    // each directory being watched has an associated DirWatcher
    const DirWatcher = struct {
        // must be initialized to zero (even though it's never read or written in our code),
        // otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
        overlapped: w.OVERLAPPED = std.mem.zeroes(w.OVERLAPPED),
        buf: [64 * 1024]u8 align(@alignOf(w.FILE_NOTIFY_INFORMATION)) = undefined,
        dirHandle: w.HANDLE,
        path: [:0]u16,
        path_buf: bun.WPathBuffer = undefined,
        refcount: usize = 1,

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

        fn fromOverlapped(overlapped: *w.OVERLAPPED) *DirWatcher {
            const offset = @offsetOf(DirWatcher, "overlapped");
            const overlapped_byteptr: [*]u8 = @ptrCast(overlapped);
            return @alignCast(@ptrCast(overlapped_byteptr - offset));
        }

        fn events(this: *DirWatcher) EventIterator {
            return EventIterator{ .watcher = this };
        }

        // invalidates any EventIterators derived from this DirWatcher
        fn prepare(this: *DirWatcher) !void {
            const filter = w.FILE_NOTIFY_CHANGE_FILE_NAME | w.FILE_NOTIFY_CHANGE_DIR_NAME | w.FILE_NOTIFY_CHANGE_LAST_WRITE | w.FILE_NOTIFY_CHANGE_CREATION;
            if (w.kernel32.ReadDirectoryChangesW(this.dirHandle, &this.buf, this.buf.len, 1, filter, null, &this.overlapped, null) == 0) {
                const err = w.kernel32.GetLastError();
                std.debug.print("failed to start watching directory: {s}\n", .{@tagName(err)});
                @panic("failed to start watching directory");
            }
        }

        fn ref(this: *DirWatcher) void {
            std.debug.assert(this.refcount > 0);
            this.refcount += 1;
        }

        fn unref(this: *DirWatcher) void {
            std.debug.assert(this.refcount > 0);
            this.refcount -= 1;
            // TODO if refcount reaches 0 we should deallocate
            // But we can't deallocate right away because we might be in the middle of iterating over the events of this watcher
            // we probably need some sort of queue that can be emptied by the watcher thread.
            if (this.refcount == 0) {
                std.debug.print("TODO: deallocate watcher\n", .{});
            }
        }
    };

    pub fn init(this: *WindowsWatcher, allocator: std.mem.Allocator) !void {
        const iocp = try w.CreateIoCompletionPort(w.INVALID_HANDLE_VALUE, null, 0, 1);
        this.* = .{
            .iocp = iocp,
            .allocator = allocator,
        };
    }

    pub fn deinit(this: *WindowsWatcher) void {
        // get all the directory watchers and close their handles
        // TODO
        // close the io completion port handle
        w.kernel32.CloseHandle(this.iocp);
    }

    fn addWatchedDirectory(this: *WindowsWatcher, dirFd: w.HANDLE, path: [:0]const u16) !*DirWatcher {
        _ = dirFd;
        std.debug.print("adding directory to watch: {s}\n", .{std.unicode.fmtUtf16le(path)});
        const path_len_bytes: u16 = @truncate(path.len * 2);
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = @constCast(path.ptr),
        };
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = null,
            // .RootDirectory = if (std.fs.path.isAbsoluteWindowsW(path))
            //     null
            // else if (dirFd == w.INVALID_HANDLE_VALUE)
            //     std.fs.cwd().fd
            // else
            //     dirFd,
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
            std.debug.print("failed to open directory for watching: {s}\n", .{@tagName(rc)});
            @panic("failed to open directory for watching");
        }

        errdefer _ = w.kernel32.CloseHandle(handle);

        // on success we receive the same iocp handle back that we put in - no need to update it
        _ = try w.CreateIoCompletionPort(handle, this.iocp, 0, 1);

        const watcher = try this.allocator.create(DirWatcher);
        errdefer this.allocator.destroy(watcher);
        watcher.* = .{ .dirHandle = handle, .path = undefined };
        // init path
        @memcpy(watcher.path_buf[0..path.len], path);
        watcher.path_buf[path.len] = 0;
        watcher.path = watcher.path_buf[0..path.len :0];

        // TODO think about the different sequences of errors
        try watcher.prepare();
        try this.watchers.append(this.allocator, watcher);

        return watcher;
    }

    pub fn watchFile(this: *WindowsWatcher, path: []const u8) !*DirWatcher {
        const dirpath = std.fs.path.dirnameWindows(path) orelse @panic("get dir from file");
        std.debug.print("path: {s}, dirpath: {s}\n", .{ path, dirpath });
        return this.watchDir(dirpath);
    }

    pub fn watchDir(this: *WindowsWatcher, path_: []const u8) !*DirWatcher {
        // strip the trailing slash if it exists
        var path = path_;
        if (path.len > 0 and bun.strings.charIsAnySlash(path[path.len - 1])) {
            path = path[0 .. path.len - 1];
        }
        var pathbuf: bun.WPathBuffer = undefined;
        const wpath = bun.strings.toNTPath(&pathbuf, path);
        // check if one of the existing watchers covers this path
        for (this.watchers.items) |watcher| {
            if (std.mem.indexOf(u16, watcher.path, wpath) == 0) {
                std.debug.print("found existing watcher\n", .{});
                watcher.ref();
                return watcher;
            }
        }
        return this.addWatchedDirectory(std.os.windows.INVALID_HANDLE_VALUE, wpath);
    }

    const Timeout = enum(w.DWORD) {
        infinite = w.INFINITE,
        minimal = 1,
        none = 0,
    };

    // get the next dirwatcher that has events
    pub fn next(this: *WindowsWatcher, timeout: Timeout) !?*DirWatcher {
        var nbytes: w.DWORD = 0;
        var key: w.ULONG_PTR = 0;
        var overlapped: ?*w.OVERLAPPED = null;
        while (true) {
            const rc = w.kernel32.GetQueuedCompletionStatus(this.iocp, &nbytes, &key, &overlapped, @intFromEnum(timeout));
            if (rc == 0) {
                const err = w.kernel32.GetLastError();
                if (err == w.Win32Error.IMEOUT) {
                    return null;
                } else {
                    @panic("GetQueuedCompletionStatus failed");
                }
            }

            // exit notification for this watcher - we should probably deallocate it here
            if (nbytes == 0) {
                continue;
            }
            if (overlapped) |ptr| {
                return DirWatcher.fromOverlapped(ptr);
            } else {
                // this would be an error which we should probaby signal
                continue;
            }
        }
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
    platform: Platform.Data = Platform.Data{},

    const Platform = struct {
        const Linux = struct {
            eventlist_index: PlatformWatcher.EventListIndex = 0,
        };
        const Windows = struct {
            dir_watcher: ?*WindowsWatcher.DirWatcher = null,
        };
        const Darwin = struct {};

        const Data = if (Environment.isMac)
            Darwin
        else if (Environment.isLinux)
            Linux
        else if (Environment.isWindows)
            Windows
        else
            @compileError("Unsupported platform");
    };

    pub const Kind = enum { file, directory };
};

pub const Watchlist = std.MultiArrayList(WatchItem);

pub fn NewWatcher(comptime ContextType: type) type {
    return struct {
        const Watcher = @This();

        watchlist: Watchlist,
        watched_count: usize = 0,
        mutex: Mutex,

        platform: PlatformWatcher = PlatformWatcher{},

        // User-facing
        watch_events: [128]WatchEvent = undefined,
        changed_filepaths: [128]?[:0]u8 = [_]?[:0]u8{null} ** 128,

        ctx: ContextType,
        fs: *bun.fs.FileSystem,
        allocator: std.mem.Allocator,
        watchloop_handle: ?std.Thread.Id = null,
        cwd: string,
        thread: std.Thread = undefined,
        running: bool = true,
        close_descriptors: bool = false,

        evict_list: [WATCHER_MAX_LIST]WatchItemIndex = undefined,
        evict_list_i: WatchItemIndex = 0,

        pub const HashType = u32;
        pub const WatchListArray = Watchlist;
        const no_watch_item: WatchItemIndex = std.math.maxInt(WatchItemIndex);

        pub fn getHash(filepath: string) HashType {
            return @as(HashType, @truncate(bun.hash(filepath)));
        }

        pub fn init(ctx: ContextType, fs: *bun.fs.FileSystem, allocator: std.mem.Allocator) !*Watcher {
            const watcher = try allocator.create(Watcher);
            errdefer allocator.destroy(watcher);

            watcher.* = Watcher{
                .fs = fs,
                .allocator = allocator,
                .watched_count = 0,
                .ctx = ctx,
                .watchlist = Watchlist{},
                .mutex = Mutex.init(),
                .cwd = fs.top_level_dir,
            };

            try PlatformWatcher.init(&watcher.platform, allocator);

            return watcher;
        }

        pub fn start(this: *Watcher) !void {
            std.debug.assert(this.watchloop_handle == null);
            this.thread = try std.Thread.spawn(.{}, Watcher.watchLoop, .{this});
        }

        pub fn deinit(this: *Watcher, close_descriptors: bool) void {
            if (this.watchloop_handle != null) {
                this.mutex.lock();
                defer this.mutex.unlock();
                this.close_descriptors = close_descriptors;
                this.running = false;
            } else {
                // if the mutex is locked, then that's now a UAF.
                this.mutex.assertUnlocked("Internal consistency error: watcher mutex is locked when it should not be.");

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
            Output.Source.configureNamedThread("File Watcher");

            defer Output.flush();
            if (FeatureFlags.verbose_watcher) Output.prettyln("Watcher started", .{});

            this._watchLoop() catch |err| {
                this.watchloop_handle = null;
                this.platform.stop();
                if (this.running) {
                    this.ctx.onError(err);
                }
            };

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
            const platform_data = slice.items(.platform);
            var last_item = no_watch_item;

            for (this.evict_list[0..this.evict_list_i]) |item| {
                // catch duplicates, since the list is sorted, duplicates will appear right after each other
                if (item == last_item) continue;

                if (Environment.isWindows) {
                    // on windows we need to deallocate the watcher instance
                    // TODO implement this
                    if (platform_data[item].dir_watcher) |watcher| {
                        watcher.unref();
                    }
                } else {
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

        fn _watchLoop(this: *Watcher) !void {
            if (Environment.isMac) {
                std.debug.assert(this.platform.fd > 0);
                const KEvent = std.c.Kevent;

                var changelist_array: [128]KEvent = std.mem.zeroes([128]KEvent);
                var changelist = &changelist_array;
                while (true) {
                    defer Output.flush();

                    var count_ = std.os.system.kevent(
                        this.platform.fd,
                        @as([*]KEvent, changelist),
                        0,
                        @as([*]KEvent, changelist),
                        128,

                        null,
                    );

                    // Give the events more time to coallesce
                    if (count_ < 128 / 2) {
                        const remain = 128 - count_;
                        var timespec = std.os.timespec{ .tv_sec = 0, .tv_nsec = 100_000 };
                        const extra = std.os.system.kevent(
                            this.platform.fd,
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
                        this.ctx.onFileUpdate(watchevents, this.changed_filepaths[0..watchevents.len], this.watchlist);
                    } else {
                        break;
                    }
                }
            } else if (Environment.isLinux) {
                restart: while (true) {
                    defer Output.flush();

                    var events = try this.platform.read();
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
                            this.ctx.onFileUpdate(all_events[0 .. last_event_index + 1], this.changed_filepaths[0 .. name_off + 1], this.watchlist);
                        } else {
                            break;
                        }
                        remaining_events -= slice.len;
                    }
                }
            } else if (Environment.isWindows) {
                restart: while (true) {
                    var buf: bun.PathBuffer = undefined;
                    var event_id: usize = 0;

                    // first wait has infinite timeout - we're waiting for the next event and don't want to spin
                    var timeout = WindowsWatcher.Timeout.infinite;
                    while (true) {
                        // std.debug.print("waiting with timeout: {s}\n", .{@tagName(timeout)});
                        const watcher = try this.platform.next(timeout) orelse break;
                        // after handling the watcher's events, it explicitly needs to start reading directory changes again
                        defer watcher.prepare() catch |err| {
                            Output.prettyErrorln("Failed to (re-)start listening to directory changes: {s}", .{@errorName(err)});
                        };

                        // after the first wait, we want to start coalescing events, so we wait for a minimal amount of time
                        timeout = WindowsWatcher.Timeout.minimal;

                        const item_paths = this.watchlist.items(.file_path);

                        std.debug.print("event from watcher: {s}\n", .{std.unicode.fmtUtf16le(watcher.path)});
                        var iter = watcher.events();
                        while (iter.next()) |event| {
                            std.debug.print("filename: {}, action: {s}\n", .{ std.unicode.fmtUtf16le(event.filename), @tagName(event.action) });
                            // convert the current event file path to utf-8
                            // skip the \??\ prefix
                            var idx = bun.simdutf.convert.utf16.to.utf8.le(watcher.path[4..], &buf);
                            buf[idx] = '\\';
                            idx += 1;
                            idx += bun.simdutf.convert.utf16.to.utf8.le(event.filename, buf[idx..]);
                            const eventpath = buf[0..idx];

                            std.debug.print("eventpath: {s}\n", .{eventpath});

                            // TODO this really needs a more sophisticated search algorithm
                            for (item_paths, 0..) |path, item_idx| {
                                std.debug.print("path: {s}\n", .{path});
                                // check if the current change applies to this item
                                // if so, add it to the eventlist
                                if (std.mem.indexOf(u8, path, eventpath) == 0) {
                                    // this.changed_filepaths[event_id] = path;
                                    this.watch_events[event_id].fromFileNotify(event, @truncate(item_idx));
                                    event_id += 1;
                                }
                            }
                        }
                    }
                    if (event_id == 0) {
                        continue :restart;
                    }

                    std.debug.print("event_id: {d}\n", .{event_id});

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

                    std.debug.print("all_events.len: {d}\n", .{all_events.len});

                    this.ctx.onFileUpdate(all_events, this.changed_filepaths[0 .. last_event_index + 1], this.watchlist);
                }
            }
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
        ) !void {
            const watchlist_id = this.watchlist.len;

            const file_path_: string = if (comptime copy_file_path)
                bun.asByteSlice(try this.allocator.dupeZ(u8, file_path))
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
                _ = std.os.system.kevent(
                    this.platform.fd,
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
                item.platform.index = try this.platform.watchPath(slice);
            } else if (comptime Environment.isWindows) {
                item.platform.dir_watcher = try this.platform.watchFile(file_path_);
            }

            this.watchlist.appendAssumeCapacity(item);
        }

        fn appendDirectoryAssumeCapacity(
            this: *Watcher,
            stored_fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            comptime copy_file_path: bool,
        ) !WatchItemIndex {
            const fd = brk: {
                if (stored_fd.int() > 0) break :brk stored_fd;
                const dir = try std.fs.cwd().openDir(file_path, .{});
                break :brk bun.toFD(dir.fd);
            };

            const parent_hash = Watcher.getHash(bun.fs.PathName.init(file_path).dirWithTrailingSlash());

            const file_path_: string = if (comptime copy_file_path)
                bun.asByteSlice(try this.allocator.dupeZ(u8, file_path))
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
                _ = std.os.system.kevent(
                    this.platform.fd,
                    @as([]KEvent, events[0..1]).ptr,
                    1,
                    @as([]KEvent, events[0..1]).ptr,
                    0,
                    null,
                );
            } else if (Environment.isLinux) {
                const file_path_to_use_ = std.mem.trimRight(u8, file_path_, "/");
                var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
                bun.copy(u8, &buf, file_path_to_use_);
                buf[file_path_to_use_.len] = 0;
                const slice: [:0]u8 = buf[0..file_path_to_use_.len :0];
                item.platform.eventlist_index = try this.platform.watchDir(slice);
            } else if (Environment.isWindows) {
                item.platform.dir_watcher = try this.platform.watchDir(file_path_);
            }

            this.watchlist.appendAssumeCapacity(item);
            return @as(WatchItemIndex, @truncate(this.watchlist.len - 1));
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
        ) !void {
            if (comptime lock) this.mutex.lock();
            defer if (comptime lock) this.mutex.unlock();
            std.debug.assert(file_path.len > 1);
            const pathname = bun.fs.PathName.init(file_path);

            const parent_dir = pathname.dirWithTrailingSlash();
            const parent_dir_hash: HashType = Watcher.getHash(parent_dir);

            var parent_watch_item: ?WatchItemIndex = null;
            const autowatch_parent_dir = (comptime FeatureFlags.watch_directories) and this.isEligibleDirectory(parent_dir);
            if (autowatch_parent_dir) {
                var watchlist_slice = this.watchlist.slice();

                if (dir_fd.int() > 0) {
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
            try this.watchlist.ensureUnusedCapacity(this.allocator, 1 + @as(usize, @intCast(@intFromBool(parent_watch_item == null))));

            if (autowatch_parent_dir) {
                parent_watch_item = parent_watch_item orelse try this.appendDirectoryAssumeCapacity(dir_fd, parent_dir, parent_dir_hash, copy_file_path);
            }

            try this.appendFileAssumeCapacity(
                fd,
                file_path,
                hash,
                loader,
                parent_dir_hash,
                package_json,
                copy_file_path,
            );

            if (comptime FeatureFlags.verbose_watcher) {
                if (strings.indexOf(file_path, this.cwd)) |i| {
                    Output.prettyln("<r><d>Added <b>./{s}<r><d> to watch list.<r>", .{file_path[i + this.cwd.len ..]});
                } else {
                    Output.prettyln("<r><d>Added <b>{s}<r><d> to watch list.<r>", .{file_path});
                }
            }
        }

        inline fn isEligibleDirectory(this: *Watcher, dir: string) bool {
            return strings.indexOf(dir, this.fs.top_level_dir) != null and strings.indexOf(dir, "node_modules") == null;
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
        ) !void {
            return appendFileMaybeLock(this, fd, file_path, hash, loader, dir_fd, package_json, copy_file_path, true);
        }

        pub fn addDirectory(
            this: *Watcher,
            fd: bun.FileDescriptor,
            file_path: string,
            hash: HashType,
            comptime copy_file_path: bool,
        ) !void {
            this.mutex.lock();
            defer this.mutex.unlock();

            if (this.indexOf(hash) != null) {
                return;
            }

            try this.watchlist.ensureUnusedCapacity(this.allocator, 1);

            _ = try this.appendDirectoryAssumeCapacity(fd, file_path, hash, copy_file_path);
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
        ) !void {
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
                return;
            }

            try this.appendFileMaybeLock(fd, file_path, hash, loader, dir_fd, package_json, copy_file_path, false);
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
                // const fds = this.watchlist.items(.fd);
                // const fd = fds[index];
                // _ = bun.sys.close(fd);
                // this.watchlist.swapRemove(index);
            }
        }

        pub fn removeAtIndex(this: *Watcher, index: WatchItemIndex, hash: HashType, parents: []HashType, comptime kind: WatchItem.Kind) void {
            std.debug.assert(index != no_watch_item);

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
    };
}
