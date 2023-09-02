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
    // !? do i need to allocate this?
    if (bigint) {
        return StatsBig.initWithAllocator(globalThis.allocator(), stats).toJS(globalThis);
    } else {
        return StatsSmall.initWithAllocator(globalThis.allocator(), stats).toJS(globalThis);
    }
}

pub const StatWatcher = struct {
    ctx: *VirtualMachine,
    closed: bool,

    path: [:0]u8,
    persistent: bool,
    bigint: bool,
    interval: i32,

    globalThis: *JSC.JSGlobalObject,
    js_this: JSC.JSValue,

    poll_ref: JSC.PollRef = .{},

    timer: *uws.Timer,

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
        if (!this.closed) {
            this.close();
        }
        bun.default_allocator.free(this.path);
        bun.default_allocator.destroy(this);
        log("deinit\n", .{});
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
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
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
                    if (options_or_callable.get(ctx, "persistent")) |persistent_| {
                        if (!persistent_.isBoolean()) {
                            JSC.throwInvalidArguments(
                                "persistent must be a boolean.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        persistent = persistent_.toBoolean();
                    }

                    if (options_or_callable.get(ctx, "bigint")) |bigint_| {
                        if (!bigint_.isBoolean()) {
                            JSC.throwInvalidArguments(
                                "bigint must be a boolean.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        bigint = bigint_.toBoolean();
                    }

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

    pub fn initJS(this: *StatWatcher, listener: JSC.JSValue) void {
        if (this.persistent) {
            this.poll_ref.ref(this.ctx);
        }

        const js_this = StatWatcher.toJS(this, this.globalThis);
        this.js_this = js_this;
        StatWatcher.listenerSetCached(js_this, this.globalThis, listener);
    }

    /// https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L132-L137
    /// To maximize backward-compatibility for the end user,
    /// a no-op stub method has been added instead of
    /// totally removing StatWatcher.prototype.start.
    /// This should not be documented.
    pub fn noopStart(_: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsUndefined();
    }

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

    // this can be called from Watcher Thread or JS Context Thread
    // pub fn refTask(this: *StatWatcher) bool {
    //     this.mutex.lock();
    //     defer this.mutex.unlock();
    //     // stop new references
    //     if (this.closed) return false;
    //     this.task_count += 1;
    //     return true;
    // }

    // !? this is wrong
    pub fn hasPendingActivity(this: *StatWatcher) callconv(.C) bool {
        return !this.closed;
    }

    // unref is always called on main JS Context Thread
    // pub fn unrefTask(this: *StatWatcher) void {
    //     this.mutex.lock();
    //     defer this.mutex.unlock();
    //     this.task_count -= 1;
    //     if (this.closed and this.task_count == 0) {
    //         this.updateHasPendingActivity();
    //     }
    // }

    pub fn close(
        this: *StatWatcher,
    ) void {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        this.closed = true;
        this.last_jsvalue.clear();
        this.timer.deinit();
    }

    pub fn doClose(this: *StatWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        this.close();
        return JSC.JSValue.jsUndefined();
    }

    pub fn finalize(this: *StatWatcher) callconv(.C) void {
        // !? this never gets called?
        this.deinit();
    }

    pub fn initialStat(this: *StatWatcher) void {
        const stat = bun.sys.stat(this.path);
        switch (stat) {
            .result => |res| {
                // we store the stat and do not emit immediatly
                this.last_stat = res;
                const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
                this.last_jsvalue = JSC.Strong.create(jsvalue, this.globalThis);
            },
            .err => {
                // on enoent, eperm, we call cb with two zeroed stat objects
                // and store previous stat as a zeroed stat object
                this.last_stat = std.mem.zeroes(bun.Stat);
                const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
                this.last_jsvalue = JSC.Strong.create(jsvalue, this.globalThis);
                _ = StatWatcher.listenerGetCached(this.js_this).?.call(
                    this.globalThis,
                    &[2]JSC.JSValue{
                        jsvalue,
                        jsvalue,
                    },
                );
                // !? what if this throws?
            },
        }

        this.timer.set(this, onTimerInterval, this.interval, 1);
    }

    pub fn restat(this: *StatWatcher) void {
        log("recalling stat", .{});
        const stat = bun.sys.stat(this.path);
        const res = switch (stat) {
            .result => |res| res,
            .err => std.mem.zeroes(bun.Stat),
        };

        // !? perhaps a better approach is using an optional / other tag to identify a fully zeroed stat.
        if (std.mem.eql(u8, std.mem.asBytes(&res), std.mem.asBytes(&this.last_stat))) return;
        log("calling into js", .{});

        this.last_stat = res;
        const prev_jsvalue = this.last_jsvalue.swap();
        const jsvalue = statToJSStats(this.globalThis, this.last_stat, this.bigint);
        this.last_jsvalue.set(this.globalThis, jsvalue);

        _ = StatWatcher.listenerGetCached(this.js_this).?.call(
            this.globalThis,
            &[2]JSC.JSValue{
                jsvalue,
                prev_jsvalue,
            },
        );
        // !? what if this throws?
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
        var parts = [_]string{
            slice,
        };
        var file_path = Path.joinAbsStringBuf(
            Fs.FileSystem.instance.top_level_dir,
            &buf,
            &parts,
            .auto,
        );

        var alloc_file_path = try bun.default_allocator.allocSentinel(u8, file_path.len, 0);
        errdefer bun.default_allocator.free(alloc_file_path);
        @memcpy(alloc_file_path, file_path);

        var ctx = try bun.default_allocator.create(StatWatcher);
        const vm = args.global_this.bunVM();
        ctx.* = .{
            .ctx = vm,
            .persistent = args.persistent,
            .bigint = args.bigint,
            .interval = args.interval,
            .globalThis = args.global_this,
            .js_this = .zero,
            .closed = false,
            .timer = uws.Timer.create(
                args.global_this.bunVM().event_loop_handle orelse @panic("UWS Loop was not initialized yet."),
                ctx,
            ),
            .path = alloc_file_path,

            // initialStat is responsible for setting these two
            .last_stat = undefined,
            .last_jsvalue = undefined,
        };
        errdefer ctx.deinit();

        ctx.initJS(args.listener);

        // !? this should happen at *least* a microtick later
        // !? maybe also run it on another thread?
        ctx.initialStat();

        return ctx;
    }
};
