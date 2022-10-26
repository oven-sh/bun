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
        JSC.markBinding(@src());
        Bun__performTask(global, this);
    }
};
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const MicrotaskForDefaultGlobalObject = JSC.MicrotaskForDefaultGlobalObject;
const HotReloadTask = JSC.HotReloader.HotReloadTask;
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
    virtual_machine: *VirtualMachine = undefined,
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

        if (ctx.poller.loop != null and ctx.poller.loop.?.active > 0 or (ctx.us_loop_reference_count > 0 and !ctx.is_us_loop_entered and (ctx.uws_event_loop.?.num_polls > 0 or this.start_server_on_next_tick))) {
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

pub const Poller = struct {
    /// kqueue() or epoll()
    /// 0 == unset
    loop: ?*uws.Loop = null,

    pub fn dispatchKQueueEvent(loop: *uws.Loop, kqueue_event: *const std.os.system.kevent64_s) void {
        if (comptime !Environment.isMac) {
            unreachable;
        }
        var ptr = Pollable.from(@intToPtr(?*anyopaque, kqueue_event.udata));

        switch (ptr.tag()) {
            @field(Pollable.Tag, "FileBlobLoader") => {
                var loader = ptr.as(FileBlobLoader);
                loader.poll_ref.deactivate(loop);

                loader.onPoll(@bitCast(i64, kqueue_event.data), kqueue_event.flags);
            },
            @field(Pollable.Tag, "Subprocess") => {
                var loader = ptr.as(JSC.Subprocess);

                loader.poll_ref.deactivate(loop);
                loader.onExitNotification();
            },
            @field(Pollable.Tag, "BufferedInput") => {
                var loader = ptr.as(JSC.Subprocess.BufferedInput);

                loader.poll_ref.deactivate(loop);

                loader.onReady(@bitCast(i64, kqueue_event.data));
            },
            @field(Pollable.Tag, "BufferedOutput") => {
                var loader = ptr.as(JSC.Subprocess.BufferedOutput);

                loader.poll_ref.deactivate(loop);

                loader.ready(@bitCast(i64, kqueue_event.data));
            },
            @field(Pollable.Tag, "FileSink") => {
                var loader = ptr.as(JSC.WebCore.FileSink);
                loader.poll_ref.deactivate(loop);

                loader.onPoll(0, 0);
            },
            else => |tag| {
                bun.Output.panic(
                    "Internal error\nUnknown pollable tag: {d}\n",
                    .{@enumToInt(tag)},
                );
            },
        }
    }

    fn dispatchEpollEvent(loop: *uws.Loop, epoll_event: *linux.epoll_event) void {
        var ptr = Pollable.from(@intToPtr(?*anyopaque, epoll_event.data.ptr));
        switch (ptr.tag()) {
            @field(Pollable.Tag, "FileBlobLoader") => {
                var loader = ptr.as(FileBlobLoader);
                loader.poll_ref.deactivate(loop);

                loader.onPoll(0, 0);
            },
            @field(Pollable.Tag, "Subprocess") => {
                var loader = ptr.as(JSC.Subprocess);
                loader.poll_ref.deactivate(loop);

                loader.onExitNotification();
            },
            @field(Pollable.Tag, "FileSink") => {
                var loader = ptr.as(JSC.WebCore.FileSink);
                loader.poll_ref.deactivate(loop);

                loader.onPoll(0, 0);
            },

            @field(Pollable.Tag, "BufferedInput") => {
                var loader = ptr.as(JSC.Subprocess.BufferedInput);

                loader.poll_ref.deactivate(loop);

                loader.onReady(0);
            },
            @field(Pollable.Tag, "BufferedOutput") => {
                var loader = ptr.as(JSC.Subprocess.BufferedOutput);

                loader.poll_ref.deactivate(loop);

                loader.ready(0);
            },
            else => unreachable,
        }
    }

    const timeout = std.mem.zeroes(std.os.timespec);
    const linux = std.os.linux;

    const FileBlobLoader = JSC.WebCore.FileBlobLoader;
    const FileSink = JSC.WebCore.FileSink;
    const Subprocess = JSC.Subprocess;
    const BufferedInput = Subprocess.BufferedInput;
    const BufferedOutput = Subprocess.BufferedOutput;
    /// epoll only allows one pointer
    /// We unfortunately need two pointers: one for a function call and one for the context
    /// We use a tagged pointer union and then call the function with the context pointer
    pub const Pollable = TaggedPointerUnion(.{
        FileBlobLoader,
        FileSink,
        Subprocess,
        BufferedInput,
        BufferedOutput,
    });
    const Kevent = std.os.Kevent;
    const kevent = std.c.kevent;

    pub fn watch(this: *Poller, fd: JSC.Node.FileDescriptor, flag: Flag, comptime ContextType: type, ctx: *ContextType) JSC.Maybe(void) {
        if (this.loop == null) {
            this.loop = uws.Loop.get();
            JSC.VirtualMachine.vm.uws_event_loop = this.loop.?;
        }
        const watcher_fd = this.loop.?.fd;

        if (comptime Environment.isLinux) {
            const flags: u32 = switch (flag) {
                .process, .read => linux.EPOLL.IN | linux.EPOLL.HUP | linux.EPOLL.ONESHOT,
                .write => linux.EPOLL.OUT | linux.EPOLL.HUP | linux.EPOLL.ERR | linux.EPOLL.ONESHOT,
            };

            var event = linux.epoll_event{ .events = flags, .data = .{ .u64 = @ptrToInt(Pollable.init(ctx).ptr()) } };

            const ctl = linux.epoll_ctl(
                watcher_fd,
                linux.EPOLL.CTL_ADD,
                fd,
                &event,
            );

            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }

            ctx.poll_ref.activate(this.loop.?);

            return JSC.Maybe(void).success;
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);
            changelist[0] = switch (flag) {
                .read => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @ptrToInt(Pollable.init(ctx).ptr()),
                    .flags = std.c.EV_ADD | std.c.EV_ONESHOT,
                    .ext = .{ 0, 0 },
                },
                .write => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @ptrToInt(Pollable.init(ctx).ptr()),
                    .flags = std.c.EV_ADD | std.c.EV_ONESHOT,
                    .ext = .{ 0, 0 },
                },
                .process => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_PROC,
                    .data = 0,
                    .fflags = std.c.NOTE_EXIT,
                    .udata = @ptrToInt(Pollable.init(ctx).ptr()),
                    .flags = std.c.EV_ADD,
                    .ext = .{ 0, 0 },
                },
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = rc: {
                while (true) {
                    const rc = std.os.system.kevent64(
                        watcher_fd,
                        &changelist,
                        1,
                        // The same array may be used for the changelist and eventlist.
                        &changelist,
                        1,
                        KEVENT_FLAG_ERROR_EVENTS,
                        &timeout,
                    );

                    if (std.c.getErrno(rc) == .INTR) continue;
                    break :rc rc;
                }
            };

            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (changelist[0].flags == std.c.EV_ERROR) {
                return JSC.Maybe(void).errnoSys(changelist[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            const errno = std.c.getErrno(rc);

            if (errno == .SUCCESS) {
                ctx.poll_ref.activate(this.loop.?);

                return JSC.Maybe(void).success;
            }

            switch (rc) {
                std.math.minInt(@TypeOf(rc))...-1 => return JSC.Maybe(void).errnoSys(@enumToInt(errno), .kevent).?,
                else => unreachable,
            }
        } else {
            @compileError("TODO: Poller");
        }
    }

    pub fn unwatch(this: *Poller, fd: JSC.Node.FileDescriptor, flag: Flag, comptime ContextType: type, ctx: *ContextType) JSC.Maybe(void) {
        if (this.loop == null) {
            this.loop = uws.Loop.get();
            JSC.VirtualMachine.vm.uws_event_loop = this.loop.?;
        }
        const watcher_fd = this.loop.?.fd;

        if (comptime Environment.isLinux) {
            const ctl = linux.epoll_ctl(
                watcher_fd,
                linux.EPOLL.CTL_DEL,
                fd,
                null,
            );

            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }

            ctx.poll_ref.deactivate(this.loop.?);

            return JSC.Maybe(void).success;
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);
            changelist[0] = switch (flag) {
                .read => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @ptrToInt(Pollable.init(ctx).ptr()),
                    .flags = std.c.EV_DELETE | std.c.EV_ONESHOT,
                    .ext = .{ 0, 0 },
                },
                .write => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @ptrToInt(Pollable.init(ctx).ptr()),
                    .flags = std.c.EV_DELETE | std.c.EV_ONESHOT,
                    .ext = .{ 0, 0 },
                },
                .process => .{
                    .ident = @intCast(u64, fd),
                    .filter = std.os.system.EVFILT_PROC,
                    .data = 0,
                    .fflags = std.c.NOTE_EXIT,
                    .udata = @ptrToInt(Pollable.init(ctx).ptr()),
                    .flags = std.c.EV_DELETE | std.c.EV_ONESHOT,
                    .ext = .{ 0, 0 },
                },
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = std.os.system.kevent64(
                watcher_fd,
                &changelist,
                1,
                // The same array may be used for the changelist and eventlist.
                &changelist,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                &timeout,
            );
            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (changelist[0].flags == std.c.EV_ERROR) {
                return JSC.Maybe(void).errnoSys(changelist[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            const errno = std.c.getErrno(rc);

            if (errno == .SUCCESS) {
                ctx.poll_ref.deactivate(this.loop.?);
                return JSC.Maybe(void).success;
            }

            switch (rc) {
                std.math.minInt(@TypeOf(rc))...-1 => return JSC.Maybe(void).errnoSys(@enumToInt(errno), .kevent).?,
                else => unreachable,
            }
        } else {
            @compileError("TODO: Poller");
        }
    }

    pub fn tick(this: *Poller) void {
        var loop = this.loop orelse return;
        if (loop.active == 0) return;
        loop.tick();
    }

    pub fn onTick(loop: *uws.Loop, tagged_pointer: ?*anyopaque) callconv(.C) void {
        _ = loop;
        _ = tagged_pointer;
        if (comptime Environment.isMac)
            dispatchKQueueEvent(loop, &loop.ready_polls[@intCast(usize, loop.current_ready_poll)])
        else if (comptime Environment.isLinux)
            dispatchEpollEvent(loop, &loop.ready_polls[@intCast(usize, loop.current_ready_poll)]);
    }

    pub const Flag = enum {
        read,
        write,
        process,
    };

    comptime {
        @export(onTick, .{ .name = "Bun__internal_dispatch_ready_poll" });
    }
};
