const Fs = @import("./fs.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const options = @import("./options.zig");
const IndexType = @import("./allocators.zig").IndexType;

const os = std.os;
const KEvent = std.os.Kevent;

const Mutex = @import("./lock.zig").Lock;
const ParentWatchItemIndex = u31;
pub const WatchItem = struct {
    file_path: string,
    // filepath hash for quick comparison
    hash: u32,
    eventlist_index: u32,
    loader: options.Loader,
    fd: StoredFileDescriptorType,
    count: u32,
    parent_watch_item: ?ParentWatchItemIndex,
    kind: Kind,

    pub const Kind = enum { file, directory };
};

pub const WatchEvent = struct {
    index: u32,
    op: Op,

    pub fn fromKEvent(this: *WatchEvent, kevent: *const KEvent) void {
        this.op.delete = (kevent.fflags & std.os.NOTE_DELETE) > 0;
        this.op.metadata = (kevent.fflags & std.os.NOTE_ATTRIB) > 0;
        this.op.rename = (kevent.fflags & std.os.NOTE_RENAME) > 0;
        this.op.write = (kevent.fflags & std.os.NOTE_WRITE) > 0;
        this.index = @truncate(u32, kevent.udata);
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

        watchlist: Watchlist,
        watched_count: usize = 0,
        mutex: Mutex,

        // Internal
        changelist: [128]KEvent = undefined,

        // User-facing
        watch_events: [128]WatchEvent = undefined,

        // Everything being watched
        eventlist: [8096]KEvent = undefined,
        eventlist_used: usize = 0,

        fs: *Fs.FileSystem,
        // this is what kqueue knows about
        fd: StoredFileDescriptorType,
        ctx: ContextType,
        allocator: *std.mem.Allocator,
        watchloop_handle: ?std.Thread.Id = null,
        cwd: string,

        pub const HashType = u32;

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
            _ = try std.Thread.spawn(.{}, Watcher.watchLoop, .{this});
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

        fn _watchLoop(this: *Watcher) !void {
            const time = std.time;

            // poll at 1 second intervals if it hasn't received any events.
            // var timeout_spec = null;
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

        pub fn indexOf(this: *Watcher, hash: u32) ?usize {
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
            hash: u32,
            loader: options.Loader,
            dir_fd: StoredFileDescriptorType,
            comptime copy_file_path: bool,
        ) !void {
            if (this.indexOf(hash) != null) {
                return;
            }

            try this.appendFile(fd, file_path, hash, loader, dir_fd, copy_file_path);
        }

        fn appendFileAssumeCapacity(
            this: *Watcher,
            fd: StoredFileDescriptorType,
            file_path: string,
            hash: u32,
            loader: options.Loader,
            parent_watch_item: ?ParentWatchItemIndex,
            comptime copy_file_path: bool,
        ) !void {
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
            event.fflags = std.os.NOTE_WRITE | std.os.NOTE_RENAME;

            // id
            event.ident = @intCast(usize, fd);

            const index = this.eventlist_used;
            this.eventlist_used += 1;
            const watchlist_id = this.watchlist.len;
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
                .loader = loader,
                .parent_watch_item = parent_watch_item,
                .kind = .file,
            });
        }

        fn appendDirectoryAssumeCapacity(
            this: *Watcher,
            fd_: StoredFileDescriptorType,
            file_path: string,
            hash: u32,
            comptime copy_file_path: bool,
        ) !ParentWatchItemIndex {
            const fd = brk: {
                if (fd_ > 0) break :brk fd_;

                const dir = try std.fs.openDirAbsolute(file_path, .{ .iterate = true });
                break :brk @truncate(StoredFileDescriptorType, dir.fd);
            };

            // It's not a big deal if we can't watch the parent directory
            // For now at least.
            const parent_watch_item: ?ParentWatchItemIndex = brk: {
                if (!this.isEligibleDirectory(file_path)) break :brk null;

                const parent_dir = Fs.PathName.init(file_path).dirWithTrailingSlash();
                const hashes = this.watchlist.items(.hash);
                break :brk @truncate(ParentWatchItemIndex, std.mem.indexOfScalar(HashType, hashes, Watcher.getHash(parent_dir)) orelse break :brk null);
            };

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
            event.fflags = std.os.NOTE_WRITE | std.os.NOTE_RENAME;

            // id
            event.ident = @intCast(usize, fd);

            const index = this.eventlist_used;
            this.eventlist_used += 1;
            const watchlist_id = this.watchlist.len;
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
                .parent_watch_item = parent_watch_item,
                .kind = .directory,
            });
            return @truncate(ParentWatchItemIndex, this.watchlist.len - 1);
        }

        pub fn isEligibleDirectory(this: *Watcher, dir: string) bool {
            return strings.indexOf(this.fs.top_level_dir, dir) != null;
        }

        pub fn addDirectory(
            this: *Watcher,
            fd: StoredFileDescriptorType,
            file_path: string,
            hash: u32,
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
            hash: u32,
            loader: options.Loader,
            dir_fd: StoredFileDescriptorType,
            comptime copy_file_path: bool,
        ) !void {
            this.mutex.lock();
            defer this.mutex.unlock();
            std.debug.assert(file_path.len > 1);
            const pathname = Fs.PathName.init(file_path);

            const parent_dir = pathname.dirWithTrailingSlash();
            var parent_dir_hash: ?u32 = undefined;
            var watchlist_slice = this.watchlist.slice();

            var parent_watch_item: ?ParentWatchItemIndex = null;
            const autowatch_parent_dir = (comptime FeatureFlags.watch_directories) and this.isEligibleDirectory(parent_dir);
            if (autowatch_parent_dir) {
                if (dir_fd > 0) {
                    var fds = watchlist_slice.items(.fd);
                    if (std.mem.indexOfScalar(StoredFileDescriptorType, fds, dir_fd)) |i| {
                        parent_watch_item = @truncate(ParentWatchItemIndex, i);
                    }
                }

                if (parent_watch_item == null) {
                    const hashes = watchlist_slice.items(.hash);
                    parent_dir_hash = Watcher.getHash(parent_dir);
                    if (std.mem.indexOfScalar(HashType, hashes, parent_dir_hash.?)) |i| {
                        parent_watch_item = @truncate(ParentWatchItemIndex, i);
                    }
                }
            }
            try this.watchlist.ensureUnusedCapacity(this.allocator, 1 + @intCast(usize, @boolToInt(parent_watch_item == null)));

            if (autowatch_parent_dir) {
                parent_watch_item = parent_watch_item orelse try this.appendDirectoryAssumeCapacity(dir_fd, parent_dir, parent_dir_hash orelse Watcher.getHash(parent_dir), copy_file_path);
            }

            try this.appendFileAssumeCapacity(
                fd,
                file_path,
                hash,
                loader,
                parent_watch_item,
                copy_file_path,
            );

            if (FeatureFlags.verbose_watcher) {
                if (!autowatch_parent_dir or parent_watch_item == null) {
                    if (strings.indexOf(file_path, this.cwd)) |i| {
                        Output.prettyln("<r><d>Added <b>./{s}<r><d> to watch list.<r>", .{file_path[i + this.cwd.len ..]});
                    } else {
                        Output.prettyln("<r><d>Added <b>{s}<r><d> to watch list.<r>", .{file_path});
                    }
                } else {
                    if (strings.indexOf(file_path, this.cwd)) |i| {
                        Output.prettyln("<r><d>Added <b>./{s}<r><d> to watch list (and parent dir).<r>", .{
                            file_path[i + this.cwd.len ..],
                        });
                    } else {
                        Output.prettyln("<r><d>Added <b>{s}<r><d> to watch list (and parent dir).<r>", .{file_path});
                    }
                }
            }
        }
    };
}
