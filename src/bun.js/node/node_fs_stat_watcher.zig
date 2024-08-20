const std = @import("std");
const JSC = bun.JSC;
const bun = @import("root").bun;
const Fs = @import("../../fs.zig");
const Path = @import("../../resolver/resolve_path.zig");
const Encoder = JSC.WebCore.Encoder;
const Mutex = @import("../../lock.zig").Lock;
const uws = @import("../../deps/uws.zig");

const PathWatcher = @import("./path_watcher.zig");
const UnboundedQueue = @import("../unbounded_queue.zig").UnboundedQueue;
const EventLoopTimer = @import("../api/Timer.zig").EventLoopTimer;
const VirtualMachine = JSC.VirtualMachine;
const EventLoop = JSC.EventLoop;
const PathLike = JSC.Node.PathLike;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const Output = bun.Output;
const string = bun.string;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Environment = bun.Environment;

const StatsSmall = bun.JSC.Node.StatsSmall;
const StatsBig = bun.JSC.Node.StatsBig;

const log = bun.Output.scoped(.StatWatcher, false);

fn statToJSStats(globalThis: *JSC.JSGlobalObject, stats: bun.Stat, bigint: bool) JSC.JSValue {
    if (bigint) {
        return StatsBig.new(StatsBig.init(stats)).toJS(globalThis);
    } else {
        return StatsSmall.new(StatsSmall.init(stats)).toJS(globalThis);
    }
}

/// This is a singleton struct that contains the timer used to schedule re-stat calls.
pub const StatWatcherScheduler = struct {
    current_interval: std.atomic.Value(i32) = .{ .raw = 0 },
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    main_thread: std.Thread.Id,
    vm: *bun.JSC.VirtualMachine,
    watchers: WatcherQueue = WatcherQueue{},

    event_loop_timer: EventLoopTimer = .{
        .next = .{},
        .tag = .StatWatcherScheduler,
    },

    const WatcherQueue = UnboundedQueue(StatWatcher, .next);

    pub fn init(allocator: std.mem.Allocator, vm: *bun.JSC.VirtualMachine) *StatWatcherScheduler {
        const this = allocator.create(StatWatcherScheduler) catch bun.outOfMemory();
        this.* = .{ .main_thread = std.Thread.getCurrentId(), .vm = vm };
        return this;
    }

    pub fn append(this: *StatWatcherScheduler, watcher: *StatWatcher) void {
        log("append new watcher {s}", .{watcher.path});
        bun.assert(watcher.closed == false);
        bun.assert(watcher.next == null);

        this.watchers.push(watcher);
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

        // if the timer is active we need to remove it
        if (this.event_loop_timer.state == .ACTIVE) {
            this.vm.timer.remove(&this.event_loop_timer);
        }

        // if the interval is 0 means that we stop the timer
        if (interval == 0) {
            return;
        }

        // reschedule the timer
        this.event_loop_timer.next = bun.timespec.msFromNow(interval);
        this.vm.timer.insert(&this.event_loop_timer);
    }

    /// Schedule a task to set the timer in the main thread
    fn scheduleTimerUpdate(this: *StatWatcherScheduler) void {
        const Holder = struct {
            scheduler: *StatWatcherScheduler,
            task: JSC.AnyTask,

            pub fn updateTimer(self: *@This()) void {
                defer bun.default_allocator.destroy(self);
                self.scheduler.setTimer(self.scheduler.getInterval());
            }
        };
        const holder = bun.default_allocator.create(Holder) catch bun.outOfMemory();
        holder.* = .{
            .scheduler = this,
            .task = JSC.AnyTask.New(Holder, Holder.updateTimer).init(holder),
        };
        this.vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(&holder.task)));
    }

    pub fn timerCallback(this: *StatWatcherScheduler) EventLoopTimer.Arm {
        const has_been_cleared = this.event_loop_timer.state == .CANCELLED or this.vm.scriptExecutionStatus() != .running;

        this.event_loop_timer.state = .FIRED;
        this.event_loop_timer.heap = .{};

        if (has_been_cleared) {
            return .disarm;
        }

        JSC.WorkPool.schedule(&this.task);

        return .disarm;
    }

    pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *StatWatcherScheduler = @alignCast(@fieldParentPtr("task", task));
        // Instant.now will not fail on our target platforms.
        const now = std.time.Instant.now() catch unreachable;

        var batch = this.watchers.popBatch();
        var iter = batch.iterator();
        var min_interval: i32 = std.math.maxInt(i32);
        var closest_next_check: u64 = @intCast(min_interval);
        var contain_watchers = false;
        while (iter.next()) |watcher| {
            if (watcher.closed) {
                watcher.used_by_scheduler_thread.store(false, .release);
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

pub const StatWatcher = struct {
    next: ?*StatWatcher = null,

    ctx: *VirtualMachine,

    /// Closed is set to true to tell the scheduler to remove from list and mark `used_by_scheduler_thread` as false.
    closed: bool,
    /// When this is marked `false` this StatWatcher can get freed
    used_by_scheduler_thread: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    path: [:0]u8,
    persistent: bool,
    bigint: bool,
    interval: i32,
    last_check: std.time.Instant,

    globalThis: *JSC.JSGlobalObject,
    js_this: JSC.JSValue,

    poll_ref: bun.Async.KeepAlive = .{},

    last_stat: bun.Stat,
    last_jsvalue: JSC.Strong,

    pub usingnamespace JSC.Codegen.JSStatWatcher;

    pub fn eventLoop(this: StatWatcher) *EventLoop {
        return this.ctx.eventLoop();
    }

    pub fn enqueueTaskConcurrent(this: StatWatcher, task: *JSC.ConcurrentTask) void {
        this.eventLoop().enqueueTaskConcurrent(task);
    }

    pub fn deinit(this: *StatWatcher) void {
        log("deinit\n", .{});
        bun.assert(!this.hasPendingActivity());

        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        this.closed = true;
        this.last_jsvalue.clear();

        bun.default_allocator.free(this.path);
        bun.default_allocator.destroy(this);
    }

    pub const Arguments = struct {
        path: PathLike,
        listener: JSC.JSValue,

        persistent: bool,
        bigint: bool,
        interval: i32,

        global_this: JSC.C.JSContextRef,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Arguments {
            const vm = ctx.vm();
            const path = PathLike.fromJSWithAllocator(ctx, arguments, bun.default_allocator, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "filename must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var listener: JSC.JSValue = .zero;
            var persistent: bool = true;
            var bigint: bool = false;
            var interval: i32 = 5007;

            if (arguments.nextEat()) |options_or_callable| {
                // options
                if (options_or_callable.isObject()) {
                    // default true
                    persistent = (options_or_callable.getOptional(ctx, "persistent", bool) catch return null) orelse true;

                    // default false
                    bigint = (options_or_callable.getOptional(ctx, "bigint", bool) catch return null) orelse false;

                    if (options_or_callable.get(ctx, "interval")) |interval_| {
                        if (!interval_.isNumber() and !interval_.isAnyInt()) {
                            JSC.throwInvalidArguments(
                                "interval must be a number.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        interval = interval_.coerce(i32, ctx);
                    }
                }
            }

            if (arguments.nextEat()) |listener_| {
                if (listener_.isCallable(vm)) {
                    listener = listener_.withAsyncContextIfNeeded(ctx);
                }
            }

            if (listener == .zero) {
                exception.* = JSC.toInvalidArguments("Expected \"listener\" callback", .{}, ctx).asObjectRef();
                return null;
            }

            return Arguments{
                .path = path,
                .listener = listener,
                .persistent = persistent,
                .bigint = bigint,
                .interval = interval,
                .global_this = ctx,
            };
        }

        pub fn createStatWatcher(this: Arguments) !JSC.JSValue {
            const obj = try StatWatcher.init(this);
            if (obj.js_this != .zero) {
                return obj.js_this;
            }
            return .undefined;
        }
    };

    pub fn doRef(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        if (!this.closed and !this.persistent) {
            this.persistent = true;
            this.poll_ref.ref(this.ctx);
        }
        return .undefined;
    }

    pub fn doUnref(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        return .undefined;
    }

    pub fn hasPendingActivity(this: *StatWatcher) bool {
        @fence(.acquire);

        return this.used_by_scheduler_thread.load(.acquire);
    }

    /// Stops file watching but does not free the instance.
    pub fn close(
        this: *StatWatcher,
    ) void {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        this.closed = true;
        this.last_jsvalue.clear();
    }

    pub fn doClose(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        this.close();
        return .undefined;
    }

    /// If the scheduler is not using this, free instantly, otherwise mark for being freed.
    pub fn finalize(this: *StatWatcher) void {
        log("Finalize\n", .{});
        this.deinit();
    }

    pub const InitialStatTask = struct {
        watcher: *StatWatcher,
        task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },

        pub fn createAndSchedule(
            watcher: *StatWatcher,
        ) void {
            var task = bun.default_allocator.create(InitialStatTask) catch bun.outOfMemory();
            task.* = .{ .watcher = watcher };
            JSC.WorkPool.schedule(&task.task);
        }

        fn workPoolCallback(task: *JSC.WorkPoolTask) void {
            const initial_stat_task: *InitialStatTask = @fieldParentPtr("task", task);
            defer bun.default_allocator.destroy(initial_stat_task);
            const this = initial_stat_task.watcher;

            if (this.closed) {
                this.used_by_scheduler_thread.store(false, .release);
                return;
            }

            const stat = bun.sys.stat(this.path);
            switch (stat) {
                .result => |res| {
                    // we store the stat, but do not call the callback
                    this.last_stat = res;
                    this.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, initialStatSuccessOnMainThread));
                },
                .err => {
                    // on enoent, eperm, we call cb with two zeroed stat objects
                    // and store previous stat as a zeroed stat object, and then call the callback.
                    this.last_stat = std.mem.zeroes(bun.Stat);
                    this.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, initialStatErrorOnMainThread));
                },
            }
        }
    };

    pub fn initialStatSuccessOnMainThread(this: *StatWatcher) void {
        if (this.closed) {
            this.used_by_scheduler_thread.store(false, .release);
            return;
        }

        const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
        this.last_jsvalue = JSC.Strong.create(jsvalue, this.globalThis);

        const vm = this.globalThis.bunVM();
        vm.rareData().nodeFSStatWatcherScheduler(vm).append(this);
    }

    pub fn initialStatErrorOnMainThread(this: *StatWatcher) void {
        if (this.closed) {
            this.used_by_scheduler_thread.store(false, .release);
            return;
        }

        const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
        this.last_jsvalue = JSC.Strong.create(jsvalue, this.globalThis);

        const result = StatWatcher.listenerGetCached(this.js_this).?.call(
            this.globalThis,
            .undefined,
            &[2]JSC.JSValue{
                jsvalue,
                jsvalue,
            },
        );

        const vm = this.globalThis.bunVM();
        if (result.isAnyError()) {
            _ = vm.uncaughtException(this.globalThis, result, false);
        }

        vm.rareData().nodeFSStatWatcherScheduler(vm).append(this);
    }

    /// Called from any thread
    pub fn restat(this: *StatWatcher) void {
        log("recalling stat", .{});
        const stat = bun.sys.stat(this.path);
        const res = switch (stat) {
            .result => |res| res,
            .err => std.mem.zeroes(bun.Stat),
        };

        if (std.mem.eql(u8, std.mem.asBytes(&res), std.mem.asBytes(&this.last_stat))) return;

        this.last_stat = res;
        this.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, swapAndCallListenerOnMainThread));
    }

    /// After a restat found the file changed, this calls the listener function.
    pub fn swapAndCallListenerOnMainThread(this: *StatWatcher) void {
        const prev_jsvalue = this.last_jsvalue.swap();
        const current_jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
        this.last_jsvalue.set(this.globalThis, current_jsvalue);

        const result = StatWatcher.listenerGetCached(this.js_this).?.call(
            this.globalThis,
            .undefined,
            &[2]JSC.JSValue{
                current_jsvalue,
                prev_jsvalue,
            },
        );
        if (result.isAnyError()) {
            const vm = this.globalThis.bunVM();
            _ = vm.uncaughtException(this.globalThis, result, false);
        }
    }

    pub fn onTimerInterval(timer: *uws.Timer) callconv(.C) void {
        timer.ext(StatWatcher).?.restat();
    }

    pub fn init(args: Arguments) !*StatWatcher {
        log("init", .{});

        var buf: bun.PathBuffer = undefined;
        var slice = args.path.slice();
        if (bun.strings.startsWith(slice, "file://")) {
            slice = slice[6..];
        }

        var parts = [_]string{slice};
        const file_path = Path.joinAbsStringBuf(
            Fs.FileSystem.instance.top_level_dir,
            &buf,
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
            .used_by_scheduler_thread = std.atomic.Value(bool).init(true),
            // Instant.now will not fail on our target platforms.
            .last_check = std.time.Instant.now() catch unreachable,
            // InitStatTask is responsible for setting this
            .last_stat = undefined,
            .last_jsvalue = JSC.Strong.init(),
        };
        errdefer this.deinit();

        if (this.persistent) {
            this.poll_ref.ref(this.ctx);
        }

        const js_this = StatWatcher.toJS(this, this.globalThis);
        this.js_this = js_this;
        StatWatcher.listenerSetCached(js_this, this.globalThis, args.listener);
        InitialStatTask.createAndSchedule(this);

        return this;
    }
};
