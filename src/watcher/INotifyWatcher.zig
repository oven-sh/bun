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

/// Waker to signal the watcher thread
waker: bun.Async.Waker = undefined,
/// Whether the watcher is still running
running: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

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
    defer if (old_count == 0) this.waker.wake();
    const watch_file_mask = IN.EXCL_UNLINK | IN.MOVE_SELF | IN.DELETE_SELF | IN.MOVED_TO | IN.MODIFY;
    const rc = system.inotify_add_watch(this.fd.cast(), pathname, watch_file_mask);
    log("inotify_add_watch({}) = {}", .{ this.fd, rc });
    return bun.JSC.Maybe(EventListIndex).errnoSysP(rc, .watch, pathname) orelse
        .{ .result = rc };
}

pub fn watchDir(this: *INotifyWatcher, pathname: [:0]const u8) bun.JSC.Maybe(EventListIndex) {
    bun.assert(this.loaded);
    const old_count = this.watch_count.fetchAdd(1, .release);
    defer if (old_count == 0) this.waker.wake();
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
    this.waker = try bun.Async.Waker.init();
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
        i = ptr.i;
        break :brk this.eventlist_bytes[0..ptr.len];
    } else outer: while (true) {
        // Check if we should stop
        if (!this.running.load(.acquire)) return .{ .result = &.{} };

        // Check if watch_count is 0, if so wait for waker
        const count = this.watch_count.load(.acquire);
        if (count == 0) {
            // Wait on just the waker fd since there are no watches
            var fds = [_]std.posix.pollfd{.{
                .fd = this.waker.getFd().cast(),
                .events = std.posix.POLL.IN,
                .revents = 0,
            }};

            const poll_rc = switch (bun.sys.poll(&fds, -1)) {
                .result => |rc| rc,
                .err => |err| return .{ .err = err },
            };

            if (poll_rc > 0 and (fds[0].revents & std.posix.POLL.IN) != 0) {
                // Consume the waker
                this.waker.wait();
            }

            // Check again if we should stop or if watches were added
            if (!this.running.load(.acquire)) return .{ .result = &.{} };
            continue :outer;
        }

        // Wait on both inotify fd and waker fd
        var fds = [_]std.posix.pollfd{
            .{
                .fd = this.fd.cast(),
                .events = std.posix.POLL.IN,
                .revents = 0,
            },
            .{
                .fd = this.waker.getFd().cast(),
                .events = std.posix.POLL.IN,
                .revents = 0,
            },
        };

        const poll_rc = switch (bun.sys.poll(&fds, -1)) {
            .result => |rc| rc,
            .err => |err| return .{ .err = err },
        };

        if (poll_rc > 0) {
            // Check if waker was signaled
            if ((fds[1].revents & std.posix.POLL.IN) != 0) {
                // Consume the waker
                this.waker.wait();
                // Check if we should stop
                if (!this.running.load(.acquire)) return .{ .result = &.{} };
            }

            // Check if inotify has events
            if ((fds[0].revents & std.posix.POLL.IN) != 0) {
                switch (bun.sys.read(
                    this.fd,
                    this.eventlist_bytes,
                )) {
                    .result => |rc| {
                        var read_eventlist_bytes = this.eventlist_bytes[0..@intCast(rc)];
                        log("{} read {} bytes", .{ this.fd, read_eventlist_bytes.len });
                        if (read_eventlist_bytes.len == 0) return .{ .result = &.{} };

                        // IN_MODIFY is very noisy
                        // we do a 0.1ms sleep to try to coalesce events better
                        const double_read_threshold = Event.largest_size * (max_count / 2);
                        if (read_eventlist_bytes.len < double_read_threshold) {
                            var timespec = std.posix.timespec{ .sec = 0, .nsec = this.coalesce_interval };
                            if ((bun.sys.ppoll(fds[0..1], &timespec, null).unwrap() catch 0) > 0) {
                                const rest = this.eventlist_bytes[read_eventlist_bytes.len..];
                                bun.assert(rest.len > 0);
                                switch (bun.sys.read(this.fd, rest)) {
                                    .result => |rc2| {
                                        read_eventlist_bytes.len += @intCast(rc2);
                                        break :outer read_eventlist_bytes;
                                    },
                                    .err => |err| return .{ .err = err },
                                }
                            }
                        }

                        break :outer read_eventlist_bytes;
                    },
                    .err => |err| {
                        if (err.getErrno() == .AGAIN) {
                            continue :outer;
                        }

                        return .{ .err = err };
                    },
                }
            }
        }
    };

    var count: u32 = 0;
    while (i < read_eventlist_bytes.len) {
        // It is NOT aligned naturally. It is align 1!!!
        const event: *align(1) Event = @ptrCast(read_eventlist_bytes[i..][0..@sizeOf(Event)].ptr);
        this.eventlist_ptrs[count] = event;
        i += event.size();
        count += 1;
        if (!Environment.enable_logs)
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

    // Clear read_ptr if we've processed all buffered events
    this.read_ptr = null;

    return .{ .result = this.eventlist_ptrs[0..count] };
}

pub fn stop(this: *INotifyWatcher) void {
    log("{} stop", .{this.fd});
    this.running.store(false, .release);
    // Wake up any threads waiting in read()
    this.waker.wake();
    if (this.fd != bun.invalid_fd) {
        this.fd.close();
        this.fd = bun.invalid_fd;
    }
}

/// Repeatedly called by the main watcher until the watcher is terminated.
pub fn watchLoopCycle(this: *bun.Watcher) bun.JSC.Maybe(void) {
    defer Output.flush();

    var events = switch (this.platform.read()) {
        .result => |result| result,
        .err => |err| return .{ .err = err },
    };
    if (events.len == 0) return .{ .result = {} };

    // TODO: is this thread safe?
    var remaining_events = events.len;
    var event_offset: usize = 0;

    const eventlist_index = this.watchlist.items(.eventlist_index);

    while (remaining_events > 0) {
        var name_off: u8 = 0;
        var temp_name_list: [128]?[:0]u8 = undefined;
        var temp_name_off: u8 = 0;

        const slice = events[event_offset..][0..@min(128, remaining_events, this.watch_events.len)];
        var watchevents = this.watch_events[0..slice.len];
        var watch_event_id: u32 = 0;
        for (slice) |event| {
            watchevents[watch_event_id] = watchEventFromInotifyEvent(
                event,
                @intCast(std.mem.indexOfScalar(
                    EventListIndex,
                    eventlist_index,
                    event.watch_descriptor,
                ) orelse continue),
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
        var last_event_id: EventListIndex = std.math.maxInt(EventListIndex);

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
        if (all_events.len == 0) return .{ .result = {} };

        this.mutex.lock();
        defer this.mutex.unlock();
        if (this.running) {
            // all_events.len == 0 is checked above, so last_event_index + 1 is safe
            this.onFileUpdate(this.ctx, all_events[0 .. last_event_index + 1], this.changed_filepaths[0..name_off], this.watchlist);
        } else {
            break;
        }
        event_offset += slice.len;
        remaining_events -= slice.len;
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
const system = std.posix.system;
const IN = std.os.linux.IN;

const WatchItemIndex = bun.Watcher.WatchItemIndex;
const WatchEvent = bun.Watcher.Event;
