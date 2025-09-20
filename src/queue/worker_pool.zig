const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const Channel = @import("channel.zig").Channel;
const Job = @import("job.zig").Job;
const Allocator = std.mem.Allocator;
const Atomic = std.atomic.Value;
const Mutex = std.Thread.Mutex;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

pub const JobResult = union(enum) {
    success: JSValue,
    failure: struct {
        job_error: []const u8,
        stack: ?[]const u8,
    },
};

pub const JobWithPromise = struct {
    job: *Job,
    promise: *jsc.JSPromise,
    global: *JSGlobalObject,
};

pub const WorkerContext = struct {
    id: u32,
    pool: *WorkerPool,
    vm: *jsc.VirtualMachine,
    global: *JSGlobalObject,
    thread: std.Thread,
    is_running: Atomic(bool),

    pub fn deinit(self: *WorkerContext) void {
        self.is_running.store(false, .release);
    }
};

pub const WorkerPool = struct {
    const Self = @This();

    allocator: Allocator,
    job_channel: Channel(JobWithPromise),
    result_channel: Channel(JobResult),
    workers: []WorkerContext,
    worker_count: u32,
    is_running: Atomic(bool),
    handler_function: JSValue,
    main_global: *JSGlobalObject,
    pending_jobs: Atomic(usize),

    pub fn init(
        allocator: Allocator,
        main_global: *JSGlobalObject,
        handler_function: JSValue,
        worker_count: u32,
    ) !Self {
        if (worker_count == 0 or worker_count > 100) {
            return error.InvalidWorkerCount;
        }

        var pool = Self{
            .allocator = allocator,
            .job_channel = try Channel(JobWithPromise).init(allocator, 1024),
            .result_channel = try Channel(JobResult).init(allocator, 1024),
            .workers = try allocator.alloc(WorkerContext, worker_count),
            .worker_count = worker_count,
            .is_running = Atomic(bool).init(true),
            .handler_function = handler_function,
            .main_global = main_global,
            .pending_jobs = Atomic(usize).init(0),
        };

        for (pool.workers, 0..) |*worker, i| {
            worker.* = WorkerContext{
                .id = @intCast(i),
                .pool = &pool,
                .vm = undefined,
                .global = undefined,
                .thread = undefined,
                .is_running = Atomic(bool).init(true),
            };
        }

        for (pool.workers) |*worker| {
            worker.thread = try std.Thread.spawn(.{}, workerMain, .{worker});
        }

        _ = try std.Thread.spawn(.{}, resultProcessor, .{&pool});

        return pool;
    }

    pub fn deinit(self: *Self) void {
        self.is_running.store(false, .release);

        for (self.workers) |*worker| {
            worker.is_running.store(false, .release);
            worker.thread.join();
            worker.deinit();
        }

        self.job_channel.deinit();
        self.result_channel.deinit();
        self.allocator.free(self.workers);
    }

    pub fn submitJob(self: *Self, job: *Job, promise: *jsc.JSPromise, global: *JSGlobalObject) !void {
        const job_with_promise = JobWithPromise{
            .job = job,
            .promise = promise,
            .global = global,
        };

        _ = self.pending_jobs.fetchAdd(1, .release);
        try self.job_channel.send(job_with_promise);
    }

    pub fn getPendingCount(self: *Self) usize {
        return self.pending_jobs.load(.acquire);
    }

    pub fn isIdle(self: *Self) bool {
        return self.pending_jobs.load(.acquire) == 0;
    }

    fn workerMain(ctx: *WorkerContext) void {
        // TODO: proper worker isolation using bun's worker infrastructure
        // For now, we'll process jobs on the main thread via the event loop

        const vm = jsc.VirtualMachine.get();
        ctx.vm = vm;
        ctx.global = vm.global;

        const handler = ctx.pool.handler_function;

        // main worker loop
        while (ctx.is_running.load(.acquire) and ctx.pool.is_running.load(.acquire)) {
            if (ctx.pool.job_channel.receiveTimeout(100)) |job_with_promise| {
                const result = executeJob(ctx, &job_with_promise, handler);

                ctx.pool.result_channel.send(result) catch {
                    std.debug.print("Worker {d}: Result channel full\n", .{ctx.id});
                };

                _ = ctx.pool.pending_jobs.fetchSub(1, .release);
            }
        }
    }

    fn executeJob(ctx: *WorkerContext, job_with_promise: *const JobWithPromise, handler: JSValue) JobResult {
        const job = job_with_promise.job;

        const job_obj = createJobObject(ctx.global, job) catch {
            return JobResult{
                .failure = .{
                    .job_error = "Failed to create job object",
                    .stack = null,
                },
            };
        };

        const args = [_]JSValue{job_obj};

        const result = handler.call(ctx.global, ctx.global.toJSValue(), &args) catch |err| {
            const error_name = @errorName(err);
            return JobResult{
                .failure = .{
                    .job_error = error_name,
                    .stack = null,
                },
            };
        };

        // for now, we don't handle promises in workers
        // This would require more complex async handling
        // TODO: implement promise handling in worker context
        if (result.asAnyPromise()) |_| {
            return JobResult{
                .failure = .{
                    .job_error = "promise results not yet supported in workers",
                    .stack = null,
                },
            };
        }

        return JobResult{ .success = result };
    }

    fn createJobObject(global: *JSGlobalObject, job: *Job) !JSValue {
        const obj = JSValue.createEmptyObject(global, 5);

        if (job.id) |id| {
            obj.put(global, "id", JSValue.jsNumber(id));
        }

        const name_str = bun.String.init(job.name);
        obj.put(global, "name", name_str.toJS(global));

        var data_str = bun.String.init(job.data);
        const data_js = data_str.toJSByParseJSON(global) catch .zero;
        obj.put(global, "data", data_js);

        obj.put(global, "progress", JSValue.jsNumber(job.progress));

        const report_progress_fn = jsc.JSFunction.create(global, "reportProgress", reportProgressCallback, 1, .{});
        obj.put(global, "reportProgress", report_progress_fn);

        return obj;
    }

    fn reportProgressCallback(global: *JSGlobalObject, callframe: *jsc.CallFrame) !JSValue {
        _ = global;
        const args = callframe.arguments_old(1).slice();
        if (args.len > 0 and args[0].isNumber()) {
            // TODO: would update the job's progress
            // For now, just acknowledge
        }
        return .zero;
    }

    fn resultProcessor(pool: *Self) void {
        while (pool.is_running.load(.acquire)) {
            if (pool.result_channel.receiveTimeout(100)) |result| {
                // process result on main thread
                // this would involve resolving/rejecting the associated promise
                // for now, just log
                _ = result;
            }
        }
    }
};
