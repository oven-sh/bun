const std = @import("std");
const JSC = @import("javascript_core");
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const Lock = @import("../lock.zig").Lock;
const Microtask = JSC.Microtask;
const bun = @import("../global.zig");
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
const NetworkThread = @import("http").NetworkThread;
const uws = @import("uws");

pub fn ConcurrentPromiseTask(comptime Context: type) type {
    return struct {
        const This = @This();
        ctx: *Context,
        task: WorkPoolTask = .{ .callback = runFromThreadPool },
        event_loop: *JSC.EventLoop,
        allocator: std.mem.Allocator,
        promise: JSValue,
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
                .promise = JSValue.createInternalPromise(globalThis),
                .globalThis = globalThis,
            };
            this.promise.protect();
            this.ref.ref(this.event_loop.virtual_machine);

            return this;
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            var this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx);
            this.onFinish();
        }

        pub fn runFromJS(this: *This) void {
            var promise_value = this.promise;
            this.ref.unref(this.event_loop.virtual_machine);

            promise_value.ensureStillAlive();
            promise_value.unprotect();

            var promise = promise_value.asInternalPromise() orelse {
                if (comptime @hasDecl(Context, "deinit")) {
                    @call(.{}, Context.deinit, .{this.ctx});
                }
                return;
            };

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

const AsyncIO = @import("io");

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

        if (this.tasks.count == 0) {
            this.tasks.head = 0;
        }

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
        if (this.virtual_machine.uws_event_loop.?.num_polls > 0 or this.virtual_machine.uws_event_loop.?.active > 0) {
            this.virtual_machine.uws_event_loop.?.tick();
            // this.afterUSocketsTick();
        }
    }

    // TODO: fix this technical debt
    pub fn tick(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        this.tickConcurrent();
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
            } else {
                if ((@intCast(c_ulonglong, ctx.uws_event_loop.?.internal_loop_data.iteration_nr) % 1_000) == 1) {
                    _ = ctx.global.vm().runGC(true);
                }
            }

            ctx.is_us_loop_entered = true;
            this.start_server_on_next_tick = false;
            ctx.enterUWSLoop();
            ctx.is_us_loop_entered = false;
        }
    }

    // TODO: fix this technical debt
    pub fn waitForPromise(this: *EventLoop, promise: *JSC.JSInternalPromise) void {
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

    pub fn ensureWaker(this: *EventLoop) void {
        JSC.markBinding(@src());
        if (this.virtual_machine.uws_event_loop == null) {
            var actual = uws.Loop.get().?;
            this.virtual_machine.uws_event_loop = actual;
            // _ = actual.addPostHandler(*JSC.EventLoop, this, JSC.EventLoop.afterUSocketsTick);
            // _ = actual.addPreHandler(*JSC.VM, this.virtual_machine.global.vm(), JSC.VM.drainMicrotasks);
        }
    }

    pub fn enqueueTaskConcurrent(this: *EventLoop, task: *ConcurrentTask) void {
        JSC.markBinding(@src());

        this.concurrent_tasks.push(task);

        if (this.virtual_machine.uws_event_loop) |loop| {
            loop.wakeup();
        }
    }
};
