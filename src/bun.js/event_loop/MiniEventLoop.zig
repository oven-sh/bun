//! MiniEventLoop: A lightweight event loop for non-JavaScript contexts
//!
//! This is a simplified version of JSC.EventLoop that provides event loop functionality
//! without requiring a JavaScript runtime. It enables code reuse between JavaScript-enabled
//! contexts (like `bun run`) and JavaScript-free contexts (like `bun build`, `bun install`,
//! and the Bun Shell).
//!
//! Key characteristics:
//! - Wraps the uSockets event loop, same as JSC.EventLoop
//! - Supports concurrent task execution via thread pools
//! - Provides file polling capabilities for watching filesystem changes
//! - Manages stdout/stderr streams without JavaScript bindings
//! - Handles environment variable loading and management
//!
//! Use cases:
//! - Build processes that need async I/O without JavaScript execution
//! - Package installation with concurrent network requests
//! - Shell command execution with proper I/O handling
//! - Any Bun subsystem that needs event-driven architecture without JS overhead
//!
const MiniEventLoop = @This();

tasks: Queue,
concurrent_tasks: ConcurrentTaskQueue = .{},
loop: *uws.Loop,
allocator: std.mem.Allocator,
file_polls_: ?*Async.FilePoll.Store = null,
env: ?*bun.DotEnv.Loader = null,
top_level_dir: []const u8 = "",
after_event_loop_callback_ctx: ?*anyopaque = null,
after_event_loop_callback: ?JSC.OpaqueCallback = null,
pipe_read_buffer: ?*PipeReadBuffer = null,
stdout_store: ?*bun.webcore.Blob.Store = null,
stderr_store: ?*bun.webcore.Blob.Store = null,
const PipeReadBuffer = [256 * 1024]u8;

pub threadlocal var globalInitialized: bool = false;
pub threadlocal var global: *MiniEventLoop = undefined;

pub const ConcurrentTaskQueue = UnboundedQueue(AnyTaskWithExtraContext, .next);

pub fn initGlobal(env: ?*bun.DotEnv.Loader) *MiniEventLoop {
    if (globalInitialized) return global;
    const loop = MiniEventLoop.init(bun.default_allocator);
    global = bun.default_allocator.create(MiniEventLoop) catch bun.outOfMemory();
    global.* = loop;
    global.loop.internal_loop_data.setParentEventLoop(bun.JSC.EventLoopHandle.init(global));
    global.env = env orelse bun.DotEnv.instance orelse env_loader: {
        const map = bun.default_allocator.create(bun.DotEnv.Map) catch bun.outOfMemory();
        map.* = bun.DotEnv.Map.init(bun.default_allocator);

        const loader = bun.default_allocator.create(bun.DotEnv.Loader) catch bun.outOfMemory();
        loader.* = bun.DotEnv.Loader.init(map, bun.default_allocator);
        break :env_loader loader;
    };
    globalInitialized = true;
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

pub fn pipeReadBuffer(this: *MiniEventLoop) []u8 {
    return this.pipe_read_buffer orelse {
        this.pipe_read_buffer = this.allocator.create(PipeReadBuffer) catch bun.outOfMemory();
        return this.pipe_read_buffer.?;
    };
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
        this.file_polls_.?.* = Async.FilePoll.Store.init();
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
    bun.assert(this.concurrent_tasks.isEmpty());
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

pub fn tickOnce(
    this: *MiniEventLoop,
    context: *anyopaque,
) void {
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

pub fn tickWithoutIdle(
    this: *MiniEventLoop,
    context: *anyopaque,
) void {
    defer this.onAfterEventLoop();

    while (true) {
        _ = this.tickConcurrentWithCount();
        while (this.tasks.readItem()) |task| {
            task.run(context);
        }

        this.loop.tickWithoutIdle();

        if (this.tasks.count == 0 and this.tickConcurrentWithCount() == 0) break;
    }
}

pub fn tick(
    this: *MiniEventLoop,
    context: *anyopaque,
    comptime isDone: *const fn (*anyopaque) bool,
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

pub fn stderr(this: *MiniEventLoop) *JSC.WebCore.Blob.Store {
    return this.stderr_store orelse brk: {
        var mode: bun.Mode = 0;
        const fd = bun.FD.fromUV(2);

        switch (bun.sys.fstat(fd)) {
            .result => |stat| {
                mode = @intCast(stat.mode);
            },
            .err => {},
        }

        const store = JSC.WebCore.Blob.Store.new(.{
            .ref_count = std.atomic.Value(u32).init(2),
            .allocator = bun.default_allocator,
            .data = .{
                .file = .{
                    .pathlike = .{
                        .fd = fd,
                    },
                    .is_atty = bun.Output.stderr_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        });

        this.stderr_store = store;
        break :brk store;
    };
}

pub fn stdout(this: *MiniEventLoop) *JSC.WebCore.Blob.Store {
    return this.stdout_store orelse brk: {
        var mode: bun.Mode = 0;
        const fd = bun.FD.stdout();

        switch (bun.sys.fstat(fd)) {
            .result => |stat| {
                mode = @intCast(stat.mode);
            },
            .err => {},
        }

        const store = JSC.WebCore.Blob.Store.new(.{
            .ref_count = std.atomic.Value(u32).init(2),
            .allocator = bun.default_allocator,
            .data = .{
                .file = .{
                    .pathlike = .{
                        .fd = fd,
                    },
                    .is_atty = bun.Output.stdout_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        });

        this.stdout_store = store;
        break :brk store;
    };
}

pub const JsVM = struct {
    vm: *VirtualMachine,

    pub inline fn init(inner: *VirtualMachine) JsVM {
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
        _ = this;
        @panic("FIXME TODO");
    }

    pub inline fn filePolls(this: @This()) *Async.FilePoll.Store {
        return this.mini.filePolls();
    }
};

pub const EventLoopKind = enum {
    js,
    mini,

    pub fn Type(comptime this: EventLoopKind) type {
        return switch (this) {
            .js => EventLoop,
            .mini => MiniEventLoop,
        };
    }

    pub fn refType(comptime this: EventLoopKind) type {
        return switch (this) {
            .js => *VirtualMachine,
            .mini => *JSC.MiniEventLoop,
        };
    }

    pub fn getVm(comptime this: EventLoopKind) EventLoopKind.refType(this) {
        return switch (this) {
            .js => VirtualMachine.get(),
            .mini => JSC.MiniEventLoop.global,
        };
    }
};

pub fn AbstractVM(inner: anytype) switch (@TypeOf(inner)) {
    *VirtualMachine => JsVM,
    *JSC.MiniEventLoop => MiniVM,
    else => @compileError("Invalid event loop ctx: " ++ @typeName(@TypeOf(inner))),
} {
    if (comptime @TypeOf(inner) == *VirtualMachine) return JsVM.init(inner);
    if (comptime @TypeOf(inner) == *JSC.MiniEventLoop) return MiniVM.init(inner);
    @compileError("Invalid event loop ctx: " ++ @typeName(@TypeOf(inner)));
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Async = bun.Async;
const VirtualMachine = JSC.VirtualMachine;
const UnboundedQueue = @import("../unbounded_queue.zig").UnboundedQueue;
const AnyTaskWithExtraContext = JSC.AnyTaskWithExtraContext;
const uws = bun.uws;
const EventLoop = JSC.EventLoop;
const Environment = bun.Environment;
