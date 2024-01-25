const Fs = @import("./fs.zig");
const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;
const default_allocator = bun.default_allocator;
const C = bun.C;
const c = std.c;
const options = @import("./options.zig");
const IndexType = @import("./allocators.zig").IndexType;

const os = std.os;

const Mutex = @import("./lock.zig").Lock;
const Futex = @import("./futex.zig");
pub const WatchItemIndex = u16;
const NoWatchItem: WatchItemIndex = std.math.maxInt(WatchItemIndex);
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;

const WATCHER_MAX_LIST = 8096;

pub const INotify = struct {
    pub const IN_CLOEXEC = std.os.O.CLOEXEC;
    pub const IN_NONBLOCK = std.os.O.NONBLOCK;

    pub const IN_ACCESS = 0x00000001;
    pub const IN_MODIFY = 0x00000002;
    pub const IN_ATTRIB = 0x00000004;
    pub const IN_CLOSE_WRITE = 0x00000008;
    pub const IN_CLOSE_NOWRITE = 0x00000010;
    pub const IN_CLOSE = IN_CLOSE_WRITE | IN_CLOSE_NOWRITE;
    pub const IN_OPEN = 0x00000020;
    pub const IN_MOVED_FROM = 0x00000040;
    pub const IN_MOVED_TO = 0x00000080;
    pub const IN_MOVE = IN_MOVED_FROM | IN_MOVED_TO;
    pub const IN_CREATE = 0x00000100;
    pub const IN_DELETE = 0x00000200;
    pub const IN_DELETE_SELF = 0x00000400;
    pub const IN_MOVE_SELF = 0x00000800;
    pub const IN_ALL_EVENTS = 0x00000fff;

    pub const IN_UNMOUNT = 0x00002000;
    pub const IN_Q_OVERFLOW = 0x00004000;
    pub const IN_IGNORED = 0x00008000;

    pub const IN_ONLYDIR = 0x01000000;
    pub const IN_DONT_FOLLOW = 0x02000000;
    pub const IN_EXCL_UNLINK = 0x04000000;
    pub const IN_MASK_ADD = 0x20000000;

    pub const IN_ISDIR = 0x40000000;
    pub const IN_ONESHOT = 0x80000000;

    pub const EventListIndex = c_int;

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
    pub var inotify_fd: EventListIndex = 0;
    pub var loaded_inotify = false;

    const EventListBuffer = [@sizeOf([128]INotifyEvent) + (128 * bun.MAX_PATH_BYTES + (128 * @alignOf(INotifyEvent)))]u8;
    var eventlist: EventListBuffer = undefined;
    var eventlist_ptrs: [128]*const INotifyEvent = undefined;

    var watch_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

    const watch_file_mask = std.os.linux.IN.EXCL_UNLINK | std.os.linux.IN.MOVE_SELF | std.os.linux.IN.DELETE_SELF | std.os.linux.IN.MOVED_TO | std.os.linux.IN.MODIFY;
    const watch_dir_mask = std.os.linux.IN.EXCL_UNLINK | std.os.linux.IN.DELETE | std.os.linux.IN.DELETE_SELF | std.os.linux.IN.CREATE | std.os.linux.IN.MOVE_SELF | std.os.linux.IN.ONLYDIR | std.os.linux.IN.MOVED_TO;

    pub fn watchPath(pathname: [:0]const u8) !EventListIndex {
        std.debug.assert(loaded_inotify);
        const old_count = watch_count.fetchAdd(1, .Release);
        defer if (old_count == 0) Futex.wake(&watch_count, 10);
        return std.os.inotify_add_watchZ(inotify_fd, pathname, watch_file_mask);
    }

    pub fn watchDir(pathname: [:0]const u8) !EventListIndex {
        std.debug.assert(loaded_inotify);
        const old_count = watch_count.fetchAdd(1, .Release);
        defer if (old_count == 0) Futex.wake(&watch_count, 10);
        return std.os.inotify_add_watchZ(inotify_fd, pathname, watch_dir_mask);
    }

    pub fn unwatch(wd: EventListIndex) void {
        std.debug.assert(loaded_inotify);
        _ = watch_count.fetchSub(1, .Release);
        std.os.inotify_rm_watch(inotify_fd, wd);
    }

    pub fn isRunning() bool {
        return loaded_inotify;
    }

    var coalesce_interval: isize = 100_000;
    pub fn init() !void {
        std.debug.assert(!loaded_inotify);
        loaded_inotify = true;

        if (bun.getenvZ("BUN_INOTIFY_COALESCE_INTERVAL")) |env| {
            coalesce_interval = std.fmt.parseInt(isize, env, 10) catch 100_000;
        }

        inotify_fd = try std.os.inotify_init1(IN_CLOEXEC);
    }

    pub fn read() ![]*const INotifyEvent {
        std.debug.assert(loaded_inotify);

        restart: while (true) {
            Futex.wait(&watch_count, 0, null) catch unreachable;
            const rc = std.os.system.read(
                inotify_fd,
                @as([*]u8, @ptrCast(@alignCast(&eventlist))),
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
                            .fd = inotify_fd,
                            .events = std.os.POLL.IN | std.os.POLL.ERR,
                            .revents = 0,
                        }};
                        var timespec = std.os.timespec{ .tv_sec = 0, .tv_nsec = coalesce_interval };
                        if ((std.os.ppoll(&fds, &timespec, null) catch 0) > 0) {
                            while (true) {
                                const new_rc = std.os.system.read(
                                    inotify_fd,
                                    @as([*]u8, @ptrCast(@alignCast(&eventlist))) + len,
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
                        const event = @as(*INotifyEvent, @ptrCast(@alignCast(eventlist[i..][0..@sizeOf(INotifyEvent)])));
                        i += event.name_len;

                        eventlist_ptrs[count] = event;
                        count += 1;
                    }

                    return eventlist_ptrs[0..count];
                },
                .AGAIN => continue :restart,
                .INVAL => return error.ShortRead,
                .BADF => return error.INotifyFailedToStart,

                else => unreachable,
            }
        }
        unreachable;
    }

    pub fn stop() void {
        if (inotify_fd != 0) {
            _ = bun.sys.close(bun.toFD(inotify_fd));
            inotify_fd = 0;
        }
    }
};

const DarwinWatcher = struct {
    pub const EventListIndex = u32;

    const KEvent = std.c.Kevent;
    // Internal
    pub var changelist: [128]KEvent = undefined;

    // Everything being watched
    pub var eventlist: [WATCHER_MAX_LIST]KEvent = undefined;
    pub var eventlist_index: EventListIndex = 0;

    pub var fd: i32 = 0;

    pub fn init() !void {
        std.debug.assert(fd == 0);

        fd = try std.os.kqueue();
        if (fd == 0) return error.KQueueError;
    }

    pub fn isRunning() bool {
        return fd != 0;
    }

    pub fn stop() void {
        if (fd != 0) {
            _ = bun.sys.close(fd);
        }

        fd = 0;
    }
};

pub const Placeholder = struct {
    pub const EventListIndex = u32;

    pub var eventlist: [WATCHER_MAX_LIST]EventListIndex = undefined;
    pub var eventlist_index: EventListIndex = 0;

    pub fn isRunning() bool {
        return true;
    }

    pub fn init() !void {}
};

const PlatformWatcher = if (Environment.isMac)
    DarwinWatcher
else if (Environment.isLinux)
    INotify
else
    Placeholder;

pub const WatchItem = struct {
    file_path: string,
    // filepath hash for quick comparison
    hash: u32,
    eventlist_index: PlatformWatcher.EventListIndex,
    loader: options.Loader,
    fd: StoredFileDescriptorType,
    count: u32,
    parent_hash: u32,
    kind: Kind,
    package_json: ?*PackageJSON,

    pub const Kind = enum { file, directory };
};

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
                .delete = (event.mask & INotify.IN_DELETE_SELF) > 0 or (event.mask & INotify.IN_DELETE) > 0,
                .metadata = false,
                .rename = (event.mask & INotify.IN_MOVE_SELF) > 0,
                .move_to = (event.mask & INotify.IN_MOVED_TO) > 0,
                .write = (event.mask & INotify.IN_MODIFY) > 0,
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
        changed_filepaths: [128]?[:0]u8 = std.mem.zeroes([128]?[:0]u8),

        fs: *Fs.FileSystem,
        // this is what kqueue knows about
        fd: StoredFileDescriptorType,
        ctx: ContextType,
        allocator: std.mem.Allocator,
        watchloop_handle: ?std.Thread.Id = null,
        cwd: string,
        thread: std.Thread = undefined,
        running: bool = true,
        close_descriptors: bool = false,

        pub const HashType = u32;
        pub const WatchListArray = Watchlist;

        var evict_list: [WATCHER_MAX_LIST]WatchItemIndex = undefined;

        pub fn getHash(filepath: string) HashType {
            return @as(HashType, @truncate(bun.hash(filepath)));
        }

        pub fn init(ctx: ContextType, fs: *Fs.FileSystem, allocator: std.mem.Allocator) !*Watcher {
            const watcher = try allocator.create(Watcher);
            errdefer allocator.destroy(watcher);

            if (!PlatformWatcher.isRunning()) {
                try PlatformWatcher.init();
            }

            watcher.* = Watcher{
                .fs = fs,
                .fd = .zero,
                .allocator = allocator,
                .watched_count = 0,
                .ctx = ctx,
                .watchlist = Watchlist{},
                .mutex = Mutex.init(),
                .cwd = fs.top_level_dir,
            };

            return watcher;
        }

        pub fn start(this: *Watcher) !void {
            if (!Environment.isWindows) {
                std.debug.assert(this.watchloop_handle == null);
                this.thread = try std.Thread.spawn(.{}, Watcher.watchLoop, .{this});
            }
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
            if (Environment.isWindows) {
                @compileError("watchLoop should not be used on Windows");
            }

            this.watchloop_handle = std.Thread.getCurrentId();
            Output.Source.configureNamedThread("File Watcher");

            defer Output.flush();
            if (FeatureFlags.verbose_watcher) Output.prettyln("Watcher started", .{});

            this._watchLoop() catch |err| {
                this.watchloop_handle = null;
                PlatformWatcher.stop();
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

        pub fn remove(this: *Watcher, hash: HashType) void {
            this.mutex.lock();
            defer this.mutex.unlock();
            if (this.indexOf(hash)) |index| {
                const fds = this.watchlist.items(.fd);
                const fd = fds[index];
                _ = bun.sys.close(fd);
                this.watchlist.swapRemove(index);
            }
        }

        var evict_list_i: WatchItemIndex = 0;

        pub fn removeAtIndex(_: *Watcher, index: WatchItemIndex, hash: HashType, parents: []HashType, comptime kind: WatchItem.Kind) void {
            std.debug.assert(index != NoWatchItem);

            evict_list[evict_list_i] = index;
            evict_list_i += 1;

            if (comptime kind == .directory) {
                for (parents) |parent| {
                    if (parent == hash) {
                        evict_list[evict_list_i] = @as(WatchItemIndex, @truncate(parent));
                        evict_list_i += 1;
                    }
                }
            }
        }

        pub fn flushEvictions(this: *Watcher) void {
            if (evict_list_i == 0) return;
            defer evict_list_i = 0;

            // swapRemove messes up the order
            // But, it only messes up the order if any elements in the list appear after the item being removed
            // So if we just sort the list by the biggest index first, that should be fine
            std.sort.pdq(
                WatchItemIndex,
                evict_list[0..evict_list_i],
                {},
                comptime std.sort.desc(WatchItemIndex),
            );

            var slice = this.watchlist.slice();
            const fds = slice.items(.fd);
            var last_item = NoWatchItem;

            for (evict_list[0..evict_list_i]) |item| {
                // catch duplicates, since the list is sorted, duplicates will appear right after each other
                if (item == last_item) continue;

                // close the file descriptors here. this should automatically remove it from being watched too.
                _ = bun.sys.close(fds[item]);

                // if (Environment.isLinux) {
                //     INotify.unwatch(event_list_ids[item]);
                // }

                last_item = item;
            }

            last_item = NoWatchItem;
            // This is split into two passes because reading the slice while modified is potentially unsafe.
            for (evict_list[0..evict_list_i]) |item| {
                if (item == last_item) continue;
                this.watchlist.swapRemove(item);
                last_item = item;
            }
        }

        fn _watchLoop(this: *Watcher) !void {
            if (Environment.isMac) {
                std.debug.assert(DarwinWatcher.fd > 0);
                const KEvent = std.c.Kevent;

                var changelist_array: [128]KEvent = std.mem.zeroes([128]KEvent);
                var changelist = &changelist_array;
                while (true) {
                    defer Output.flush();

                    var count_ = std.os.system.kevent(
                        DarwinWatcher.fd,
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
                            DarwinWatcher.fd,
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

                    var events = try INotify.read();
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
                @compileError("watchLoop should not be used on Windows");
            }
        }

        pub fn indexOf(this: *Watcher, hash: HashType) ?u32 {
            for (this.watchlist.items(.hash), 0..) |other, i| {
                if (hash == other) {
                    return @as(u32, @truncate(i));
                }
            }
            return null;
        }

        pub fn addFile(
            this: *Watcher,
            fd: StoredFileDescriptorType,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            dir_fd: StoredFileDescriptorType,
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

        fn appendFileAssumeCapacity(
            this: *Watcher,
            fd: StoredFileDescriptorType,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            parent_hash: HashType,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
        ) !void {
            var index: PlatformWatcher.EventListIndex = std.math.maxInt(PlatformWatcher.EventListIndex);
            const watchlist_id = this.watchlist.len;

            const file_path_: string = if (comptime copy_file_path)
                bun.asByteSlice(try this.allocator.dupeZ(u8, file_path))
            else
                file_path;

            if (comptime Environment.isMac) {
                const KEvent = std.c.Kevent;

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
                var event = std.mem.zeroes(KEvent);

                event.flags = c.EV_ADD | c.EV_CLEAR | c.EV_ENABLE;
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
                    DarwinWatcher.fd,
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
                index = try INotify.watchPath(slice);
            }

            this.watchlist.appendAssumeCapacity(.{
                .file_path = file_path_,
                .fd = fd,
                .hash = hash,
                .count = 0,
                .eventlist_index = index,
                .loader = loader,
                .parent_hash = parent_hash,
                .package_json = package_json,
                .kind = .file,
            });
        }

        fn appendDirectoryAssumeCapacity(
            this: *Watcher,
            stored_fd: StoredFileDescriptorType,
            file_path: string,
            hash: HashType,
            comptime copy_file_path: bool,
        ) !WatchItemIndex {
            const fd = brk: {
                if (stored_fd.int() > 0) break :brk stored_fd;
                const dir = try std.fs.cwd().openDir(file_path, .{});
                break :brk bun.toFD(dir.fd);
            };

            const parent_hash = Watcher.getHash(Fs.PathName.init(file_path).dirWithTrailingSlash());
            var index: PlatformWatcher.EventListIndex = std.math.maxInt(PlatformWatcher.EventListIndex);

            const file_path_: string = if (comptime copy_file_path)
                bun.asByteSlice(try this.allocator.dupeZ(u8, file_path))
            else
                file_path;

            const watchlist_id = this.watchlist.len;

            if (Environment.isMac) {
                const KEvent = std.c.Kevent;

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
                var event = std.mem.zeroes(KEvent);

                event.flags = c.EV_ADD | c.EV_CLEAR | c.EV_ENABLE;
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
                    DarwinWatcher.fd,
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
                index = try INotify.watchDir(slice);
            }

            this.watchlist.appendAssumeCapacity(.{
                .file_path = file_path_,
                .fd = fd,
                .hash = hash,
                .count = 0,
                .eventlist_index = index,
                .loader = options.Loader.file,
                .parent_hash = parent_hash,
                .kind = .directory,
                .package_json = null,
            });
            return @as(WatchItemIndex, @truncate(this.watchlist.len - 1));
        }

        pub inline fn isEligibleDirectory(this: *Watcher, dir: string) bool {
            return strings.indexOf(dir, this.fs.top_level_dir) != null and strings.indexOf(dir, "node_modules") == null;
        }

        pub fn addDirectory(
            this: *Watcher,
            fd: StoredFileDescriptorType,
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

        pub fn appendFileMaybeLock(
            this: *Watcher,
            fd: StoredFileDescriptorType,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            dir_fd: StoredFileDescriptorType,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
            comptime lock: bool,
        ) !void {
            if (comptime lock) this.mutex.lock();
            defer if (comptime lock) this.mutex.unlock();
            std.debug.assert(file_path.len > 1);
            const pathname = Fs.PathName.init(file_path);

            const parent_dir = pathname.dirWithTrailingSlash();
            const parent_dir_hash: HashType = Watcher.getHash(parent_dir);

            var parent_watch_item: ?WatchItemIndex = null;
            const autowatch_parent_dir = (comptime FeatureFlags.watch_directories) and this.isEligibleDirectory(parent_dir);
            if (autowatch_parent_dir) {
                var watchlist_slice = this.watchlist.slice();

                if (dir_fd.int() > 0) {
                    const fds = watchlist_slice.items(.fd);
                    if (std.mem.indexOfScalar(StoredFileDescriptorType, fds, dir_fd)) |i| {
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

        pub fn appendFile(
            this: *Watcher,
            fd: StoredFileDescriptorType,
            file_path: string,
            hash: HashType,
            loader: options.Loader,
            dir_fd: StoredFileDescriptorType,
            package_json: ?*PackageJSON,
            comptime copy_file_path: bool,
        ) !void {
            return appendFileMaybeLock(this, fd, file_path, hash, loader, dir_fd, package_json, copy_file_path, true);
        }
    };
}
