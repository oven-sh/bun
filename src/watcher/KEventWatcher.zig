const KEventWatcher = @This();

pub const EventListIndex = u32;

// Everything being watched
eventlist_index: EventListIndex = 0,

fd: bun.FD.Optional = .none,

const changelist_count = 128;

/// Arbitrary non-zero ident used for the EVFILT_USER wakeup event.
const wake_event_ident = 0x2307;

pub fn init(this: *KEventWatcher, _: []const u8) !void {
    const fd = try std.posix.kqueue();
    if (fd == 0) return error.KQueueError;
    this.fd = .init(.fromNative(fd));

    // Register a user-triggered event so `wake()` can unblock `kevent()`
    // during shutdown without closing the kqueue fd from another thread.
    var ev = std.mem.zeroes(KEvent);
    ev.ident = wake_event_ident;
    ev.filter = std.c.EVFILT.USER;
    ev.flags = std.c.EV.ADD | std.c.EV.CLEAR;
    _ = std.posix.system.kevent(fd, @as(*const [1]KEvent, &ev), 1, @as([*]KEvent, undefined), 0, null);
}

pub fn stop(this: *KEventWatcher) void {
    if (this.fd.take()) |fd| {
        fd.close();
    }
}

/// Wake the watcher thread from a blocking `kevent()` so it can observe
/// `Watcher.running == false` and exit.
pub fn wake(this: *KEventWatcher) void {
    const fd = this.fd.unwrap() orelse return;
    var ev = std.mem.zeroes(KEvent);
    ev.ident = wake_event_ident;
    ev.filter = std.c.EVFILT.USER;
    ev.fflags = std.c.NOTE.TRIGGER;
    _ = std.posix.system.kevent(fd.native(), @as(*const [1]KEvent, &ev), 1, @as([*]KEvent, undefined), 0, null);
}

pub fn watchEventFromKEvent(kevent: KEvent) Watcher.Event {
    return .{
        .op = .{
            .delete = (kevent.fflags & std.c.NOTE.DELETE) > 0,
            .metadata = (kevent.fflags & std.c.NOTE.ATTRIB) > 0,
            .rename = (kevent.fflags & (std.c.NOTE.RENAME | std.c.NOTE.LINK)) > 0,
            .write = (kevent.fflags & std.c.NOTE.WRITE) > 0,
        },
        .index = @truncate(kevent.udata),
    };
}

pub fn watchLoopCycle(this: *Watcher) bun.sys.Maybe(void) {
    const fd: bun.FD = this.platform.fd.unwrap() orelse
        @panic("KEventWatcher has an invalid file descriptor");

    // not initialized each time
    var changelist_array: [changelist_count]KEvent = undefined;
    @memset(&changelist_array, std.mem.zeroes(KEvent));
    var changelist = &changelist_array;

    defer Output.flush();

    var count = std.posix.system.kevent(
        fd.native(),
        changelist,
        0,
        changelist,
        changelist_count,
        null, // timeout
    );

    // Give the events more time to coalesce
    if (count < 128 / 2) {
        const remain = 128 - count;
        const extra = std.posix.system.kevent(
            fd.native(),
            changelist[@intCast(count)..].ptr,
            0,
            changelist[@intCast(count)..].ptr,
            remain,
            &.{ .sec = 0, .nsec = 100_000 }, // 0.0001 seconds
        );

        count += extra;
    }

    const changes = changelist[0..@intCast(@max(0, count))];
    var watchevents = this.watch_events[0..changes.len];
    var out_len: usize = 0;
    var prev_event: ?KEvent = null;
    for (changes) |event| {
        // Skip the EVFILT_USER wakeup event posted by `wake()`; only
        // VNODE events map to watch items.
        if (event.filter != std.c.EVFILT.VNODE) continue;

        if (prev_event) |prev| {
            if (prev.udata == event.udata) {
                watchevents[out_len - 1].merge(watchEventFromKEvent(event));
                prev_event = event;
                continue;
            }
        }

        watchevents[out_len] = watchEventFromKEvent(event);
        prev_event = event;
        out_len += 1;
    }
    watchevents = watchevents[0..out_len];

    this.mutex.lock();
    defer this.mutex.unlock();
    if (this.running) {
        this.writeTraceEvents(watchevents, this.changed_filepaths[0..watchevents.len]);
        this.onFileUpdate(this.ctx, watchevents, this.changed_filepaths[0..watchevents.len], this.watchlist);
    }

    return .success;
}

const std = @import("std");
const KEvent = std.c.Kevent;

const bun = @import("bun");
const Output = bun.Output;
const Watcher = bun.Watcher;
