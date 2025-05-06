//! Bun's filesystem watcher implementation for linux using inotify
//! https://man7.org/linux/man-pages/man7/inotify.7.html
const INotifyWatcher = @This();
const log = Output.scoped(.watcher, false);

// inotify events are variable-sized, so a byte buffer is used (also needed
// since communication is done via the `read` syscall). what is notable about
// this is that while a max_count is defined, more events than max_count can be
// read if the paths are short. the buffer is sized not to the maximum possible,
// but an arbitrary but reasonable size. when reading, the strategy is to read
// as much as possible, then process the buffer in `max_count` chunks, since
// `bun.Watcher` has the same hardcoded `max_count`.
const max_count = bun.Watcher.max_count;
const eventlist_bytes_size = (Event.largest_size / 2) * max_count;
const EventListBytes = [eventlist_bytes_size]u8;
fd: bun.FileDescriptor = bun.invalid_fd,
loaded: bool = false,

// Avoid statically allocating because it increases the binary size.
eventlist_bytes: *EventListBytes align(@alignOf(Event)) = undefined,
/// pointers into the next chunk of events
eventlist_ptrs: [max_count]*align(1) Event = undefined,
/// if defined, it means `read` should continue from this offset before asking
/// for more bytes. this is only hit under high watching load.
/// see `test-fs-watch-recursive-linux-parallel-remove.js`
read_ptr: ?struct {
    i: u32,
    len: u32,
} = null,

watch_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
/// nanoseconds
coalesce_interval: isize = 100_000,

pub const EventListIndex = c_int;
pub const Event = extern struct {
    watch_descriptor: EventListIndex,
    mask: u32,
    cookie: u32,
    /// The name field is present only when an event is returned for a
    /// file inside a watched directory; it identifies the filename
    /// within the watched directory.  This filename is null-terminated,
    /// and may include further null bytes ('\0') to align subsequent
    /// reads to a suitable address boundary.
    ///
    /// The len field counts all of the bytes in name, including the null
    /// bytes; the length of each inotify_event structure is thus
    /// sizeof(struct inotify_event)+len.
    name_len: u32,

    const largest_size = std.mem.alignForward(usize, @sizeOf(Event) + bun.MAX_PATH_BYTES, @alignOf(Event));

    pub fn name(event: *align(1) Event) [:0]u8 {
        if (comptime Environment.allow_assert) bun.assert(event.name_len > 0);
        const name_first_char_ptr = std.mem.asBytes(&event.name_len).ptr + @sizeOf(u32);
        return bun.sliceTo(@as([*:0]u8, @ptrCast(name_first_char_ptr)), 0);
    }

    pub fn size(event: *align(1) Event) u32 {
        return @intCast(@sizeOf(Event) + event.name_len);
    }
};

pub fn watchPath(this: *INotifyWatcher, pathname: [:0]const u8) bun.JSC.Maybe(EventListIndex) {
    bun.assert(this.loaded);
    const old_count = this.watch_count.fetchAdd(1, .release);
    defer if (old_count == 0) Futex.wake(&this.watch_count, 10);
    const watch_file_mask = IN.EXCL_UNLINK | IN.MOVE_SELF | IN.DELETE_SELF | IN.MOVED_TO | IN.MODIFY;
    const rc = system.inotify_add_watch(this.fd.cast(), pathname, watch_file_mask);
    log("inotify_add_watch({}) = {}", .{ this.fd, rc });
    return bun.JSC.Maybe(EventListIndex).errnoSysP(rc, .watch, pathname) orelse
        .{ .result = rc };
}

pub fn watchDir(this: *INotifyWatcher, pathname: [:0]const u8) bun.JSC.Maybe(EventListIndex) {
    bun.assert(this.loaded);
    const old_count = this.watch_count.fetchAdd(1, .release);
    defer if (old_count == 0) Futex.wake(&this.watch_count, 10);
    const watch_dir_mask = IN.EXCL_UNLINK | IN.DELETE | IN.DELETE_SELF | IN.CREATE | IN.MOVE_SELF | IN.ONLYDIR | IN.MOVED_TO;
    const rc = system.inotify_add_watch(this.fd.cast(), pathname, watch_dir_mask);
    log("inotify_add_watch({}) = {}", .{ this.fd, rc });
    return bun.JSC.Maybe(EventListIndex).errnoSysP(rc, .watch, pathname) orelse
        .{ .result = rc };
}

pub fn unwatch(this: *INotifyWatcher, wd: EventListIndex) void {
    bun.assert(this.loaded);
    _ = this.watch_count.fetchSub(1, .release);
    _ = system.inotify_rm_watch(this.fd, wd);
}

pub fn init(this: *INotifyWatcher, _: []const u8) !void {
    bun.assert(!this.loaded);
    this.loaded = true;

    if (bun.getenvZ("BUN_INOTIFY_COALESCE_INTERVAL")) |env| {
        this.coalesce_interval = std.fmt.parseInt(isize, env, 10) catch 100_000;
    }

    // TODO: convert to bun.sys.Error
    this.fd = .fromNative(try std.posix.inotify_init1(IN.CLOEXEC));
    this.eventlist_bytes = &(try bun.default_allocator.alignedAlloc(EventListBytes, @alignOf(Event), 1))[0];
    log("{} init", .{this.fd});
}

pub fn read(this: *INotifyWatcher) bun.JSC.Maybe([]const *align(1) Event) {
    bun.assert(this.loaded);
    // This is what replit does as of Jaunary 2023.
    // 1) CREATE .http.ts.3491171321~
    // 2) OPEN .http.ts.3491171321~
    // 3) ATTRIB .http.ts.3491171321~
    // 4) MODIFY .http.ts.3491171321~
    // 5) CLOSE_WRITE,CLOSE .http.ts.3491171321~
    // 6) MOVED_FROM .http.ts.3491171321~
    // 7) MOVED_TO http.ts
    // We still don't correctly handle MOVED_FROM && MOVED_TO it seems.
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

                // IN_MODIFY is very noisy
                // we do a 0.1ms sleep to try to coalesce events better
                const double_read_threshold = Event.largest_size * (max_count / 2);
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
                            // Output.warn("wapa {} {} = {}", .{ this.fd, rest.len, new_rc });
                            const e = std.posix.errno(new_rc);
                            switch (e) {
                                .SUCCESS => {
                                    read_eventlist_bytes.len += @intCast(new_rc);
                                    break :outer read_eventlist_bytes;
                                },
                                .AGAIN, .INTR => continue :inner,
                                else => return .{ .err = .{
                                    .errno = @truncate(@intFromEnum(e)),
                                    .syscall = .read,
                                } },
                            }
                        }
                    }
                }

                break :outer read_eventlist_bytes;
            },
            .AGAIN, .INTR => continue :outer,
            .INVAL => {
                if (Environment.isDebug) {
                    bun.Output.err("EINVAL", "inotify read({}, {d})", .{ this.fd, this.eventlist_bytes.len });
                }
                return .{ .err = .{
                    .errno = @truncate(@intFromEnum(errno)),
                    .syscall = .read,
                } };
            },
            else => return .{ .err = .{
                .errno = @truncate(@intFromEnum(errno)),
                .syscall = .read,
            } },
        }
    };

    var count: u32 = 0;
    while (i < read_eventlist_bytes.len) {
        // It is NOT aligned naturally. It is align 1!!!
        const event: *align(1) Event = @ptrCast(read_eventlist_bytes[i..][0..@sizeOf(Event)].ptr);
        this.eventlist_ptrs[count] = event;
        i += event.size();
        count += 1;
        if (Environment.enable_logs and event.name_len > 0)
            log("{} read event {} {} {} {}", .{
                this.fd,
                event.watch_descriptor,
                event.cookie,
                event.mask,
                bun.fmt.quote(event.name()),
            });

        // when under high load with short file paths, it is very easy to
        // overrun the watcher's event buffer.
        if (count == max_count) {
            this.read_ptr = .{
                .i = i,
                .len = @intCast(read_eventlist_bytes.len),
            };
            log("{} read buffer filled up", .{this.fd});
            return .{ .result = &this.eventlist_ptrs };
        }
    }

    return .{ .result = this.eventlist_ptrs[0..count] };
}

pub fn stop(this: *INotifyWatcher) void {
    log("{} stop", .{this.fd});
    if (this.fd != bun.invalid_fd) {
        this.fd.close();
        this.fd = bun.invalid_fd;
    }
}

/// Repeatedly called by the main watcher until the watcher is terminated.
pub fn watchLoopCycle(this: *bun.Watcher) bun.JSC.Maybe(void) {
    defer Output.flush();

    // Get events from the platform
    const events: []const *align(1) Event = switch (this.platform.read()) {
        .result => |result| result,
        .err => |err| return .{ .err = err },
    };
    if (events.len == 0) return .{ .result = {} };

    // Setup stack fallback allocators for better performance
    var valid_events_stack_buf = std.heap.stackFallback(@sizeOf(WatchEvent) * 129, bun.default_allocator);
    var valid_events = std.ArrayList(WatchEvent).init(valid_events_stack_buf.get());
    defer valid_events.deinit();

    // Create a fixed-size buffer for temporary paths
    var temp_path_slices: [128]?[:0]u8 = undefined;
    var temp_path_count: u8 = 0;

    const eventlist_index = this.watchlist.items(.eventlist_index);

    // Process each event individually, with careful bounds checking
    for (events) |event| {
        const watch_idx = std.mem.indexOfScalar(EventListIndex, eventlist_index, event.watch_descriptor) orelse continue;

        // Skip invalid indices
        if (watch_idx >= this.watchlist.len) continue;

        // Create the event safely
        const watch_event = watchEventFromInotifyEvent(event, @intCast(watch_idx));

        // Store path information
        var path_idx: ?u8 = null;
        if (event.name_len > 0 and temp_path_count < temp_path_slices.len) {
            temp_path_slices[temp_path_count] = event.name();
            path_idx = temp_path_count;
            temp_path_count += 1;
        }

        // Add event to our list
        var final_event = watch_event;
        if (path_idx) |idx| {
            final_event.name_len = 1;
            final_event.name_off = idx;
        }

        valid_events.append(final_event) catch continue;
    }

    // Skip processing if no valid events
    if (valid_events.items.len == 0) return .{ .result = {} };

    // Sort events stably by index
    std.sort.insertion(WatchEvent, valid_events.items, {}, WatchEvent.sortByIndex);

    // Setup stack fallback for unique events
    var unique_events_stack_buf = std.heap.stackFallback(@sizeOf(WatchEvent) * 129, bun.default_allocator);
    var unique_events = std.ArrayList(WatchEvent).init(unique_events_stack_buf.get());
    defer unique_events.deinit();

    // Merge events with the same index
    var current_idx: ?WatchItemIndex = null;
    var current_event: ?WatchEvent = null;

    for (valid_events.items) |event| {
        if (current_idx != null and current_idx.? == event.index) {
            // Merge with current event
            var merged = current_event.?;
            merged.merge(event);
            current_event = merged;
        } else {
            // Add previous event and start new one
            if (current_event != null) {
                unique_events.append(current_event.?) catch {};
            }
            current_idx = event.index;
            current_event = event;
        }
    }

    // Add the last event
    if (current_event != null) {
        unique_events.append(current_event.?) catch {};
    }

    // Now that we have our final set of unique events, copy paths to the standard location
    var name_off: u8 = 0;

    for (unique_events.items) |*event| {
        if (event.name_len > 0 and event.name_off < temp_path_count) {
            // Copy path to the final location
            this.changed_filepaths[name_off] = temp_path_slices[event.name_off];

            // Update event to point to the new location
            event.name_off = name_off;

            // Move to next path slot
            name_off += 1;
        }
    }

    // Process events safely
    this.mutex.lock();
    defer this.mutex.unlock();

    if (this.running) {
        this.onFileUpdate(this.ctx, unique_events.items, this.changed_filepaths[0..name_off], this.watchlist);
    }

    return .{ .result = {} };
}

pub fn watchEventFromInotifyEvent(event: *align(1) const INotifyWatcher.Event, index: WatchItemIndex) WatchEvent {
    return .{
        .op = .{
            .delete = (event.mask & IN.DELETE_SELF) > 0 or (event.mask & IN.DELETE) > 0,
            .rename = (event.mask & IN.MOVE_SELF) > 0,
            .move_to = (event.mask & IN.MOVED_TO) > 0,
            .write = (event.mask & IN.MODIFY) > 0,
        },
        .index = index,
    };
}

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Futex = bun.Futex;
const system = std.posix.system;
const IN = std.os.linux.IN;

const WatchItemIndex = bun.Watcher.WatchItemIndex;
const WatchEvent = bun.Watcher.Event;
