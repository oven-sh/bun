/// This task informs the DevServer's thread about new files to be bundled.
pub const HotReloadEvent = @This();

/// Align to cache lines to eliminate false sharing.
_: u0 align(std.atomic.cache_line) = 0,

owner: *DevServer,
/// Initialized in WatcherAtomics.watcherReleaseAndSubmitEvent
concurrent_task: jsc.ConcurrentTask,
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
    _ = bun.handleOom(event.files.getOrPut(allocator, file_path));
}

pub fn appendDir(event: *HotReloadEvent, allocator: Allocator, dir_path: []const u8, maybe_sub_path: ?[]const u8) void {
    if (dir_path.len == 0) return;
    _ = bun.handleOom(event.dirs.getOrPut(allocator, dir_path));

    const sub_path = maybe_sub_path orelse return;
    if (sub_path.len == 0) return;

    const platform = bun.path.Platform.auto;
    const ends_with_sep = platform.isSeparator(dir_path[dir_path.len - 1]);
    const starts_with_sep = platform.isSeparator(sub_path[0]);
    const sep_offset: i32 = if (ends_with_sep and starts_with_sep) -1 else 1;

    bun.handleOom(event.extra_files.ensureUnusedCapacity(allocator, @intCast(@as(i32, @intCast(dir_path.len + sub_path.len)) + sep_offset + 1)));
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
                    event.appendFile(dev.allocator(), dep.source_file_path);
                    bun.handleOom(dev.directory_watchers.freeDependencyIndex(dev.allocator(), index));
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
                dev.directory_watchers.freeEntry(dev.allocator(), watcher_index);
            }
        }
    };

    var rest_extra = event.extra_files.items;
    while (bun.strings.indexOfChar(rest_extra, 0)) |str| {
        bun.handleOom(event.files.put(dev.allocator(), rest_extra[0..str], {}));
        rest_extra = rest_extra[str + 1 ..];
    }
    if (rest_extra.len > 0) {
        bun.handleOom(event.files.put(dev.allocator(), rest_extra, {}));
    }

    const changed_file_paths = event.files.keys();
    inline for (.{ &dev.server_graph, &dev.client_graph }) |g| {
        bun.handleOom(g.invalidate(changed_file_paths, entry_points, temp_alloc));
    }

    if (entry_points.set.count() == 0) {
        Output.debugWarn("nothing to bundle", .{});
        if (changed_file_paths.len > 0)
            Output.debugWarn("modified files: {f}", .{
                bun.fmt.fmtSlice(changed_file_paths, ", "),
            });

        if (event.dirs.count() > 0)
            Output.debugWarn("modified dirs: {f}", .{
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
            const file = (dev.client_graph.bundled_files.get(abs_path) orelse continue).unpack();
            if (file.kind() == .css)
                bun.handleOom(entry_points.appendCss(temp_alloc, abs_path));
        }
    }
}

pub fn run(first: *HotReloadEvent) void {
    assert(first.owner.magic == .valid);
    debug.log("HMR Task start", .{});
    defer debug.log("HMR Task end", .{});

    const dev = first.owner;

    if (comptime Environment.isDebug) {
        assert(first.debug_mutex.tryLock());
        assert(first.contention_indicator.load(.seq_cst) == 0);
    }

    if (dev.current_bundle != null) {
        dev.next_bundle.reload_event = first;
        return;
    }

    var sfb = std.heap.stackFallback(4096, dev.allocator());
    const temp_alloc = sfb.get();
    var entry_points: EntryPointList = .empty;
    defer entry_points.deinit(temp_alloc);

    first.processFileList(dev, &entry_points, temp_alloc);

    const timer = first.timer;

    var current = first;
    while (true) {
        current.processFileList(dev, &entry_points, temp_alloc);
        current = dev.watcher_atomics.recycleEventFromDevServer(current) orelse break;
        if (comptime Environment.isDebug) {
            assert(current.debug_mutex.tryLock());
        }
    }

    if (entry_points.set.count() == 0) {
        return;
    }

    switch (dev.testing_batch_events) {
        .disabled => {},
        .enabled => |*ev| {
            bun.handleOom(ev.append(dev, entry_points));
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
const Environment = bun.Environment;
const Mutex = bun.Mutex;
const Output = bun.Output;
const Watcher = bun.Watcher;
const assert = bun.assert;
const bake = bun.bake;
const jsc = bun.jsc;
const BundleV2 = bun.bundle_v2.BundleV2;

const DevServer = bake.DevServer;
const DirectoryWatchStore = DevServer.DirectoryWatchStore;
const EntryPointList = DevServer.EntryPointList;
const MessageId = DevServer.MessageId;
const debug = DevServer.debug;

const std = @import("std");
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
