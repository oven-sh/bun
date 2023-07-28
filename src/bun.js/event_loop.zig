const std = @import("std");
const JSC = @import("root").bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const Lock = @import("../lock.zig").Lock;
const Microtask = JSC.Microtask;
const bun = @import("root").bun;
const Environment = bun.Environment;
const Fetch = JSC.WebCore.Fetch;
const WebCore = JSC.WebCore;
const Bun = JSC.API.Bun;
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const typeBaseName = @import("../meta.zig").typeBaseName;
const CopyFilePromiseTask = WebCore.Blob.Store.CopyFile.CopyFilePromiseTask;
const AsyncTransformTask = JSC.API.JSTranspiler.TransformTask.AsyncTransformTask;
const ReadFileTask = WebCore.Blob.Store.ReadFile.ReadFileTask;
const WriteFileTask = WebCore.Blob.Store.WriteFile.WriteFileTask;
const napi_async_work = JSC.napi.napi_async_work;
const FetchTasklet = Fetch.FetchTasklet;
const JSValue = JSC.JSValue;
const js = JSC.C;
pub const WorkPool = @import("../work_pool.zig").WorkPool;
pub const WorkPoolTask = @import("../work_pool.zig").Task;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const uws = @import("root").bun.uws;

pub fn ConcurrentPromiseTask(comptime Context: type) type {
    return struct {
        const This = @This();
        ctx: *Context,
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },
        event_loop: *JSC.EventLoop,
        allocator: std.mem.Allocator,
        promise: JSC.JSPromise.Strong = .{},
        globalThis: *JSGlobalObject,
        concurrent_task: JSC.ConcurrentTask = .{},

        // This is a poll because we want it to enter the uSockets loop
        ref: JSC.PollRef = .{},

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = VirtualMachine.get().event_loop,
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
            };
            var promise = JSC.JSPromise.create(globalThis);
            this.promise.strong.set(globalThis, promise.asValue(globalThis));
            this.ref.ref(this.event_loop.virtual_machine);

            return this;
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            var this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx);
            this.onFinish();
        }

        pub fn runFromJS(this: *This) void {
            var promise = this.promise.swap();
            this.ref.unref(this.event_loop.virtual_machine);

            var ctx = this.ctx;

            ctx.then(promise);
        }

        pub fn schedule(this: *This) void {
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
        }

        pub fn deinit(this: *This) void {
            this.allocator.destroy(this);
        }
    };
}

pub fn IOTask(comptime Context: type) type {
    return WorkTask(Context, true);
}

pub fn WorkTask(comptime Context: type, comptime async_io: bool) type {
    return struct {
        const TaskType = if (async_io) NetworkThread.Task else WorkPoolTask;

        const This = @This();
        ctx: *Context,
        task: TaskType = .{ .callback = &runFromThreadPool },
        event_loop: *JSC.EventLoop,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
        concurrent_task: ConcurrentTask = .{},

        // This is a poll because we want it to enter the uSockets loop
        ref: JSC.PollRef = .{},

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = globalThis.bunVM().eventLoop(),
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
            };
            this.ref.ref(this.event_loop.virtual_machine);

            return this;
        }

        pub fn runFromThreadPool(task: *TaskType) void {
            var this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx, this);
        }

        pub fn runFromJS(this: *This) void {
            var ctx = this.ctx;
            this.ref.unref(this.event_loop.virtual_machine);
            ctx.then(this.globalThis);
        }

        pub fn schedule(this: *This) void {
            this.ref.ref(this.event_loop.virtual_machine);
            if (comptime async_io) {
                NetworkThread.init() catch return;
                NetworkThread.global.schedule(NetworkThread.Batch.from(&this.task));
            } else {
                WorkPool.schedule(&this.task);
            }
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
        }

        pub fn deinit(this: *This) void {
            var allocator = this.allocator;
            this.ref.unref(this.event_loop.virtual_machine);

            allocator.destroy(this);
        }
    };
}

pub const AnyTask = struct {
    ctx: ?*anyopaque,
    callback: *const (fn (*anyopaque) void),

    pub fn task(this: *AnyTask) Task {
        return Task.init(this);
    }

    pub fn run(this: *AnyTask) void {
        @setRuntimeSafety(false);
        var callback = this.callback;
        var ctx = this.ctx;
        callback(ctx.?);
    }

    pub fn New(comptime Type: type, comptime Callback: anytype) type {
        return struct {
            pub fn init(ctx: *Type) AnyTask {
                return AnyTask{
                    .callback = wrap,
                    .ctx = ctx,
                };
            }

            pub fn wrap(this: ?*anyopaque) void {
                @call(.always_inline, Callback, .{@as(*Type, @ptrCast(@alignCast(this.?)))});
            }
        };
    }
};

pub const ManagedTask = struct {
    ctx: ?*anyopaque,
    callback: *const (fn (*anyopaque) void),

    pub fn task(this: *ManagedTask) Task {
        return Task.init(this);
    }

    pub fn run(this: *ManagedTask) void {
        @setRuntimeSafety(false);
        var callback = this.callback;
        var ctx = this.ctx;
        callback(ctx.?);
        bun.default_allocator.destroy(this);
    }

    pub fn New(comptime Type: type, comptime Callback: anytype) type {
        return struct {
            pub fn init(ctx: *Type) Task {
                var managed = bun.default_allocator.create(ManagedTask) catch @panic("out of memory!");
                managed.* = ManagedTask{
                    .callback = wrap,
                    .ctx = ctx,
                };
                return managed.task();
            }

            pub fn wrap(this: ?*anyopaque) void {
                @call(.always_inline, Callback, .{@as(*Type, @ptrCast(@alignCast(this.?)))});
            }
        };
    }
};

pub const AnyTaskWithExtraContext = struct {
    ctx: ?*anyopaque,
    callback: *const (fn (*anyopaque, *anyopaque) void),
    next: ?*AnyTaskWithExtraContext = null,

    pub fn run(this: *AnyTaskWithExtraContext, extra: *anyopaque) void {
        @setRuntimeSafety(false);
        var callback = this.callback;
        var ctx = this.ctx;
        callback(ctx.?, extra);
    }

    pub fn New(comptime Type: type, comptime ContextType: type, comptime Callback: anytype) type {
        return struct {
            pub fn init(ctx: *Type) AnyTaskWithExtraContext {
                return AnyTaskWithExtraContext{
                    .callback = wrap,
                    .ctx = ctx,
                };
            }

            pub fn wrap(this: ?*anyopaque, extra: ?*anyopaque) void {
                @call(
                    .always_inline,
                    Callback,
                    .{
                        @as(*Type, @ptrCast(@alignCast(this.?))),
                        @as(*ContextType, @ptrCast(@alignCast(extra.?))),
                    },
                );
            }
        };
    }
};

pub const CppTask = opaque {
    extern fn Bun__performTask(globalObject: *JSGlobalObject, task: *CppTask) void;
    pub fn run(this: *CppTask, global: *JSGlobalObject) void {
        JSC.markBinding(@src());
        Bun__performTask(global, this);
    }
};
pub const JSCScheduler = struct {
    pub const JSCDeferredWorkTask = opaque {
        extern fn Bun__runDeferredWork(task: *JSCScheduler.JSCDeferredWorkTask) void;
        pub const run = Bun__runDeferredWork;
    };

    export fn Bun__eventLoop__incrementRefConcurrently(jsc_vm: *VirtualMachine, delta: c_int) void {
        JSC.markBinding(@src());

        if (delta > 0) {
            jsc_vm.uws_event_loop.?.refConcurrently();
        } else {
            jsc_vm.uws_event_loop.?.unrefConcurrently();
        }
    }

    export fn Bun__queueJSCDeferredWorkTaskConcurrently(jsc_vm: *VirtualMachine, task: *JSCScheduler.JSCDeferredWorkTask) void {
        JSC.markBinding(@src());
        var loop = jsc_vm.eventLoop();
        var concurrent_task = bun.default_allocator.create(ConcurrentTask) catch @panic("out of memory!");
        loop.enqueueTaskConcurrent(concurrent_task.from(task, .auto_deinit));
    }

    comptime {
        _ = Bun__eventLoop__incrementRefConcurrently;
        _ = Bun__queueJSCDeferredWorkTaskConcurrently;
    }
};

const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const MicrotaskForDefaultGlobalObject = JSC.MicrotaskForDefaultGlobalObject;
const HotReloadTask = JSC.HotReloader.HotReloadTask;
const FSWatchTask = JSC.Node.FSWatcher.FSWatchTask;
const PollPendingModulesTask = JSC.ModuleLoader.AsyncModule.Queue;
// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
const GetAddrInfoRequestTask = JSC.DNS.GetAddrInfoRequest.Task;
const JSCDeferredWorkTask = JSCScheduler.JSCDeferredWorkTask;
pub const Task = TaggedPointerUnion(.{
    FetchTasklet,
    Microtask,
    MicrotaskForDefaultGlobalObject,
    AsyncTransformTask,
    ReadFileTask,
    CopyFilePromiseTask,
    WriteFileTask,
    AnyTask,
    ManagedTask,
    napi_async_work,
    ThreadSafeFunction,
    CppTask,
    HotReloadTask,
    PollPendingModulesTask,
    GetAddrInfoRequestTask,
    FSWatchTask,
    JSCDeferredWorkTask,

    // PromiseTask,
    // TimeoutTasklet,
});
const UnboundedQueue = @import("./unbounded_queue.zig").UnboundedQueue;
pub const ConcurrentTask = struct {
    task: Task = undefined,
    next: ?*ConcurrentTask = null,
    auto_delete: bool = false,

    pub const Queue = UnboundedQueue(ConcurrentTask, .next);

    pub const AutoDeinit = enum {
        manual_deinit,
        auto_deinit,
    };
    pub fn create(task: Task) *ConcurrentTask {
        var created = bun.default_allocator.create(ConcurrentTask) catch @panic("out of memory!");
        created.* = .{
            .task = task,
            .next = null,
            .auto_delete = true,
        };
        return created;
    }

    pub fn fromCallback(ptr: anytype, comptime callback: anytype) *ConcurrentTask {
        return create(ManagedTask.New(std.meta.Child(@TypeOf(ptr)), callback).init(ptr));
    }

    pub fn from(this: *ConcurrentTask, of: anytype, auto_deinit: AutoDeinit) *ConcurrentTask {
        this.* = .{
            .task = Task.init(of),
            .next = null,
            .auto_delete = auto_deinit == .auto_deinit,
        };
        return this;
    }
};

const AsyncIO = @import("root").bun.AsyncIO;

// This type must be unique per JavaScript thread
pub const GarbageCollectionController = struct {
    gc_timer: *uws.Timer = undefined,
    gc_last_heap_size: usize = 0,
    gc_last_heap_size_on_repeating_timer: usize = 0,
    heap_size_didnt_change_for_repeating_timer_ticks_count: u8 = 0,
    gc_timer_state: GCTimerState = GCTimerState.pending,
    gc_repeating_timer: *uws.Timer = undefined,
    gc_timer_interval: i32 = 0,
    gc_repeating_timer_fast: bool = true,

    pub fn init(this: *GarbageCollectionController, vm: *VirtualMachine) void {
        var actual = vm.uws_event_loop.?;
        this.gc_timer = uws.Timer.createFallthrough(actual, this);
        this.gc_repeating_timer = uws.Timer.createFallthrough(actual, this);

        var gc_timer_interval: i32 = 1000;
        if (vm.bundler.env.map.get("BUN_GC_TIMER_INTERVAL")) |timer| {
            if (std.fmt.parseInt(i32, timer, 10)) |parsed| {
                if (parsed > 0) {
                    gc_timer_interval = parsed;
                }
            } else |_| {}
        }
        this.gc_repeating_timer.set(this, onGCRepeatingTimer, gc_timer_interval, gc_timer_interval);
        this.gc_timer_interval = gc_timer_interval;
    }

    pub fn scheduleGCTimer(this: *GarbageCollectionController) void {
        this.gc_timer_state = .scheduled;
        this.gc_timer.set(this, onGCTimer, 16, 0);
    }

    pub fn bunVM(this: *GarbageCollectionController) *VirtualMachine {
        return @fieldParentPtr(VirtualMachine, "gc_controller", this);
    }

    pub fn onGCTimer(timer: *uws.Timer) callconv(.C) void {
        var this = timer.as(*GarbageCollectionController);
        this.gc_timer_state = .run_on_next_tick;
    }

    // We want to always run GC once in awhile
    // But if you have a long-running instance of Bun, you don't want the
    // program constantly using CPU doing GC for no reason
    //
    // So we have two settings for this GC timer:
    //
    //    - Fast: GC runs every 1 second
    //    - Slow: GC runs every 30 seconds
    //
    // When the heap size is increasing, we always switch to fast mode
    // When the heap size has been the same or less for 30 seconds, we switch to slow mode
    pub fn updateGCRepeatTimer(this: *GarbageCollectionController, comptime setting: @Type(.EnumLiteral)) void {
        if (setting == .fast and !this.gc_repeating_timer_fast) {
            this.gc_repeating_timer_fast = true;
            this.gc_repeating_timer.set(this, onGCRepeatingTimer, this.gc_timer_interval, this.gc_timer_interval);
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        } else if (setting == .slow and this.gc_repeating_timer_fast) {
            this.gc_repeating_timer_fast = false;
            this.gc_repeating_timer.set(this, onGCRepeatingTimer, 30_000, 30_000);
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        }
    }

    pub fn onGCRepeatingTimer(timer: *uws.Timer) callconv(.C) void {
        var this = timer.as(*GarbageCollectionController);
        const prev_heap_size = this.gc_last_heap_size_on_repeating_timer;
        this.performGC();
        this.gc_last_heap_size_on_repeating_timer = this.gc_last_heap_size;
        if (prev_heap_size == this.gc_last_heap_size_on_repeating_timer) {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count +|= 1;
            if (this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30) {
                // make the timer interval longer
                this.updateGCRepeatTimer(.slow);
            }
        } else {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            this.updateGCRepeatTimer(.fast);
        }
    }

    pub fn processGCTimer(this: *GarbageCollectionController) void {
        var vm = this.bunVM().global.vm();
        this.processGCTimerWithHeapSize(vm, vm.blockBytesAllocated());
    }

    pub fn processGCTimerWithHeapSize(this: *GarbageCollectionController, vm: *JSC.VM, this_heap_size: usize) void {
        const prev = this.gc_last_heap_size;

        switch (this.gc_timer_state) {
            .run_on_next_tick => {
                // When memory usage is not stable, run the GC more.
                if (this_heap_size != prev) {
                    this.scheduleGCTimer();
                    this.updateGCRepeatTimer(.fast);
                } else {
                    this.gc_timer_state = .pending;
                }
                vm.collectAsync();
                this.gc_last_heap_size = this_heap_size;
            },
            .pending => {
                if (this_heap_size != prev) {
                    this.updateGCRepeatTimer(.fast);

                    if (this_heap_size > prev * 2) {
                        this.performGC();
                    } else {
                        this.scheduleGCTimer();
                    }
                }
            },
            .scheduled => {
                if (this_heap_size > prev * 2) {
                    this.updateGCRepeatTimer(.fast);
                    this.performGC();
                }
            },
        }
    }

    pub fn performGC(this: *GarbageCollectionController) void {
        var vm = this.bunVM().global.vm();
        vm.collectAsync();
        this.gc_last_heap_size = vm.blockBytesAllocated();
    }

    pub const GCTimerState = enum {
        pending,
        scheduled,
        run_on_next_tick,
    };
};

pub const EventLoop = struct {
    tasks: Queue = undefined,
    concurrent_tasks: ConcurrentTask.Queue = ConcurrentTask.Queue{},
    global: *JSGlobalObject = undefined,
    virtual_machine: *JSC.VirtualMachine = undefined,
    waker: ?AsyncIO.Waker = null,
    start_server_on_next_tick: bool = false,
    defer_count: std.atomic.Atomic(usize) = std.atomic.Atomic(usize).init(0),
    forever_timer: ?*uws.Timer = null,

    pub const Queue = std.fifo.LinearFifo(Task, .Dynamic);
    const log = bun.Output.scoped(.EventLoop, false);

    pub fn tickWithCount(this: *EventLoop) u32 {
        var global = this.global;
        var global_vm = global.vm();
        var counter: usize = 0;
        while (this.tasks.readItem()) |task| {
            defer counter += 1;
            switch (task.tag()) {
                .Microtask => {
                    var micro: *Microtask = task.as(Microtask);
                    micro.run(global);
                },
                .MicrotaskForDefaultGlobalObject => {
                    var micro: *MicrotaskForDefaultGlobalObject = task.as(MicrotaskForDefaultGlobalObject);
                    micro.run(global);
                },
                .FetchTasklet => {
                    var fetch_task: *Fetch.FetchTasklet = task.get(Fetch.FetchTasklet).?;
                    fetch_task.onDone();
                    fetch_task.deinit();
                },
                @field(Task.Tag, @typeName(AsyncTransformTask)) => {
                    var transform_task: *AsyncTransformTask = task.get(AsyncTransformTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                },
                @field(Task.Tag, @typeName(CopyFilePromiseTask)) => {
                    var transform_task: *CopyFilePromiseTask = task.get(CopyFilePromiseTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(JSC.napi.napi_async_work))) => {
                    var transform_task: *JSC.napi.napi_async_work = task.get(JSC.napi.napi_async_work).?;
                    transform_task.*.runFromJS();
                },
                .ThreadSafeFunction => {
                    var transform_task: *ThreadSafeFunction = task.as(ThreadSafeFunction);
                    transform_task.call();
                },
                @field(Task.Tag, @typeName(ReadFileTask)) => {
                    var transform_task: *ReadFileTask = task.get(ReadFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                },
                @field(Task.Tag, bun.meta.typeBaseName(@typeName(JSCDeferredWorkTask))) => {
                    var jsc_task: *JSCDeferredWorkTask = task.get(JSCDeferredWorkTask).?;
                    JSC.markBinding(@src());
                    jsc_task.run();
                },
                @field(Task.Tag, @typeName(WriteFileTask)) => {
                    var transform_task: *WriteFileTask = task.get(WriteFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                },
                @field(Task.Tag, @typeName(HotReloadTask)) => {
                    var transform_task: *HotReloadTask = task.get(HotReloadTask).?;
                    transform_task.*.run();
                    transform_task.deinit();
                    // special case: we return
                    return 0;
                },
                .FSWatchTask => {
                    var transform_task: *FSWatchTask = task.get(FSWatchTask).?;
                    transform_task.*.run();
                    transform_task.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(AnyTask))) => {
                    var any: *AnyTask = task.get(AnyTask).?;
                    any.run();
                },
                @field(Task.Tag, typeBaseName(@typeName(ManagedTask))) => {
                    var any: *ManagedTask = task.get(ManagedTask).?;
                    any.run();
                },
                @field(Task.Tag, typeBaseName(@typeName(CppTask))) => {
                    var any: *CppTask = task.get(CppTask).?;
                    any.run(global);
                },
                @field(Task.Tag, typeBaseName(@typeName(PollPendingModulesTask))) => {
                    this.virtual_machine.modules.onPoll();
                },
                @field(Task.Tag, typeBaseName(@typeName(GetAddrInfoRequestTask))) => {
                    var any: *GetAddrInfoRequestTask = task.get(GetAddrInfoRequestTask).?;
                    any.runFromJS();
                    any.deinit();
                },
                else => if (Environment.allow_assert) {
                    bun.Output.prettyln("\nUnexpected tag: {s}\n", .{@tagName(task.tag())});
                } else {
                    log("\nUnexpected tag: {s}\n", .{@tagName(task.tag())});
                    unreachable;
                },
            }

            global_vm.releaseWeakRefs();
            global_vm.drainMicrotasks();
        }

        this.tasks.head = if (this.tasks.count == 0) 0 else this.tasks.head;
        return @as(u32, @truncate(counter));
    }

    pub fn tickConcurrent(this: *EventLoop) void {
        _ = this.tickConcurrentWithCount();
    }

    pub fn tickConcurrentWithCount(this: *EventLoop) usize {
        var concurrent = this.concurrent_tasks.popBatch();
        const count = concurrent.count;
        if (count == 0)
            return 0;

        var iter = concurrent.iterator();
        const start_count = this.tasks.count;
        if (start_count == 0) {
            this.tasks.head = 0;
        }

        this.tasks.ensureUnusedCapacity(count) catch unreachable;
        var writable = this.tasks.writableSlice(0);
        while (iter.next()) |task| {
            writable[0] = task.task;
            writable = writable[1..];
            this.tasks.count += 1;
            if (task.auto_delete) bun.default_allocator.destroy(task);
            if (writable.len == 0) break;
        }

        return this.tasks.count - start_count;
    }

    pub fn autoTick(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        var loop = ctx.uws_event_loop.?;

        // Some tasks need to keep the event loop alive for one more tick.
        // We want to keep the event loop alive long enough to process those ticks and any microtasks
        //
        // BUT. We don't actually have an idle event in that case.
        // That means the process will be waiting forever on nothing.
        // So we need to drain the counter immediately before entering uSockets loop
        const pending_unref = ctx.pending_unref_counter;
        if (pending_unref > 0) {
            ctx.pending_unref_counter = 0;
            loop.unrefCount(pending_unref);
        }

        if (loop.num_polls > 0 or loop.active > 0) {
            loop.tick();
            this.processGCTimer();
            // this.afterUSocketsTick();
        }
    }

    pub fn tickPossiblyForever(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        var loop = ctx.uws_event_loop.?;

        const pending_unref = ctx.pending_unref_counter;
        if (pending_unref > 0) {
            ctx.pending_unref_counter = 0;
            loop.unrefCount(pending_unref);
        }

        if (loop.num_polls == 0 or loop.active == 0) {
            if (this.forever_timer == null) {
                var t = uws.Timer.create(loop, this);
                t.set(this, &noopForeverTimer, 1000 * 60 * 4, 1000 * 60 * 4);
                this.forever_timer = t;
            }
        }

        loop.tick();
        this.processGCTimer();
        this.tickConcurrent();
        this.tick();
    }

    fn noopForeverTimer(_: *uws.Timer) callconv(.C) void {
        // do nothing
    }

    pub fn autoTickActive(this: *EventLoop) void {
        var loop = this.virtual_machine.uws_event_loop.?;

        var ctx = this.virtual_machine;

        const pending_unref = ctx.pending_unref_counter;
        if (pending_unref > 0) {
            ctx.pending_unref_counter = 0;
            loop.unrefCount(pending_unref);
        }

        if (loop.active > 0) {
            loop.tick();
            this.processGCTimer();
            // this.afterUSocketsTick();
        }
    }

    pub fn processGCTimer(this: *EventLoop) void {
        this.virtual_machine.gc_controller.processGCTimer();
    }

    pub fn tick(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        this.tickConcurrent();

        this.processGCTimer();

        var global_vm = ctx.global.vm();
        while (true) {
            while (this.tickWithCount() > 0) : (this.global.handleRejectedPromises()) {
                this.tickConcurrent();
            } else {
                global_vm.releaseWeakRefs();
                global_vm.drainMicrotasks();
                this.tickConcurrent();
                if (this.tasks.count > 0) continue;
            }
            break;
        }

        while (this.tickWithCount() > 0) {
            this.tickConcurrent();
        }

        this.global.handleRejectedPromises();
    }

    pub fn runUSocketsLoop(this: *EventLoop) void {
        var ctx = this.virtual_machine;

        ctx.global.vm().releaseWeakRefs();
        ctx.global.vm().drainMicrotasks();
        var loop = ctx.uws_event_loop orelse return;

        if (loop.active > 0 or (ctx.us_loop_reference_count > 0 and !ctx.is_us_loop_entered and (loop.num_polls > 0 or this.start_server_on_next_tick))) {
            if (this.tickConcurrentWithCount() > 0) {
                this.tick();
            }

            ctx.is_us_loop_entered = true;
            this.start_server_on_next_tick = false;
            ctx.enterUWSLoop();
            ctx.is_us_loop_entered = false;
            ctx.autoGarbageCollect();
        }
    }

    pub fn waitForPromise(this: *EventLoop, promise: JSC.AnyPromise) void {
        switch (promise.status(this.global.vm())) {
            JSC.JSPromise.Status.Pending => {
                while (promise.status(this.global.vm()) == .Pending) {
                    this.tick();

                    if (promise.status(this.global.vm()) == .Pending) {
                        this.autoTick();
                    }
                }
            },
            else => {},
        }
    }

    pub fn waitForPromiseWithTimeout(this: *EventLoop, promise: JSC.AnyPromise, timeout: u32) bool {
        return switch (promise.status(this.global.vm())) {
            JSC.JSPromise.Status.Pending => {
                if (timeout == 0) {
                    return false;
                }
                var start_time = std.time.milliTimestamp();
                while (promise.status(this.global.vm()) == .Pending) {
                    this.tick();

                    if (std.time.milliTimestamp() - start_time > timeout) {
                        return false;
                    }

                    if (promise.status(this.global.vm()) == .Pending) {
                        this.autoTick();
                    }
                }
                return true;
            },
            else => true,
        };
    }

    pub fn waitForTasks(this: *EventLoop) void {
        this.tick();
        while (this.tasks.count > 0) {
            this.tick();

            if (this.virtual_machine.uws_event_loop != null) {
                this.runUSocketsLoop();
            }
        } else {
            if (this.virtual_machine.uws_event_loop != null) {
                this.runUSocketsLoop();
            }
        }
    }

    pub fn enqueueTask(this: *EventLoop, task: Task) void {
        this.tasks.writeItem(task) catch unreachable;
    }

    pub fn enqueueTaskWithTimeout(this: *EventLoop, task: Task, timeout: i32) void {
        // TODO: make this more efficient!
        var loop = this.virtual_machine.uws_event_loop orelse @panic("EventLoop.enqueueTaskWithTimeout: uSockets event loop is not initialized");
        var timer = uws.Timer.createFallthrough(loop, task.ptr());
        timer.set(task.ptr(), callTask, timeout, 0);
    }

    pub fn callTask(timer: *uws.Timer) callconv(.C) void {
        var task = Task.from(timer.as(*anyopaque));
        timer.deinit();

        JSC.VirtualMachine.get().enqueueTask(task);
    }

    pub fn ensureWaker(this: *EventLoop) void {
        JSC.markBinding(@src());
        if (this.virtual_machine.uws_event_loop == null) {
            var actual = uws.Loop.get().?;
            this.virtual_machine.uws_event_loop = actual;
            this.virtual_machine.gc_controller.init(this.virtual_machine);
            // _ = actual.addPostHandler(*JSC.EventLoop, this, JSC.EventLoop.afterUSocketsTick);
            // _ = actual.addPreHandler(*JSC.VM, this.virtual_machine.global.vm(), JSC.VM.drainMicrotasks);
        }
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn performGC(this: *EventLoop) void {
        this.virtual_machine.gc_controller.performGC();
    }

    pub fn wakeup(this: *EventLoop) void {
        if (this.virtual_machine.uws_event_loop) |loop| {
            loop.wakeup();
        }
    }
    pub fn enqueueTaskConcurrent(this: *EventLoop, task: *ConcurrentTask) void {
        JSC.markBinding(@src());

        this.concurrent_tasks.push(task);
        this.wakeup();
    }
};

pub const MiniEventLoop = struct {
    tasks: Queue,
    concurrent_tasks: UnboundedQueue(AnyTaskWithExtraContext, .next) = .{},
    loop: *uws.Loop,
    allocator: std.mem.Allocator,

    const Queue = std.fifo.LinearFifo(*AnyTaskWithExtraContext, .Dynamic);

    pub const Task = AnyTaskWithExtraContext;

    pub fn init(
        allocator: std.mem.Allocator,
    ) MiniEventLoop {
        return .{
            .tasks = Queue.init(allocator),
            .allocator = allocator,
            .loop = uws.Loop.get().?,
        };
    }

    pub fn deinit(this: *MiniEventLoop) void {
        this.tasks.deinit();
        std.debug.assert(this.concurrent_tasks.isEmpty());
    }

    pub fn tickConcurrentWithCount(this: *MiniEventLoop) usize {
        var concurrent = this.concurrent_tasks.popBatch();
        const count = concurrent.count;
        if (count == 0)
            return 0;

        var iter = concurrent.iterator();
        const start_count = this.tasks.count;
        if (start_count == 0) {
            this.tasks.head = 0;
        }

        this.tasks.ensureUnusedCapacity(count) catch unreachable;
        var writable = this.tasks.writableSlice(0);
        while (iter.next()) |task| {
            writable[0] = task;
            writable = writable[1..];
            this.tasks.count += 1;
            if (writable.len == 0) break;
        }

        return this.tasks.count - start_count;
    }

    pub fn tick(
        this: *MiniEventLoop,
        context: *anyopaque,
        comptime isDone: fn (*anyopaque) bool,
    ) void {
        while (!isDone(context)) {
            if (this.tickConcurrentWithCount() == 0 and this.tasks.count == 0) {
                this.loop.num_polls += 1;
                this.loop.tick();
                this.loop.num_polls -= 1;
            }

            while (this.tasks.readItem()) |task| {
                task.run(context);
            }
        }
    }

    pub fn enqueueTask(
        this: *MiniEventLoop,
        comptime Context: type,
        ctx: *Context,
        comptime Callback: fn (*Context) void,
        comptime field: std.meta.FieldEnum(Context),
    ) void {
        const TaskType = MiniEventLoop.Task.New(Context, Callback);
        @field(ctx, @tagName(field)) = TaskType.init(ctx);
        this.enqueueJSCTask(&@field(ctx, @tagName(field)));
    }

    pub fn enqueueTaskConcurrent(
        this: *MiniEventLoop,
        comptime Context: type,
        comptime ParentContext: type,
        ctx: *Context,
        comptime Callback: fn (*Context, *ParentContext) void,
        comptime field: std.meta.FieldEnum(Context),
    ) void {
        JSC.markBinding(@src());
        const TaskType = MiniEventLoop.Task.New(Context, ParentContext, Callback);
        @field(ctx, @tagName(field)) = TaskType.init(ctx);

        this.concurrent_tasks.push(&@field(ctx, @tagName(field)));

        this.loop.wakeup();
    }
};

pub const AnyEventLoop = union(enum) {
    jsc: *EventLoop,
    mini: MiniEventLoop,

    pub const Task = AnyTaskWithExtraContext;

    pub fn fromJSC(
        this: *AnyEventLoop,
        jsc: *EventLoop,
    ) void {
        this.* = .{ .jsc = jsc };
    }

    pub fn init(
        allocator: std.mem.Allocator,
    ) AnyEventLoop {
        return .{ .mini = MiniEventLoop.init(allocator) };
    }

    pub fn tick(
        this: *AnyEventLoop,
        context: *anyopaque,
        comptime isDone: fn (*anyopaque) bool,
    ) void {
        switch (this.*) {
            .jsc => {
                this.jsc.tick();
                this.jsc.autoTick();
            },
            .mini => {
                this.mini.tick(context, isDone);
            },
        }
    }

    pub fn enqueueTaskConcurrent(
        this: *AnyEventLoop,
        comptime Context: type,
        comptime ParentContext: type,
        ctx: *Context,
        comptime Callback: fn (*Context, *ParentContext) void,
        comptime field: std.meta.FieldEnum(Context),
    ) void {
        switch (this.*) {
            .jsc => {
                unreachable; // TODO:
                // const TaskType = AnyTask.New(Context, Callback);
                // @field(ctx, field) = TaskType.init(ctx);
                // var concurrent = bun.default_allocator.create(ConcurrentTask) catch unreachable;
                // _ = concurrent.from(JSC.Task.init(&@field(ctx, field)));
                // concurrent.auto_delete = true;
                // this.jsc.enqueueTaskConcurrent(concurrent);
            },
            .mini => {
                this.mini.enqueueTaskConcurrent(Context, ParentContext, ctx, Callback, field);
            },
        }
    }
};
