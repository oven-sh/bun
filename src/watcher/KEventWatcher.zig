const KEventWatcher = @This();
const log = Output.scoped(.watcher, false);
pub const EventListIndex = u32;

const KEvent = std.c.Kevent;

// Internal
changelist: [128]KEvent = undefined,

// Everything being watched
eventlist: [max_eviction_count]KEvent = undefined,
eventlist_index: EventListIndex = 0,

fd: bun.FileDescriptor = bun.invalid_fd,

pub fn init(this: *KEventWatcher, _: []const u8) !void {
    const fd = try std.posix.kqueue();
    if (fd == 0) return error.KQueueError;
    this.fd = bun.toFD(fd);
}

pub fn stop(this: *KEventWatcher) void {
    if (this.fd.isValid()) {
        _ = bun.sys.close(this.fd);
        this.fd = bun.invalid_fd;
    }
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

pub fn watchLoopCycle(this: *Watcher) bun.JSC.Maybe(void) {
    bun.assert(this.platform.fd.isValid());

    // not initialized each time
    var changelist_array: [128]KEvent = std.mem.zeroes([128]KEvent);
    var changelist = &changelist_array;

    defer Output.flush();

    var count = std.posix.system.kevent(
        this.platform.fd.cast(),
        changelist,
        0,
        changelist,
        128,
        null, // timeout
    );

    // Give the events more time to coalesce
    if (count < 128 / 2) {
        const remain = 128 - count;
        const extra = std.posix.system.kevent(
            this.platform.fd.cast(),
            changelist[@intCast(count)..].ptr,
            0,
            changelist[@intCast(count)..].ptr,
            remain,
            &.{ .sec = 0, .nsec = 100_000 }, // 0.0001 seconds
        );

        count += extra;
    }

    var changes = changelist[0..@intCast(@max(0, count))];
    var watchevents = this.watch_events[0..changes.len];
    var out_len: usize = 0;
    if (changes.len > 0) {
        watchevents[0] = watchEventFromKEvent(changes[0]);
        out_len = 1;
        var prev_event = changes[0];
        for (changes[1..]) |event| {
            if (prev_event.udata == event.udata) {
                const new = watchEventFromKEvent(event);
                watchevents[out_len - 1].merge(new);
                continue;
            }

            watchevents[out_len] = watchEventFromKEvent(event);
            prev_event = event;
            out_len += 1;
        }

        watchevents = watchevents[0..out_len];
    }

    this.mutex.lock();
    defer this.mutex.unlock();
    if (this.running) {
        this.onFileUpdate(this.ctx, watchevents, this.changed_filepaths[0..watchevents.len], this.watchlist);
    }

    return .{ .result = {} };
}

const std = @import("std");
const bun = @import("root").bun;
const Output = bun.Output;
const Watcher = bun.Watcher;
const max_eviction_count = Watcher.max_eviction_count;
