const std = @import("std");
const JSC = @import("bun").JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const Lock = @import("../lock.zig").Lock;
const Microtask = JSC.Microtask;
const bun = @import("bun");
const Environment = bun.Environment;
const Fetch = JSC.WebCore.Fetch;
const WebCore = JSC.WebCore;
const Bun = JSC.API.Bun;
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const typeBaseName = @import("../meta.zig").typeBaseName;
const CopyFilePromiseTask = WebCore.Blob.Store.CopyFile.CopyFilePromiseTask;
const AsyncTransformTask = @import("./api/transpiler.zig").TransformTask.AsyncTransformTask;
const ReadFileTask = WebCore.Blob.Store.ReadFile.ReadFileTask;
const WriteFileTask = WebCore.Blob.Store.WriteFile.WriteFileTask;
const napi_async_work = JSC.napi.napi_async_work;
const FetchTasklet = Fetch.FetchTasklet;
const JSValue = JSC.JSValue;
const js = JSC.C;
pub const WorkPool = @import("../work_pool.zig").WorkPool;
pub const WorkPoolTask = @import("../work_pool.zig").Task;
const NetworkThread = @import("bun").HTTP.NetworkThread;
const uws = @import("bun").uws;

pub fn ConcurrentPromiseTask(comptime Context: type) type {
    return struct {
        const This = @This();
        ctx: *Context,
        task: WorkPoolTask = .{ .callback = runFromThreadPool },
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
                .event_loop = VirtualMachine.vm.event_loop,
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
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this));
        }

        pub fn deinit(this: *This) void {
            this.allocator.destroy(this);
        }
    };
}

pub fn IOTask(comptime Context: type) type {
    return struct {
        const This = @This();
        ctx: *Context,
        task: NetworkThread.Task = .{ .callback = runFromThreadPool },
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

        pub fn runFromThreadPool(task: *NetworkThread.Task) void {
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
            NetworkThread.init() catch return;
            NetworkThread.global.schedule(NetworkThread.Batch.from(&this.task));
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this));
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
    callback: fn (*anyopaque) void,

    pub fn run(this: *AnyTask) void {
        @setRuntimeSafety(false);
        this.callback(this.ctx.?);
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
                Callback(@ptrCast(*Type, @alignCast(@alignOf(Type), this.?)));
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
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const MicrotaskForDefaultGlobalObject = JSC.MicrotaskForDefaultGlobalObject;
const HotReloadTask = JSC.HotReloader.HotReloadTask;
const PollPendingModulesTask = JSC.ModuleLoader.AsyncModule.Queue;
// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
pub const Task = TaggedPointerUnion(.{
    FetchTasklet,
    Microtask,
    MicrotaskForDefaultGlobalObject,
    AsyncTransformTask,
    ReadFileTask,
    CopyFilePromiseTask,
    WriteFileTask,
    AnyTask,
    napi_async_work,
    ThreadSafeFunction,
    CppTask,
    HotReloadTask,
    PollPendingModulesTask,
    // PromiseTask,
    // TimeoutTasklet,
});
const UnboundedQueue = @import("./unbounded_queue.zig").UnboundedQueue;
pub const ConcurrentTask = struct {
    task: Task = undefined,
    next: ?*ConcurrentTask = null,
    auto_delete: bool = false,

    pub const Queue = UnboundedQueue(ConcurrentTask, .next);

    pub fn from(this: *ConcurrentTask, of: anytype) *ConcurrentTask {
        this.* = .{
            .task = Task.init(of),
            .next = null,
        };
        return this;
    }
};

const AsyncIO = @import("bun").AsyncIO;

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
        const this_heap_size = vm.blockBytesAllocated();
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

    pub const Queue = std.fifo.LinearFifo(Task, .Dynamic);

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
                @field(Task.Tag, @typeName(ReadFileTask)) => {
                    var transform_task: *ReadFileTask = task.get(ReadFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                },
                @field(Task.Tag, @typeName(WriteFileTask)) => {
                    var transform_task: *WriteFileTask = task.get(WriteFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                },
                .HotReloadTask => {
                    var transform_task: *HotReloadTask = task.get(HotReloadTask).?;
                    transform_task.*.run();
                    transform_task.deinit();
                    // special case: we return
                    return 0;
                },
                @field(Task.Tag, typeBaseName(@typeName(AnyTask))) => {
                    var any: *AnyTask = task.get(AnyTask).?;
                    any.run();
                },
                @field(Task.Tag, typeBaseName(@typeName(CppTask))) => {
                    var any: *CppTask = task.get(CppTask).?;
                    any.run(global);
                },
                @field(Task.Tag, typeBaseName(@typeName(PollPendingModulesTask))) => {
                    this.virtual_machine.modules.onPoll();
                },
                else => if (Environment.allow_assert) {
                    bun.Output.prettyln("\nUnexpected tag: {s}\n", .{@tagName(task.tag())});
                } else unreachable,
            }

            global_vm.releaseWeakRefs();
            global_vm.drainMicrotasks();
        }

        this.tasks.head = if (this.tasks.count == 0) 0 else this.tasks.head;
        return @truncate(u32, counter);
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
        var loop = this.virtual_machine.uws_event_loop.?;
        if (loop.num_polls > 0 or loop.active > 0) {
            loop.tick();
            this.processGCTimer();
            // this.afterUSocketsTick();
        }
    }

    pub fn autoTickActive(this: *EventLoop) void {
        var loop = this.virtual_machine.uws_event_loop.?;
        if (loop.active > 0) {
            loop.tick();
            this.processGCTimer();
            // this.afterUSocketsTick();
        }
    }

    pub fn processGCTimer(this: *EventLoop) void {
        this.virtual_machine.gc_controller.processGCTimer();
    }

    // TODO: fix this technical debt
    pub fn tick(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        this.tickConcurrent();

        this.processGCTimer();

        var global_vm = ctx.global.vm();
        while (true) {
            while (this.tickWithCount() > 0) {
                this.tickConcurrent();
            } else {
                global_vm.releaseWeakRefs();
                global_vm.drainMicrotasks();
                this.tickConcurrent();
                if (this.tasks.count > 0) continue;
            }
            break;
        }

        this.global.vm().doWork();

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

    // TODO: fix this technical debt
    pub fn waitForPromise(this: *EventLoop, promise: anytype) void {
        return waitForPromiseWithType(this, std.meta.Child(@TypeOf(promise)), promise);
    }

    pub fn waitForPromiseWithType(this: *EventLoop, comptime Promise: type, promise: *Promise) void {
        comptime {
            switch (Promise) {
                JSC.JSPromise, JSC.JSInternalPromise => {},
                else => @compileError("Promise must be a JSPromise or JSInternalPromise, received: " ++ @typeName(Promise)),
            }
        }

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

        JSC.VirtualMachine.vm.enqueueTask(task);
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

    pub fn enqueueTaskConcurrent(this: *EventLoop, task: *ConcurrentTask) void {
        JSC.markBinding(@src());

        this.concurrent_tasks.push(task);

        if (this.virtual_machine.uws_event_loop) |loop| {
            loop.wakeup();
        }
    }
};
