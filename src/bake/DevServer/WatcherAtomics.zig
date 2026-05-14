//! All code working with atomics to communicate watcher <-> DevServer is here.
//! It attempts to recycle as much memory as possible, since files are very
//! frequently updated (the whole point of HMR)

const Self = @This();

/// Only one event can run at any given time. We need three events because:
///
/// * One event may be actively running on the dev server thread.
/// * One event may be "pending", i.e., it was added by the watcher thread but not immediately
///   started because an event was already running.
/// * One event must be available for the watcher thread to initialize and submit. If an event
///   is already pending, this new event will replace the pending one, and the pending one will
///   become available.
events: [3]HotReloadEvent,

/// The next event to be run. If an event is already running, new events are stored in this
/// field instead of scheduled directly, and will be run once the current event finishes.
next_event: std.atomic.Value(NextEvent) align(std.atomic.cache_line) = .init(.done),

// Only the watcher thread uses these two fields. They are both indices into the `events` array,
// and indicate which elements are in-use and not available for modification. Only two such events
// can ever be in use at once, so we can always find a free event in the array of length 3.
current_event: ?u2 = null,
pending_event: ?u2 = null,

// Debug fields to ensure methods are being called in the right order.
dbg_watcher_event: DbgEventPtr = if (Environment.allow_assert) null,
dbg_server_event: DbgEventPtr = if (Environment.allow_assert) null,

const NextEvent = enum(u8) {
    /// An event is running, and no next event is pending.
    waiting = std.math.maxInt(u8) - 1,
    /// No event is running.
    done = std.math.maxInt(u8),
    /// Any other value represents an index into the `events` array.
    _,
};

const DbgEventPtr = if (Environment.allow_assert) ?*HotReloadEvent else void;

pub fn init(dev: *DevServer) Self {
    var self = Self{ .events = undefined };
    for (&self.events) |*event| {
        event.* = .initEmpty(dev);
    }
    return self;
}

/// Atomically get a *HotReloadEvent that is not used by the DevServer thread
/// Call `watcherRelease` when it is filled with files.
///
/// Called from watcher thread.
pub fn watcherAcquireEvent(self: *Self) *HotReloadEvent {
    var available = [_]bool{true} ** 3;
    if (self.current_event) |i| available[i] = false;
    if (self.pending_event) |i| available[i] = false;

    const index = for (available, 0..) |is_available, i| {
        if (is_available) break i;
    } else unreachable;
    const ev = &self.events[index];

    if (comptime Environment.allow_assert) {
        bun.assertf(
            self.dbg_watcher_event == null,
            "must call `watcherReleaseEvent` before calling `watcherAcquireEvent` again",
            .{},
        );
        self.dbg_watcher_event = ev;
    }

    // Initialize the timer if it is empty.
    if (ev.isEmpty())
        ev.timer = std.time.Timer.start() catch unreachable;

    ev.owner.bun_watcher.thread_lock.assertLocked();

    if (comptime Environment.isDebug)
        assert(ev.debug_mutex.tryLock());
    return ev;
}

/// Release the pointer from `watcherAcquireHotReloadEvent`, submitting
/// the event if it contains new files.
///
/// Called from watcher thread.
pub fn watcherReleaseAndSubmitEvent(self: *Self, ev: *HotReloadEvent) void {
    ev.owner.bun_watcher.thread_lock.assertLocked();

    if (comptime Environment.allow_assert) {
        const dbg_event = self.dbg_watcher_event orelse std.debug.panic(
            "must call `watcherAcquireEvent` before `watcherReleaseAndSubmitEvent`",
            .{},
        );
        bun.assertf(
            dbg_event == ev,
            "watcherReleaseAndSubmitEvent: event is not from last `watcherAcquireEvent` call" ++
                " (expected {*}, got {*})",
            .{ dbg_event, ev },
        );
        self.dbg_watcher_event = null;
    }

    if (comptime Environment.isDebug) {
        for (std.mem.asBytes(&ev.timer)) |b| {
            if (b != 0xAA) break;
        } else @panic("timer is undefined memory in watcherReleaseAndSubmitEvent");
        ev.debug_mutex.unlock();
    }

    if (ev.isEmpty()) return;
    // There are files to be processed.

    const ev_index: u2 = @intCast(ev - &self.events[0]);
    const old_next = self.next_event.swap(@enumFromInt(ev_index), .acq_rel);
    switch (old_next) {
        .done => {
            // Dev server is done running events. We need to schedule the event directly.
            self.current_event = ev_index;
            self.pending_event = null;
            // .monotonic because the dev server is not running events right now.
            // (could technically be made non-atomic)
            self.next_event.store(.waiting, .monotonic);
            if (comptime Environment.allow_assert) {
                bun.assertf(
                    self.dbg_server_event == null,
                    "no event should be running right now",
                    .{},
                );
                // Not atomic because the dev server is not running events right now.
                self.dbg_server_event = ev;
            }
            ev.concurrent_task = .{
                .task = jsc.Task.init(ev),
            };
            ev.owner.vm.event_loop.enqueueTaskConcurrent(&ev.concurrent_task);
        },

        .waiting => {
            if (self.pending_event != null) {
                // `pending_event` is running, which means we're done with `current_event`.
                self.current_event = self.pending_event;
            } // else, no pending event yet, but not done with `current_event`.
            self.pending_event = ev_index;
        },

        else => {
            // This is an index into the `events` array.
            const old_index: u2 = @intCast(@intFromEnum(old_next));
            bun.assertf(
                self.pending_event == old_index,
                "watcherReleaseAndSubmitEvent: expected `pending_event` to be {d}; got {?d}",
                .{ old_index, self.pending_event },
            );
            // The old pending event hadn't been run yet, so we can replace it with `ev`.
            self.pending_event = ev_index;
        },
    }
}

/// Called by DevServer after it receives a task callback. If this returns another event,
/// that event should be passed again to this function, and so on, until this function
/// returns null.
///
/// Runs on dev server thread.
pub fn recycleEventFromDevServer(self: *Self, old_event: *HotReloadEvent) ?*HotReloadEvent {
    old_event.reset();

    if (comptime Environment.allow_assert) {
        // Not atomic because watcher won't modify this value while an event is running.
        const dbg_event = self.dbg_server_event;
        self.dbg_server_event = null;
        bun.assertf(
            dbg_event == old_event,
            "recycleEventFromDevServer: old_event: expected {*}, got {*}",
            .{ dbg_event, old_event },
        );
    }

    const event = while (true) {
        const next = self.next_event.swap(.waiting, .acq_rel);
        switch (next) {
            .waiting => {
                // Success order is not .acq_rel because the swap above performed an .acquire load.
                // Failure order is .monotonic because we're going to perform an .acquire load
                // in the next loop iteration.
                if (self.next_event.cmpxchgWeak(.waiting, .done, .release, .monotonic) != null)
                    continue; // another event may have been added
                return null; // done running events
            },
            .done => unreachable,
            else => break &self.events[@intFromEnum(next)],
        }
    };

    if (comptime Environment.allow_assert) {
        // Not atomic because watcher won't modify this value while an event is running.
        self.dbg_server_event = event;
    }
    return event;
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const bake = bun.bake;
const jsc = bun.jsc;

const DevServer = bake.DevServer;
const HotReloadEvent = DevServer.HotReloadEvent;
