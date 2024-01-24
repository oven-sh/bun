const std = @import("std");
const JSC = @import("root").bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const Lock = @import("../lock.zig").Lock;
const bun = @import("root").bun;
const Environment = bun.Environment;
const Fetch = JSC.WebCore.Fetch;
const WebCore = JSC.WebCore;
const Bun = JSC.API.Bun;
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;
const typeBaseName = @import("../meta.zig").typeBaseName;
const AsyncGlobWalkTask = JSC.API.Glob.WalkTask.AsyncGlobWalkTask;
const CopyFilePromiseTask = WebCore.Blob.Store.CopyFile.CopyFilePromiseTask;
const AsyncTransformTask = JSC.API.JSTranspiler.TransformTask.AsyncTransformTask;
const ReadFileTask = WebCore.Blob.ReadFile.ReadFileTask;
const WriteFileTask = WebCore.Blob.WriteFile.WriteFileTask;
const napi_async_work = JSC.napi.napi_async_work;
const FetchTasklet = Fetch.FetchTasklet;
const JSValue = JSC.JSValue;
const js = JSC.C;
const Waker = bun.Async.Waker;

pub const WorkPool = @import("../work_pool.zig").WorkPool;
pub const WorkPoolTask = @import("../work_pool.zig").Task;

const uws = @import("root").bun.uws;
const Async = bun.Async;

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
        ref: Async.KeepAlive = .{},

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var this = bun.new(This, .{
                .event_loop = VirtualMachine.get().event_loop,
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
            });
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
            const promise = this.promise.swap();
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
            bun.destroy(this);
        }
    };
}

pub fn WorkTask(comptime Context: type) type {
    return struct {
        const TaskType = WorkPoolTask;

        const This = @This();
        ctx: *Context,
        task: TaskType = .{ .callback = &runFromThreadPool },
        event_loop: *JSC.EventLoop,
        allocator: std.mem.Allocator,
        globalThis: *JSGlobalObject,
        concurrent_task: ConcurrentTask = .{},
        async_task_tracker: JSC.AsyncTaskTracker,

        // This is a poll because we want it to enter the uSockets loop
        ref: Async.KeepAlive = .{},

        pub fn createOnJSThread(allocator: std.mem.Allocator, globalThis: *JSGlobalObject, value: *Context) !*This {
            var vm = globalThis.bunVM();
            var this = bun.new(This, .{
                .event_loop = vm.eventLoop(),
                .ctx = value,
                .allocator = allocator,
                .globalThis = globalThis,
                .async_task_tracker = JSC.AsyncTaskTracker.init(vm),
            });
            this.ref.ref(this.event_loop.virtual_machine);

            return this;
        }

        pub fn runFromThreadPool(task: *TaskType) void {
            JSC.markBinding(@src());
            const this = @fieldParentPtr(This, "task", task);
            Context.run(this.ctx, this);
        }

        pub fn runFromJS(this: *This) void {
            var ctx = this.ctx;
            const tracker = this.async_task_tracker;
            const vm = this.event_loop.virtual_machine;
            const globalThis = this.globalThis;
            this.ref.unref(vm);

            tracker.willDispatch(globalThis);
            ctx.then(globalThis);
            tracker.didDispatch(globalThis);
        }

        pub fn schedule(this: *This) void {
            const vm = this.event_loop.virtual_machine;
            this.ref.ref(vm);
            this.async_task_tracker.didSchedule(this.globalThis);
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *This) void {
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
        }

        pub fn deinit(this: *This) void {
            this.ref.unref(this.event_loop.virtual_machine);

            bun.destroyWithAlloc(this.allocator, this);
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
        const callback = this.callback;
        const ctx = this.ctx;
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
        const callback = this.callback;
        const ctx = this.ctx;
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
    ctx: ?*anyopaque = undefined,
    callback: *const (fn (*anyopaque, *anyopaque) void) = undefined,
    next: ?*AnyTaskWithExtraContext = null,

    pub fn from(this: *@This(), of: anytype, comptime field: []const u8) *@This() {
        // this.* = .{
        //     .ctx = of,
        //     .callback = @field(std.meta.Child(@TypeOf(of)), field),
        //     .next = null,
        // };
        // return this;
        const TheTask = New(std.meta.Child(@TypeOf(of)), void, @field(std.meta.Child(@TypeOf(of)), field));
        this.* = TheTask.init(of);
        return this;
    }

    pub fn run(this: *AnyTaskWithExtraContext, extra: *anyopaque) void {
        @setRuntimeSafety(false);
        const callback = this.callback;
        const ctx = this.ctx;
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
            jsc_vm.event_loop_handle.?.refConcurrently();
        } else {
            jsc_vm.event_loop_handle.?.unrefConcurrently();
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
const HotReloadTask = JSC.HotReloader.HotReloadTask;
const FSWatchTask = JSC.Node.FSWatcher.FSWatchTask;
const PollPendingModulesTask = JSC.ModuleLoader.AsyncModule.Queue;
// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
const GetAddrInfoRequestTask = JSC.DNS.GetAddrInfoRequest.Task;
const JSCDeferredWorkTask = JSCScheduler.JSCDeferredWorkTask;

const Stat = JSC.Node.Async.stat;
const Lstat = JSC.Node.Async.lstat;
const Fstat = JSC.Node.Async.fstat;
const Open = JSC.Node.Async.open;
const ReadFile = JSC.Node.Async.readFile;
const WriteFile = JSC.Node.Async.writeFile;
const CopyFile = JSC.Node.Async.copyFile;
const Read = JSC.Node.Async.read;
const Write = JSC.Node.Async.write;
const Truncate = JSC.Node.Async.truncate;
const FTruncate = JSC.Node.Async.ftruncate;
const Readdir = JSC.Node.Async.readdir;
const ReaddirRecursive = JSC.Node.Async.readdir_recursive;
const Readv = JSC.Node.Async.readv;
const Writev = JSC.Node.Async.writev;
const Close = JSC.Node.Async.close;
const Rm = JSC.Node.Async.rm;
const Rmdir = JSC.Node.Async.rmdir;
const Chown = JSC.Node.Async.chown;
const FChown = JSC.Node.Async.fchown;
const Utimes = JSC.Node.Async.utimes;
const Lutimes = JSC.Node.Async.lutimes;
const Chmod = JSC.Node.Async.chmod;
const Fchmod = JSC.Node.Async.fchmod;
const Link = JSC.Node.Async.link;
const Symlink = JSC.Node.Async.symlink;
const Readlink = JSC.Node.Async.readlink;
const Realpath = JSC.Node.Async.realpath;
const Mkdir = JSC.Node.Async.mkdir;
const Fsync = JSC.Node.Async.fsync;
const Rename = JSC.Node.Async.rename;
const Fdatasync = JSC.Node.Async.fdatasync;
const Access = JSC.Node.Async.access;
const AppendFile = JSC.Node.Async.appendFile;
const Mkdtemp = JSC.Node.Async.mkdtemp;
const Exists = JSC.Node.Async.exists;
const Futimes = JSC.Node.Async.futimes;
const Lchmod = JSC.Node.Async.lchmod;
const Lchown = JSC.Node.Async.lchown;
const Unlink = JSC.Node.Async.unlink;
const WaitPidResultTask = JSC.Subprocess.WaiterThread.WaitPidResultTask;
const ShellGlobTask = bun.shell.interpret.Interpreter.Expansion.ShellGlobTask;
const ShellRmTask = bun.shell.Interpreter.Builtin.Rm.ShellRmTask;
const ShellRmDirTask = bun.shell.Interpreter.Builtin.Rm.ShellRmTask.DirTask;
const ShellRmDirTaskMini = bun.shell.InterpreterMini.Builtin.Rm.ShellRmTask.DirTask;
const ShellLsTask = bun.shell.Interpreter.Builtin.Ls.ShellLsTask;
const ShellMvCheckTargetTask = bun.shell.Interpreter.Builtin.Mv.ShellMvCheckTargetTask;
const ShellMvBatchedTask = bun.shell.Interpreter.Builtin.Mv.ShellMvBatchedTask;
const ShellSubprocessResultTask = JSC.Subprocess.WaiterThread.ShellSubprocessQueue.ResultTask;
const TimerReference = JSC.BunTimer.Timeout.TimerReference;
// Task.get(ReadFileTask) -> ?ReadFileTask
pub const Task = TaggedPointerUnion(.{
    FetchTasklet,
    AsyncGlobWalkTask,
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
    Stat,
    Lstat,
    Fstat,
    Open,
    ReadFile,
    WriteFile,
    CopyFile,
    Read,
    Write,
    Truncate,
    FTruncate,
    Readdir,
    ReaddirRecursive,
    Close,
    Rm,
    Rmdir,
    Chown,
    FChown,
    Utimes,
    Lutimes,
    Chmod,
    Fchmod,
    Link,
    Symlink,
    Readlink,
    Realpath,
    Mkdir,
    Fsync,
    Fdatasync,
    Writev,
    Readv,
    Rename,
    Access,
    AppendFile,
    Mkdtemp,
    Exists,
    Futimes,
    Lchmod,
    Lchown,
    Unlink,
    // WaitPidResultTask,
    // These need to be referenced like this so they both don't become `WaitPidResultTask`
    JSC.Subprocess.WaiterThread.WaitPidResultTask,
    ShellSubprocessResultTask,
    ShellGlobTask,
    ShellRmTask,
    ShellRmDirTask,
    ShellRmDirTaskMini,
    ShellMvCheckTargetTask,
    ShellMvBatchedTask,
    ShellLsTask,
    TimerReference,
});
const UnboundedQueue = @import("./unbounded_queue.zig").UnboundedQueue;
pub const ConcurrentTask = struct {
    task: if (JSC.is_bindgen) void else Task = undefined,
    next: ?*ConcurrentTask = null,
    auto_delete: bool = false,

    pub const Queue = UnboundedQueue(ConcurrentTask, .next);

    pub const AutoDeinit = enum {
        manual_deinit,
        auto_deinit,
    };
    pub fn create(task: Task) *ConcurrentTask {
        const created = bun.default_allocator.create(ConcurrentTask) catch @panic("out of memory!");
        created.* = .{
            .task = task,
            .next = null,
            .auto_delete = true,
        };
        return created;
    }

    pub fn createFrom(task: anytype) *ConcurrentTask {
        JSC.markBinding(@src());
        return create(Task.init(task));
    }

    pub fn fromCallback(ptr: anytype, comptime callback: anytype) *ConcurrentTask {
        JSC.markBinding(@src());

        return create(ManagedTask.New(std.meta.Child(@TypeOf(ptr)), callback).init(ptr));
    }

    pub fn from(this: *ConcurrentTask, of: anytype, auto_deinit: AutoDeinit) *ConcurrentTask {
        JSC.markBinding(@src());

        this.* = .{
            .task = Task.init(of),
            .next = null,
            .auto_delete = auto_deinit == .auto_deinit,
        };
        return this;
    }
};

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
    disabled: bool = false,

    pub fn init(this: *GarbageCollectionController, vm: *VirtualMachine) void {
        const actual = uws.Loop.get();
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
        this.gc_timer_interval = gc_timer_interval;

        this.disabled = vm.bundler.env.has("BUN_GC_TIMER_DISABLE");

        if (!this.disabled)
            this.gc_repeating_timer.set(this, onGCRepeatingTimer, gc_timer_interval, gc_timer_interval);
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
        if (this.disabled) return;
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
        if (this.disabled) return;
        var vm = this.bunVM().jsc;
        this.processGCTimerWithHeapSize(vm, vm.blockBytesAllocated());
    }

    fn processGCTimerWithHeapSize(this: *GarbageCollectionController, vm: *JSC.VM, this_heap_size: usize) void {
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
        if (this.disabled) return;
        var vm = this.bunVM().jsc;
        vm.collectAsync();
        this.gc_last_heap_size = vm.blockBytesAllocated();
    }

    pub const GCTimerState = enum {
        pending,
        scheduled,
        run_on_next_tick,
    };
};

export fn Bun__tickWhilePaused(paused: *bool) void {
    JSC.markBinding(@src());
    JSC.VirtualMachine.get().eventLoop().tickWhilePaused(paused);
}

comptime {
    if (!JSC.is_bindgen) {
        _ = Bun__tickWhilePaused;
    }
}

pub const DeferredRepeatingTask = *const (fn (*anyopaque) bool);
pub const EventLoop = struct {
    tasks: if (JSC.is_bindgen) void else Queue = undefined,

    /// setImmediate() gets it's own two task queues
    /// When you call `setImmediate` in JS, it queues to the start of the next tick
    /// This is confusing, but that is how it works in Node.js.
    ///
    /// So we have two queues:
    ///   - next_immediate_tasks: tasks that will run on the next tick
    ///   - immediate_tasks: tasks that will run on the current tick
    ///
    /// Having two queues avoids infinite loops creating by calling `setImmediate` in a `setImmediate` callback.
    immediate_tasks: Queue = undefined,
    next_immediate_tasks: Queue = undefined,

    concurrent_tasks: ConcurrentTask.Queue = ConcurrentTask.Queue{},
    global: *JSGlobalObject = undefined,
    virtual_machine: *JSC.VirtualMachine = undefined,
    waker: ?Waker = null,
    start_server_on_next_tick: bool = false,
    defer_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
    forever_timer: ?*uws.Timer = null,
    deferred_microtask_map: std.AutoArrayHashMapUnmanaged(?*anyopaque, DeferredRepeatingTask) = .{},
    uws_loop: if (Environment.isWindows) *uws.Loop else void = undefined,

    timer_reference_pool: ?*bun.JSC.BunTimer.Timeout.TimerReference.Pool = null,

    pub inline fn getVmImpl(this: *EventLoop) *JSC.VirtualMachine {
        return this.virtual_machine;
    }

    pub fn timerReferencePool(this: *EventLoop) *bun.JSC.BunTimer.Timeout.TimerReference.Pool {
        return this.timer_reference_pool orelse brk: {
            const _pool = bun.default_allocator.create(bun.JSC.BunTimer.Timeout.TimerReference.Pool) catch bun.outOfMemory();
            _pool.* = bun.JSC.BunTimer.Timeout.TimerReference.Pool.init(bun.default_allocator);
            this.timer_reference_pool = _pool;
            break :brk _pool;
        };
    }

    pub const Queue = std.fifo.LinearFifo(Task, .Dynamic);
    const log = bun.Output.scoped(.EventLoop, false);

    pub fn tickWhilePaused(this: *EventLoop, done: *bool) void {
        while (!done.*) {
            this.virtual_machine.event_loop_handle.?.tick();
        }
    }

    extern fn JSC__JSGlobalObject__drainMicrotasks(*JSC.JSGlobalObject) void;
    fn drainMicrotasksWithGlobal(this: *EventLoop, globalObject: *JSC.JSGlobalObject) void {
        JSC.markBinding(@src());

        JSC__JSGlobalObject__drainMicrotasks(globalObject);
        this.drainDeferredTasks();
    }

    pub fn drainMicrotasks(this: *EventLoop) void {
        this.drainMicrotasksWithGlobal(this.global);
    }

    pub fn registerDeferredTask(this: *EventLoop, ctx: ?*anyopaque, task: DeferredRepeatingTask) bool {
        const existing = this.deferred_microtask_map.getOrPutValue(this.virtual_machine.allocator, ctx, task) catch unreachable;
        return existing.found_existing;
    }

    pub fn unregisterDeferredTask(this: *EventLoop, ctx: ?*anyopaque) bool {
        return this.deferred_microtask_map.swapRemove(ctx);
    }

    fn drainDeferredTasks(this: *EventLoop) void {
        var i: usize = 0;
        var last = this.deferred_microtask_map.count();
        while (i < last) {
            const key = this.deferred_microtask_map.keys()[i] orelse {
                this.deferred_microtask_map.swapRemoveAt(i);
                last = this.deferred_microtask_map.count();
                continue;
            };

            if (!this.deferred_microtask_map.values()[i](key)) {
                this.deferred_microtask_map.swapRemoveAt(i);
                last = this.deferred_microtask_map.count();
            } else {
                i += 1;
            }
        }
    }

    pub fn tickQueueWithCount(this: *EventLoop, comptime queue_name: []const u8) u32 {
        var global = this.global;
        var global_vm = global.vm();
        var counter: usize = 0;
        while (@field(this, queue_name).readItem()) |task| {
            defer counter += 1;
            switch (task.tag()) {
                @field(Task.Tag, typeBaseName(@typeName(ShellLsTask))) => {
                    var shell_ls_task: *ShellLsTask = task.get(ShellLsTask).?;
                    shell_ls_task.runFromMainThread();
                    // shell_ls_task.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellMvBatchedTask))) => {
                    var shell_mv_batched_task: *ShellMvBatchedTask = task.get(ShellMvBatchedTask).?;
                    shell_mv_batched_task.task.runFromMainThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellMvCheckTargetTask))) => {
                    var shell_mv_check_target_task: *ShellMvCheckTargetTask = task.get(ShellMvCheckTargetTask).?;
                    shell_mv_check_target_task.task.runFromMainThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellRmTask))) => {
                    var shell_rm_task: *ShellRmTask = task.get(ShellRmTask).?;
                    shell_rm_task.runFromMainThread();
                    // shell_rm_task.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellRmDirTask))) => {
                    var shell_rm_task: *ShellRmDirTask = task.get(ShellRmDirTask).?;
                    shell_rm_task.runFromMainThread();
                    // shell_rm_task.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellRmDirTaskMini))) => {
                    var shell_rm_task: *ShellRmDirTaskMini = task.get(ShellRmDirTaskMini).?;
                    shell_rm_task.runFromMainThread();
                    // shell_rm_task.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellGlobTask))) => {
                    var shell_glob_task: *ShellGlobTask = task.get(ShellGlobTask).?;
                    shell_glob_task.runFromMainThread();
                    shell_glob_task.deinit();
                },
                .FetchTasklet => {
                    var fetch_task: *Fetch.FetchTasklet = task.get(Fetch.FetchTasklet).?;
                    fetch_task.onProgressUpdate();
                },
                @field(Task.Tag, @typeName(AsyncGlobWalkTask)) => {
                    var globWalkTask: *AsyncGlobWalkTask = task.get(AsyncGlobWalkTask).?;
                    globWalkTask.*.runFromJS();
                    globWalkTask.deinit();
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
                    const transform_task: *JSC.napi.napi_async_work = task.get(JSC.napi.napi_async_work).?;
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
                    if (Environment.os == .windows) @panic("This should not be reachable on Windows");

                    var any: *GetAddrInfoRequestTask = task.get(GetAddrInfoRequestTask).?;
                    any.runFromJS();
                    any.deinit();
                },
                @field(Task.Tag, typeBaseName(@typeName(Stat))) => {
                    var any: *Stat = task.get(Stat).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Lstat))) => {
                    var any: *Lstat = task.get(Lstat).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Fstat))) => {
                    var any: *Fstat = task.get(Fstat).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Open))) => {
                    var any: *Open = task.get(Open).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(ReadFile))) => {
                    var any: *ReadFile = task.get(ReadFile).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(WriteFile))) => {
                    var any: *WriteFile = task.get(WriteFile).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(CopyFile))) => {
                    var any: *CopyFile = task.get(CopyFile).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Read))) => {
                    var any: *Read = task.get(Read).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Write))) => {
                    var any: *Write = task.get(Write).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Truncate))) => {
                    var any: *Truncate = task.get(Truncate).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Writev))) => {
                    var any: *Writev = task.get(Writev).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Readv))) => {
                    var any: *Readv = task.get(Readv).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Rename))) => {
                    var any: *Rename = task.get(Rename).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(FTruncate))) => {
                    var any: *FTruncate = task.get(FTruncate).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Readdir))) => {
                    var any: *Readdir = task.get(Readdir).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(ReaddirRecursive))) => {
                    var any: *ReaddirRecursive = task.get(ReaddirRecursive).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Close))) => {
                    var any: *Close = task.get(Close).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Rm))) => {
                    var any: *Rm = task.get(Rm).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Rmdir))) => {
                    var any: *Rmdir = task.get(Rmdir).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Chown))) => {
                    var any: *Chown = task.get(Chown).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(FChown))) => {
                    var any: *FChown = task.get(FChown).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Utimes))) => {
                    var any: *Utimes = task.get(Utimes).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Lutimes))) => {
                    var any: *Lutimes = task.get(Lutimes).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Chmod))) => {
                    var any: *Chmod = task.get(Chmod).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Fchmod))) => {
                    var any: *Fchmod = task.get(Fchmod).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Link))) => {
                    var any: *Link = task.get(Link).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Symlink))) => {
                    var any: *Symlink = task.get(Symlink).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Readlink))) => {
                    var any: *Readlink = task.get(Readlink).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Realpath))) => {
                    var any: *Realpath = task.get(Realpath).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Mkdir))) => {
                    var any: *Mkdir = task.get(Mkdir).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Fsync))) => {
                    var any: *Fsync = task.get(Fsync).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Fdatasync))) => {
                    var any: *Fdatasync = task.get(Fdatasync).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Access))) => {
                    var any: *Access = task.get(Access).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(AppendFile))) => {
                    var any: *AppendFile = task.get(AppendFile).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Mkdtemp))) => {
                    var any: *Mkdtemp = task.get(Mkdtemp).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Exists))) => {
                    var any: *Exists = task.get(Exists).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Futimes))) => {
                    var any: *Futimes = task.get(Futimes).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Lchmod))) => {
                    var any: *Lchmod = task.get(Lchmod).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Lchown))) => {
                    var any: *Lchown = task.get(Lchown).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(Unlink))) => {
                    var any: *Unlink = task.get(Unlink).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(WaitPidResultTask))) => {
                    var any: *WaitPidResultTask = task.get(WaitPidResultTask).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(ShellSubprocessResultTask))) => {
                    var any: *ShellSubprocessResultTask = task.get(ShellSubprocessResultTask).?;
                    any.runFromJSThread();
                },
                @field(Task.Tag, typeBaseName(@typeName(TimerReference))) => {
                    if (Environment.isWindows) {
                        @panic("This should not be reachable on Windows");
                    }
                    var any: *TimerReference = task.get(TimerReference).?;
                    any.runFromJSThread();
                },

                else => if (Environment.allow_assert) {
                    bun.Output.prettyln("\nUnexpected tag: {s}\n", .{@tagName(task.tag())});
                } else {
                    log("\nUnexpected tag: {s}\n", .{@tagName(task.tag())});
                    unreachable;
                },
            }

            global_vm.releaseWeakRefs();
            this.drainMicrotasksWithGlobal(global);
        }

        @field(this, queue_name).head = if (@field(this, queue_name).count == 0) 0 else @field(this, queue_name).head;
        return @as(u32, @truncate(counter));
    }

    pub fn tickWithCount(this: *EventLoop) u32 {
        return this.tickQueueWithCount("tasks");
    }

    pub fn tickImmediateTasks(this: *EventLoop) void {
        _ = this.tickQueueWithCount("immediate_tasks");
    }

    pub fn tickConcurrent(this: *EventLoop) void {
        _ = this.tickConcurrentWithCount();
    }

    pub fn tickConcurrentWithCount(this: *EventLoop) usize {
        JSC.markBinding(@src());
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

        // Defer destruction of the ConcurrentTask to avoid issues with pointer aliasing
        var to_destroy: ?*ConcurrentTask = null;

        while (iter.next()) |task| {
            if (to_destroy) |dest| {
                bun.default_allocator.destroy(dest);
                to_destroy = null;
            }

            if (task.auto_delete) {
                to_destroy = task;
            }

            writable[0] = task.task;
            writable = writable[1..];
            this.tasks.count += 1;
            if (writable.len == 0) break;
        }

        if (to_destroy) |dest| {
            bun.default_allocator.destroy(dest);
        }

        return this.tasks.count - start_count;
    }

    inline fn usocketsLoop(this: *const EventLoop) *uws.Loop {
        if (comptime Environment.isWindows) {
            return this.uws_loop;
        }

        return this.virtual_machine.event_loop_handle.?;
    }

    pub fn autoTick(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        var loop = this.usocketsLoop();

        this.flushImmediateQueue();
        this.tickImmediateTasks();

        if (comptime Environment.isPosix) {
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
        }

        if (loop.isActive()) {
            this.processGCTimer();
            loop.tick();
        } else {
            loop.tickWithoutIdle();
        }

        this.flushImmediateQueue();
        ctx.onAfterEventLoop();
    }

    pub fn autoTickWithTimeout(this: *EventLoop, timeoutMs: i64) void {
        var ctx = this.virtual_machine;
        var loop = this.usocketsLoop();

        this.flushImmediateQueue();
        this.tickImmediateTasks();

        if (comptime Environment.isPosix) {
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
        }

        if (loop.isActive()) {
            this.processGCTimer();
            loop.tickWithTimeout(timeoutMs);
        } else {
            loop.tickWithoutIdle();
        }

        this.flushImmediateQueue();
        ctx.onAfterEventLoop();
    }

    pub fn flushImmediateQueue(this: *EventLoop) void {
        // If we can get away with swapping the queues, do that rather than copying the data
        if (this.immediate_tasks.count > 0) {
            this.immediate_tasks.write(this.next_immediate_tasks.readableSlice(0)) catch unreachable;
            this.next_immediate_tasks.head = 0;
            this.next_immediate_tasks.count = 0;
        } else if (this.next_immediate_tasks.count > 0) {
            const prev_immediate = this.immediate_tasks;
            const next_immediate = this.next_immediate_tasks;
            this.immediate_tasks = next_immediate;
            this.next_immediate_tasks = prev_immediate;
        }
    }

    pub fn tickPossiblyForever(this: *EventLoop) void {
        var ctx = this.virtual_machine;
        var loop = this.usocketsLoop();

        if (comptime Environment.isPosix) {
            const pending_unref = ctx.pending_unref_counter;
            if (pending_unref > 0) {
                ctx.pending_unref_counter = 0;
                loop.unrefCount(pending_unref);
            }
        }

        if (!loop.isActive()) {
            if (comptime Environment.isWindows) {
                bun.todo(@src(), {});
            } else {
                if (this.forever_timer == null) {
                    var t = uws.Timer.create(loop, this);
                    t.set(this, &noopForeverTimer, 1000 * 60 * 4, 1000 * 60 * 4);
                    this.forever_timer = t;
                }
            }
        }

        this.processGCTimer();
        loop.tick();

        ctx.onAfterEventLoop();
        this.tickConcurrent();
        this.tick();
    }

    fn noopForeverTimer(_: *uws.Timer) callconv(.C) void {
        // do nothing
    }

    pub fn autoTickActive(this: *EventLoop) void {
        var loop = this.usocketsLoop();

        this.flushImmediateQueue();
        this.tickImmediateTasks();

        var ctx = this.virtual_machine;
        if (comptime Environment.isPosix) {
            const pending_unref = ctx.pending_unref_counter;
            if (pending_unref > 0) {
                ctx.pending_unref_counter = 0;
                loop.unrefCount(pending_unref);
            }
        }

        if (loop.isActive()) {
            this.processGCTimer();
            loop.tick();
        } else {
            loop.tickWithoutIdle();
        }

        this.flushImmediateQueue();
        ctx.onAfterEventLoop();
    }

    pub fn processGCTimer(this: *EventLoop) void {
        this.virtual_machine.gc_controller.processGCTimer();
    }

    pub fn tick(this: *EventLoop) void {
        JSC.markBinding(@src());

        const ctx = this.virtual_machine;
        this.tickConcurrent();
        this.processGCTimer();

        const global = ctx.global;
        const global_vm = ctx.jsc;

        while (true) {
            while (this.tickWithCount() > 0) : (this.global.handleRejectedPromises()) {
                this.tickConcurrent();
            } else {
                global_vm.releaseWeakRefs();
                this.drainMicrotasksWithGlobal(global);
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

    pub fn waitForPromise(this: *EventLoop, promise: JSC.AnyPromise) void {
        switch (promise.status(this.virtual_machine.jsc)) {
            JSC.JSPromise.Status.Pending => {
                while (promise.status(this.virtual_machine.jsc) == .Pending) {
                    this.tick();

                    if (promise.status(this.virtual_machine.jsc) == .Pending) {
                        this.autoTick();
                    }
                }
            },
            else => {},
        }
    }

    pub fn waitForPromiseWithTermination(this: *EventLoop, promise: JSC.AnyPromise) void {
        const worker = this.virtual_machine.worker orelse @panic("EventLoop.waitForPromiseWithTermination: worker is not initialized");
        switch (promise.status(this.virtual_machine.jsc)) {
            JSC.JSPromise.Status.Pending => {
                while (!worker.requested_terminate and promise.status(this.virtual_machine.jsc) == .Pending) {
                    this.tick();

                    if (!worker.requested_terminate and promise.status(this.virtual_machine.jsc) == .Pending) {
                        this.autoTick();
                    }
                }
            },
            else => {},
        }
    }

    // TODO: this implementation is terrible
    // we should not be checking the millitimestamp every time
    pub fn waitForPromiseWithTimeout(this: *EventLoop, promise: JSC.AnyPromise, timeout: u32) bool {
        return switch (promise.status(this.virtual_machine.jsc)) {
            JSC.JSPromise.Status.Pending => {
                if (timeout == 0) {
                    return false;
                }
                const start_time = std.time.milliTimestamp();
                while (promise.status(this.virtual_machine.jsc) == .Pending) {
                    this.tick();

                    if (promise.status(this.virtual_machine.jsc) == .Pending) {
                        const remaining = std.time.milliTimestamp() - start_time;
                        if (remaining >= timeout) {
                            return false;
                        }

                        this.autoTickWithTimeout(remaining);
                    }
                }
                return true;
            },
            else => true,
        };
    }

    pub fn enqueueTask(this: *EventLoop, task: Task) void {
        JSC.markBinding(@src());
        this.tasks.writeItem(task) catch unreachable;
    }

    pub fn enqueueImmediateTask(this: *EventLoop, task: Task) void {
        JSC.markBinding(@src());
        this.next_immediate_tasks.writeItem(task) catch unreachable;
    }

    pub fn enqueueTaskWithTimeout(this: *EventLoop, task: Task, timeout: i32) void {
        // TODO: make this more efficient!
        const loop = this.virtual_machine.uwsLoop();
        var timer = uws.Timer.createFallthrough(loop, task.ptr());
        timer.set(task.ptr(), callTask, timeout, 0);
    }

    pub fn callTask(timer: *uws.Timer) callconv(.C) void {
        const task = Task.from(timer.as(*anyopaque));
        defer timer.deinit(true);

        JSC.VirtualMachine.get().enqueueTask(task);
    }

    pub fn ensureWaker(this: *EventLoop) void {
        JSC.markBinding(@src());
        if (this.virtual_machine.event_loop_handle == null) {
            if (comptime Environment.isWindows) {
                this.uws_loop = bun.uws.Loop.init();
                this.virtual_machine.event_loop_handle = Async.Loop.get();

                _ = bun.windows.libuv.uv_replace_allocator(
                    @ptrCast(&bun.Mimalloc.mi_malloc),
                    @ptrCast(&bun.Mimalloc.mi_realloc),
                    @ptrCast(&bun.Mimalloc.mi_calloc),
                    @ptrCast(&bun.Mimalloc.mi_free),
                );
            } else {
                this.virtual_machine.event_loop_handle = bun.Async.Loop.get();
            }

            this.virtual_machine.gc_controller.init(this.virtual_machine);
            // _ = actual.addPostHandler(*JSC.EventLoop, this, JSC.EventLoop.afterUSocketsTick);
            // _ = actual.addPreHandler(*JSC.VM, this.virtual_machine.jsc, JSC.VM.drainMicrotasks);
        }
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn performGC(this: *EventLoop) void {
        this.virtual_machine.gc_controller.performGC();
    }

    pub fn wakeup(this: *EventLoop) void {
        if (comptime Environment.isWindows) {
            this.uws_loop.wakeup();
            return;
        }

        if (this.virtual_machine.event_loop_handle) |loop| {
            loop.wakeup();
        }
    }
    pub fn enqueueTaskConcurrent(this: *EventLoop, task: *ConcurrentTask) void {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            if (this.virtual_machine.has_terminated) {
                @panic("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }

        this.concurrent_tasks.push(task);
        this.wakeup();
    }

    pub fn enqueueTaskConcurrentBatch(this: *EventLoop, batch: ConcurrentTask.Queue.Batch) void {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            if (this.virtual_machine.has_terminated) {
                @panic("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }

        this.concurrent_tasks.pushBatch(batch.front.?, batch.last.?, batch.count);
        this.wakeup();
    }
};

pub const JsVM = struct {
    vm: *JSC.VirtualMachine,

    pub inline fn init(inner: *JSC.VirtualMachine) JsVM {
        return .{
            .vm = inner,
        };
    }

    pub inline fn loop(this: @This()) *JSC.EventLoop {
        return this.vm.event_loop;
    }

    pub inline fn allocFilePoll(this: @This()) *bun.Async.FilePoll {
        return this.vm.rareData().filePolls(this.vm).get();
    }

    pub inline fn platformEventLoop(this: @This()) *JSC.PlatformEventLoop {
        return this.vm.event_loop_handle.?;
    }

    pub inline fn incrementPendingUnrefCounter(this: @This()) void {
        this.vm.pending_unref_counter +|= 1;
    }

    pub inline fn filePolls(this: @This()) *Async.FilePoll.Store {
        return this.vm.rareData().filePolls(this.vm);
    }
};

pub const MiniVM = struct {
    mini: *JSC.MiniEventLoop,

    pub fn init(inner: *JSC.MiniEventLoop) MiniVM {
        return .{
            .mini = inner,
        };
    }

    pub inline fn loop(this: @This()) *JSC.MiniEventLoop {
        return this.mini;
    }

    pub inline fn allocFilePoll(this: @This()) *bun.Async.FilePoll {
        return this.mini.filePolls().get();
    }

    pub inline fn platformEventLoop(this: @This()) *JSC.PlatformEventLoop {
        if (comptime Environment.isWindows) {
            return this.mini.loop.uv_loop;
        }
        return this.mini.loop;
    }

    pub inline fn incrementPendingUnrefCounter(this: @This()) void {
        _ = this; // autofix

        @panic("FIXME TODO");
    }

    pub inline fn filePolls(this: @This()) *Async.FilePoll.Store {
        return this.mini.filePolls();
    }
};

pub const EventLoopKind = enum {
    js,
    mini,

    pub fn refType(comptime this: EventLoopKind) type {
        return switch (this) {
            .js => *JSC.VirtualMachine,
            .mini => *JSC.MiniEventLoop,
        };
    }

    pub fn getVm(comptime this: EventLoopKind) EventLoopKind.refType(this) {
        return switch (this) {
            .js => JSC.VirtualMachine.get(),
            .mini => JSC.MiniEventLoop.global,
        };
    }
};

pub fn AbstractVM(inner: anytype) brk: {
    if (@TypeOf(inner) == *JSC.VirtualMachine) {
        break :brk JsVM;
    } else if (@TypeOf(inner) == *JSC.MiniEventLoop) {
        break :brk MiniVM;
    }
    @compileError("Invalid event loop ctx: " ++ @typeName(@TypeOf(inner)));
} {
    if (comptime @TypeOf(inner) == *JSC.VirtualMachine) return JsVM.init(inner);
    if (comptime @TypeOf(inner) == *JSC.MiniEventLoop) return MiniVM.init(inner);
    @compileError("Invalid event loop ctx: " ++ @typeName(@TypeOf(inner)));
}

// pub const EventLoopRefImpl = struct {
//     fn enqueueTask(ref: anytype) {
//         const event_loop_ctx =
//     }
// };

pub const MiniEventLoop = struct {
    tasks: Queue,
    concurrent_tasks: UnboundedQueue(AnyTaskWithExtraContext, .next) = .{},
    loop: *uws.Loop,
    allocator: std.mem.Allocator,
    file_polls_: ?*Async.FilePoll.Store = null,
    env: ?*bun.DotEnv.Loader = null,
    top_level_dir: []const u8 = "",
    after_event_loop_callback_ctx: ?*anyopaque = null,
    after_event_loop_callback: ?JSC.OpaqueCallback = null,

    pub threadlocal var global: *MiniEventLoop = undefined;

    pub fn initGlobal(env: ?*bun.DotEnv.Loader) *MiniEventLoop {
        const loop = MiniEventLoop.init(bun.default_allocator);
        global = bun.default_allocator.create(MiniEventLoop) catch bun.outOfMemory();
        global.* = loop;
        global.env = env orelse bun.DotEnv.instance orelse env_loader: {
            const map = bun.default_allocator.create(bun.DotEnv.Map) catch bun.outOfMemory();
            map.* = bun.DotEnv.Map.init(bun.default_allocator);

            const loader = bun.default_allocator.create(bun.DotEnv.Loader) catch bun.outOfMemory();
            loader.* = bun.DotEnv.Loader.init(map, bun.default_allocator);
            break :env_loader loader;
        };
        return global;
    }

    const Queue = std.fifo.LinearFifo(*AnyTaskWithExtraContext, .Dynamic);

    pub const Task = AnyTaskWithExtraContext;

    pub inline fn getVmImpl(this: *MiniEventLoop) *MiniEventLoop {
        return this;
    }

    pub fn throwError(_: *MiniEventLoop, err: bun.sys.Error) void {
        bun.Output.prettyErrorln("{}", .{err});
        bun.Output.flush();
    }

    pub fn onAfterEventLoop(this: *MiniEventLoop) void {
        if (this.after_event_loop_callback) |cb| {
            const ctx = this.after_event_loop_callback_ctx;
            this.after_event_loop_callback = null;
            this.after_event_loop_callback_ctx = null;
            cb(ctx);
        }
    }

    pub fn filePolls(this: *MiniEventLoop) *Async.FilePoll.Store {
        return this.file_polls_ orelse {
            this.file_polls_ = this.allocator.create(Async.FilePoll.Store) catch bun.outOfMemory();
            this.file_polls_.?.* = Async.FilePoll.Store.init(this.allocator);
            return this.file_polls_.?;
        };
    }

    pub fn init(
        allocator: std.mem.Allocator,
    ) MiniEventLoop {
        return .{
            .tasks = Queue.init(allocator),
            .allocator = allocator,
            .loop = uws.Loop.get(),
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
                defer this.onAfterEventLoop();
                this.loop.inc();
                this.loop.tick();
                this.loop.dec();
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

    pub fn enqueueTaskConcurrent(this: *MiniEventLoop, task: *AnyTaskWithExtraContext) void {
        this.concurrent_tasks.push(task);
        this.loop.wakeup();
    }

    pub fn enqueueTaskConcurrentWithExtraCtx(
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
                // this.virtual_machine.jsc.enqueueTaskConcurrent(concurrent);
            },
            .mini => {
                this.mini.enqueueTaskConcurrentWithExtraCtx(Context, ParentContext, ctx, Callback, field);
            },
        }
    }
};
