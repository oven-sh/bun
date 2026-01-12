const log = bun.Output.scoped(.StatWatcher, .visible);

fn statToJSStats(globalThis: *jsc.JSGlobalObject, stats: *const bun.sys.PosixStat, bigint: bool) bun.JSError!jsc.JSValue {
    if (bigint) {
        return StatsBig.init(stats).toJS(globalThis);
    } else {
        return StatsSmall.init(stats).toJS(globalThis);
    }
}

/// This is a singleton struct that contains the timer used to schedule re-stat calls.
pub const StatWatcherScheduler = struct {
    current_interval: std.atomic.Value(i32) = .{ .raw = 0 },
    task: jsc.WorkPoolTask = .{ .callback = &workPoolCallback },
    main_thread: std.Thread.Id,
    vm: *bun.jsc.VirtualMachine,
    watchers: WatcherQueue = WatcherQueue{},

    event_loop_timer: EventLoopTimer = .{
        .next = .epoch,
        .tag = .StatWatcherScheduler,
    },

    ref_count: RefCount,

    const RefCount = bun.ptr.ThreadSafeRefCount(StatWatcherScheduler, "ref_count", deinit, .{ .debug_name = "StatWatcherScheduler" });
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    const WatcherQueue = UnboundedQueue(StatWatcher, .next);

    pub fn init(vm: *bun.jsc.VirtualMachine) bun.ptr.RefPtr(StatWatcherScheduler) {
        return .new(.{
            .ref_count = .init(),
            .main_thread = std.Thread.getCurrentId(),
            .vm = vm,
        });
    }

    fn deinit(this: *StatWatcherScheduler) void {
        bun.assertf(this.watchers.isEmpty(), "destroying StatWatcherScheduler while it still has watchers", .{});
        bun.destroy(this);
    }

    pub fn append(this: *StatWatcherScheduler, watcher: *StatWatcher) void {
        log("append new watcher {s}", .{watcher.path});
        bun.assert(watcher.closed == false);
        bun.assert(watcher.next == null);

        watcher.ref();
        this.watchers.push(watcher);
        log("push watcher {x}", .{@intFromPtr(watcher)});
        const current = this.getInterval();
        if (current == 0 or current > watcher.interval) {
            // we are not running or the new watcher has a smaller interval
            this.setInterval(watcher.interval);
        }
    }

    fn getInterval(this: *StatWatcherScheduler) i32 {
        return this.current_interval.load(.monotonic);
    }

    /// Update the current interval and set the timer (this function is thread safe)
    fn setInterval(this: *StatWatcherScheduler, interval: i32) void {
        this.ref();
        this.current_interval.store(interval, .monotonic);

        if (this.main_thread == std.Thread.getCurrentId()) {
            // we are in the main thread we can set the timer
            this.setTimer(interval);
            return;
        }
        // we are not in the main thread we need to schedule a task to set the timer
        this.scheduleTimerUpdate();
    }

    /// Set the timer (this function is not thread safe, should be called only from the main thread)
    fn setTimer(this: *StatWatcherScheduler, interval: i32) void {

        // if the interval is 0 means that we stop the timer
        if (interval == 0) {
            // if the timer is active we need to remove it
            if (this.event_loop_timer.state == .ACTIVE) {
                this.vm.timer.remove(&this.event_loop_timer);
            }
            return;
        }

        // reschedule the timer
        this.vm.timer.update(&this.event_loop_timer, &bun.timespec.msFromNow(.allow_mocked_time, interval));
    }

    /// Schedule a task to set the timer in the main thread
    fn scheduleTimerUpdate(this: *StatWatcherScheduler) void {
        const Holder = struct {
            scheduler: *StatWatcherScheduler,
            task: jsc.AnyTask,

            pub fn updateTimer(self: *@This()) void {
                defer bun.default_allocator.destroy(self);
                self.scheduler.setTimer(self.scheduler.getInterval());
            }
        };
        const holder = bun.handleOom(bun.default_allocator.create(Holder));
        holder.* = .{
            .scheduler = this,
            .task = jsc.AnyTask.New(Holder, Holder.updateTimer).init(holder),
        };
        this.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(jsc.Task.init(&holder.task)));
    }

    pub fn timerCallback(this: *StatWatcherScheduler) void {
        const has_been_cleared = this.event_loop_timer.state == .CANCELLED or this.vm.scriptExecutionStatus() != .running;

        this.event_loop_timer.state = .FIRED;
        this.event_loop_timer.heap = .{};

        if (has_been_cleared) {
            return;
        }

        jsc.WorkPool.schedule(&this.task);
    }

    pub fn workPoolCallback(task: *jsc.WorkPoolTask) void {
        var this: *StatWatcherScheduler = @alignCast(@fieldParentPtr("task", task));
        // ref'd when the timer was scheduled
        defer this.deref();
        // Instant.now will not fail on our target platforms.
        const now = std.time.Instant.now() catch unreachable;

        var batch = this.watchers.popBatch();
        log("pop batch of {d} watchers", .{batch.count});
        var iter = batch.iterator();
        var min_interval: i32 = std.math.maxInt(i32);
        var closest_next_check: u64 = @intCast(min_interval);
        var contain_watchers = false;
        while (iter.next()) |watcher| {
            if (watcher.closed) {
                watcher.deref();
                continue;
            }
            contain_watchers = true;

            const time_since = now.since(watcher.last_check);
            const interval = @as(u64, @intCast(watcher.interval)) * 1_000_000;

            if (time_since >= interval -| 500) {
                watcher.last_check = now;
                watcher.restat();
            } else {
                closest_next_check = @min(interval - @as(u64, time_since), closest_next_check);
            }
            min_interval = @min(min_interval, watcher.interval);
            this.watchers.push(watcher);
            log("reinsert watcher {x}", .{@intFromPtr(watcher)});
        }

        if (contain_watchers) {
            // choose the smallest interval or the closest time to the next check
            this.setInterval(@min(min_interval, @as(i32, @intCast(closest_next_check))));
        } else {
            // we do not have watchers, we can stop the timer
            this.setInterval(0);
        }
    }
};

// TODO: make this a top-level struct
pub const StatWatcher = struct {
    pub const Scheduler = StatWatcherScheduler;

    next: ?*StatWatcher = null,

    ctx: *VirtualMachine,

    ref_count: RefCount,

    /// Closed is set to true to tell the scheduler to remove from list and deref.
    closed: bool,
    path: [:0]u8,
    persistent: bool,
    bigint: bool,
    interval: i32,
    last_check: std.time.Instant,

    globalThis: *jsc.JSGlobalObject,

    /// Kept alive by `last_jsvalue` via `.bind(this)`, which holds a reference
    /// to `this._handle`.
    js_this: jsc.JSValue,

    poll_ref: bun.Async.KeepAlive = .{},

    #last_stat: bun.threading.Guarded(bun.sys.PosixStat),

    last_jsvalue: jsc.Strong.Optional,

    scheduler: bun.ptr.RefPtr(StatWatcherScheduler),

    const RefCount = bun.ptr.ThreadSafeRefCount(StatWatcher, "ref_count", deinit, .{ .debug_name = "StatWatcher" });
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    pub const js = jsc.Codegen.JSStatWatcher;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub fn eventLoop(this: *const StatWatcher) *EventLoop {
        return this.ctx.eventLoop();
    }

    pub fn enqueueTaskConcurrent(this: *const StatWatcher, task: *jsc.ConcurrentTask) void {
        this.eventLoop().enqueueTaskConcurrent(task);
    }

    /// Copy the last stat by value.
    ///
    /// This field is sometimes set from aonther thread, so we should copy by
    /// value instead of referencing by pointer.
    pub fn getLastStat(this: *StatWatcher) bun.sys.PosixStat {
        const value = this.#last_stat.lock();
        defer this.#last_stat.unlock();
        return value.*;
    }

    /// Set the last stat.
    pub fn setLastStat(this: *StatWatcher, stat: *const bun.sys.PosixStat) void {
        const value = this.#last_stat.lock();
        defer this.#last_stat.unlock();
        value.* = stat.*;
    }

    pub fn deinit(this: *StatWatcher) void {
        log("deinit {x}", .{@intFromPtr(this)});

        this.persistent = false;
        if (comptime bun.Environment.allow_assert) {
            if (this.poll_ref.isActive()) {
                bun.assert(jsc.VirtualMachine.get() == this.ctx); // We cannot unref() on another thread this way.
            }
        }
        this.poll_ref.unref(this.ctx);
        this.closed = true;
        this.last_jsvalue.deinit();

        bun.default_allocator.free(this.path);
        bun.default_allocator.destroy(this);
    }

    pub const Arguments = struct {
        path: PathLike,
        listener: jsc.JSValue,

        persistent: bool,
        bigint: bool,
        interval: i32,

        global_this: *jsc.JSGlobalObject,

        pub fn fromJS(global: *jsc.JSGlobalObject, arguments: *ArgumentsSlice) bun.JSError!Arguments {
            const path = try PathLike.fromJSWithAllocator(global, arguments, bun.default_allocator) orelse {
                return global.throwInvalidArguments("filename must be a string or TypedArray", .{});
            };

            var listener: jsc.JSValue = .zero;
            var persistent: bool = true;
            var bigint: bool = false;
            var interval: i32 = 5007;

            if (arguments.nextEat()) |options_or_callable| {
                // options
                if (options_or_callable.isObject()) {
                    // default true
                    persistent = (try options_or_callable.getBooleanStrict(global, "persistent")) orelse true;

                    // default false
                    bigint = (try options_or_callable.getBooleanStrict(global, "bigint")) orelse false;

                    if (try options_or_callable.get(global, "interval")) |interval_| {
                        if (!interval_.isNumber() and !interval_.isAnyInt()) {
                            return global.throwInvalidArguments("interval must be a number", .{});
                        }
                        interval = try interval_.coerce(i32, global);
                    }
                }
            }

            if (arguments.nextEat()) |listener_| {
                if (listener_.isCallable()) {
                    listener = listener_.withAsyncContextIfNeeded(global);
                }
            }

            if (listener == .zero) {
                return global.throwInvalidArguments("Expected \"listener\" callback", .{});
            }

            return Arguments{
                .path = path,
                .listener = listener,
                .persistent = persistent,
                .bigint = bigint,
                .interval = interval,
                .global_this = global,
            };
        }

        pub fn createStatWatcher(this: Arguments) !jsc.JSValue {
            const obj = try StatWatcher.init(this);
            if (obj.js_this != .zero) {
                return obj.js_this;
            }
            return .js_undefined;
        }
    };

    pub fn doRef(this: *StatWatcher, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (!this.closed and !this.persistent) {
            this.persistent = true;
            this.poll_ref.ref(this.ctx);
        }
        return .js_undefined;
    }

    pub fn doUnref(this: *StatWatcher, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        return .js_undefined;
    }

    /// Stops file watching but does not free the instance.
    pub fn close(this: *StatWatcher) void {
        if (this.persistent) {
            this.persistent = false;
        }
        this.poll_ref.unref(this.ctx);
        this.closed = true;
        this.last_jsvalue.clearWithoutDeallocation();
    }

    pub fn doClose(this: *StatWatcher, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.close();
        return .js_undefined;
    }

    /// If the scheduler is not using this, free instantly, otherwise mark for being freed.
    pub fn finalize(this: *StatWatcher) void {
        log("Finalize\n", .{});
        this.closed = true;
        this.scheduler.deref();
        this.deref(); // but don't deinit until the scheduler drops its reference
    }

    pub const InitialStatTask = struct {
        watcher: *StatWatcher,
        task: jsc.WorkPoolTask = .{ .callback = &workPoolCallback },

        pub fn createAndSchedule(watcher: *StatWatcher) void {
            const task = bun.new(InitialStatTask, .{ .watcher = watcher });
            watcher.ref();
            jsc.WorkPool.schedule(&task.task);
        }

        fn workPoolCallback(task: *jsc.WorkPoolTask) void {
            const initial_stat_task: *InitialStatTask = @fieldParentPtr("task", task);
            defer bun.destroy(initial_stat_task);
            const this = initial_stat_task.watcher;

            if (this.closed) {
                this.deref(); // Balance the ref() from createAndSchedule().
                return;
            }

            const stat: bun.sys.Maybe(bun.sys.PosixStat) = if (bun.Environment.isLinux and bun.sys.supports_statx_on_linux.load(.monotonic))
                bun.sys.statx(this.path, &.{ .type, .mode, .nlink, .uid, .gid, .atime, .mtime, .ctime, .btime, .ino, .size, .blocks })
            else brk: {
                const result = bun.sys.stat(this.path);
                break :brk switch (result) {
                    .result => |r| bun.sys.Maybe(bun.sys.PosixStat){ .result = bun.sys.PosixStat.init(&r) },
                    .err => |e| bun.sys.Maybe(bun.sys.PosixStat){ .err = e },
                };
            };
            switch (stat) {
                .result => |*res| {
                    // we store the stat, but do not call the callback
                    this.setLastStat(res);
                    this.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, initialStatSuccessOnMainThread));
                },
                .err => {
                    // on enoent, eperm, we call cb with two zeroed stat objects
                    // and store previous stat as a zeroed stat object, and then call the callback.
                    this.setLastStat(&std.mem.zeroes(bun.sys.PosixStat));
                    this.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, initialStatErrorOnMainThread));
                },
            }
        }
    };

    pub fn initialStatSuccessOnMainThread(this: *StatWatcher) void {
        defer this.deref(); // Balance the ref from createAndSchedule().
        if (this.closed) {
            return;
        }

        const globalThis = this.globalThis;

        const jsvalue = statToJSStats(globalThis, &this.getLastStat(), this.bigint) catch |err| return globalThis.reportActiveExceptionAsUnhandled(err);
        this.last_jsvalue.set(globalThis, jsvalue);

        this.scheduler.data.append(this);
    }

    pub fn initialStatErrorOnMainThread(this: *StatWatcher) void {
        defer this.deref(); // Balance the ref from createAndSchedule().
        if (this.closed) {
            return;
        }

        const globalThis = this.globalThis;
        const jsvalue = statToJSStats(globalThis, &this.getLastStat(), this.bigint) catch |err| return globalThis.reportActiveExceptionAsUnhandled(err);
        this.last_jsvalue.set(globalThis, jsvalue);

        _ = js.listenerGetCached(this.js_this).?.call(
            globalThis,
            .js_undefined,
            &[2]jsc.JSValue{
                jsvalue,
                jsvalue,
            },
        ) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);

        if (this.closed) {
            return;
        }
        this.scheduler.data.append(this);
    }

    /// Called from any thread
    pub fn restat(this: *StatWatcher) void {
        log("recalling stat", .{});
        const stat: bun.sys.Maybe(bun.sys.PosixStat) = if (bun.Environment.isLinux and bun.sys.supports_statx_on_linux.load(.monotonic))
            bun.sys.statx(this.path, &.{ .type, .mode, .nlink, .uid, .gid, .atime, .mtime, .ctime, .btime, .ino, .size, .blocks })
        else brk: {
            const result = bun.sys.stat(this.path);
            break :brk switch (result) {
                .result => |r| .{ .result = .init(&r) },
                .err => |e| .{ .err = e },
            };
        };
        const res = switch (stat) {
            .result => |res| res,
            .err => std.mem.zeroes(bun.sys.PosixStat),
        };

        const last_stat = this.getLastStat();

        // Ignore atime changes when comparing stats
        // Compare field-by-field to avoid false positives from padding bytes
        if (res.dev == last_stat.dev and
            res.ino == last_stat.ino and
            res.mode == last_stat.mode and
            res.nlink == last_stat.nlink and
            res.uid == last_stat.uid and
            res.gid == last_stat.gid and
            res.rdev == last_stat.rdev and
            res.size == last_stat.size and
            res.blksize == last_stat.blksize and
            res.blocks == last_stat.blocks and
            res.mtim.sec == last_stat.mtim.sec and
            res.mtim.nsec == last_stat.mtim.nsec and
            res.ctim.sec == last_stat.ctim.sec and
            res.ctim.nsec == last_stat.ctim.nsec and
            res.birthtim.sec == last_stat.birthtim.sec and
            res.birthtim.nsec == last_stat.birthtim.nsec)
            return;

        this.setLastStat(&res);
        this.ref(); // Ensure it stays alive long enough to receive the callback.
        this.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, swapAndCallListenerOnMainThread));
    }

    /// After a restat found the file changed, this calls the listener function.
    pub fn swapAndCallListenerOnMainThread(this: *StatWatcher) void {
        defer this.deref(); // Balance the ref from restat().
        const prev_jsvalue = this.last_jsvalue.swap();
        const globalThis = this.globalThis;
        const current_jsvalue = statToJSStats(globalThis, &this.getLastStat(), this.bigint) catch return; // TODO: properly propagate exception upwards
        this.last_jsvalue.set(globalThis, current_jsvalue);

        _ = js.listenerGetCached(this.js_this).?.call(
            globalThis,
            .js_undefined,
            &[2]jsc.JSValue{
                current_jsvalue,
                prev_jsvalue,
            },
        ) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);
    }

    pub fn init(args: Arguments) !*StatWatcher {
        log("init", .{});

        const buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(buf);
        var slice = args.path.slice();
        if (bun.strings.startsWith(slice, "file://")) {
            slice = slice[6..];
        }

        var parts = [_]string{slice};
        const file_path = Path.joinAbsStringBuf(
            fs.FileSystem.instance.top_level_dir,
            buf,
            &parts,
            .auto,
        );

        const alloc_file_path = try bun.default_allocator.allocSentinel(u8, file_path.len, 0);
        errdefer bun.default_allocator.free(alloc_file_path);
        @memcpy(alloc_file_path, file_path);

        var this = try bun.default_allocator.create(StatWatcher);
        const vm = args.global_this.bunVM();
        this.* = .{
            .ctx = vm,
            .persistent = args.persistent,
            .bigint = args.bigint,
            .interval = @max(5, args.interval),
            .globalThis = args.global_this,
            .js_this = .zero,
            .closed = false,
            .path = alloc_file_path,
            // Instant.now will not fail on our target platforms.
            .last_check = std.time.Instant.now() catch unreachable,
            // InitStatTask is responsible for setting this
            .#last_stat = .init(std.mem.zeroes(bun.sys.PosixStat)),
            .last_jsvalue = .empty,
            .scheduler = vm.rareData().nodeFSStatWatcherScheduler(vm),
            .ref_count = .init(),
        };
        errdefer this.deinit();

        if (this.persistent) {
            this.poll_ref.ref(this.ctx);
        }

        const js_this = StatWatcher.toJS(this, this.globalThis);
        this.js_this = js_this;
        js.listenerSetCached(js_this, this.globalThis, args.listener);
        InitialStatTask.createAndSchedule(this);

        return this;
    }
};

const string = []const u8;

const Path = @import("../../resolver/resolve_path.zig");
const fs = @import("../../fs.zig");
const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const UnboundedQueue = bun.threading.UnboundedQueue;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const jsc = bun.jsc;
const EventLoop = jsc.EventLoop;
const VirtualMachine = jsc.VirtualMachine;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;

const PathLike = jsc.Node.PathLike;
const StatsBig = bun.jsc.Node.StatsBig;
const StatsSmall = bun.jsc.Node.StatsSmall;
