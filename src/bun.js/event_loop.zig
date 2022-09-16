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
const BunTimerTimeoutTask = Bun.Timer.Timeout.TimeoutTask;
const ReadFileTask = WebCore.Blob.Store.ReadFile.ReadFileTask;
const WriteFileTask = WebCore.Blob.Store.WriteFile.WriteFileTask;
const napi_async_work = JSC.napi.napi_async_work;
const FetchTasklet = Fetch.FetchTasklet;
const JSValue = JSC.JSValue;
const js = JSC.C;
pub const WorkPool = @import("../work_pool.zig").WorkPool;
pub const WorkPoolTask = @import("../work_pool.zig").Task;
const NetworkThread = @import("http").NetworkThread;

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
            VirtualMachine.vm.active_tasks +|= 1;
            return this;
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            var this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx);
            this.onFinish();
        }

        pub fn runFromJS(this: This) void {
            var promise_value = this.promise;
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

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = VirtualMachine.vm.eventLoop(),
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
            };
            VirtualMachine.vm.active_tasks +|= 1;
            return this;
        }

        pub fn runFromThreadPool(task: *NetworkThread.Task) void {
            var this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx, this);
        }

        pub fn runFromJS(this: This) void {
            var ctx = this.ctx;
            ctx.then(this.globalThis);
        }

        pub fn schedule(this: *This) void {
            NetworkThread.init() catch return;
            NetworkThread.global.schedule(NetworkThread.Batch.from(&this.task));
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this));
        }

        pub fn deinit(this: *This) void {
            var allocator = this.allocator;
            this.* = undefined;
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
        JSC.markBinding();
        Bun__performTask(global, this);
    }
};
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const MicrotaskForDefaultGlobalObject = JSC.MicrotaskForDefaultGlobalObject;
// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
pub const Task = TaggedPointerUnion(.{
    FetchTasklet,
    Microtask,
    MicrotaskForDefaultGlobalObject,
    AsyncTransformTask,
    BunTimerTimeoutTask,
    ReadFileTask,
    CopyFilePromiseTask,
    WriteFileTask,
    AnyTask,
    napi_async_work,
    ThreadSafeFunction,
    CppTask,
    // PromiseTask,
    // TimeoutTasklet,
});
const UnboundedQueue = @import("./unbounded_queue.zig").UnboundedQueue;
pub const ConcurrentTask = struct {
    task: Task = undefined,
    next: ?*ConcurrentTask = null,

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
    virtual_machine: *VirtualMachine = undefined,
    waker: ?AsyncIO.Waker = null,
    defer_count: std.atomic.Atomic(usize) = std.atomic.Atomic(usize).init(0),
    pub const Queue = std.fifo.LinearFifo(Task, .Dynamic);

    pub fn tickWithCount(this: *EventLoop) u32 {
        var global = this.global;
        var global_vm = global.vm();
        var vm_ = this.virtual_machine;
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
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(AsyncTransformTask)) => {
                    var transform_task: *AsyncTransformTask = task.get(AsyncTransformTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(CopyFilePromiseTask)) => {
                    var transform_task: *CopyFilePromiseTask = task.get(CopyFilePromiseTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, typeBaseName(@typeName(JSC.napi.napi_async_work))) => {
                    var transform_task: *JSC.napi.napi_async_work = task.get(JSC.napi.napi_async_work).?;
                    transform_task.*.runFromJS();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(BunTimerTimeoutTask)) => {
                    var transform_task: *BunTimerTimeoutTask = task.get(BunTimerTimeoutTask).?;
                    transform_task.*.runFromJS();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(ReadFileTask)) => {
                    var transform_task: *ReadFileTask = task.get(ReadFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(WriteFileTask)) => {
                    var transform_task: *WriteFileTask = task.get(WriteFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, typeBaseName(@typeName(AnyTask))) => {
                    var any: *AnyTask = task.get(AnyTask).?;
                    any.run();
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, typeBaseName(@typeName(CppTask))) => {
                    var any: *CppTask = task.get(CppTask).?;
                    any.run(global);
                    vm_.active_tasks -|= 1;
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
            if (writable.len == 0) break;
        }

        return this.tasks.count - start_count;
    }

    // TODO: fix this technical debt
    pub fn tick(this: *EventLoop) void {
        var poller = &this.virtual_machine.poller;
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

            this.global.vm().doWork();
            poller.tick();

            break;
        }

        this.global.handleRejectedPromises();
    }

    pub fn runUSocketsLoop(this: *EventLoop) void {
        var ctx = this.virtual_machine;

        ctx.global.vm().releaseWeakRefs();
        ctx.global.vm().drainMicrotasks();

        if (ctx.us_loop_reference_count > 0 and !ctx.is_us_loop_entered) {
            if (this.tickConcurrentWithCount() > 0) {
                this.tick();
            } else if (ctx.uws_event_loop.?.num_polls > 0) {
                if ((@intCast(c_ulonglong, ctx.uws_event_loop.?.internal_loop_data.iteration_nr) % 1_000) == 1) {
                    _ = ctx.global.vm().runGC(true);
                }
            }

            ctx.is_us_loop_entered = true;
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

                    if (this.virtual_machine.uws_event_loop != null) {
                        this.runUSocketsLoop();
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
        JSC.markBinding();
        if (this.waker == null) {
            this.waker = AsyncIO.Waker.init(this.virtual_machine.allocator) catch unreachable;
        }
    }

    pub fn onDefer(this: *EventLoop) void {
        this.defer_count.store(0, .Monotonic);
        this.tick();
    }

    pub fn enqueueTaskConcurrent(this: *EventLoop, task: *ConcurrentTask) void {
        JSC.markBinding();

        this.concurrent_tasks.push(task);

        if (this.virtual_machine.uws_event_loop) |loop| {
            const deferCount = this.defer_count.fetchAdd(1, .Monotonic);
            if (deferCount == 0) {
                loop.nextTick(*EventLoop, this, onDefer);
            }
        }

        if (this.waker) |*waker| {
            waker.wake() catch unreachable;
        }
    }
};

pub const Poller = struct {
    /// kqueue() or epoll()
    /// 0 == unset
    watch_fd: i32 = 0,
    active: u32 = 0,

    pub const PlatformSpecificFlags = struct {};

    const Completion = fn (ctx: ?*anyopaque, sizeOrOffset: i64, flags: u16) void;
    const kevent64 = std.os.system.kevent64_s;
    pub fn dispatchKQueueEvent(kqueue_event: *const kevent64) void {
        if (comptime !Environment.isMac) {
            unreachable;
        }

        const ptr = @intToPtr(?*anyopaque, kqueue_event.udata);
        const callback: Completion = @intToPtr(Completion, kqueue_event.ext[0]);
        callback(ptr, @bitCast(i64, kqueue_event.data), kqueue_event.flags);
    }

    const timeout = std.mem.zeroes(std.os.timespec);

    pub fn watch(this: *Poller, fd: JSC.Node.FileDescriptor, flag: Flag, ctx: ?*anyopaque, completion: Completion) JSC.Maybe(void) {
        if (comptime Environment.isLinux) {
            // std.debug.assert(this.watch_fd != 0);
            // TODO:
            return JSC.Maybe(void).success;
        } else if (comptime Environment.isMac) {
            if (this.watch_fd == 0) {
                this.watch_fd = std.c.kqueue();
                if (this.watch_fd == -1) {
                    defer this.watch_fd = 0;
                    return JSC.Maybe(void).errnoSys(this.watch_fd, .kqueue).?;
                }
            }

            var events_list = std.mem.zeroes([2]kevent64);
            events_list[0] = switch (flag) {
                .read => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @ptrToInt(ctx),
                    .flags = std.c.EV_ADD | std.c.EV_ENABLE | std.c.EV_ONESHOT,
                    .ext = .{ @ptrToInt(completion), 0 },
                },
                .write => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @ptrToInt(ctx),
                    .flags = std.c.EV_ADD | std.c.EV_ENABLE | std.c.EV_ONESHOT,
                    .ext = .{ @ptrToInt(completion), 0 },
                },
            };

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = std.os.system.kevent64(
                this.watch_fd,
                &events_list,
                1,
                // The same array may be used for the changelist and eventlist.
                &events_list,
                1,
                0,
                &timeout,
            );

            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (events_list[0].flags == std.c.EV_ERROR) {
                return JSC.Maybe(void).errnoSys(events_list[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            switch (rc) {
                std.math.minInt(@TypeOf(rc))...-1 => return JSC.Maybe(void).errnoSys(@enumToInt(std.c.getErrno(rc)), .kevent).?,
                0 => {
                    this.active += 1;
                    return JSC.Maybe(void).success;
                },
                1 => {
                    // if we immediately get an event, we can skip the reference counting
                    dispatchKQueueEvent(&events_list[0]);
                    return JSC.Maybe(void).success;
                },
                2 => {
                    dispatchKQueueEvent(&events_list[0]);

                    this.active -= 1;
                    dispatchKQueueEvent(&events_list[1]);
                    return JSC.Maybe(void).success;
                },
                else => unreachable,
            }
        } else {
            @compileError("TODO: Poller");
        }
    }

    const kqueue_events_ = std.mem.zeroes([4]kevent64);
    pub fn tick(this: *Poller) void {
        if (comptime Environment.isMac) {
            if (this.active == 0) return;

            var events_list = kqueue_events_;
            //             ub extern "c" fn kevent64(
            //     kq: c_int,
            //     changelist: [*]const kevent64_s,
            //     nchanges: c_int,
            //     eventlist: [*]kevent64_s,
            //     nevents: c_int,
            //     flags: c_uint,
            //     timeout: ?*const timespec,
            // ) c_int;
            const rc = std.os.system.kevent64(
                this.watch_fd,
                &events_list,
                0,
                // The same array may be used for the changelist and eventlist.
                &events_list,
                4,
                0,
                &timeout,
            );

            switch (rc) {
                std.math.minInt(@TypeOf(rc))...-1 => {
                    // EINTR is fine
                    switch (std.c.getErrno(rc)) {
                        .INTR => return,
                        else => |errno| std.debug.panic("kevent64() failed: {d}", .{errno}),
                    }
                },
                0 => {},
                1 => {
                    this.active -= 1;
                    dispatchKQueueEvent(&events_list[0]);
                },
                2 => {
                    this.active -= 2;
                    dispatchKQueueEvent(&events_list[0]);
                    dispatchKQueueEvent(&events_list[1]);
                },
                3 => {
                    this.active -= 3;
                    dispatchKQueueEvent(&events_list[0]);
                    dispatchKQueueEvent(&events_list[1]);
                    dispatchKQueueEvent(&events_list[2]);
                },
                4 => {
                    this.active -= 4;
                    dispatchKQueueEvent(&events_list[0]);
                    dispatchKQueueEvent(&events_list[1]);
                    dispatchKQueueEvent(&events_list[2]);
                    dispatchKQueueEvent(&events_list[3]);
                },
                else => unreachable,
            }
        }
    }

    pub const Flag = enum { read, write };
};
