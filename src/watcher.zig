const Fs = @import("./fs.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const options = @import("./options.zig");
const IndexType = @import("./allocators.zig").IndexType;

const os = std.os;
const KEvent = std.os.Kevent;

const Mutex = @import("./lock.zig").Lock;
const WatchItemIndex = u16;
const NoWatchItem: WatchItemIndex = std.math.maxInt(WatchItemIndex);
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;

pub const WatchItem = struct {
    file_path: string,
    // filepath hash for quick comparison
    hash: u32,
    eventlist_index: u32,
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

    pub fn fromKEvent(this: *WatchEvent, kevent: *const KEvent) void {
        this.op.delete = (kevent.fflags & std.os.NOTE_DELETE) > 0;
        this.op.metadata = (kevent.fflags & std.os.NOTE_ATTRIB) > 0;
        this.op.rename = (kevent.fflags & std.os.NOTE_RENAME) > 0;
        this.op.write = (kevent.fflags & std.os.NOTE_WRITE) > 0;
        this.index = @truncate(WatchItemIndex, kevent.udata);
    }

    pub const Op = packed struct {
        delete: bool = false,
        metadata: bool = false,
        rename: bool = false,
        write: bool = false,
    };
};

pub const Watchlist = std.MultiArrayList(WatchItem);

// This implementation only works on macOS, for now.
// The Internet seems to suggest basically always using FSEvents instead of kqueue
// It seems like the main concern is max open file descriptors
// Since we adjust the ulimit already, I think we can avoid that.
pub fn NewWatcher(comptime ContextType: type) type {
    return struct {
        const Watcher = @This();

        const KEventArrayList = std.ArrayList(KEvent);
        const WATCHER_MAX_LIST = 8096;

        watchlist: Watchlist,
        watched_count: usize = 0,
        mutex: Mutex,

        // Internal
        changelist: [128]KEvent = undefined,

        // User-facing
        watch_events: [128]WatchEvent = undefined,

        // Everything being watched
        eventlist: [WATCHER_MAX_LIST]KEvent = undefined,
        eventlist_used: usize = 0,

        fs: *Fs.FileSystem,
        // this is what kqueue knows about
        fd: StoredFileDescriptorType,
        ctx: ContextType,
        allocator: *std.mem.Allocator,
        watchloop_handle: ?std.Thread.Id = null,
        cwd: string,

        pub const HashType = u32;

        var evict_list: [WATCHER_MAX_LIST]WatchItemIndex = undefined;

        pub fn getHash(filepath: string) HashType {
            return @truncate(HashType, std.hash.Wyhash.hash(0, filepath));
        }

        pub fn init(ctx: ContextType, fs: *Fs.FileSystem, allocator: *std.mem.Allocator) !*Watcher {
            var watcher = try allocator.create(Watcher);
            watcher.* = Watcher{
                .fs = fs,
                .fd = 0,
                .allocator = allocator,
                .watched_count = 0,
                .ctx = ctx,
                .watchlist = Watchlist{},
                .mutex = Mutex.init(),
                .cwd = fs.top_level_dir,
            };

            return watcher;
        }

        pub fn getQueue(this: *Watcher) !StoredFileDescriptorType {
            if (this.fd == 0) {
                this.fd = try os.kqueue();
                if (this.fd == 0) {
                    return error.WatcherFailed;
                }
            }

            return this.fd;
        }

        pub fn start(this: *Watcher) !void {
            _ = try this.getQueue();
            std.debug.assert(this.watchloop_handle == null);
            var thread = try std.Thread.spawn(.{}, Watcher.watchLoop, .{this});
            thread.setName("File Watcher") catch {};
        }

        // This must only be called from the watcher thread
        pub fn watchLoop(this: *Watcher) !void {
            this.watchloop_handle = std.Thread.getCurrentId();
            var stdout = std.io.getStdOut();
            var stderr = std.io.getStdErr();
            var output_source = Output.Source.init(stdout, stderr);
            Output.Source.set(&output_source);

            defer Output.flush();
            if (FeatureFlags.verbose_watcher) Output.prettyln("Watcher started", .{});

            this._watchLoop() catch |err| {
                Output.prettyErrorln("<r>Watcher crashed: <red><b>{s}<r>", .{@errorName(err)});

                this.watchloop_handle = null;
                std.os.close(this.fd);
                this.fd = 0;
                return;
            };
        }

        var evict_list_i: WatchItemIndex = 0;
        pub fn removeAtIndex(this: *Watcher, index: WatchItemIndex, hash: HashType, parents: []HashType, comptime kind: WatchItem.Kind) void {
            std.debug.assert(index != NoWatchItem);

            evict_list[evict_list_i] = index;
            evict_list_i += 1;

            if (comptime kind == .directory) {
                for (parents) |parent, i| {
                    if (parent == hash) {
                        evict_list[evict_list_i] = @truncate(WatchItemIndex, parent);
                        evict_list_i += 1;
                    }
                }
            }
        }

        pub fn flushEvictions(this: *Watcher) void {
            if (evict_list_i == 0) return;
            this.mutex.lock();
            defer this.mutex.unlock();
            defer evict_list_i = 0;

            // swapRemove messes up the order
            // But, it only messes up the order if any elements in the list appear after the item being removed
            // So if we just sort the list by the biggest index first, that should be fine
            std.sort.sort(
                WatchItemIndex,
                evict_list[0..evict_list_i],
                {},
                comptime std.sort.desc(WatchItemIndex),
            );

            var slice = this.watchlist.slice();
            var fds = slice.items(.fd);
            var last_item = NoWatchItem;

            for (evict_list[0..evict_list_i]) |item, i| {
                // catch duplicates, since the list is sorted, duplicates will appear right after each other
                if (item == last_item) continue;
                // close the file descriptors here. this should automatically remove it from being watched too.
                std.os.close(fds[item]);
                last_item = item;
            }

            last_item = NoWatchItem;
            // This is split into two passes because reading the slice while modified is potentially unsafe.
            for (evict_list[0..evict_list_i]) |item, i| {
                if (item == last_item) continue;
                this.watchlist.swapRemove(item);
                last_item = item;
            }
        }

        fn _watchLoop(this: *Watcher) !void {
            const time = std.time;

            std.debug.assert(this.fd > 0);

            var changelist_array: [1]KEvent = std.mem.zeroes([1]KEvent);
            var changelist = &changelist_array;
            while (true) {
                defer Output.flush();
                var code = std.os.system.kevent(
                    try this.getQueue(),
                    @as([*]KEvent, changelist),
                    0,
                    @as([*]KEvent, changelist),
                    1,

                    null,
                );

                var watchevents = this.watch_events[0..1];
                for (changelist) |event, i| {
                    watchevents[i].fromKEvent(&event);
                }

                this.ctx.onFileUpdate(watchevents, this.watchlist);
            }
        }

        pub fn indexOf(this: *Watcher, hash: HashType) ?usize {
            for (this.watchlist.items(.hash)) |other, i| {
                if (hash == other) {
                    return i;
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
            if (this.indexOf(hash) != null) {
                return;
            }

            try this.appendFile(fd, file_path, hash, loader, dir_fd, package_json, copy_file_path);
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
            const index = this.eventlist_used;
            const watchlist_id = this.watchlist.len;

            if (isMac) {

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
                var event = std.mem.zeroes(KEvent);

                event.flags = os.EV_ADD | os.EV_CLEAR | os.EV_ENABLE;
                // we want to know about the vnode
                event.filter = std.os.EVFILT_VNODE;

                // monitor:
                // - Write
                // - Rename

                // we should monitor:
                // - Delete
                event.fflags = std.os.NOTE_WRITE | std.os.NOTE_RENAME | std.os.NOTE_DELETE;

                // id
                event.ident = @intCast(usize, fd);

                this.eventlist_used += 1;

                // Store the hash for fast filtering later
                event.udata = @intCast(usize, watchlist_id);
                this.eventlist[index] = event;

                // This took a lot of work to figure out the right permutation
                // Basically:
                // - We register the event here.
                // our while(true) loop above receives notification of changes to any of the events created here.
                _ = std.os.system.kevent(
                    try this.getQueue(),
                    this.eventlist[index .. index + 1].ptr,
                    1,
                    this.eventlist[index .. index + 1].ptr,
                    0,
                    null,
                );
            }

            this.watchlist.appendAssumeCapacity(.{
                .file_path = if (copy_file_path) try this.allocator.dupe(u8, file_path) else file_path,
                .fd = fd,
                .hash = hash,
                .count = 0,
                .eventlist_index = @truncate(u32, index),
                .loader = loader,
                .parent_hash = parent_hash,
                .package_json = package_json,
                .kind = .file,
            });
        }

        fn appendDirectoryAssumeCapacity(
            this: *Watcher,
            fd_: StoredFileDescriptorType,
            file_path: string,
            hash: HashType,
            comptime copy_file_path: bool,
        ) !WatchItemIndex {
            const fd = brk: {
                if (fd_ > 0) break :brk fd_;

                const dir = try std.fs.openDirAbsolute(file_path, .{ .iterate = true });
                break :brk @truncate(StoredFileDescriptorType, dir.fd);
            };

            const parent_hash = Watcher.getHash(Fs.PathName.init(file_path).dirWithTrailingSlash());
            const index = this.eventlist_used;
            const watchlist_id = this.watchlist.len;

            // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html
            var event = std.mem.zeroes(KEvent);

            event.flags = os.EV_ADD | os.EV_CLEAR | os.EV_ENABLE;
            // we want to know about the vnode
            event.filter = std.os.EVFILT_VNODE;

            // monitor:
            // - Write
            // - Rename
            // - Delete
            event.fflags = std.os.NOTE_WRITE | std.os.NOTE_RENAME | std.os.NOTE_DELETE;

            // id
            event.ident = @intCast(usize, fd);

            this.eventlist_used += 1;
            // Store the hash for fast filtering later
            event.udata = @intCast(usize, watchlist_id);
            this.eventlist[index] = event;

            // This took a lot of work to figure out the right permutation
            // Basically:
            // - We register the event here.
            // our while(true) loop above receives notification of changes to any of the events created here.
            _ = std.os.system.kevent(
                try this.getQueue(),
                this.eventlist[index .. index + 1].ptr,
                1,
                this.eventlist[index .. index + 1].ptr,
                0,
                null,
            );

            this.watchlist.appendAssumeCapacity(.{
                .file_path = if (copy_file_path) try this.allocator.dupe(u8, file_path) else file_path,
                .fd = fd,
                .hash = hash,
                .count = 0,
                .eventlist_index = @truncate(u32, index),
                .loader = options.Loader.file,
                .parent_hash = parent_hash,
                .kind = .directory,
                .package_json = null,
            });
            return @truncate(WatchItemIndex, this.watchlist.len - 1);
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
            if (this.indexOf(hash) != null) {
                return;
            }

            this.mutex.lock();
            defer this.mutex.unlock();

            try this.watchlist.ensureUnusedCapacity(this.allocator, 1);

            _ = try this.appendDirectoryAssumeCapacity(fd, file_path, hash, copy_file_path);
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
            this.mutex.lock();
            defer this.mutex.unlock();
            std.debug.assert(file_path.len > 1);
            const pathname = Fs.PathName.init(file_path);

            const parent_dir = pathname.dirWithTrailingSlash();
            var parent_dir_hash: HashType = Watcher.getHash(parent_dir);

            var parent_watch_item: ?WatchItemIndex = null;
            const autowatch_parent_dir = (comptime FeatureFlags.watch_directories) and this.isEligibleDirectory(parent_dir);
            if (autowatch_parent_dir) {
                var watchlist_slice = this.watchlist.slice();

                if (dir_fd > 0) {
                    var fds = watchlist_slice.items(.fd);
                    if (std.mem.indexOfScalar(StoredFileDescriptorType, fds, dir_fd)) |i| {
                        parent_watch_item = @truncate(WatchItemIndex, i);
                    }
                }

                if (parent_watch_item == null) {
                    const hashes = watchlist_slice.items(.hash);
                    if (std.mem.indexOfScalar(HashType, hashes, parent_dir_hash)) |i| {
                        parent_watch_item = @truncate(WatchItemIndex, i);
                    }
                }
            }
            try this.watchlist.ensureUnusedCapacity(this.allocator, 1 + @intCast(usize, @boolToInt(parent_watch_item == null)));

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
    };
}
