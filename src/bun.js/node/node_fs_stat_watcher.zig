const std = @import("std");
const JSC = @import("root").bun.JSC;
const bun = @import("root").bun;
const Fs = @import("../../fs.zig");
const Path = @import("../../resolver/resolve_path.zig");
const Encoder = JSC.WebCore.Encoder;
const Mutex = @import("../../lock.zig").Lock;
const uws = @import("../../deps/uws.zig");

const PathWatcher = @import("./path_watcher.zig");

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
        return bun.new(StatsBig, StatsBig.init(stats)).toJS(globalThis);
    } else {
        return bun.new(StatsSmall, StatsSmall.init(stats)).toJS(globalThis);
    }
}

/// This is a singleton struct that contains the timer used to schedule restat calls.
pub const StatWatcherScheduler = struct {
    timer: ?*uws.Timer = null,

    head: std.atomic.Value(?*StatWatcher) = .{ .raw = null },
    is_running: std.atomic.Value(bool) = .{ .raw = false },

    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },

    pub fn init(allocator: std.mem.Allocator, _: *bun.JSC.VirtualMachine) *StatWatcherScheduler {
        const this = allocator.create(StatWatcherScheduler) catch @panic("out of memory");
        this.* = .{};
        return this;
    }

    pub fn append(this: *StatWatcherScheduler, watcher: *StatWatcher) void {
        log("append new watcher {s}", .{watcher.path});
        std.debug.assert(watcher.closed == false);
        std.debug.assert(watcher.next == null);

        if (this.head.swap(watcher, .Monotonic)) |head| {
            watcher.next = head;
            if (!this.is_running.load(.Monotonic)) {
                this.timer.?.set(this, timerCallback, 1, 0);
            }
        } else {
            if (!this.is_running.load(.Monotonic)) {
                watcher.last_check = std.time.Instant.now() catch unreachable;

                const vm = watcher.globalThis.bunVM();
                this.timer = uws.Timer.create(
                    vm.uwsLoop(),
                    this,
                );

                this.timer.?.set(this, timerCallback, watcher.interval, 0);
                log("I will wait {d} milli initially", .{watcher.interval});
            }
        }
    }

    pub fn timerCallback(timer: *uws.Timer) callconv(.C) void {
        var this = timer.ext(StatWatcherScheduler).?;
        this.is_running.store(true, .Monotonic);
        JSC.WorkPool.schedule(&this.task);
    }

    pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *StatWatcherScheduler = @fieldParentPtr(StatWatcherScheduler, "task", task);
        // Instant.now will not fail on our target platforms.
        const now = std.time.Instant.now() catch unreachable;

        const head: *StatWatcher = this.head.swap(null, .Monotonic).?;

        var prev = head;
        while (prev.closed) {
            var c = prev;
            defer {
                c.used_by_scheduler_thread = false;
            }

            log("[1] removing closed watcher for '{s}'", .{prev.path});
            if (prev.next) |next| {
                prev = next;
            } else {
                if (this.head.load(.Monotonic) == null) {
                    this.timer.?.deinit(false);
                    this.timer = null;
                    // The scheduler is not deinit here, but it will get reused.
                }
                return;
            }
        }

        if (now.since(prev.last_check) > (@as(u64, @intCast(prev.interval)) * 1_000_000 -| 500)) {
            prev.last_check = now;
            prev.restat();
        }
        var min_interval = prev.interval;

        var curr: ?*StatWatcher = prev.next;
        while (curr) |c| : (curr = c.next) {
            if (c.closed) {
                log("[2] removing closed watcher for '{s}'", .{c.path});
                prev.next = c.next;
                curr = c.next;
                c.used_by_scheduler_thread = false;
                continue;
            }
            if (now.since(c.last_check) > (@as(u64, @intCast(c.interval)) * 1_000_000 -| 500)) {
                c.last_check = now;
                c.restat();
            }
            min_interval = @min(min_interval, c.interval);
            prev = c;
            curr = c.next;
        }

        prev.next = this.head.swap(head, .Monotonic);

        log("I will wait {d} milli", .{min_interval});

        this.timer.?.set(this, timerCallback, min_interval, 0);
    }
};

pub const StatWatcher = struct {
    next: ?*StatWatcher = null,

    ctx: *VirtualMachine,

    /// Closed is set to true to tell the scheduler to remove from list and mark `used_by_scheduler_thread` as false.
    closed: bool,
    /// When this is marked `false` this StatWatcher can get freed
    used_by_scheduler_thread: bool,

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
        std.debug.assert(!this.hasPendingActivity());

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
                        if (!interval_.isNumber()) {
                            JSC.throwInvalidArguments(
                                "bigint must be a boolean.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        interval = interval_.toInt32(); //*
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
            return JSC.JSValue.jsUndefined();
        }
    };

    pub fn doRef(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (!this.closed and !this.persistent) {
            this.persistent = true;
            this.poll_ref.ref(this.ctx);
        }
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        return JSC.JSValue.jsUndefined();
    }

    pub fn hasPendingActivity(this: *StatWatcher) callconv(.C) bool {
        return this.used_by_scheduler_thread;
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

    pub fn doClose(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        this.close();
        return JSC.JSValue.jsUndefined();
    }

    /// If the scheduler is not using this, free instantly, otherwise mark for being freed.
    pub fn finalize(this: *StatWatcher) callconv(.C) void {
        log("Finalize\n", .{});
        this.deinit();
    }

    pub const InitialStatTask = struct {
        watcher: *StatWatcher,
        task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },

        pub fn createAndSchedule(
            watcher: *StatWatcher,
        ) void {
            var task = bun.default_allocator.create(InitialStatTask) catch @panic("out of memory");
            task.* = .{ .watcher = watcher };
            JSC.WorkPool.schedule(&task.task);
        }

        fn workPoolCallback(task: *JSC.WorkPoolTask) void {
            const initial_stat_task: *InitialStatTask = @fieldParentPtr(InitialStatTask, "task", task);
            defer bun.default_allocator.destroy(initial_stat_task);
            const this = initial_stat_task.watcher;

            if (this.closed) {
                this.used_by_scheduler_thread = false;
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
            this.used_by_scheduler_thread = false;
            return;
        }

        const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
        this.last_jsvalue = JSC.Strong.create(jsvalue, this.globalThis);

        const vm = this.globalThis.bunVM();
        vm.rareData().nodeFSStatWatcherScheduler(vm).append(this);
    }

    pub fn initialStatErrorOnMainThread(this: *StatWatcher) void {
        if (this.closed) {
            this.used_by_scheduler_thread = false;
            return;
        }

        const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
        this.last_jsvalue = JSC.Strong.create(jsvalue, this.globalThis);

        const result = StatWatcher.listenerGetCached(this.js_this).?.call(
            this.globalThis,
            &[2]JSC.JSValue{
                jsvalue,
                jsvalue,
            },
        );

        const vm = this.globalThis.bunVM();
        if (result.isAnyError()) {
            vm.onUnhandledError(this.globalThis, result);
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
            &[2]JSC.JSValue{
                current_jsvalue,
                prev_jsvalue,
            },
        );
        if (result.isAnyError()) {
            const vm = this.globalThis.bunVM();
            vm.onUnhandledError(this.globalThis, result);
        }
    }

    pub fn onTimerInterval(timer: *uws.Timer) callconv(.C) void {
        timer.ext(StatWatcher).?.restat();
    }

    pub fn init(args: Arguments) !*StatWatcher {
        log("init", .{});

        var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
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
            .used_by_scheduler_thread = true,
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
