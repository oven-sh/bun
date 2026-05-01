pub const ThreadPool = struct {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    io_pool: *ThreadPoolLib,
    worker_pool: *ThreadPoolLib,
    worker_pool_is_owned: bool = false,
    workers_assignments: std.AutoArrayHashMap(std.Thread.Id, *Worker) = std.AutoArrayHashMap(std.Thread.Id, *Worker).init(bun.default_allocator),
    workers_assignments_lock: bun.Mutex = .{},
    v2: *BundleV2,

    const debug = Output.scoped(.ThreadPool, .visible);

    const IOThreadPool = struct {
        var thread_pool: ThreadPoolLib = undefined;
        // Protects initialization and deinitialization of the IO thread pool.
        var mutex = bun.threading.Mutex{};
        // 0 means not initialized. 1 means initialized but not used.
        // N > 1 means N-1 `ThreadPool`s are using the IO thread pool.
        var ref_count = std.atomic.Value(usize).init(0);

        pub fn acquire() *ThreadPoolLib {
            var count = ref_count.load(.acquire);
            while (true) {
                if (count == 0) break;
                // .monotonic is okay because we already loaded this value with .acquire,
                // and we don't need the store to be .release because the only store that
                // matters is the one that goes from 0 to 1, and that one is .release.
                count = ref_count.cmpxchgWeak(
                    count,
                    count + 1,
                    .monotonic,
                    .monotonic,
                ) orelse return &thread_pool;
            }

            mutex.lock();
            defer mutex.unlock();

            // .monotonic because the store we care about (the one that stores 1 to
            // indicate the thread pool is initialized) is guarded by the mutex.
            if (ref_count.load(.monotonic) != 0) return &thread_pool;
            thread_pool = .init(.{
                .max_threads = @max(@min(bun.getThreadCount(), 4), 2),
                // Use a much smaller stack size for the IO thread pool
                .stack_size = 512 * 1024,
            });
            // 2 means initialized and referenced by one `ThreadPool`.
            ref_count.store(2, .release);
            return &thread_pool;
        }

        pub fn release() void {
            const old = ref_count.fetchSub(1, .release);
            bun.assertf(old > 1, "IOThreadPool: too many calls to release()", .{});
        }

        pub fn shutdown() bool {
            // .acquire instead of .acq_rel is okay because we only need to ensure that other
            // threads are done using the IO pool if we read 1 from the ref count.
            //
            // .monotonic is okay because this function is only guaranteed to succeed when we
            // can ensure that no `ThreadPool`s exist.
            if (ref_count.cmpxchgStrong(1, 0, .acquire, .monotonic) != null) {
                // At least one `ThreadPool` still exists.
                return false;
            }

            mutex.lock();
            defer mutex.unlock();

            // .monotonic is okay because the only store that could happen at this point
            // is guarded by the mutex.
            if (ref_count.load(.monotonic) != 0) return false;
            thread_pool.deinit();
            thread_pool = undefined;
        }
    };

    pub fn init(v2: *BundleV2, worker_pool: ?*ThreadPoolLib) !ThreadPool {
        const pool = worker_pool orelse blk: {
            const cpu_count = bun.getThreadCount();
            const pool = try v2.allocator().create(ThreadPoolLib);
            pool.* = .init(.{ .max_threads = cpu_count });
            debug("{d} workers", .{cpu_count});
            break :blk pool;
        };
        var this = initWithPool(v2, pool);
        this.worker_pool_is_owned = false;
        return this;
    }

    pub fn initWithPool(v2: *BundleV2, worker_pool: *ThreadPoolLib) ThreadPool {
        return .{
            .worker_pool = worker_pool,
            .io_pool = if (usesIOPool()) IOThreadPool.acquire() else undefined,
            .v2 = v2,
        };
    }

    pub fn deinit(this: *ThreadPool) void {
        if (this.worker_pool_is_owned) {
            this.worker_pool.deinit();
            this.v2.allocator().destroy(this.worker_pool);
        }
        if (usesIOPool()) {
            IOThreadPool.release();
        }
    }

    pub fn start(this: *ThreadPool) void {
        this.worker_pool.warm(8);
        if (usesIOPool()) {
            this.io_pool.warm(1);
        }
    }

    pub fn usesIOPool() bool {
        if (bun.feature_flag.BUN_FEATURE_FLAG_FORCE_IO_POOL.get()) {
            // For testing.
            return true;
        }

        if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_IO_POOL.get()) {
            // For testing.
            return false;
        }

        if (Environment.isMac or Environment.isWindows) {
            // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
            return bun.getThreadCount() > 3;
        }

        return false;
    }

    /// Shut down the IO pool, if and only if no `ThreadPool`s exist right now.
    /// If a `ThreadPool` exists, this function is a no-op and returns false.
    /// Blocks until the IO pool is shut down.
    pub fn shutdownIOPool() bool {
        return if (usesIOPool()) IOThreadPool.shutdown() else true;
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

        if (usesIOPool()) {
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
            .heap = undefined,
            .allocator = undefined,
            .thread = ThreadPoolLib.Thread.current,
        };
        worker.init(this.v2);

        return worker;
    }

    pub const Worker = struct {
        heap: ThreadLocalArena,

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
            transpiler: Transpiler,
            other_transpiler: ?Transpiler = null,
        };

        pub fn init(worker: *Worker, v2: *BundleV2) void {
            worker.ctx = v2;
        }

        fn create(this: *Worker, ctx: *BundleV2) void {
            const trace = bun.perf.trace("Bundler.Worker.create");
            defer trace.end();

            this.has_created = true;
            Output.Source.configureThread();
            this.heap = ThreadLocalArena.init();
            this.allocator = this.heap.allocator();

            const allocator = this.allocator;

            this.ast_memory_allocator = .{ .allocator = this.allocator };
            this.ast_memory_allocator.reset();

            this.data = WorkerData{
                .log = bun.handleOom(allocator.create(Logger.Log)),
                .transpiler = undefined,
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
            const CacheSet = @import("../cache.zig");
            transpiler.resolver.caches = CacheSet.Set.init(allocator);
        }

        pub fn transpilerForTarget(this: *Worker, target: bun.options.Target) *Transpiler {
            if (target == .browser and this.data.transpiler.options.target != target) {
                const other_transpiler = if (this.data.other_transpiler) |*other|
                    other
                else blk: {
                    this.data.other_transpiler = undefined;
                    const other = &this.data.other_transpiler.?;
                    this.initializeTranspiler(other, this.ctx.client_transpiler.?, this.allocator);
                    break :blk other;
                };
                bun.debugAssert(other_transpiler.options.target == target);
                return other_transpiler;
            }

            return &this.data.transpiler;
        }

        pub fn run(this: *Worker, ctx: *BundleV2) void {
            if (!this.has_created) {
                this.create(ctx);
            }
        }
    };
};

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

const Logger = @import("../logger.zig");
const linker = @import("../linker.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const Output = bun.Output;
const ThreadPoolLib = bun.ThreadPool;
const Transpiler = bun.Transpiler;
const default_allocator = bun.default_allocator;
const js_ast = bun.ast;

const allocators = bun.allocators;
const ThreadLocalArena = bun.allocators.MimallocArena;

const BundleV2 = bun.bundle_v2.BundleV2;
const LinkerContext = bun.bundle_v2.LinkerContext;
const ParseTask = bun.bundle_v2.ParseTask;
