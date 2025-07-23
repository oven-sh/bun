/// This task informs the DevServer's thread about new files to be bundled.
pub const HotReloadEvent = @This();

/// Align to cache lines to eliminate false sharing.
_: u0 align(std.atomic.cache_line) = 0,

owner: *DevServer,
/// Initialized in WatcherAtomics.watcherReleaseAndSubmitEvent
concurrent_task: JSC.ConcurrentTask,
/// The watcher is not able to peek into IncrementalGraph to know what files
/// to invalidate, so the watch events are de-duplicated and passed along.
/// The keys are owned by the file watcher.
files: bun.StringArrayHashMapUnmanaged(void),
/// Directories are watched so that resolution failures can be solved.
/// The keys are owned by the file watcher.
dirs: bun.StringArrayHashMapUnmanaged(void),
/// Same purpose as `files` but keys do not have an owner.
extra_files: std.ArrayListUnmanaged(u8),
/// Initialized by the WatcherAtomics.watcherAcquireEvent
timer: std.time.Timer,
/// This event may be referenced by either DevServer or Watcher thread.
/// 1 if referenced, 0 if unreferenced; see WatcherAtomics
contention_indicator: std.atomic.Value(u32),

debug_mutex: if (Environment.isDebug) bun.Mutex else void,

pub fn initEmpty(owner: *DevServer) HotReloadEvent {
    return .{
        .owner = owner,
        .concurrent_task = undefined,
        .files = .empty,
        .dirs = .empty,
        .timer = undefined,
        .contention_indicator = .init(0),
        .debug_mutex = if (Environment.isDebug) .{} else {},
        .extra_files = .empty,
    };
}

pub fn reset(ev: *HotReloadEvent) void {
    if (Environment.isDebug)
        ev.debug_mutex.unlock();

    ev.files.clearRetainingCapacity();
    ev.dirs.clearRetainingCapacity();
    ev.extra_files.clearRetainingCapacity();
    ev.timer = undefined;
}

pub fn isEmpty(ev: *const HotReloadEvent) bool {
    return (ev.files.count() + ev.dirs.count()) == 0;
}

pub fn appendFile(event: *HotReloadEvent, allocator: Allocator, file_path: []const u8) void {
    _ = event.files.getOrPut(allocator, file_path) catch bun.outOfMemory();
}

pub fn appendDir(event: *HotReloadEvent, allocator: Allocator, dir_path: []const u8, maybe_sub_path: ?[]const u8) void {
    if (dir_path.len == 0) return;
    _ = event.dirs.getOrPut(allocator, dir_path) catch bun.outOfMemory();

    const sub_path = maybe_sub_path orelse return;
    if (sub_path.len == 0) return;

    const platform = bun.path.Platform.auto;
    const ends_with_sep = platform.isSeparator(dir_path[dir_path.len - 1]);
    const starts_with_sep = platform.isSeparator(sub_path[0]);
    const sep_offset: i32 = if (ends_with_sep and starts_with_sep) -1 else 1;

    event.extra_files.ensureUnusedCapacity(allocator, @intCast(@as(i32, @intCast(dir_path.len + sub_path.len)) + sep_offset + 1)) catch bun.outOfMemory();
    event.extra_files.appendSliceAssumeCapacity(if (ends_with_sep) dir_path[0 .. dir_path.len - 1] else dir_path);
    event.extra_files.appendAssumeCapacity(platform.separator());
    event.extra_files.appendSliceAssumeCapacity(sub_path);
    event.extra_files.appendAssumeCapacity(0);
}

/// Invalidates items in IncrementalGraph, appending all new items to `entry_points`
pub fn processFileList(
    event: *HotReloadEvent,
    dev: *DevServer,
    entry_points: *EntryPointList,
    temp_alloc: Allocator,
) void {
    dev.graph_safety_lock.lock();
    defer dev.graph_safety_lock.unlock();

    // First handle directories, because this may mutate `event.files`
    if (dev.directory_watchers.watches.count() > 0) for (event.dirs.keys()) |changed_dir_with_slash| {
        const changed_dir = bun.strings.withoutTrailingSlashWindowsPath(changed_dir_with_slash);

        // Bust resolution cache, but since Bun does not watch all
        // directories in a codebase, this only targets the following resolutions
        _ = dev.server_transpiler.resolver.bustDirCache(changed_dir);

        // if a directory watch exists for resolution failures, check those now.
        if (dev.directory_watchers.watches.getIndex(changed_dir)) |watcher_index| {
            const entry = &dev.directory_watchers.watches.values()[watcher_index];
            var new_chain: DirectoryWatchStore.Dep.Index.Optional = .none;
            var it: ?DirectoryWatchStore.Dep.Index = entry.first_dep;

            while (it) |index| {
                const dep = &dev.directory_watchers.dependencies.items[index.get()];
                it = dep.next.unwrap();

                if ((dev.server_transpiler.resolver.resolve(
                    bun.path.dirname(dep.source_file_path, .auto),
                    dep.specifier,
                    .stmt,
                ) catch null) != null) {
                    // this resolution result is not preserved as passing it
                    // into BundleV2 is too complicated. the resolution is
                    // cached, anyways.
                    event.appendFile(dev.allocator, dep.source_file_path);
                    dev.directory_watchers.freeDependencyIndex(dev.allocator, index) catch bun.outOfMemory();
                } else {
                    // rebuild a new linked list for unaffected files
                    dep.next = new_chain;
                    new_chain = index.toOptional();
                }
            }

            if (new_chain.unwrap()) |new_first_dep| {
                entry.first_dep = new_first_dep;
            } else {
                // without any files to depend on this watcher is freed
                dev.directory_watchers.freeEntry(dev.allocator, watcher_index);
            }
        }
    };

    var rest_extra = event.extra_files.items;
    while (bun.strings.indexOfChar(rest_extra, 0)) |str| {
        event.files.put(dev.allocator, rest_extra[0..str], {}) catch bun.outOfMemory();
        rest_extra = rest_extra[str + 1 ..];
    }
    if (rest_extra.len > 0) {
        event.files.put(dev.allocator, rest_extra, {}) catch bun.outOfMemory();
    }

    const changed_file_paths = event.files.keys();
    inline for (.{ &dev.server_graph, &dev.client_graph }) |g| {
        g.invalidate(changed_file_paths, entry_points, temp_alloc) catch bun.outOfMemory();
    }

    if (entry_points.set.count() == 0) {
        Output.debugWarn("nothing to bundle", .{});
        if (changed_file_paths.len > 0)
            Output.debugWarn("modified files: {s}", .{
                bun.fmt.fmtSlice(changed_file_paths, ", "),
            });

        if (event.dirs.count() > 0)
            Output.debugWarn("modified dirs: {s}", .{
                bun.fmt.fmtSlice(event.dirs.keys(), ", "),
            });

        dev.publish(.testing_watch_synchronization, &.{
            MessageId.testing_watch_synchronization.char(),
            1,
        }, .binary);
        return;
    }

    if (dev.has_tailwind_plugin_hack) |*map| {
        for (map.keys()) |abs_path| {
            const file = dev.client_graph.bundled_files.get(abs_path) orelse
                continue;
            if (file.flags.kind == .css)
                entry_points.appendCss(temp_alloc, abs_path) catch bun.outOfMemory();
        }
    }
}

pub fn run(first: *HotReloadEvent) void {
    assert(first.owner.magic == .valid);
    debug.log("HMR Task start", .{});
    defer debug.log("HMR Task end", .{});

    const dev = first.owner;

    if (Environment.isDebug) {
        assert(first.debug_mutex.tryLock());
        assert(first.contention_indicator.load(.seq_cst) == 0);
    }

    if (dev.current_bundle != null) {
        dev.next_bundle.reload_event = first;
        return;
    }

    var sfb = std.heap.stackFallback(4096, dev.allocator);
    const temp_alloc = sfb.get();
    var entry_points: EntryPointList = .empty;
    defer entry_points.deinit(temp_alloc);

    first.processFileList(dev, &entry_points, temp_alloc);

    const timer = first.timer;

    if (dev.watcher_atomics.recycleEventFromDevServer(first)) |second| {
        if (Environment.isDebug) {
            assert(second.debug_mutex.tryLock());
        }
        second.processFileList(dev, &entry_points, temp_alloc);
        dev.watcher_atomics.recycleSecondEventFromDevServer(second);
    }

    if (entry_points.set.count() == 0) {
        return;
    }

    switch (dev.testing_batch_events) {
        .disabled => {},
        .enabled => |*ev| {
            ev.append(dev, entry_points) catch bun.outOfMemory();
            dev.publish(.testing_watch_synchronization, &.{
                MessageId.testing_watch_synchronization.char(),
                1,
            }, .binary);
            return;
        },
        .enable_after_bundle => bun.debugAssert(false),
    }

    dev.startAsyncBundle(
        entry_points,
        true,
        timer,
    ) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());
        return;
    };
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
const MessageId = DevServer.MessageId;
const DirectoryWatchStore = DevServer.DirectoryWatchStore;
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

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;
const HTMLBundle = JSC.API.HTMLBundle;
const AnyBlob = JSC.WebCore.Blob.Any;
const Plugin = JSC.API.JSBundler.Plugin;

const BunFrontendDevServerAgent = JSC.Debugger.BunFrontendDevServerAgent;
const DebuggerId = JSC.Debugger.DebuggerId;

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
