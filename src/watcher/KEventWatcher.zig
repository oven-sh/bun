const KEventWatcher = @This();

pub const EventListIndex = u32;

// Everything being watched
eventlist_index: EventListIndex = 0,

fd: bun.FD.Optional = .none,
/// See `INotifyWatcher.coalesce_interval` for rationale. Honours the same
/// env var (despite its Linux-centric name) so tests can pin the window
/// uniformly across platforms.
coalesce_interval_ns: isize = default_coalesce_interval_ns,

const changelist_count = 128;
const default_coalesce_interval_ns = 10_000_000; // 10ms
/// `kevent()` returns as soon as one event is ready rather than waiting
/// the full timeout, so a burst of N writes a few ms apart consumes ~N
/// drain iterations. Keep this in step with
/// `INotifyWatcher.max_coalesce_iterations` so the same save burst
/// collapses into one cycle on both backends; the quiet-timeout `break`
/// still terminates the common case after one idle interval.
const max_coalesce_iterations = 32;

pub fn init(this: *KEventWatcher, _: []const u8) !void {
    const fd = try std.posix.kqueue();
    if (fd == 0) return error.KQueueError;
    this.fd = .init(.fromNative(fd));
    this.coalesce_interval_ns = std.math.cast(isize, bun.env_var.BUN_INOTIFY_COALESCE_INTERVAL.get()) orelse default_coalesce_interval_ns;
}

pub fn stop(this: *KEventWatcher) void {
    if (this.fd.take()) |fd| {
        fd.close();
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

    // A single editor save typically produces several kevents a few ms
    // apart (e.g. NOTE_WRITE on the file plus NOTE_WRITE on its parent
    // directory, or the rename/create pair from an atomic save). Keep
    // draining until the queue stays quiet for `coalesce_interval_ns`
    // so one save becomes one `onFileUpdate` call instead of several,
    // which in `--hot` mode would otherwise re-evaluate the entry point
    // once per burst.
    //
    // `count > 0` guards against the initial `kevent` returning -1
    // (error) — the `@max(0, count)` below already handles that for the
    // final slice, but `@intCast(count)` here would trap on a negative.
    const interval = this.platform.coalesce_interval_ns;
    var iterations: u32 = 0;
    while (count > 0 and count < changelist_count and iterations < max_coalesce_iterations) : (iterations += 1) {
        const remain = changelist_count - count;
        const extra = std.posix.system.kevent(
            fd.native(),
            changelist[@intCast(count)..].ptr,
            0,
            changelist[@intCast(count)..].ptr,
            remain,
            // POSIX requires tv_nsec < 10^9; split so a user-supplied
            // interval ≥ 1 s doesn't make `kevent` fail with EINVAL.
            &.{
                .sec = @divTrunc(interval, std.time.ns_per_s),
                .nsec = @rem(interval, std.time.ns_per_s),
            },
        );

        if (extra <= 0) break; // quiet (or error: fall through to existing processing)
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
