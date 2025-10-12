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
allocator: std.mem.Allocator = undefined,

/// Store root path being monitored
root_path: []const u8 = "",

watch_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
/// nanoseconds
coalesce_interval: isize = 100_000,

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

    // Fanotify doesn't return per-path descriptors, just return 0
    return .{ .result = 0 };
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

    // Fanotify doesn't return per-path descriptors, just return 0
    return .{ .result = 0 };
}

pub fn unwatch(this: *FanotifyWatcher, _: EventListIndex) void {
    bun.assert(this.loaded);
    _ = this.watch_count.fetchSub(1, .release);
}

pub fn init(this: *FanotifyWatcher, cwd: []const u8) !void {
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
    this.root_path = cwd;
    log("{} init (fanotify)", .{this.fd});
}

/// Read a path from a file descriptor using /proc/self/fd/
fn readlinkFd(fd: i32, buffer: []u8) ![]const u8 {
    var path_buf: [64]u8 = undefined;
    const proc_path = std.fmt.bufPrint(&path_buf, "/proc/self/fd/{d}", .{fd}) catch unreachable;

    const result = std.posix.readlink(proc_path, buffer) catch |err| {
        return err;
    };

    return result;
}

pub fn stop(this: *FanotifyWatcher) void {
    log("{} stop", .{this.fd});
    if (this.fd != bun.invalid_fd) {
        this.fd.close();
        this.fd = bun.invalid_fd;
    }
}

/// Repeatedly called by the main watcher until the watcher is terminated.
pub fn watchLoopCycle(this: *bun.Watcher) bun.sys.Maybe(void) {
    defer Output.flush();

    // Read raw fanotify events
    const read_result = std.posix.system.read(
        this.platform.fd.cast(),
        this.platform.eventlist_bytes,
        this.platform.eventlist_bytes.len,
    );

    const errno = std.posix.errno(read_result);
    if (errno != .SUCCESS) {
        if (errno == .AGAIN or errno == .INTR) {
            return .success;
        }
        return .{ .err = bun.sys.Error.fromCode(errno, .read) };
    }

    const bytes_read = @as(usize, @intCast(read_result));
    if (bytes_read == 0) return .success;

    log("fanotify read {} bytes", .{bytes_read});

    // Process fanotify events and match them against watchlist
    var offset: usize = 0;
    var event_id: usize = 0;
    var path_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;

    while (offset < bytes_read) {
        const event: *align(1) const fanotify.EventMetadata = @ptrCast(this.platform.eventlist_bytes[offset..][0..@sizeOf(fanotify.EventMetadata)].ptr);

        offset += event.size();

        // Close the file descriptor and get its path
        if (event.hasValidFd()) {
            defer _ = std.posix.close(event.fd);

            // Resolve FD to path
            const event_path = readlinkFd(event.fd, &path_buffer) catch |err| {
                log("Failed to readlink fd {}: {}", .{ event.fd, err });
                continue;
            };

            log("fanotify event on path: {s} (mask=0x{x})", .{ event_path, event.mask });

            // Match this path against our watchlist
            const item_paths = this.watchlist.items(.file_path);

            for (item_paths, 0..) |watch_path, idx| {
                // Check if event path matches or is within watched path
                const is_match = brk: {
                    // Exact match
                    if (std.mem.eql(u8, event_path, watch_path)) break :brk true;

                    // Event is within watched directory
                    if (std.mem.startsWith(u8, event_path, watch_path)) {
                        // Make sure it's actually within (not just prefix match)
                        if (event_path.len > watch_path.len) {
                            const next_char = event_path[watch_path.len];
                            if (next_char == '/' or watch_path[watch_path.len - 1] == '/') {
                                break :brk true;
                            }
                        }
                    }

                    break :brk false;
                };

                if (is_match) {
                    if (event_id >= this.watch_events.len) {
                        // Process current batch
                        switch (processFanotifyEventBatch(this, event_id)) {
                            .err => |err| return .{ .err = err },
                            .result => {},
                        }
                        event_id = 0;
                    }

                    this.watch_events[event_id] = watchEventFromFanotifyEvent(event, @intCast(idx));
                    event_id += 1;
                    log("Matched event to watchlist index {}", .{idx});
                }
            }
        }
    }

    // Process any remaining events
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
    var last_event_id: WatchItemIndex = std.math.maxInt(WatchItemIndex);

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
