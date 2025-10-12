//! Bun's filesystem watcher implementation for linux using fanotify
//! https://man7.org/linux/man-pages/man7/fanotify.7.html
//!
//! Fanotify provides filesystem-wide monitoring with recursive capabilities.
//! Note: fanotify requires appropriate permissions (CAP_SYS_ADMIN or similar)

const FanotifyWatcher = @This();

const log = Output.scoped(.watcher, .visible);
const fanotify = bun.sys.fanotify;

// fanotify events are variable-sized, so a byte buffer is used
const eventlist_bytes_size = 4096 * 32; // 128KB buffer for events
const EventListBytes = [eventlist_bytes_size]u8;

fd: bun.FileDescriptor = bun.invalid_fd,
loaded: bool = false,

// Avoid statically allocating because it increases the binary size.
eventlist_bytes: *EventListBytes = undefined,
/// pointers into the next chunk of events
eventlist_ptrs: [max_count]*align(1) const fanotify.EventMetadata = undefined,
/// if defined, it means `read` should continue from this offset before asking
/// for more bytes. this is only hit under high watching load.
read_ptr: ?struct {
    i: u32,
    len: u32,
} = null,

/// Store watched paths and their event list indices
/// Maps path hash to eventlist_index for quick lookups
watched_paths: std.AutoHashMapUnmanaged(u32, PathWatchInfo) = .{},
allocator: std.mem.Allocator = undefined,

watch_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
/// nanoseconds
coalesce_interval: isize = 100_000,

const PathWatchInfo = struct {
    path: [:0]const u8,
    index: EventListIndex,
    is_dir: bool,
};

pub const EventListIndex = i32;
pub const Event = fanotify.EventMetadata;

pub fn watchPath(this: *FanotifyWatcher, pathname: [:0]const u8) bun.sys.Maybe(EventListIndex) {
    bun.assert(this.loaded);
    const old_count = this.watch_count.fetchAdd(1, .release);
    defer if (old_count == 0) Futex.wake(&this.watch_count, 10);

    // For files, we watch for modifications and deletions
    const mask = fanotify.EventMask{
        .modify = true,
        .close_write = true,
        .delete_self = true,
        .move_self = true,
        .event_on_child = true,
    };

    switch (fanotify.mark(this.fd, .add, mask, bun.invalid_fd, pathname)) {
        .err => |err| {
            log("fanotify_mark({}, file, {s}) failed: {}", .{ this.fd, pathname, err });
            return .{ .err = err };
        },
        .result => {},
    }

    log("fanotify_mark({}, file, {s}) = success", .{ this.fd, pathname });

    // Store the path info for later lookup
    // fanotify doesn't return a unique descriptor per path, so we generate one
    const index: EventListIndex = @intCast(this.watched_paths.count());
    const hash = @as(u32, @truncate(bun.hash(pathname)));

    const path_copy = this.allocator.dupeZ(u8, pathname) catch return .{
        .err = bun.sys.Error.fromCode(.NOMEM, .watch),
    };

    this.watched_paths.put(this.allocator, hash, .{
        .path = path_copy,
        .index = index,
        .is_dir = false,
    }) catch {
        this.allocator.free(path_copy);
        return .{ .err = bun.sys.Error.fromCode(.NOMEM, .watch) };
    };

    return .{ .result = index };
}

pub fn watchDir(this: *FanotifyWatcher, pathname: [:0]const u8) bun.sys.Maybe(EventListIndex) {
    bun.assert(this.loaded);
    const old_count = this.watch_count.fetchAdd(1, .release);
    defer if (old_count == 0) Futex.wake(&this.watch_count, 10);

    // For directories, we watch for creates, deletes, and modifications
    // event_on_child makes this apply recursively to all children
    const mask = fanotify.EventMask{
        .create = true,
        .delete = true,
        .delete_self = true,
        .move_self = true,
        .moved_from = true,
        .moved_to = true,
        .modify = true,
        .close_write = true,
        .ondir = true,
        .event_on_child = true,
    };

    switch (fanotify.mark(this.fd, .add, mask, bun.invalid_fd, pathname)) {
        .err => |err| {
            log("fanotify_mark({}, dir, {s}) failed: {}", .{ this.fd, pathname, err });
            return .{ .err = err };
        },
        .result => {},
    }

    log("fanotify_mark({}, dir, {s}) = success", .{ this.fd, pathname });

    // Store the path info for later lookup
    const index: EventListIndex = @intCast(this.watched_paths.count());
    const hash = @as(u32, @truncate(bun.hash(pathname)));

    const path_copy = this.allocator.dupeZ(u8, pathname) catch return .{
        .err = bun.sys.Error.fromCode(.NOMEM, .watch),
    };

    this.watched_paths.put(this.allocator, hash, .{
        .path = path_copy,
        .index = index,
        .is_dir = true,
    }) catch {
        this.allocator.free(path_copy);
        return .{ .err = bun.sys.Error.fromCode(.NOMEM, .watch) };
    };

    return .{ .result = index };
}

pub fn unwatch(this: *FanotifyWatcher, _: EventListIndex) void {
    bun.assert(this.loaded);
    _ = this.watch_count.fetchSub(1, .release);

    // With fanotify, we can't easily unwatch individual paths
    // since we're monitoring the entire filesystem
    // This would need to be implemented with path tracking
}

pub fn init(this: *FanotifyWatcher, _: []const u8) !void {
    bun.assert(!this.loaded);
    this.loaded = true;

    if (bun.getenvZ("BUN_FANOTIFY_COALESCE_INTERVAL")) |env| {
        this.coalesce_interval = std.fmt.parseInt(isize, env, 10) catch 100_000;
    }

    // Initialize fanotify with notification class
    const init_flags = fanotify.InitFlags{
        .cloexec = true,
        .nonblock = false,
    };
    const event_flags = fanotify.EventFlags{
        .rdonly = true,
        .largefile = true,
        .cloexec = true,
    };

    switch (fanotify.init(init_flags, event_flags)) {
        .err => |err| {
            log("fanotify_init failed: {}", .{err});
            // Return Unexpected to match the error set that callers expect
            return error.Unexpected;
        },
        .result => |fd| this.fd = fd,
    }

    this.allocator = bun.default_allocator;
    this.eventlist_bytes = try bun.default_allocator.create(EventListBytes);
    log("{} init (fanotify)", .{this.fd});
}

pub fn read(this: *FanotifyWatcher) bun.sys.Maybe([]const *align(1) const Event) {
    bun.assert(this.loaded);

    var i: u32 = 0;
    const read_eventlist_bytes = if (this.read_ptr) |ptr| brk: {
        Futex.waitForever(&this.watch_count, 0);
        i = ptr.i;
        break :brk this.eventlist_bytes[0..ptr.len];
    } else outer: while (true) {
        Futex.waitForever(&this.watch_count, 0);

        const rc = std.posix.system.read(
            this.fd.cast(),
            this.eventlist_bytes,
            this.eventlist_bytes.len,
        );
        const errno = std.posix.errno(rc);
        switch (errno) {
            .SUCCESS => {
                var read_eventlist_bytes = this.eventlist_bytes[0..@intCast(rc)];
                log("{} read {} bytes", .{ this.fd, read_eventlist_bytes.len });
                if (read_eventlist_bytes.len == 0) return .{ .result = &.{} };

                // Try to coalesce events
                const double_read_threshold = @sizeOf(Event) * (max_count / 2);
                if (read_eventlist_bytes.len < double_read_threshold) {
                    var fds = [_]std.posix.pollfd{.{
                        .fd = this.fd.cast(),
                        .events = std.posix.POLL.IN | std.posix.POLL.ERR,
                        .revents = 0,
                    }};
                    var timespec = std.posix.timespec{ .sec = 0, .nsec = this.coalesce_interval };
                    if ((std.posix.ppoll(&fds, &timespec, null) catch 0) > 0) {
                        inner: while (true) {
                            const rest = this.eventlist_bytes[read_eventlist_bytes.len..];
                            bun.assert(rest.len > 0);
                            const new_rc = std.posix.system.read(this.fd.cast(), rest.ptr, rest.len);
                            const e = std.posix.errno(new_rc);
                            switch (e) {
                                .SUCCESS => {
                                    read_eventlist_bytes.len += @intCast(new_rc);
                                    break :outer read_eventlist_bytes;
                                },
                                .AGAIN, .INTR => continue :inner,
                                else => return .{ .err = bun.sys.Error.fromCode(e, .read) },
                            }
                        }
                    }
                }

                break :outer read_eventlist_bytes;
            },
            .AGAIN, .INTR => continue :outer,
            else => return .{ .err = bun.sys.Error.fromCode(errno, .read) },
        }
    };

    var count: u32 = 0;
    while (i < read_eventlist_bytes.len) {
        // fanotify events are aligned
        const event: *align(1) const Event = @ptrCast(read_eventlist_bytes[i..][0..@sizeOf(Event)].ptr);

        // Close the file descriptor that fanotify provides (we don't need it)
        if (event.hasValidFd()) {
            _ = std.posix.close(event.fd);
        }

        this.eventlist_ptrs[count] = event;
        i += event.size();
        count += 1;

        if (Environment.enable_logs) {
            log("{} read event fd={} mask={x} pid={}", .{
                this.fd,
                event.fd,
                event.mask,
                event.pid,
            });
        }

        // when under high load, we may need to buffer events
        if (count == max_count) {
            this.read_ptr = .{
                .i = i,
                .len = @intCast(read_eventlist_bytes.len),
            };
            log("{} read buffer filled up", .{this.fd});
            return .{ .result = &this.eventlist_ptrs };
        }
    }

    this.read_ptr = null;
    return .{ .result = this.eventlist_ptrs[0..count] };
}

pub fn stop(this: *FanotifyWatcher) void {
    log("{} stop", .{this.fd});
    if (this.fd != bun.invalid_fd) {
        this.fd.close();
        this.fd = bun.invalid_fd;
    }

    // Clean up watched_paths
    var iter = this.watched_paths.iterator();
    while (iter.next()) |entry| {
        this.allocator.free(entry.value_ptr.path);
    }
    this.watched_paths.deinit(this.allocator);
}

/// Repeatedly called by the main watcher until the watcher is terminated.
pub fn watchLoopCycle(this: *bun.Watcher) bun.sys.Maybe(void) {
    defer Output.flush();

    const events = switch (this.platform.read()) {
        .result => |result| result,
        .err => |err| return .{ .err = err },
    };
    if (events.len == 0) return .success;

    var event_id: usize = 0;

    // Process events
    // With fanotify, we get events for all monitored paths
    // We need to match them against our watchlist
    for (events) |event| {
        // Check if we're about to exceed the watch_events array capacity
        if (event_id >= this.watch_events.len) {
            // Process current batch of events
            switch (processFanotifyEventBatch(this, event_id)) {
                .err => |err| return .{ .err = err },
                .result => {},
            }
            // Reset event_id to start a new batch
            event_id = 0;
        }

        // Convert fanotify event to watch event
        // For now, we'll match all watched items since fanotify provides
        // filesystem-wide monitoring
        const item_paths = this.watchlist.items(.file_path);
        for (item_paths, 0..) |_, idx| {
            this.watch_events[event_id] = watchEventFromFanotifyEvent(
                event,
                @intCast(idx),
            );
            event_id += 1;

            if (event_id >= this.watch_events.len) {
                switch (processFanotifyEventBatch(this, event_id)) {
                    .err => |err| return .{ .err = err },
                    .result => {},
                }
                event_id = 0;
            }
        }
    }

    // Process any remaining events in the final batch
    if (event_id > 0) {
        switch (processFanotifyEventBatch(this, event_id)) {
            .err => |err| return .{ .err = err },
            .result => {},
        }
    }

    return .success;
}

fn processFanotifyEventBatch(this: *bun.Watcher, event_count: usize) bun.sys.Maybe(void) {
    if (event_count == 0) {
        return .success;
    }

    var all_events = this.watch_events[0..event_count];
    std.sort.pdq(WatchEvent, all_events, {}, WatchEvent.sortByIndex);

    var last_event_index: usize = 0;
    var last_event_id: EventListIndex = std.math.maxInt(EventListIndex);

    for (all_events, 0..) |_, i| {
        if (all_events[i].index == last_event_id) {
            all_events[last_event_index].merge(all_events[i]);
            continue;
        }
        last_event_index = i;
        last_event_id = all_events[i].index;
    }
    if (all_events.len == 0) return .success;

    this.mutex.lock();
    defer this.mutex.unlock();
    if (this.running) {
        // all_events.len == 0 is checked above, so last_event_index + 1 is safe
        this.onFileUpdate(this.ctx, all_events[0 .. last_event_index + 1], this.changed_filepaths[0..0], this.watchlist);
    }

    return .success;
}

pub fn watchEventFromFanotifyEvent(event: *align(1) const Event, index: WatchItemIndex) WatchEvent {
    const mask = event.mask;
    const FAN_DELETE = 0x00000200;
    const FAN_DELETE_SELF = 0x00000400;
    const FAN_MOVE_SELF = 0x00000800;
    const FAN_MOVED_TO = 0x00000080;
    const FAN_MODIFY = 0x00000002;
    const FAN_CLOSE_WRITE = 0x00000008;

    return .{
        .op = .{
            .delete = (mask & FAN_DELETE_SELF) > 0 or (mask & FAN_DELETE) > 0,
            .rename = (mask & FAN_MOVE_SELF) > 0,
            .move_to = (mask & FAN_MOVED_TO) > 0,
            .write = (mask & FAN_MODIFY) > 0 or (mask & FAN_CLOSE_WRITE) > 0,
        },
        .index = index,
    };
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Futex = bun.Futex;
const Output = bun.Output;

const WatchEvent = bun.Watcher.Event;
const WatchItemIndex = bun.Watcher.WatchItemIndex;
const max_count = bun.Watcher.max_count;
