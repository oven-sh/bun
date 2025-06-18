pub const ThreadPool = struct {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    io_pool: *ThreadPoolLib = undefined,
    worker_pool: *ThreadPoolLib = undefined,
    workers_assignments: std.AutoArrayHashMap(std.Thread.Id, *Worker) = std.AutoArrayHashMap(std.Thread.Id, *Worker).init(bun.default_allocator),
    workers_assignments_lock: bun.Mutex = .{},
    v2: *BundleV2 = undefined,

    const debug = Output.scoped(.ThreadPool, false);

    pub fn reset(this: *ThreadPool) void {
        if (this.usesIOPool()) {
            if (this.io_pool.threadpool_context == @as(?*anyopaque, @ptrCast(this))) {
                this.io_pool.threadpool_context = null;
            }
        }

        if (this.worker_pool.threadpool_context == @as(?*anyopaque, @ptrCast(this))) {
            this.worker_pool.threadpool_context = null;
        }
    }

    pub fn go(this: *ThreadPool, allocator: std.mem.Allocator, comptime Function: anytype) !ThreadPoolLib.ConcurrentFunction(Function) {
        return this.worker_pool.go(allocator, Function);
    }

    pub fn start(this: *ThreadPool, v2: *BundleV2, existing_thread_pool: ?*ThreadPoolLib) !void {
        this.v2 = v2;

        if (existing_thread_pool) |pool| {
            this.worker_pool = pool;
        } else {
            const cpu_count = bun.getThreadCount();
            this.worker_pool = try v2.graph.allocator.create(ThreadPoolLib);
            this.worker_pool.* = ThreadPoolLib.init(.{
                .max_threads = cpu_count,
            });
            debug("{d} workers", .{cpu_count});
        }

        this.worker_pool.setThreadContext(this);

        this.worker_pool.warm(8);

        const IOThreadPool = struct {
            var thread_pool: ThreadPoolLib = undefined;
            var once = bun.once(startIOThreadPool);

            fn startIOThreadPool() void {
                thread_pool = ThreadPoolLib.init(.{
                    .max_threads = @max(@min(bun.getThreadCount(), 4), 2),

                    // Use a much smaller stack size for the IO thread pool
                    .stack_size = 512 * 1024,
                });
            }

            pub fn get() *ThreadPoolLib {
                once.call(.{});
                return &thread_pool;
            }
        };

        if (this.usesIOPool()) {
            this.io_pool = IOThreadPool.get();
            this.io_pool.setThreadContext(this);
            this.io_pool.warm(1);
        }
    }

    pub fn usesIOPool(_: *const ThreadPool) bool {
        if (bun.getRuntimeFeatureFlag(.BUN_FEATURE_FLAG_FORCE_IO_POOL)) {
            // For testing.
            return true;
        }

        if (bun.getRuntimeFeatureFlag(.BUN_FEATURE_FLAG_DISABLE_IO_POOL)) {
            // For testing.
            return false;
        }

        if (Environment.isMac or Environment.isWindows) {
            // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
            return bun.getThreadCount() > 3;
        }

        return false;
    }

    pub fn scheduleWithOptions(this: *ThreadPool, parse_task: *ParseTask, is_inside_thread_pool: bool) void {
        if (parse_task.contents_or_fd == .contents and parse_task.stage == .needs_source_code) {
            parse_task.stage = .{
                .needs_parse = .{
                    .contents = parse_task.contents_or_fd.contents,
                    .fd = bun.invalid_fd,
                },
            };
        }

        const scheduleFn = if (is_inside_thread_pool) &ThreadPoolLib.scheduleInsideThreadPool else &ThreadPoolLib.schedule;

        if (this.usesIOPool()) {
            switch (parse_task.stage) {
                .needs_parse => {
                    scheduleFn(this.worker_pool, .from(&parse_task.task));
                },
                .needs_source_code => {
                    scheduleFn(this.io_pool, .from(&parse_task.io_task));
                },
            }
        } else {
            scheduleFn(this.worker_pool, .from(&parse_task.task));
        }
    }

    pub fn schedule(this: *ThreadPool, parse_task: *ParseTask) void {
        this.scheduleWithOptions(parse_task, false);
    }

    pub fn scheduleInsideThreadPool(this: *ThreadPool, parse_task: *ParseTask) void {
        this.scheduleWithOptions(parse_task, true);
    }

    pub fn getWorker(this: *ThreadPool, id: std.Thread.Id) *Worker {
        var worker: *Worker = undefined;
        {
            this.workers_assignments_lock.lock();
            defer this.workers_assignments_lock.unlock();
            const entry = this.workers_assignments.getOrPut(id) catch unreachable;
            if (entry.found_existing) {
                return entry.value_ptr.*;
            }

            worker = bun.default_allocator.create(Worker) catch unreachable;
            entry.value_ptr.* = worker;
        }

        worker.* = .{
            .ctx = this.v2,
            .allocator = undefined,
            .thread = ThreadPoolLib.Thread.current,
        };
        worker.init(this.v2);

        return worker;
    }

    pub const Worker = struct {
        heap: ThreadlocalArena = ThreadlocalArena{},

        /// Thread-local memory allocator
        /// All allocations are freed in `deinit` at the very end of bundling.
        allocator: std.mem.Allocator,

        ctx: *BundleV2,

        data: WorkerData = undefined,
        quit: bool = false,

        ast_memory_allocator: js_ast.ASTMemoryAllocator = undefined,
        has_created: bool = false,
        thread: ?*ThreadPoolLib.Thread = null,

        deinit_task: ThreadPoolLib.Task = .{ .callback = deinitCallback },

        temporary_arena: bun.ArenaAllocator = undefined,
        stmt_list: LinkerContext.StmtList = undefined,

        pub fn deinitCallback(task: *ThreadPoolLib.Task) void {
            debug("Worker.deinit()", .{});
            var this: *Worker = @alignCast(@fieldParentPtr("deinit_task", task));
            this.deinit();
        }

        pub fn deinitSoon(this: *Worker) void {
            if (this.thread) |thread| {
                thread.pushIdleTask(&this.deinit_task);
            }
        }

        pub fn deinit(this: *Worker) void {
            if (this.has_created) {
                this.heap.deinit();
            }

            bun.default_allocator.destroy(this);
        }

        pub fn get(ctx: *BundleV2) *Worker {
            var worker = ctx.graph.pool.getWorker(std.Thread.getCurrentId());
            if (!worker.has_created) {
                worker.create(ctx);
            }

            worker.ast_memory_allocator.push();

            if (comptime FeatureFlags.help_catch_memory_issues) {
                worker.heap.helpCatchMemoryIssues();
            }

            return worker;
        }

        pub fn unget(this: *Worker) void {
            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.heap.helpCatchMemoryIssues();
            }

            this.ast_memory_allocator.pop();
        }

        pub const WorkerData = struct {
            log: *Logger.Log,
            estimated_input_lines_of_code: usize = 0,
            macro_context: js_ast.Macro.MacroContext,
            transpiler: Transpiler = undefined,
            other_transpiler: Transpiler = undefined,
            has_loaded_other_transpiler: bool = false,
        };

        pub fn init(worker: *Worker, v2: *BundleV2) void {
            worker.ctx = v2;
        }

        fn create(this: *Worker, ctx: *BundleV2) void {
            const trace = bun.perf.trace("Bundler.Worker.create");
            defer trace.end();

            this.has_created = true;
            Output.Source.configureThread();
            this.heap = ThreadlocalArena.init() catch unreachable;
            this.allocator = this.heap.allocator();

            const allocator = this.allocator;

            this.ast_memory_allocator = .{ .allocator = this.allocator };
            this.ast_memory_allocator.reset();

            this.data = WorkerData{
                .log = allocator.create(Logger.Log) catch unreachable,
                .estimated_input_lines_of_code = 0,
                .macro_context = undefined,
            };
            this.data.log.* = Logger.Log.init(allocator);
            this.ctx = ctx;
            this.temporary_arena = bun.ArenaAllocator.init(this.allocator);
            this.stmt_list = LinkerContext.StmtList.init(this.allocator);
            this.initializeTranspiler(&this.data.transpiler, ctx.transpiler, allocator);

            debug("Worker.create()", .{});
        }

        fn initializeTranspiler(this: *Worker, transpiler: *Transpiler, from: *Transpiler, allocator: std.mem.Allocator) void {
            transpiler.* = from.*;
            transpiler.setLog(this.data.log);
            transpiler.setAllocator(allocator);
            transpiler.linker.resolver = &transpiler.resolver;
            transpiler.macro_context = js_ast.Macro.MacroContext.init(transpiler);
            this.data.macro_context = transpiler.macro_context.?;
            const CacheSet = @import("../cache.zig");
            transpiler.resolver.caches = CacheSet.Set.init(allocator);
        }

        pub fn transpilerForTarget(this: *Worker, target: bun.options.Target) *Transpiler {
            if (target == .browser and this.data.transpiler.options.target != target) {
                if (!this.data.has_loaded_other_transpiler) {
                    this.data.has_loaded_other_transpiler = true;
                    this.initializeTranspiler(&this.data.other_transpiler, this.ctx.client_transpiler.?, this.allocator);
                }

                bun.debugAssert(this.data.other_transpiler.options.target == target);
                return &this.data.other_transpiler;
            }

            return &this.data.transpiler;
        }

        pub fn run(this: *Worker, ctx: *BundleV2) void {
            if (!this.has_created) {
                this.create(ctx);
            }

            // no funny business mr. cache

        }
    };
};

const Transpiler = bun.Transpiler;
const bun = @import("bun");
const Output = bun.Output;
const Environment = bun.Environment;
const default_allocator = bun.default_allocator;
const FeatureFlags = bun.FeatureFlags;

const std = @import("std");
const Logger = @import("../logger.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
pub const Ref = @import("../ast/base.zig").Ref;
const ThreadPoolLib = @import("../thread_pool.zig");
const ThreadlocalArena = @import("../allocators/mimalloc_arena.zig").Arena;
const allocators = @import("../allocators.zig");

pub const Index = @import("../ast/base.zig").Index;
const BundleV2 = bun.bundle_v2.BundleV2;
const ParseTask = bun.bundle_v2.ParseTask;
const LinkerContext = bun.bundle_v2.LinkerContext;
