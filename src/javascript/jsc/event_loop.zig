const std = @import("std");
const JSC = @import("javascript_core");
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const Lock = @import("../../lock.zig").Lock;
const Microtask = JSC.Microtask;
const bun = @import("../../global.zig");
const Environment = bun.Environment;
const Fetch = JSC.WebCore.Fetch;
const WebCore = JSC.WebCore;
const Bun = JSC.API.Bun;
const TaggedPointerUnion = @import("../../tagged_pointer.zig").TaggedPointerUnion;
const CopyFilePromiseTask = WebCore.Blob.Store.CopyFile.CopyFilePromiseTask;
const AsyncTransformTask = @import("./api/transpiler.zig").TransformTask.AsyncTransformTask;
const BunTimerTimeoutTask = Bun.Timer.Timeout.TimeoutTask;
const ReadFileTask = WebCore.Blob.Store.ReadFile.ReadFileTask;
const WriteFileTask = WebCore.Blob.Store.WriteFile.WriteFileTask;
const napi_async_work = JSC.napi.napi_async_work;
const FetchTasklet = Fetch.FetchTasklet;
const JSValue = JSC.JSValue;
const js = JSC.C;
const WorkPool = @import("../../work_pool.zig").WorkPool;
const WorkPoolTask = @import("../../work_pool.zig").Task;
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

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = VirtualMachine.vm.event_loop,
                .ctx = value,
                .allocator = allocator,
                .promise = JSValue.createInternalPromise(globalThis),
                .globalThis = globalThis,
            };
            js.JSValueProtect(globalThis.ref(), this.promise.asObjectRef());
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
            var promise = promise_value.asInternalPromise() orelse {
                if (comptime @hasDecl(Context, "deinit")) {
                    @call(.{}, Context.deinit, .{this.ctx});
                }
                return;
            };

            var ctx = this.ctx;

            js.JSValueUnprotect(this.globalThis.ref(), promise_value.asObjectRef());
            ctx.then(promise);
        }

        pub fn schedule(this: *This) void {
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(Task.init(this));
        }

        pub fn deinit(this: *This) void {
            this.allocator.destroy(this);
        }
    };
}

pub fn SerialPromiseTask(comptime Context: type) type {
    return struct {
        const SerialWorkPool = @import("../../work_pool.zig").NewWorkPool(1);
        const This = @This();

        ctx: *Context,
        task: WorkPoolTask = .{ .callback = runFromThreadPool },
        event_loop: *JSC.EventLoop,
        allocator: std.mem.Allocator,
        promise: JSValue,
        globalThis: *JSGlobalObject,

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = VirtualMachine.vm.event_loop,
                .ctx = value,
                .allocator = allocator,
                .promise = JSValue.createInternalPromise(globalThis),
                .globalThis = globalThis,
            };
            js.JSValueProtect(globalThis.ref(), this.promise.asObjectRef());
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
            var promise = promise_value.asInternalPromise() orelse {
                if (comptime @hasDecl(Context, "deinit")) {
                    @call(.{}, Context.deinit, .{this.ctx});
                }
                return;
            };

            var ctx = this.ctx;

            js.JSValueUnprotect(this.globalThis.ref(), promise_value.asObjectRef());
            ctx.then(promise, this.globalThis);
        }

        pub fn schedule(this: *This) void {
            SerialWorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(Task.init(this));
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

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = VirtualMachine.vm.eventLoop(),
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
            };
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
            NetworkThread.global.pool.schedule(NetworkThread.Batch.from(&this.task));
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(Task.init(this));
        }

        pub fn deinit(this: *This) void {
            var allocator = this.allocator;
            this.* = undefined;
            allocator.destroy(this);
        }
    };
}

pub fn AsyncNativeCallbackTask(comptime Context: type) type {
    return struct {
        const This = @This();
        ctx: *Context,
        task: WorkPoolTask = .{ .callback = runFromThreadPool },
        event_loop: *JSC.EventLoop,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = try allocator.create(This);
            this.* = .{
                .event_loop = VirtualMachine.vm.eventLoop(),
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
            };
            return this;
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            var this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx, this);
        }

        pub fn runFromJS(this: This) void {
            this.ctx.runFromJS(this.globalThis);
        }

        pub fn schedule(this: *This) void {
            WorkPool.get().schedule(WorkPool.schedule(&this.task));
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(Task.init(this));
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
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;

// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
pub const Task = TaggedPointerUnion(.{
    FetchTasklet,
    Microtask,
    AsyncTransformTask,
    BunTimerTimeoutTask,
    ReadFileTask,
    CopyFilePromiseTask,
    WriteFileTask,
    AnyTask,
    napi_async_work,
    ThreadSafeFunction,
    // PromiseTask,
    // TimeoutTasklet,
});

pub const EventLoop = struct {
    ready_tasks_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    pending_tasks_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    io_tasks_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    tasks: Queue = undefined,
    concurrent_tasks: Queue = undefined,
    concurrent_lock: Lock = Lock.init(),
    global: *JSGlobalObject = undefined,
    virtual_machine: *VirtualMachine = undefined,
    pub const Queue = std.fifo.LinearFifo(Task, .Dynamic);

    pub fn tickWithCount(this: *EventLoop) u32 {
        var finished: u32 = 0;
        var global = this.global;
        var vm_ = this.virtual_machine;
        while (this.tasks.readItem()) |task| {
            switch (task.tag()) {
                .Microtask => {
                    var micro: *Microtask = task.as(Microtask);
                    micro.run(global);
                    finished += 1;
                },
                .FetchTasklet => {
                    var fetch_task: *Fetch.FetchTasklet = task.get(Fetch.FetchTasklet).?;
                    fetch_task.onDone();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(AsyncTransformTask)) => {
                    var transform_task: *AsyncTransformTask = task.get(AsyncTransformTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(CopyFilePromiseTask)) => {
                    var transform_task: *CopyFilePromiseTask = task.get(CopyFilePromiseTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(JSC.napi.napi_async_work)) => {
                    var transform_task: *JSC.napi.napi_async_work = task.get(JSC.napi.napi_async_work).?;
                    transform_task.*.runFromJS();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(BunTimerTimeoutTask)) => {
                    var transform_task: *BunTimerTimeoutTask = task.get(BunTimerTimeoutTask).?;
                    transform_task.*.runFromJS();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(ReadFileTask)) => {
                    var transform_task: *ReadFileTask = task.get(ReadFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(WriteFileTask)) => {
                    var transform_task: *WriteFileTask = task.get(WriteFileTask).?;
                    transform_task.*.runFromJS();
                    transform_task.deinit();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                @field(Task.Tag, @typeName(AnyTask)) => {
                    var any: *AnyTask = task.get(AnyTask).?;
                    any.run();
                    finished += 1;
                    vm_.active_tasks -|= 1;
                },
                else => unreachable,
            }
        }

        if (finished > 0) {
            _ = this.pending_tasks_count.fetchSub(finished, .Monotonic);
        }

        return finished;
    }

    pub fn tickConcurrent(this: *EventLoop) void {
        if (this.ready_tasks_count.load(.Monotonic) > 0) {
            this.concurrent_lock.lock();
            defer this.concurrent_lock.unlock();
            const add: u32 = @truncate(u32, this.concurrent_tasks.readableLength());

            // TODO: optimzie
            this.tasks.ensureUnusedCapacity(add) catch unreachable;

            {
                this.tasks.writeAssumeCapacity(this.concurrent_tasks.readableSlice(0));
                this.concurrent_tasks.discard(this.concurrent_tasks.count);
            }

            _ = this.pending_tasks_count.fetchAdd(add, .Monotonic);
            _ = this.ready_tasks_count.fetchSub(add, .Monotonic);
        }
    }

    // TODO: fix this technical debt
    pub fn tick(this: *EventLoop) void {
        var poller = &this.virtual_machine.poller;
        while (true) {
            this.tickConcurrent();

            // this.global.vm().doWork();

            while (this.tickWithCount() > 0) {}
            poller.tick();

            this.tickConcurrent();

            if (this.tickWithCount() == 0) break;
        }
    }

    // TODO: fix this technical debt
    pub fn waitForPromise(this: *EventLoop, promise: *JSC.JSInternalPromise) void {
        switch (promise.status(this.global.vm())) {
            JSC.JSPromise.Status.Pending => {
                while (promise.status(this.global.vm()) == .Pending) {
                    this.tick();
                }
            },
            else => {},
        }
    }

    pub fn waitForTasks(this: *EventLoop) void {
        this.tick();
        while (this.pending_tasks_count.load(.Monotonic) > 0) {
            this.tick();
        }
    }

    pub fn enqueueTask(this: *EventLoop, task: Task) void {
        _ = this.pending_tasks_count.fetchAdd(1, .Monotonic);
        this.tasks.writeItem(task) catch unreachable;
    }

    pub fn enqueueTaskConcurrent(this: *EventLoop, task: Task) void {
        this.concurrent_lock.lock();
        defer this.concurrent_lock.unlock();
        this.concurrent_tasks.writeItem(task) catch unreachable;
        if (this.virtual_machine.uws_event_loop) |loop| {
            loop.nextTick(*EventLoop, this, EventLoop.tick);
        }
        _ = this.ready_tasks_count.fetchAdd(1, .Monotonic);
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
            std.debug.assert(this.watch_fd != 0);
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
