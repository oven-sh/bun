//! POSIX backend for `fs.watch()`.
//!
//! This is deliberately independent of `bun.Watcher` (the bundler/--watch/--hot
//! watcher). `bun.Watcher` is shaped around a module graph — its WatchItem carries
//! `options.Loader`, `*PackageJSON`, a `*bun.fs.FileSystem`, and on Windows is pinned
//! to `top_level_dir`. None of that applies to `fs.watch()`, and routing `fs.watch()`
//! through it required a 1k-line shim (the old version of this file) full of
//! lock-ordering workarounds, a WorkPool directory crawler, and a bolted-on FSEvents
//! side-channel.
//!
//! The Windows backend (`win_watcher.zig`, libuv `uv_fs_event`) never went through
//! `bun.Watcher` and is a quarter of the size; this file gives Linux/macOS/FreeBSD
//! the same shape:
//!
//!   PathWatcherManager        process-global, lazy, owns the OS resource
//!     ├─ Linux:   one inotify fd + one reader thread, wd → PathWatcher map
//!     ├─ macOS:   delegates to fs_events.zig (one CFRunLoop thread, one FSEventStream)
//!     └─ FreeBSD: one kqueue fd + one reader thread, fd → PathWatcher map
//!
//!   PathWatcher               one per unique (realpath, recursive) — deduped
//!     └─ handlers[]           the JS FSWatcher contexts sharing this watch
//!
//! A second `fs.watch()` on the same path returns the existing PathWatcher with a
//! new handler appended. `detach()` removes a handler; the last one out tears down
//! the OS watch.

/// Process-global manager. Created on first `fs.watch()`, never destroyed (matches
/// the FSEvents loop and Windows libuv loop lifetimes).
var default_manager: ?*PathWatcherManager = null;
var default_manager_mutex: Mutex = .{};

const log = Output.scoped(.@"fs.watch", .hidden);

pub const PathWatcherManager = struct {
    /// Guards `watchers` and all per-platform dispatch maps. The reader thread holds
    /// this while dispatching, so `detach()` on the JS thread cannot free a PathWatcher
    /// mid-emit. A single lock here replaces the three interacting mutexes of the old
    /// design.
    mutex: Mutex = .{},

    /// Dedup map: dedup key → PathWatcher. The key is the resolved path with a one-byte
    /// suffix encoding `recursive` (so `fs.watch(p)` and `fs.watch(p, {recursive:true})`
    /// don't share — they want different OS registrations on every platform).
    watchers: bun.StringArrayHashMapUnmanaged(*PathWatcher) = .{},

    /// Platform-specific state (inotify fd / kqueue fd + dispatch maps + thread).
    /// On macOS this is empty — FSEvents owns its own thread via `fs_events.zig`.
    platform: Platform = .{},

    pub fn get() bun.sys.Maybe(*PathWatcherManager) {
        // No unlocked fast path: `default_manager` is a plain global and an unsynchronized
        // read here would be textbook broken DCLP (a concurrent Worker's first `fs.watch()`
        // on ARM64 could observe the non-null pointer before `m.* = .{}` is visible and
        // lock a garbage `m.mutex`). `get()` runs once per `fs.watch()` call; the mutex is
        // uncontended after initialization.
        default_manager_mutex.lock();
        defer default_manager_mutex.unlock();
        if (default_manager) |m| return .{ .result = m };

        const m = bun.handleOom(bun.default_allocator.create(PathWatcherManager));
        m.* = .{};
        switch (Platform.init(m)) {
            .err => |e| {
                bun.default_allocator.destroy(m);
                return .{ .err = e };
            },
            .result => {},
        }
        default_manager = m;
        return .{ .result = m };
    }

    /// Build the dedup key into `buf`. Not null-terminated; only used as a hashmap key.
    fn makeKey(buf: []u8, resolved_path: []const u8, recursive: bool) []const u8 {
        @memcpy(buf[0..resolved_path.len], resolved_path);
        buf[resolved_path.len] = if (recursive) 'R' else 'N';
        return buf[0 .. resolved_path.len + 1];
    }

    /// Remove `watcher` from the dedup map. Caller holds `mutex`.
    fn unlinkWatcherLocked(this: *PathWatcherManager, watcher: *PathWatcher) void {
        if (std.mem.indexOfScalar(*PathWatcher, this.watchers.values(), watcher)) |i| {
            bun.default_allocator.free(this.watchers.keys()[i]);
            this.watchers.swapRemoveAt(i);
        }
    }
};

pub const PathWatcher = struct {
    manager: ?*PathWatcherManager,

    /// Canonical absolute path (realpath of the user-supplied path). Owned.
    path: [:0]const u8,
    recursive: bool,
    is_file: bool,

    /// JS `FSWatcher` contexts sharing this OS watch. Each gets its own ChangeEvent
    /// for per-handler duplicate suppression (same as win_watcher.zig). Guarded by
    /// `manager.mutex` on all platforms — every emit path (inotify/kqueue reader
    /// threads and the Darwin FSEvents callback) holds it while iterating, so
    /// attach/detach can never race with dispatch.
    handlers: std.AutoArrayHashMapUnmanaged(*anyopaque, ChangeEvent) = .{},

    /// Per-platform per-watch state (inotify wds, kqueue fds, or the FSEventsWatcher).
    platform: Platform.Watch = .{},

    pub const new = bun.TrivialNew(PathWatcher);

    pub const EventType = enum {
        rename,
        change,

        pub fn toEvent(event_type: EventType, path: FSWatcher.EventPathString) Event {
            return switch (event_type) {
                inline else => |t| @unionInit(Event, @tagName(t), path),
            };
        }
    };

    /// Per-handler duplicate suppression.
    ///
    /// The predicate is intentionally identical to `win_watcher.zig` and the old
    /// `path_watcher.zig` so POSIX and Windows agree on which bursts are coalesced.
    /// It suppresses only when, within the same millisecond, *both* the hash and
    /// the event type match the previous emission — arguably too aggressive, but
    /// changing it here would diverge from Windows; fixing all three together is
    /// a separate change.
    pub const ChangeEvent = struct {
        hash: u64 = 0,
        event_type: EventType = .change,
        timestamp: i64 = 0,

        fn shouldEmit(this: *ChangeEvent, hash: u64, timestamp: i64, event_type: EventType) bool {
            const time_diff = timestamp - this.timestamp;
            if ((this.timestamp == 0 or time_diff > 1) or
                this.event_type != event_type and this.hash != hash)
            {
                this.timestamp = timestamp;
                this.event_type = event_type;
                this.hash = hash;
                return true;
            }
            return false;
        }
    };

    pub const Callback = *const fn (ctx: ?*anyopaque, event: Event, is_file: bool) void;
    pub const UpdateEndCallback = *const fn (ctx: ?*anyopaque) void;

    /// Called from the platform reader thread with `manager.mutex` held.
    /// `rel_path` is borrowed — `onPathUpdatePosix` dupes it before enqueuing.
    fn emit(this: *PathWatcher, event_type: EventType, rel_path: []const u8, is_file: bool) void {
        const timestamp = std.time.milliTimestamp();
        const hash = bun.hash(rel_path);
        for (this.handlers.keys(), this.handlers.values()) |ctx, *last| {
            if (last.shouldEmit(hash, timestamp, event_type)) {
                onPathUpdateFn(ctx, event_type.toEvent(rel_path), is_file);
            }
        }
    }

    fn emitError(this: *PathWatcher, err: bun.sys.Error) void {
        for (this.handlers.keys()) |ctx| {
            onPathUpdateFn(ctx, .{ .@"error" = err }, false);
        }
    }

    /// Signals end-of-batch so `FSWatcher` can flush its queued events to the JS thread.
    /// Caller holds `manager.mutex`.
    fn flush(this: *PathWatcher) void {
        for (this.handlers.keys()) |ctx| {
            onUpdateEndFn(ctx);
        }
    }

    /// JS-thread entry point from `FSWatcher.detach()`. Removes one handler; if it was
    /// the last, tears down the OS watch and frees.
    ///
    /// All bookkeeping (handlers, dedup map, platform dispatch maps) happens under
    /// `manager.mutex` in one critical section so a concurrent `watch()` from another
    /// Worker cannot observe a zero-handler PathWatcher still present in the dedup map.
    ///
    /// On macOS the FSEvents unregister happens *after* releasing `manager.mutex`:
    /// `FSEventsWatcher.deinit()` takes the FSEvents loop mutex, and the CF thread's
    /// `_events_cb` holds that mutex while calling into `onFSEvent` (which takes
    /// `manager.mutex`). Holding both here would be AB/BA with the CF thread. Once
    /// `fse.deinit()` returns, `_events_cb` has released the loop mutex and nulled our
    /// slot, so no further callbacks will fire and `destroy()` is safe.
    pub fn detach(this: *PathWatcher, ctx: *anyopaque) void {
        const manager = this.manager orelse {
            _ = this.handlers.swapRemove(ctx);
            if (this.handlers.count() == 0) this.destroy();
            return;
        };

        manager.mutex.lock();
        _ = this.handlers.swapRemove(ctx);
        if (this.handlers.count() > 0) {
            manager.mutex.unlock();
            return;
        }

        // Last handler gone — make this watcher unreachable before dropping the lock.
        manager.unlinkWatcherLocked(this);
        this.manager = null;
        if (comptime !Environment.isMac) {
            Platform.removeWatch(manager, this);
        }
        manager.mutex.unlock();

        if (comptime Environment.isMac) {
            // Takes fsevents_loop.mutex; must not hold manager.mutex (see doc comment).
            Platform.removeWatch(manager, this);
        }
        this.destroy();
    }

    fn destroy(this: *PathWatcher) void {
        this.handlers.deinit(bun.default_allocator);
        Platform.Watch.deinit(&this.platform);
        bun.default_allocator.free(this.path);
        bun.destroy(this);
    }
};

pub fn watch(
    vm: *VirtualMachine,
    path: [:0]const u8,
    recursive: bool,
    comptime callback: PathWatcher.Callback,
    comptime updateEnd: PathWatcher.UpdateEndCallback,
    ctx: *anyopaque,
) bun.sys.Maybe(*PathWatcher) {
    // The callback/updateEnd are comptime so the emit path can call them directly
    // without an indirect-call-per-event; assert they're what node_fs_watcher passes.
    comptime bun.assert(callback == onPathUpdateFn);
    comptime bun.assert(updateEnd == onUpdateEndFn);
    _ = vm;

    const manager = switch (PathWatcherManager.get()) {
        .err => |e| return .{ .err = e },
        .result => |m| m,
    };

    // Resolve to a canonical path so `fs.watch("./x")` and `fs.watch("/abs/x")` dedup.
    // On macOS FSEvents also requires a realpath (it reports events by realpath).
    const resolve_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(resolve_buf);
    const stat = switch (bun.sys.lstat(path)) {
        .err => |e| return .{ .err = e.withoutPath() },
        .result => |s| s,
    };
    var is_file = !bun.S.ISDIR(@intCast(stat.mode));
    const resolved: [:0]const u8 = if (bun.S.ISLNK(@intCast(stat.mode))) brk: {
        // fs.watch follows symlinks.
        const fd = switch (bun.sys.open(path, bun.O.RDONLY, 0)) {
            .err => |e| return .{ .err = e.withoutPath() },
            .result => |f| f,
        };
        defer fd.close();
        const real = switch (bun.sys.getFdPath(fd, resolve_buf)) {
            .err => |e| return .{ .err = e.withoutPath() },
            .result => |r| r,
        };
        resolve_buf[real.len] = 0;
        const target_stat = switch (bun.sys.stat(resolve_buf[0..real.len :0])) {
            .err => |e| return .{ .err = e.withoutPath() },
            .result => |s| s,
        };
        is_file = !bun.S.ISDIR(@intCast(target_stat.mode));
        break :brk resolve_buf[0..real.len :0];
    } else if (comptime Environment.isMac) brk: {
        // FSEvents reports realpaths; resolve up-front so prefix matching works even
        // when the caller passed a path containing a symlinked component.
        const fd = switch (bun.sys.open(path, bun.O.RDONLY, 0)) {
            .err => |e| return .{ .err = e.withoutPath() },
            .result => |f| f,
        };
        defer fd.close();
        const real = switch (bun.sys.getFdPath(fd, resolve_buf)) {
            .err => break :brk path,
            .result => |r| r,
        };
        resolve_buf[real.len] = 0;
        break :brk resolve_buf[0..real.len :0];
    } else path;

    const key_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(key_buf);
    const key = PathWatcherManager.makeKey(key_buf, resolved, recursive);

    manager.mutex.lock();

    const gop = bun.handleOom(manager.watchers.getOrPut(bun.default_allocator, key));
    if (gop.found_existing) {
        const existing = gop.value_ptr.*;
        bun.handleOom(existing.handlers.put(bun.default_allocator, ctx, .{}));
        manager.mutex.unlock();
        return .{ .result = existing };
    }

    // New watcher: own the key and path.
    gop.key_ptr.* = bun.handleOom(bun.default_allocator.dupe(u8, key));
    const watcher = PathWatcher.new(.{
        .manager = manager,
        .path = bun.handleOom(bun.default_allocator.dupeZ(u8, resolved)),
        .recursive = recursive,
        .is_file = is_file,
    });
    bun.handleOom(watcher.handlers.put(bun.default_allocator, ctx, .{}));
    gop.value_ptr.* = watcher;

    // Linux/FreeBSD: `addWatch` mutates the platform dispatch maps (wd_map/entries)
    // which live under `manager.mutex`, so call it while still locked.
    //
    // macOS: `addWatch` calls `FSEvents.watch()` which takes the FSEvents loop mutex.
    // The CF thread holds that mutex while calling `onFSEvent`, which in turn takes
    // `manager.mutex`. To keep lock order one-way (fsevents → manager), release ours
    // first. Another Worker's `watch()` finding this PathWatcher in the interim is
    // fine — it just appends a handler; events won't deliver until the FSEventStream
    // is scheduled anyway.
    if (comptime !Environment.isMac) {
        if (Platform.addWatch(manager, watcher).asErr()) |err| {
            // Still under the same lock as the map insertion, so no other thread
            // can have observed `watcher` yet — unconditional destroy is safe.
            manager.unlinkWatcherLocked(watcher);
            manager.mutex.unlock();
            watcher.manager = null;
            watcher.destroy();
            // `Linux.addOne` builds the error with `.path = watcher.path`, which we
            // just freed; strip it like every other return in this function.
            return .{ .err = err.withoutPath() };
        }
        manager.mutex.unlock();
        return .{ .result = watcher };
    }

    manager.mutex.unlock();

    if (Platform.addWatch(manager, watcher).asErr()) |err| {
        // `watcher` was visible in the dedup map while we were unlocked above; a
        // concurrent Worker's `fs.watch()` on the same path may have attached a
        // handler and already returned `watcher` to its caller. Only destroy if
        // ours was the last handler; otherwise surface the error to the survivors
        // and leave `watcher.manager` set so their `detach()` takes the locked path
        // (→ `unlinkWatcherLocked` no-ops, `removeWatch` no-ops on null `fsevents`,
        // then frees). Never free memory another thread holds.
        manager.mutex.lock();
        manager.unlinkWatcherLocked(watcher);
        _ = watcher.handlers.swapRemove(ctx);
        if (watcher.handlers.count() > 0) {
            watcher.emitError(err);
            watcher.flush();
            manager.mutex.unlock();
            return .{ .err = err.withoutPath() };
        }
        watcher.manager = null;
        manager.mutex.unlock();
        watcher.destroy();
        return .{ .err = err.withoutPath() };
    }
    return .{ .result = watcher };
}

// --------------------------------------------------------------------------------------
// Platform backends
// --------------------------------------------------------------------------------------

const Platform = switch (Environment.os) {
    .linux => Linux,
    .mac => Darwin,
    .freebsd => Kqueue,
    // win_watcher.zig imports PathWatcher.EventType from this file, so this type must
    // resolve on Windows even though none of the code paths run. The stub keeps the
    // struct fields typed while the actual Windows backend lives in win_watcher.zig.
    .windows => struct {
        pub const Watch = struct {
            pub fn deinit(_: *@This()) void {}
        };
        fn init(_: *PathWatcherManager) bun.sys.Maybe(void) {
            return .{ .err = .{ .errno = @intFromEnum(bun.sys.E.NOTSUP), .syscall = .watch } };
        }
        fn addWatch(_: *PathWatcherManager, _: *PathWatcher) bun.sys.Maybe(void) {
            return .{ .err = .{ .errno = @intFromEnum(bun.sys.E.NOTSUP), .syscall = .watch } };
        }
        fn removeWatch(_: *PathWatcherManager, _: *PathWatcher) void {}
    },
    .wasm => @compileError("unsupported"),
};

/// Linux: one inotify fd, one blocking reader thread, wd → {PathWatcher, subpath} map.
/// Recursive watches are implemented by walking the tree at subscribe time and adding
/// a wd per directory, then adding new subdirectories as they appear (IN_CREATE|IN_ISDIR).
const Linux = struct {
    fd: bun.FD = bun.invalid_fd,
    running: std.atomic.Value(bool) = .init(true),
    /// wd → list of owners. `inotify_add_watch` returns the same wd for the same
    /// inode on a given inotify fd, so two PathWatchers whose roots overlap (e.g.
    /// a recursive watch on `/a` plus a watch on `/a/sub`) end up sharing a wd. Each
    /// owner gets its own subpath so the event can be reported relative to the right
    /// root, and `inotify_rm_watch` is only issued when the last owner detaches.
    wd_map: std.AutoHashMapUnmanaged(i32, std.ArrayListUnmanaged(WdOwner)) = .{},

    const WdOwner = struct {
        watcher: *PathWatcher,
        /// Path of the watched directory/file relative to `watcher.path`. Empty for
        /// the root. Owned; freed when this owner is removed from the wd.
        subpath: [:0]const u8,
    };

    pub const Watch = struct {
        /// All wds belonging to this PathWatcher (one for a file/non-recursive dir,
        /// many for a recursive dir).
        wds: std.ArrayListUnmanaged(i32) = .{},

        pub fn deinit(this: *Watch) void {
            this.wds.deinit(bun.default_allocator);
        }
    };

    const IN = std.os.linux.IN;
    const watch_file_mask: u32 = IN.MODIFY | IN.ATTRIB | IN.MOVE_SELF | IN.DELETE_SELF;
    const watch_dir_mask: u32 = IN.MODIFY | IN.ATTRIB | IN.CREATE | IN.DELETE | IN.DELETE_SELF |
        IN.MOVED_FROM | IN.MOVED_TO | IN.MOVE_SELF | IN.ONLYDIR;

    fn init(manager: *PathWatcherManager) bun.sys.Maybe(void) {
        const fd = std.posix.inotify_init1(IN.CLOEXEC) catch |e| return .{ .err = .{
            .errno = @intFromEnum(switch (e) {
                error.ProcessFdQuotaExceeded, error.SystemFdQuotaExceeded => bun.sys.E.MFILE,
                error.SystemResources => bun.sys.E.NOMEM,
                error.Unexpected => bun.sys.E.INVAL,
            }),
            .syscall = .watch,
        } };
        manager.platform.fd = .fromNative(fd);
        // The manager is process-global and never torn down, so the reader thread is
        // a daemon — detach it instead of stashing a handle we'd never join.
        var thread = std.Thread.spawn(.{}, threadMain, .{manager}) catch {
            manager.platform.fd.close();
            return .{ .err = .{ .errno = @intFromEnum(bun.sys.E.NOMEM), .syscall = .watch } };
        };
        thread.detach();
        return .success;
    }

    /// Caller holds `manager.mutex`.
    fn addWatch(manager: *PathWatcherManager, watcher: *PathWatcher) bun.sys.Maybe(void) {
        switch (addOne(manager, watcher, watcher.path, "")) {
            .err => |e| return .{ .err = e },
            .result => {},
        }
        if (watcher.recursive and !watcher.is_file) {
            walkAndAdd(manager, watcher, watcher.path, "");
        }
        return .success;
    }

    /// Add a single inotify watch and record ownership. Caller holds `manager.mutex`.
    fn addOne(
        manager: *PathWatcherManager,
        watcher: *PathWatcher,
        abs_path: [:0]const u8,
        subpath: []const u8,
    ) bun.sys.Maybe(void) {
        const plat = &manager.platform;
        const mask: u32 = if (watcher.is_file and subpath.len == 0) watch_file_mask else watch_dir_mask;
        const rc = std.posix.system.inotify_add_watch(plat.fd.cast(), abs_path, mask);
        if (bun.sys.Maybe(void).errnoSysP(rc, .watch, abs_path)) |err| {
            // ENOTDIR/ENOENT during a recursive walk just means we raced; skip.
            if (subpath.len > 0) return .success;
            return err;
        }
        const wd: i32 = @intCast(rc);
        const gop = bun.handleOom(plat.wd_map.getOrPut(bun.default_allocator, wd));
        if (!gop.found_existing) gop.value_ptr.* = .{};
        // This wd may already have this watcher as an owner:
        //   - IN_CREATE raced the initial walk (same subpath → the reassign is a no-op)
        //   - a subdirectory was *renamed* within the tree: IN_MOVED_TO re-adds it,
        //     inotify returns the same wd (it watches by inode), and the cached subpath
        //     is now stale. Overwrite so later events under the moved dir report the
        //     new name. `walkAndAdd` never follows symlinks (`entry.kind == .directory`,
        //     not `.sym_link`), so this can't pick a longer alias via a cycle.
        for (gop.value_ptr.items) |*o| {
            if (o.watcher == watcher) {
                if (!bun.strings.eql(o.subpath, subpath)) {
                    const old = o.subpath;
                    o.subpath = bun.handleOom(bun.default_allocator.dupeZ(u8, subpath));
                    bun.default_allocator.free(old);
                }
                return .success;
            }
        }
        bun.handleOom(gop.value_ptr.append(bun.default_allocator, .{
            .watcher = watcher,
            .subpath = bun.handleOom(bun.default_allocator.dupeZ(u8, subpath)),
        }));
        bun.handleOom(watcher.platform.wds.append(bun.default_allocator, wd));
        log("inotify_add_watch({s}) → wd={d} sub='{s}' owners={d}", .{ abs_path, wd, subpath, gop.value_ptr.items.len });
        return .success;
    }

    /// Best-effort recursive directory walk. Errors on individual entries are ignored
    /// (matches Node: an unreadable subdirectory doesn't fail the whole watch).
    fn walkAndAdd(
        manager: *PathWatcherManager,
        watcher: *PathWatcher,
        abs_dir: [:0]const u8,
        rel_dir: []const u8,
    ) void {
        var dir = std.fs.openDirAbsoluteZ(abs_dir, .{ .iterate = true }) catch return;
        defer dir.close();
        var it = dir.iterate();
        const abs_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(abs_buf);
        const rel_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(rel_buf);
        while (it.next() catch null) |entry| {
            if (entry.kind != .directory) continue;
            const child_abs = std.fmt.bufPrintZ(abs_buf, "{s}/{s}", .{ abs_dir, entry.name }) catch continue;
            const child_rel = if (rel_dir.len == 0)
                std.fmt.bufPrint(rel_buf, "{s}", .{entry.name}) catch continue
            else
                std.fmt.bufPrint(rel_buf, "{s}/{s}", .{ rel_dir, entry.name }) catch continue;
            _ = addOne(manager, watcher, child_abs, child_rel);
            walkAndAdd(manager, watcher, child_abs, child_rel);
        }
    }

    /// Caller holds `manager.mutex`. Drops this watcher's ownership of each of its
    /// wds; only issues `inotify_rm_watch` once a wd has no remaining owners.
    fn removeWatch(manager: *PathWatcherManager, watcher: *PathWatcher) void {
        const plat = &manager.platform;
        for (watcher.platform.wds.items) |wd| {
            const owners = plat.wd_map.getPtr(wd) orelse continue;
            var j: usize = 0;
            while (j < owners.items.len) {
                if (owners.items[j].watcher == watcher) {
                    bun.default_allocator.free(owners.items[j].subpath);
                    _ = owners.swapRemove(j);
                } else j += 1;
            }
            if (owners.items.len == 0) {
                owners.deinit(bun.default_allocator);
                _ = plat.wd_map.remove(wd);
                _ = std.posix.system.inotify_rm_watch(plat.fd.cast(), wd);
            }
        }
        watcher.platform.wds.clearRetainingCapacity();
    }

    const InotifyEvent = extern struct {
        wd: i32,
        mask: u32,
        cookie: u32,
        len: u32,
    };

    fn threadMain(manager: *PathWatcherManager) void {
        Output.Source.configureNamedThread("fs.watch");
        const plat = &manager.platform;
        // Large enough for a burst of events; inotify guarantees whole events per read.
        var buf: [64 * 1024]u8 align(@alignOf(InotifyEvent)) = undefined;
        var path_buf: bun.PathBuffer = undefined;

        while (plat.running.load(.acquire)) {
            const rc = std.posix.system.read(plat.fd.cast(), &buf, buf.len);
            switch (std.posix.errno(rc)) {
                .SUCCESS => {},
                .AGAIN, .INTR => continue,
                else => |errno| {
                    // Fatal: surface to every watcher, then exit the thread.
                    const err: bun.sys.Error = .{
                        .errno = @truncate(@intFromEnum(errno)),
                        .syscall = .read,
                    };
                    manager.mutex.lock();
                    for (manager.watchers.values()) |w| {
                        w.emitError(err);
                        w.flush();
                    }
                    manager.mutex.unlock();
                    return;
                },
            }
            const n: usize = @intCast(rc);
            if (n == 0) continue;

            manager.mutex.lock();
            // Track which PathWatchers got at least one event so we flush() each once.
            var touched: std.AutoArrayHashMapUnmanaged(*PathWatcher, void) = .{};
            defer touched.deinit(bun.default_allocator);

            var i: usize = 0;
            while (i < n) {
                const ev: *align(1) const InotifyEvent = @ptrCast(buf[i..].ptr);
                i += @sizeOf(InotifyEvent) + ev.len;

                // Kernel retired this wd (rm_watch, or the watched inode is gone).
                if (ev.mask & IN.IGNORED != 0) {
                    if (plat.wd_map.getPtr(ev.wd)) |owners| {
                        for (owners.items) |o| {
                            bun.default_allocator.free(o.subpath);
                            if (std.mem.indexOfScalar(i32, o.watcher.platform.wds.items, ev.wd)) |idx| {
                                _ = o.watcher.platform.wds.swapRemove(idx);
                            }
                        }
                        owners.deinit(bun.default_allocator);
                        _ = plat.wd_map.remove(ev.wd);
                    }
                    continue;
                }

                if (plat.wd_map.getPtr(ev.wd) == null) continue;

                const name: []const u8 = if (ev.len > 0) blk: {
                    const name_ptr: [*:0]const u8 = @ptrCast(buf[i - ev.len ..].ptr);
                    break :blk bun.sliceTo(name_ptr, 0);
                } else "";

                const is_dir_child = ev.mask & IN.ISDIR != 0;
                const event_type: PathWatcher.EventType = if (ev.mask &
                    (IN.CREATE | IN.DELETE | IN.DELETE_SELF | IN.MOVE_SELF | IN.MOVED_FROM | IN.MOVED_TO) != 0)
                    .rename
                else
                    .change;

                // Dispatch to every owner of this wd. The recursive branch below calls
                // `addOne`/`walkAndAdd`, which insert into `wd_map` via `getOrPut` and
                // may rehash — that would invalidate any pointer into the map's value
                // storage. Re-fetch the owners list by key each iteration rather than
                // caching `getPtr(ev.wd)` across the loop.
                var oi: usize = 0;
                while (true) : (oi += 1) {
                    const owners = plat.wd_map.getPtr(ev.wd) orelse break;
                    if (oi >= owners.items.len) break;
                    const owner = owners.items[oi];
                    const watcher = owner.watcher;
                    // `owner.subpath` is heap-owned by the entry and stays valid across a
                    // rehash (only the ArrayList header moves), so copying it out here is
                    // not required.

                    // Build the path relative to this owner's root.
                    const rel: []const u8 = if (watcher.is_file) blk: {
                        break :blk std.fs.path.basename(watcher.path);
                    } else if (owner.subpath.len == 0) blk: {
                        break :blk name;
                    } else if (name.len == 0) blk: {
                        break :blk owner.subpath;
                    } else blk: {
                        break :blk std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ owner.subpath, name }) catch owner.subpath;
                    };

                    watcher.emit(event_type, rel, !is_dir_child and !(ev.mask & (IN.DELETE_SELF | IN.MOVE_SELF) != 0 and !watcher.is_file));
                    _ = bun.handleOom(touched.getOrPut(bun.default_allocator, watcher));

                    // Recursive: a new directory appeared under this owner's tree —
                    // start watching it so future events inside it are delivered.
                    // This is what makes `{recursive: true}` track structure changes
                    // after the initial crawl (#15939/#15085).
                    if (watcher.recursive and is_dir_child and (ev.mask & (IN.CREATE | IN.MOVED_TO) != 0) and name.len > 0) {
                        const abs_buf = bun.path_buffer_pool.get();
                        defer bun.path_buffer_pool.put(abs_buf);
                        const child_abs = if (owner.subpath.len == 0)
                            std.fmt.bufPrintZ(abs_buf, "{s}/{s}", .{ watcher.path, name }) catch continue
                        else
                            std.fmt.bufPrintZ(abs_buf, "{s}/{s}/{s}", .{ watcher.path, owner.subpath, name }) catch continue;
                        // These may rehash `wd_map`; `owners` is re-fetched next iteration.
                        _ = addOne(manager, watcher, child_abs, rel);
                        walkAndAdd(manager, watcher, child_abs, rel);
                    }
                }
            }

            for (touched.keys()) |w| w.flush();
            manager.mutex.unlock();
        }
    }
};

/// macOS: delegate to `fs_events.zig`, which already runs one CFRunLoop thread with
/// one FSEventStream covering every watched path. The PathWatcher itself is the
/// FSEventsWatcher's opaque ctx — `fs_events.zig` calls back via `onFSEvent` below,
/// and we fan out to the JS handlers.
///
/// Unlike the old design, FSEvents is used for both files and directories (same as
/// libuv), so `fs.watch()` no longer spins up a second kqueue thread.
const Darwin = struct {
    /// No manager-level state — FSEvents has its own process-global loop.
    pub const Watch = struct {
        fsevents: ?*FSEvents.FSEventsWatcher = null,

        pub fn deinit(this: *Watch) void {
            if (this.fsevents) |fse| {
                this.fsevents = null;
                fse.deinit();
            }
        }
    };

    fn init(_: *PathWatcherManager) bun.sys.Maybe(void) {
        return .success;
    }

    /// Caller does NOT hold `manager.mutex` — `FSEvents.watch()` takes the FSEvents
    /// loop mutex, and the CF thread holds that while calling `onFSEvent` (which
    /// takes `manager.mutex`). Keeping this call outside `manager.mutex` makes the
    /// lock order one-way: fsevents_loop.mutex → manager.mutex.
    fn addWatch(_: *PathWatcherManager, watcher: *PathWatcher) bun.sys.Maybe(void) {
        watcher.platform.fsevents = FSEvents.watch(
            watcher.path,
            watcher.recursive,
            onFSEvent,
            onFSEventFlush,
            @ptrCast(watcher),
        ) catch |e| return .{ .err = .{
            .errno = @intFromEnum(switch (e) {
                error.FailedToCreateCoreFoudationSourceLoop => bun.sys.E.INVAL,
                else => bun.sys.E.NOMEM,
            }),
            .syscall = .watch,
        } };
        return .success;
    }

    /// Caller does NOT hold `manager.mutex` (same lock-order reasoning as `addWatch`).
    /// `FSEventsWatcher.deinit()` → `unregisterWatcher()` blocks on the FSEvents loop
    /// mutex, which `_events_cb` holds for the whole dispatch; once this returns no
    /// further `onFSEvent` calls will arrive for `watcher`.
    fn removeWatch(_: *PathWatcherManager, watcher: *PathWatcher) void {
        if (watcher.platform.fsevents) |fse| {
            watcher.platform.fsevents = null;
            fse.deinit();
        }
    }

    /// Called from the CFRunLoop thread (`fs_events.zig`'s `_events_cb`) with the
    /// FSEvents loop mutex held. Take `manager.mutex` so iterating `handlers` can't
    /// race with `watch()`/`detach()` mutating it. The JS thread never holds
    /// `manager.mutex` across a call into FSEvents, so this is deadlock-free.
    ///
    /// `watcher` itself is kept alive by the FSEvents loop mutex: `detach()` →
    /// `removeWatch()` → `fse.deinit()` → `unregisterWatcher()` blocks until
    /// `_events_cb` releases it, so `destroy()` cannot run under us. The
    /// `watcher.manager == null` check catches the window where detach has already
    /// unlinked us but hasn't yet called `fse.deinit()`.
    fn onFSEvent(ctx: ?*anyopaque, event: Event, is_file: bool) void {
        const watcher: *PathWatcher = @ptrCast(@alignCast(ctx.?));
        const manager = default_manager orelse return;
        manager.mutex.lock();
        defer manager.mutex.unlock();
        if (watcher.manager == null) return;
        switch (event) {
            inline .rename, .change => |path, tag| {
                watcher.emit(@field(PathWatcher.EventType, @tagName(tag)), path, is_file);
            },
            .@"error" => |err| watcher.emitError(err),
            else => {},
        }
    }

    fn onFSEventFlush(ctx: ?*anyopaque) void {
        const watcher: *PathWatcher = @ptrCast(@alignCast(ctx.?));
        const manager = default_manager orelse return;
        manager.mutex.lock();
        defer manager.mutex.unlock();
        if (watcher.manager == null) return;
        watcher.flush();
    }
};

/// FreeBSD (and any future kqueue-only platform): one kqueue fd, one blocking reader
/// thread, per-watch open file descriptors registered with EVFILT_VNODE. kqueue gives
/// no filenames, so directory events surface as a bare `rename` with an empty path —
/// same behaviour as libuv on FreeBSD; callers are expected to re-scan.
const Kqueue = struct {
    kq: bun.FD = bun.invalid_fd,
    running: std.atomic.Value(bool) = .init(true),
    /// ident (fd number) → entry. `udata` on the kevent also carries the *KqEntry so
    /// dispatch is a single pointer chase; the map is for cleanup.
    entries: std.AutoArrayHashMapUnmanaged(i32, *KqEntry) = .{},

    const KqEntry = struct {
        watcher: *PathWatcher,
        fd: bun.FD,
        /// Relative to watcher.path; empty for the root.
        subpath: [:0]const u8,
        is_file: bool,
    };

    pub const Watch = struct {
        fds: std.ArrayListUnmanaged(i32) = .{},

        pub fn deinit(this: *Watch) void {
            this.fds.deinit(bun.default_allocator);
        }
    };

    fn init(manager: *PathWatcherManager) bun.sys.Maybe(void) {
        const fd = std.posix.kqueue() catch return .{
            .err = .{ .errno = @intFromEnum(bun.sys.E.MFILE), .syscall = .kqueue },
        };
        manager.platform.kq = .fromNative(fd);
        // Daemon reader — the manager is process-global and never torn down.
        var thread = std.Thread.spawn(.{}, threadMain, .{manager}) catch {
            manager.platform.kq.close();
            return .{ .err = .{ .errno = @intFromEnum(bun.sys.E.NOMEM), .syscall = .watch } };
        };
        thread.detach();
        return .success;
    }

    /// Caller holds `manager.mutex`.
    fn addWatch(manager: *PathWatcherManager, watcher: *PathWatcher) bun.sys.Maybe(void) {
        switch (addOne(manager, watcher, watcher.path, "", watcher.is_file)) {
            .err => |e| return .{ .err = e },
            .result => {},
        }
        if (watcher.recursive and !watcher.is_file) {
            walkAndAdd(manager, watcher, watcher.path, "");
        }
        return .success;
    }

    fn addOne(
        manager: *PathWatcherManager,
        watcher: *PathWatcher,
        abs_path: [:0]const u8,
        subpath: []const u8,
        is_file: bool,
    ) bun.sys.Maybe(void) {
        const plat = &manager.platform;
        const fd = switch (bun.sys.open(abs_path, bun.O.RDONLY, 0)) {
            .err => |e| {
                if (subpath.len > 0) return .success; // best-effort on children
                return .{ .err = e.withoutPath() };
            },
            .result => |f| f,
        };
        const entry = bun.handleOom(bun.default_allocator.create(KqEntry));
        entry.* = .{
            .watcher = watcher,
            .fd = fd,
            .subpath = bun.handleOom(bun.default_allocator.dupeZ(u8, subpath)),
            .is_file = is_file,
        };
        var kev = std.mem.zeroes(std.c.Kevent);
        kev.ident = @intCast(fd.native());
        kev.filter = std.c.EVFILT.VNODE;
        kev.flags = std.c.EV.ADD | std.c.EV.CLEAR | std.c.EV.ENABLE;
        kev.fflags = std.c.NOTE.WRITE | std.c.NOTE.DELETE | std.c.NOTE.RENAME |
            std.c.NOTE.EXTEND | std.c.NOTE.ATTRIB | std.c.NOTE.LINK | std.c.NOTE.REVOKE;
        kev.udata = @intFromPtr(entry);
        var changes = [_]std.c.Kevent{kev};
        const krc = std.posix.system.kevent(plat.kq.native(), &changes, 1, &changes, 0, null);
        if (krc < 0) {
            // Registration failed (ENOMEM/EINVAL on a bad fd, etc.). Don't leave a
            // dead entry in the map that will never deliver events.
            const errno = std.posix.errno(krc);
            fd.close();
            bun.default_allocator.free(entry.subpath);
            bun.default_allocator.destroy(entry);
            if (subpath.len > 0) return .success; // best-effort on children
            return .{ .err = .{ .errno = @truncate(@intFromEnum(errno)), .syscall = .kevent } };
        }

        bun.handleOom(plat.entries.put(bun.default_allocator, @intCast(fd.native()), entry));
        bun.handleOom(watcher.platform.fds.append(bun.default_allocator, @intCast(fd.native())));
        return .success;
    }

    fn walkAndAdd(
        manager: *PathWatcherManager,
        watcher: *PathWatcher,
        abs_dir: [:0]const u8,
        rel_dir: []const u8,
    ) void {
        var dir = std.fs.openDirAbsoluteZ(abs_dir, .{ .iterate = true }) catch return;
        defer dir.close();
        var it = dir.iterate();
        const abs_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(abs_buf);
        const rel_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(rel_buf);
        while (it.next() catch null) |ent| {
            const child_abs = std.fmt.bufPrintZ(abs_buf, "{s}/{s}", .{ abs_dir, ent.name }) catch continue;
            const child_rel = if (rel_dir.len == 0)
                std.fmt.bufPrint(rel_buf, "{s}", .{ent.name}) catch continue
            else
                std.fmt.bufPrint(rel_buf, "{s}/{s}", .{ rel_dir, ent.name }) catch continue;
            const child_is_file = ent.kind != .directory;
            _ = addOne(manager, watcher, child_abs, child_rel, child_is_file);
            if (!child_is_file) walkAndAdd(manager, watcher, child_abs, child_rel);
        }
    }

    /// Caller holds `manager.mutex`.
    fn removeWatch(manager: *PathWatcherManager, watcher: *PathWatcher) void {
        const plat = &manager.platform;
        for (watcher.platform.fds.items) |ident| {
            if (plat.entries.fetchSwapRemove(ident)) |kv| {
                // Closing the fd auto-removes the kevent.
                kv.value.fd.close();
                bun.default_allocator.free(kv.value.subpath);
                bun.default_allocator.destroy(kv.value);
            }
        }
        watcher.platform.fds.clearRetainingCapacity();
    }

    fn threadMain(manager: *PathWatcherManager) void {
        Output.Source.configureNamedThread("fs.watch");
        const plat = &manager.platform;
        var events: [128]std.c.Kevent = undefined;
        while (plat.running.load(.acquire)) {
            const count = std.posix.system.kevent(plat.kq.native(), &events, 0, &events, events.len, null);
            if (count <= 0) continue;

            manager.mutex.lock();
            var touched: std.AutoArrayHashMapUnmanaged(*PathWatcher, void) = .{};
            defer touched.deinit(bun.default_allocator);

            for (events[0..@intCast(count)]) |kev| {
                // Validate via the map — the entry may have been freed by a racing
                // removeWatch between kevent() returning and us taking the lock. POSIX
                // recycles the lowest fd on open(), so the ident could also now belong
                // to an *unrelated* watch registered in that same window; `udata` was
                // set to the original entry pointer at registration and survives in the
                // already-delivered event, so use it to reject stale fd-reuse hits.
                const entry = plat.entries.get(@intCast(kev.ident)) orelse continue;
                if (@intFromPtr(entry) != kev.udata) continue;
                const watcher = entry.watcher;

                const event_type: PathWatcher.EventType = if (kev.fflags &
                    (std.c.NOTE.DELETE | std.c.NOTE.RENAME | std.c.NOTE.REVOKE | std.c.NOTE.LINK) != 0)
                    .rename
                else
                    .change;

                // kqueue has no filenames. For a file watch, report the basename; for a
                // directory, report the subpath (empty for root → caller re-scans).
                const rel: []const u8 = if (entry.is_file and entry.subpath.len == 0)
                    std.fs.path.basename(watcher.path)
                else
                    entry.subpath;

                watcher.emit(event_type, rel, entry.is_file);
                _ = bun.handleOom(touched.getOrPut(bun.default_allocator, watcher));
            }

            for (touched.keys()) |w| w.flush();
            manager.mutex.unlock();
        }
    }
};

const FSEvents = if (Environment.isMac) @import("./fs_events.zig") else struct {};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Mutex = bun.Mutex;
const Output = bun.Output;

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;

const FSWatcher = bun.jsc.Node.fs.Watcher;
const Event = FSWatcher.Event;
const onPathUpdateFn = FSWatcher.onPathUpdate;
const onUpdateEndFn = FSWatcher.onUpdateEnd;
