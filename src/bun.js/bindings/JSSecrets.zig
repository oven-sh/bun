pub const SecretsJob = struct {
    vm: *jsc.VirtualMachine,
    task: jsc.WorkPoolTask,
    any_task: jsc.AnyTask,
    poll: Async.KeepAlive = .{},
    promise: jsc.Strong,

    ctx: *SecretsJobOptions,

    // Opaque pointer to C++ SecretsJobOptions struct
    const SecretsJobOptions = opaque {
        pub extern fn Bun__SecretsJobOptions__runTask(ctx: *SecretsJobOptions, global: *jsc.JSGlobalObject) void;
        pub extern fn Bun__SecretsJobOptions__runFromJS(ctx: *SecretsJobOptions, global: *jsc.JSGlobalObject, promise: jsc.JSValue) void;
        pub extern fn Bun__SecretsJobOptions__deinit(ctx: *SecretsJobOptions) void;
    };

    pub fn create(global: *jsc.JSGlobalObject, ctx: *SecretsJobOptions, promise: jsc.JSValue) *SecretsJob {
        const vm = global.bunVM();
        const job = bun.new(SecretsJob, .{
            .vm = vm,
            .task = .{
                .callback = &runTask,
            },
            .any_task = undefined,
            .ctx = ctx,
            .promise = jsc.Strong.create(promise, global),
        });
        job.any_task = jsc.AnyTask.New(SecretsJob, &runFromJS).init(job);
        return job;
    }

    pub fn runTask(task: *jsc.WorkPoolTask) void {
        const job: *SecretsJob = @fieldParentPtr("task", task);
        var vm = job.vm;
        defer vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(job.any_task.task()));

        SecretsJobOptions.Bun__SecretsJobOptions__runTask(job.ctx, vm.global);
    }

    pub fn runFromJS(this: *SecretsJob) void {
        defer this.deinit();
        const vm = this.vm;

        if (vm.isShuttingDown()) {
            return;
        }

        const promise = this.promise.get();
        if (promise == .zero) return;

        SecretsJobOptions.Bun__SecretsJobOptions__runFromJS(this.ctx, vm.global, promise);
    }

    fn deinit(this: *SecretsJob) void {
        SecretsJobOptions.Bun__SecretsJobOptions__deinit(this.ctx);
        this.poll.unref(this.vm);
        this.promise.deinit();
        bun.destroy(this);
    }

    pub fn schedule(this: *SecretsJob) void {
        this.poll.ref(this.vm);
        jsc.WorkPool.schedule(&this.task);
    }
};

// Helper function for C++ to call with opaque pointer
export fn Bun__Secrets__scheduleJob(global: *jsc.JSGlobalObject, options: *SecretsJob.SecretsJobOptions, promise: jsc.JSValue) void {
    const job = SecretsJob.create(global, options, promise);
    job.schedule();
}

// Prevent dead code elimination
pub fn fixDeadCodeElimination() void {
    std.mem.doNotOptimizeAway(&Bun__Secrets__scheduleJob);
}

comptime {
    _ = &fixDeadCodeElimination;
}

const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const jsc = bun.jsc;
