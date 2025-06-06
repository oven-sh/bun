//! Bun's cross-platform filesystem watcher. Runs on its own thread.
const Watcher = @This();
const DebugLogScope = bun.Output.Scoped(.watcher, false);
const log = DebugLogScope.log;

// This will always be [max_count]WatchEvent,
// We avoid statically allocating because it increases the binary size.
watch_events: []WatchEvent = &.{},
changed_filepaths: [max_count]?[:0]u8,

/// The platform-specific implementation of the watcher
platform: Platform,

watchlist: WatchList,
watched_count: usize,
mutex: Mutex,

fs: *bun.fs.FileSystem,
allocator: std.mem.Allocator,
watchloop_handle: ?std.Thread.Id = null,
cwd: string,
thread: std.Thread = undefined,
running: bool = true,
close_descriptors: bool = false,

evict_list: [max_eviction_count]WatchItemIndex = undefined,
evict_list_i: WatchItemIndex = 0,

ctx: *anyopaque,
onFileUpdate: *const fn (this: *anyopaque, events: []WatchEvent, changed_files: []?[:0]u8, watchlist: WatchList) void,
onError: *const fn (this: *anyopaque, err: bun.sys.Error) void,

thread_lock: bun.DebugThreadLock = bun.DebugThreadLock.unlocked,

pub const max_count = 128;
pub const requires_file_descriptors = switch (Environment.os) {
    .mac => true,
    else => false,
};

pub const Event = WatchEvent;
pub const Item = WatchItem;
pub const ItemList = WatchList;
pub const WatchList = std.MultiArrayList(WatchItem);
pub const HashType = u32;
const no_watch_item: WatchItemIndex = std.math.maxInt(WatchItemIndex);

/// Initializes a watcher. Each watcher is tied to some context type, which
/// receives watch callbacks on the watcher thread. This function does not
/// actually start the watcher thread.
///
///     const watcher = try Watcher.init(T, instance_of_t, fs, bun.default_allocator)
///     errdefer watcher.deinit(false);
///     try watcher.start();
///
/// To integrate a started watcher into module resolution:
///
///     transpiler.resolver.watcher = watcher.getResolveWatcher();
///
/// To integrate a started watcher into bundle_v2:
///
///     bundle_v2.bun_watcher = watcher;
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
    watcher.* = .{
        .fs = fs,
        .allocator = allocator,
        .watched_count = 0,
        .watchlist = WatchList{},
        .mutex = .{},
        .cwd = fs.top_level_dir,
        .ctx = ctx,
        .onFileUpdate = &wrapped.onFileUpdateWrapped,
        .onError = &wrapped.onErrorWrapped,
        .platform = .{},
        .watch_events = try allocator.alloc(WatchEvent, max_count),
        .changed_filepaths = [_]?[:0]u8{null} ** max_count,
    };

    try Platform.init(&watcher.platform, fs.top_level_dir);

    return watcher;
}

pub fn start(this: *Watcher) !void {
    bun.assert(this.watchloop_handle == null);
    this.thread = try std.Thread.spawn(.{}, threadMain, .{this});
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
                fd.close();
            }
        }
        this.watchlist.deinit(this.allocator);
        const allocator = this.allocator;
        allocator.destroy(this);
    }
}

pub fn getHash(filepath: string) HashType {
    return @as(HashType, @truncate(bun.hash(filepath)));
}

pub const WatchItemIndex = u16;
pub const max_eviction_count = 8096;
const WindowsWatcher = @import("./watcher/WindowsWatcher.zig");
// TODO: some platform-specific behavior is implemented in
// this file instead of the platform-specific file.
// ideally, the constants above can be inlined
const Platform = switch (Environment.os) {
    .linux => @import("./watcher/INotifyWatcher.zig"),
    .mac => @import("./watcher/KEventWatcher.zig"),
    .windows => WindowsWatcher,
    else => @compileError("Unsupported platform"),
};

pub const WatchEvent = struct {
    index: WatchItemIndex,
    op: Op,
    name_off: u8 = 0,
    name_len: u8 = 0,

    pub fn names(this: WatchEvent, buf: []?[:0]u8) []?[:0]u8 {
        if (this.name_len == 0) return &[_]?[:0]u8{};
        return buf[this.name_off..][0..this.name_len];
    }

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

    pub const Op = packed struct(u8) {
        delete: bool = false,
        metadata: bool = false,
        rename: bool = false,
        write: bool = false,
        move_to: bool = false,
        _padding: u3 = 0,

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
                if (comptime std.mem.eql(u8, name, "_padding")) continue;
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
    eventlist_index: if (Environment.isLinux) Platform.EventListIndex else u0 = 0,

    pub const Kind = enum { file, directory };
};

fn threadMain(this: *Watcher) !void {
    this.watchloop_handle = std.Thread.getCurrentId();
    this.thread_lock.lock();
    Output.Source.configureNamedThread("File Watcher");

    defer Output.flush();
    log("Watcher started", .{});

    switch (this.watchLoop()) {
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
            fd.close();
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
    std.sort.insertion(
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
            // we don't need to call inotify_rm_watch on linux because it gets removed when the file descriptor is closed
            if (fds[item].isValid()) {
                fds[item].close();
            }
        }
        last_item = item;
    }

    last_item = no_watch_item;
    // This is split into two passes because reading the slice while modified is potentially unsafe.
    for (this.evict_list[0..this.evict_list_i]) |item| {
        if (item == last_item or this.watchlist.len <= item) continue;
        this.watchlist.swapRemove(item);
        last_item = item;
    }
}

fn watchLoop(this: *Watcher) bun.JSC.Maybe(void) {
    while (this.running) {
        // individual platform implementation will call onFileUpdate
        switch (Platform.watchLoopCycle(this)) {
            .err => |err| return .{ .err = err },
            .result => |iter| iter,
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

        event.flags = std.c.EV.ADD | std.c.EV.CLEAR | std.c.EV.ENABLE;
        // we want to know about the vnode
        event.filter = std.c.EVFILT.VNODE;

        event.fflags = std.c.NOTE.WRITE | std.c.NOTE.RENAME | std.c.NOTE.DELETE;

        // id
        event.ident = @intCast(fd.native());

        // Store the hash for fast filtering later
        event.udata = @as(usize, @intCast(watchlist_id));
        var events: [1]KEvent = .{event};

        // This took a lot of work to figure out the right permutation
        // Basically:
        // - We register the event here.
        // our while(true) loop above receives notification of changes to any of the events created here.
        _ = std.posix.system.kevent(
            this.platform.fd.unwrap().?.native(),
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
        if (stored_fd.isValid()) break :brk stored_fd;
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

        event.flags = std.c.EV.ADD | std.c.EV.CLEAR | std.c.EV.ENABLE;
        // we want to know about the vnode
        event.filter = std.c.EVFILT.VNODE;

        // monitor:
        // - Write
        // - Rename
        // - Delete
        event.fflags = std.c.NOTE.WRITE | std.c.NOTE.RENAME | std.c.NOTE.DELETE;

        // id
        event.ident = @intCast(fd.native());

        // Store the hash for fast filtering later
        event.udata = @as(usize, @intCast(watchlist_id));
        var events: [1]KEvent = .{event};

        // This took a lot of work to figure out the right permutation
        // Basically:
        // - We register the event here.
        // our while(true) loop above receives notification of changes to any of the events created here.
        _ = std.posix.system.kevent(
            this.platform.fd.unwrap().?.native(),
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

        if (dir_fd.isValid()) {
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

    if (DebugLogScope.isVisible()) {
        const cwd_len_with_slash = if (this.cwd[this.cwd.len - 1] == '/') this.cwd.len else this.cwd.len + 1;
        log("<d>Added <b>{s}<r><d> to watch list.<r>", .{
            if (file_path.len > cwd_len_with_slash and bun.strings.startsWith(file_path, this.cwd))
                file_path[cwd_len_with_slash..]
            else
                file_path,
        });
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
            if (fd.isValid()) {
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

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const FeatureFlags = bun.FeatureFlags;
const options = @import("./options.zig");
const Mutex = bun.Mutex;
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
