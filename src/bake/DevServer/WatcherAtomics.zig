/// All code working with atomics to communicate watcher <-> DevServer is here.
/// It attempts to recycle as much memory as possible, since files are very
/// frequently updated (the whole point of HMR)
const WatcherAtomics = @This();

const log = Output.scoped(.DevServerWatchAtomics, true);

/// Only two hot-reload events exist ever, which is possible since only one
/// bundle may be active at once. Memory is reused by swapping between these
/// two. These items are aligned to cache lines to reduce contention, since
/// these structures are carefully passed between two threads.
events: [2]HotReloadEvent align(std.atomic.cache_line),
/// 0  - no watch
/// 1  - has fired additional watch
/// 2+ - new events available, watcher is waiting on bundler to finish
watcher_events_emitted: std.atomic.Value(u32),
/// Which event is the watcher holding on to.
/// This is not atomic because only the watcher thread uses this value.
current: u1 align(std.atomic.cache_line),

watcher_has_event: std.debug.SafetyLock,
dev_server_has_event: std.debug.SafetyLock,

pub fn init(dev: *DevServer) WatcherAtomics {
    return .{
        .events = .{ .initEmpty(dev), .initEmpty(dev) },
        .current = 0,
        .watcher_events_emitted = .init(0),
        .watcher_has_event = .{},
        .dev_server_has_event = .{},
    };
}

/// Atomically get a *HotReloadEvent that is not used by the DevServer thread
/// Call `watcherRelease` when it is filled with files.
pub fn watcherAcquireEvent(state: *WatcherAtomics) *HotReloadEvent {
    state.watcher_has_event.lock();

    var ev: *HotReloadEvent = &state.events[state.current];
    switch (ev.contention_indicator.swap(1, .seq_cst)) {
        0 => {
            // New event is unreferenced by the DevServer thread.
        },
        1 => {
            @branchHint(.unlikely);
            // DevServer stole this event. Unlikely but possible when
            // the user is saving very heavily (10-30 times per second)
            state.current +%= 1;
            ev = &state.events[state.current];
            if (Environment.allow_assert) {
                bun.assert(ev.contention_indicator.swap(1, .seq_cst) == 0);
            }
        },
        else => unreachable,
    }

    // Initialize the timer if it is empty.
    if (ev.isEmpty())
        ev.timer = std.time.Timer.start() catch unreachable;

    ev.owner.bun_watcher.thread_lock.assertLocked();

    if (Environment.isDebug)
        assert(ev.debug_mutex.tryLock());

    return ev;
}

/// Release the pointer from `watcherAcquireHotReloadEvent`, submitting
/// the event if it contains new files.
pub fn watcherReleaseAndSubmitEvent(state: *WatcherAtomics, ev: *HotReloadEvent) void {
    state.watcher_has_event.unlock();
    ev.owner.bun_watcher.thread_lock.assertLocked();

    if (Environment.isDebug) {
        for (std.mem.asBytes(&ev.timer)) |b| {
            if (b != 0xAA) break;
        } else @panic("timer is undefined memory in watcherReleaseAndSubmitEvent");
    }

    if (Environment.isDebug)
        ev.debug_mutex.unlock();

    if (!ev.isEmpty()) {
        @branchHint(.likely);
        // There are files to be processed, increment this count first.
        const prev_count = state.watcher_events_emitted.fetchAdd(1, .seq_cst);

        if (prev_count == 0) {
            @branchHint(.likely);
            // Submit a task to the DevServer, notifying it that there is
            // work to do. The watcher will move to the other event.
            ev.concurrent_task = .{
                .auto_delete = false,
                .next = null,
                .task = jsc.Task.init(ev),
            };
            ev.contention_indicator.store(0, .seq_cst);
            ev.owner.vm.event_loop.enqueueTaskConcurrent(&ev.concurrent_task);
            state.current +%= 1;
        } else {
            // DevServer thread has already notified once. Sending
            // a second task would give ownership of both events to
            // them. Instead, DevServer will steal this item since
            // it can observe `watcher_events_emitted >= 2`.
            ev.contention_indicator.store(0, .seq_cst);
        }
    } else {
        ev.contention_indicator.store(0, .seq_cst);
    }

    if (Environment.allow_assert) {
        bun.assert(ev.contention_indicator.load(.monotonic) == 0); // always must be reset
    }
}

/// Called by DevServer after it receives a task callback. If this returns
/// another event, that event must be recycled with `recycleSecondEventFromDevServer`
pub fn recycleEventFromDevServer(state: *WatcherAtomics, first_event: *HotReloadEvent) ?*HotReloadEvent {
    first_event.reset();

    // Reset the watch count to zero, while detecting if
    // the other watch event was submitted.
    if (state.watcher_events_emitted.swap(0, .seq_cst) >= 2) {
        // Cannot use `state.current` because it will contend with the watcher.
        // Since there are are two events, one pointer comparison suffices
        const other_event = if (first_event == &state.events[0])
            &state.events[1]
        else
            &state.events[0];

        switch (other_event.contention_indicator.swap(1, .seq_cst)) {
            0 => {
                // DevServer holds the event now.
                state.dev_server_has_event.lock();
                return other_event;
            },
            1 => {
                // The watcher is currently using this event.
                // `watcher_events_emitted` is already zero, so it will
                // always submit.

                // Not 100% confident in this logic, but the only way
                // to hit this is by saving extremely frequently, and
                // a followup save will just trigger the reload.
                return null;
            },
            else => unreachable,
        }
    }

    // If a watch callback had already acquired the event, that is fine as
    // it will now read 0 when deciding if to submit the task.
    return null;
}

pub fn recycleSecondEventFromDevServer(state: *WatcherAtomics, second_event: *HotReloadEvent) void {
    second_event.reset();

    state.dev_server_has_event.unlock();
    if (Environment.allow_assert) {
        const result = second_event.contention_indicator.swap(0, .seq_cst);
        bun.assert(result == 1);
    } else {
        second_event.contention_indicator.store(0, .seq_cst);
    }
}

const bun = @import("bun");
const VoidFieldTypes = bun.meta.VoidFieldTypes;
const AllocationScope = bun.AllocationScope;
const Environment = bun.Environment;
const Mutex = bun.Mutex;
const Output = bun.Output;
const StringJoiner = bun.StringJoiner;
const Watcher = bun.Watcher;
const assert = bun.assert;
const assert_eql = bun.assert_eql;
const bake = bun.bake;
const DevServer = bake.DevServer;
const HotReloadEvent = DevServer.HotReloadEvent;
const ChunkKind = DevServer.ChunkKind;
const EntryPointList = DevServer.EntryPointList;
const GraphTraceState = DevServer.GraphTraceState;
const igLog = DevServer.igLog;
const debug = DevServer.debug;
const SerializedFailure = DevServer.SerializedFailure;
const RouteBundle = DevServer.RouteBundle;
const HotUpdateContext = DevServer.HotUpdateContext;
const PackedMap = DevServer.PackedMap;
const FileKind = DevServer.FileKind;
const DynamicBitSetUnmanaged = bun.bit_set.DynamicBitSetUnmanaged;
const Log = bun.logger.Log;
const MimeType = bun.http.MimeType;
const RefPtr = bun.ptr.RefPtr;
const StaticRoute = bun.server.StaticRoute;
const Transpiler = bun.transpiler.Transpiler;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const HTMLBundle = jsc.API.HTMLBundle;
const AnyBlob = jsc.WebCore.Blob.Any;
const Plugin = jsc.API.JSBundler.Plugin;

const BunFrontendDevServerAgent = jsc.Debugger.BunFrontendDevServerAgent;
const DebuggerId = jsc.Debugger.DebuggerId;

const FrameworkRouter = bake.FrameworkRouter;
const OpaqueFileId = FrameworkRouter.OpaqueFileId;
const Route = FrameworkRouter.Route;

const BundleV2 = bun.bundle_v2.BundleV2;
const Chunk = bun.bundle_v2.Chunk;
const ContentHasher = bun.bundle_v2.ContentHasher;

const SourceMap = bun.sourcemap;
const SourceMapStore = DevServer.SourceMapStore;
const VLQ = SourceMap.VLQ;

const uws = bun.uws;
const AnyResponse = bun.uws.AnyResponse;
const AnyWebSocket = uws.AnyWebSocket;
const Request = uws.Request;

const std = @import("std");
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const AutoArrayHashMapUnmanaged = std.AutoArrayHashMapUnmanaged;
const Allocator = std.mem.Allocator;
