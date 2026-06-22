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

    // Resolve to a canonical path so `fs.watch("./x")` and `fs.watch("/abs/x")` dedup;
    // FSEvents reports events by realpath so macOS needs this for prefix matching too.
    //
    // Open with O_PATH|O_DIRECTORY first and retry without O_DIRECTORY on ENOTDIR —
    // that tells us file-vs-dir without a separate stat, follows symlinks, and the
    // resulting fd feeds `getFdPath` for the realpath. One or two syscalls instead
    // of lstat + open + (stat) in the old code. `O.PATH` is 0 on macOS (degrades to
    // O_RDONLY, which is what F_GETPATH needs anyway).
    const resolve_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(resolve_buf);
    var is_file = false;
    const probe_fd: bun.FD = switch (bun.sys.open(path, bun.O.PATH | bun.O.DIRECTORY | bun.O.CLOEXEC, 0)) {
        .result => |f| f,
        .err => |e| if (e.getErrno() == .NOTDIR) retry: {
            is_file = true;
            break :retry switch (bun.sys.open(path, bun.O.PATH | bun.O.CLOEXEC, 0)) {
                .result => |f| f,
                .err => |e2| return .{ .err = e2.withoutPath() },
            };
        } else return .{ .err = e.withoutPath() },
    };
    defer probe_fd.close();
    const resolved: [:0]const u8 = switch (bun.sys.getFdPath(probe_fd, resolve_buf)) {
        .err => path, // fall back to the caller's path; best effort
        .result => |r| brk: {
            resolve_buf[r.len] = 0;
            break :brk resolve_buf[0..r.len :0];
        },
    };

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

/// Shared recursive directory walk for Linux and Kqueue: open `abs_dir`, iterate,
/// and for every entry call `cb` with (abs, rel, is_file); recurse into
/// subdirectories. When `dirs_only`, non-directory entries are skipped entirely
/// (inotify delivers file events on the parent dir's wd so we only need a watch
/// per directory; kqueue needs an fd per file too). Best-effort — an unreadable
/// subdirectory just stops that branch (matches Node). Uses `bun.sys` /
/// `bun.DirIterator` / `bun.path` throughout; no std.fs.
fn walkSubtree(
    abs_dir: [:0]const u8,
    rel_dir: []const u8,
    comptime dirs_only: bool,
    ctx: anytype,
    comptime cb: fn (ctx: @TypeOf(ctx), abs: [:0]const u8, rel: []const u8, is_file: bool) void,
) void {
    const dfd = switch (bun.sys.open(abs_dir, bun.O.RDONLY | bun.O.DIRECTORY | bun.O.CLOEXEC, 0)) {
        .err => return,
        .result => |f| f,
    };
    defer dfd.close();
    var it = bun.DirIterator.iterate(dfd, .u8);
    const abs_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(abs_buf);
    const rel_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(rel_buf);
    while (switch (it.next()) {
        .err => return,
        .result => |r| r,
    }) |entry| {
        const child_is_file = entry.kind != .directory;
        if (dirs_only and child_is_file) continue;
        const name = entry.name.slice();
        const child_abs = bun.path.joinZBuf(abs_buf, &[_][]const u8{ abs_dir, name }, .posix);
        const child_rel: []const u8 = if (rel_dir.len == 0)
            name
        else
            bun.path.joinStringBuf(rel_buf, &[_][]const u8{ rel_dir, name }, .posix);
        cb(ctx, child_abs, child_rel, child_is_file);
        if (!child_is_file) walkSubtree(child_abs, child_rel, dirs_only, ctx, cb);
    }
}

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
        const rc = bun.sys.syscall.inotify_init1(IN.CLOEXEC);
        if (bun.sys.Maybe(void).errnoSys(rc, .watch)) |err| return err;
        manager.platform.fd = .fromNative(@intCast(rc));
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
        const rc = bun.sys.syscall.inotify_add_watch(plat.fd.cast(), abs_path, mask);
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

    /// Best-effort recursive directory walk. inotify watches are per-directory (events
    /// for files arrive on their parent's wd), so only descend into subdirectories.
    fn walkAndAdd(manager: *PathWatcherManager, watcher: *PathWatcher, abs_dir: [:0]const u8, rel_dir: []const u8) void {
        const Ctx = struct { m: *PathWatcherManager, w: *PathWatcher };
        walkSubtree(abs_dir, rel_dir, true, Ctx{ .m = manager, .w = watcher }, struct {
            fn f(ctx: Ctx, abs: [:0]const u8, rel: []const u8, _: bool) void {
                _ = addOne(ctx.m, ctx.w, abs, rel);
            }
        }.f);
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
                _ = bun.sys.syscall.inotify_rm_watch(plat.fd.cast(), wd);
            }
        }
        watcher.platform.wds.clearRetainingCapacity();
    }

    /// The kernel `struct inotify_event` header. Shared with the bundler watcher;
    /// field naming there is `watch_descriptor` / `name_len`.
    const InotifyEvent = @import("../../watcher/INotifyWatcher.zig").Event;

    fn threadMain(manager: *PathWatcherManager) void {
        Output.Source.configureNamedThread("fs.watch");
        const plat = &manager.platform;
        // Large enough for a burst of events; inotify guarantees whole events per read.
        var buf: [64 * 1024]u8 align(@alignOf(InotifyEvent)) = undefined;
        var path_buf: bun.PathBuffer = undefined;

        while (plat.running.load(.acquire)) {
            const rc = bun.sys.syscall.read(plat.fd.cast(), &buf, buf.len);
            switch (bun.sys.getErrno(rc)) {
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
                i += @sizeOf(InotifyEvent) + ev.name_len;
                const wd = ev.watch_descriptor;

                // Kernel retired this wd (rm_watch, or the watched inode is gone).
                if (ev.mask & IN.IGNORED != 0) {
                    if (plat.wd_map.getPtr(wd)) |owners| {
                        for (owners.items) |o| {
                            bun.default_allocator.free(o.subpath);
                            if (std.mem.indexOfScalar(i32, o.watcher.platform.wds.items, wd)) |idx| {
                                _ = o.watcher.platform.wds.swapRemove(idx);
                            }
                        }
                        owners.deinit(bun.default_allocator);
                        _ = plat.wd_map.remove(wd);
                    }
                    continue;
                }

                if (plat.wd_map.getPtr(wd) == null) continue;

                const name: []const u8 = if (ev.name_len > 0) blk: {
                    const name_ptr: [*:0]const u8 = @ptrCast(buf[i - ev.name_len ..].ptr);
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
                // caching `getPtr(wd)` across the loop.
                var oi: usize = 0;
                while (true) : (oi += 1) {
                    const owners = plat.wd_map.getPtr(wd) orelse break;
                    if (oi >= owners.items.len) break;
                    const owner = owners.items[oi];
                    const watcher = owner.watcher;
                    // `owner.subpath` is heap-owned by the entry and stays valid across a
                    // rehash (only the ArrayList header moves), so copying it out here is
                    // not required.

                    // Build the path relative to this owner's root.
                    const rel: []const u8 = if (watcher.is_file)
                        bun.path.basename(watcher.path)
                    else if (owner.subpath.len == 0)
                        name
                    else if (name.len == 0)
                        owner.subpath
                    else
                        bun.path.joinStringBuf(&path_buf, &[_][]const u8{ owner.subpath, name }, .posix);

                    watcher.emit(event_type, rel, !is_dir_child and !(ev.mask & (IN.DELETE_SELF | IN.MOVE_SELF) != 0 and !watcher.is_file));
                    _ = bun.handleOom(touched.getOrPut(bun.default_allocator, watcher));

                    // Recursive: a new directory appeared under this owner's tree —
                    // start watching it so future events inside it are delivered.
                    // This is what makes `{recursive: true}` track structure changes
                    // after the initial crawl (#15939/#15085).
                    if (watcher.recursive and is_dir_child and (ev.mask & (IN.CREATE | IN.MOVED_TO) != 0) and name.len > 0) {
                        const abs_buf = bun.path_buffer_pool.get();
                        defer bun.path_buffer_pool.put(abs_buf);
                        const child_abs = bun.path.joinZBuf(abs_buf, &[_][]const u8{ watcher.path, owner.subpath, name }, .posix);
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
    /// ident (fd number) → entry (by value — avoids a per-entry heap alloc for
    /// recursive trees). `udata` on the kevent carries a monotonic generation number
    /// so the reader can reject stale events after the fd is recycled.
    entries: std.AutoArrayHashMapUnmanaged(i32, KqEntry) = .{},
    /// Bumped on every `addOne` and stored in both `KqEntry.gen` and `kev.udata`.
    next_gen: usize = 1,

    const KqEntry = struct {
        watcher: *PathWatcher,
        fd: bun.FD,
        /// Relative to watcher.path; empty for the root. Owned.
        subpath: [:0]const u8,
        gen: usize,
        is_file: bool,
    };

    pub const Watch = struct {
        fds: std.ArrayListUnmanaged(i32) = .{},

        pub fn deinit(this: *Watch) void {
            this.fds.deinit(bun.default_allocator);
        }
    };

    fn init(manager: *PathWatcherManager) bun.sys.Maybe(void) {
        const rc = bun.sys.syscall.kqueue();
        if (bun.sys.Maybe(void).errnoSys(rc, .kqueue)) |err| return err;
        manager.platform.kq = .fromNative(rc);
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
            // kqueue needs an open fd per *file* as well as per directory.
            const Ctx = struct { m: *PathWatcherManager, w: *PathWatcher };
            walkSubtree(watcher.path, "", false, Ctx{ .m = manager, .w = watcher }, struct {
                fn f(ctx: Ctx, abs: [:0]const u8, rel: []const u8, is_file: bool) void {
                    _ = addOne(ctx.m, ctx.w, abs, rel, is_file);
                }
            }.f);
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
        // O_EVTONLY: we only need the fd for kevent registration, never for I/O.
        // (No-op on FreeBSD where EVTONLY is 0; semantic here for kqueue-on-macOS.)
        const fd = switch (bun.sys.open(abs_path, bun.O.EVTONLY | bun.O.RDONLY | bun.O.CLOEXEC, 0)) {
            .err => |e| {
                if (subpath.len > 0) return .success; // best-effort on children
                return .{ .err = e.withoutPath() };
            },
            .result => |f| f,
        };

        const gen = plat.next_gen;
        plat.next_gen +%= 1;

        var kev = std.mem.zeroes(std.c.Kevent);
        kev.ident = @intCast(fd.native());
        kev.filter = std.c.EVFILT.VNODE;
        kev.flags = std.c.EV.ADD | std.c.EV.CLEAR | std.c.EV.ENABLE;
        kev.fflags = std.c.NOTE.WRITE | std.c.NOTE.DELETE | std.c.NOTE.RENAME |
            std.c.NOTE.EXTEND | std.c.NOTE.ATTRIB | std.c.NOTE.LINK | std.c.NOTE.REVOKE;
        kev.udata = gen;
        var changes = [_]std.c.Kevent{kev};
        const krc = bun.sys.syscall.kevent(plat.kq.native(), &changes, 1, &changes, 0, null);
        if (krc < 0) {
            // Registration failed (ENOMEM/EINVAL on a bad fd, etc.). Don't leave a
            // dead entry in the map that will never deliver events.
            const errno = bun.sys.getErrno(krc);
            fd.close();
            if (subpath.len > 0) return .success; // best-effort on children
            return .{ .err = .{ .errno = @truncate(@intFromEnum(errno)), .syscall = .kevent } };
        }

        bun.handleOom(plat.entries.put(bun.default_allocator, @intCast(fd.native()), .{
            .watcher = watcher,
            .fd = fd,
            .subpath = bun.handleOom(bun.default_allocator.dupeZ(u8, subpath)),
            .gen = gen,
            .is_file = is_file,
        }));
        bun.handleOom(watcher.platform.fds.append(bun.default_allocator, @intCast(fd.native())));
        return .success;
    }

    /// Caller holds `manager.mutex`.
    fn removeWatch(manager: *PathWatcherManager, watcher: *PathWatcher) void {
        const plat = &manager.platform;
        for (watcher.platform.fds.items) |ident| {
            if (plat.entries.fetchSwapRemove(ident)) |kv| {
                // Closing the fd auto-removes the kevent.
                kv.value.fd.close();
                bun.default_allocator.free(kv.value.subpath);
            }
        }
        watcher.platform.fds.clearRetainingCapacity();
    }

    fn threadMain(manager: *PathWatcherManager) void {
        Output.Source.configureNamedThread("fs.watch");
        const plat = &manager.platform;
        var events: [128]std.c.Kevent = undefined;
        while (plat.running.load(.acquire)) {
            const count = bun.sys.syscall.kevent(plat.kq.native(), &events, 0, &events, events.len, null);
            if (count <= 0) continue;

            manager.mutex.lock();
            var touched: std.AutoArrayHashMapUnmanaged(*PathWatcher, void) = .{};
            defer touched.deinit(bun.default_allocator);

            for (events[0..@intCast(count)]) |kev| {
                // Validate via the map — the entry may have been freed by a racing
                // removeWatch between kevent() returning and us taking the lock. POSIX
                // recycles the lowest fd on open(), so the ident could also now belong
                // to an *unrelated* watch registered in that same window; `udata` was
                // set to a monotonic generation at registration and survives in the
                // already-delivered event, so compare it to the current entry's gen
                // to reject stale fd-reuse hits.
                const entry = plat.entries.getPtr(@intCast(kev.ident)) orelse continue;
                if (entry.gen != kev.udata) continue;
                const watcher = entry.watcher;

                const event_type: PathWatcher.EventType = if (kev.fflags &
                    (std.c.NOTE.DELETE | std.c.NOTE.RENAME | std.c.NOTE.REVOKE | std.c.NOTE.LINK) != 0)
                    .rename
                else
                    .change;

                // kqueue has no filenames. For a file watch, report the basename; for a
                // directory, report the subpath (empty for root → caller re-scans).
                const rel: []const u8 = if (entry.is_file and entry.subpath.len == 0)
                    bun.path.basename(watcher.path)
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
